const Groq = require('groq-sdk');

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
    caption:        parsed.caption || `${title}\n\n#ai #aitools #artificialintelligence #tech #automation #machinelearning`,
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
    caption = `${list.length} AI tools you need to try${dayTag ? ` — ${dayTag}` : ''}: ${list.map((t) => t.name).join(', ')}.\n\n#ai #aitools #artificialintelligence #aitoolsdaily #tech #productivity`;
  }

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

  if (!caption) {
    const tag = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    caption = `How to use ${name} in seconds.\n\n#ai #aitools #${tag || 'aitool'} #howto #artificialintelligence #productivity`;
  }

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

module.exports = { generateReelScript, generateRundownScript, generateHowToScript };
