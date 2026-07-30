/**
 * toolStore.js — the single "place where all the tools live".
 *
 * Responsibilities:
 *   - ingest()           pull from every live source (toolSources) + merge, dedupe
 *   - pickFiveForToday() choose the 5 tools for today (fresh first, backfill from
 *                        the curated evergreen seed pool), mark them used
 *   - Day N/100 counter  persisted across runs for the "100-day challenge" branding
 *
 * Persistence (mirrors postQueue.js — plain JSON under backend/data/):
 *   data/tools.json      { tools: [ ...storedTool ], lastIngestAt }
 *   data/challenge.json  { day, startDate, lastPickDate, picksByDate }
 *
 * storedTool = normalisedTool + { id, ingestedAt, usedAt, fromPool }
 */
const fs = require('fs');
const path = require('path');
const { gatherTools, classifyCategory, isPublishable } = require('./toolSources');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const STORE_FILE = path.join(DATA_DIR, 'tools.json');
const CHALLENGE_FILE = path.join(DATA_DIR, 'challenge.json');
const SEED_FILE = path.join(DATA_DIR, 'tools.seed.json');

const CHALLENGE_LENGTH = 100;

// ── low-level json io ─────────────────────────────────────────────────────────
function readJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return fallback;
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function loadStore() { return readJSON(STORE_FILE, { tools: [], lastIngestAt: null }); }
function saveStore(s) { writeJSON(STORE_FILE, s); }

// ── identity / dedupe ─────────────────────────────────────────────────────────
function nameKey(name) {
  return String(name || '').toLowerCase().replace(/\b(ai|app|io|the|get|try)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function urlKey(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').toLowerCase(); }
  catch { return String(url || '').toLowerCase(); }
}
function sameTool(a, b) {
  if (a.url && b.url && urlKey(a.url) === urlKey(b.url)) return true;
  const ka = nameKey(a.name), kb = nameKey(b.name);
  return ka.length > 2 && ka === kb;
}

// ── seed pool ─────────────────────────────────────────────────────────────────
function loadSeedPool() {
  const seed = readJSON(SEED_FILE, { tools: [] });
  return (seed.tools || []).map((t) => ({
    ...t,
    category: t.category || classifyCategory(`${t.name} ${t.tagline} ${t.description}`),
    source: 'EvergreenPool',
    isNew: false,
    fromPool: true,
  }));
}

// ── INGEST ────────────────────────────────────────────────────────────────────
async function ingest() {
  const store = loadStore();
  let added = 0;
  let fresh = [];

  // Re-apply the publishability gate to what is already stored. Records ingested
  // before the gate existed (bare Hugging Face slugs, mis-tagged non-AI repos)
  // would otherwise stay in the pool and keep getting picked. Tools already used
  // are kept so the Day N history and dedupe stay intact.
  const before = store.tools.length;
  store.tools = store.tools.filter((t) => t.usedAt || t.fromPool || isPublishable(t));
  const pruned = before - store.tools.length;
  if (pruned) console.log(`[ToolStore] Pruned ${pruned} unpublishable tools already in the store`);
  try {
    fresh = await gatherTools();
  } catch (e) {
    console.log(`[ToolStore] gatherTools failed entirely: ${e.message}`);
  }

  for (const t of fresh) {
    const existing = store.tools.find((s) => sameTool(s, t));
    if (existing) {
      // keep the richer record + max votes; don't resurrect a used tool
      existing.votes = Math.max(existing.votes || 0, t.votes || 0);
      if (!existing.description && t.description) existing.description = t.description;
      continue;
    }
    store.tools.push({
      ...t,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ingestedAt: new Date().toISOString(),
      usedAt: null,
      fromPool: false,
    });
    added++;
  }

  // Trim unused, un-picked backlog so the file can't grow forever (keep newest 500).
  const used = store.tools.filter((t) => t.usedAt);
  const unused = store.tools.filter((t) => !t.usedAt)
    .sort((a, b) => new Date(b.ingestedAt) - new Date(a.ingestedAt))
    .slice(0, 500);
  store.tools = [...used, ...unused];
  store.lastIngestAt = new Date().toISOString();
  saveStore(store);
  console.log(`[ToolStore] Ingest done: +${added} new, ${store.tools.length} total in store`);
  return { added, total: store.tools.length };
}

// ── SCORING for the daily pick ────────────────────────────────────────────────
function freshnessBoost(t) {
  const when = t.launchedAt || t.ingestedAt;
  if (!when) return 0;
  const days = (Date.now() - new Date(when).getTime()) / 86400000;
  if (days < 1) return 50;
  if (days < 2) return 35;
  if (days < 4) return 20;
  if (days < 8) return 8;
  return 0;
}
function pickScore(t) {
  // votes (capped) + freshness + a small source-trust nudge
  const trust = { ProductHunt: 25, ShowHN: 18, GitHub: 15, HuggingFace: 12 }[t.source] || 8;
  return Math.min(t.votes || 0, 60) + freshnessBoost(t) + trust;
}

// ── DAILY PICK ────────────────────────────────────────────────────────────────
/**
 * Pick the 5 tools for `dateKey` (default today). Fresh, unused tools first;
 * backfill from the evergreen pool so the channel never misses a day. Marks the
 * chosen live tools as used. Idempotent per day: re-picking the same date returns
 * the already-stored selection.
 */
async function pickFiveForToday(dateKey = todayKey(), count = 5) {
  const challenge = loadChallenge();
  let reuseDay = null;
  const cached = challenge.picksByDate[dateKey];
  if (cached) {
    // Picks are cached per date to keep a day's bundle stable across reruns, but a
    // cache written before the quality gate existed would keep resurrecting junk
    // (a terminal multiplexer got re-picked as an "AI tool" three renders running).
    // Re-validate; only fall through to a fresh pick if the cache is unusable.
    const bad = (cached.tools || []).filter((t) => !isPublishable(t));
    if (!bad.length) return { day: cached.day, dateKey, tools: cached.tools };
    console.log(`[ToolStore] Cached picks for ${dateKey} contain ${bad.length} unpublishable tool(s) ` +
      `(${bad.map((t) => t.name).join(', ')}) — re-picking`);
    // Keep this date's existing day number: re-picking is a correction, not a new
    // day of the challenge, and nextDay() would otherwise skip Day 3 to Day 4.
    reuseDay = cached.day;
    delete challenge.picksByDate[dateKey];
  }

  const store = loadStore();
  const candidates = store.tools
    .filter((t) => !t.usedAt)
    .map((t) => ({ t, score: pickScore(t) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);

  const picked = [];
  const usedCats = new Set();
  // pass 1: spread across categories for a varied carousel
  for (const t of candidates) {
    if (picked.length >= count) break;
    if (usedCats.has(t.category)) continue;
    picked.push(t); usedCats.add(t.category);
  }
  // pass 2: fill remaining slots with next-best regardless of category
  for (const t of candidates) {
    if (picked.length >= count) break;
    if (picked.includes(t)) continue;
    picked.push(t);
  }
  // backfill from evergreen pool if live sources were thin
  if (picked.length < count) {
    const pool = loadSeedPool().sort(() => Math.random() - 0.5);
    const usedPoolNames = new Set((challenge.usedPoolNames || []));
    for (const p of pool) {
      if (picked.length >= count) break;
      if (usedPoolNames.has(nameKey(p.name))) continue;
      if (picked.some((x) => sameTool(x, p))) continue;
      picked.push(p);
      usedPoolNames.add(nameKey(p.name));
    }
    challenge.usedPoolNames = [...usedPoolNames];
    // if the whole pool has been used once, allow reuse next cycle
    if (picked.length < count) challenge.usedPoolNames = [];
  }

  // mark live picks as used in the store
  const stamp = new Date().toISOString();
  for (const p of picked) {
    if (p.fromPool) continue;
    const rec = store.tools.find((s) => s.id === p.id);
    if (rec) rec.usedAt = stamp;
  }
  saveStore(store);

  // advance the 100-day counter (unless this is a correction to an existing day)
  const day = reuseDay || nextDay(challenge);
  const slim = picked.map((t) => ({
    name: t.name, tagline: t.tagline, description: t.description, url: t.url,
    category: t.category, source: t.source, isNew: !!t.isNew, howTo: t.howTo || null,
  }));
  challenge.picksByDate[dateKey] = { day, tools: slim };
  challenge.day = day;
  challenge.lastPickDate = dateKey;
  saveChallenge(challenge);

  console.log(`[ToolStore] Day ${day}/${CHALLENGE_LENGTH} pick (${dateKey}): ${slim.map((t) => t.name).join(', ')}`);
  return { day, dateKey, tools: slim };
}

// ── 100-DAY CHALLENGE COUNTER ─────────────────────────────────────────────────
function todayKey(d = new Date()) {
  // local-date key YYYY-MM-DD (so "a day" matches the user's day, not UTC)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadChallenge() {
  return readJSON(CHALLENGE_FILE, {
    day: 0, startDate: todayKey(), lastPickDate: null, picksByDate: {}, usedPoolNames: [],
  });
}
function saveChallenge(c) { writeJSON(CHALLENGE_FILE, c); }
function nextDay(challenge) {
  return Math.min((challenge.day || 0) + 1, CHALLENGE_LENGTH);
}
function getChallengeStatus() {
  const c = loadChallenge();
  return {
    day: c.day, length: CHALLENGE_LENGTH, startDate: c.startDate,
    lastPickDate: c.lastPickDate, daysPicked: Object.keys(c.picksByDate).length,
  };
}
function getTodaysPick(dateKey = todayKey()) {
  const c = loadChallenge();
  return c.picksByDate[dateKey] || null;
}

module.exports = {
  ingest, pickFiveForToday, getChallengeStatus, getTodaysPick,
  todayKey, loadStore, CHALLENGE_LENGTH,
};
