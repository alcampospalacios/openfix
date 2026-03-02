# Openfix 🤖

Self-hosted autonomous bug-fixing agent powered by OpenClaw.

## What is Openfix?

Openfix is an automated system that:
1. 🔍 Monitors Firebase Crashlytics for new crashes
2. 📊 Analyzes the error
3. 🌿 Creates a fix branch automatically
4. 🔧 Applies the fix using AI
5. 📝 Creates a Pull Request for review
6. 🔔 Notifies you via dashboard

## Quick Start

```bash
# Clone the repository
git clone https://github.com/alcampospalacios/openfix.git
cd openfix

# Run the installer
sudo ./scripts/install.sh
```

## Manual Setup

```bash
# Start all services
docker-compose up -d

# Or build first
docker-compose build
docker-compose up -d
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Frontend | http://localhost:4200 | Angular Dashboard |
| Backend | http://localhost:3000 | FastAPI Server |

## Configuration

1. Open http://localhost:4200
2. Go to **Config** tab
3. Enter your GitHub repository URL and token
4. Enter your Firebase project details
5. Copy the webhook URL

### Firebase Webhook Setup

In Firebase Console:
1. Go to Crashlytics → Settings
2. Add webhook URL: `http://YOUR_IP:3000/api/webhook/firebase`

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Firebase   │────▶│   Backend   │────▶│   GitHub    │
│ Crashlytics │     │  (FastAPI)  │     │   (PR)      │
└─────────────┘     └──────┬──────┘     └─────────────┘
                            │
                     ┌──────▼──────┐
                     │    Agent    │
                     │   (Node.js) │
                     └─────────────┘
                            │
                     ┌──────▼──────┐
                     │   Angular   │
                     │  Dashboard  │
                     └─────────────┘
```

## Development

```bash
# Backend
cd backend
python main.py

# Frontend
cd frontend
npm install
npm start
```

## Tech Stack

- **Frontend**: Angular 21 + TailwindCSS
- **Backend**: FastAPI (Python)
- **Agent**: Node.js
- **Database**: File-based JSON (production: add PostgreSQL)

## License

MIT
