const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { generateReelScript } = require('../services/reelScript');
const { composeReel } = require('../services/reelComposer');
const { fetchNewsArticle, fetchTrendingArticle } = require('../services/newsScraper');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const AVATARS_DIR = path.join(__dirname, '../assets/avatars');
const INTRO_CFG = path.join(__dirname, '../assets/intro.json');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const VALID_SLOTS = ['host', 'boy', 'girl'];

// ── Upload a host / avatar image (saved as <slot>.png) ────────────────────────
router.post('/asset', upload.single('image'), async (req, res) => {
  const slot = String(req.body.slot || '').toLowerCase();
  if (!VALID_SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${VALID_SLOTS.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'image file is required' });
  try {
    const outPath = path.join(AVATARS_DIR, `${slot}.png`);
    await sharp(req.file.buffer).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).png().toFile(outPath);
    res.json({ ok: true, slot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Which avatar slots are present ────────────────────────────────────────────
router.get('/assets', (req, res) => {
  const present = {};
  for (const slot of VALID_SLOTS) present[slot] = fs.existsSync(path.join(AVATARS_DIR, `${slot}.png`));
  res.json(present);
});

// ── Read / write the intro config ─────────────────────────────────────────────
router.get('/intro', (req, res) => {
  let cfg = { enabled: true, image: 'host.png', text: 'AI TOOL OF THE DAY', narration: '' };
  if (fs.existsSync(INTRO_CFG)) { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(INTRO_CFG, 'utf8')) }; } catch {} }
  res.json(cfg);
});

router.post('/intro', (req, res) => {
  const { enabled, text, narration } = req.body || {};
  const cfg = {
    enabled: enabled !== false,
    image: 'host.png',
    text: String(text || 'AI TOOL OF THE DAY').slice(0, 60),
    narration: String(narration || '').slice(0, 300),
  };
  try {
    fs.writeFileSync(INTRO_CFG, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, intro: cfg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reel/generate
// Body (one of):
//   { tool: { name, tagline, description, url } }   → AI tool spotlight
//   { topic: "video generation" }                   → scrape best AI article on topic
//   { trending: true }                              → top trending AI/tech story
//   { article: { title, source, fullText, url } }   → pre-supplied content
router.post('/generate', async (req, res) => {
  const { tool, topic, trending, article, host } = req.body || {};

  try {
    // 1) Resolve the subject + angle
    let subject, kind;
    if (tool && (tool.name || tool.title)) {
      subject = {
        title:    tool.name || tool.title,
        tagline:  tool.tagline || '',
        fullText: tool.description || tool.fullText || tool.tagline || '',
        url:      tool.url || '',
      };
      kind = 'tool';
    } else if (article && article.title) {
      subject = article;
      kind = 'news';
    } else if (topic) {
      subject = await fetchNewsArticle(topic);
      kind = 'news';
    } else if (trending) {
      subject = await fetchTrendingArticle();
      kind = 'news';
    } else {
      return res.status(400).json({ error: 'Provide one of: tool, topic, trending, or article' });
    }

    // 2) Script → 3) Video
    const script = await generateReelScript(subject, kind);
    const reel = await composeReel(script, { host: host || 'auto' });

    res.json({
      script: {
        title:   script.title || subject.title,
        hook:    script.hook,
        badge:   script.badge,
        beats:   script.beats,
        caption: script.caption,
        cta:     script.cta,
        voice:   script.narrationVoice,
        music:   script.musicMood,
      },
      videoUrl:    `/temp/reels/${reel.filename}`,
      videoPath:   reel.filepath,
      durationSec: reel.durationSec,
      source:      subject.url || null,
    });
  } catch (err) {
    console.error('[Reel] generate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
