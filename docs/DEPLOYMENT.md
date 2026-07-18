# Reknir Production Deployment Guide

Complete guide for deploying Reknir to production with Cloudflare Tunnel and nginx.

## Architecture

```
Internet → Cloudflare Tunnel → nginx (port 80) → {
    /api/* → Backend (FastAPI on port 8000)
    /*     → Frontend (Vite on port 5173)
}
```

**Single hostname setup**: All traffic goes through one domain (e.g., `reknir.yourdomain.com`)

## Prerequisites

- Ubuntu 24.04 LTS server (VM or bare metal)
- Domain managed by Cloudflare
- Minimum 4GB RAM, 2 CPU cores, 32GB disk

## Step 1: Prepare Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Install useful tools
sudo apt install htop ncdu curl wget -y
```

## Step 2: Clone Repository

```bash
cd ~
git clone https://github.com/joakimeriksson/reknir.git
cd reknir

# Checkout your branch (or use main)
git checkout claude/multi-user-admin-setup-011CV5Th44NuvaSjAxfG9EVP
```

## Step 3: Configure Environment

```bash
# Create production environment file
cp .env.prod.example .env

# Edit with your values
nano .env
```

**Required changes in `.env`:**
- `POSTGRES_PASSWORD`: Strong password for database
- `SECRET_KEY`: Generate with `openssl rand -hex 32`
- `APP_URL`: Your public URL (e.g., `https://reknir.yourdomain.com`) -
  CORS is derived from it automatically
- Cloudflare Tunnel: see Step 4

## Step 4: Setup Cloudflare Tunnel (optional)

The tunnel runs as a container in the stack and connects outbound to
Cloudflare - no inbound ports needed, nothing to install on the host.
If you skip it, point your DNS or reverse proxy at `http://<server>:NGINX_PORT`
instead.

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/):
   **Networks** → **Tunnels** → **Create a tunnel**, name it `reknir-prod`,
   and copy the tunnel token (starts with `eyJ...`)
2. Add a **Public Hostname**: your domain → Type `HTTP`, URL `nginx:80`
3. Enable it by uncommenting in `.env`:

   ```
   COMPOSE_PROFILES=tunnel
   TUNNEL_TOKEN=eyJ...
   ```

## Step 5: Start Services

```bash
cd ~/reknir

# Start production stack (compose file and profiles come from .env)
docker compose up -d

# Check all containers are running
docker compose ps

# You should see:
# - reknir-db          (postgres)
# - reknir-backend     (fastapi)
# - reknir-frontend    (static frontend served by nginx)
# - reknir-nginx       (nginx gateway)
# - reknir-cloudflared (cloudflare tunnel)
```

## Step 6: Initialize Database

```bash
# Run migrations
docker exec reknir-backend alembic upgrade head

# Verify database
docker exec reknir-db psql -U reknir -d reknir -c "SELECT count(*) FROM alembic_version;"
```

## Step 7: Verify Deployment

```bash
# Check tunnel is connected (should show "Connection <UUID> registered")
docker compose logs cloudflared

# Check local services
curl http://localhost/health          # Should return "healthy"
curl http://localhost/api/docs        # Should return HTML
curl http://localhost/                # Should return HTML

# Check containers
docker compose logs --tail=50

# Monitor resources
docker stats
```

## Step 8: Access Application

Visit your domain: `https://reknir.yourdomain.com`

- **Frontend**: `https://reknir.yourdomain.com/`
- **API Docs**: `https://reknir.yourdomain.com/docs`
- **Health Check**: `https://reknir.yourdomain.com/health`

## Post-Deployment

### Setup Automated Backups

Automatic backups are configured via **Settings → Import/Export → Automatisk backup**. Options include backup interval (6h to 14 days) and maximum number of backups to retain.

Manual backups can also be created via CLI:

```bash
docker compose exec backend python -m app.cli backup create
```

### Monitoring

```bash
# Watch logs in real-time
docker compose logs -f

# Check specific service
docker compose logs -f backend
docker compose logs -f nginx

# Check resource usage
docker stats
htop

# Check disk usage
df -h
du -sh ~/reknir/*
```

### Updates

```bash
cd ~/reknir

# Pull latest code
git pull

# Rebuild and restart
docker compose down
docker compose build --no-cache
docker compose up -d

# Run migrations
docker exec reknir-backend alembic upgrade head
```

## Security

### Firewall Setup

```bash
# Enable firewall (only SSH needed - cloudflared uses outbound only)
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status
```

### SSH Hardening

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Recommended settings:
# PermitRootLogin no
# PasswordAuthentication no  (if using SSH keys)
# Port 22  (or change to non-standard port)

# Restart SSH
sudo systemctl restart sshd
```

### Regular Updates

```bash
# Create update script
cat > ~/update-system.sh << 'EOF'
#!/bin/bash
echo "=== System Update $(date) ==="
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y

echo "=== Docker Update ==="
cd ~/reknir
docker compose pull
docker compose up -d

echo "=== Cleanup ==="
docker system prune -f

echo "=== Done ==="
EOF

chmod +x ~/update-system.sh

# Schedule weekly updates (optional)
# crontab -e
# Add: 0 3 * * 0 /home/user/update-system.sh >> /home/user/update.log 2>&1
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs

# Check specific service
docker compose logs backend

# Restart specific service
docker compose restart backend
```

### Database Connection Issues

```bash
# Check database is running
docker compose ps postgres

# Connect to database
docker exec -it reknir-db psql -U reknir -d reknir

# Check database size
docker exec reknir-db psql -U reknir -d reknir -c "SELECT pg_size_pretty(pg_database_size('reknir'));"
```

### Tunnel Not Working

```bash
# Check tunnel logs (should show "Connection <UUID> registered")
docker compose logs cloudflared

# Restart tunnel
docker compose restart cloudflared

# If it never registers: verify TUNNEL_TOKEN in .env and check the tunnel's
# status in the Cloudflare Zero Trust dashboard
```

### 502 Bad Gateway

```bash
# Check nginx is running
docker compose ps nginx

# Check nginx logs
docker compose logs nginx

# Check backend is accessible from nginx
docker exec reknir-nginx wget -O- http://backend:8000/docs

# Restart nginx
docker compose restart nginx
```

### High Resource Usage

```bash
# Check resource usage
docker stats

# Check disk space
df -h
du -sh ~/reknir/* | sort -h

# Backup retention is managed via Settings GUI

# Clean docker
docker system prune -a --volumes
```

## Performance Tuning

### Nginx Worker Processes

Edit `nginx/nginx.conf`:
```nginx
events {
    worker_connections 2048;  # Increase for high traffic
}
```

### Backend Workers

Edit `docker-compose.prod.yml`:
```yaml
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Recommended workers: `(CPU cores * 2) + 1`

### Database Connection Pooling

Add to backend environment in `docker-compose.prod.yml`:
```yaml
environment:
  DB_POOL_SIZE: 20
  DB_MAX_OVERFLOW: 10
```

## Maintenance

### Daily Tasks
- Check `docker compose ps` - all services running
- Monitor disk space: `df -h`
- Check logs for errors: `docker compose logs --tail=100`

### Weekly Tasks
- Review backups: `ls -lh ~/reknir/backups/`
- Update system: `sudo apt update && sudo apt upgrade -y`
- Check resource usage: `docker stats`

### Monthly Tasks
- Update Docker images: Pull and rebuild
- Review and clean old backups
- Check security updates

## Support

For issues or questions:
- Check logs: `docker compose logs`
- Review this guide
- Check GitHub issues: https://github.com/joakimeriksson/reknir/issues

## License

See LICENSE file in repository.
