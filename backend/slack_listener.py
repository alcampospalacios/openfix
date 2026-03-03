"""
Slack Socket Mode Listener for Openfix
Connects to Slack via WebSocket to detect Firebase Crashlytics notifications
in a configured channel, without exposing the backend to the internet.
"""

import json
import asyncio
import re
import os
import threading
from datetime import datetime
from pathlib import Path

from slack_sdk.web import WebClient
from slack_sdk.socket_mode import SocketModeClient
from slack_sdk.socket_mode.response import SocketModeResponse
from slack_sdk.socket_mode.request import SocketModeRequest

from crashlytics_enricher import set_ws_manager as set_enricher_ws, start_enrichment


DATA_DIR = Path("/app/data")
CRASHES_FILE = DATA_DIR / "crashes.json"
CONFIG_FILE = DATA_DIR / "config.json"

# Will be set from main.py to broadcast via WebSocket
_ws_manager = None
_loop = None


def set_ws_manager(manager, loop):
    global _ws_manager, _loop
    _ws_manager = manager
    _loop = loop
    set_enricher_ws(manager, loop)


def load_crashes():
    if CRASHES_FILE.exists():
        with open(CRASHES_FILE) as f:
            return json.load(f)
    return []


def save_crashes(crashes):
    with open(CRASHES_FILE, "w") as f:
        json.dump(crashes, f, indent=2)


def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def parse_crashlytics_message(text: str, blocks: list | None = None) -> dict | None:
    """Parse a Firebase Crashlytics notification from Slack message content."""
    if not text:
        return None

    # Firebase Crashlytics messages typically contain crash-related keywords
    crashlytics_keywords = [
        "crash", "fatal", "exception", "issue", "crashlytics",
        "non-fatal", "anr", "error", "regression", "velocity"
    ]

    text_lower = text.lower()
    is_crashlytics = any(kw in text_lower for kw in crashlytics_keywords)

    if not is_crashlytics:
        return None

    # Extract structured fields via regex
    summary_match = re.search(r"Summary:\s*(.+)", text)
    app_match = re.search(r"App:\s*(\S+)", text)
    platform_match = re.search(r"Platform:\s*(\S+)", text)
    version_match = re.search(r"Version:\s*(\S+)", text)

    exception_class = summary_match.group(1).strip() if summary_match else ""
    app_package = app_match.group(1).strip() if app_match else ""
    platform = platform_match.group(1).strip() if platform_match else ""
    version = version_match.group(1).strip() if version_match else ""

    # Extract title - first meaningful line or the whole text truncated
    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
    title = exception_class if exception_class else (lines[0][:200] if lines else "Unknown crash from Slack")

    # Try to extract issue ID from URLs or text patterns
    issue_id = None
    # Firebase console URL pattern
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


def _handle_message_event(event: dict, channel_id: str):
    """Process a single Slack message event."""
    # Only process messages from the configured channel
    if event.get("channel") != channel_id:
        return

    # Ignore bot messages that are our own replies, but allow other bots
    # (Firebase Crashlytics sends as a bot/integration)
    text = event.get("text", "")
    blocks = event.get("blocks")

    crash = parse_crashlytics_message(text, blocks)
    if not crash:
        return

    # Check for duplicates
    crashes = load_crashes()
    existing_ids = {c["id"] for c in crashes}
    if crash["id"] in existing_ids:
        return

    crashes.append(crash)
    save_crashes(crashes)
    print(f"New crash from Slack: {crash['id']} - {crash['title'][:80]}")

    _broadcast_crash(crash)

    # Trigger BigQuery enrichment if firebase credentials are configured
    config = load_config()
    keys = list(config.keys())
    if keys:
        repo_config = config[keys[0]]
        if repo_config.get("firebase_project") and repo_config.get("firebase_credentials"):
            start_enrichment(crash, repo_config)


def start_slack_listener():
    """Start Slack Socket Mode listener in a background thread."""
    config = load_config()
    keys = list(config.keys())

    if not keys:
        print("Slack listener: no config, skipping")
        return

    repo_config = config[keys[0]]
    app_token = repo_config.get("slack_app_token", "")
    bot_token = repo_config.get("slack_bot_token", "")
    channel_id = repo_config.get("slack_channel_id", "")

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
                # Acknowledge immediately
                response = SocketModeResponse(envelope_id=req.envelope_id)
                client.send_socket_mode_response(response)

                if req.type == "events_api":
                    event = req.payload.get("event", {})
                    if event.get("type") == "message" and event.get("subtype") is None:
                        _handle_message_event(event, channel_id)
                    # Also handle bot messages (Firebase sends as bot)
                    elif event.get("type") == "message" and event.get("subtype") == "bot_message":
                        _handle_message_event(event, channel_id)

            socket_client.socket_mode_request_listeners.append(process)
            print(f"Slack listener: connecting to channel {channel_id}")
            socket_client.connect()

            # Keep thread alive
            import time
            while True:
                time.sleep(60)

        except Exception as e:
            print(f"Slack listener error: {e}")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    print("Slack listener: started in background thread")
