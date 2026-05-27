'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt_bytes(b) {
  if (b === null || b === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmt_uptime(secs) {
  if (!secs && secs !== 0) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${secs % 60}s`;
}

function pct_color(pct) {
  if (pct >= 90) return 'var(--red)';
  if (pct >= 70) return 'var(--yellow)';
  return 'var(--green)';
}

function pct_class(pct) {
  if (pct >= 90) return 'c-red';
  if (pct >= 70) return 'c-yellow';
  return 'c-green';
}

function set_text(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function set_class(id, cls) {
  const el = document.getElementById(id);
  if (el) { el.className = el.className.replace(/c-\w+/, '').trim() + ' ' + cls; }
}

// ── Gauge ──────────────────────────────────────────────────────────────────

const CIRC = 2 * Math.PI * 30; // 188.5

function update_gauge(ring_id, text_id, pct) {
  const ring = document.getElementById(ring_id);
  const text = document.getElementById(text_id);
  if (!ring || !text) return;
  const offset = CIRC - (pct / 100) * CIRC;
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = pct_color(pct);
  text.textContent = Math.round(pct) + '%';
}

// ── Sparkline ──────────────────────────────────────────────────────────────

function draw_sparkline(line_id, fill_id, data, color) {
  const line = document.getElementById(line_id);
  const fill = document.getElementById(fill_id);
  if (!line || !fill || !data.length) return;

  const w = 60, h = 36;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = h - (v / max) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  line.setAttribute('points', pts);
  line.style.stroke = color;

  // Close path for fill polygon
  const first_x = '0,' + h;
  const last_x = w + ',' + h;
  fill.setAttribute('points', first_x + ' ' + pts + ' ' + last_x);
  fill.style.fill = color;
}

// ── Clock ──────────────────────────────────────────────────────────────────

function tick_clock() {
  const now = new Date();
  set_text('clock', now.toLocaleTimeString());
}
setInterval(tick_clock, 1000);
tick_clock();

// ── Status badge ───────────────────────────────────────────────────────────

let _fail_count = 0;

function mark_live() {
  _fail_count = 0;
  const b = document.getElementById('status-badge');
  b.textContent = 'LIVE';
  b.className = 'live';
  set_text('last-updated', new Date().toLocaleTimeString());
}

function mark_fail() {
  _fail_count++;
  if (_fail_count >= 2) {
    const b = document.getElementById('status-badge');
    b.textContent = 'STALE';
    b.className = 'stale';
  }
}

// ── Stats rendering ────────────────────────────────────────────────────────

function render_stats(s) {
  // CPU
  const cpu = s.cpu.percent;
  update_gauge('cpu-ring', 'cpu-ring-text', cpu);
  const cpuEl = document.getElementById('cpu-pct');
  if (cpuEl) { cpuEl.textContent = cpu.toFixed(1) + '%'; cpuEl.className = 'gauge-value ' + pct_class(cpu); }
  set_text('cpu-sub', `${s.cpu.count} cores · ${s.cpu.freq_mhz ? s.cpu.freq_mhz + ' MHz' : '—'}`);

  // Memory
  const mem = s.memory.percent;
  update_gauge('mem-ring', 'mem-ring-text', mem);
  const memEl = document.getElementById('mem-pct');
  if (memEl) { memEl.textContent = mem.toFixed(1) + '%'; memEl.className = 'gauge-value ' + pct_class(mem); }
  set_text('mem-sub', `${fmt_bytes(s.memory.used)} / ${fmt_bytes(s.memory.total)}`);

  // Swap & system
  const swapPct = s.swap.percent;
  const swapEl = document.getElementById('swap-pct');
  if (swapEl) { swapEl.textContent = swapPct.toFixed(1) + '%'; swapEl.className = 'stat-value ' + pct_class(swapPct); }
  set_text('swap-total', fmt_bytes(s.swap.total));
  set_text('load-1', s.load.load_1.toFixed(2));
  set_text('load-5', s.load.load_5.toFixed(2));
  set_text('load-15', s.load.load_15.toFixed(2));
  set_text('uptime', fmt_uptime(s.uptime_seconds));

  // Hostname + addresses
  set_text('hostname', s.hostname || '—');
  const addr_str = Object.entries(s.addresses || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
  set_text('addresses', addr_str);

  // Temperature
  const temps = s.temperatures || {};
  const temp_keys = Object.keys(temps);
  const temp_card = document.getElementById('temp-card');
  const disk_card = document.getElementById('disk-card');
  if (temp_keys.length) {
    temp_card.classList.remove('hidden');
    disk_card.style.gridColumn = 'span 3';
    const content = temp_keys.map(key => {
      return temps[key].map(e => {
        const c = pct_class(e.high ? (e.current / e.high) * 100 : 0);
        return `<div class="stat-row"><span class="stat-label">${e.label || key}</span><span class="stat-value ${c}">${e.current.toFixed(1)}°C${e.high ? ' / ' + e.high.toFixed(0) + '°' : ''}</span></div>`;
      }).join('');
    }).join('');
    document.getElementById('temp-content').innerHTML = content;
  } else {
    temp_card.classList.add('hidden');
    disk_card.style.gridColumn = 'span 4';
  }

  // Disk
  const disk_html = (s.disks || []).map(d => `
    <div class="bar-row">
      <div class="bar-header">
        <span class="bar-label" title="${d.mountpoint}">${d.mountpoint} <span style="color:var(--muted);font-size:10px">(${d.fstype})</span></span>
        <span class="bar-pct ${pct_class(d.percent)}">${d.percent.toFixed(1)}% — ${fmt_bytes(d.used)} / ${fmt_bytes(d.total)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${d.percent}%;background:${pct_color(d.percent)}"></div></div>
    </div>`).join('');
  document.getElementById('disk-content').innerHTML = disk_html || '<span class="c-muted">No disks found</span>';

  // Network
  const net_html = (s.network || []).map(n => `
    <div class="net-block">
      <div class="net-iface">${n.interface}</div>
      <div class="net-rates">
        <div class="net-rate-item"><span class="net-arrow c-green">▲</span><span>${fmt_bytes(n.send_rate)}/s</span></div>
        <div class="net-rate-item"><span class="net-arrow c-blue">▼</span><span>${fmt_bytes(n.recv_rate)}/s</span></div>
        <div class="net-rate-item c-muted" style="font-size:11px">↑${fmt_bytes(n.bytes_sent_total)} ↓${fmt_bytes(n.bytes_recv_total)}</div>
      </div>
    </div>`).join('');
  document.getElementById('net-content').innerHTML = net_html || '<span class="c-muted">No interfaces</span>';

  // Top Processes — CPU
  const cpu_rows = (s.top_cpu || []).map(p => `
    <tr>
      <td class="proc-name" title="${p.name}">${p.name}</td>
      <td class="c-muted">${p.pid}</td>
      <td class="${pct_class(p.cpu_percent)}">${(p.cpu_percent || 0).toFixed(1)}%</td>
      <td class="c-muted">${(p.memory_percent || 0).toFixed(1)}%</td>
    </tr>`).join('');
  document.getElementById('proc-cpu-body').innerHTML = cpu_rows;

  // Top Processes — Memory
  const mem_rows = (s.top_mem || []).map(p => `
    <tr>
      <td class="proc-name" title="${p.name}">${p.name}</td>
      <td class="c-muted">${p.pid}</td>
      <td class="c-muted">${(p.cpu_percent || 0).toFixed(1)}%</td>
      <td class="${pct_class(p.memory_percent * 5)}">${(p.memory_percent || 0).toFixed(1)}%</td>
    </tr>`).join('');
  document.getElementById('proc-mem-body').innerHTML = mem_rows;

  // CPU per-core bars
  const cores = s.cpu.per_core || [];
  const core_html = cores.map((pct, i) => `
    <div class="bar-row">
      <div class="bar-header">
        <span class="bar-label">Core ${i}</span>
        <span class="bar-pct ${pct_class(pct)}">${pct.toFixed(0)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${pct_color(pct)}"></div></div>
    </div>`).join('');
  document.getElementById('cores-content').innerHTML = core_html;
}

// ── History rendering ──────────────────────────────────────────────────────

function render_history(h) {
  draw_sparkline('cpu-spark-line', 'cpu-spark-fill', h.cpu || [], 'var(--green)');
  draw_sparkline('mem-spark-line', 'mem-spark-fill', h.memory || [], 'var(--blue)');
}

// ── Containers rendering ───────────────────────────────────────────────────

function render_containers(list) {
  if (!list.length) {
    document.getElementById('containers-content').innerHTML = '<span class="c-muted">No containers found (is Docker running?)</span>';
    return;
  }

  // Group by compose project
  const groups = {};
  list.forEach(c => {
    const g = c.compose_project || '(standalone)';
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });

  // Sort groups: named compose projects first, standalone last
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '(standalone)') return 1;
    if (b === '(standalone)') return -1;
    return a.localeCompare(b);
  });

  const html = keys.map(project => {
    const containers = groups[project];
    const rows = containers.map(c => {
      const state_cls = `state-${c.status}`;
      const cpu_cls = pct_class(c.cpu_pct);
      const mem_cls = pct_class(c.mem_pct);
      const mem_str = c.mem_limit ? `${fmt_bytes(c.mem_used)} / ${fmt_bytes(c.mem_limit)} (${c.mem_pct.toFixed(1)}%)` : '—';
      const ports_str = (c.ports || []).slice(0, 4).join(', ') + (c.ports.length > 4 ? '…' : '');
      const uptime_str = c.status === 'running' ? fmt_uptime(c.uptime_seconds) : '—';
      return `<tr>
        <td class="ct-name">${c.name}</td>
        <td class="ct-image">${c.image}</td>
        <td><span class="state-badge ${state_cls}">${c.status}</span></td>
        <td class="${cpu_cls}">${c.cpu_pct.toFixed(1)}%</td>
        <td class="${mem_cls}">${mem_str}</td>
        <td class="ct-ports">${ports_str || '—'}</td>
        <td class="c-muted">${uptime_str}</td>
      </tr>`;
    }).join('');
    return `
      <div class="compose-group">
        <div class="compose-label">${project}</div>
        <table class="ct-table">
          <thead><tr><th>Name</th><th>Image</th><th>State</th><th>CPU</th><th>Memory</th><th>Ports</th><th>Uptime</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  document.getElementById('containers-content').innerHTML = html;
}

// ── Fetch loops ────────────────────────────────────────────────────────────

async function fetch_stats() {
  try {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('bad status');
    const data = await r.json();
    render_stats(data);
    mark_live();
  } catch (e) {
    mark_fail();
  }
}

async function fetch_history() {
  try {
    const r = await fetch('/api/history');
    if (!r.ok) return;
    render_history(await r.json());
  } catch (_) {}
}

async function fetch_containers() {
  try {
    const r = await fetch('/api/containers');
    if (!r.ok) return;
    render_containers(await r.json());
  } catch (_) {}
}

// Initial load
fetch_stats();
fetch_history();
fetch_containers();

// Polling
setInterval(fetch_stats, 5000);
setInterval(fetch_history, 15000);
setInterval(fetch_containers, 10000);
