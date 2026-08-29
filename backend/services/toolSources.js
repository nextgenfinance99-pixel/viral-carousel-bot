/**
 * toolSources.js — pulls candidate AI TOOLS from many places and normalises them.
 *
 * Every source is wrapped so one failing/blocked/changed source can never break a
 * daily run (Promise.allSettled + per-source try/catch). Add a source by writing a
 * function that returns Promise<NormalisedTool[]> and listing it in gatherTools().
 *
 * Normalised tool shape:
 *   { name, tagline, description, url, source, category, isNew, launchedAt, votes }
 *
 * Env (all optional — sources self-skip when their key is absent):
 *   PRODUCTHUNT_TOKEN  - Product Hunt API v2 developer token (best "launched today" feed)
 *   GITHUB_TOKEN       - lifts GitHub search rate limit (works without, just throttled)
 */
const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

// ── Category inference (drives carousel grouping + deep-dive angle) ────────────
const CATEGORY_RULES = [
  ['Video',        ['video', 'reel', 'shorts', 'film', 'animation', 'avatar', 'lip-sync', 'lipsync']],
  ['Image',        ['image', 'photo', 'art', 'logo', 'design', 'diffusion', 'render', 'picture', 'thumbnail']],
  ['Voice',        ['voice', 'speech', 'tts', 'text-to-speech', 'dub', 'narrat']],
  ['Audio',        ['music', 'song', 'audio', 'sound', 'podcast', 'sfx']],
  ['Coding',       ['code', 'coding', 'developer', 'ide', 'programming', 'devtool', 'sdk', 'api ', 'agent', 'copilot']],
  ['Writing',      ['writing', 'copywriting', 'blog', 'essay', 'content', 'seo', 'grammar']],
  ['Productivity', ['productivity', 'notes', 'meeting', 'workflow', 'automation', 'spreadsheet', 'slides', 'presentation', 'email', 'calendar', 'crm']],
  ['Search',       ['search', 'research', 'answer', 'knowledge', 'rag']],
  ['Chatbot',      ['chatbot', 'assistant', 'chat ', 'llm', 'gpt', 'conversational']],
  ['Marketing',    ['marketing', 'ads', 'ad ', 'social media', 'campaign', 'growth', 'sales']],
  ['3D',           ['3d', 'blender', 'mesh', 'texture', 'game asset']],
  ['Data',         ['data', 'analytics', 'dashboard', 'chart', 'database', 'sql']],
];

function classifyCategory(text) {
  const t = (text || '').toLowerCase();
  for (const [cat, kws] of CATEGORY_RULES) {
    if (kws.some((k) => t.includes(k))) return cat;
  }
  return 'AI Tool';
}

// Words that mean "this is a tool/app", not a think-piece or news story.
const TOOL_SIGNALS = ['tool', 'app', 'launch', 'introducing', 'built', 'open source', 'open-source', 'free', 'generator', 'ai that', 'platform', 'made ', 'i built', 'we built', 'show hn'];

function looksLikeTool(text) {
  const t = (text || '').toLowerCase();
  return TOOL_SIGNALS.some((s) => t.includes(s));
}

// HN and Reddit hand back HTML-escaped text. It has to be decoded before it can
// reach a video frame, otherwise viewers literally read "There&#x27;s no shortage".
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // last — so "&amp;#x27;" doesn't decode twice
}

function norm(o) {
  return {
    name: decodeEntities(o.name).trim().slice(0, 80),
    tagline: decodeEntities(o.tagline).trim().slice(0, 200),
    description: decodeEntities(o.description || o.tagline).trim().slice(0, 1200),
    url: String(o.url || '').trim(),
    source: o.source || 'unknown',
    category: o.category || classifyCategory(`${o.name} ${o.tagline} ${o.description}`),
    isNew: o.isNew !== false,
    launchedAt: o.launchedAt || null,
    votes: Number(o.votes || 0),
  };
}

// ── 1) PRODUCT HUNT (best daily-launch feed) ──────────────────────────────────
// Uses the public Atom feed, not the GraphQL API. The API needs a
// PRODUCTHUNT_TOKEN that was never set, so this source silently contributed
// nothing for the whole life of the project. The feed is keyless, needs no
// account, and carries the tagline — which is the part the quality gate needs.
async function fromProductHunt() {
  try {
    const res = await axios.get('https://www.producthunt.com/feed', { headers: HEADERS, timeout: 12000 });
    const $ = cheerio.load(res.data, { xmlMode: true });   // Atom: <entry>, not <item>
    const out = [];
    $('entry').each((_, el) => {
      const name = $(el).find('title').first().text().trim();
      const url = $(el).find('link').first().attr('href') || '';
      // The feed appends "Discussion | Link" navigation to every entry body.
      const desc = $(el).find('content').first().text()
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s*Discussion\s*\|\s*Link\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name || !url) return;
      out.push(norm({
        name, tagline: desc, description: desc, url,
        source: 'ProductHunt', isNew: true,
        launchedAt: $(el).find('published').first().text() || null,
      }));
    });
    return out;
  } catch (e) {
    console.log(`[ToolSrc] ProductHunt failed: ${e.message}`);
    return [];
  }
}

// ── 2) SHOW HN (Algolia) — makers launching tools ─────────────────────────────
async function fromShowHN() {
  try {
    const since = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>${since}&hitsPerPage=60`;
    const res = await axios.get(url, { timeout: 9000 });
    return (res.data.hits || [])
      .filter((h) => h.url && h.title)
      .filter((h) => /\bai\b|gpt|llm|agent|generat|model|machine learning|diffusion|voice|image|video/i.test(`${h.title} ${h.story_text || ''}`))
      .map((h) => norm({
        // Cut the title at the first real separator only. Splitting on a bare
        // hyphen used to mangle hyphenated product names ("Multi-LLM" → "Multi").
        name: h.title.replace(/^show hn:\s*/i, '').split(/\s+[–—|]\s+|\s+-\s+|:\s+|,\s+/)[0].trim(),
        tagline: h.title.replace(/^show hn:\s*/i, ''),
        description: (h.story_text || '').replace(/<[^>]+>/g, '').slice(0, 800),
        url: h.url, source: 'ShowHN', votes: h.points || 0, isNew: true,
        launchedAt: h.created_at,
      }));
  } catch (e) {
    console.log(`[ToolSrc] ShowHN failed: ${e.message}`);
    return [];
  }
}

// ── 3) GITHUB — newly created, fast-rising open-source AI repos ────────────────
async function fromGitHub() {
  try {
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const q = `topic:ai created:>${since} stars:>40`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': UA };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await axios.get(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=25`,
      { headers, timeout: 10000 }
    );
    return (res.data.items || []).map((r) => norm({
      name: r.name, tagline: r.description || '', description: r.description || '',
      url: r.html_url, source: 'GitHub', votes: r.stargazers_count || 0, isNew: true,
      launchedAt: r.created_at, category: 'Coding',
    }));
  } catch (e) {
    console.log(`[ToolSrc] GitHub failed: ${e.message}`);
    return [];
  }
}

// ── 4) REDDIT — new self/link posts from AI builder subs ──────────────────────
const REDDIT_SUBS = [
  'artificial', 'AItools', 'LocalLLaMA', 'OpenAI', 'SideProject',
  'StableDiffusion', 'machinelearningnews', 'ChatGPT', 'aipromptprogramming',
];
const REDDIT_UA = 'web:developschl-toolbot:1.0 (by /u/developschl)';

// Reddit blocks the anonymous .json endpoint from many IPs (403). With a free
// "script" app (REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET) we get a userless OAuth
// token and hit oauth.reddit.com reliably. Token cached for its ~1h lifetime.
let _redditToken = { value: null, exp: 0 };
async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_redditToken.value && Date.now() < _redditToken.exp) return _redditToken.value;
  try {
    const res = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      { auth: { username: id, password: secret }, headers: { 'User-Agent': REDDIT_UA, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 9000 }
    );
    _redditToken = { value: res.data.access_token, exp: Date.now() + (res.data.expires_in - 60) * 1000 };
    return _redditToken.value;
  } catch (e) {
    console.log(`[ToolSrc] Reddit auth failed: ${e.message}`);
    return null;
  }
}

async function fromReddit() {
  const out = [];
  const token = await redditToken();

  // Reddit answers 403 to the anonymous .json endpoint from most server IPs, which
  // silently killed this source. The per-subreddit RSS feed is still served without
  // credentials, so it is the keyless fallback; OAuth is still preferred when
  // REDDIT_CLIENT_ID/SECRET are set, because it returns richer fields.
  await Promise.all(REDDIT_SUBS.map(async (sub) => {
    try {
      if (token) {
        const res = await axios.get(`https://oauth.reddit.com/r/${sub}/new.json?limit=25`, {
          headers: { 'User-Agent': REDDIT_UA, Authorization: `Bearer ${token}` }, timeout: 9000,
        });
        for (const p of res.data?.data?.children || []) {
          const d = p.data || {};
          const ext = d.url_overridden_by_dest || d.url || '';
          if (!ext || /reddit\.com|redd\.it|imgur|youtube|youtu\.be/i.test(ext)) continue;
          if (!looksLikeTool(`${d.title} ${d.selftext || ''}`)) continue;
          out.push(norm({
            name: (d.title || '').split(/[–—\-|:]/)[0].trim().slice(0, 80),
            tagline: d.title, description: (d.selftext || '').slice(0, 800),
            url: ext, source: `Reddit r/${sub}`, votes: d.ups || 0, isNew: true,
            launchedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
          }));
        }
        return;
      }

      const res = await axios.get(`https://www.reddit.com/r/${sub}/new.rss?limit=25`, {
        headers: HEADERS, timeout: 9000,
      });
      const $ = cheerio.load(res.data, { xmlMode: true });
      $('entry').each((_, el) => {
        const title = $(el).find('title').first().text().trim();
        const html = $(el).find('content').first().text();
        const body = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!title || !looksLikeTool(`${title} ${body}`)) return;

        // The feed's own <link> is the comments page, and reddit.com URLs are
        // rejected downstream — the tool's actual URL is an anchor inside content.
        let ext = null;
        for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
          const href = m[1].replace(/&amp;/g, '&');
          if (!/reddit\.com|redd\.it|imgur|youtube|youtu\.be|\.png|\.jpg|\.gif/i.test(href)) { ext = href; break; }
        }
        if (!ext) return;   // self-post with no outbound link: nothing to feature

        out.push(norm({
          name: title.split(/\s+[–—|]\s+|\s+-\s+|:\s+/)[0].trim().slice(0, 80),
          tagline: title, description: body.slice(0, 800),
          url: ext, source: `Reddit r/${sub}`, isNew: true,
          launchedAt: $(el).find('updated').first().text() || null,
        }));
      });
    } catch (e) {
      console.log(`[ToolSrc] Reddit r/${sub} failed: ${e.message}`);
    }
  }));
  return out;
}

// ── 5) HUGGING FACE — trending Spaces (new runnable AI apps) ───────────────────
// `full=true` is what makes this source usable: it returns cardData.title (a real
// human title, e.g. "Bonsai 27B WebGPU Kernels") and cardData.short_description
// (what the Space actually does). Without it the API only gives the slug, and a
// slug is not something a script writer can describe honestly.
async function fromHuggingFace() {
  try {
    const res = await axios.get('https://huggingface.co/api/spaces?sort=trendingScore&direction=-1&limit=40&full=true', {
      headers: HEADERS, timeout: 12000,
    });
    return (res.data || [])
      .filter((s) => s.id)
      .map((s) => {
        const slug = s.id.split('/').pop().replace(/[-_]/g, ' ');
        const title = (s.cardData?.title || '').trim() || slug;
        const blurb = (s.cardData?.short_description || '').trim();
        return norm({
          name: title,
          tagline: blurb,
          description: blurb,          // no blurb → dropped by the quality gate
          url: `https://huggingface.co/spaces/${s.id}`, source: 'HuggingFace',
          votes: s.likes || 0, isNew: true,
        });
      });
  } catch (e) {
    console.log(`[ToolSrc] HuggingFace failed: ${e.message}`);
    return [];
  }
}

// ── DIRECTORY SCRAPERS — removed 2026-08-28 ───────────────────────────────────
// TheresAnAIForThat and Toolify both sit behind Cloudflare and answer 403 to any
// server-side request. Futurepedia still returns HTTP 200, but its markup changed
// and the selector matches zero links — the worst kind of dead source, because a
// healthy status code hides it. All three were costing latency on every run and
// contributing nothing, so they are gone rather than left to look functional.
// Replacing them would need a headless browser per directory, which is a lot of
// runtime for listings the other sources already surface.

// ── QUALITY GATE ──────────────────────────────────────────────────────────────
// A tool is only publishable if we actually know what it does. When the script
// writer is handed a bare slug it invents the details instead of admitting it has
// none — that is how a reel titled "How to use boo" (a terminal multiplexer) got
// rendered. Both checks below are cheap, and rejecting a tool costs nothing while
// rendering a junk one costs a full TTS + FFmpeg pass.

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

// Description must be substantive AND say something the name doesn't already say.
function hasRealDescription(t) {
  const desc = String(t.description || '').trim();
  if (desc.length < 25) return false;
  const dWords = words(desc);
  if (dWords.length < 5) return false;
  const nameWords = new Set(words(t.name));
  const novel = dWords.filter((w) => !nameWords.has(w));
  return novel.length >= 3;
}

// Upstream topic/subreddit filters are not enough — repos get mis-tagged `ai` and
// generic dev tools slip through. Require an AI signal in the text itself.
const AI_TERMS = new RegExp(
  '\\b(' + [
    'ai', 'a\\.i\\.', 'artificial intelligence', 'machine learning', 'deep learning',
    'llm', 'llms', 'gpt', 'chatgpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen',
    'transformer', 'neural', 'diffusion', 'embedding', 'embeddings', 'rag',
    'agent', 'agents', 'agentic', 'prompt', 'prompts', 'fine-?tun\\w*', 'inference',
    'text-to-\\w+', 'speech-to-\\w+', 'image-to-\\w+', 'tts', 'stt', 'asr',
    'voice clone\\w*', 'generative', 'copilot', 'multimodal', 'vision model',
    'whisper', 'openai', 'anthropic', 'hugging ?face', 'stable diffusion',
    'chatbot', 'summariz\\w+', 'transcrib\\w+',
  ].join('|') + ')\\b', 'i'
);

function isAiRelevant(t) {
  return AI_TERMS.test(`${t.name} ${t.tagline} ${t.description}`);
}

// ── ORCHESTRATOR ──────────────────────────────────────────────────────────────
async function gatherTools() {
  const sources = [fromProductHunt, fromShowHN, fromGitHub, fromReddit, fromHuggingFace];
  const settled = await Promise.allSettled(sources.map((fn) => fn()));
  const all = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

  const rejected = { shape: 0, noDescription: 0, notAi: 0 };
  const clean = all.filter((t) => {
    if (!t.name || !t.url || t.name.length <= 1) { rejected.shape++; return false; }
    if (!hasRealDescription(t)) { rejected.noDescription++; return false; }
    if (!isAiRelevant(t)) { rejected.notAi++; return false; }
    return true;
  });

  // Log per-source survivors so a source that quietly rots (or starts returning
  // slugs again) is visible in the daily run instead of silently degrading picks.
  const bySource = clean.reduce((acc, t) => { acc[t.source] = (acc[t.source] || 0) + 1; return acc; }, {});
  console.log(`[ToolSrc] Gathered ${all.length} raw → ${clean.length} passed the quality gate`);
  console.log(`[ToolSrc] Rejected: ${rejected.noDescription} no-description, ${rejected.notAi} not-AI, ${rejected.shape} malformed`);
  console.log(`[ToolSrc] Survivors by source: ${JSON.stringify(bySource)}`);
  // Name any source that produced nothing. Futurepedia sat in the rotation for
  // months answering HTTP 200 with zero usable links, and nothing said so — a
  // source that yields nothing looks identical to a quiet day unless we check.
  const dead = sources
    .map((fn, i) => [fn.name.replace(/^from/, ''), settled[i]])
    .filter(([, r]) => r.status !== 'fulfilled' || !r.value.length)
    .map(([name]) => name);
  if (dead.length) console.log(`[ToolSrc] ⚠️ produced nothing this run: ${dead.join(', ')}`);
  if (!clean.length) console.log('[ToolSrc] ⚠️ every source failed the gate — picks will fall back to the seed pool');
  return clean;
}

// isPublishable is exported so the store can re-apply the gate to records that
// were ingested before it existed, instead of serving them forever.
function isPublishable(t) {
  return !!(t && t.name && t.url && t.name.length > 1 && hasRealDescription(t) && isAiRelevant(t));
}

module.exports = { gatherTools, classifyCategory, isPublishable, hasRealDescription, isAiRelevant };
