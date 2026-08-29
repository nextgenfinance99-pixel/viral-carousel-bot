/**
 * hashtags.js — guarantees every post ships with usable hashtags.
 *
 * Two problems this exists to solve, both seen in real drafts:
 *
 * 1. Groq is asked for "EXACTLY 6 hashtags" and often ignores it. Every single
 *    rundown caption across four days shipped with zero. Prompt instructions are
 *    a request, not a guarantee — so hashtags are enforced here in code instead.
 *
 * 2. The tags it did produce were frequently useless: "#QwenImageEdit2509LoRAsFast2"
 *    has no search volume at all, and "#LTX2.3" is broken on Instagram, which
 *    terminates a tag at the first period. Both look like effort and do nothing.
 *
 * Strategy: a small mix beats a wall of tags. Instagram surfaces posts mainly on
 * watch time and saves, and treats tags as topic hints — so we ship a handful of
 * genuinely relevant ones spread across reach tiers, rather than 30 broad ones
 * that put a zero-follower account in competition with the entire platform.
 *   reach  — huge, we will not rank, but they label the topic
 *   mid    — realistic to surface in
 *   niche  — small enough that a new account can actually place
 */

// Tag banks per content pillar. Kept deliberately short: every tag here should be
// one a human would plausibly search or follow.
const BANK = {
  ai: {
    reach: ['ai', 'artificialintelligence', 'tech'],
    mid: ['aitools', 'aitoolsdaily', 'machinelearning', 'automation', 'futuretech', 'technews'],
    niche: ['freeaitools', 'aitoolsforbusiness', 'opensourceai', 'aiproductivity', 'buildwithai'],
  },
  jobs: {
    reach: ['jobs', 'hiring', 'career'],
    mid: ['jobsearch', 'jobalert', 'nowhiring', 'careergrowth', 'remotejobs'],
    niche: ['aijobs', 'techjobs', 'jobsearchtips', 'careerswitch', 'entryleveljobs'],
  },
  career: {
    reach: ['career', 'jobs', 'work'],
    mid: ['careeradvice', 'resumetips', 'interviewtips', 'careergrowth', 'linkedintips'],
    niche: ['resumewriting', 'jobinterviewtips', 'careerchange', 'upskilling', 'techcareers'],
  },
};

// Instagram tags are alphanumeric + underscore. A period, hyphen or space ends the
// tag, so "#LTX2.3" silently becomes "#LTX2" — worse than not tagging at all.
function sanitizeTag(raw) {
  const cleaned = String(raw || '')
    .replace(/^#+/, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
  // Minimum 2, not 3 — "#ai" is the single most relevant tag this account has.
  if (cleaned.length < 2 || cleaned.length > 30) return null;
  if (/^\d+$/.test(cleaned)) return null;      // a tag of digits is not searchable
  return cleaned;
}

// Reject tags nobody will ever search. A long tag that is essentially one product's
// full version string is dead weight; short branded ones are fine ("#midjourney").
function isSearchable(tag) {
  if (tag.length > 24) return false;
  const digits = (tag.match(/\d/g) || []).length;
  if (digits >= 4) return false;               // version numbers baked into the tag
  if (digits && tag.length > 16) return false; // long name + version
  return true;
}

/**
 * Build a hashtag set for one post.
 * @param {Object} opts
 *   pillar    — 'ai' | 'jobs' | 'career'
 *   toolName  — optional; a short tool name becomes a niche tag
 *   suggested — tags the model proposed (kept when they survive validation)
 *   count     — how many to return
 */
function buildHashtags({ pillar = 'ai', toolName = '', suggested = [], count = 8 } = {}) {
  const bank = BANK[pillar] || BANK.ai;
  const out = [];
  const seen = new Set();

  const add = (raw) => {
    if (out.length >= count) return;
    const tag = sanitizeTag(raw);
    if (!tag || seen.has(tag) || !isSearchable(tag)) return;
    seen.add(tag);
    out.push(tag);
  };

  // The tool's own name first — the one tag someone hunting that tool would use.
  if (toolName) add(toolName.replace(/[^a-zA-Z0-9]/g, ''));

  // Model suggestions next, but only the ones that survive validation.
  for (const s of suggested) add(s);

  // Then fill across tiers so the set spans reach levels rather than stacking tags
  // a new account cannot possibly rank for. Each tier gets its own budget and is
  // filled independently — a single ordered pass let niche+mid consume the whole
  // count and the broad tags never made it in at all.
  const budgets = [
    [bank.niche, Math.round(count * 0.4)],
    [bank.mid, Math.round(count * 0.35)],
    [bank.reach, Math.max(1, count - Math.round(count * 0.4) - Math.round(count * 0.35))],
  ];
  for (const [pool, budget] of budgets) {
    let taken = 0;
    for (const t of pool) {
      if (taken >= budget || out.length >= count) break;
      const before = out.length;
      add(t);
      if (out.length > before) taken++;
    }
  }
  // Top up from any tier if a budget could not be met (duplicates, short banks).
  for (const pool of [bank.niche, bank.mid, bank.reach]) {
    for (const t of pool) { if (out.length >= count) break; add(t); }
  }
  return out.slice(0, count);
}

// Pull any hashtags the model already wrote, and return the caption without them.
function splitCaption(caption) {
  const text = String(caption || '');
  const found = (text.match(/#[^\s#]+/g) || []).map((t) => t.slice(1));
  const body = text.replace(/#[^\s#]+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, found };
}

/**
 * Normalise a caption so it always ends with a valid hashtag block.
 * Safe to call on a caption that already has good tags — they are validated and
 * kept, not replaced.
 */
function ensureHashtags(caption, opts = {}) {
  const { body, found } = splitCaption(caption);
  const tags = buildHashtags({ ...opts, suggested: found });
  if (!tags.length) return body;
  return `${body}\n\n${tags.map((t) => `#${t}`).join(' ')}`;
}

module.exports = { ensureHashtags, buildHashtags, sanitizeTag, splitCaption, BANK };
