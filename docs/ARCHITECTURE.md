# Reknir Architecture

This document explains how Reknir is architected, focusing on the differences between development and production deployments, Docker networking, and request flow.

## Table of Contents
1. [System Overview](#system-overview)
2. [Development vs Production](#development-vs-production)
3. [Docker Networking Explained](#docker-networking-explained)
4. [Request Flow](#request-flow)
5. [Why This Architecture?](#why-this-architecture)

---

## System Overview

Reknir is a three-tier application:

```
┌─────────────────────────────────────────────────┐
│                   Frontend                      │
│         React + TypeScript + Vite               │
│  (Development: Vite dev server on port 5173)   │
│  (Production: Built static files served by nginx)│
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│                   Backend                       │
│              Python + FastAPI                   │
│            (Always port 8000)                   │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│                  Database                       │
│              PostgreSQL 16                      │
│            (Always port 5432)                   │
└─────────────────────────────────────────────────┘
```

---

## Development vs Production

### Development Setup

**Characteristics:**
- Vite dev server runs frontend
- Hot module replacement (HMR)
- Source maps for debugging
- Development tools enabled
- Two separate ports exposed

**Port configuration:**
```yaml
# docker-compose.dev.yml
frontend:
  ports:
    - "5173:5173"  # Vite dev server
  command: npm run dev -- --host 0.0.0.0

backend:
  ports:
    - "8000:8000"  # FastAPI
  command: uvicorn app.main:app --reload
```

**Why two ports?**

Your browser makes **direct connections** to both services:

```
┌─────────────────────────────────────────┐
│          Your Browser                   │
│                                         │
│  http://localhost:5173  ←─────────┐    │
│  http://localhost:8000/api/*  ←───┼─┐  │
└───────────────────────────────────┼─┼──┘
                                    │ │
                    SSH Tunnel (dev)│ │
                                    ↓ ↓
┌───────────────────────────────────────────────┐
│              Remote Server                    │
│                                               │
│  ┌────────────────┐      ┌─────────────┐    │
│  │   Frontend     │      │   Backend   │    │
│  │  Vite server   │      │   FastAPI   │    │
│  │   Port 5173    │      │  Port 8000  │    │
│  └────────────────┘      └─────────────┘    │
│                                               │
└───────────────────────────────────────────────┘
```

**Flow:**
1. Browser loads `http://localhost:5173`
2. Vite serves React app with development tools
3. React app makes API calls to `http://localhost:8000/api/*`
4. FastAPI responds with data

**Two separate HTTP connections!**

---

### Production Setup

**Characteristics:**
- Frontend is **built** to static files (no Vite server)
- Nginx serves static files AND proxies API requests
- Optimized, minified bundles
- No development tools
- **Only one port exposed (80/443)**

**Port configuration:**
```yaml
# docker-compose.prod.yml
backend:
  expose:
    - "8000"  # Internal only!

frontend:
  expose:
    - "80"    # Internal only!

nginx:
  ports:
    - "80:80"  # ONLY nginx is exposed!
```

**Why one port?**

Nginx acts as a **reverse proxy** and **file server**:

```
┌────────────────────────────────────────┐
│           User's Browser               │
│                                        │
│    https://your-domain.com             │
│    https://your-domain.com/api/*       │
└────────────────┬───────────────────────┘
                 │
          Internet/Cloudflare
                 ↓
┌────────────────────────────────────────────────┐
│              Remote Server                     │
│                                                │
│  ┌──────────────────────────────────────┐    │
│  │         Nginx (Port 80)              │    │
│  │                                      │    │
│  │  Reads request path:                │    │
│  │  • /*       → Serve static files    │    │
│  │  • /api/*   → Proxy to backend      │    │
│  └────────┬──────────────────┬─────────┘    │
│           │                  │               │
│           ↓                  ↓               │
│  ┌────────────────┐  ┌─────────────┐       │
│  │   Frontend     │  │   Backend   │       │
│  │ (static files) │  │   FastAPI   │       │
│  │    Port 80     │  │  Port 8000  │       │
│  │  nginx serves  │  │   (internal)│       │
│  └────────────────┘  └─────────────┘       │
│                                              │
└──────────────────────────────────────────────┘
```

**Flow:**
1. Browser requests `https://your-domain.com` → nginx serves `index.html`
2. Browser requests `https://your-domain.com/assets/app.js` → nginx serves built JS
3. Browser (via JS) requests `https://your-domain.com/api/companies` → nginx proxies to `backend:8000`
4. Backend responds → nginx returns response to browser

**One entry point, nginx routes internally!**

---

## Docker Networking Explained

### Docker Networks

When you run `docker compose up`, Docker creates a private network:

```yaml
networks:
  reknir-internal:
    driver: bridge
```

This is like a local WiFi network where all containers can talk to each other.

### Service Discovery (DNS)

Docker Compose provides **automatic DNS resolution**:

```yaml
services:
  postgres:   # Accessible as "postgres" from other containers
  backend:    # Accessible as "backend" from other containers
  frontend:   # Accessible as "frontend" from other containers
  nginx:      # Accessible as "nginx" from other containers
```

Example from nginx config:
```nginx
upstream backend {
    server backend:8000;  # "backend" resolves to backend container's IP!
}
```

No hardcoded IPs needed!

### `expose` vs `ports`

Two ways to expose container ports:

#### `expose` - Internal Only

```yaml
backend:
  expose:
    - "8000"
```

**What this does:**
- ✅ Port 8000 accessible from **other containers** in the same network
- ❌ Port 8000 NOT accessible from **host machine**
- ❌ Port 8000 NOT accessible from **internet**

**Example:**
```bash
# From your laptop/server - FAILS
curl http://localhost:8000

# From nginx container - WORKS
curl http://backend:8000
```

#### `ports` - External Access

```yaml
nginx:
  ports:
    - "80:80"  # Format: HOST_PORT:CONTAINER_PORT
```

**What this does:**
- ✅ Port 80 accessible from **other containers**
- ✅ Port 80 accessible from **host machine**
- ✅ Port 80 accessible from **internet** (if firewall allows)

**Example:**
```bash
# All of these work:
curl http://localhost:80              # From host
curl http://nginx:80                  # From other containers
curl http://your-server-ip:80         # From internet
```

### Port Mapping

The `ports` syntax maps host ports to container ports:

```yaml
ports:
  - "8080:80"  # Host port 8080 → Container port 80
```

This means:
- Inside container: app listens on port 80
- Outside (host/internet): access via port 8080

---

## Request Flow

### Development Flow

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ├─── http://localhost:5173 ─────────────────┐
       │                                            ↓
       │                                    ┌──────────────┐
       │                                    │   Vite Dev   │
       │                                    │    Server    │
       │                                    │  Port 5173   │
       │                                    └──────────────┘
       │                                            │
       │                                     Serves .tsx,
       │                                     Hot reload
       │
       └─── http://localhost:8000/api/* ─────────┐
                                                  ↓
                                          ┌──────────────┐
                                          │   FastAPI    │
                                          │  Port 8000   │
                                          └──────┬───────┘
                                                 │
                                                 ↓
                                          ┌──────────────┐
                                          │  PostgreSQL  │
                                          │  Port 5432   │
                                          └──────────────┘
```

**Two parallel connections from browser.**

---

### Production Flow

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       │ https://your-domain.com
       │ https://your-domain.com/api/*
       │
       ↓
┌──────────────────────────────────────────────┐
│           Cloudflare (optional)              │
│        SSL/TLS, DDoS protection              │
└──────────────────┬───────────────────────────┘
                   │
                   ↓
┌──────────────────────────────────────────────┐
│              Nginx (Port 80)                 │
│                                              │
│  Reads request path:                        │
│                                              │
│  ┌────────────────┬──────────────────────┐  │
│  │  Path /*       │  Path /api/*         │  │
│  └────┬───────────┴────────┬─────────────┘  │
│       │                    │                 │
│       ↓                    ↓                 │
│  ┌─────────────┐    ┌──────────────┐       │
│  │  Frontend   │    │   Backend    │       │
│  │  (nginx)    │    │   FastAPI    │       │
│  │  Port 80    │    │  Port 8000   │       │
│  │             │    └──────┬───────┘       │
│  │  Serves:    │           │                │
│  │  index.html │           ↓                │
│  │  app.js     │    ┌──────────────┐       │
│  │  app.css    │    │  PostgreSQL  │       │
│  │  etc.       │    │  Port 5432   │       │
│  └─────────────┘    └──────────────┘       │
│                                              │
│         Docker Network (internal)           │
└──────────────────────────────────────────────┘
```

**One entry point, nginx routes internally based on path.**

---

### Nginx Reverse Proxy Configuration

Here's how nginx knows what to route where:

```nginx
http {
    # Define backend servers
    upstream backend {
        server backend:8000;  # Docker DNS!
    }

    upstream frontend {
        server frontend:80;   # Docker DNS!
    }

    server {
        listen 80;

        # API requests → backend
        location /api/ {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # API docs → backend
        location /docs {
            proxy_pass http://backend;
        }

        # Everything else → frontend
        location / {
            proxy_pass http://frontend;
        }
    }
}
```

**Key points:**
- `server backend:8000` uses Docker's internal DNS
- No hardcoded IPs
- Backend is never exposed directly
- Frontend serves static files from `/usr/share/nginx/html`

---

### Frontend Build Process

In production, the frontend goes through a build step:

```dockerfile
# frontend/Dockerfile.prod

# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build  # ← Creates dist/ with static files

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html  # ← Only static files!
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**What `npm run build` does:**
```
src/
├── App.tsx
├── main.tsx
├── components/
└── pages/

     ↓  Build (Vite)

dist/
├── index.html           # Entry point
├── assets/
│   ├── index-abc123.js  # All JS bundled, minified
│   ├── index-def456.css # All CSS bundled, minified
│   └── logo.svg         # Assets
```

**Result:**
- No Node.js needed in production
- No Vite server
- Just static files served by nginx
- Much smaller container size
- Much faster performance

---

## Why This Architecture?

### Development: Two Ports

**Advantages:**
- ✅ Hot Module Replacement (HMR) - instant updates
- ✅ Source maps - easy debugging
- ✅ Fast refresh on code changes
- ✅ React DevTools work properly
- ✅ Detailed error messages

**Tradeoffs:**
- ❌ Two ports to manage
- ❌ More resource intensive
- ❌ Not production-ready

### Production: One Port + Nginx

**Advantages:**
- ✅ **Security**: Backend never exposed directly
- ✅ **SSL/TLS**: Nginx handles HTTPS termination
- ✅ **Performance**: Nginx is highly optimized for static files
- ✅ **Caching**: Nginx can cache responses
- ✅ **Rate limiting**: Nginx can limit requests
- ✅ **Load balancing**: Can distribute load across multiple backends
- ✅ **Standard**: Port 80/443 is what browsers expect
- ✅ **Simplicity**: One entry point to secure

**Tradeoffs:**
- ❌ No hot reload (need to rebuild)
- ❌ Build step required
- ❌ Less detailed error messages

---

## Cloudflare Tunnel Architecture

With Cloudflare Tunnel, the architecture becomes even more secure:

```
┌──────────────┐
│   Browser    │
└──────┬───────┘
       │
       │ https://your-domain.com
       │
       ↓
┌────────────────────────────────────────┐
│      Cloudflare Global Network         │
│   (SSL, DDoS, WAF, CDN, etc.)         │
└──────────────┬─────────────────────────┘
               │
               │ Cloudflare Tunnel
               │ (outbound from server)
               ↓
┌──────────────────────────────────────────────┐
│           Your Server                        │
│                                              │
│  ┌────────────────────────────────────┐     │
│  │  cloudflared container             │     │
│  │  (Creates outbound tunnel)         │     │
│  └──────────────┬─────────────────────┘     │
│                 │ (internal connection)      │
│                 ↓                             │
│  ┌────────────────────────────────────┐     │
│  │         Nginx (Port 80)            │     │
│  │      NOT exposed to internet!      │     │
│  └──────────┬──────────────┬──────────┘     │
│             │              │                 │
│             ↓              ↓                 │
│      ┌──────────┐   ┌──────────┐           │
│      │ Frontend │   │ Backend  │           │
│      │ Port 80  │   │ Port 8000│           │
│      └──────────┘   └────┬─────┘           │
│                          │                  │
│                          ↓                  │
│                   ┌──────────┐             │
│                   │PostgreSQL│             │
│                   │Port 5432 │             │
│                   └──────────┘             │
│                                             │
│  Firewall: Only SSH (22) open!            │
└─────────────────────────────────────────────┘
```

**Key points:**
- Cloudflared creates an **outbound** connection to Cloudflare
- No inbound ports needed (except SSH for admin)
- Traffic goes: Internet → Cloudflare → Tunnel → nginx → backend
- Even nginx port 80 is not exposed to internet, only to cloudflared container
- Maximum security: server is invisible to internet

---

## Summary

### Development
- **Ports:** 5173 (Vite) + 8000 (FastAPI)
- **Why:** Hot reload, debugging, separate services
- **Access:** `ssh -L 5173:localhost:5173 -L 8000:localhost:8000`

### Production
- **Port:** 80 (nginx only)
- **Why:** Security, performance, standard HTTP/HTTPS
- **Access:** `https://your-domain.com`

### Docker Networking
- **`expose`:** Internal only (container-to-container)
- **`ports`:** External access (host/internet)
- **DNS:** Service names (e.g., `backend:8000`)

### Nginx Role
- Serves static frontend files
- Proxies `/api/*` requests to backend
- Handles SSL/TLS termination
- Rate limiting and security headers
- Single entry point for entire application

---

## Further Reading

- [Docker Networking](https://docs.docker.com/network/)
- [Nginx Reverse Proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- [Vite Build](https://vitejs.dev/guide/build.html)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
