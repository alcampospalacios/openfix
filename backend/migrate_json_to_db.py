"""
One-time migration script: JSON files → PostgreSQL.

Usage:
    python migrate_json_to_db.py
"""

import asyncio
import json
from pathlib import Path

from db import (
    init_db, get_session,
    Crash, RepoConfig, AgentStatus, TestMessage,
)

DATA_DIR = Path("/app/data")


async def migrate():
    await init_db()

    # ── Crashes ─────────────────────────────────────────────────────────
    crashes_file = DATA_DIR / "crashes.json"
    if crashes_file.exists():
        crashes = json.loads(crashes_file.read_text())
        async with get_session() as session:
            for c in crashes:
                existing = await session.get(Crash, c["id"])
                if existing:
                    continue
                session.add(Crash(
                    id=c["id"],
                    title=c.get("title", ""),
                    description=c.get("description", ""),
                    timestamp=c.get("timestamp", ""),
                    severity=c.get("severity", "ERROR"),
                    status=c.get("status", "pending"),
                    source=c.get("source", ""),
                    pr_url=c.get("prUrl"),
                    error=c.get("error"),
                    updated_at=c.get("updated_at"),
                    exception_class=c.get("exception_class", ""),
                    app_package=c.get("app_package", ""),
                    platform=c.get("platform", ""),
                    version=c.get("version", ""),
                    enriched=c.get("enriched", False),
                    stacktrace=c.get("stacktrace"),
                    device=c.get("device"),
                    os_version=c.get("os_version"),
                    blame_file=c.get("blame_file"),
                    blame_line=c.get("blame_line"),
                    blame_symbol=c.get("blame_symbol"),
                    bq_issue_id=c.get("bq_issue_id"),
                ))
        print(f"Migrated {len(crashes)} crashes")
    else:
        print("No crashes.json found, skipping")

    # ── Config ──────────────────────────────────────────────────────────
    config_file = DATA_DIR / "config.json"
    if config_file.exists():
        config = json.loads(config_file.read_text())
        async with get_session() as session:
            for repo_id, cfg in config.items():
                existing = await session.get(RepoConfig, repo_id)
                if existing:
                    continue
                session.add(RepoConfig(
                    repo_id=repo_id,
                    github_repo=cfg.get("github_repo", ""),
                    github_token=cfg.get("github_token", ""),
                    firebase_project=cfg.get("firebase_project", ""),
                    firebase_credentials=cfg.get("firebase_credentials", ""),
                    model=cfg.get("model", "minimax/MiniMax-M2.5"),
                    slack_app_token=cfg.get("slack_app_token", ""),
                    slack_bot_token=cfg.get("slack_bot_token", ""),
                    slack_channel_id=cfg.get("slack_channel_id", ""),
                    api_key=cfg.get("api_key"),
                ))
        print(f"Migrated {len(config)} repo configs")
    else:
        print("No config.json found, skipping")

    # ── Agent Status ────────────────────────────────────────────────────
    status_file = DATA_DIR / "agent_status.json"
    if status_file.exists():
        status = json.loads(status_file.read_text())
        async with get_session() as session:
            existing = await session.get(AgentStatus, 1)
            if not existing:
                session.add(AgentStatus(
                    id=1,
                    status=status.get("status", "offline"),
                    last_seen=status.get("last_seen"),
                    model=status.get("model"),
                ))
        print("Migrated agent status")
    else:
        print("No agent_status.json found, skipping")

    # ── Test Messages ───────────────────────────────────────────────────
    messages_file = DATA_DIR / "test_messages.json"
    if messages_file.exists():
        messages = json.loads(messages_file.read_text())
        async with get_session() as session:
            for m in messages:
                existing = await session.get(TestMessage, m["id"])
                if existing:
                    continue
                session.add(TestMessage(
                    id=m["id"],
                    text=m.get("text", ""),
                    timestamp=m.get("timestamp", ""),
                    response=m.get("response"),
                    responded_at=m.get("responded_at"),
                ))
        print(f"Migrated {len(messages)} test messages")
    else:
        print("No test_messages.json found, skipping")

    print("Migration complete!")


if __name__ == "__main__":
    asyncio.run(migrate())
