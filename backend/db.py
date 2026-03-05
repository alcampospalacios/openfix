"""
Openfix Database Layer
Async SQLAlchemy + asyncpg for PostgreSQL persistence.
"""

import os
from datetime import datetime
from contextlib import asynccontextmanager

from sqlalchemy import String, Text, Boolean, Integer, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://openfix:openfix@postgres:5432/openfix",
)

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ── Models ──────────────────────────────────────────────────────────────────


class Crash(Base):
    __tablename__ = "crashes"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    title: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[str] = mapped_column(String(64), default="")
    severity: Mapped[str] = mapped_column(String(32), default="ERROR")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    source: Mapped[str] = mapped_column(String(64), default="")
    pr_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Crashlytics-specific fields
    exception_class: Mapped[str] = mapped_column(Text, default="")
    app_package: Mapped[str] = mapped_column(String(255), default="")
    platform: Mapped[str] = mapped_column(String(64), default="")
    version: Mapped[str] = mapped_column(String(64), default="")
    enriched: Mapped[bool] = mapped_column(Boolean, default=False)
    # BigQuery enrichment fields
    stacktrace: Mapped[str | None] = mapped_column(Text, nullable=True)
    device: Mapped[str | None] = mapped_column(String(255), nullable=True)
    os_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    blame_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    blame_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blame_symbol: Mapped[str | None] = mapped_column(Text, nullable=True)
    bq_issue_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RepoConfig(Base):
    __tablename__ = "repo_configs"

    repo_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    github_repo: Mapped[str] = mapped_column(Text, default="")
    github_token: Mapped[str] = mapped_column(Text, default="")
    firebase_project: Mapped[str] = mapped_column(Text, default="")
    firebase_credentials: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(255), default="minimax/MiniMax-M2.5")
    slack_app_token: Mapped[str] = mapped_column(Text, default="")
    slack_bot_token: Mapped[str] = mapped_column(Text, default="")
    slack_channel_id: Mapped[str] = mapped_column(String(255), default="")
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentStatus(Base):
    __tablename__ = "agent_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    status: Mapped[str] = mapped_column(String(32), default="offline")
    last_seen: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)


class TestMessage(Base):
    __tablename__ = "test_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    text: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[str] = mapped_column(String(64), default="")
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_at: Mapped[str | None] = mapped_column(String(64), nullable=True)


# ── Session helper ──────────────────────────────────────────────────────────


@asynccontextmanager
async def get_session():
    async with async_session() as session:
        async with session.begin():
            yield session


# ── Init ────────────────────────────────────────────────────────────────────


async def init_db():
    """Create all tables if they don't exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ── Serialization helpers (preserve existing API contract) ──────────────────


def crash_to_dict(c: Crash) -> dict:
    d = {
        "id": c.id,
        "title": c.title,
        "description": c.description,
        "timestamp": c.timestamp,
        "severity": c.severity,
        "status": c.status,
        "source": c.source,
        "prUrl": c.pr_url,
        "error": c.error,
        "updated_at": c.updated_at,
    }
    # Include crashlytics/enrichment fields when present
    if c.exception_class:
        d["exception_class"] = c.exception_class
    if c.app_package:
        d["app_package"] = c.app_package
    if c.platform:
        d["platform"] = c.platform
    if c.version:
        d["version"] = c.version
    d["enriched"] = c.enriched
    if c.enriched:
        d["stacktrace"] = c.stacktrace
        d["device"] = c.device
        d["os_version"] = c.os_version
        d["blame_file"] = c.blame_file
        d["blame_line"] = c.blame_line
        d["blame_symbol"] = c.blame_symbol
        d["bq_issue_id"] = c.bq_issue_id
    return d


def config_to_dict(rc: RepoConfig) -> dict:
    d = {
        "github_repo": rc.github_repo,
        "github_token": rc.github_token,
        "firebase_project": rc.firebase_project,
        "firebase_credentials": rc.firebase_credentials,
        "model": rc.model,
    }
    if rc.slack_app_token:
        d["slack_app_token"] = rc.slack_app_token
    if rc.slack_bot_token:
        d["slack_bot_token"] = rc.slack_bot_token
    if rc.slack_channel_id:
        d["slack_channel_id"] = rc.slack_channel_id
    if rc.api_key:
        d["api_key"] = rc.api_key
    return d


def agent_status_to_dict(a: AgentStatus) -> dict:
    d = {"status": a.status, "last_seen": a.last_seen}
    if a.model:
        d["model"] = a.model
    return d


def test_message_to_dict(m: TestMessage) -> dict:
    d = {
        "id": m.id,
        "text": m.text,
        "timestamp": m.timestamp,
        "response": m.response,
    }
    if m.responded_at:
        d["responded_at"] = m.responded_at
    return d
