# Reknir - Quick Start Guide

Complete guide for setting up Reknir for development and production.

## Development Setup

### Prerequisites

- **Docker & Docker Compose** - [Install Docker](https://docs.docker.com/get-docker/)

### 1. Start Services

```bash
git clone <repo-url>
cd reknir

# Create your env file (selects the dev stack via COMPOSE_FILE)
cp .env.dev.example .env

# Start all services (database, backend, frontend)
docker compose up -d

# Verify services are running
docker compose ps
```

This starts:
- PostgreSQL database on port 5432
- FastAPI backend on port 8000
- React frontend on port 5173

### 2. Initialize Database

```bash
# Run migrations (usually automatic, but run manually if needed)
docker compose exec backend alembic upgrade head

# Import BAS 2024 kontoplan
docker compose exec backend python -m app.cli seed-bas
```

### 3. Access the Application

- **Frontend**: http://localhost:5173
- **API Docs**: http://localhost:8000/docs

### 4. Stop Services

```bash
# Stop all services
docker compose down

# Stop and delete data (WARNING: removes database!)
docker compose down -v
```

---

## Development Without Docker

For local development with hot-reload:

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Database (start PostgreSQL via Docker or locally)
export DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir"
alembic upgrade head

# Start with hot-reload
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Production Deployment

For detailed production setup with HTTPS and Cloudflare Tunnel, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Quick Production Start

```bash
# 1. Create production env file (selects the prod stack via COMPOSE_FILE)
cp .env.prod.example .env
nano .env   # set POSTGRES_PASSWORD, SECRET_KEY, APP_URL

# 2. Deploy
docker compose up -d --build

# 3. Verify
docker compose logs -f
```

---

## Operations Reference

### Check Status

```bash
# Development
docker compose ps
docker compose logs -f

# Production
docker compose ps
docker compose logs -f backend
```

### Restart Services

```bash
# Development
docker compose restart

# Production
docker compose restart
docker compose restart backend  # specific service
```

### Database Migrations

```bash
# Development
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current  # check version

# Production
docker compose exec backend alembic upgrade head
```

---

## Backups

Backups are managed via **Settings → Import/Export** in the GUI, or via CLI:

```bash
# Create backup
docker compose exec backend python -m app.cli backup create

# List backups
docker compose exec backend python -m app.cli backup list

# Restore from backup
docker compose exec backend python -m app.cli backup restore <filename>
```

Automatic scheduled backups can be configured in the GUI.

---

## Troubleshooting

### Database Connection Issues

```bash
docker compose ps postgres
docker compose logs postgres
docker compose restart backend  # if database wasn't ready
```

### Backend Not Starting

```bash
docker compose logs backend
# Common: database not ready - wait and restart
docker compose restart backend
```

### Frontend Not Loading

```bash
docker compose logs frontend
docker compose up -d --build frontend  # rebuild if needed
```

### Production: Cloudflare Tunnel Issues

```bash
docker compose logs cloudflared
# Should see: "Connection <UUID> registered"
# If not: check COMPOSE_PROFILES=tunnel and TUNNEL_TOKEN in .env
```

### Production: 502 Bad Gateway

```bash
docker compose ps backend
docker compose logs backend
```

---

## Useful Commands

### Database Shell

```bash
# Development
docker compose exec postgres psql -U reknir -d reknir

# Production
docker compose exec postgres psql -U reknir -d reknir
```

### Backend Shell

```bash
# Development
docker compose exec backend bash

# Production
docker compose exec backend bash
```

### Update Application

```bash
git pull
docker compose up -d --build   # stack selected by COMPOSE_FILE in .env
```

---

## Running Tests

All tests run in Docker - no local Python/Node setup needed.

```bash
# Backend: lint
docker compose exec backend ruff check .

# Backend: format check
docker compose exec backend ruff format --check .

# Backend: run tests
docker compose exec backend pytest -v

# Frontend: lint
docker compose exec frontend npm run lint

# Frontend: type check
docker compose exec frontend npx tsc --noEmit
```

Or rebuild and run tests in a fresh container:

```bash
docker compose build backend
docker compose run --rm backend pytest -v
```

---

## More Documentation

- [README.md](../README.md) - Project overview
- [DEPLOYMENT.md](DEPLOYMENT.md) - Detailed production deployment
- [ARCHITECTURE.md](ARCHITECTURE.md) - System design
- [AUTH_SETUP.md](AUTH_SETUP.md) - Authentication configuration
- [CLAUDE.md](CLAUDE.md) - Codebase reference
