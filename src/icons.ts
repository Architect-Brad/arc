// ─────────────────────────────────────────────────────────────────────────────
// icons.ts — Status icons and UI elements (NO emojis)
// Backend glyphs all sourced from logos.ts
// ─────────────────────────────────────────────────────────────────────────────

import { ansi }  from './ansi';
import { GLYPHS, BADGE_COLORS } from './logos';

const { fg, bg, bold, dim, italic, reset: R } = ansi;

const V  = fg(139,  92, 246);
const VL = fg(167, 139, 250);
const VF = fg(196, 181, 253);
const CY = fg(103, 232, 249);
const GR = fg(134, 239, 172);
const YW = fg(250, 204,  21);
const OR = fg(251, 146,  60);
const RE = fg(248, 113, 113);
const SD = fg(100, 116, 139);
const SL = fg(226, 232, 240);

// Re-export for convenience — single source of truth from logos.ts
export { GLYPHS as BACKEND_ICONS, BADGE_COLORS as BACKEND_COLORS } from './logos';

export const ICONS = {
  ok:          `${GR}✓${R}`,
  err:         `${RE}✗${R}`,
  warn:        `${YW}⚠${R}`,
  info:        `${CY}ℹ${R}`,
  dot:         `${SD}·${R}`,
  arrow:       `${V}▶${R}`,
  prompt:      `${V}›${R}`,
  pipe:        `${SD}│${R}`,
  thinkOpen:   `${VF}${dim}⟨ thinking ⟩${R}`,
  thinkClose:  `${VF}${dim}⟨ done ⟩${R}`,
  atSign:      `${YW}@${R}`,
  slash:       `${V}/${R}`,
};

// Spinner frames
export const SPINNER_VIOLET = ['◐','◓','◑','◒'].map(f => `${V}${f}${R}`);
export const SPINNER_THINK  = ['◦','◦◦','◦◦◦','◦◦','◦'].map(f => `${VF}${dim}${f}${R}`);

export class Spinner {
  private frame = 0;
  private iv?:  ReturnType<typeof setInterval>;
  constructor(private frames = SPINNER_VIOLET, private label = '') {}
  start(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write(ansi.hideCursor);
    this.iv = setInterval(() => {
      const f = this.frames[this.frame++ % this.frames.length];
      process.stdout.write(`\r${f}  ${SD}${this.label}${R}  `);
    }, 80);
  }
  stop(clear = true): void {
    clearInterval(this.iv);
    if (clear && process.stdout.isTTY) process.stdout.write(`\r${ansi.clearToEnd}`);
    process.stdout.write(ansi.showCursor);
  }
  setLabel(l: string): void { this.label = l; }
}

export function divider(width = process.stdout.columns || 100, color = V): string {
  return `${color}${'─'.repeat(Math.max(1, width - 1))}${R}`;
}
export function doubleDivider(width = process.stdout.columns || 100): string {
  return `${V}${'═'.repeat(Math.max(1, width - 1))}${R}`;
}
export function sectionHeader(label: string, width = process.stdout.columns || 100): string {
  const pad = Math.max(0, width - label.length - 6);
  return `${V}── ${VL}${bold}${label}${R} ${SD}${'─'.repeat(pad)}${R}`;
}

export function thinkingHeader(width = process.stdout.columns || 100): string {
  const label = ' thinking ';
  const pad   = Math.max(0, width - label.length - 4);
  return `${VF}${dim}╭─${italic}${label}${R}${VF}${dim}${'─'.repeat(pad)}╮${R}`;
}
export function thinkingFooter(width = process.stdout.columns || 100): string {
  return `${VF}${dim}╰${'─'.repeat(Math.max(1, width - 3))}╯${R}`;
}
export function thinkingLine(text: string): string {
  return `${VF}${dim}│${R} ${italic}${SD}${text}${R}`;
}

// Runnable langs — get [r] run button
export const RUNNABLE_LANGS = new Set([
  'javascript','js','typescript','ts','python','py',
  'bash','sh','shell','ruby','rb','go','rust','rs',
  'node','perl','php','lua',
]);

export function codeActionBar(lang: string, _lineCount: number): string {
  const isRunnable = RUNNABLE_LANGS.has(lang.toLowerCase());
  const parts: string[] = [];
  if (isRunnable) parts.push(`${GR}[r]${R} ${SD}run${R}`);
  parts.push(`${CY}[c]${R} ${SD}copy${R}`);
  parts.push(`${SD}[s] save${R}`);
  const sep      = `  ${SD}·${R}  `;
  const langLabel = lang ? `${SD}${dim}${lang}  ${R}` : '';
  return `  ${langLabel}${parts.join(sep)}`;
}

export function statsBar(tokens: number, ms: number, model: string, backendId: string): string {
  const tps   = (tokens / Math.max(ms / 1000, 0.001)).toFixed(0);
  const dur   = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const bc    = BADGE_COLORS[backendId] ?? SD;
  const glyph = GLYPHS[backendId]       ?? '';
  return `  ${SD}◦  ${SD}${tokens} tok${R}  ${SD}${dur}${R}  ${CY}${tps} tok/s${R}  ${bc}${glyph} ${model}${R}`;
}

export function atPill(cmd: string, desc: string, selected: boolean): string {
  const bg2  = selected ? ansi.bg(30, 20, 60) : '';
  const bgR  = selected ? R : '';
  const arr  = selected ? `${V}▶${R} ` : '  ';
  return `${arr}${bg2}${YW}@${cmd}${R}  ${SD}${desc}${R}${bgR}`;
}
export function slashPill(cmd: string, desc: string, selected: boolean): string {
  const bg2  = selected ? ansi.bg(30, 20, 60) : '';
  const bgR  = selected ? R : '';
  const arr  = selected ? `${V}▶${R} ` : '  ';
  return `${arr}${bg2}${V}/${cmd}${R}  ${SD}${desc}${R}${bgR}`;
}

// Keep old name for compat
export { BADGE_COLORS } from './logos';
