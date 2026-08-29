# Social Content Engine — Reusable Blueprint

A generalised spec for the pipeline built for DEVELOPSCHL, written so it can be
re-pointed at **any niche, brand, or client account**. Paste this into a fresh chat,
fill in the CONFIGURE block, and delete what you don't need.

---

## How to use this

Paste everything below into a new chat, edit the CONFIGURE block, and say:

> Build this. Start with the sourcing layer and the quality gate — I want to see
> real items pass the filter before you render anything.

Build order matters. Sourcing first, because **everything downstream inherits the
quality of what you feed it.** A beautiful template rendering junk is still junk.

---

## CONFIGURE — edit this, everything else is machinery

```
BRAND
  name             e.g. DEVELOPSCHL
  handle           e.g. @developschl
  accent colour    must reach >=7:1 contrast against black badge text
  fonts            must be installed wherever this runs (Docker: liberation)
  voice/tone       e.g. plain, technical, no hype adjectives

NICHE
  what you post about        e.g. lesser-known AI tools
  who it is for              e.g. developers who want free alternatives
  the angle that earns saves e.g. "free alternative to <paid thing>"

SOURCES  (pick ones that are free, keyless, and return a REAL DESCRIPTION)
  e.g. ProductHunt Atom feed, Show HN via Algolia, GitHub search, Reddit RSS

CADENCE
  posts per day    start at 1; volume without engagement suppresses reach
  schedule         cron + timezone
  formats          e.g. 1 spotlight reel + 1 daily story recap

CHANNELS
  where it posts   e.g. Instagram Reels + Stories
  approval         e.g. Telegram, tap to publish
```

---

## Architecture

Seven layers. Each is independently replaceable — that's the point.

```
1 SOURCING     pull candidates from free APIs/feeds
2 QUALITY GATE reject anything you cannot honestly describe
3 SCRIPTING    LLM writes a hook + beats from the source text
4 RENDERING    brand template -> frames -> video/image
5 REVIEW       human approves before anything is public
6 PUBLISHING   platform APIs
7 UPKEEP       token refresh, cleanup, health logging
```

### 1. Sourcing
Prefer **keyless public feeds** over token-gated APIs — a key you never set is a
source that silently never runs. Wrap every source so one failure cannot break the
run (`Promise.allSettled` + per-source try/catch). Normalise everything to one shape:
`{ name, tagline, description, url, source, category, isNew, launchedAt, votes }`.

### 2. Quality gate — the most important layer
Reject an item unless **all** hold:
- a description that is substantive (>=25 chars, >=5 words)
- ...and says something the *name* doesn't already say (>=3 novel words)
- topically relevant (regex over name+tagline+description)
- **brand-safe** (see below)

Then **decode HTML entities** and **strip tracking junk** before anything reaches a
frame. Log survivors per source, and name any source that returned nothing.

> Real failure this prevents: a source returned bare URL slugs as descriptions, so
> the model invented features, and a reel titled *"How to use boo"* was produced
> about a terminal multiplexer.

### 3. Brand safety — do not skip
Adult and shock content appears in open feeds. Split terms into two classes:
- **strong** (`porn`, `nudify`, `onlyfans`…) — match anywhere, including URL slugs
- **weak** (`xxx`, `nude`, `gore`…) — real words that occur inside innocent ones;
  require word boundaries and **do not match against URLs**

> A single unbounded list blocked a legitimate tool because a GitHub user was named
> `ValerianXXX`. A false reject costs one item; a false accept posts porn to a
> client account.

### 4. Scripting
- **Beat 1 must be a claim, not a label.** "How to use X" is a title; nobody stops
  for a title. Force beat 1's on-screen text to equal the hook so they can't drift.
- **Scale length to the source.** Six posts from a twelve-word description produces
  two ideas, three restatements, and invention. Cap by description length.
- **Accuracy guards, stated explicitly:** no local/free/open-source claims the source
  doesn't support; no invented prices or benchmarks; don't imply an incumbent is paid
  unless certain. Mark any example in your prompt as *rhythm only* — models copy
  example sentences verbatim into contexts where they're false.
- **Enforce format in code, not in the prompt.** Prompts are requests. Truncation,
  hashtags, link-stripping: all post-processing.

### 5. Rendering
Draw frames **from code**, not stock imagery — borrowed photos make every account
look identical. One fixed visual signature repeated on every frame is what makes a
brand recognisable in half a second of scroll.

Practical gotchas that cost real debugging time:
- SVG text positions by **baseline**; vertical gaps must be measured against cap
  height (~0.72 × font size), or headings collide.
- **SVG cannot erase.** To show video through a frame, *clip* the painted background
  to everything outside the hole — painting "nothing" over it does nothing.
- Keep any zoom under ~4% on vector frames; they shimmer where photos don't.
- Respect platform safe zones (the app covers top and bottom).
- Put colour/type/handle in **one config module** so a rebrand is one file.

### 6. Captions (free, and the highest-impact single feature)
If your TTS exposes **word-boundary metadata** (Edge TTS does), you get exact
per-word timings for free — no Whisper, no alignment. Emit an **ASS** subtitle track
and burn it in with FFmpeg's libass in one pass.

Group words into short chunks: single-word captions on words like "a" hold ~60ms and
read as a flicker. Stretch each chunk to the next one's start so captions don't
vanish in the gaps between words.

### 7. B-roll
Record the actual thing you're talking about with a headless browser. **Verify the
capture** — measure per-channel standard deviation of a sampled frame and discard
near-uniform ones. Pages that lazy-load in an iframe "succeed" as white rectangles.

Hide consent banners with CSS; **never click accept** — that consents to tracking on
someone's behalf.

### 8. Review
Nothing public without a human tap. A chat bot (Telegram) works well: send the
rendered asset with approve / request-changes / skip buttons, and let a text reply
feed back as regeneration notes.

### 9. Upkeep
Long-lived tokens expire (Instagram: 60 days, unrecoverable once dead). Refresh on a
schedule and warn *before* expiry. Note that a refresh job only runs while the app
runs — a laptop-hosted bot that sleeps for a month loses its token.

---

## Principles that survived contact with reality

1. **Silent success is the enemy.** Every serious bug here reported healthy: a
   retired model 404ing into fallbacks, a dead scraper returning HTTP 200 with zero
   results, blank captures "succeeding". Make failure loud; never let a fallback
   hide a config error.
2. **Prompts are requests, code is a guarantee.** Anything that must be true —
   character limits, hashtags, link removal — enforce after generation.
3. **Thin source, thin output.** Don't pressure a model to expand twelve words into
   six paragraphs; it will invent. Scale output to available material.
4. **Config in one place.** The model id lived in six files; when it was retired,
   everything broke at once.
5. **Cache invalidation is a quality problem.** Junk lived in three layers — live
   sourcing, the stored pool, and the per-date pick cache. Fixing only the entry
   point left the other two serving it.
6. **Verify the artefact, not the source.** Pull frames back out of the encoded video.
   Two bugs were invisible in the SVG and obvious in the MP4.
7. **Volume is not reach.** Posting more into zero engagement suppresses you. One
   good post beats three mediocre ones.

---

## Adapting to other use cases

- **Different niche:** swap SOURCES and the topical regex. Everything else holds.
- **Client/agency work:** `brand.js` per client; the pipeline is brand-agnostic.
- **Multiple pillars in one account:** give each a theme (accent + label) so viewers
  can tell content types apart before reading — the theme flows through frames,
  stories and hashtag banks.
- **Different platform:** the renderer is a canvas size and a safe-zone rectangle.
  Swap the publishing layer; keep 1-4 intact.
- **Text-only channels (X, LinkedIn, newsletter):** keep 1-3, replace 4 with a
  formatter. Note platform quirks — X counts every URL as 23 characters regardless
  of length, and suppresses posts carrying external links, so links belong in a
  trailing reply.

## Cost

Free: Groq (LLM), Edge TTS (voice), FFmpeg, Sharp, Playwright, all public feeds,
Telegram. The only real cost is **hosting** if you need 24/7 — and even that has a
genuinely free option (Oracle Cloud Always Free). Run it on your own machine until
the account earns something.
