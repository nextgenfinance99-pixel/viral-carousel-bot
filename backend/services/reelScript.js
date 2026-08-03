const Groq = require('groq-sdk');
const { ensureHashtags } = require('./hashtags');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── JSON cleanup (mirrors gemini.js robustness) ───────────────────────────────
function parseLenientJSON(raw) {
  let text = String(raw || '').trim()
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  text = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  try {
    return JSON.parse(text);
  } catch {
    text = text.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : ''));
    return JSON.parse(text);
  }
}

/**
 * Turn an AI tool or news item into a vertical-reel script.
 *
 * @param {Object} source
 * @param {string} source.title    - tool name OR article headline
 * @param {string} [source.tagline]- one-line "what it is" (tools)
 * @param {string} [source.fullText]- description / article body
 * @param {string} [source.url]    - link
 * @param {('tool'|'news')} [kind] - changes the angle
 * @returns {Promise<{hook, beats, caption, cta, narrationVoice, musicMood}>}
 */
async function generateReelScript(source, kind = 'tool', opts = {}) {
  const title   = source.title || source.name || 'this AI tool';
  const body    = (source.fullText || source.tagline || source.summary || '').slice(0, 4000);

  const angle = kind === 'news'
    ? `This is an AI NEWS update. Make it feel urgent and "did you hear this?".`
    : `This is an AI TOOL spotlight. Sell the "you can do X in seconds, free" angle. Emphasise it's lesser-known / open-source / free where true.`;

  const feedback = opts.feedback
    ? `\n\nREVIEWER REQUESTED CHANGES — you MUST apply this feedback to the rewrite: "${opts.feedback}"\n`
    : '';

  const prompt = `You are a viral short-form video (Reels/Shorts/TikTok) scriptwriter for a faceless AI channel.

TOPIC: ${title}
${source.url ? `LINK: ${source.url}` : ''}
DETAILS: ${body}

${angle}${feedback}

Write a punchy 25-40 second vertical video script as a sequence of BEATS (scenes).
Each beat = one on-screen card. The narration of all beats read together must flow as ONE continuous voiceover.

HARD RULES:
- 4 to 6 beats total.
- Beat 1 is the HOOK: a scroll-stopping line (max 8 words). No greetings, no "in this video".
- Each beat has:
    - "onscreen": 2-6 word BIG text shown on the card (punchy, not a full sentence).
    - "narration": 1 spoken sentence (8-18 words) that expands the on-screen text.
- The LAST beat is a CTA: tell them to follow for more AI tools/updates.
- Never invent fake stats, prices, or features. If unsure, stay general.
- Conversational, energetic, plain English. No emojis in narration. No hashtags in narration.

Return ONLY valid JSON:
{
  "hook": "the beat-1 on-screen hook text",
  "badge": "ONE short tag shown top-of-screen, e.g. FREE AI TOOL | NEW | AI UPDATE | OPEN SOURCE (max 14 chars)",
  "beats": [
    { "onscreen": "BIG TEXT", "narration": "one spoken sentence." }
  ],
  "caption": "1-2 line scroll-stopping caption for the post, then a newline, then EXACTLY 6 relevant hashtags",
  "cta": "Follow for daily AI tools",
  "narrationVoice": "one of: female_energetic | male_deep | female_calm",
  "musicMood": "one of: upbeat | tech | chill | epic"
}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You write viral faceless short-form video scripts. You ALWAYS respond with valid JSON only — no markdown, no commentary.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const parsed = parseLenientJSON(completion.choices[0].message.content);

  // ── Normalise / harden ──────────────────────────────────────────────────────
  let beats = Array.isArray(parsed.beats) ? parsed.beats : [];
  beats = beats
    .map((b) => ({
      onscreen: String(b.onscreen || '').trim().slice(0, 60),
      narration: String(b.narration || '').trim(),
    }))
    .filter((b) => b.onscreen && b.narration)
    .slice(0, 6);

  if (beats.length < 2) {
    throw new Error('Script generation returned too few beats');
  }

  return {
    hook:           parsed.hook || beats[0].onscreen,
    badge:          String(parsed.badge || (kind === 'news' ? 'AI UPDATE' : 'AI TOOL'))
                      .toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 14),
    beats,
    // Hashtags are enforced rather than requested — the model routinely ignored the
    // "EXACTLY 6 hashtags" instruction, and every rundown shipped with none.
    caption:        ensureHashtags(parsed.caption || title, { pillar: 'ai' }),
    cta:            parsed.cta || 'Follow for daily AI tools',
    narrationVoice: ['female_energetic', 'male_deep', 'female_calm'].includes(parsed.narrationVoice)
                      ? parsed.narrationVoice : 'female_energetic',
    musicMood:      ['upbeat', 'tech', 'chill', 'epic'].includes(parsed.musicMood)
                      ? parsed.musicMood : 'tech',
  };
}

/**
 * RUNDOWN script — the morning "all 5 tools" reel narrated by the GIRL host.
 * One beat per tool (onscreen = tool name) bookended by a hook + CTA, so the
 * carousel/reel "discloses all 5". Beats are built deterministically (names are
 * never hallucinated); Groq only writes the punchy narration + caption, and we
 * fall back to taglines if Groq is unavailable.
 *
 * @param {Array<{name,tagline,description,category,url}>} tools  exactly the day's picks
 * @param {{day?:number, length?:number}} [opts]
 */
async function generateRundownScript(tools, opts = {}) {
  const list = (tools || []).slice(0, 6);
  if (!list.length) throw new Error('generateRundownScript: no tools given');
  const day = opts.day || null;
  const dayTag = day ? `Day ${day}${opts.length ? '/' + opts.length : ''}` : '';

  // Ask Groq for narration lines (same order/length as tools) + framing copy.
  let hook = `${list.length} AI TOOLS TODAY`;
  let lines = list.map((t) => (t.tagline || t.description || `${t.name} — a new AI tool`).slice(0, 140));
  let cta = 'Follow for 5 new AI tools every day';
  let caption = '';

  try {
    const toolBlock = list.map((t, i) => `${i + 1}. ${t.name} [${t.category || 'AI'}] — ${t.tagline || t.description || ''}`).join('\n');
    const fb = opts.feedback ? `\nREVIEWER REQUESTED CHANGES — apply this feedback: "${opts.feedback}"\n` : '';
    const prompt = `You are scripting a fast, punchy vertical reel that rattles off ${list.length} AI tools for a faceless AI channel (DEVELOPSCHL). ${dayTag ? `This is ${dayTag} of a 100-day AI challenge.` : ''}${fb}

THE ${list.length} TOOLS (in this exact order):
${toolBlock}

Write a ONE-LINE spoken narration for each tool (8-16 words): say what it does and why it's worth trying. Energetic, plain English, no emojis, no hashtags, never invent fake stats or prices.

Return ONLY valid JSON:
{
  "hook": "scroll-stopping opener, max 6 words, e.g. '5 AI tools you slept on'",
  "lines": ["narration for tool 1", "... tool 2", "... in the SAME order, exactly ${list.length} items"],
  "cta": "one line telling them to follow + save for daily AI tools",
  "caption": "1-2 line caption then a newline then EXACTLY 6 relevant hashtags"
}`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You write viral faceless short-form scripts. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8, max_tokens: 1500, response_format: { type: 'json_object' },
    });
    const parsed = parseLenientJSON(completion.choices[0].message.content);
    if (parsed.hook) hook = String(parsed.hook).toUpperCase().slice(0, 40);
    if (Array.isArray(parsed.lines) && parsed.lines.length >= list.length) {
      lines = parsed.lines.slice(0, list.length).map((l) => String(l || '').trim());
    }
    if (parsed.cta) cta = String(parsed.cta).trim();
    if (parsed.caption) caption = String(parsed.caption).trim();
  } catch (e) {
    console.log(`[Rundown] Groq enrich failed, using taglines: ${e.message}`);
  }

  const beats = [
    { onscreen: hook, narration: `Here are ${list.length} AI tools you need to see${dayTag ? `, ${dayTag.toLowerCase()}` : ''}.` },
    ...list.map((t, i) => ({
      onscreen: `${i + 1}. ${t.name}`.slice(0, 60),
      narration: lines[i] || `${t.name}. ${t.tagline || ''}`,
    })),
    { onscreen: 'SAVE THIS', narration: cta },
  ];

  if (!caption) {
    caption = `${list.length} AI tools you need to try${dayTag ? ` — ${dayTag}` : ''}: ${list.map((t) => t.name).join(', ')}.`;
  }
  // This is the path that shipped four days of rundowns with no hashtags at all.
  caption = ensureHashtags(caption, { pillar: 'ai' });

  return {
    title: dayTag ? `${dayTag}: ${list.length} AI tools` : `${list.length} AI tools`,
    hook,
    badge: (day ? `DAY ${day}` : `${list.length} AI TOOLS`).slice(0, 14),
    beats,
    caption,
    cta,
    narrationVoice: 'female_energetic', // the GIRL host tells all 5
    musicMood: 'upbeat',
  };
}

/**
 * HOW-TO script — a ~15s reel where the BOY host explains how to USE one tool.
 * Exactly 3 beats (hook → the one key step → CTA) to keep it ~15s.
 *
 * @param {{name,tagline,description,category,url,howTo}} tool
 * @param {{day?:number}} [opts]
 */
async function generateHowToScript(tool, opts = {}) {
  const name = tool.name || 'this AI tool';
  const body = (tool.howTo || tool.description || tool.tagline || '').slice(0, 1200);

  let hook = `HOW TO USE ${name}`.toUpperCase();
  let stepOnscreen = 'DO THIS';
  let stepNarration = tool.howTo || `Open ${name} and ${tool.tagline ? tool.tagline.toLowerCase() : 'start with a simple prompt'}.`;
  let caption = '';

  try {
    const fb = opts.feedback ? `\nREVIEWER REQUESTED CHANGES — apply this feedback: "${opts.feedback}"\n` : '';
    const prompt = `Write a TIGHT 15-second vertical reel that shows HOW TO USE the AI tool "${name}" for a faceless AI channel.${fb}
WHAT IT IS: ${tool.tagline || ''}
HOW IT WORKS / KEY USE: ${body}

The whole video is only ~15 seconds = 3 beats. Be concrete and actionable. No fake stats. No emojis in narration.

Return ONLY valid JSON:
{
  "hook": "on-screen hook, max 5 words, names the tool, e.g. 'Use ${name} like this'",
  "stepOnscreen": "2-4 BIG words for the single key step",
  "stepNarration": "ONE spoken sentence (12-22 words) telling them exactly how to use it",
  "caption": "1 line then a newline then EXACTLY 6 hashtags including the tool name"
}`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You write viral faceless short-form scripts. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.75, max_tokens: 700, response_format: { type: 'json_object' },
    });
    const parsed = parseLenientJSON(completion.choices[0].message.content);
    if (parsed.hook) hook = String(parsed.hook).toUpperCase().slice(0, 40);
    if (parsed.stepOnscreen) stepOnscreen = String(parsed.stepOnscreen).toUpperCase().slice(0, 30);
    if (parsed.stepNarration) stepNarration = String(parsed.stepNarration).trim();
    if (parsed.caption) caption = String(parsed.caption).trim();
  } catch (e) {
    console.log(`[HowTo] Groq failed for ${name}, using fallback: ${e.message}`);
  }

  if (!caption) caption = `How to use ${name} in seconds.`;
  // Passing toolName lets the tool's own tag lead, but sanitised — raw names like
  // "LTX2.3" produce a tag Instagram truncates at the period.
  caption = ensureHashtags(caption, { pillar: 'ai', toolName: name });

  return {
    title: `How to use ${name}`,
    hook,
    badge: 'HOW TO USE',
    beats: [
      { onscreen: hook, narration: `Here's how to actually use ${name}.` },
      { onscreen: stepOnscreen, narration: stepNarration },
      { onscreen: 'TRY IT FREE', narration: `Follow for a new AI tool tutorial every single day.` },
    ],
    caption,
    cta: 'Follow for daily AI tutorials',
    narrationVoice: 'male_deep', // the BOY host explains
    musicMood: 'tech',
  };
}

/**
 * SPOTLIGHT script — one tool, shown working, framed against what it replaces.
 *
 * This replaces the 5-tool rundown as the main daily format. Three reasons, all
 * from watching how the current reels actually perform:
 *   - "Here are 5 AI tools" is the most saturated format on the platform, and a
 *     list of names gives nobody a reason to save the post.
 *   - Five tools in 30s means ~5s each, which is not enough to show any of them.
 *     One tool leaves room for real footage of it running.
 *   - The "free alternative to X" angle is what earns the save. Novelty does not;
 *     money does.
 *
 * The hook is the whole ballgame — beat 1 must land a claim before a thumb moves.
 * The old prompts asked for a "scroll-stopping hook" and got labels like
 * "HOW TO USE BONSAI", which is a title, not a reason to stay.
 *
 * Prices are deliberately never stated. The model does not reliably know current
 * pricing and would invent it; naming the paid incumbent carries the comparison
 * without asserting a number we cannot stand behind.
 */
async function generateSpotlightScript(tool, opts = {}) {
  const name = tool.name || 'this AI tool';
  const body = (tool.description || tool.tagline || '').slice(0, 1500);
  const day = opts.day || null;

  const fb = opts.feedback ? `\nREVIEWER REQUESTED CHANGES — apply this feedback: "${opts.feedback}"\n` : '';
  const prompt = `You are writing a 30-40 second vertical reel about ONE AI tool for a faceless channel (DEVELOPSCHL).

TOOL: ${name}
WHAT IT IS: ${tool.tagline || ''}
DETAILS: ${body}
${tool.url ? `LINK: ${tool.url}` : ''}${fb}

THE HOOK IS EVERYTHING. Beat 1 has under 2 seconds to stop a thumb.
- It must be a CLAIM or a RESULT, never a label or a title.
- BAD (these are titles, do not write these): "How to use ${name}", "${name} explained", "New AI tool"
- GOOD (these are claims): "This replaces a $400 editor", "You can run a 27B model on your laptop", "Photoshop just became optional"
- Max 7 words on screen. No greetings, no "in this video", no "let me show you".

ANGLE: what expensive or tedious thing does this replace? Name the paid tool or the
manual process it makes unnecessary. NEVER state a price, subscription cost or any
number you are not certain of — name the competitor, not the amount.

ACCURACY — these are claims about a real product and must be true:
- Only name a competitor in the SAME category. An LLM runner does not replace an
  image editor. If you cannot name a confident competitor, describe the manual
  work it removes instead and set "replaces" to that.
- Do NOT claim it runs locally, offline, privately, or "on your machine" unless the
  DETAILS explicitly say so. A hosted demo page runs on someone else's servers.
- Do NOT claim it is free, open source, or unlimited unless the DETAILS say so.
- If the DETAILS are thin, stay descriptive. An accurate plain line beats an
  exciting false one.

STRUCTURE — exactly 5 beats:
1. HOOK — the claim.
2. WHAT IT IS — one line, plain English.
3. WHAT IT REPLACES — the paid tool or manual work it kills.
4. THE CATCH (or lack of one) — free? open source? runs locally? be accurate.
5. CTA — tell them to save it.

Each beat: "onscreen" = 2-6 punchy words. "narration" = one FULL spoken sentence of
10-18 words. This is a hard requirement — fragments break the voiceover.
  BAD (a fragment, not a sentence): "Using WebGPU for local processing."
  GOOD (full sentence, same length target): "You point it at a folder and it sorts every file in seconds."
The GOOD line above is only an example of LENGTH AND RHYTHM. Never reuse its wording
or its claims — write about THIS tool from the DETAILS above.
All narration read together must flow as one continuous voiceover.

There is NO clickable link in a reel. Never say "link below", "link in bio", "check
the description" or "click here" — the CTA is to follow or save.
Never invent features, stats or prices. If unsure, stay general.

Return ONLY valid JSON:
{
  "hook": "the beat-1 on-screen claim",
  "replaces": "the paid tool or manual process this replaces, 1-4 words",
  "badge": "short tag, max 12 chars, e.g. FREE TOOL | OPEN SOURCE | RUNS LOCAL",
  "beats": [ { "onscreen": "BIG TEXT", "narration": "one sentence." } ],
  "caption": "1-2 lines that make someone want to save this",
  "narrationVoice": "one of: female_energetic | male_deep | female_calm"
}`;

  let parsed = {};
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You write viral faceless short-form video scripts. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.85, max_tokens: 1600, response_format: { type: 'json_object' },
    });
    parsed = parseLenientJSON(completion.choices[0].message.content);
  } catch (e) {
    console.log(`[Spotlight] Groq failed for ${name}: ${e.message}`);
  }

  let beats = (Array.isArray(parsed.beats) ? parsed.beats : [])
    .map((b) => ({
      onscreen: String(b.onscreen || '').trim().slice(0, 60),
      narration: String(b.narration || '').trim(),
    }))
    .filter((b) => b.onscreen && b.narration)
    .slice(0, 6);

  // Fall back to something honest rather than failing the whole day's bundle.
  if (beats.length < 3) {
    const what = tool.tagline || tool.description || `a new AI tool`;
    beats = [
      { onscreen: name.toUpperCase().slice(0, 40), narration: `${name} does something you are probably paying for.` },
      { onscreen: 'WHAT IT DOES', narration: String(what).slice(0, 160) },
      { onscreen: 'SAVE THIS', narration: 'Follow for a new AI tool every single day.' },
    ];
  }

  // A reel has no clickable link, but the model keeps writing CTAs that assume one.
  // Rewrite rather than reject — the rest of the beat is usually fine.
  // Any mention of a link is wrong in a reel — there is nothing to click. Matching
  // the bare word catches the variants a narrower pattern missed ("the provided
  // demo link", "link in bio", "check the description").
  const LINK_CTA = /\b(links?|bio|description below|click here|see below)\b/i;
  beats = beats.map((b) => (
    LINK_CTA.test(b.narration)
      ? { ...b, narration: 'Follow and save this — a new AI tool every single day.' }
      : b
  ));

  // Beat 1 on screen must BE the hook. When they diverge the viewer reads one thing
  // while hearing the setup for another, which wastes the only moment that matters.
  if (parsed.hook && beats[0]) {
    beats[0] = { ...beats[0], onscreen: String(parsed.hook).trim().slice(0, 60) };
  }

  // Instagram does not linkify captions, so a raw URL is pure noise in the copy.
  const captionBody = String(parsed.caption || `${name} — ${tool.tagline || 'a free AI tool worth saving'}.`)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const caption = ensureHashtags(captionBody, { pillar: 'ai', toolName: name });

  return {
    title: `${name}${parsed.replaces ? ` vs ${parsed.replaces}` : ''}`,
    hook: parsed.hook || beats[0].onscreen,
    replaces: parsed.replaces || null,
    badge: String(parsed.badge || (day ? `DAY ${day}` : 'FREE TOOL'))
      .toUpperCase().replace(/[^A-Z0-9 /]/g, '').trim().slice(0, 12),
    beats,
    caption,
    cta: 'Follow for daily AI tools',
    narrationVoice: ['female_energetic', 'male_deep', 'female_calm'].includes(parsed.narrationVoice)
      ? parsed.narrationVoice : 'female_energetic',
    musicMood: 'tech',
    brollUrl: tool.url || null,   // reelComposer records this page as B-roll
  };
}

module.exports = { generateReelScript, generateRundownScript, generateHowToScript, generateSpotlightScript };
