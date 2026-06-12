/**
 * dailyChallenge.js — the daily orchestrator for the "100-day AI challenge".
 *
 * Produces ONE reviewable draft bundle per day (nothing is posted here — the
 * dashboard approves assets into the existing postQueue):
 *   1× morning RUNDOWN reel  — girl host narrates all 5 tools ("discloses all 5")
 *   3× HOW-TO reels (~15s)    — boy host explains how to use 3 of those 5
 *   2× UPDATE reels           — "AI updates that day" via the news pipeline
 * Every asset is branded Day N/100.
 *
 * Finished videos are moved out of temp/reels (which is auto-purged after 6h)
 * into temp/daily/<date>/ so a draft survives until you review it. The draft
 * manifest is persisted in data/drafts.json keyed by local date.
 */
const fs = require('fs');
const path = require('path');

const { pickFiveForToday, getChallengeStatus, todayKey, CHALLENGE_LENGTH } = require('./toolStore');
const { generateRundownScript, generateHowToScript, generateReelScript } = require('./reelScript');
const { composeReel } = require('./reelComposer');
const { fetchNewsArticle } = require('./newsScraper');
const { postReel } = require('./instagram');
const youtube = require('./youtube');

const DATA_DIR = path.join(__dirname, '../data');
const DRAFTS_FILE = path.join(DATA_DIR, 'drafts.json');
const DAILY_DIR = path.join(__dirname, '../temp/daily');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DAILY_DIR)) fs.mkdirSync(DAILY_DIR, { recursive: true });

// Topics rotated for the two daily "AI update" posts.
const UPDATE_TOPICS = ['OpenAI', 'Anthropic', 'Google AI', 'NVIDIA', 'AI funding', 'Meta AI', 'AI agents', 'AI regulation'];

// ── draft persistence ─────────────────────────────────────────────────────────
function loadDrafts() {
  try { if (fs.existsSync(DRAFTS_FILE)) return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch {}
  return {};
}
function saveDrafts(d) { fs.writeFileSync(DRAFTS_FILE, JSON.stringify(d, null, 2)); }
function saveDraft(draft) {
  const all = loadDrafts();
  all[draft.dateKey] = draft;
  saveDrafts(all);
}
function getDraft(dateKey = todayKey()) { return loadDrafts()[dateKey] || null; }
function listDrafts() {
  return Object.values(loadDrafts()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

// Move a finished reel out of the auto-purged temp/reels into temp/daily/<date>/.
function persistVideo(filepath, dateKey) {
  const destDir = path.join(DAILY_DIR, dateKey);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(filepath));
  try { fs.renameSync(filepath, dest); }
  catch { fs.copyFileSync(filepath, dest); try { fs.rmSync(filepath, { force: true }); } catch {} }
  return { filepath: dest, url: `/temp/daily/${dateKey}/${path.basename(dest)}` };
}

function newAsset(kind, slot, extra = {}) {
  return { id: `${slot}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, kind, slot, status: 'pending', ...extra };
}

// ── ONE reel: script → compose → persist → asset record ───────────────────────
async function renderReel({ script, host, dateKey, kind, slot, title, toolName, source, regen }) {
  const asset = newAsset(kind, slot, { title, toolName: toolName || null, host, source: source || null, regen: regen || null });
  try {
    const reel = await composeReel(script, { host });
    const moved = persistVideo(reel.filepath, dateKey);
    asset.status = 'ready';
    asset.videoUrl = moved.url;
    asset.videoPath = moved.filepath;
    asset.durationSec = reel.durationSec;
    asset.caption = script.caption;
    asset.badge = script.badge;
    asset.voice = script.narrationVoice;
    console.log(`[Daily] ✓ ${slot}: ${title} (${reel.durationSec}s)`);
  } catch (e) {
    asset.status = 'error';
    asset.error = e.message;
    asset.caption = script?.caption || '';
    console.log(`[Daily] ✗ ${slot} failed: ${e.message}`);
  }
  return asset;
}

/**
 * Generate (or regenerate) today's full draft bundle.
 * @param {{dateKey?:string, force?:boolean, howToCount?:number, updateCount?:number, skipVideo?:boolean}} opts
 */
async function generateDailyBundle(opts = {}) {
  const dateKey = opts.dateKey || todayKey();
  const howToCount = opts.howToCount ?? 3;
  const updateCount = opts.updateCount ?? 2;

  const existing = getDraft(dateKey);
  if (existing && existing.status === 'ready' && !opts.force) {
    console.log(`[Daily] Draft for ${dateKey} already exists (use force to rebuild)`);
    return existing;
  }

  const pick = await pickFiveForToday(dateKey);
  const day = pick.day;
  const tools = pick.tools;

  const draft = {
    dateKey, day, challengeLength: CHALLENGE_LENGTH,
    createdAt: new Date().toISOString(), status: 'generating',
    tools, assets: [],
  };
  saveDraft(draft);

  // If skipVideo: just record the planned scripts (fast, for previewing copy).
  if (opts.skipVideo) {
    draft.assets.push(newAsset('rundown', 'morning', { status: 'planned', title: `Day ${day}: ${tools.length} AI tools`, tools }));
    tools.slice(0, howToCount).forEach((t, i) =>
      draft.assets.push(newAsset('howto', `howto${i + 1}`, { status: 'planned', title: `How to use ${t.name}`, toolName: t.name })));
    draft.status = 'planned';
    saveDraft(draft);
    return draft;
  }

  // 1) Morning rundown reel — GIRL host, all 5 tools
  try {
    const rundown = await generateRundownScript(tools, { day, length: CHALLENGE_LENGTH });
    const a = await renderReel({ script: rundown, host: 'girl', dateKey, kind: 'rundown', slot: 'morning', title: rundown.title, regen: { type: 'rundown', day } });
    draft.assets.push(a);
  } catch (e) {
    draft.assets.push(newAsset('rundown', 'morning', { status: 'error', error: e.message, title: 'Morning rundown' }));
  }
  saveDraft(draft);

  // 2) Three HOW-TO reels — BOY host, first 3 of the 5 tools
  for (let i = 0; i < Math.min(howToCount, tools.length); i++) {
    const tool = tools[i];
    try {
      const script = await generateHowToScript(tool, { day });
      const a = await renderReel({ script, host: 'boy', dateKey, kind: 'howto', slot: `howto${i + 1}`, title: `How to use ${tool.name}`, toolName: tool.name, source: tool.url, regen: { type: 'howto', tool, day } });
      draft.assets.push(a);
    } catch (e) {
      draft.assets.push(newAsset('howto', `howto${i + 1}`, { status: 'error', error: e.message, title: `How to use ${tool.name}`, toolName: tool.name }));
    }
    saveDraft(draft);
  }

  // 3) Two AI-UPDATE reels — "updates that day"
  const usedUrls = [];
  const topics = [...UPDATE_TOPICS].sort(() => Math.random() - 0.5);
  let made = 0;
  for (const topic of topics) {
    if (made >= updateCount) break;
    try {
      const article = await fetchNewsArticle(topic, usedUrls);
      if (!article || !article.fullText || usedUrls.includes(article.url)) continue;
      usedUrls.push(article.url);
      const script = await generateReelScript(article, 'news');
      script.badge = `DAY ${day}`;                       // brand the update with the challenge day
      const regenArticle = { title: article.title, fullText: (article.fullText || '').slice(0, 4000), url: article.url };
      const a = await renderReel({ script, host: 'auto', dateKey, kind: 'update', slot: `update${made + 1}`, title: article.title, source: article.url, regen: { type: 'update', article: regenArticle, day } });
      draft.assets.push(a);
      made++;
    } catch (e) {
      console.log(`[Daily] update topic "${topic}" failed: ${e.message}`);
    }
    saveDraft(draft);
  }

  const errored = draft.assets.filter((a) => a.status === 'error').length;
  draft.status = errored && errored === draft.assets.length ? 'error' : 'ready';
  draft.finishedAt = new Date().toISOString();
  saveDraft(draft);
  console.log(`[Daily] Bundle ${dateKey} done — ${draft.assets.filter((a) => a.status === 'ready').length}/${draft.assets.length} assets ready (Day ${day}/${CHALLENGE_LENGTH})`);
  return draft;
}

// Patch one asset inside a persisted draft (approve / posted state).
function updateAsset(dateKey, assetId, patch) {
  const all = loadDrafts();
  const draft = all[dateKey];
  if (!draft) return null;
  const asset = (draft.assets || []).find((a) => a.id === assetId);
  if (!asset) return null;
  Object.assign(asset, patch);
  saveDrafts(all);
  return asset;
}

function getAsset(dateKey, assetId) {
  const draft = getDraft(dateKey);
  return draft?.assets?.find((a) => a.id === assetId) || null;
}

// ── PUBLISH one approved asset to chosen targets (used by route + Telegram) ────
async function publishAsset(dateKey, assetId, targets = ['instagram']) {
  const asset = getAsset(dateKey, assetId);
  if (!asset) throw new Error('Asset not found');
  if (!asset.videoPath) throw new Error('Asset has no video to publish');
  const want = Array.isArray(targets) && targets.length ? targets : ['instagram'];

  const results = {};
  for (const target of want) {
    try {
      if (target === 'instagram') {
        results.instagram = { ok: true, id: await postReel(asset.videoPath, asset.caption || '') };
      } else if (target === 'youtube') {
        const r = await youtube.uploadShort(asset.videoPath, { title: asset.title, description: asset.caption });
        results.youtube = { ok: true, ...r };
      }
    } catch (e) {
      results[target] = { ok: false, error: e.message };
    }
  }
  const postedTo = Object.entries(results).filter(([, v]) => v.ok).map(([k]) => k);
  updateAsset(dateKey, assetId, {
    approved: true, posted: postedTo.length > 0, postedTo, postResults: results, postedAt: new Date().toISOString(),
  });
  return { ok: postedTo.length > 0, results, postedTo };
}

// ── REGENERATE one asset, applying optional reviewer feedback ─────────────────
async function regenerateAsset(dateKey, assetId, feedback) {
  const draft = getDraft(dateKey);
  const asset = draft?.assets?.find((a) => a.id === assetId);
  if (!asset) throw new Error('Asset not found');
  const regen = asset.regen || {};

  let script, host = asset.host || 'auto';
  if (regen.type === 'howto') {
    script = await generateHowToScript(regen.tool, { day: regen.day, feedback }); host = 'boy';
  } else if (regen.type === 'rundown') {
    script = await generateRundownScript(draft.tools, { day: regen.day, length: CHALLENGE_LENGTH, feedback }); host = 'girl';
  } else if (regen.type === 'update') {
    script = await generateReelScript(regen.article, 'news', { feedback });
    if (regen.day) script.badge = `DAY ${regen.day}`; host = 'auto';
  } else {
    throw new Error('This asset has no regeneration context');
  }

  const reel = await composeReel(script, { host });
  const moved = persistVideo(reel.filepath, dateKey);
  if (asset.videoPath && asset.videoPath !== moved.filepath) { try { fs.rmSync(asset.videoPath, { force: true }); } catch {} }

  return updateAsset(dateKey, assetId, {
    status: 'ready', videoUrl: moved.url, videoPath: moved.filepath, durationSec: reel.durationSec,
    caption: script.caption, badge: script.badge, voice: script.narrationVoice,
    approved: false, posted: false, regeneratedAt: new Date().toISOString(), lastFeedback: feedback || null,
  });
}

module.exports = { generateDailyBundle, getDraft, listDrafts, getChallengeStatus, updateAsset, getAsset, publishAsset, regenerateAsset };
