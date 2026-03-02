#!/bin/bash
set -e

echo "🚀 Installing Openfix..."

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker is not installed. Installing...${NC}"
    curl -fsSL https://get.docker.com | bash
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installing docker-compose...${NC}"
    apt-get update && apt-get install -y docker-compose
fi

# Clone or use current directory
if [ -d ".git" ]; then
    echo "Using existing Openfix installation..."
else
    echo "Cloning Openfix..."
    git clone https://github.com/alcampospalacios/openfix.git
    cd openfix
fi

# Copy environment template
if [ ! -f .env ]; then
    cp config/env.example .env
    echo -e "${YELLOW}Please edit .env file with your configuration${NC}"
fi

# Build and start
echo -e "${GREEN}Building containers...${NC}"
docker-compose build

echo -e "${GREEN}Starting Openfix...${NC}"
docker-compose up -d

echo ""
echo -e "${GREEN}✅ Openfix is running!${NC}"
echo ""
echo "  Frontend:  http://localhost:4200"
echo "  Backend:   http://localhost:3000"
echo ""
echo "Run 'openfix status' to check services"
