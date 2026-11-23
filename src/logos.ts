// ─────────────────────────────────────────────────────────────────────────────
// logos.ts — Multi-color ASCII art logos
// Every backend gets a unique identity. No emojis — pure terminal art.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';

const { fg, bold, dim, reset: R } = ansi;

// Palette
const V   = fg(139,  92, 246);  // arc violet
const VL  = fg(167, 139, 250);  // violet light
const OR  = fg(251, 146,  60);  // orange
const YW  = fg(250, 204,  21);  // yellow
const SD  = fg(100, 116, 139);  // slate dark
const WH  = fg(255, 255, 255);  // white
const GY  = fg(160, 160, 160);  // grey
const AM  = fg(245, 158,  11);  // amber (llama.cpp)

// ─────────────────────────────────────────────────────────────────────────────
// arc — the brand mark (compact, inline)
// ─────────────────────────────────────────────────────────────────────────────

export const ARC_MARK = `${V}${bold}◈${R} ${VL}${bold}arc${R}`;

export const ARC_LOGO = [
  `${V}  ╔══════════════════════════════════╗${R}`,
  `${V}  ║${R}  ${V}${bold}◈  ${VL}a r c${R}                     ${V}║${R}`,
  `${V}  ║${R}  ${SD}LLM Terminal Platform${R}          ${V}║${R}`,
  `${V}  ║${R}  ${SD}Built by ${R}${VL}${bold}The Architect${R}        ${V}║${R}`,
  `${V}  ╚══════════════════════════════════╝${R}`,
].join('\n');

// Inline header (single line, used in chat headers)
export const ARC_INLINE = `${V}${bold}◈${R}${VL}${bold}arc${R}`;

// ─────────────────────────────────────────────────────────────────────────────
// Ollama
// ─────────────────────────────────────────────────────────────────────────────

export const OLLAMA_LOGO = [
  `${WH}${bold}  ╭─────╮${R}`,
  `${WH}${bold}  │${R} ${GY}( )${R} ${WH}${bold}│${R}  ${WH}${bold}ollama${R}`,
  `${WH}${bold}  ╰──╥──╯${R}`,
  `${WH}${bold}     ║${R}   ${GY}${dim}local inference${R}`,
].join('\n');

// Compact badge (fits inline beside model name)
export const OLLAMA_BADGE = [
  `${WH}${bold}╭──╮${R}`,
  `${WH}${bold}│${R}${GY}◉${R}${WH}${bold}│${R}`,
  `${WH}${bold}╰──╯${R}`,
];

// Single-line glyph
export const OLLAMA_GLYPH = `${WH}${bold}[◉]${R}`;

// ─────────────────────────────────────────────────────────────────────────────
// llama.cpp
// ─────────────────────────────────────────────────────────────────────────────

export const LLAMACPP_LOGO = [
  `${AM}${bold}  ╔═══╗${R}`,
  `${AM}${bold}  ║${R}${OR}▲▲▲${R}${AM}${bold}║${R}  ${AM}${bold}llama.cpp${R}`,
  `${AM}${bold}  ╚═══╝${R}`,
  `${SD}       ${dim}gguf · metal · cuda${R}`,
].join('\n');

export const LLAMACPP_GLYPH = `${AM}${bold}[▲]${R}`;

// ─────────────────────────────────────────────────────────────────────────────
// llama-cli
// ─────────────────────────────────────────────────────────────────────────────

export const LLAMACLI_LOGO = [
  `${OR}${bold}  ╭───────╮${R}`,
  `${OR}${bold}  │${R}${YW}${bold}>_ cli ${R}${OR}${bold}│${R}  ${OR}${bold}llama-cli${R}`,
  `${OR}${bold}  ╰───────╯${R}`,
  `${SD}     ${dim}one-shot pipe · no server${R}`,
].join('\n');

export const LLAMACLI_GLYPH = `${OR}${bold}[>]${R}`;

// ─────────────────────────────────────────────────────────────────────────────
// Glyph registry — used inline throughout the UI
// ─────────────────────────────────────────────────────────────────────────────

export const GLYPHS: Record<string, string> = {
  ollama:     OLLAMA_GLYPH,
  llamacpp:   LLAMACPP_GLYPH,
  llamacli:   LLAMACLI_GLYPH,
};

export const LOGOS: Record<string, string> = {
  ollama:     OLLAMA_LOGO,
  llamacpp:   LLAMACPP_LOGO,
  llamacli:   LLAMACLI_LOGO,
};

// ─────────────────────────────────────────────────────────────────────────────
// Badge colors per backend
// ─────────────────────────────────────────────────────────────────────────────

export const BADGE_COLORS: Record<string, string> = {
  ollama:     WH,
  llamacpp:   AM,
  llamacli:   OR,
};

// ─────────────────────────────────────────────────────────────────────────────
// Splash screen — shown on arc startup
// ─────────────────────────────────────────────────────────────────────────────

export function splash(version: string, backends: string[]): string {
  const w    = process.stdout.columns || 100;
  const line = `${V}${'═'.repeat(w - 1)}${R}`;

  const backendGlyphs = backends.map(id => GLYPHS[id] ?? id).join('  ');

  return [
    '',
    line,
    `  ${V}${bold}◈${R}  ${VL}${bold}a r c${R}   ${SD}v${version}${R}`,
    `  ${SD}LLM Terminal Platform · Linux · KDE${R}`,
    `  ${SD}Built by ${R}${VL}${bold}The Architect${R}`,
    backends.length > 0
      ? `  ${SD}Detected:${R}  ${backendGlyphs}`
      : `  ${SD}No backends detected — run${R} ${V}arc --help${R}`,
    line,
    '',
  ].join('\n');
}
