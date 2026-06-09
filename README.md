# Server Dashboard

A self-hosted server monitoring dashboard designed to run as a Docker container and be used as a browser homepage. Displays real-time system stats and Docker container health at a glance.

## Features

**System monitoring**
- CPU usage — overall gauge + per-core bars + 60-second sparkline
- Memory and swap — usage gauge + sparkline, used/total breakdown
- Disk — usage bars per mount point with filesystem type
- Network I/O — per-interface send/receive rates and totals (virtual interfaces filtered by default)
- Load averages — color-coded green/yellow/red relative to your CPU core count
- Temperature sensors — shown automatically when available on the host
- Top processes — top 8 by CPU and by memory, sortable by any column

**Docker**
- All containers with state badge, CPU%, memory, ports, and uptime
- Grouped by compose project, with a running/total count in the section header

**UI / UX**
- Live/Stale badge — immediately visible if the backend stops responding
- Dynamic favicon — CPU ring gauge in the browser tab (green/yellow/red)
- Page title — updates to `12% CPU · 44% RAM — hostname` on every poll
- Click-to-copy IP addresses — click any address in the topbar to copy it
- Collapsible cards — collapse any section; preference saved across reloads
- Light/dark theme toggle — saved in `localStorage`
- Adjustable refresh interval — 1s / 5s / 15s / 30s / 60s, saved in `localStorage`
- Manual refresh button — or press `R` anywhere on the page
- "X seconds ago" live counter on the last-updated timestamp
- Mobile responsive — single-column on phone, two-column on tablet, full layout on desktop

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
│   ├── style.css         # Dark/light themes, CSS variables, responsive breakpoints
│   └── app.js            # Fetch loops, rendering, sorting, collapsible, theme, favicon
├── Dockerfile
└── docker-compose.yml
```

## API Endpoints

| Endpoint | Default interval | Description |
|---|---|---|
| `GET /api/stats` | 5s | System stats (CPU, memory, disk, network, processes) |
| `GET /api/history` | 15s | 60-sample ring buffer for sparklines |
| `GET /api/containers` | 10s | Docker container list with resource usage |

The frontend poll intervals scale with the refresh interval selector — e.g. at 1s, stats poll every 1s and containers every 2s.
