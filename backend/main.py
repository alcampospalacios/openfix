"""
Openfix Backend API
FastAPI - Lightweight API for receiving Firebase notifications
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Body, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
import time
import uuid
import asyncio

from ws_manager import manager
from slack_listener import set_ws_manager, start_slack_listener

app = FastAPI(title="Openfix API", version="1.0.0")

# Storage directories
DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(exist_ok=True)
REPOS_DIR = Path("/app/repos")
REPOS_DIR.mkdir(exist_ok=True)

CRASHES_FILE = DATA_DIR / "crashes.json"
CONFIG_FILE = DATA_DIR / "config.json"
AGENT_STATUS_FILE = DATA_DIR / "agent_status.json"
TEST_MESSAGES_FILE = DATA_DIR / "test_messages.json"

# Test messages storage
def load_test_messages():
    if TEST_MESSAGES_FILE.exists():
        with open(TEST_MESSAGES_FILE) as f:
            return json.load(f)
    return []

def save_test_messages(messages):
    with open(TEST_MESSAGES_FILE, 'w') as f:
        json.dump(messages, f, indent=2)

# Available models
AVAILABLE_MODELS = [
    {"id": "minimax/MiniMax-M2.5", "name": "MiniMax M2.5", "provider": "minimax"},
    {"id": "openai/gpt-4o", "name": "GPT-4o", "provider": "openai"},
    {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "provider": "anthropic"},
    {"id": "google/gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "google"},
]

# Load/Save helpers
def load_crashes():
    if CRASHES_FILE.exists():
        with open(CRASHES_FILE) as f:
            return json.load(f)
    return []

def save_crashes(crashes):
    with open(CRASHES_FILE, 'w') as f:
        json.dump(crashes, f, indent=2)

def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def load_agent_status():
    if AGENT_STATUS_FILE.exists():
        with open(AGENT_STATUS_FILE) as f:
            return json.load(f)
    return {"status": "offline", "last_seen": None}

def save_agent_status(status_data):
    with open(AGENT_STATUS_FILE, 'w') as f:
        json.dump(status_data, f, indent=2)

# Models
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


@app.on_event("startup")
async def startup_event():
    """Start Slack listener on app startup."""
    loop = asyncio.get_event_loop()
    set_ws_manager(manager, loop)
    start_slack_listener()


@app.get("/")
def root():
    return {"status": "ok", "service": "openfix-api", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/models")
def get_models():
    return {"models": AVAILABLE_MODELS}

# --- WebSocket Endpoints ---

@app.websocket("/ws/frontend")
async def ws_frontend(websocket: WebSocket):
    await manager.connect_frontend(websocket)
    try:
        # Send initial state
        agent_status = load_agent_status()
        if agent_status.get("last_seen"):
            last_seen = datetime.fromisoformat(agent_status["last_seen"])
            now = datetime.utcnow()
            if (now - last_seen).total_seconds() / 60 > 5:
                agent_status["status"] = "offline"

        crashes = load_crashes()
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
                # Save test message
                messages = load_test_messages()
                new_message = {
                    "id": msg_id,
                    "text": data.get("text", ""),
                    "timestamp": datetime.utcnow().isoformat(),
                    "response": None
                }
                messages.append(new_message)
                save_test_messages(messages)
                # Forward to agent via WS
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
    save_agent_status(status_data)
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
                    "last_seen": datetime.utcnow().isoformat()
                }
                save_agent_status(status_data)
                await manager.broadcast_to_frontends("agent_status", status_data)

            elif event == "test_response":
                # Save response to file for HTTP fallback
                messages = load_test_messages()
                for m in messages:
                    if m["id"] == data.get("messageId"):
                        m["response"] = data.get("response")
                        m["responded_at"] = datetime.utcnow().isoformat()
                        break
                save_test_messages(messages)
                # Forward to frontends
                await manager.broadcast_to_frontends("test_response", data)

            elif event == "crash_progress":
                # Forward pipeline progress to all frontends
                await manager.broadcast_to_frontends("crash_progress", data)

            elif event == "crash_update":
                crash_id = data.get("crashId")
                crashes = load_crashes()
                for crash in crashes:
                    if crash["id"] == crash_id:
                        if data.get("status"):
                            crash["status"] = data["status"]
                        if data.get("prUrl"):
                            crash["prUrl"] = data["prUrl"]
                        if data.get("error"):
                            crash["error"] = data["error"]
                        crash["updated_at"] = datetime.utcnow().isoformat()
                        break
                save_crashes(crashes)
                await manager.broadcast_to_frontends("crash_updated", data)

    except WebSocketDisconnect:
        manager.disconnect_agent()
        status_data = {"status": "offline", "last_seen": datetime.utcnow().isoformat()}
        save_agent_status(status_data)
        await manager.broadcast_to_frontends("agent_status", status_data)
    except Exception:
        manager.disconnect_agent()
        status_data = {"status": "offline", "last_seen": datetime.utcnow().isoformat()}
        save_agent_status(status_data)
        await manager.broadcast_to_frontends("agent_status", status_data)


# --- HTTP Endpoints (kept as fallback) ---

@app.post("/api/agent/heartbeat")
def agent_heartbeat(heartbeat: AgentHeartbeat):
    """Agent reports its status"""
    status_data = {
        "status": heartbeat.status,
        "model": heartbeat.model,
        "last_seen": datetime.utcnow().isoformat()
    }
    save_agent_status(status_data)
    return {"status": "ok", "message": "Heartbeat received"}

@app.get("/api/agent/status")
def get_agent_status():
    """Get agent status"""
    status_data = load_agent_status()

    # Check if still alive (last seen < 5 minutes)
    if status_data.get("last_seen"):
        last_seen = datetime.fromisoformat(status_data["last_seen"])
        now = datetime.utcnow()
        minutes_ago = (now - last_seen).total_seconds() / 60

        if minutes_ago > 5:
            status_data["status"] = "offline"

    return status_data

# Test message endpoints
@app.post("/api/agent/test")
def send_test_message(message: TestMessage):
    """Frontend sends a test message to the agent"""
    messages = load_test_messages()

    msg_id = str(uuid.uuid4())[:8]
    new_message = {
        "id": msg_id,
        "text": message.text,
        "timestamp": datetime.utcnow().isoformat(),
        "response": None
    }

    messages.append(new_message)
    save_test_messages(messages)

    return {"status": "sent", "messageId": msg_id, "text": message.text}

@app.get("/api/agent/test-queue")
def get_test_queue():
    """Agent polls for pending test messages"""
    messages = load_test_messages()

    # Return messages without response
    pending = [m for m in messages if m.get("response") is None]
    return pending

@app.post("/api/agent/test-response")
def send_test_response(response: TestResponse):
    """Agent sends a response to a test message"""
    messages = load_test_messages()

    for msg in messages:
        if msg["id"] == response.messageId:
            msg["response"] = response.response
            msg["responded_at"] = datetime.utcnow().isoformat()
            save_test_messages(messages)
            return {"status": "ok"}

    raise HTTPException(status_code=404, detail="Message not found")

@app.get("/api/agent/test/{message_id}")
def get_test_response(message_id: str):
    """Frontend polls for response to a test message"""
    messages = load_test_messages()

    for msg in messages:
        if msg["id"] == message_id:
            return {
                "id": msg["id"],
                "text": msg["text"],
                "response": msg.get("response"),
                "hasResponse": msg.get("response") is not None
            }

    raise HTTPException(status_code=404, detail="Message not found")

@app.post("/api/config")
def configure_repo(config: RepoConfig):
    current = load_config()
    current[config.repo_id] = {
        "github_repo": config.github_repo,
        "github_token": config.github_token,
        "firebase_project": config.firebase_project,
        "firebase_credentials": config.firebase_credentials,
        "model": config.model or "minimax/MiniMax-M2.5"
    }
    save_config(current)
    return {"status": "configured", "repo_id": config.repo_id}

@app.post("/api/config/slack")
def configure_slack(slack_config: SlackConfig, background_tasks: BackgroundTasks):
    """Save Slack config and restart the Slack listener."""
    current = load_config()
    keys = list(current.keys())

    if not keys:
        current["default"] = {}
        keys = ["default"]

    current[keys[0]]["slack_app_token"] = slack_config.slack_app_token
    current[keys[0]]["slack_bot_token"] = slack_config.slack_bot_token
    current[keys[0]]["slack_channel_id"] = slack_config.slack_channel_id
    save_config(current)

    # Restart Slack listener in background
    background_tasks.add_task(_restart_slack_listener)

    return {"status": "configured", "message": "Slack config saved. Listener restarting..."}


def _restart_slack_listener():
    start_slack_listener()


@app.post("/api/config/model")
def configure_model(model_config: ModelConfig, background_tasks: BackgroundTasks):
    current = load_config()

    keys = list(current.keys())
    if keys:
        current[keys[0]]["model"] = model_config.model
        if model_config.api_key:
            current[keys[0]]["api_key"] = model_config.api_key
    else:
        current["default"] = {
            "model": model_config.model,
            "api_key": model_config.api_key
        }

    save_config(current)
    background_tasks.add_task(restart_agent)

    return {"status": "configured", "model": model_config.model, "agent_restarting": True}

def restart_agent():
    try:
        result = subprocess.run(
            ["docker-compose", "restart", "agent"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd="/app"
        )

        if result.returncode == 0:
            print("Agent restarted successfully")
        else:
            subprocess.run(
                ["docker", "restart", "openfix-agent-1"],
                capture_output=True,
                timeout=30
            )

    except Exception as e:
        print(f"Error restarting agent: {e}")

@app.post("/api/agent/restart")
def restart_agent_manual(background_tasks: BackgroundTasks):
    background_tasks.add_task(restart_agent)
    return {"status": "restarting", "message": "Agent is restarting..."}

@app.get("/api/repos")
def get_repos():
    return load_config()

@app.get("/api/repos/{repo_id}")
def get_repo(repo_id: str):
    config = load_config()
    if repo_id not in config:
        raise HTTPException(status_code=404, detail="Repository not found")
    return config[repo_id]

@app.post("/api/repos/{repo_id}/download")
def download_repo(repo_id: str, background_tasks: BackgroundTasks):
    config = load_config()

    if repo_id not in config:
        raise HTTPException(status_code=404, detail="Repository not found")

    repo_config = config[repo_id]
    github_repo = repo_config['github_repo']
    github_token = repo_config['github_token']

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
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode != 0:
            print(f"Failed to clone: {result.stderr}")
        else:
            print(f"Successfully cloned {repo_name}")

    except Exception as e:
        print(f"Error cloning repo: {e}")

@app.get("/api/repos/{repo_id}/status")
def get_repo_status(repo_id: str):
    config = load_config()

    if repo_id not in config:
        raise HTTPException(status_code=404, detail="Repository not found")

    github_repo = config[repo_id]['github_repo']

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
        "files": len(list(target_dir.rglob('*'))) if target_dir.exists() else 0
    }

@app.post("/api/webhook/slack")
async def slack_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive crash alerts from Slack (via Firebase Crashlytics integration)"""
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

        crash = {
            "id": f"slack_{datetime.utcnow().timestamp()}",
            "title": crash_title,
            "description": crash_description,
            "timestamp": datetime.utcnow().isoformat(),
            "severity": "ERROR",
            "status": "pending",
            "source": "slack",
            "prUrl": None,
            "error": None
        }

        crashes = load_crashes()
        crashes.append(crash)
        save_crashes(crashes)

        # Broadcast via WebSocket
        await manager.send_to_agent("new_crash", crash)
        await manager.broadcast_to_frontends("new_crash", crash)

        background_tasks.add_task(trigger_agent, crash)

        return {"status": "received", "source": "slack", "crash_id": crash["id"]}

    except Exception as e:
        print(f"Slack webhook error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/api/webhook/firebase")
async def firebase_webhook(payload: CrashPayload, background_tasks: BackgroundTasks):
    crash_data = payload.data

    crash = {
        "id": crash_data.get("issueId", f"crash_{datetime.utcnow().timestamp()}"),
        "title": crash_data.get("issueTitle", "Unknown crash"),
        "description": crash_data.get("issueDescription", ""),
        "timestamp": crash_data.get("timestamp", datetime.utcnow().isoformat()),
        "severity": crash_data.get("severity", "ERROR"),
        "status": "pending",
        "prUrl": None,
        "error": None
    }

    crashes = load_crashes()
    crashes.append(crash)
    save_crashes(crashes)

    # Broadcast via WebSocket
    await manager.send_to_agent("new_crash", crash)
    await manager.broadcast_to_frontends("new_crash", crash)

    background_tasks.add_task(trigger_agent, crash)

    return {"status": "received", "crash_id": crash["id"]}

async def trigger_agent(crash: dict):
    print(f"New crash detected: {crash['id']}")

@app.get("/api/crashes")
def get_crashes(status: Optional[str] = None):
    crashes = load_crashes()
    if status:
        crashes = [c for c in crashes if c.get("status") == status]
    return crashes

@app.get("/api/crashes/{crash_id}")
def get_crash(crash_id: str):
    crashes = load_crashes()
    for crash in crashes:
        if crash["id"] == crash_id:
            return crash
    raise HTTPException(status_code=404, detail="Crash not found")

@app.patch("/api/crashes/{crash_id}")
async def update_crash(crash_id: str, update: CrashUpdate = Body(...)):
    crashes = load_crashes()

    for crash in crashes:
        if crash["id"] == crash_id:
            if update.status:
                crash["status"] = update.status
            if update.prUrl:
                crash["prUrl"] = update.prUrl
            if update.error:
                crash["error"] = update.error
            crash["updated_at"] = datetime.utcnow().isoformat()
            save_crashes(crashes)
            # Broadcast update to frontends
            await manager.broadcast_to_frontends("crash_updated", {
                "crashId": crash_id,
                "status": crash.get("status"),
                "prUrl": crash.get("prUrl"),
                "error": crash.get("error"),
            })
            return crash

    raise HTTPException(status_code=404, detail="Crash not found")

@app.get("/api/agent/config")
def get_agent_config():
    return load_config()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
