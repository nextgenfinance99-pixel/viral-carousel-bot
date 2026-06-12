# Host avatars

Drop your AI-generated avatar images here so reels can show a "host":

- `girl.png` — used when the script picks a female voice (female_energetic / female_calm)
- `boy.png`  — used when the script picks a male voice (male_deep)

Tips:
- Square-ish, head-and-shoulders, face near the top. They get cropped to a circle.
- PNG or JPG, at least 500×500.
- The route can override the auto-pick: `{ "host": "boy" | "girl" | "none" }`.

If a file is missing the reel just renders faceless (no error).

## Branded intro sting (your AI man)

Every reel can open with a ~2s branded intro showing your host photo + a title + your
voiceover line. Configure it in `../intro.json`:

- Drop your AI-generated man image here as `host.png` (square-ish, face near the top).
- Edit `backend/assets/intro.json`:
  - `enabled`: true/false
  - `text`: big on-screen title (e.g. "AI TOOL OF THE DAY")
  - `narration`: the line spoken over the intro (your basic script)
- Missing `host.png` → intro is skipped automatically (reel still generates).

