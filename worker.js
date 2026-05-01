// Cloudflare Worker — handles /api/feeds and serves static assets
// To add/remove feeds, edit the FEEDS array below, then push to GitHub.

const FEEDS = [
  { name: 'HACKERNEWS',  url: 'https://news.ycombinator.com/rss',                  color: '#00ff41' },
  { name: 'ARSTECHNICA', url: 'https://feeds.arstechnica.com/arstechnica/index',    color: '#ff6600' },
  { name: 'THEREGISTER', url: 'https://www.theregister.com/headlines.atom',         color: '#ffdd00' },
  { name: 'WIRED',       url: 'https://www.wired.com/feed/rss',                     color: '#00ffff' },
  { name: 'BBC',         url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        color: '#ff4444' },
  { name: 'TECHDIRT',    url: 'https://www.techdirt.com/techdirt_rss.xml',          color: '#cc44ff' },
  { name: 'ENGADGET',    url: 'https://www.engadget.com/rss.xml',                   color: '#ff44aa' },
  { name: 'TECHCRUNCH',  url: 'https://techcrunch.com/feed/',                       color: '#00cc88' },
  { name: 'KREBSONSEC',  url: 'https://krebsonsecurity.com/feed/',                 color: '#ff8800' },
];

// ── Cache ──────────────────────────────────────────────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── XML helpers ────────────────────────────────────────────────

function unescapeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(str) {
  if (!str) return '';
  return unescapeEntities(str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function unwrapCdata(str) {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : str;
}

function tagContent(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? unwrapCdata(m[1]).trim() : '';
}

// ── RSS / Atom parser ──────────────────────────────────────────

function parseItems(xml) {
  const isAtom = /<feed[\s\n>]/.test(xml);
  const tag = isAtom ? 'entry' : 'item';
  const re = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi');
  const blocks = xml.match(re) || [];

  return blocks.slice(0, 25).map(block => {
    const title = stripHtml(tagContent(block, 'title'));

    let link = tagContent(block, 'link').trim();
    if (!link) {
      const m = block.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = m ? m[1] : '';
    }
    if (!link) link = tagContent(block, 'guid').trim();

    const date =
      tagContent(block, 'pubDate') ||
      tagContent(block, 'published') ||
      tagContent(block, 'updated') ||
      tagContent(block, 'dc:date') ||
      null;

    const rawSummary =
      tagContent(block, 'content:encoded') ||
      tagContent(block, 'description') ||
      tagContent(block, 'summary') ||
      tagContent(block, 'content') ||
      '';

    return { title, link, date: date || null, summary: stripHtml(rawSummary).slice(0, 400) };
  });
}

// ── Feed fetching ──────────────────────────────────────────────

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return { source: feed.name, color: feed.color || '#00ff41', error: null, items: parseItems(xml) };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function buildPayload() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const sources = [];
  const allItems = [];

  for (let i = 0; i < results.length; i++) {
    const feed = FEEDS[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      const f = result.value;
      sources.push({ name: f.source, color: f.color, error: null });
      for (const item of f.items) allItems.push({ ...item, source: f.source, color: f.color });
    } else {
      sources.push({ name: feed.name, color: feed.color || '#00ff41', error: result.reason?.message || 'fetch failed' });
    }
  }

  allItems.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return { items: allItems, sources, lastSync: new Date().toISOString() };
}

// ── Request handler ────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  });
}

async function handleFeeds(request) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  const now = Date.now();

  if (!force && _cache && now - _cacheAt < CACHE_TTL) {
    return jsonResponse({ ..._cache, cached: true });
  }

  try {
    const payload = await buildPayload();
    _cache = payload;
    _cacheAt = now;
    return jsonResponse({ ...payload, cached: false });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ── Worker entry ───────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/feeds') return handleFeeds(request);

    // All other requests: serve static files from /public
    return env.ASSETS.fetch(request);
  },
};
