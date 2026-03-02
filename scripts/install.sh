#!/bin/bash
set -e

echo "🚀 Openfix Installation"
echo "======================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root: sudo ./install.sh${NC}"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${GREEN}📁 Project: $PROJECT_DIR${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | bash
    systemctl start docker
    systemctl enable docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installing docker-compose...${NC}"
    apt-get update && apt-get install -y docker-compose-plugin
fi

echo -e "${GREEN}✅ Docker ready${NC}"

# Create required directories
mkdir -p docker/data docker/repos

# Create empty config if not exists
if [ ! -f config/env.example ]; then
    echo -e "${YELLOW}Creating config...${NC}"
    mkdir -p config
fi

# Build and start
echo -e "${BLUE}🔨 Building containers...${NC}"
docker-compose build

echo -e "${BLUE}▶️  Starting Openfix...${NC}"
docker-compose up -d

echo -e "${BLUE}⏳ Waiting for services...${NC}"
sleep 15

echo ""
echo -e "${GREEN}✅ Openfix is running!${NC}"
echo ""
echo "  📱 Frontend:   http://localhost:4200"
echo "  🔌 Backend:   http://localhost:3000"
echo ""
echo "Next steps:"
echo "  1. Open http://localhost:4200"
echo "  2. Go to Config tab"
echo "  3. Add your GitHub repo and token"
echo "  4. Download repository"
echo ""
echo "Useful commands:"
echo "  docker-compose logs -f      # View logs"
echo "  docker-compose restart      # Restart"
echo "  docker-compose down        # Stop"
echo ""
