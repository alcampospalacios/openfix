"""
Openfix Backend API
FastAPI - Lightweight API for receiving Firebase notifications
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import httpx
import os

app = FastAPI(title="Openfix API", version="1.0.0")

# In-memory storage (replace with database later)
repos_config: dict = {}
crashes: List[dict] = []

class CrashPayload(BaseModel):
    event: str
    data: dict

class RepoConfig(BaseModel):
    repo_id: str
    github_repo: str
    firebase_project: str
    firebase_credentials: str

@app.get("/")
def root():
    return {"status": "ok", "service": "openfix-api"}

@app.get("/health")
def health():
    return {"status": "healthy"}

# Configure repository
@app.post("/api/config")
def configure_repo(config: RepoConfig):
    repos_config[config.repo_id] = {
        "github_repo": config.github_repo,
        "firebase_project": config.firebase_project,
        "firebase_credentials": config.firebase_credentials
    }
    return {"status": "configured", "repo_id": config.repo_id}

# Get repositories
@app.get("/api/repos")
def get_repos():
    return repos_config

# Firebase webhook - receive crash notification
@app.post("/api/webhook/firebase")
async def firebase_webhook(payload: CrashPayload, background_tasks: BackgroundTasks):
    """
    Receive crash notification from Firebase
    """
    crash_data = payload.data
    
    crash = {
        "id": crash_data.get("issueId", "unknown"),
        "title": crash_data.get("issueTitle", "Unknown crash"),
        "description": crash_data.get("issueDescription", ""),
        "timestamp": crash_data.get("timestamp"),
        "severity": crash_data.get("severity", "ERROR"),
        "status": "pending"
    }
    
    crashes.append(crash)
    
    # Trigger OpenClaw agent
    background_tasks.add_task(trigger_agent, crash)
    
    return {"status": "received", "crash_id": crash["id"]}

async def trigger_agent(crash: dict):
    """
    Notify OpenClaw agent to process the crash
    """
    # Call OpenClaw agent endpoint
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "http://localhost:18789/api/agent/trigger",
                json={"crash": crash}
            )
    except Exception as e:
        print(f"Failed to trigger agent: {e}")

# Get crashes
@app.get("/api/crashes")
def get_crashes(status: Optional[str] = None):
    if status:
        return [c for c in crashes if c.get("status") == status]
    return crashes

# Get specific crash
@app.get("/api/crashes/{crash_id}")
def get_crash(crash_id: str):
    for crash in crashes:
        if crash["id"] == crash_id:
            return crash
    raise HTTPException(status_code=404, detail="Crash not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
