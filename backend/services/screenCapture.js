/**
 * screenCapture.js — records a tool's own page as B-roll footage.
 *
 * The reference reels the user wants to match show the real product on screen
 * while the voice describes it. This is the free, automatic way to get that: drive
 * a headless Chromium to the tool's URL and record it, so the footage is genuinely
 * the thing being talked about rather than stock imagery.
 *
 * Honest limits, so nobody expects more than this delivers:
 *   - It shows a page and scrolls it. It does NOT operate the tool — most require
 *     an account, and auto-driving an unknown UI produces nonsense on video.
 *   - Plenty of sites will fail (bot walls, timeouts, dead links). Every failure
 *     returns null and the reel falls back to the plain template. A missing clip
 *     must never cost us a finished reel.
 *
 * Privacy: a throwaway context per capture, so nothing is persisted between runs
 * and no browsing profile is built up. Consent banners are HIDDEN with CSS, never
 * clicked — clicking "Accept" would be consenting to tracking on the user's behalf,
 * which is not ours to give. Hiding one only stops it being filmed.
 */
const fs = require('fs');
const path = require('path');

const CAPTURE_DIR = path.join(__dirname, '../temp/broll');
if (!fs.existsSync(CAPTURE_DIR)) fs.mkdirSync(CAPTURE_DIR, { recursive: true });

// Overlays that would otherwise sit in the middle of every clip. Hidden, not clicked.
const HIDE_OVERLAYS_CSS = `
  [id*="cookie" i], [class*="cookie" i],
  [id*="consent" i], [class*="consent" i],
  [id*="gdpr" i], [class*="gdpr" i],
  [aria-label*="cookie" i], [role="dialog"],
  [class*="modal-backdrop" i], [class*="newsletter" i] {
    display: none !important;
  }
  html { scroll-behavior: auto !important; }
`;

/**
 * Find a usable Chromium.
 *
 * Playwright pins an exact browser build (1.59 wants 1217) and refuses to start if
 * only a different one is present — but this machine already has 1223 from another
 * project, and a newer build speaks the same protocol fine. Reusing it avoids a
 * ~130MB download for a capability that is a nice-to-have. Returns null to mean
 * "let Playwright use its own default", which is what happens in Docker where the
 * image installs the matching build.
 */
function resolveChromiumPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'ms-playwright');
  let dirs = [];
  try {
    dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-'));
  } catch { return null; }

  // Highest build number first — closest to what a current Playwright expects.
  dirs.sort((a, b) => (parseInt(b.split('-')[1], 10) || 0) - (parseInt(a.split('-')[1], 10) || 0));
  const candidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];
  for (const dir of dirs) {
    for (const parts of candidates) {
      const exe = path.join(root, dir, ...parts);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/**
 * Reject captures that filmed nothing.
 *
 * Hugging Face Spaces — a large share of the daily picks — boot the real app in an
 * iframe that often never starts in headless within any sane time budget, and a
 * sleeping Space never will. The capture "succeeds" and yields a white rectangle.
 * Shipping that as B-roll is worse than shipping none, so measure the frame: a
 * near-uniform image has almost no per-channel standard deviation.
 */
async function isUsableClip(clipPath) {
  const framePath = `${clipPath}.probe.png`;
  try {
    const { execFileSync } = require('child_process');
    // Sample from ~60% in, past any loading spinner at the head of the clip.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', clipPath, '-frames:v', '1', framePath],
      { timeout: 20000 });
    const sharp = require('sharp');
    const stats = await sharp(framePath).stats();
    const spread = Math.max(...stats.channels.map((c) => c.stdev));
    return spread > 12;   // empirically: blank page ~2-6, real page 30+
  } catch {
    return true;          // if the check itself fails, don't throw away a good clip
  } finally {
    try { fs.rmSync(framePath, { force: true }); } catch {}
  }
}

/**
 * Record one page.
 * @param {string} url
 * @param {Object} opts  { seconds, width, height, timeoutMs }
 * @returns {Promise<string|null>} path to a webm clip, or null if capture failed
 */
async function captureToolPage(url, opts = {}) {
  const {
    seconds = 6,
    width = 1080,
    height = 1200,     // the B-roll band, not a full phone screen
    timeoutMs = 20000,
  } = opts;

  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    console.log('[Broll] playwright not installed — skipping capture');
    return null;
  }

  const outDir = path.join(CAPTURE_DIR, `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  let browser = null;
  try {
    const launchOpts = { args: ['--autoplay-policy=no-user-gesture-required'] };
    const exe = resolveChromiumPath();
    if (exe) launchOpts.executablePath = exe;
    browser = await playwright.chromium.launch(launchOpts);
    const context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: outDir, size: { width, height } },
      // A normal UA — several sites serve a broken page to obvious automation,
      // which makes for useless footage.
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.addStyleTag({ content: HIDE_OVERLAYS_CSS }).catch(() => {});

    // Wait for the page to actually paint something. Hugging Face Spaces (a large
    // share of our picks) boot the real app in a lazy iframe, so a fixed short wait
    // filmed nothing but the header bar. Settle on network idle, with a hard cap so
    // a chatty page cannot stall the daily run.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // Only scroll if there is meaningfully more page than viewport. App pages (and
    // HF Spaces) are fixed-height, and scrolling them just pans into empty white.
    const scrollable = await page.evaluate(() => {
      const d = document.documentElement;
      return Math.max(0, (d.scrollHeight || 0) - window.innerHeight);
    }).catch(() => 0);

    const steps = Math.max(1, Math.round(seconds * 4));
    if (scrollable > height * 0.35) {
      // Cover at most 70% of the page so the clip never ends on the footer.
      const perStep = Math.max(40, Math.round((scrollable * 0.7) / steps));
      for (let i = 0; i < steps; i++) {
        await page.evaluate((d) => window.scrollBy(0, d), perStep).catch(() => {});
        await page.waitForTimeout(250);
      }
    } else {
      // Nothing to pan — hold on the app itself for the clip's length.
      await page.waitForTimeout(steps * 250);
    }

    await context.close();       // video is only flushed to disk on context close
    await browser.close();
    browser = null;

    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.webm'));
    if (!files.length) {
      console.log(`[Broll] no video produced for ${url}`);
      return null;
    }
    const clip = path.join(outDir, files[0]);
    if (!(await isUsableClip(clip))) {
      console.log(`[Broll] discarded ${url} — captured frame is effectively blank`);
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
      return null;
    }
    const kb = Math.round(fs.statSync(clip).size / 1024);
    console.log(`[Broll] ✓ captured ${url} (${kb}KB)`);
    return clip;
  } catch (e) {
    console.log(`[Broll] capture failed for ${url}: ${e.message.split('\n')[0].slice(0, 120)}`);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

/**
 * Capture several tools, one at a time.
 * Sequential on purpose: parallel Chromium instances spike memory, and this has to
 * survive on a 512MB Render instance alongside an FFmpeg encode.
 */
async function captureMany(urls, opts = {}) {
  const out = [];
  for (const url of urls) {
    if (!url) { out.push(null); continue; }
    out.push(await captureToolPage(url, opts));
  }
  return out;
}

function cleanOldCaptures(maxAgeMs = 6 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  try {
    for (const f of fs.readdirSync(CAPTURE_DIR)) {
      const fp = path.join(CAPTURE_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.rmSync(fp, { recursive: true, force: true }); } catch {}
    }
  } catch {}
}

module.exports = { captureToolPage, captureMany, cleanOldCaptures, CAPTURE_DIR };
