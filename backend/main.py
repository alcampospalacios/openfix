"""
Openfix Backend API
FastAPI - Lightweight API for receiving Firebase notifications
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Body, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional
from contextlib import asynccontextmanager
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
import uuid
import asyncio

from sqlalchemy import select

from db import (
    init_db, get_session,
    Crash, RepoConfig as RepoConfigModel, AgentStatus as AgentStatusModel, TestMessage as TestMessageModel,
    crash_to_dict, config_to_dict, agent_status_to_dict, test_message_to_dict,
)
from ws_manager import manager
from slack_listener import set_ws_manager, start_slack_listener
from crashlytics_enricher import fetch_crashes_from_bq, run_enrichment_queue, is_queue_running


# Storage directories (repos still on filesystem)
REPOS_DIR = Path("/app/repos")
REPOS_DIR.mkdir(exist_ok=True)

# Available models
AVAILABLE_MODELS = [
    {"id": "minimax/MiniMax-M2.5", "name": "MiniMax M2.5", "provider": "minimax"},
    {"id": "openai/gpt-4o", "name": "GPT-4o", "provider": "openai"},
    {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "provider": "anthropic"},
    {"id": "google/gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "google"},
]


# Models (Pydantic)
class CrashPayload(BaseModel):
    event: str
    data: dict

class RepoConfig(BaseModel):
    repo_id: str
    github_repo: str
    github_token: str
    firebase_project: Optional[str] = ""
    firebase_credentials: Optional[str] = ""
    model: Optional[str] = "minimax/MiniMax-M2.5"

class SlackConfig(BaseModel):
    slack_app_token: str
    slack_bot_token: str
    slack_channel_id: str

class ModelConfig(BaseModel):
    model: str
    api_key: Optional[str] = None

class AgentHeartbeat(BaseModel):
    status: str
    model: Optional[str] = None

class CrashUpdate(BaseModel):
    status: Optional[str] = None
    prUrl: Optional[str] = None
    error: Optional[str] = None

class TestMessage(BaseModel):
    text: str

class TestResponse(BaseModel):
    messageId: str
    response: str


# ── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loop_ref
    # Startup
    await init_db()
    loop = asyncio.get_event_loop()
    _loop_ref = loop
    set_ws_manager(manager, loop)
    start_slack_listener()
    yield
    # Shutdown (nothing needed)


app = FastAPI(title="Openfix API", version="1.0.0", lifespan=lifespan)


# ── Health ──────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "service": "openfix-api", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/models")
def get_models():
    return {"models": AVAILABLE_MODELS}


# ── WebSocket Endpoints ─────────────────────────────────────────────────────

@app.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await manager.connect_frontend(websocket)
    try:
        # Send initial state
        async with get_session() as session:
            agent_row = await session.get(AgentStatusModel, 1)
            agent_status = agent_status_to_dict(agent_row) if agent_row else {"status": "offline", "last_seen": None}

            if agent_status.get("last_seen"):
                last_seen = datetime.fromisoformat(agent_status["last_seen"])
                now = datetime.utcnow()
                if (now - last_seen).total_seconds() / 60 > 5:
                    agent_status["status"] = "offline"

            result = await session.execute(select(Crash))
            crashes = [crash_to_dict(c) for c in result.scalars().all()]

        await websocket.send_text(json.dumps({
            "event": "init",
            "data": {"agent_status": agent_status, "crashes": crashes}
        }))

        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            event = msg.get("event")

            if event == "test_message":
                data = msg.get("data", {})
                msg_id = str(uuid.uuid4())[:8]
                async with get_session() as session:
                    session.add(TestMessageModel(
                        id=msg_id,
                        text=data.get("text", ""),
                        timestamp=datetime.utcnow().isoformat(),
                        response=None,
                    ))
                await manager.send_to_agent("test_message", {"id": msg_id, "text": data.get("text", "")})

    except WebSocketDisconnect:
        manager.disconnect_frontend(websocket)
    except Exception:
        manager.disconnect_frontend(websocket)


@app.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket):
    await manager.connect_agent(websocket)
    # Mark agent as running
    status_data = {"status": "running", "last_seen": datetime.utcnow().isoformat()}
    async with get_session() as session:
        agent = await session.get(AgentStatusModel, 1)
        if agent:
            agent.status = "running"
            agent.last_seen = status_data["last_seen"]
        else:
            session.add(AgentStatusModel(id=1, status="running", last_seen=status_data["last_seen"]))
    await manager.broadcast_to_frontends("agent_status", status_data)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            event = msg.get("event")
            data = msg.get("data", {})

            if event == "heartbeat":
                status_data = {
                    "status": data.get("status", "running"),
                    "last_seen": datetime.utcnow().isoformat(),
                }
                async with get_session() as session:
                    agent = await session.get(AgentStatusModel, 1)
                    if agent:
                        agent.status = status_data["status"]
                        agent.last_seen = status_data["last_seen"]
                    else:
                        session.add(AgentStatusModel(id=1, **status_data))
                await manager.broadcast_to_frontends("agent_status", status_data)

            elif event == "test_response":
                async with get_session() as session:
                    msg_row = await session.get(TestMessageModel, data.get("messageId"))
                    if msg_row:
                        msg_row.response = data.get("response")
                        msg_row.responded_at = datetime.utcnow().isoformat()
                await manager.broadcast_to_frontends("test_response", data)

            elif event == "crash_progress":
                await manager.broadcast_to_frontends("crash_progress", data)

            elif event == "crash_update":
                crash_id = data.get("crashId")
                async with get_session() as session:
                    crash = await session.get(Crash, crash_id)
                    if crash:
                        if data.get("status"):
                            crash.status = data["status"]
                        if data.get("prUrl"):
                            crash.pr_url = data["prUrl"]
                        if data.get("error"):
                            crash.error = data["error"]
                        crash.updated_at = datetime.utcnow().isoformat()
                await manager.broadcast_to_frontends("crash_updated", data)

    except WebSocketDisconnect:
        manager.disconnect_agent()
        await _set_agent_offline()
    except Exception:
        manager.disconnect_agent()
        await _set_agent_offline()


async def _set_agent_offline():
    status_data = {"status": "offline", "last_seen": datetime.utcnow().isoformat()}
    async with get_session() as session:
        agent = await session.get(AgentStatusModel, 1)
        if agent:
            agent.status = "offline"
            agent.last_seen = status_data["last_seen"]
        else:
            session.add(AgentStatusModel(id=1, **status_data))
    await manager.broadcast_to_frontends("agent_status", status_data)


# ── HTTP Endpoints ──────────────────────────────────────────────────────────

@app.post("/api/agent/heartbeat")
async def agent_heartbeat(heartbeat: AgentHeartbeat):
    status_data = {
        "status": heartbeat.status,
        "model": heartbeat.model,
        "last_seen": datetime.utcnow().isoformat(),
    }
    async with get_session() as session:
        agent = await session.get(AgentStatusModel, 1)
        if agent:
            agent.status = heartbeat.status
            agent.model = heartbeat.model
            agent.last_seen = status_data["last_seen"]
        else:
            session.add(AgentStatusModel(id=1, **status_data))
    return {"status": "ok", "message": "Heartbeat received"}

@app.get("/api/agent/status")
async def get_agent_status():
    async with get_session() as session:
        agent = await session.get(AgentStatusModel, 1)
        if not agent:
            return {"status": "offline", "last_seen": None}
        status_data = agent_status_to_dict(agent)

    if status_data.get("last_seen"):
        last_seen = datetime.fromisoformat(status_data["last_seen"])
        now = datetime.utcnow()
        minutes_ago = (now - last_seen).total_seconds() / 60
        if minutes_ago > 5:
            status_data["status"] = "offline"

    return status_data

# Test message endpoints
@app.post("/api/agent/test")
async def send_test_message(message: TestMessage):
    msg_id = str(uuid.uuid4())[:8]
    async with get_session() as session:
        session.add(TestMessageModel(
            id=msg_id,
            text=message.text,
            timestamp=datetime.utcnow().isoformat(),
            response=None,
        ))
    return {"status": "sent", "messageId": msg_id, "text": message.text}

@app.get("/api/agent/test-queue")
async def get_test_queue():
    async with get_session() as session:
        result = await session.execute(
            select(TestMessageModel).where(TestMessageModel.response.is_(None))
        )
        pending = [test_message_to_dict(m) for m in result.scalars().all()]
    return pending

@app.post("/api/agent/test-response")
async def send_test_response(response: TestResponse):
    async with get_session() as session:
        msg = await session.get(TestMessageModel, response.messageId)
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        msg.response = response.response
        msg.responded_at = datetime.utcnow().isoformat()
    return {"status": "ok"}

@app.get("/api/agent/test/{message_id}")
async def get_test_response(message_id: str):
    async with get_session() as session:
        msg = await session.get(TestMessageModel, message_id)
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        return {
            "id": msg.id,
            "text": msg.text,
            "response": msg.response,
            "hasResponse": msg.response is not None,
        }

@app.post("/api/config")
async def configure_repo(config: RepoConfig):
    async with get_session() as session:
        existing = await session.get(RepoConfigModel, config.repo_id)
        if existing:
            existing.github_repo = config.github_repo
            existing.github_token = config.github_token
            existing.firebase_project = config.firebase_project or ""
            existing.firebase_credentials = config.firebase_credentials or ""
            existing.model = config.model or "minimax/MiniMax-M2.5"
        else:
            session.add(RepoConfigModel(
                repo_id=config.repo_id,
                github_repo=config.github_repo,
                github_token=config.github_token,
                firebase_project=config.firebase_project or "",
                firebase_credentials=config.firebase_credentials or "",
                model=config.model or "minimax/MiniMax-M2.5",
            ))
    return {"status": "configured", "repo_id": config.repo_id}

@app.post("/api/config/slack")
async def configure_slack(slack_config: SlackConfig, background_tasks: BackgroundTasks):
    async with get_session() as session:
        result = await session.execute(select(RepoConfigModel))
        first = result.scalars().first()
        if not first:
            first = RepoConfigModel(repo_id="default")
            session.add(first)
        first.slack_app_token = slack_config.slack_app_token
        first.slack_bot_token = slack_config.slack_bot_token
        first.slack_channel_id = slack_config.slack_channel_id

    background_tasks.add_task(_restart_slack_listener)
    return {"status": "configured", "message": "Slack config saved. Listener restarting..."}


def _restart_slack_listener():
    start_slack_listener()


@app.post("/api/config/model")
async def configure_model(model_config: ModelConfig, background_tasks: BackgroundTasks):
    async with get_session() as session:
        result = await session.execute(select(RepoConfigModel))
        first = result.scalars().first()
        if first:
            first.model = model_config.model
            if model_config.api_key:
                first.api_key = model_config.api_key
        else:
            session.add(RepoConfigModel(
                repo_id="default",
                model=model_config.model,
                api_key=model_config.api_key,
            ))

    background_tasks.add_task(restart_agent)
    return {"status": "configured", "model": model_config.model, "agent_restarting": True}

def restart_agent():
    try:
        result = subprocess.run(
            ["docker-compose", "restart", "agent"],
            capture_output=True, text=True, timeout=60, cwd="/app",
        )
        if result.returncode == 0:
            print("Agent restarted successfully")
        else:
            subprocess.run(
                ["docker", "restart", "openfix-agent-1"],
                capture_output=True, timeout=30,
            )
    except Exception as e:
        print(f"Error restarting agent: {e}")

@app.post("/api/agent/restart")
def restart_agent_manual(background_tasks: BackgroundTasks):
    background_tasks.add_task(restart_agent)
    return {"status": "restarting", "message": "Agent is restarting..."}

@app.get("/api/repos")
async def get_repos():
    async with get_session() as session:
        result = await session.execute(select(RepoConfigModel))
        configs = result.scalars().all()
    return {rc.repo_id: config_to_dict(rc) for rc in configs}

@app.get("/api/repos/{repo_id}")
async def get_repo(repo_id: str):
    async with get_session() as session:
        rc = await session.get(RepoConfigModel, repo_id)
        if not rc:
            raise HTTPException(status_code=404, detail="Repository not found")
        return config_to_dict(rc)

@app.post("/api/repos/{repo_id}/download")
async def download_repo(repo_id: str, background_tasks: BackgroundTasks):
    async with get_session() as session:
        rc = await session.get(RepoConfigModel, repo_id)
        if not rc:
            raise HTTPException(status_code=404, detail="Repository not found")
        github_repo = rc.github_repo
        github_token = rc.github_token

    if '/' in github_repo and not github_repo.startswith('http'):
        repo_name = github_repo
    elif 'github.com' in github_repo:
        parts = github_repo.replace('https://github.com/', '').replace('.git', '').split('/')
        repo_name = '/'.join(parts[-2:])
    else:
        repo_name = github_repo

    target_dir = REPOS_DIR / repo_id
    background_tasks.add_task(clone_repository, github_token, repo_name, target_dir)
    return {"status": "downloading", "repo_id": repo_id, "path": str(target_dir)}

def clone_repository(token: str, repo_name: str, target_dir: Path):
    try:
        if target_dir.exists():
            shutil.rmtree(target_dir)
        repo_url = f"https://{token}@github.com/{repo_name}.git"
        result = subprocess.run(
            ["git", "clone", "--depth", "1", repo_url, str(target_dir)],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            print(f"Failed to clone: {result.stderr}")
        else:
            print(f"Successfully cloned {repo_name}")
    except Exception as e:
        print(f"Error cloning repo: {e}")

@app.get("/api/repos/{repo_id}/status")
async def get_repo_status(repo_id: str):
    async with get_session() as session:
        rc = await session.get(RepoConfigModel, repo_id)
        if not rc:
            raise HTTPException(status_code=404, detail="Repository not found")
        github_repo = rc.github_repo

    if '/' in github_repo and not github_repo.startswith('http'):
        repo_name = github_repo
    elif 'github.com' in github_repo:
        parts = github_repo.replace('https://github.com/', '').replace('.git', '').split('/')
        repo_name = '/'.join(parts[-2:])
    else:
        repo_name = github_repo

    target_dir = REPOS_DIR / repo_name
    return {
        "repo_id": repo_id,
        "downloaded": target_dir.exists(),
        "path": str(target_dir),
        "files": len(list(target_dir.rglob('*'))) if target_dir.exists() else 0,
    }

@app.post("/api/webhook/slack")
async def slack_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        body = await request.body()
        body_text = body.decode('utf-8')
        data = json.loads(body_text)

        blocks = data.get('blocks', [])
        crash_title = "New crash from Slack"
        crash_description = ""

        for block in blocks:
            if block.get('type') == 'section':
                text = block.get('section', {}).get('text', {})
                if isinstance(text, dict):
                    crash_description += text.get('text', '') + "\n"

        if data.get('text'):
            crash_title = data.get('text', '')[:100]

        crash_id = f"slack_{datetime.utcnow().timestamp()}"
        now_iso = datetime.utcnow().isoformat()

        async with get_session() as session:
            session.add(Crash(
                id=crash_id,
                title=crash_title,
                description=crash_description,
                timestamp=now_iso,
                severity="ERROR",
                status="pending",
                source="slack",
            ))

        crash_dict = {
            "id": crash_id,
            "title": crash_title,
            "description": crash_description,
            "timestamp": now_iso,
            "severity": "ERROR",
            "status": "pending",
            "source": "slack",
            "prUrl": None,
            "error": None,
        }

        await manager.send_to_agent("new_crash", crash_dict)
        await manager.broadcast_to_frontends("new_crash", crash_dict)
        background_tasks.add_task(trigger_agent, crash_dict)

        return {"status": "received", "source": "slack", "crash_id": crash_id}

    except Exception as e:
        print(f"Slack webhook error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/webhook/firebase")
async def firebase_webhook(payload: CrashPayload, background_tasks: BackgroundTasks):
    crash_data = payload.data
    crash_id = crash_data.get("issueId", f"crash_{datetime.utcnow().timestamp()}")
    now_iso = crash_data.get("timestamp", datetime.utcnow().isoformat())

    async with get_session() as session:
        session.add(Crash(
            id=crash_id,
            title=crash_data.get("issueTitle", "Unknown crash"),
            description=crash_data.get("issueDescription", ""),
            timestamp=now_iso,
            severity=crash_data.get("severity", "ERROR"),
            status="pending",
        ))

    crash_dict = {
        "id": crash_id,
        "title": crash_data.get("issueTitle", "Unknown crash"),
        "description": crash_data.get("issueDescription", ""),
        "timestamp": now_iso,
        "severity": crash_data.get("severity", "ERROR"),
        "status": "pending",
        "prUrl": None,
        "error": None,
    }

    await manager.send_to_agent("new_crash", crash_dict)
    await manager.broadcast_to_frontends("new_crash", crash_dict)
    background_tasks.add_task(trigger_agent, crash_dict)

    return {"status": "received", "crash_id": crash_id}

async def trigger_agent(crash: dict):
    print(f"New crash detected: {crash['id']}")

@app.get("/api/crashes")
async def get_crashes(status: Optional[str] = None):
    async with get_session() as session:
        stmt = select(Crash)
        if status:
            stmt = stmt.where(Crash.status == status)
        result = await session.execute(stmt)
        crashes = [crash_to_dict(c) for c in result.scalars().all()]
    return crashes

@app.get("/api/crashes/{crash_id}")
async def get_crash(crash_id: str):
    async with get_session() as session:
        crash = await session.get(Crash, crash_id)
        if not crash:
            raise HTTPException(status_code=404, detail="Crash not found")
        return crash_to_dict(crash)

@app.patch("/api/crashes/{crash_id}")
async def update_crash(crash_id: str, update: CrashUpdate = Body(...)):
    async with get_session() as session:
        crash = await session.get(Crash, crash_id)
        if not crash:
            raise HTTPException(status_code=404, detail="Crash not found")
        if update.status:
            crash.status = update.status
        if update.prUrl:
            crash.pr_url = update.prUrl
        if update.error:
            crash.error = update.error
        crash.updated_at = datetime.utcnow().isoformat()

    await manager.broadcast_to_frontends("crash_updated", {
        "crashId": crash_id,
        "status": update.status,
        "prUrl": update.prUrl,
        "error": update.error,
    })
    return crash_to_dict(crash)


@app.post("/api/crashes/{crash_id}/process")
async def process_crash(crash_id: str):
    """Send a crash to the agent for processing (manual trigger)."""
    async with get_session() as session:
        crash = await session.get(Crash, crash_id)
        if not crash:
            raise HTTPException(status_code=404, detail="Crash not found")
        # Reset status to pending
        crash.status = "pending"
        crash.error = None
        crash.pr_url = None
        crash.updated_at = datetime.utcnow().isoformat()
        crash_dict = crash_to_dict(crash)

    # Send to agent
    await manager.send_to_agent("new_crash", crash_dict)
    await manager.broadcast_to_frontends("crash_updated", {
        "crashId": crash_id,
        "status": "pending",
        "prUrl": None,
        "error": None,
    })
    return {"status": "sent", "crash_id": crash_id}


@app.post("/api/crashes/sync-bq")
async def sync_bigquery():
    """Fetch new crashes from BigQuery and enrich un-enriched ones."""
    if is_queue_running():
        return {"status": "already_running"}

    # Load Firebase config from DB
    async with get_session() as session:
        result = await session.execute(select(RepoConfigModel))
        rc = result.scalars().first()

    if not rc or not rc.firebase_project or not rc.firebase_credentials:
        raise HTTPException(status_code=400, detail="Firebase config not set")

    # Get app_package/platform from first existing crash with those fields
    app_package = ""
    platform = "ANDROID"
    async with get_session() as session:
        result = await session.execute(
            select(Crash).where(Crash.app_package != "").limit(1)
        )
        sample_crash = result.scalars().first()
        if sample_crash:
            app_package = sample_crash.app_package
            platform = sample_crash.platform or "ANDROID"

    config = {
        "firebase_project": rc.firebase_project,
        "firebase_credentials": rc.firebase_credentials,
        "app_package": app_package,
        "platform": platform,
    }

    import threading

    def _sync_task():
        try:
            # 1. Broadcast: started
            _broadcast_from_thread("bq_sync_started", {"message": "Querying BigQuery..."})

            # 2. Fetch crashes from BQ
            new_crashes = fetch_crashes_from_bq(config)

            # 3. Insert new ones, skip duplicates
            inserted = 0
            for crash_dict in new_crashes:
                future = asyncio.run_coroutine_threadsafe(
                    _insert_crash_if_new(crash_dict), _loop_ref
                )
                try:
                    was_new = future.result(timeout=10)
                    if was_new:
                        inserted += 1
                except Exception as e:
                    _broadcast_from_thread("bq_sync_error", {"error": f"Insert error: {e}"})

            # 4. Broadcast: fetch done with counts
            _broadcast_from_thread("bq_sync_fetched", {
                "total_found": len(new_crashes),
                "new_inserted": inserted,
            })

            # 5. Run enrichment queue
            run_enrichment_queue(config)

        except Exception as e:
            _broadcast_from_thread("bq_sync_error", {"error": f"Sync failed: {e}"})
            _broadcast_from_thread("enrich_queue_done", {"total": 0, "completed": 0})

    thread = threading.Thread(target=_sync_task, daemon=True)
    thread.start()

    return {"status": "syncing"}


@app.get("/api/crashes/sync-bq/status")
async def sync_bigquery_status():
    """Check if a BQ sync is currently running."""
    return {"running": is_queue_running()}


# Event loop reference for background threads (set in lifespan)
_loop_ref = None


async def _insert_crash_if_new(crash_dict: dict) -> bool:
    """Insert a crash into DB if it doesn't already exist. Returns True if inserted."""
    async with get_session() as session:
        existing = await session.get(Crash, crash_dict["id"])
        if existing:
            return False
        session.add(Crash(
            id=crash_dict["id"],
            title=crash_dict.get("title", ""),
            description=crash_dict.get("description", ""),
            timestamp=crash_dict.get("timestamp", ""),
            severity=crash_dict.get("severity", "ERROR"),
            status=crash_dict.get("status", "pending"),
            source=crash_dict.get("source", "bigquery"),
            exception_class=crash_dict.get("exception_class", ""),
            app_package=crash_dict.get("app_package", ""),
            platform=crash_dict.get("platform", ""),
            version=crash_dict.get("version", ""),
            enriched=False,
        ))

    # Broadcast new crash to frontends and send to agent
    broadcast_data = {
        "id": crash_dict["id"],
        "title": crash_dict.get("title", ""),
        "description": crash_dict.get("description", ""),
        "timestamp": crash_dict.get("timestamp", ""),
        "severity": crash_dict.get("severity", "ERROR"),
        "status": crash_dict.get("status", "pending"),
        "source": crash_dict.get("source", "bigquery"),
        "exception_class": crash_dict.get("exception_class", ""),
        "app_package": crash_dict.get("app_package", ""),
        "platform": crash_dict.get("platform", ""),
        "version": crash_dict.get("version", ""),
        "enriched": False,
        "prUrl": None,
        "error": None,
    }
    await manager.broadcast_to_frontends("new_crash", broadcast_data)
    await manager.send_to_agent("new_crash", broadcast_data)
    return True


def _broadcast_from_thread(event: str, data: dict):
    """Broadcast a WS event from a background thread."""
    if _loop_ref:
        async def _do():
            await manager.broadcast_to_frontends(event, data)
        asyncio.run_coroutine_threadsafe(_do(), _loop_ref)


@app.get("/api/agent/config")
async def get_agent_config():
    async with get_session() as session:
        result = await session.execute(select(RepoConfigModel))
        configs = result.scalars().all()
    return {rc.repo_id: config_to_dict(rc) for rc in configs}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
