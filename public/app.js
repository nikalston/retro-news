'use strict';

// ── State ──────────────────────────────────────────────────────
let allItems = [];
let filteredItems = [];
let sources = [];
let selectedIndex = 0;
let activeSource = 'ALL';
let lastSync = null;

// ── DOM refs ───────────────────────────────────────────────────
const bootScreen  = document.getElementById('boot-screen');
const bootText    = document.getElementById('boot-text');
const main        = document.getElementById('main');
const newsList    = document.getElementById('news-list');
const filterBar   = document.getElementById('filter-bar');
const headerStats = document.getElementById('header-stats');
const headerSync  = document.getElementById('header-sync');
const statusLine  = document.getElementById('status-line');
const footerTime  = document.getElementById('footer-time');
const refreshBtn  = document.getElementById('refresh-btn');
const modal       = document.getElementById('modal');
const modalTitle  = document.getElementById('modal-title');
const modalMeta   = document.getElementById('modal-meta');
const modalSummary= document.getElementById('modal-summary');
const modalLink   = document.getElementById('modal-link');
const modalClose  = document.getElementById('modal-close');

// ── Boot Sequence ──────────────────────────────────────────────
const BOOT_LINES = [
  'NEWSTERM v1.0  (c) 1997 CYBERWARE SYSTEMS INC.',
  '══════════════════════════════════════════════',
  '',
  'BIOS v2.44 ... OK',
  'MEMORY CHECK ... 640K CONVENTIONAL ... OK',
  'INITIALIZING MODEM ... COM1 ... 56K BAUD ... OK',
  '',
  '[*] LOADING NEWSTERM.EXE',
  '[*] ESTABLISHING CONNECTION TO FEED MATRIX...',
  '[*] DECRYPTING DATA STREAMS...',
  '[*] LOADING RSS PARSERS v3.1...',
  '',
  '>>> ACCESS GRANTED <<<',
  '',
];

async function runBoot() {
  for (const line of BOOT_LINES) {
    await typeLine(line);
    await sleep(line === '' ? 200 : 120);
  }
  await waitForEnter();
  bootScreen.classList.add('hidden');
  main.classList.remove('hidden');
  loadFeeds();
}

function typeLine(text) {
  return new Promise(resolve => {
    bootText.textContent += text + '\n';
    resolve();
  });
}

function waitForEnter() {
  return new Promise(resolve => {
    bootText.textContent += '\n[ PRESS ENTER TO CONTINUE ]';

    function onKey(e) {
      if (e.key === 'Enter') {
        document.removeEventListener('keydown', onKey);
        resolve();
      }
    }
    function onClick() {
      bootScreen.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve();
    }

    document.addEventListener('keydown', onKey);
    bootScreen.addEventListener('click', onClick);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Feed Loading ───────────────────────────────────────────────
async function loadFeeds(force = false) {
  statusLine.innerHTML = '<span class="loading-line">[*] FETCHING FEEDS... PLEASE WAIT_</span>';
  try {
    const url = force ? '/api/feeds?force=1' : '/api/feeds';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allItems = data.items || [];
    sources  = data.sources || [];
    lastSync = data.lastSync ? new Date(data.lastSync) : new Date();

    buildFilterBar();
    applyFilter(activeSource);
    updateHeader();
    statusLine.textContent = data.cached
      ? `[CACHE] Data from ${formatTime(lastSync)} — press [R] to force refresh`
      : `[OK] Loaded ${allItems.length} items from ${sources.length} feeds`;
  } catch (err) {
    statusLine.innerHTML = `<span class="error-line">[ERROR] ${err.message}</span>`;
  }
}

// ── Filter Bar ─────────────────────────────────────────────────
function buildFilterBar() {
  // Remove old source buttons, keep ALL
  Array.from(filterBar.querySelectorAll('.filter-btn:not([data-source="ALL"])')).forEach(b => b.remove());

  for (const src of sources) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.dataset.source = src.name;
    btn.style.color = src.color;
    btn.style.borderColor = src.error ? 'var(--red)' : src.color;
    btn.textContent = `[${src.name}${src.error ? ' ERR' : ''}]`;
    btn.addEventListener('click', () => applyFilter(src.name));
    filterBar.appendChild(btn);
  }
}

function applyFilter(source) {
  activeSource = source;
  filteredItems = source === 'ALL' ? allItems : allItems.filter(i => i.source === source);
  selectedIndex = 0;

  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.source === source);
  });

  renderList();
}

// ── Render ─────────────────────────────────────────────────────
function renderList() {
  newsList.innerHTML = '';

  if (!filteredItems.length) {
    newsList.innerHTML = '<div style="color:var(--text-dim);padding:1rem">[NO ITEMS FOUND]</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  filteredItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'news-item' + (i === selectedIndex ? ' selected' : '');
    div.dataset.index = i;

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'item-source';
    sourceSpan.style.color = item.color;
    sourceSpan.style.borderColor = item.color;
    sourceSpan.textContent = item.source.slice(0, 10).padEnd(10);

    const body = document.createElement('div');
    body.className = 'item-body';

    const titleLine = document.createElement('div');
    titleLine.className = 'item-title';
    titleLine.innerHTML = '';
    titleLine.appendChild(sourceSpan);
    titleLine.appendChild(document.createTextNode(item.title));

    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.innerHTML = `<span class="item-age">${formatAge(item.date)}</span>`;
    if (item.summary) {
      const snip = item.summary.slice(0, 120);
      meta.innerHTML += ` &mdash; ${snip}${item.summary.length > 120 ? '...' : ''}`;
    }

    body.appendChild(titleLine);
    body.appendChild(meta);

    const num = document.createElement('span');
    num.className = 'item-num';
    num.textContent = String(i + 1).padStart(3, '0') + '.';

    div.appendChild(num);
    div.appendChild(body);

    div.addEventListener('click', () => {
      selectedIndex = i;
      updateSelected();
      openModal(filteredItems[i]);
    });

    frag.appendChild(div);
  });

  newsList.appendChild(frag);
}

function updateSelected() {
  document.querySelectorAll('.news-item').forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIndex);
  });
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const el = newsList.querySelector('.news-item.selected');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(item) {
  modalTitle.textContent = item.title;
  modalMeta.textContent = `SOURCE: ${item.source}   DATE: ${item.date ? new Date(item.date).toLocaleString() : 'UNKNOWN'}`;
  modalSummary.textContent = item.summary || '(no summary available)';
  modalLink.href = item.link;
  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
}

// ── Header / Footer ────────────────────────────────────────────
function updateHeader() {
  const ok    = sources.filter(s => !s.error).length;
  const total = sources.length;
  headerStats.textContent = `[FEEDS: ${ok}/${total}] [ITEMS: ${allItems.length}]`;
  headerSync.textContent  = lastSync ? `[SYNC: ${formatTime(lastSync)}]` : '[SYNC: --:--:--]';
}

function startClock() {
  function tick() {
    const now = new Date();
    footerTime.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

// ── Time helpers ───────────────────────────────────────────────
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatAge(dateStr) {
  if (!dateStr) return 'UNKNOWN';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'JUST NOW';
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'JUST NOW';
  if (mins < 60) return `${mins}MIN AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}H AGO`;
  const days = Math.floor(hrs / 24);
  return `${days}D AGO`;
}

// ── Keyboard ───────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!main.classList.contains('hidden') && modal.classList.contains('hidden')) {
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1);
      updateSelected();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelected();
    } else if (e.key === 'Enter') {
      if (filteredItems[selectedIndex]) openModal(filteredItems[selectedIndex]);
    } else if (e.key === 'r' || e.key === 'R') {
      loadFeeds(true);
    } else if (e.key === 'f' || e.key === 'F') {
      cycleFilter();
    } else if (e.key === 'o' || e.key === 'O') {
      if (filteredItems[selectedIndex]) window.open(filteredItems[selectedIndex].link, '_blank', 'noopener');
    }
  } else if (!modal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
  }
});

function cycleFilter() {
  const options = ['ALL', ...sources.map(s => s.name)];
  const idx = options.indexOf(activeSource);
  applyFilter(options[(idx + 1) % options.length]);
}

// ── Event Listeners ────────────────────────────────────────────
refreshBtn.addEventListener('click', () => loadFeeds(true));
modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

document.querySelector('.filter-btn[data-source="ALL"]').addEventListener('click', () => applyFilter('ALL'));

// Auto-refresh every 5 minutes
setInterval(() => loadFeeds(false), 5 * 60 * 1000);

// ── Init ───────────────────────────────────────────────────────
startClock();
runBoot();
