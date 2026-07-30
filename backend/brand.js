/**
 * brand.js — the single source of truth for how DEVELOPSCHL looks.
 *
 * Colour, handle, wordmark and fonts used to be duplicated between
 * imageComposer.js (1080x1080 carousels) and reelComposer.js (1080x1920 reels),
 * which meant a rebrand was a find-and-replace across two files and they could
 * silently drift apart. Everything visual now reads from here.
 *
 * THEMES are per content pillar, so a viewer can tell what a post is about from
 * the accent colour alone before reading a word:
 *   ai     — cyan   — AI tools + AI news (the 100-day challenge)
 *   jobs   — green  — newly released roles, hiring round-ups
 *   career — amber  — resumes, interviews, skills
 *
 * Accent colours are used as a BADGE BACKGROUND WITH BLACK TEXT, so they must
 * stay light enough to keep that readable — assertAccentContrast() below fails
 * loudly rather than shipping an unreadable frame.
 */

const HANDLE = '@developschl';
const WORDMARK = 'DEVELOPSCHL';

// Only fonts guaranteed present in the Docker image (liberation-fonts maps
// Arial -> Liberation Sans). Do not add a font here without installing it.
const FONT_DISPLAY = 'Arial Black,Arial,sans-serif';
const FONT_BODY = 'Arial,sans-serif';

const THEMES = {
  ai:     { accent: '#00e5ff', label: 'AI' },
  jobs:   { accent: '#22e07a', label: 'JOBS' },
  career: { accent: '#ffb020', label: 'CAREER' },
};

const INK = {
  base:     '#07080d',   // page black — slightly blue so it isn't muddy
  baseSoft:  '#0e1018',  // raised surfaces (cards)
  white:     '#ffffff',
  black:     '#000000',
  muted:     'rgba(255,255,255,0.62)',
  hairline:  'rgba(255,255,255,0.10)',
};

// Instagram overlays its own UI on a Reel. Keep anything that must be read
// inside these bounds or the app will cover it.
const SAFE = { top: 250, bottom: 340, left: 80, right: 100 };

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// WCAG relative luminance.
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastWithBlack(hex) {
  return (luminance(hex) + 0.05) / 0.05;
}

// Guard the one rule the layout depends on: accent pills carry black text.
function assertAccentContrast(theme) {
  const ratio = contrastWithBlack(theme.accent);
  if (ratio < 7) {
    throw new Error(
      `Brand accent ${theme.accent} only reaches ${ratio.toFixed(1)}:1 against black text; ` +
      `badges would be unreadable. Pick a lighter accent (needs >= 7:1).`
    );
  }
  return ratio;
}

function getTheme(name = 'ai') {
  const theme = THEMES[name] || THEMES.ai;
  assertAccentContrast(theme);
  return theme;
}

module.exports = {
  HANDLE, WORDMARK, FONT_DISPLAY, FONT_BODY,
  THEMES, INK, SAFE,
  getTheme, contrastWithBlack, assertAccentContrast,
};
