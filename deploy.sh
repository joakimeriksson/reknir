#!/bin/bash

# Reknir Production Deployment Script
# This script automates the deployment of Reknir with nginx and Cloudflare Tunnel

set -e  # Exit on error

echo "=================================="
echo "Reknir Production Deployment"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
   echo "Please do not run this script as root"
   exit 1
fi

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    echo "Run: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from example..."
    cp .env.prod.example .env

    # Generate secret key
    if command -v openssl &> /dev/null; then
        SECRET_KEY=$(openssl rand -hex 32)
        sed -i "s/CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_KEY/$SECRET_KEY/" .env
        echo "✓ Generated SECRET_KEY"
    fi

    # Generate postgres password
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    sed -i "s/CHANGE_THIS_TO_A_STRONG_PASSWORD/$POSTGRES_PASSWORD/" .env
    echo "✓ Generated POSTGRES_PASSWORD"

    echo ""
    echo "⚠️  IMPORTANT: Edit .env and update:"
    echo "   - APP_URL with your domain"
    echo "   - Topology (COMPOSE_FILE / COMPOSE_PROFILES) - own reverse proxy,"
    echo "     bundled gateway, or gateway + Cloudflare tunnel"
    echo ""
    read -p "Press Enter to edit .env now, or Ctrl+C to cancel..."
    ${EDITOR:-nano} .env
fi

# Create required directories
mkdir -p backups receipts invoices
echo "✓ Created required directories"

# Pull latest code (optional)
read -p "Pull latest code from git? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git pull
    echo "✓ Pulled latest code"
fi

# Build and start services
echo ""
echo "Starting services..."
# Compose file and profiles are selected by COMPOSE_FILE/COMPOSE_PROFILES in .env
docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo ""
echo "Waiting for services to start..."
sleep 10

# Check if services are running
echo ""
echo "Checking services..."
docker compose ps

# Run database migrations
echo ""
echo "Running database migrations..."
docker exec reknir-backend alembic upgrade head || {
    echo "⚠️  Migration failed. Check backend logs:"
    echo "   docker compose logs backend"
}

# Test local endpoints
echo ""
echo "Testing endpoints..."
if curl -s http://localhost/health > /dev/null; then
    echo "✓ Health check OK"
else
    echo "✗ Health check failed"
fi

if curl -s http://localhost/api/docs > /dev/null; then
    echo "✓ API docs accessible"
else
    echo "✗ API docs not accessible"
fi

if curl -s http://localhost/ > /dev/null; then
    echo "✓ Frontend accessible"
else
    echo "✗ Frontend not accessible"
fi

echo ""
echo "=================================="
echo "Deployment Status"
echo "=================================="
echo ""
echo "✓ Services deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Setup Cloudflare Tunnel (see docs/DEPLOYMENT.md)"
echo "2. Configure DNS to point to your tunnel"
echo "3. Access your application at https://your-domain.com"
echo ""
echo "Useful commands:"
echo "  - View logs:    docker compose logs -f"
echo "  - Stop:         docker compose down"
echo "  - Restart:      docker compose restart"
echo "  - Status:       docker compose ps"
echo ""
echo "Full deployment guide: docs/DEPLOYMENT.md"
echo "=================================="
