const express = require('express');
const router = express.Router();

const { ingest, getChallengeStatus } = require('../services/toolStore');
const { generateDailyBundle, getDraft, listDrafts, updateAsset } = require('../services/dailyChallenge');
const { postReel } = require('../services/instagram');
const youtube = require('../services/youtube');
const telegramReview = require('../services/telegramReview');

// Track an in-flight generation so the UI can show a spinner and avoid double runs.
let generating = { active: false, dateKey: null, startedAt: null, lastError: null };

// ── STATUS: challenge day + today's draft + capabilities ──────────────────────
router.get('/status', (req, res) => {
  res.json({
    challenge: getChallengeStatus(),
    draft: getDraft(),
    generating,
    capabilities: { youtube: youtube.isConfigured(), instagram: !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID) },
  });
});

router.get('/draft', (req, res) => {
  const d = getDraft(req.query.date);
  if (!d) return res.status(404).json({ error: 'No draft for that date' });
  res.json(d);
});

router.get('/drafts', (req, res) => {
  res.json(listDrafts().map((d) => ({
    dateKey: d.dateKey, day: d.day, status: d.status,
    assetCount: (d.assets || []).length,
    ready: (d.assets || []).filter((a) => a.status === 'ready').length,
  })));
});

// ── INGEST: refresh the tool store from all live sources ──────────────────────
router.post('/ingest', async (req, res) => {
  try { res.json(await ingest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GENERATE: build today's bundle (async; poll /status or /draft) ────────────
router.post('/generate', async (req, res) => {
  if (generating.active) return res.status(409).json({ error: 'Already generating', generating });
  const opts = {
    force: req.body?.force === true,
    howToCount: req.body?.howToCount,
    updateCount: req.body?.updateCount,
    skipVideo: req.body?.skipVideo === true,
  };
  generating = { active: true, dateKey: null, startedAt: new Date().toISOString(), lastError: null };
  // Kick off in the background — bundle generation takes minutes (6 renders).
  (async () => {
    try {
      const draft = await generateDailyBundle(opts);
      generating = { active: false, dateKey: draft.dateKey, startedAt: generating.startedAt, lastError: null };
      // Send the finished draft to Telegram for review (no-op if not configured).
      if (telegramReview.isOn()) telegramReview.pushDraft(draft).catch((e) => console.log('[Telegram] pushDraft failed:', e.message));
    } catch (e) {
      console.error('[Daily] generate failed:', e.message);
      generating = { active: false, dateKey: null, startedAt: generating.startedAt, lastError: e.message };
    }
  })();
  res.json({ started: true });
});

// ── APPROVE / REJECT an asset (review gate) ───────────────────────────────────
router.post('/approve', (req, res) => {
  const { date, assetId, approved } = req.body || {};
  const asset = updateAsset(date, assetId, { approved: approved !== false, approvedAt: new Date().toISOString() });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json({ ok: true, asset });
});

// ── PUBLISH an approved asset to chosen targets, now ──────────────────────────
router.post('/publish', async (req, res) => {
  const { date, assetId, targets } = req.body || {};
  const draft = getDraft(date);
  const asset = draft?.assets?.find((a) => a.id === assetId);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (!asset.videoPath) return res.status(400).json({ error: 'Asset has no video to publish' });
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
  updateAsset(date, assetId, {
    posted: postedTo.length > 0, postedTo, postResults: results, postedAt: new Date().toISOString(),
  });
  res.json({ ok: postedTo.length > 0, results });
});

module.exports = router;
