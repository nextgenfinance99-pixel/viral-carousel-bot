# DEVELOPSCHL Reel Bot — Handoff

Paste this into a new chat to pick up exactly where we left off.

---

## What this is

A faceless Instagram content bot for **@developschl** (brand: DEVELOPSCHL), a
"100-day AI challenge" account. It sources AI tools, writes scripts, renders
branded vertical video with word-synced captions and real screen-recorded footage,
sends each draft to Telegram for approval, and publishes to Instagram on a tap.

- **Repo:** `nextgenfinance99-pixel/viral-carousel-bot` (PUBLIC)
- **Local:** `C:\Users\jasth_e3jrgw\OneDrive\Desktop\News_bot`
- **Branch:** `reel-pipeline-overhaul` (19 commits ahead of `main`, all pushed)
- **Stack:** Node/Express + Groq (scripts) + msedge-tts (voice) + FFmpeg (video) +
  Sharp (SVG frames) + Playwright (B-roll). Free except hosting.

## Current state

**Running:** backend on `localhost:3001`, launched by `run-backend-hidden.vbs`
(detached — survives closing the terminal). Telegram bot `@Instagpostbot` polling.
Instagram token valid, ~33 days left, auto-refreshes daily *while the backend runs*.

**Daily flow:** 6am cron → ingest tools → generate 1 spotlight reel → push to
Telegram → you tap ✅ to post. Catch-up runs 20s after boot if today has no draft,
so a laptop that was off at 6am still produces that day's post.

**Never auto-posts.** Everything waits for a tap.

## Architecture (backend/)

```
brand.js              single source of truth: colour, wordmark, fonts, per-pillar
                      themes (ai/jobs/career); asserts accent contrast >=7:1
llm.js                CHAT_MODEL in ONE place + assertModelAlive
services/
  toolSources.js      5 keyless sources; quality gate + brand-safety filter
  toolStore.js        dedupe, scoring, daily pick, 100-day counter
  reelScript.js       Groq scripts; generateSpotlightScript is the main one
  tts.js              msedge-tts + WordBoundary metadata (free word timings)
  captions.js         word-synced ASS subtitles burned in via libass
  screenCapture.js    Playwright records each tool's page as B-roll
  reelComposer.js     SVG frames + FFmpeg -> mp4 (the template lives here)
  storyComposer.js    daily Story recap PNG
  hashtags.js         enforced in code, sanitised, tiered
  instagram.js        postReel / postCarousel / postStory
  instagramToken.js   daily refresh + expiry warning
  telegramReview.js   approve / changes / skip + /story + presenter video upload
  xWriter.js          X threads (generation only, no credentials yet)
  dailyChallenge.js   orchestrator; generateDailyBundle, publishAsset, postDailyStory
```

## Hard rules — do not violate

1. **NO host photo or intro sting in reels.** User was emphatic. A presenter *video*
   in the lower band is fine (that's different); a static face is not.
2. **Review-first.** Nothing posts without a Telegram tap. This includes Stories.
3. **Accuracy.** The script model repeatedly tried to publish false claims — that a
   hosted HuggingFace Space "runs on your machine", that an LLM runner replaces
   image editors, that a free tool replaces a paid one. Guards exist in the prompts;
   re-test them against those cases after any prompt edit.
4. **One backend instance only.** Two polling the same bot = Telegram 409 and both
   break.

## The recurring failure mode (read this)

Three separate times, something broke while reporting success:

- Groq retired `llama-3.3-70b-versatile`; every call 404'd for weeks and each caller
  quietly fell back to degraded output.
- Futurepedia returned HTTP 200 with a selector matching zero links, for months.
- HuggingFace Spaces "successfully" captured as blank white rectangles.

Every fix here follows the same principle: **a failure must be loud, and quality
must be enforced in code, not requested in a prompt.** Hashtags shipped empty for
four days because the prompt asked politely.

## Open / not done

- **Hosting.** Backend only runs while the laptop is on. Options discussed: laptop
  auto-start (free, scheduled task command in chat), Oracle Cloud Always Free (free
  forever, ARM, needs arm64 image), Render Starter (~$7.50/mo, `render.yaml` ready).
  User is not monetising yet and prefers free.
- **PR not opened.** `gh` is not installed. Branch pushed; open at
  `https://github.com/nextgenfinance99-pixel/viral-carousel-bot/compare/main...reel-pipeline-overhaul`
- **`postStory` untested against the live API.** All read-only checks pass.
- **Docker build never run.** Render's first build is the proof.
- **X:** writer done, no API client, no posting.
- **Presenter clip:** git-ignored (public repo). On a server, send the bot a video.
- **Jobs/career pillar:** designed (`brand.js` has the themes) but unbuilt.
- **`temp/broll`** grows ~2MB/capture; cleanup function exists but is not scheduled.

## Reality check on the account

Zero followers. 3 posts have ever been published (3 Aug). The AI-tools niche is
extremely saturated. Reach is driven by watch-time and saves, not hashtags — which
is why the format moved to one spotlight a day with a hard hook and a
"free alternative to X" angle. Nothing monetises at this size; the more realistic
revenue path discussed was selling the *pipeline* as a service, using the page as
the portfolio piece.
