// ─────────────────────────────────────────────────────────────────────────────
// inputbox.ts — Bordered chat input box (v3 — invariant-based redraw)
//
// Core invariant: after every draw(), the terminal cursor is at col 1
// of the line immediately BELOW the box. This is guaranteed because we
// write each line as `clearLine + content + \n`, so after the last \n
// the cursor is always at col 1 of the next line.
//
// Redraw: go up drawnLines, redraw from top, cursor ends below box again.
// No save/restore. No relative drift. No scroll issues.
//
// The visual input cursor (▋) is drawn INTO the box content as a character.
// The actual terminal cursor stays hidden and below the box at all times.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi }          from './ansi';
import { GLYPHS, BADGE_COLORS } from './logos';
import { ContextWindow } from './core';

const { fg, bold, reset: R } = ansi;

const V  = fg(139,  92, 246);
const SD = fg(100, 116, 139);
const YW = fg(250, 204,  21);
const SL = fg(226, 232, 240);

// Escape sequences
const UP    = (n: number) => `\x1b[${n}A`;
const COL1  = '\x1b[1G';
const CLR   = '\x1b[2K';   // clear entire line
const HIDE  = '\x1b[?25l';
const SHOW  = '\x1b[?25h';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}
function visLen(s: string): number {
  return stripAnsi(s).length;
}
function estimateTokens(t: string): number {
  return Math.ceil(t.length / 3.8);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface InputBoxOptions {
  modelName:      string;
  backendId:      string;
  contextWindow?: ContextWindow;
}

export class InputBox {
  private buf        = '';
  private cur        = 0;
  private history:   string[] = [];
  private histIdx    = -1;
  private opts:      InputBoxOptions;
  private drawnLines = 0;   // exact lines written last draw

  constructor(opts: InputBoxOptions) { this.opts = opts; }

  // ── Build box lines ─────────────────────────────────────────────────────────

  private buildLines(): string[] {
    const w      = Math.max(40, process.stdout.columns || 100);
    const inner  = w - 2;
    const glyph  = GLYPHS[this.opts.backendId]      ?? '';
    const bCol   = BADGE_COLORS[this.opts.backendId] ?? V;
    const tokens = estimateTokens(this.buf);

    // ── Context bar ──────────────────────────────────────────────────────────
    const ctx   = this.opts.contextWindow;
    let ctxLine = '';
    if (ctx && ctx.getMax() > 0) {
      const pct  = Math.min(ctx.getPct(), 1);
      const barW = Math.max(4, Math.min(24, inner - 22));
      const fill = Math.round(pct * barW);
      const col  = pct < 0.6  ? '\x1b[38;2;134;239;172m'
                 : pct < 0.85 ? '\x1b[38;2;250;204;21m'
                 : '\x1b[38;2;248;113;113m';
      const dimG = '\x1b[38;2;55;65;81m';
      ctxLine =
        '  ' + col + '█'.repeat(fill) + dimG + '░'.repeat(barW - fill) +
        R + '  ' + SD + ctx.getUsed() + '/' + ctx.getMax() +
        '  ' + (pct * 100).toFixed(0) + '%' + R;
    }

    // ── Top border ────────────────────────────────────────────────────────────
    const modelTag = ` ${glyph} ${this.opts.modelName} `;
    const tokTag   = ` ~${tokens} tok `;
    const fillW    = Math.max(0, inner - visLen(modelTag) - visLen(tokTag));
    const top =
      V + '╭' + R +
      bCol + bold + modelTag + R +
      V + '─'.repeat(fillW) + R +
      SD + tokTag + R +
      V + '╮' + R;

    // ── Input line with embedded ▋ cursor ─────────────────────────────────────
    const prefixVis = 4;           // '│ › ' = 4 visible chars
    const areaW     = inner - prefixVis - 1;  // -1 for trailing │

    // Viewport: keep cursor in view
    let viewStart = 0;
    if (this.buf.length > areaW) {
      viewStart = Math.max(0, this.cur - Math.floor(areaW * 0.65));
      viewStart = Math.min(viewStart, this.buf.length - areaW);
    }
    const viewBuf    = this.buf.slice(viewStart, viewStart + areaW);
    const curInView  = Math.min(this.cur - viewStart, viewBuf.length);

    // Split view at cursor position and insert ▋
    const beforeCur  = viewBuf.slice(0, curInView);
    const afterCur   = viewBuf.slice(curInView);
    const cursorChar = `${V}▋${R}`;

    // Colorize /commands and @commands
    const colorize = (s: string) => s
      .replace(/(\/\w+)/g, `${V}$1${R}`)
      .replace(/(@\w+)/g,  `${YW}$1${R}`)
      .replace(/\n/g,       `${SD}↵${R}`);

    const displayContent =
      colorize(beforeCur) + cursorChar + colorize(afterCur);

    // Pad to fill the input area (using raw buf length for accurate padding)
    const contentVisLen = viewBuf.length + 1; // +1 for ▋
    const padLen        = Math.max(0, areaW - contentVisLen + 1); // +1 because ▋ is 0-width logically
    const padded        = displayContent + ' '.repeat(padLen);

    const mid =
      V + '│' + R +
      ' ' + V + '›' + R + ' ' +
      SL + padded + R +
      V + '│' + R;

    // ── Bottom bar ────────────────────────────────────────────────────────────
    const hints   = ` ${V}/${R}${SD}help${R}  ${YW}@${R}${SD}file  @paste${R} `;
    const nav     = ` ${SD}↑↓ hist  tab  ↵ send${R} `;
    const botFill = Math.max(0, inner - visLen(hints) - visLen(nav));
    const bot =
      V + '╰' + R +
      hints +
      V + '─'.repeat(botFill) + R +
      nav +
      V + '╯' + R;

    // ── Assemble — always a blank spacer first ────────────────────────────────
    const ls: string[] = [''];   // blank line above box for breathing room
    if (ctxLine) ls.push(ctxLine);
    ls.push(top);
    ls.push(mid);
    ls.push(bot);
    return ls;
  }

  // ── Draw / redraw ───────────────────────────────────────────────────────────
  // INVARIANT: after draw() returns, terminal cursor is at col 1 of the line
  // immediately below the box (drawnLines lines below where we started).

  private draw(): void {
    if (!process.stdout.isTTY) return;

    const ls     = this.buildLines();
    let   output = '';

    // 1. Move cursor up to top of previous box (if any)
    if (this.drawnLines > 0) {
      output += UP(this.drawnLines) + COL1;
    }

    // 2. Write each line: clear the line first, then content, then newline.
    //    After the final \n the cursor is at col 1 of the line below the box.
    for (const l of ls) {
      output += CLR + l + '\n';
    }

    this.drawnLines = ls.length;

    // 3. Write in one syscall — minimises flicker
    process.stdout.write(output);
  }

  // ── Public readline ─────────────────────────────────────────────────────────

  async read(): Promise<{ text: string; cancelled: boolean }> {
    this.buf        = '';
    this.cur        = 0;
    this.histIdx    = -1;
    this.drawnLines = 0;

    // Non-TTY: bare readline
    if (!process.stdout.isTTY) {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      return new Promise(res => rl.question('› ', (l: string) => { rl.close(); res({ text: l.trim(), cancelled: false }); }));
    }

    process.stdout.write(HIDE);
    // Write a single blank line so the first draw() has a line to go up to
    // (prevents the box appearing at the very top of the terminal on first use)
    process.stdout.write('\n');
    this.drawnLines = 1;
    this.draw();

    return new Promise((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const done = (cancelled: boolean) => {
        off();
        // Cursor is below the box. Clear the box by going up and clearing.
        // Leave a single blank line where the box was so output flows naturally.
        let output = '';
        if (this.drawnLines > 0) {
          output += UP(this.drawnLines) + COL1;
          for (let i = 0; i < this.drawnLines; i++) output += CLR + '\n';
        }
        output += SHOW;
        process.stdout.write(output);

        const text = this.buf.trim();
        if (text) {
          this.history.push(text);
          if (this.history.length > 500) this.history.shift();
        }
        resolve({ text, cancelled });
      };

      const onKey = (key: string) => {
        if (key === '\u0003')             { done(true);  return; }  // Ctrl+C
        if (key === '\r' || key === '\n') { done(false); return; }  // Enter

        let changed = true;

        if      (key === '\u001b')                                { this.buf = ''; this.cur = 0; }
        else if (key === '\u001b[A')                              { this.histPrev(); }   // up
        else if (key === '\u001b[B')                              { this.histNext(); }   // down
        else if (key === '\u001b[D')                              { this.cur = Math.max(0, this.cur - 1); }
        else if (key === '\u001b[C')                              { this.cur = Math.min(this.buf.length, this.cur + 1); }
        else if (key === '\u001b[H' || key === '\u0001')          { this.cur = 0; }
        else if (key === '\u001b[F' || key === '\u0005')          { this.cur = this.buf.length; }
        else if (key === '\u0015')                                { this.buf = ''; this.cur = 0; }
        else if (key === '\u0017')                                { this.deleteWord(); }
        else if (key === '\u007f' || key === '\b')                { this.backspace(); }
        else if (key === '\u001b[3~')                             { this.deleteForward(); }
        else if (key === '\n' || key === '\u000a' || key === '\u000b') { this.insertChar('\n'); }  // Shift+Enter / Ctrl+J
        else if (key.length === 1 && key >= ' ')                 { this.insertChar(key); }
        else                                                       { changed = false; }

        if (changed) this.draw();
      };

      const off = () => {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        process.stdin.pause();
      };

      process.stdin.on('data', onKey);
    });
  }

  // ── Buffer mutations ────────────────────────────────────────────────────────

  private insertChar(ch: string): void {
    this.buf = this.buf.slice(0, this.cur) + ch + this.buf.slice(this.cur);
    this.cur++;
  }
  private backspace(): void {
    if (this.cur > 0) {
      this.buf = this.buf.slice(0, this.cur - 1) + this.buf.slice(this.cur);
      this.cur--;
    }
  }
  private deleteForward(): void {
    if (this.cur < this.buf.length) {
      this.buf = this.buf.slice(0, this.cur) + this.buf.slice(this.cur + 1);
    }
  }
  private deleteWord(): void {
    const b    = this.buf.slice(0, this.cur).replace(/\S+\s*$/, '');
    this.buf   = b + this.buf.slice(this.cur);
    this.cur   = b.length;
  }
  private histPrev(): void {
    if (this.histIdx < this.history.length - 1) {
      this.histIdx++;
      this.buf = this.history[this.history.length - 1 - this.histIdx];
      this.cur = this.buf.length;
    }
  }
  private histNext(): void {
    if (this.histIdx > 0)  { this.histIdx--; this.buf = this.history[this.history.length - 1 - this.histIdx]; }
    else                   { this.histIdx = -1; this.buf = ''; }
    this.cur = this.buf.length;
  }

  addToHistory(text: string): void {
    if (text && (this.history.length === 0 || this.history[this.history.length - 1] !== text)) {
      this.history.push(text);
      if (this.history.length > 500) this.history.shift();
    }
  }
}
