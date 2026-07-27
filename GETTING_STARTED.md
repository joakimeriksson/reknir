# Getting Started with Reknir

This guide will help you get Reknir up and running for the first time.

## Prerequisites

- **Docker & Docker Compose** (recommended for easy setup)
  - [Install Docker](https://docs.docker.com/get-docker/)
  - Docker Compose comes with Docker Desktop

OR for local development:
- **Python 3.11+** for backend
- **Node.js 18+** for frontend
- **PostgreSQL 16** for database

## Quick Start with Docker (Recommended)

### 1. Start the Services

```bash
# Clone the repository (if not already done)
cd reknir

# Create your env file (selects the dev stack via COMPOSE_FILE)
cp .env.dev.example .env

# Start all services (database, backend, frontend)
docker compose up -d

# Check that services are running
docker compose ps
```

This will start:
- PostgreSQL database on port 5432
- FastAPI backend on port 8000
- React frontend on port 5173

### 2. Initialize the Database

```bash
# Run database migrations
docker compose exec backend alembic upgrade head

# Verify migration succeeded
docker compose logs backend
```

### 3. Create Your First Company

Open your browser and go to http://localhost:5173

You'll be greeted by the **Onboarding Wizard**:

#### Step 1: Admin User
- Create your admin account
- Enter email, name, and password
- This will be the first user with full access

#### Step 2: Company Information
- Enter company name
- Enter organization number (Swedish org.nr format: XXXXXX-XXXX)
- Enter VAT number (optional)
- Enter address and contact details
- Select accounting basis (accrual or cash)
- Select VAT reporting period (monthly, quarterly, yearly)

#### Step 3: Fiscal Year
- Enter start and end date for your fiscal year
- The system suggests current calendar year by default
- Must be approximately 12 months

#### Step 4: Chart of Accounts
Choose one option:
- **"Yes, create chart of accounts"** (Recommended)
  - Imports BAS 2024 kontoplan
  - Initializes default accounts
  - Creates standard posting templates
- **"No, skip"**
  - Start with empty chart
  - Import BAS later via Settings

#### Step 5: Confirmation
- Review your setup
- System will redirect to dashboard when complete

### 4. Verify Setup

You should now see:
- Your company information in the dashboard
- Fiscal year selector in the sidebar
- Chart of accounts (if you imported BAS)
- Empty transaction lists (ready for your first entries!)

You can also check the API documentation at http://localhost:8000/docs

## Setting Up Posting Templates (Konteringsmallar)

Posting Templates allow you to create reusable transaction templates for common business operations. This speeds up data entry significantly.

### Template Formula System

- Use `{total}` as the base amount variable
- Formulas support basic math: `{total} * 0.25` for VAT calculation
- Positive values = debit, negative values = credit
- Each line has a sort_order for display consistency

### Managing Templates via UI

Visit http://localhost:5173/settings to:
- Create new posting templates
- Edit existing templates with drag-and-drop formula builders
- Reorder templates by dragging (changes are saved automatically)
- Delete unused templates

## Creating Your First Transaction (Verifikation)

Here's an example of creating a simple transaction:

```bash
# Example: Purchase office supplies for 1,250 SEK (1,000 + 250 VAT)
curl -X POST http://localhost:8000/api/verifications/ \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": 1,
    "series": "A",
    "transaction_date": "2024-11-09",
    "description": "Inköp kontorsmaterial",
    "transaction_lines": [
      {
        "account_id": 23,
        "debit": 1000,
        "credit": 0,
        "description": "Kontorsmaterial"
      },
      {
        "account_id": 16,
        "debit": 250,
        "credit": 0,
        "description": "Ingående moms 25%"
      },
      {
        "account_id": 12,
        "debit": 0,
        "credit": 1250,
        "description": "Leverantörsskuld"
      }
    ]
  }'
```

Note: `account_id` should match the IDs from your imported accounts. You can list accounts with:

```bash
curl http://localhost:8000/api/accounts/?company_id=1
```

## Viewing Reports

```bash
# Balance sheet (Balansräkning)
curl http://localhost:8000/api/reports/balance-sheet?company_id=1

# Income statement (Resultaträkning)
curl http://localhost:8000/api/reports/income-statement?company_id=1
```

## Development Mode

If you want to develop and make changes:

### Backend Development

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set database URL
export DATABASE_URL="postgresql://reknir:reknir@localhost:5432/reknir"

# Run migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --port 8000
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes database!)
docker compose down -v
```

## Backup Your Data

```bash
# Manual backup
docker compose exec postgres pg_dump -U reknir reknir > backup_$(date +%Y%m%d).sql

# Restore from backup
docker compose exec -T postgres psql -U reknir reknir < backup_20241109.sql
```

## Factory Reset

If you need to start fresh or want to load demo data:

```bash
# Run the factory reset script
./factory-reset.sh
```

Options:
1. **Quick reset** - Clears database, reuses Docker images
2. **Full factory reset** - Rebuilds everything from scratch
3. **Quick reset with demo data** - Includes sample customers, invoices, and transactions for testing

## Next Steps

- Explore the API documentation at http://localhost:8000/docs
- Check [docs/ROADMAP.md](docs/ROADMAP.md) for planned features
- Review [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design
- Use posting templates to speed up common transactions
- Set up automatic backups for production use

## Troubleshooting

### Database connection issues
```bash
# Check if PostgreSQL is running
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres
```

### Backend not starting
```bash
# Check backend logs
docker compose logs backend

# Common issue: Database not ready
# Solution: Wait a few seconds and try again
docker compose restart backend
```

### Frontend not loading
```bash
# Check frontend logs
docker compose logs frontend

# Rebuild frontend if needed
docker compose up -d --build frontend
```

## Support

For issues or questions:
- Check the [README.md](README.md) for overview
- Review [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical details
- Check [docs/ROADMAP.md](docs/ROADMAP.md) for planned features
- Open a GitHub issue
