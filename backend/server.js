require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { cleanOldImages } = require('./services/imageComposer');
const { cleanOldReels } = require('./services/reelComposer');
const { autoResume } = require('./services/scheduler');
const { postCarousel } = require('./services/instagram');
const postQueue = require('./services/postQueue');

const scrapeRoutes         = require('./routes/scrape');
const generateRoutes       = require('./routes/generate');
const generateCustomRoutes = require('./routes/generateCustom');
const instagramRoutes      = require('./routes/instagram');
const schedulerRoutes      = require('./routes/scheduler');
const trendingRoutes       = require('./routes/trending');
const queueRoutes          = require('./routes/queue');
const reelRoutes           = require('./routes/reel');
const dailyRoutes          = require('./routes/daily');
const cron                 = require('node-cron');
const { ingest }           = require('./services/toolStore');
const { generateDailyBundle } = require('./services/dailyChallenge');
const telegramReview       = require('./services/telegramReview');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Serve generated slide images
app.use('/temp', express.static(path.join(__dirname, 'temp')));

app.use('/api/scrape', scrapeRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/generate-custom', generateCustomRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/reel', reelRoutes);
app.use('/api/daily', dailyRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── QUEUE PROCESSOR — runs every 60 seconds ───────────────────────────────────
async function processQueue() {
  const due = postQueue.getPending();
  for (const item of due) {
    console.log(`[Queue] Firing scheduled post: "${item.title}" (id=${item.id})`);
    try {
      await postCarousel(item.imagePaths, item.caption);
      postQueue.updateStatus(item.id, 'posted');
      console.log(`[Queue] ✓ Posted: ${item.id}`);
    } catch (e) {
      postQueue.updateStatus(item.id, 'failed', e.message);
      console.log(`[Queue] ✗ Failed: ${item.id} — ${e.message}`);
    }
  }
}

setInterval(processQueue, 60 * 1000);

// Clean old temp images + reels every hour
setInterval(cleanOldImages, 60 * 60 * 1000);
setInterval(cleanOldReels, 60 * 60 * 1000);

// ── DAILY CHALLENGE — generate (NOT post) one draft bundle each morning ───────
// Opt-in via DAILY_AUTOGEN=true. The draft lands in the dashboard for review;
// nothing is published automatically. DAILY_CRON defaults to 6am; SCHEDULE_TZ
// controls the timezone (e.g. "Asia/Kolkata").
if (process.env.DAILY_AUTOGEN === 'true') {
  const dailyCron = process.env.DAILY_CRON || '0 6 * * *';
  const tz = process.env.SCHEDULE_TZ || undefined;
  cron.schedule(dailyCron, async () => {
    try {
      console.log('[Daily] Morning run: ingesting tools…');
      await ingest();
      console.log('[Daily] Generating today\'s draft bundle…');
      const draft = await generateDailyBundle({ force: false });
      if (telegramReview.isOn()) await telegramReview.pushDraft(draft);
    } catch (e) {
      console.error('[Daily] Morning run failed:', e.message);
    }
  }, tz ? { timezone: tz } : {});
  console.log(`[Daily] Auto-generate ON — schedule: ${dailyCron} (tz: ${tz || 'server local'}), review-only (no auto-post).`);

  // CATCH-UP. node-cron only fires while the process is alive, so on a laptop that
  // was asleep or shut down at the scheduled time the day is simply lost — and the
  // whole premise is a daily cadence. On boot, if today has no draft yet, build one.
  //
  // Deliberately not a "missed run" queue: only ever one draft for today, never a
  // backlog of old days nobody wants to post. generateDailyBundle is already
  // idempotent per date, so a restart mid-morning cannot produce a second draft.
  setTimeout(async () => {
    try {
      const { getDraft } = require('./services/dailyChallenge');
      const { todayKey } = require('./services/toolStore');
      const key = todayKey();
      const existing = getDraft(key);
      if (existing && existing.status === 'ready') {
        console.log(`[Daily] Catch-up: draft for ${key} already exists — nothing to do.`);
        return;
      }
      console.log(`[Daily] Catch-up: no draft for ${key} yet — building one now.`);
      await ingest();
      const draft = await generateDailyBundle({ force: false });
      if (telegramReview.isOn()) await telegramReview.pushDraft(draft);
    } catch (e) {
      console.error('[Daily] Catch-up run failed:', e.message);
    }
  }, 20000);   // let the server settle and Telegram connect first
} else {
  console.log('[Daily] Auto-generate OFF (set DAILY_AUTOGEN=true to build a draft each morning).');
}

// ── INSTAGRAM TOKEN UPKEEP ────────────────────────────────────────────────────
// Long-lived tokens expire after 60 days, and an expired one CANNOT be refreshed
// — it has to be regenerated by hand in the Meta app. One expired overnight and
// the morning's reels failed to publish with a bare 400. Refresh daily, well
// before expiry, and report health on boot so a dying token is visible early.
const instagramToken = require('./services/instagramToken');
cron.schedule('0 4 * * *', async () => {
  const r = await instagramToken.refreshIfNeeded();
  if (r.refreshed) return;
  if (/expired/i.test(r.reason || '') && telegramReview.isOn()) {
    await telegramReview.notify(
      '⚠️ <b>Instagram token has expired.</b>\nPosting is blocked until a new long-lived token is generated in the Meta app and put in INSTAGRAM_ACCESS_TOKEN.'
    ).catch(() => {});
  }
}, process.env.SCHEDULE_TZ ? { timezone: process.env.SCHEDULE_TZ } : {});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  autoResume();
  telegramReview.start(); // Telegram review bot (no-op unless TELEGRAM_* env set)
  instagramToken.checkHealth().then((h) => {
    if (!h.ok) return;
    // Top it up on boot too, in case the machine was off across the cron window.
    instagramToken.refreshIfNeeded().catch(() => {});
  });
});
