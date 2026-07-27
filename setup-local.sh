#!/bin/bash

# Reknir Local Development Setup Script
# This script creates a .env file for local development

set -e

echo "========================================="
echo "  Reknir Local Development Setup"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env already exists
if [ -f .env ]; then
    echo -e "${YELLOW}Warning: .env file already exists!${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled. Your existing .env file was not modified."
        exit 0
    fi
    # Backup existing .env
    BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
    cp .env "$BACKUP_FILE"
    echo -e "${GREEN}Backed up existing .env to $BACKUP_FILE${NC}"
fi

echo ""
echo "This script will create a .env file for local development."
echo ""

# Detect host IP for network access
HOST_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "localhost")

# Ask for setup type
echo "Choose your setup type:"
echo "  1) Local only (localhost) - Default"
echo "  2) Network accessible (${HOST_IP})"
echo ""
read -p "Enter choice [1-2] (default: 1): " SETUP_TYPE
SETUP_TYPE=${SETUP_TYPE:-1}

# Generate random secret key
SECRET_KEY=$(openssl rand -hex 32)

# Set default values based on setup type
if [ "$SETUP_TYPE" == "2" ]; then
    CORS_ORIGINS="http://${HOST_IP}:5173,http://localhost:5173,http://localhost:3000"
    VITE_API_URL="http://${HOST_IP}:8000/api"
    echo ""
    echo -e "${GREEN}Network setup selected${NC}"
    echo "Your Reknir instance will be accessible from other devices on your network."
    echo "Access URL: http://${HOST_IP}:5173"
else
    CORS_ORIGINS="http://localhost:5173,http://localhost:3000"
    VITE_API_URL="http://localhost:8000/api"
    echo ""
    echo -e "${GREEN}Local setup selected${NC}"
    echo "Your Reknir instance will only be accessible from this machine."
fi

# Database configuration
echo ""
echo "Database Configuration:"
echo "  User: reknir"
echo "  Password: reknir (local development only)"
echo "  Database: reknir"
echo "  Port: 5432"

# Create .env file
echo ""
echo "Creating .env file..."

cat > .env << EOF
# ========================================
# REKNIR LOCAL DEVELOPMENT CONFIGURATION
# ========================================
# Generated on $(date)
# Setup type: $([ "$SETUP_TYPE" == "2" ] && echo "Network accessible" || echo "Local only")
#

# ========================================
# Database Configuration
# ========================================
DATABASE_URL=postgresql://reknir:reknir@localhost:5432/reknir

# PostgreSQL credentials (for docker-compose)
POSTGRES_USER=reknir
POSTGRES_PASSWORD=reknir
POSTGRES_DB=reknir

# ========================================
# Backend Configuration
# ========================================
# Random secret key for session management
SECRET_KEY=${SECRET_KEY}

# Debug mode (enabled for development)
DEBUG=True

# ========================================
# CORS Configuration
# ========================================
# Allowed origins for API requests
CORS_ORIGINS=${CORS_ORIGINS}

# ========================================
# Frontend Configuration
# ========================================
# API endpoint for frontend
VITE_API_URL=${VITE_API_URL}

# ========================================
# Development Notes
# ========================================
# - Database credentials are simple for local development
# - Don't use these settings in production!
# - For production setup, see .env.prod.example
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:8000
# - API Docs: http://localhost:8000/docs
# - Database: localhost:5432
EOF

echo -e "${GREEN}✓ .env file created successfully!${NC}"
echo ""
echo "========================================="
echo "  Configuration Summary"
echo "========================================="
echo ""
echo "Frontend URL:    ${VITE_API_URL/8000/5173}"
echo "Backend API:     ${VITE_API_URL}"
echo "API Docs:        ${VITE_API_URL}/docs"
echo "Database:        localhost:5432"
echo ""

if [ "$SETUP_TYPE" == "2" ]; then
    echo -e "${YELLOW}Network Access:${NC}"
    echo "  Other devices can access Reknir at:"
    echo "  http://${HOST_IP}:5173"
    echo ""
    echo "  Make sure your firewall allows connections on ports 5173 and 8000"
    echo ""
fi

echo "========================================="
echo "  Next Steps"
echo "========================================="
echo ""
echo "1. Start the services:"
echo "   ${GREEN}cp .env.dev.example .env${NC}  (first time only)"
echo "   ${GREEN}docker compose up -d${NC}"
echo ""
echo "2. Wait for services to be ready (about 30 seconds)"
echo ""
echo "3. Access Reknir:"
echo "   Frontend: ${GREEN}${VITE_API_URL/8000/5173}${NC}"
echo "   API Docs: ${GREEN}${VITE_API_URL}/docs${NC}"
echo ""
echo "4. View logs:"
echo "   ${GREEN}docker compose logs -f${NC}"
echo ""
echo "5. Stop services:"
echo "   ${GREEN}docker compose down${NC}"
echo ""
echo "For help, see README.md or docs/QUICKSTART.md"
echo ""
