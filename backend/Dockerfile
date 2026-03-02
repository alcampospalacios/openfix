FROM python:3.11-slim

WORKDIR /app

RUN mkdir -p /app/data && chmod 777 /app/data

RUN pip install --no-cache-dir fastapi uvicorn httpx pydantic

COPY main.py .

EXPOSE 3000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
