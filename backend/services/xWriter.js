/**
 * xWriter.js — writes X (Twitter) threads and single posts from the same content
 * the reels are built from, so the two channels share one sourcing pipeline
 * instead of becoming two content problems.
 *
 * Nothing here touches the X API. Generation and posting are deliberately separate:
 * the writing can be developed, tested and reviewed long before credentials exist,
 * and the same review-first rule as Instagram applies — nothing is published
 * without an explicit approval step.
 *
 * Three lessons from the reel pipeline are baked in, because each one cost a
 * rewrite there:
 *
 * 1. FORMAT IS ENFORCED IN CODE, NOT REQUESTED IN THE PROMPT. Every rundown reel
 *    shipped with zero hashtags for four days because the prompt asked politely.
 *    Here the 280-character limit is a hard truncation with a clean word boundary,
 *    applied AFTER numbering is added.
 *
 * 2. THE HOOK IS A CLAIM, NEVER A LABEL. "How to use Bonsai" is a title; nobody
 *    stops for a title. Post 1 has to assert something.
 *
 * 3. ACCURACY IS GUARDED. The reel model once claimed a hosted demo "runs on your
 *    machine, nothing ever leaves". Same guards apply: no local/free/open-source
 *    claim unless the source text supports it, and no invented numbers.
 */
const Groq = require('groq-sdk');
const { CHAT_MODEL, assertModelAlive } = require('../llm');

// Constructed on first use, not at import. The formatting helpers below are pure and
// are the part most worth testing, and building the client eagerly made the whole
// module unimportable without a GROQ_API_KEY — which defeats the point of writing
// this before the X credentials exist.
let _groq = null;
function groqClient() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// X counts every URL as 23 characters via t.co, however long the actual link is.
const TWEET_LIMIT = 280;
const URL_WEIGHT = 23;

function parseLenientJSON(raw) {
  let text = String(raw || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  text = text.replace(/['']/g, "'").replace(/[""]/g, '"');
  try { return JSON.parse(text); } catch {
    return JSON.parse(text.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : '')));
  }
}

/**
 * X's own character count, not JavaScript's. Every link counts as 23 no matter its
 * real length, so a tweet with a long URL is far shorter to X than String.length
 * suggests — and truncating on raw length would cut posts that actually fit.
 */
function tweetLength(text) {
  const urls = String(text).match(/https?:\/\/\S+/g) || [];
  let len = String(text).length;
  for (const u of urls) len += URL_WEIGHT - u.length;
  return len;
}

// Trim to the limit at a word boundary, never mid-word and never leaving dangling
// punctuation. Returns the text unchanged when it already fits.
function fitTweet(text, limit = TWEET_LIMIT) {
  let out = String(text).trim();
  if (tweetLength(out) <= limit) return out;
  while (tweetLength(out) > limit && out.includes(' ')) {
    out = out.slice(0, out.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '');
  }
  return out;
}

/**
 * X suppresses reach on posts carrying an external link, so the link never goes in
 * the thread body — it goes in a trailing reply. This is the single most common
 * self-inflicted reach problem on the platform.
 */
function stripLinks(text) {
  return String(text).replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
}

// Number the thread (2/7, 3/7 …). Post 1 is left unnumbered: a bare "1/7" on the
// hook tells people how much work they are signing up for before they are hooked.
function numberThread(tweets) {
  const total = tweets.length;
  return tweets.map((t, i) => {
    if (i === 0 || total < 3) return fitTweet(t);
    const tag = ` ${i + 1}/${total}`;
    return fitTweet(t, TWEET_LIMIT - tag.length) + tag;
  });
}

const ACCURACY_RULES = `
ACCURACY — these are claims about a real product and must be true:
- Do NOT claim it runs locally, offline, privately, or "on your machine" unless the
  DETAILS explicitly say so. A hosted demo runs on someone else's servers.
- Do NOT claim it is free, open source, or unlimited unless the DETAILS say so.
- Never state a price, funding figure, user count or benchmark you were not given.
- Do NOT imply the thing it replaces is paid unless you are certain it is. Plenty of
  incumbents are free — a terminal multiplexer does not save anyone a subscription,
  and "ditch the monthly fee" is simply false there. If no paid competitor exists,
  sell the time or the hassle it removes instead.
- If the DETAILS are thin, stay descriptive. An accurate plain line beats an
  exciting false one.`;

/**
 * Write a thread.
 * @param {{name?,title?,tagline?,description?,fullText?,url?}} source
 * @param {{kind?:'tool'|'news', length?:number, feedback?:string}} opts
 */
async function generateThread(source, opts = {}) {
  const kind = opts.kind || 'tool';
  const title = source.name || source.title || 'this';
  const body = (source.description || source.tagline || source.fullText || '').slice(0, 3000);

  // Scale the thread to the material. Most tool picks arrive as a single line of
  // description, and asking for six posts from twelve words does not produce six
  // ideas — it produces two ideas, three restatements of them, and an invitation to
  // invent the rest. Padding is the failure mode this whole project keeps hitting.
  const requested = Math.min(Math.max(opts.length || 6, 3), 10);
  const substanceCap = body.length < 120 ? 3
    : body.length < 400 ? 4
    : body.length < 1200 ? 6
    : 8;
  const target = Math.min(requested, substanceCap);
  if (target < requested) {
    console.log(`[X] "${title}": ${body.length} chars of source — ${target} posts, not ${requested}`);
  }
  const fb = opts.feedback ? `\nREVIEWER REQUESTED CHANGES — apply this feedback: "${opts.feedback}"\n` : '';

  const angle = kind === 'news'
    ? 'This is an AI news story. Make the reader feel they would look uninformed not knowing it.'
    : 'This is an AI tool. Sell what it replaces — the paid product or the tedious manual work.';

  const prompt = `You are writing an X (Twitter) thread for a developer/AI audience.

TOPIC: ${title}
DETAILS: ${body}
${angle}${fb}

Write ${target} posts.

POST 1 IS THE ENTIRE BALLGAME. It must be a CLAIM or a RESULT that makes scrolling
stop. It must work completely on its own, with no context.
  BAD (labels — never write these): "A thread on ${title}", "${title} explained",
    "Here's a tool I found", "Let's talk about AI tools"
  GOOD (claims): "You can run a 27B model in a browser tab now.",
    "This replaces a tool I was paying for monthly."
Do NOT open with "Thread:", "🧵", "1/", or a greeting.

THE BODY (posts 2 to ${target - 1}): one concrete idea each, developed properly.
Aim for 140-240 characters per post — roughly two or three real sentences. A
seven-word post carries no information and wastes the reader's scroll.
  TOO THIN: "Uses WebGPU for compute-heavy work"
  RIGHT: "It leans on WebGPU, so the model runs on your own graphics card instead
    of a rented one. That is the whole trick — no server, no queue, no per-token bill."
Plain English, short sentences, but say something. No corporate voice and no hype
adjectives ("game-changing", "revolutionary", "insane"). Specifics beat adjectives.

THE LAST POST: invite a reply with a real question people can actually answer —
something specific about their own setup or workflow. Not "what do you think?".

HARD RULES:
- Each post must be UNDER 260 characters, and the body posts should be near that,
  not far under it.
- NEVER include a URL anywhere. Links are added separately.
- No hashtags. They do nothing on X and read as spam.
- At most one emoji in the whole thread, and only if it genuinely helps.
${ACCURACY_RULES}

Return ONLY valid JSON:
{
  "hook": "post 1, the claim",
  "posts": ["post 1", "post 2", "... exactly ${target} posts total"],
  "replyQuestion": "the question from the final post, on its own",
  "single": "a standalone version of this as ONE post under 260 chars, for when a thread is too much"
}`;

  let parsed = {};
  try {
    const completion = await groqClient().chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You write X threads that developers actually read. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.85, max_tokens: 4000, response_format: { type: 'json_object' },
    });
    parsed = parseLenientJSON(completion.choices[0].message.content);
  } catch (e) {
    assertModelAlive(e, 'X');
    console.log(`[X] Groq failed for "${title}": ${e.message}`);
  }

  let posts = (Array.isArray(parsed.posts) ? parsed.posts : [])
    .map((p) => stripLinks(String(p || '')).trim())
    .filter(Boolean);

  // Fall back to something honest rather than returning nothing.
  if (posts.length < 2) {
    const what = source.tagline || source.description || 'a new AI tool worth a look';
    posts = [
      stripLinks(String(what)).slice(0, 200),
      `${title} — worth a look if that is a problem you have.`,
      'What are you using for this at the moment?',
    ];
  }

  // The model is told to open with a claim and still sometimes writes a label.
  // Catch the obvious ones rather than shipping a dead hook.
  const LABEL_HOOK = /^(a )?thread\b|^🧵|^\d+\/|^(here'?s|let'?s talk|today i|i want to talk)/i;
  if (LABEL_HOOK.test(posts[0]) && parsed.hook && !LABEL_HOOK.test(parsed.hook)) {
    posts[0] = stripLinks(parsed.hook);
  }

  const numbered = numberThread(posts);

  return {
    topic: title,
    posts: numbered,
    hook: numbered[0],
    // The link lives here, posted as a reply once the thread is up, so the thread
    // itself is never penalised for carrying it.
    linkReply: source.url ? `Link: ${source.url}` : null,
    single: fitTweet(stripLinks(parsed.single || posts[0])),
    replyQuestion: parsed.replyQuestion || null,
    charCounts: numbered.map(tweetLength),
  };
}

module.exports = { generateThread, fitTweet, tweetLength, stripLinks, numberThread, TWEET_LIMIT };
