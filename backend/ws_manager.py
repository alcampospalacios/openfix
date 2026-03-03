"""
WebSocket Connection Manager for Openfix
Manages frontend and agent WebSocket connections
"""

import json
import asyncio
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.frontend_connections: set[WebSocket] = set()
        self.agent_connection: WebSocket | None = None

    async def connect_frontend(self, websocket: WebSocket):
        await websocket.accept()
        self.frontend_connections.add(websocket)

    def disconnect_frontend(self, websocket: WebSocket):
        self.frontend_connections.discard(websocket)

    async def connect_agent(self, websocket: WebSocket):
        await websocket.accept()
        self.agent_connection = websocket

    def disconnect_agent(self):
        self.agent_connection = None

    async def broadcast_to_frontends(self, event: str, data: dict):
        message = json.dumps({"event": event, "data": data})
        disconnected = set()
        for ws in self.frontend_connections:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.add(ws)
        for ws in disconnected:
            self.frontend_connections.discard(ws)

    async def send_to_agent(self, event: str, data: dict):
        if self.agent_connection:
            try:
                await self.agent_connection.send_text(
                    json.dumps({"event": event, "data": data})
                )
            except Exception:
                self.agent_connection = None


manager = ConnectionManager()
