'use strict';

// ── State ──────────────────────────────────────────────────────────────────

let _proc_cpu_data = [];
let _proc_mem_data = [];
let _proc_cpu_sort = { col: 2, asc: false };
let _proc_mem_sort = { col: 3, asc: false };
let _last_updated_ms = null;
let _fail_count = 0;
let _show_all_ifaces = false;
let _stats_timer = null;
let _hist_timer = null;
let _ct_timer = null;

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

function fmt_ago(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
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

function load_class(load, cores) {
  if (load >= cores) return 'c-red';
  if (load >= cores * 0.7) return 'c-yellow';
  return 'c-green';
}

function set_text(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function set_stat(id, val, cls) {
  const el = document.getElementById(id);
  if (el) { el.textContent = val; el.className = 'stat-value' + (cls ? ' ' + cls : ''); }
}

// ── Gauge ──────────────────────────────────────────────────────────────────

const CIRC = 2 * Math.PI * 30;

function update_gauge(ring_id, text_id, pct) {
  const ring = document.getElementById(ring_id);
  const text = document.getElementById(text_id);
  if (!ring || !text) return;
  ring.style.strokeDashoffset = CIRC - (pct / 100) * CIRC;
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
  fill.setAttribute('points', `0,${h} ${pts} ${w},${h}`);
  fill.style.fill = color;
}

// ── Favicon (CPU ring gauge) ───────────────────────────────────────────────

function update_favicon(cpu_pct) {
  const c = cpu_pct >= 90 ? '%23ef4444' : cpu_pct >= 70 ? '%23eab308' : '%2322c55e';
  const r = 13, circ = +(2 * Math.PI * r).toFixed(1);
  const dash = +((cpu_pct / 100) * circ).toFixed(1);
  const svg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>`
    + `<circle cx='16' cy='16' r='${r}' fill='none' stroke='%232a2d3d' stroke-width='4'/>`
    + `<circle cx='16' cy='16' r='${r}' fill='none' stroke='${c}' stroke-width='4'`
    + ` stroke-dasharray='${dash} ${circ}' transform='rotate(-90 16 16)'/></svg>`;
  const link = document.getElementById('favicon');
  if (link) link.href = svg;
}

// ── Clock & time-ago ───────────────────────────────────────────────────────

function tick_clock() {
  set_text('clock', new Date().toLocaleTimeString());
  if (_last_updated_ms !== null) {
    set_text('last-updated', fmt_ago(_last_updated_ms));
  }
}
setInterval(tick_clock, 1000);
tick_clock();

// ── Status badge ───────────────────────────────────────────────────────────

function mark_live() {
  _fail_count = 0;
  _last_updated_ms = Date.now();
  const b = document.getElementById('status-badge');
  b.textContent = 'LIVE';
  b.className = 'live';
}

function mark_fail() {
  _fail_count++;
  if (_fail_count >= 2) {
    const b = document.getElementById('status-badge');
    b.textContent = 'STALE';
    b.className = 'stale';
  }
}

// ── Process table sorting ──────────────────────────────────────────────────

const PROC_COLS = ['name', 'pid', 'cpu_percent', 'memory_percent'];

function sort_procs(data, col, asc) {
  return [...data].sort((a, b) => {
    const va = a[PROC_COLS[col]] || 0;
    const vb = b[PROC_COLS[col]] || 0;
    if (col === 0) return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    return asc ? va - vb : vb - va;
  });
}

function render_proc_table(body_id, data, sort, is_cpu_table) {
  const rows = sort_procs(data, sort.col, sort.asc).map(p => {
    const cpu_cls = pct_class(p.cpu_percent || 0);
    const mem_cls = pct_class((p.memory_percent || 0) * 5);
    return is_cpu_table
      ? `<tr>
          <td class="proc-name" title="${p.name}">${p.name}</td>
          <td class="c-muted">${p.pid}</td>
          <td class="${cpu_cls}">${(p.cpu_percent || 0).toFixed(1)}%</td>
          <td class="c-muted">${(p.memory_percent || 0).toFixed(1)}%</td>
        </tr>`
      : `<tr>
          <td class="proc-name" title="${p.name}">${p.name}</td>
          <td class="c-muted">${p.pid}</td>
          <td class="c-muted">${(p.cpu_percent || 0).toFixed(1)}%</td>
          <td class="${mem_cls}">${(p.memory_percent || 0).toFixed(1)}%</td>
        </tr>`;
  }).join('');
  document.getElementById(body_id).innerHTML = rows;
}

function update_sort_headers(table_id, sort) {
  const table = document.getElementById(table_id);
  if (!table) return;
  table.querySelectorAll('thead th').forEach((th, i) => {
    th.classList.toggle('sort-active', i === sort.col);
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = i === sort.col ? (sort.asc ? '↑' : '↓') : '';
  });
}

function init_sort_headers() {
  [
    {
      table: 'proc-cpu-table', body: 'proc-cpu-body', isCpu: true,
      getSort: () => _proc_cpu_sort, setSort: v => { _proc_cpu_sort = v; }, getData: () => _proc_cpu_data,
    },
    {
      table: 'proc-mem-table', body: 'proc-mem-body', isCpu: false,
      getSort: () => _proc_mem_sort, setSort: v => { _proc_mem_sort = v; }, getData: () => _proc_mem_data,
    },
  ].forEach(({ table, body, isCpu, getSort, setSort, getData }) => {
    const el = document.getElementById(table);
    if (!el) return;
    el.querySelectorAll('thead th').forEach((th, col) => {
      const ind = document.createElement('span');
      ind.className = 'sort-ind';
      th.appendChild(ind);
      th.addEventListener('click', () => {
        const cur = getSort();
        setSort(col === cur.col ? { col, asc: !cur.asc } : { col, asc: col === 0 });
        render_proc_table(body, getData(), getSort(), isCpu);
        update_sort_headers(table, getSort());
      });
    });
    update_sort_headers(table, getSort());
  });
}

// ── Collapsible cards ──────────────────────────────────────────────────────

function init_collapsible() {
  document.querySelectorAll('.card').forEach(card => {
    const title_el = card.querySelector('.card-title');
    if (!title_el) return;
    const key = 'collapsed:' + (card.id || title_el.textContent.trim().slice(0, 30).replace(/\s+/g, '-').toLowerCase());
    const btn = document.createElement('button');
    btn.className = 'collapse-btn';
    btn.title = 'Collapse';
    btn.textContent = '−';
    title_el.appendChild(btn);
    if (localStorage.getItem(key) === '1') {
      card.classList.add('collapsed');
      btn.textContent = '+';
      btn.title = 'Expand';
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const collapsed = card.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
      btn.title = collapsed ? 'Expand' : 'Collapse';
      localStorage.setItem(key, collapsed ? '1' : '0');
    });
  });
}

// ── Stats rendering ────────────────────────────────────────────────────────

const VIRTUAL_IFACE_RE = /^(lo|docker\d*|br-[a-f0-9]+|veth[a-f0-9]+|virbr\d+)$/;

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
  set_stat('swap-pct', s.swap.percent.toFixed(1) + '%', pct_class(s.swap.percent));
  set_text('swap-total', fmt_bytes(s.swap.total));
  const cores = s.cpu.count;
  set_stat('load-1',  s.load.load_1.toFixed(2),  load_class(s.load.load_1,  cores));
  set_stat('load-5',  s.load.load_5.toFixed(2),  load_class(s.load.load_5,  cores));
  set_stat('load-15', s.load.load_15.toFixed(2), load_class(s.load.load_15, cores));
  set_text('uptime', fmt_uptime(s.uptime_seconds));

  // Page title + favicon
  document.title = `${cpu.toFixed(0)}% CPU · ${mem.toFixed(0)}% RAM — ${s.hostname || 'Dashboard'}`;
  update_favicon(cpu);

  // Hostname
  set_text('hostname', s.hostname || '—');

  // Addresses — clickable to copy
  const addr_el = document.getElementById('addresses');
  if (addr_el) {
    const parts = Object.entries(s.addresses || {}).map(([k, v]) =>
      `<span class="addr-item" title="Click to copy ${v}" data-addr="${v}">${k}: ${v}</span>`
    );
    addr_el.innerHTML = parts.join(' · ');
    addr_el.querySelectorAll('.addr-item').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.dataset.addr).then(() => {
          const orig = el.textContent;
          el.textContent = 'Copied!';
          el.classList.add('addr-copied');
          setTimeout(() => { el.textContent = orig; el.classList.remove('addr-copied'); }, 1200);
        });
      });
    });
  }

  // Temperature
  const temps = s.temperatures || {};
  const temp_keys = Object.keys(temps);
  const temp_card = document.getElementById('temp-card');
  const disk_card = document.getElementById('disk-card');
  if (temp_keys.length) {
    temp_card.classList.remove('hidden');
    disk_card.style.gridColumn = 'span 3';
    document.getElementById('temp-content').innerHTML = temp_keys.map(key =>
      temps[key].map(e => {
        const c = pct_class(e.high ? (e.current / e.high) * 100 : 0);
        return `<div class="stat-row"><span class="stat-label">${e.label || key}</span>`
          + `<span class="stat-value ${c}">${e.current.toFixed(1)}°C${e.high ? ' / ' + e.high.toFixed(0) + '°' : ''}</span></div>`;
      }).join('')
    ).join('');
  } else {
    temp_card.classList.add('hidden');
    disk_card.style.gridColumn = 'span 4';
  }

  // Disk
  document.getElementById('disk-content').innerHTML = (s.disks || []).map(d => `
    <div class="bar-row">
      <div class="bar-header">
        <span class="bar-label" title="${d.mountpoint}">${d.mountpoint} <span style="color:var(--muted);font-size:10px">(${d.fstype})</span></span>
        <span class="bar-pct ${pct_class(d.percent)}">${d.percent.toFixed(1)}% — ${fmt_bytes(d.used)} / ${fmt_bytes(d.total)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${d.percent}%;background:${pct_color(d.percent)}"></div></div>
    </div>`).join('') || '<span class="c-muted">No disks found</span>';

  // Network — filter virtual interfaces unless toggled
  const net_list = _show_all_ifaces
    ? (s.network || [])
    : (s.network || []).filter(n => !VIRTUAL_IFACE_RE.test(n.interface));
  document.getElementById('net-content').innerHTML = net_list.map(n => `
    <div class="net-block">
      <div class="net-iface">${n.interface}</div>
      <div class="net-rates">
        <div class="net-rate-item"><span class="net-arrow c-green">▲</span><span>${fmt_bytes(n.send_rate)}/s</span></div>
        <div class="net-rate-item"><span class="net-arrow c-blue">▼</span><span>${fmt_bytes(n.recv_rate)}/s</span></div>
        <div class="net-rate-item c-muted" style="font-size:11px">↑${fmt_bytes(n.bytes_sent_total)} ↓${fmt_bytes(n.bytes_recv_total)}</div>
      </div>
    </div>`).join('') || '<span class="c-muted">No interfaces</span>';

  // Top Processes — store data then render with current sort
  _proc_cpu_data = s.top_cpu || [];
  _proc_mem_data = s.top_mem || [];
  render_proc_table('proc-cpu-body', _proc_cpu_data, _proc_cpu_sort, true);
  render_proc_table('proc-mem-body', _proc_mem_data, _proc_mem_sort, false);
  update_sort_headers('proc-cpu-table', _proc_cpu_sort);
  update_sort_headers('proc-mem-table', _proc_mem_sort);

  // CPU per-core bars
  document.getElementById('cores-content').innerHTML = (s.cpu.per_core || []).map((pct, i) => `
    <div class="bar-row">
      <div class="bar-header">
        <span class="bar-label">Core ${i}</span>
        <span class="bar-pct ${pct_class(pct)}">${pct.toFixed(0)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${pct_color(pct)}"></div></div>
    </div>`).join('');
}

// ── History rendering ──────────────────────────────────────────────────────

function render_history(h) {
  draw_sparkline('cpu-spark-line', 'cpu-spark-fill', h.cpu || [], 'var(--green)');
  draw_sparkline('mem-spark-line', 'mem-spark-fill', h.memory || [], 'var(--blue)');
}

// ── Containers rendering ───────────────────────────────────────────────────

function render_containers(list) {
  const count_el = document.getElementById('container-count');
  if (!list.length) {
    document.getElementById('containers-content').innerHTML = '<span class="c-muted">No containers found (is Docker running?)</span>';
    if (count_el) count_el.textContent = '';
    return;
  }

  const running = list.filter(c => c.status === 'running').length;
  if (count_el) count_el.textContent = `${running}/${list.length} running`;

  const groups = {};
  list.forEach(c => {
    const g = c.compose_project || '(standalone)';
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });

  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '(standalone)') return 1;
    if (b === '(standalone)') return -1;
    return a.localeCompare(b);
  });

  document.getElementById('containers-content').innerHTML = keys.map(project => {
    const rows = groups[project].map(c => {
      const mem_str = c.mem_limit
        ? `${fmt_bytes(c.mem_used)} / ${fmt_bytes(c.mem_limit)} (${c.mem_pct.toFixed(1)}%)`
        : '—';
      const ports_str = (c.ports || []).slice(0, 4).join(', ') + (c.ports.length > 4 ? '…' : '');
      return `<tr>
        <td class="ct-name">${c.name}</td>
        <td class="ct-image col-image">${c.image}</td>
        <td><span class="state-badge state-${c.status}">${c.status}</span></td>
        <td class="${pct_class(c.cpu_pct)}">${c.cpu_pct.toFixed(1)}%</td>
        <td class="${pct_class(c.mem_pct)}">${mem_str}</td>
        <td class="ct-ports">${ports_str || '—'}</td>
        <td class="c-muted">${c.status === 'running' ? fmt_uptime(c.uptime_seconds) : '—'}</td>
      </tr>`;
    }).join('');
    return `
      <div class="compose-group">
        <div class="compose-label">${project}</div>
        <div class="table-scroll">
          <table class="ct-table">
            <thead><tr><th>Name</th><th class="col-image">Image</th><th>State</th><th>CPU</th><th>Memory</th><th>Ports</th><th>Uptime</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetch_stats() {
  try {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error('bad status');
    render_stats(await r.json());
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

function set_intervals(ms) {
  clearInterval(_stats_timer);
  clearInterval(_hist_timer);
  clearInterval(_ct_timer);
  _stats_timer = setInterval(fetch_stats, ms);
  _hist_timer  = setInterval(fetch_history, Math.max(ms * 3, 15000));
  _ct_timer    = setInterval(fetch_containers, Math.max(ms * 2, 10000));
}

// ── Init ───────────────────────────────────────────────────────────────────

fetch_stats();
fetch_history();
fetch_containers();

init_sort_headers();
init_collapsible();

// Interval selector
const interval_sel = document.getElementById('interval-select');
const saved_ms = parseInt(localStorage.getItem('refresh-interval')) || 5000;
interval_sel.value = saved_ms;
set_intervals(saved_ms);
interval_sel.addEventListener('change', e => {
  const ms = parseInt(e.target.value);
  localStorage.setItem('refresh-interval', ms);
  set_intervals(ms);
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', () => {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  Promise.all([fetch_stats(), fetch_history(), fetch_containers()])
    .finally(() => setTimeout(() => btn.classList.remove('spinning'), 500));
});

// Keyboard shortcut: R to refresh
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
    document.getElementById('refresh-btn').click();
  }
});

// Theme toggle
const theme_btn = document.getElementById('theme-btn');
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light');
  theme_btn.textContent = 'Dark';
}
theme_btn.addEventListener('click', () => {
  const is_light = document.body.classList.toggle('light');
  theme_btn.textContent = is_light ? 'Dark' : 'Light';
  localStorage.setItem('theme', is_light ? 'light' : 'dark');
});

// Network interface filter toggle
const net_filter_btn = document.getElementById('net-filter-btn');
if (net_filter_btn) {
  net_filter_btn.addEventListener('click', e => {
    e.stopPropagation();
    _show_all_ifaces = !_show_all_ifaces;
    net_filter_btn.textContent = _show_all_ifaces ? 'filtered' : 'all';
    net_filter_btn.title = _show_all_ifaces ? 'Hide virtual interfaces' : 'Show virtual interfaces';
    net_filter_btn.classList.toggle('active', _show_all_ifaces);
    fetch_stats();
  });
}
