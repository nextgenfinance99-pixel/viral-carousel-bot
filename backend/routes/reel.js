const express = require('express');
const router = express.Router();
const { generateReelScript } = require('../services/reelScript');
const { composeReel } = require('../services/reelComposer');
const { fetchNewsArticle, fetchTrendingArticle } = require('../services/newsScraper');

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
