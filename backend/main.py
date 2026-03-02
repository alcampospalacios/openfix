"""
Openfix Backend API
FastAPI - Lightweight API for receiving Firebase notifications
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Body
from pydantic import BaseModel
from typing import Optional, List
import json
import os
from datetime import datetime
from pathlib import Path

app = FastAPI(title="Openfix API", version="1.0.0")

# Storage file
DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(exist_ok=True)
CRASHES_FILE = DATA_DIR / "crashes.json"
CONFIG_FILE = DATA_DIR / "config.json"

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

# Models
class CrashPayload(BaseModel):
    event: str
    data: dict

class RepoConfig(BaseModel):
    repo_id: str
    github_repo: str
    github_token: str
    firebase_project: str
    firebase_credentials: str

class CrashUpdate(BaseModel):
    status: Optional[str] = None
    prUrl: Optional[str] = None
    error: Optional[str] = None

@app.get("/")
def root():
    return {"status": "ok", "service": "openfix-api", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# Configure repository
@app.post("/api/config")
def configure_repo(config: RepoConfig):
    """Save repository configuration"""
    current = load_config()
    current[config.repo_id] = {
        "github_repo": config.github_repo,
        "github_token": config.github_token,
        "firebase_project": config.firebase_project,
        "firebase_credentials": config.firebase_credentials
    }
    save_config(current)
    return {"status": "configured", "repo_id": config.repo_id}

# Get repositories
@app.get("/api/repos")
def get_repos():
    """Get all configured repositories"""
    return load_config()

# Get single repo
@app.get("/api/repos/{repo_id}")
def get_repo(repo_id: str):
    config = load_config()
    if repo_id not in config:
        raise HTTPException(status_code=404, detail="Repository not found")
    return config[repo_id]

# Firebase webhook - receive crash notification
@app.post("/api/webhook/firebase")
async def firebase_webhook(payload: CrashPayload, background_tasks: BackgroundTasks):
    """Receive crash notification from Firebase"""
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
    
    # Trigger OpenClaw agent
    background_tasks.add_task(trigger_agent, crash)
    
    return {"status": "received", "crash_id": crash["id"]}

async def trigger_agent(crash: dict):
    """Notify OpenClaw agent to process the crash"""
    # For now, just log - agent will poll for pending crashes
    print(f"📩 New crash detected: {crash['id']}")

# Get all crashes
@app.get("/api/crashes")
def get_crashes(status: Optional[str] = None):
    """Get all crashes, optionally filtered by status"""
    crashes = load_crashes()
    if status:
        crashes = [c for c in crashes if c.get("status") == status]
    return crashes

# Get specific crash
@app.get("/api/crashes/{crash_id}")
def get_crash(crash_id: str):
    crashes = load_crashes()
    for crash in crashes:
        if crash["id"] == crash_id:
            return crash
    raise HTTPException(status_code=404, detail="Crash not found")

# Update crash status
@app.patch("/api/crashes/{crash_id}")
def update_crash(crash_id: str, update: CrashUpdate = Body(...)):
    """Update crash status (called by agent)"""
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
            return crash
    
    raise HTTPException(status_code=404, detail="Crash not found")

# Get config for agent
@app.get("/api/agent/config")
def get_agent_config():
    """Get configuration for the agent to use"""
    return load_config()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
