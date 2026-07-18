# Reknir - Swedish Bookkeeping Software

Modern, self-hosted bookkeeping system for Swedish businesses with full BAS kontoplan support.

## Features

- Swedish BAS 2024 kontoplan
- Double-entry bookkeeping (verifikationer)
- Customer invoices with PDF generation
- Supplier invoices with attachment support
- Employee expense management with receipt uploads
- VAT reporting (momsrapport)
- Balance sheet and income statement
- SIE4 import/export for integration with other accounting software
- AI bookkeeping assistant powered by Ollama (local LLM)
- Multi-user authentication with role-based access
- Backup and restore with calendar-based GUI and CLI support
- PostgreSQL with automatic backups

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Python 3.11+ FastAPI + SQLAlchemy + Pydantic
- **Database**: PostgreSQL 16
- **Deployment**: Docker Compose

## Quick Start (Docker)

```bash
# Clone the repository
git clone <repo-url>
cd reknir

# Start all services
docker compose up -d

# Run database migrations to create tables
docker compose exec backend alembic upgrade head

# Access the application
# Frontend: http://localhost:5173
# API docs: http://localhost:8000/docs

# Follow the onboarding wizard to:
# 1. Create your admin user account
# 2. Create your company
# 3. Set up your fiscal year
# 4. Import BAS kontoplan (optional but recommended)
# 5. Get started with your bookkeeping!
```

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](docs/QUICKSTART.md) | Setup guide for development and production |
| [Deployment](docs/DEPLOYMENT.md) | Production deployment guide |
| [Architecture](docs/ARCHITECTURE.md) | System design and codebase overview |
| [Authentication Setup](docs/AUTH_SETUP.md) | Configure user authentication |
| [Cloudflare Setup](docs/CLOUDFLARE.md) | Cloudflare Tunnel configuration |
| [Invoice Feature](docs/INVOICE_FEATURE.md) | Customer and supplier invoice system |
| [Roadmap](docs/ROADMAP.md) | Feature roadmap and future plans |
| [Contributing](CONTRIBUTING.md) | CI pipeline, code style, and contribution guidelines |

## Development Setup

For local development without Docker:

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Start PostgreSQL (via Docker or locally)
# Set database URL
export DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir"

# Run migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Seeding Data

After creating a company via the onboarding wizard, you can seed it with the Swedish BAS kontoplan and common posting templates (konteringsmallar).

### In Docker (Production)

```bash
# Copy seed files to container (required for production)
docker exec reknir-backend mkdir -p /app/database/seeds
docker cp database/seeds/. reknir-backend:/app/database/seeds/

# Seed BAS kontoplan for company ID 1
docker exec reknir-backend python -m app.cli seed-bas

# Seed posting templates for company ID 1
docker exec reknir-backend python -m app.cli seed-templates

# Or seed everything at once
docker exec reknir-backend python -m app.cli seed-all

# For a different company ID:
docker exec reknir-backend python -m app.cli seed-all 2
```

### Local Development (with pixi)

If you have [pixi](https://pixi.sh) installed, you can run the CLI tools locally:

```bash
# Install dependencies
pixi install

# Run seed commands (requires DATABASE_URL to point to your database)
DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir" pixi run seed-templates
DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir" pixi run seed-bas
DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir" pixi run seed-all
```

## Utility Scripts

| Script | Description |
|--------|-------------|
| `setup-local.sh` | Interactive setup for local development environment |
| `factory-reset.sh` | Reset database with options: quick reset, full reset, or reset with demo data |
| `deploy.sh` | Production deployment script |

## Project Structure

```
reknir/
├── frontend/              # React + TypeScript frontend
│   ├── src/
│   │   ├── components/   # UI components
│   │   │   └── ai/       # AI chat components
│   │   ├── contexts/     # React contexts (auth, company, AI form)
│   │   ├── hooks/        # Custom hooks (useAIChat, etc.)
│   │   ├── pages/        # Page components
│   │   ├── services/     # API clients
│   │   └── types/        # TypeScript types
│   └── package.json
├── backend/              # Python FastAPI backend
│   ├── app/
│   │   ├── models/       # SQLAlchemy models
│   │   ├── routers/      # API endpoints
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Business logic
│   │   └── main.py       # FastAPI app
│   ├── alembic/          # Database migrations
│   └── requirements.txt
├── docs/                 # Documentation
├── backups/              # Database backup storage
├── scripts/              # Utility scripts
├── nginx/                # Nginx reverse proxy config
├── docker-compose.yml    # Development containers
└── docker-compose.prod.yml  # Production containers
```

## Swedish Accounting Compliance

This software follows Swedish accounting standards:
- **Bokföringslagen (BFL)**: 7-year retention, chronological recording, audit trails
- **BAS 2024 Kontoplan**: Standard Swedish chart of accounts
- **SIE4 Format**: Standard export format for accountants

## Backup & Restore

The system includes a complete backup and restore solution with both GUI and CLI support.

### GUI (Settings → Backup)
- Create backups with one click
- Calendar-based backup selector for restore
- Restore from server backups or upload a backup file
- Each backup includes: database, attachments, receipts, and metadata

### CLI
```bash
# Create a backup
docker compose exec backend python -m app.cli backup create

# List available backups
docker compose exec backend python -m app.cli backup list

# Restore from a backup
docker compose exec backend python -m app.cli backup restore <filename>
```

### Automatic Backups
- Configurable scheduled backups via Settings GUI (interval and retention)
- Backups stored in `backups/` directory as `.tar.gz` archives
- Each archive contains SQL dump, uploaded files, and version metadata

## Support

For issues and questions, please open a GitHub issue.

## License

BSD 3-Clause License - see LICENSE file
