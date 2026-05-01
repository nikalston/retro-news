const express = require('express');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const parser = new Parser({ timeout: 10000 });
const PORT = process.env.PORT || 3000;
const FEEDS_PATH = path.join(__dirname, 'feeds.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let cache = null;
let cacheAt = 0;

function loadFeeds() {
  return JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf8'));
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function fetchAllFeeds() {
  const feeds = loadFeeds();
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        return {
          source: feed.name,
          color: feed.color || '#00ff41',
          error: null,
          items: parsed.items.slice(0, 25).map(item => ({
            title: stripHtml(item.title || '(no title)'),
            link: item.link || item.guid || '#',
            date: item.pubDate || item.isoDate || null,
            summary: stripHtml(item.contentSnippet || item.content || ''),
          }))
        };
      } catch (err) {
        return { source: feed.name, color: feed.color || '#00ff41', error: err.message, items: [] };
      }
    })
  );

  const sources = [];
  const allItems = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const f = result.value;
    sources.push({ name: f.source, color: f.color, error: f.error });
    for (const item of f.items) {
      allItems.push({ ...item, source: f.source, color: f.color });
    }
  }

  allItems.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return { items: allItems, sources, lastSync: new Date().toISOString() };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/feeds', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && cache && (now - cacheAt) < CACHE_TTL) {
    return res.json({ ...cache, cached: true });
  }
  try {
    cache = await fetchAllFeeds();
    cacheAt = now;
    res.json({ ...cache, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (_req, res) => {
  res.json(loadFeeds());
});

app.put('/api/config', (req, res) => {
  const feeds = req.body;
  if (!Array.isArray(feeds)) return res.status(400).json({ error: 'Expected array of feeds' });
  fs.writeFileSync(FEEDS_PATH, JSON.stringify(feeds, null, 2));
  cache = null;
  cacheAt = 0;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[NEWSTERM] Server online at http://localhost:${PORT}`);
});
