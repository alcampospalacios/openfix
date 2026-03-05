FROM python:3.11-slim

WORKDIR /app

RUN mkdir -p /app/data && chmod 777 /app/data

RUN pip install --no-cache-dir \
    fastapi uvicorn httpx pydantic websockets \
    slack-sdk google-cloud-bigquery \
    "sqlalchemy[asyncio]" asyncpg

COPY main.py ws_manager.py slack_listener.py crashlytics_enricher.py db.py migrate_json_to_db.py ./

EXPOSE 3000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
