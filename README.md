# Server Dashboard

A self-hosted server monitoring dashboard designed to run as a Docker container and be used as a browser homepage. Displays real-time system stats and Docker container health at a glance.

![Dark theme dashboard](https://via.placeholder.com/800x400/0f1117/6366f1?text=Server+Dashboard)

## Features

- **System stats** — CPU usage (overall + per-core), memory, swap, disk per mount, network I/O rates
- **Docker containers** — status, CPU%, memory, ports, and uptime; grouped by compose project
- **Top processes** — top 8 by CPU and by memory
- **Sparklines** — 60-second history charts on CPU and memory gauges
- **Temperature sensors** — shown when available on the host
- **Live/Stale badge** — immediately visible if the backend stops responding
- **Auto-refresh** — stats every 5s, containers every 10s, no page reloads

## Quick Start

```bash
git clone <repo-url>
cd server_dashboard
docker compose up --build -d
```

Open `http://localhost` (or `http://<your-server-ip>`) in your browser.

**Set as Chrome homepage:** Settings → On startup → Open a specific page → `http://localhost`

## Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · uvicorn |
| System stats | psutil |
| Docker stats | docker-py SDK |
| Frontend | Vanilla HTML/CSS/JS (no build step) |
| Deployment | Docker + docker-compose |

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | Internal container port (host maps to 80) |

To change the host port, edit `docker-compose.yml`:

```yaml
ports:
  - "8080:8000"   # change 8080 to any available host port
```

## Requirements

- Docker with the Docker socket accessible at `/var/run/docker.sock`
- The container runs with `pid: host` so `psutil` can read host-level process and CPU stats

## Project Structure

```
server_dashboard/
├── app/
│   ├── main.py           # FastAPI app — API routes + background tasks
│   └── requirements.txt
├── static/
│   ├── index.html        # Dashboard layout
│   ├── style.css         # Dark theme, CSS variables, transitions
│   └── app.js            # Fetch loops, gauge/sparkline rendering
├── Dockerfile
└── docker-compose.yml
```

## API Endpoints

| Endpoint | Interval | Description |
|---|---|---|
| `GET /api/stats` | 5s | System stats (CPU, memory, disk, network, processes) |
| `GET /api/history` | 15s | 60-sample ring buffer for sparklines |
| `GET /api/containers` | 10s | Docker container list with resource usage |
