// ─────────────────────────────────────────────────────────────────────────────
// typewriter.ts — Dual-mode streaming typewriter
//
// MODE 1: per-character ('char') — each character appears individually.
//         Feels cinematic. Good for short responses.
//
// MODE 2: per-word ('word') — buffers tokens until word boundary.
//         Feels like someone typing fast. Good for long responses.
//
// Both modes are ANSI-aware — escape sequences are atomic, never split.
// Both modes honour punctuation pacing.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';

export type TypewriterMode = 'char' | 'word' | 'instant';

export interface TypewriterOptions {
  mode?:          TypewriterMode;
  /** chars/sec for char mode. Default: 180 */
  cps?:           number;
  /** words/min for word mode. Default: 600 */
  wpm?:           number;
  /** Pause after . ! ? (ms) */
  sentencePause?: number;
  /** Pause after , ; : (ms) */
  commaPause?:    number;
  /** Pause after newlines (ms) */
  linePause?:     number;
  out?:           NodeJS.WriteStream;
}

const DEFAULTS: Required<TypewriterOptions> = {
  mode:          'char',
  cps:           180,
  wpm:           600,
  sentencePause: 90,
  commaPause:    30,
  linePause:     15,
  out:           process.stdout,
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── ANSI-safe character iterator ──────────────────────────────────────────────
// Yields atomic units: either a complete ANSI escape or a single UTF-8 char

function* ansiUnits(text: string): Generator<string> {
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x1b') {
      // Consume the full escape sequence
      let end = i + 1;
      if (text[end] === '[') {
        end++;
        while (end < text.length && !text[end].match(/[A-Za-z]/)) end++;
        end++; // include the final letter
      } else {
        end++; // ESC + one char (e.g. \x1b7, \x1b8)
      }
      yield text.slice(i, end);
      i = end;
    } else {
      // Handle multi-byte UTF-8 as a single unit
      const code = text.codePointAt(i)!;
      const charLen = code > 0xFFFF ? 2 : 1;
      yield text.slice(i, i + charLen);
      i += charLen;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Typewriter class
// ─────────────────────────────────────────────────────────────────────────────

export class Typewriter {
  private opts:    Required<TypewriterOptions>;
  private out:     NodeJS.WriteStream;
  private aborted  = false;
  private wordBuf  = '';   // word-mode buffer

  constructor(opts: TypewriterOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.out  = this.opts.out;
  }

  // ── Per-character streaming ───────────────────────────────────────────────

  private async emitChar(unit: string): Promise<void> {
    this.out.write(unit);
    if (unit.startsWith('\x1b')) return; // no delay for escape sequences

    const c = unit.trimEnd().slice(-1);
    if (/[.!?]/.test(c))       await sleep(this.opts.sentencePause);
    else if (/[,;:]/.test(c))  await sleep(this.opts.commaPause);
    else if (unit === '\n')     await sleep(this.opts.linePause);
    else if (unit.trim())       await sleep(Math.max(1, 1000 / this.opts.cps));
  }

  private async typeCharMode(text: string): Promise<void> {
    for (const unit of ansiUnits(text)) {
      if (this.aborted) return;
      await this.emitChar(unit);
    }
  }

  // ── Per-word streaming ────────────────────────────────────────────────────

  private async emitWord(word: string): Promise<void> {
    this.out.write(word);
    const stripped = word.replace(/\x1b\[[0-9;]*m/g, '');
    const last = stripped.trimEnd().slice(-1);
    if (/[.!?]/.test(last))      await sleep(this.opts.sentencePause);
    else if (/[,;:]/.test(last)) await sleep(this.opts.commaPause);
    else if (stripped.trim()) {
      const msPerWord = 60000 / this.opts.wpm;
      const chars = Math.max(1, stripped.replace(/\s/g, '').length);
      await sleep(Math.max(1, (msPerWord * chars) / 5));
    }
  }

  // ── Public streaming API ──────────────────────────────────────────────────

  /** Feed a raw token from the LLM stream. */
  async feedToken(token: string): Promise<void> {
    if (this.aborted) return;
    const mode = this.opts.mode;

    if (mode === 'instant' || !this.out.isTTY) {
      this.out.write(token);
      return;
    }

    if (mode === 'char') {
      await this.typeCharMode(token);
      return;
    }

    // word mode
    this.wordBuf += token;
    while (true) {
      const spaceIdx = this.wordBuf.search(/\s/);
      if (spaceIdx === -1) break;
      const word  = this.wordBuf.slice(0, spaceIdx);
      const space = this.wordBuf[spaceIdx];
      this.wordBuf = this.wordBuf.slice(spaceIdx + 1);
      if (word) await this.emitWord(word);
      this.out.write(space);
    }
  }

  /** Flush remaining buffer. Always call at end of stream. */
  async flush(): Promise<void> {
    if (this.wordBuf && !this.aborted) {
      await this.emitWord(this.wordBuf);
      this.wordBuf = '';
    }
  }

  // ── Line-level API (for non-streaming blocks) ─────────────────────────────

  async typeLine(line: string, instant = false): Promise<void> {
    if (this.aborted) return;
    const mode = instant ? 'instant' : this.opts.mode;

    if (mode === 'instant' || !this.out.isTTY) {
      this.out.write(line + '\n');
      return;
    }

    if (mode === 'char') {
      await this.typeCharMode(line);
      await sleep(this.opts.linePause);
      this.out.write('\n');
      return;
    }

    // word mode — line level
    const words = line.split(/(\s+)/);
    for (const w of words) {
      if (this.aborted) break;
      if (w.trim()) await this.emitWord(w);
      else this.out.write(w);
    }
    await sleep(this.opts.linePause);
    this.out.write('\n');
  }

  async typeLines(lines: string[], opts?: { instant?: boolean }): Promise<void> {
    for (const line of lines) {
      if (this.aborted) break;
      await this.typeLine(line, opts?.instant);
    }
  }

  printLine(line: string):  void { this.out.write(line + '\n'); }
  /** Batched write — single syscall for all lines. Significantly faster for large outputs. */
  printLines(lines: string[]): void {
    if (lines.length === 0) return;
    // Single syscall vs N syscalls — matches glow's approach
    this.out.write(lines.join('\n') + '\n');
  }

  abort():  void { this.aborted = true; }
  resume(): void { this.aborted = false; this.wordBuf = ''; }

  setMode(mode: TypewriterMode): void { this.opts.mode = mode; }
  getMode(): TypewriterMode { return this.opts.mode; }
}

export async function typewrite(text: string, opts?: TypewriterOptions): Promise<void> {
  const tw = new Typewriter(opts);
  for (const line of text.split('\n')) await tw.typeLine(line);
}
