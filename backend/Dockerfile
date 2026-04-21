# syntax=docker/dockerfile:1.6

# ----- frontend build stage -----
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* frontend/pnpm-lock.yaml* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ----- backend runtime stage -----
FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DBT_UI_FRONTEND_DIST=/app/frontend_dist \
    DBT_UI_WORKSPACE=/workspace \
    DBT_UI_DATA_DIR=/data

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml ./backend/pyproject.toml
RUN pip install --upgrade pip \
 && pip install \
        "fastapi>=0.115.0" \
        "uvicorn[standard]>=0.32.0" \
        "pydantic>=2.9.0" \
        "pydantic-settings>=2.6.0" \
        "sqlalchemy[asyncio]>=2.0.36" \
        "aiosqlite>=0.20.0" \
        "sse-starlette>=2.1.3" \
        "watchfiles>=0.24.0" \
        "dbt-artifacts-parser>=0.8.1" \
        "pyyaml>=6.0.2" \
        "ptyprocess>=0.7.0" \
        "structlog>=24.4.0" \
        "python-multipart>=0.0.12" \
        "dbt-core>=1.8.0"

COPY backend/ ./backend/
COPY --from=frontend-build /frontend/dist /app/frontend_dist

WORKDIR /app/backend
RUN mkdir -p /data /workspace

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
