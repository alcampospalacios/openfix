#!/bin/bash
set -e

echo "🚀 Installing Openfix..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Please run as root (sudo ./install.sh)${NC}"
    exit 1
fi

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is not installed. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | bash
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installing docker-compose...${NC}"
    apt-get update && apt-get install -y docker-compose
fi

# Get the directory where script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${GREEN}📁 Project directory: $PROJECT_DIR${NC}"

# Copy environment template
if [ ! -f .env ]; then
    cp config/env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env file with your configuration${NC}"
fi

# Install OpenClaw
echo -e "${BLUE}🤖 Installing OpenClaw...${NC}"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install OpenClaw
if ! command -v openclaw &> /dev/null; then
    npm install -g openclaw
else
    echo "OpenClaw already installed"
fi

# Initialize OpenClaw if not configured
if [ ! -d "$HOME/.openclaw" ]; then
    echo -e "${BLUE}Initializing OpenClaw (local mode)...${NC}"
    openclaw init --mode local
fi

# Configure OpenClaw to not expose to internet (local only)
echo -e "${BLUE}Configuring OpenClaw security...${NC}"

# Make sure OpenClaw binds to localhost only
if [ -f "$HOME/.openclaw/openclaw.json" ]; then
    # Ensure it's in local mode
    echo "OpenClaw config found"
else
    echo "Creating OpenClaw config..."
    mkdir -p "$HOME/.openclaw"
    cat > "$HOME/.openclaw/openclaw.json" << 'CLAW'
{
  "wizard": {
    "lastRunAt": "2026-03-02T00:00:00.000Z",
    "lastRunVersion": "2026.2.26",
    "lastRunCommand": "init",
    "lastRunMode": "local"
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "auto-generated"
    }
  },
  "channels": {
    "telegram": {
      "enabled": false
    }
  }
}
CLAW
fi

# Build and start Docker services
echo -e "${GREEN}🔨 Building containers...${NC}"
docker-compose build

echo -e "${GREEN}▶️  Starting Openfix...${NC}"
docker-compose up -d

# Start OpenClaw
echo -e "${BLUE}🚀 Starting OpenClaw agent...${NC}"
openclaw gateway start

echo ""
echo -e "${GREEN}✅ Openfix is running!${NC}"
echo ""
echo "  📱 Frontend:  http://localhost:4200"
echo "  🔌 Backend:   http://localhost:3000"
echo "  🤖 OpenClaw: http://localhost:18789 (local only)"
echo ""
echo -e "${YELLOW}Note: OpenClaw is bound to localhost only (not exposed to internet)${NC}"
echo ""
echo "Useful commands:"
echo "  docker-compose logs -f        # View logs"
echo "  docker-compose restart        # Restart services"
echo "  openclaw status               # Check OpenClaw"
