"""
Slack Socket Mode Listener for Openfix
Connects to Slack via WebSocket to detect Firebase Crashlytics notifications
in a configured channel, without exposing the backend to the internet.
"""

import json
import asyncio
import re
import threading
from datetime import datetime
from pathlib import Path

from slack_sdk.web import WebClient
from slack_sdk.socket_mode import SocketModeClient
from slack_sdk.socket_mode.response import SocketModeResponse
from slack_sdk.socket_mode.request import SocketModeRequest

from sqlalchemy import select

from db import get_session, Crash, RepoConfig, crash_to_dict, config_to_dict
from crashlytics_enricher import set_ws_manager as set_enricher_ws, start_enrichment


# Will be set from main.py to broadcast via WebSocket
_ws_manager = None
_loop = None


def set_ws_manager(manager, loop):
    global _ws_manager, _loop
    _ws_manager = manager
    _loop = loop
    set_enricher_ws(manager, loop)


def parse_crashlytics_message(text: str, blocks: list | None = None) -> dict | None:
    """Parse a Firebase Crashlytics notification from Slack message content."""
    if not text:
        return None

    crashlytics_keywords = [
        "crash", "fatal", "exception", "issue", "crashlytics",
        "non-fatal", "anr", "error", "regression", "velocity"
    ]

    text_lower = text.lower()
    is_crashlytics = any(kw in text_lower for kw in crashlytics_keywords)

    if not is_crashlytics:
        return None

    summary_match = re.search(r"Summary:\s*(.+)", text)
    app_match = re.search(r"App:\s*(\S+)", text)
    platform_match = re.search(r"Platform:\s*(\S+)", text)
    version_match = re.search(r"Version:\s*(\S+)", text)

    exception_class = summary_match.group(1).strip() if summary_match else ""
    app_package = app_match.group(1).strip() if app_match else ""
    platform = platform_match.group(1).strip() if platform_match else ""
    version = version_match.group(1).strip() if version_match else ""

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
    title = exception_class if exception_class else (lines[0][:200] if lines else "Unknown crash from Slack")

    issue_id = None
    url_match = re.search(r"issues/([a-f0-9]+)", text)
    if url_match:
        issue_id = url_match.group(1)

    if not issue_id:
        issue_id = f"slack_{int(datetime.utcnow().timestamp())}"

    description = text[:1000]

    return {
        "id": issue_id,
        "title": title,
        "description": description,
        "timestamp": datetime.utcnow().isoformat(),
        "severity": "ERROR",
        "status": "pending",
        "source": "slack",
        "prUrl": None,
        "error": None,
        "exception_class": exception_class,
        "app_package": app_package,
        "platform": platform,
        "version": version,
        "enriched": False,
    }


def _broadcast_crash(crash: dict):
    """Schedule WS broadcast on the main asyncio event loop."""
    if _ws_manager and _loop:
        async def _do_broadcast():
            await _ws_manager.send_to_agent("new_crash", crash)
            await _ws_manager.broadcast_to_frontends("new_crash", crash)

        asyncio.run_coroutine_threadsafe(_do_broadcast(), _loop)


async def _save_and_broadcast_crash(crash_data: dict):
    """Insert crash into DB, broadcast via WS, and trigger enrichment."""
    # Check for duplicates and insert
    async with get_session() as session:
        existing = await session.get(Crash, crash_data["id"])
        if existing:
            return  # duplicate

        session.add(Crash(
            id=crash_data["id"],
            title=crash_data.get("title", ""),
            description=crash_data.get("description", ""),
            timestamp=crash_data.get("timestamp", ""),
            severity=crash_data.get("severity", "ERROR"),
            status=crash_data.get("status", "pending"),
            source=crash_data.get("source", ""),
            pr_url=crash_data.get("prUrl"),
            error=crash_data.get("error"),
            exception_class=crash_data.get("exception_class", ""),
            app_package=crash_data.get("app_package", ""),
            platform=crash_data.get("platform", ""),
            version=crash_data.get("version", ""),
            enriched=crash_data.get("enriched", False),
        ))

    print(f"New crash from Slack: {crash_data['id']} - {crash_data.get('title', '')[:80]}")

    # Broadcast via WebSocket
    if _ws_manager:
        await _ws_manager.send_to_agent("new_crash", crash_data)
        await _ws_manager.broadcast_to_frontends("new_crash", crash_data)

    # Trigger BigQuery enrichment if firebase credentials are configured
    async with get_session() as session:
        result = await session.execute(select(RepoConfig))
        first = result.scalars().first()
        if first and first.firebase_project and first.firebase_credentials:
            repo_cfg = config_to_dict(first)
            start_enrichment(crash_data, repo_cfg)


def _handle_message_event(event: dict, channel_id: str):
    """Process a single Slack message event."""
    if event.get("channel") != channel_id:
        return

    text = event.get("text", "")
    blocks = event.get("blocks")

    crash = parse_crashlytics_message(text, blocks)
    if not crash:
        return

    # Schedule async DB operation on the main event loop
    if _loop:
        asyncio.run_coroutine_threadsafe(_save_and_broadcast_crash(crash), _loop)


def start_slack_listener():
    """Start Slack Socket Mode listener in a background thread."""
    # Load config from DB via the main event loop
    if not _loop:
        print("Slack listener: no event loop, skipping")
        return

    future = asyncio.run_coroutine_threadsafe(_load_slack_config(), _loop)
    try:
        config = future.result(timeout=10)
    except Exception as e:
        print(f"Slack listener: failed to load config: {e}")
        return

    if not config:
        print("Slack listener: no config, skipping")
        return

    app_token = config.get("slack_app_token", "")
    bot_token = config.get("slack_bot_token", "")
    channel_id = config.get("slack_channel_id", "")

    if not app_token or not bot_token or not channel_id:
        print("Slack listener: missing slack_app_token, slack_bot_token, or slack_channel_id in config")
        return

    def _run():
        try:
            web_client = WebClient(token=bot_token)
            socket_client = SocketModeClient(
                app_token=app_token,
                web_client=web_client,
            )

            def process(client: SocketModeClient, req: SocketModeRequest):
                response = SocketModeResponse(envelope_id=req.envelope_id)
                client.send_socket_mode_response(response)

                if req.type == "events_api":
                    event = req.payload.get("event", {})
                    if event.get("type") == "message" and event.get("subtype") is None:
                        _handle_message_event(event, channel_id)
                    elif event.get("type") == "message" and event.get("subtype") == "bot_message":
                        _handle_message_event(event, channel_id)

            socket_client.socket_mode_request_listeners.append(process)
            print(f"Slack listener: connecting to channel {channel_id}")
            socket_client.connect()

            import time
            while True:
                time.sleep(60)

        except Exception as e:
            print(f"Slack listener error: {e}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    print("Slack listener: started in background thread")


async def _load_slack_config() -> dict | None:
    """Load the first repo config from DB."""
    async with get_session() as session:
        result = await session.execute(select(RepoConfig))
        first = result.scalars().first()
        if not first:
            return None
        return config_to_dict(first)
