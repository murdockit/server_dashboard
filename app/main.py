import asyncio
import os
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import docker
import psutil
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

_executor = ThreadPoolExecutor(max_workers=4)

app = FastAPI()

# ---------------------------------------------------------------------------
# State shared between background tasks and request handlers
# ---------------------------------------------------------------------------

_cpu_history: deque = deque(maxlen=60)
_mem_history: deque = deque(maxlen=60)

_net_cache: dict = {}  # {iface: (bytes_sent, bytes_recv, timestamp)}

_container_stats_cache: dict = {}  # {container_id: prev_stats_snapshot}
_containers_response: list = []    # last computed container list

_docker_client: Optional[docker.DockerClient] = None


def _get_docker():
    global _docker_client
    if _docker_client is None:
        try:
            _docker_client = docker.from_env()
        except Exception:
            pass
    return _docker_client


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _sample_system_metrics():
    """Sample CPU and memory every second into ring buffers."""
    while True:
        _cpu_history.append(psutil.cpu_percent(interval=None))
        mem = psutil.virtual_memory()
        _mem_history.append(mem.percent)
        await asyncio.sleep(1)


async def _refresh_container_stats():
    """Refresh Docker container stats every 10 seconds."""
    loop = asyncio.get_event_loop()
    while True:
        client = _get_docker()
        if client:
            try:
                containers = client.containers.list(all=True)
                entries = await asyncio.gather(*[
                    loop.run_in_executor(_executor, _build_container_entry, c)
                    for c in containers
                ], return_exceptions=True)
                result = [e for e in entries if isinstance(e, dict)]
                _containers_response.clear()
                _containers_response.extend(result)
            except Exception:
                pass
        await asyncio.sleep(10)


def _build_container_entry(container) -> dict:
    labels = container.labels or {}
    compose_project = labels.get("com.docker.compose.project", "")

    cpu_pct = 0.0
    mem_used = 0
    mem_limit = 0
    mem_pct = 0.0

    if container.status == "running":
        try:
            raw = container.stats(stream=False)
            cid = container.id

            cpu_delta = (
                raw["cpu_stats"]["cpu_usage"]["total_usage"]
                - raw["precpu_stats"]["cpu_usage"]["total_usage"]
            )
            system_delta = (
                raw["cpu_stats"]["system_cpu_usage"]
                - raw["precpu_stats"]["system_cpu_usage"]
            )
            num_cpus = raw["cpu_stats"].get("online_cpus") or len(
                raw["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
            )
            if system_delta > 0:
                cpu_pct = (cpu_delta / system_delta) * num_cpus * 100.0

            mem_used = raw["memory_stats"].get("usage", 0)
            mem_limit = raw["memory_stats"].get("limit", 0)
            if mem_limit > 0:
                mem_pct = (mem_used / mem_limit) * 100.0
        except Exception:
            pass

    # Resolve started_at for uptime
    uptime_seconds = None
    try:
        attrs = container.attrs
        started_at_str = attrs.get("State", {}).get("StartedAt", "")
        if started_at_str and started_at_str != "0001-01-01T00:00:00Z":
            # Parse RFC3339 / ISO8601
            started_at_str = started_at_str[:26] + "Z"
            started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
            uptime_seconds = int(
                (datetime.now(timezone.utc) - started_at).total_seconds()
            )
    except Exception:
        pass

    ports = []
    try:
        port_bindings = container.attrs.get("NetworkSettings", {}).get("Ports", {})
        for container_port, bindings in (port_bindings or {}).items():
            if bindings:
                for b in bindings:
                    ports.append(f"{b['HostPort']}→{container_port}")
            else:
                ports.append(container_port)
    except Exception:
        pass

    return {
        "id": container.short_id,
        "name": container.name,
        "image": container.image.tags[0] if container.image.tags else container.image.short_id,
        "status": container.status,
        "compose_project": compose_project,
        "cpu_pct": round(cpu_pct, 1),
        "mem_used": mem_used,
        "mem_limit": mem_limit,
        "mem_pct": round(mem_pct, 1),
        "ports": ports,
        "uptime_seconds": uptime_seconds,
    }


@app.on_event("startup")
async def startup():
    loop = asyncio.get_event_loop()
    # Seed cpu_percent so first reading is non-zero
    psutil.cpu_percent(interval=None)
    await asyncio.sleep(0.1)

    # Pre-warm container stats in thread pool
    client = _get_docker()
    if client:
        try:
            containers = client.containers.list(all=True)
            entries = await asyncio.gather(*[
                loop.run_in_executor(_executor, _build_container_entry, c)
                for c in containers
            ], return_exceptions=True)
            _containers_response.extend(e for e in entries if isinstance(e, dict))
        except Exception:
            pass

    asyncio.create_task(_sample_system_metrics())
    asyncio.create_task(_refresh_container_stats())


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/stats")
def get_stats():
    cpu_pct = psutil.cpu_percent(interval=None)
    cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
    cpu_freq = psutil.cpu_freq()

    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # Disk
    disks = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent,
            })
        except PermissionError:
            continue

    # Network delta
    net_io = psutil.net_io_counters(pernic=True)
    now = time.time()
    net_stats = []
    for iface, counters in net_io.items():
        if iface == "lo":
            continue
        prev = _net_cache.get(iface)
        elapsed = now - prev[2] if prev else 1.0
        send_rate = ((counters.bytes_sent - prev[0]) / elapsed) if prev else 0
        recv_rate = ((counters.bytes_recv - prev[1]) / elapsed) if prev else 0
        _net_cache[iface] = (counters.bytes_sent, counters.bytes_recv, now)
        net_stats.append({
            "interface": iface,
            "bytes_sent_total": counters.bytes_sent,
            "bytes_recv_total": counters.bytes_recv,
            "send_rate": max(0, send_rate),
            "recv_rate": max(0, recv_rate),
        })

    # Load average
    try:
        load_1, load_5, load_15 = os.getloadavg()
    except (AttributeError, OSError):
        load_1 = load_5 = load_15 = 0.0

    # Uptime
    boot_time = psutil.boot_time()
    uptime_seconds = int(time.time() - boot_time)

    # Hostname + IPs
    hostname = os.uname().nodename if hasattr(os, "uname") else "unknown"
    addrs = {}
    try:
        for iface, addr_list in psutil.net_if_addrs().items():
            if iface == "lo":
                continue
            for a in addr_list:
                if a.family.name == "AF_INET":
                    addrs[iface] = a.address
    except Exception:
        pass

    # Temperature
    temps = {}
    try:
        sensors = psutil.sensors_temperatures()
        if sensors:
            for key, entries in sensors.items():
                if entries:
                    temps[key] = [{"label": e.label or key, "current": e.current, "high": e.high, "critical": e.critical} for e in entries]
    except (AttributeError, Exception):
        pass

    # Top processes
    procs = []
    try:
        for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            try:
                procs.append(p.info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception:
        pass

    top_cpu = sorted(procs, key=lambda x: x.get("cpu_percent") or 0, reverse=True)[:8]
    top_mem = sorted(procs, key=lambda x: x.get("memory_percent") or 0, reverse=True)[:8]

    num_cpus = psutil.cpu_count(logical=True)

    return {
        "cpu": {
            "percent": cpu_pct,
            "per_core": cpu_per_core,
            "count": num_cpus,
            "freq_mhz": round(cpu_freq.current) if cpu_freq else None,
        },
        "memory": {
            "total": mem.total,
            "used": mem.used,
            "available": mem.available,
            "percent": mem.percent,
        },
        "swap": {
            "total": swap.total,
            "used": swap.used,
            "percent": swap.percent,
        },
        "disks": disks,
        "network": net_stats,
        "load": {"load_1": round(load_1, 2), "load_5": round(load_5, 2), "load_15": round(load_15, 2)},
        "uptime_seconds": uptime_seconds,
        "hostname": hostname,
        "addresses": addrs,
        "temperatures": temps,
        "top_cpu": top_cpu,
        "top_mem": top_mem,
        "num_cpus": num_cpus,
    }


@app.get("/api/history")
def get_history():
    return {
        "cpu": list(_cpu_history),
        "memory": list(_mem_history),
    }


@app.get("/api/containers")
def get_containers():
    return _containers_response


# ---------------------------------------------------------------------------
# Static files — must be last so /api/* routes take precedence
# ---------------------------------------------------------------------------

static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
