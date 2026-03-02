# Openfix

Self-hosted autonomous bug-fixing agent powered by OpenClaw.

## What is Openfix?

Openfix is an automated system that:
1. Monitors Firebase Crashlytics for new crashes
2. Analyzes the error
3. Creates a fix branch
4. Applies the fix using AI
5. Notifies you via push

## Quick Start

```bash
# Install
curl -fsSL https://get.openfix.io | bash

# Or clone directly
git clone https://github.com/alcampospalacios/openfix.git
cd openfix

# Configure
cp config/env.example .env
# Edit .env with your settings

# Run
docker-compose upd
```

## - Features

- 🔍 Firebase Crashlytics integration
- 🤖 AI-powered bug fixing with OpenClaw
- 📊 Dashboard for monitoring
- 🔧 Clean Architecture
- 🐳 Docker-based deployment

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Firebase   │────▶│   OpenClaw  │────▶│   GitHub    │
│ Crashlytics │     │   Agent     │     │   (Fix PR)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       └───────────────────┘
              │
              ▼
       ┌─────────────┐
       │   Angular   │
       │   Dashboard │
       └─────────────┘
```

## Configuration

See `config/env.example` for all available options.

## License

MIT
