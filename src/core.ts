// ─────────────────────────────────────────────────────────────────────────────
// core.ts — Bridge to arc native engine
// Prefers Rust binary (arc_core_rs), falls back to C++ (arc_core), then TS
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, ChildProcess } from 'child_process';
import * as path               from 'path';
import * as fs                 from 'fs';

const CORE_DIR    = path.join(__dirname, '..', 'core');
const RS_BINARY   = path.join(CORE_DIR, 'arc_core_rs');   // Rust (preferred)
const CPP_BINARY  = path.join(CORE_DIR, 'arc_core');      // C++ fallback

// ── Native process manager ────────────────────────────────────────────────────

class NativeCore {
  private proc:      ChildProcess | null = null;
  private available: boolean             = false;
  private engine:    string              = 'ts';
  private buf:       string              = '';
  private pending:   Array<(v: string) => void> = [];
  private ready:     Promise<boolean>;

  constructor() { this.ready = this.init(); }

  private async init(): Promise<boolean> {
    // Prefer Rust, fall back to C++
    const binary = fs.existsSync(RS_BINARY)  ? RS_BINARY
                 : fs.existsSync(CPP_BINARY) ? CPP_BINARY
                 : null;

    if (!binary) return false;

    let proc: ChildProcess;
    try {
      proc = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { return false; }
    this.proc = proc;

    // If the binary can't be exec'd (e.g. noexec mount) or dies instantly,
    // fall back to the TS engine instead of crashing the process.
    const spawnFailed = new Promise<boolean>((resolve) => {
      proc.on('error', () => resolve(true));
      proc.stdin?.on('error', () => {});
      proc.on('exit', () => resolve(true));
    });

    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        this.pending.shift()?.(line);
      }
    });
    proc.on('exit', () => { this.proc = null; this.available = false; });

    const pong = await Promise.race([
      this.send({ cmd: 'ping' }),
      spawnFailed,
      new Promise<null>(r => setTimeout(() => r(null), 2000)),
    ]);
    if (pong === true) return false; // spawn failed
    this.available = pong?.r === 'pong';
    this.engine    = pong?.engine ?? (binary === RS_BINARY ? 'rust' : 'cpp');
    return this.available;
  }

  private send(obj: object): Promise<any> {
    return new Promise((resolve) => {
      if (!this.proc?.stdin?.writable) { resolve(null); return; }
      const entry = (line: string) => {
        clearTimeout(timer);
        try { resolve(JSON.parse(line)); } catch { resolve(null); }
      };
      const timer = setTimeout(() => {
        const idx = this.pending.indexOf(entry);
        if (idx !== -1) this.pending.splice(idx, 1);
        resolve(null); // native core stalled — treat as unavailable for this call
      }, 2000);
      this.pending.push(entry);
      this.proc.stdin!.write(JSON.stringify(obj) + '\n');
    });
  }

  async isAvailable(): Promise<boolean> { await this.ready; return this.available; }
  getEngine(): string { return this.engine; }

  async call(obj: object): Promise<any> {
    if (!this.available) return null;
    return this.send(obj);
  }

  destroy(): void { this.proc?.kill(); this.proc = null; }
}

const native = new NativeCore();

// ── TS fallbacks ──────────────────────────────────────────────────────────────

function ts_strip(s: string): string { return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ''); }
function ts_vlen(s: string): number  { return ts_strip(s).length; }
function ts_wrap(text: string, w: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = []; let cur = '';
  for (const word of words) {
    if (!cur) cur = word;
    else if (ts_vlen(cur) + 1 + word.length <= w) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function stripAnsiNative(s: string): Promise<string> {
  if (await native.isAvailable()) {
    const r = await native.call({ cmd: 'stripAnsi', s });
    if (r?.r != null) return r.r;
  }
  return ts_strip(s);
}

export async function highlightNative(code: string, lang: string): Promise<string | null> {
  if (await native.isAvailable()) {
    const r = await native.call({ cmd: 'highlight', code, lang });
    if (r?.r) return r.r;
  }
  return null;
}

export async function wrapTextNative(s: string, w: number): Promise<string[]> {
  if (await native.isAvailable()) {
    const r = await native.call({ cmd: 'wrapText', s, w });
    if (r?.r) return r.r;
  }
  return ts_wrap(s, w);
}

export async function estimateTokens(s: string): Promise<number> {
  if (await native.isAvailable()) {
    const r = await native.call({ cmd: 'estimateTokens', s });
    if (r?.r != null) return r.r;
  }
  return Math.ceil(s.length / 3.8);
}

// ── Context window tracker ────────────────────────────────────────────────────

export class ContextWindow {
  private used: number = 0;
  private max:  number = 0;
  private model: string = '';

  async init(model: string, maxTokens: number): Promise<void> {
    this.model = model;
    this.max   = maxTokens;
    this.used  = 0;
    await native.call({ cmd: 'contextSet', used: 0, max: maxTokens, model });
  }

  async add(tokens: number): Promise<void> {
    this.used += tokens;
    await native.call({ cmd: 'contextAdd', tokens });
  }

  async bar(width = 40): Promise<string> {
    if (await native.isAvailable()) {
      const r = await native.call({ cmd: 'contextBar', w: width });
      if (r?.r) return r.r;
    }
    return this.tsBar(width);
  }

  private tsBar(width: number): string {
    if (this.max === 0) return '';
    const pct    = Math.min(this.used / this.max, 1);
    const fill   = Math.round(pct * width);
    const empty  = width - fill;
    const color  = pct < 0.6 ? '\x1b[38;2;134;239;172m'
                 : pct < 0.85 ? '\x1b[38;2;250;204;21m'
                 : '\x1b[38;2;248;113;113m';
    const SD = '\x1b[38;2;100;116;139m';
    const R  = '\x1b[0m';
    return `${color}${'█'.repeat(fill)}${SD}${'░'.repeat(empty)}  ${this.used}/${this.max} tokens  ${(pct*100).toFixed(0)}%${R}`;
  }

  getUsed():  number { return this.used; }
  getMax():   number { return this.max; }
  getPct():   number { return this.max ? this.used / this.max : 0; }
}

// Common context window sizes per model family
export function modelContextSize(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes('llama3'))        return 131072;
  if (id.includes('qwen2.5'))       return 131072;
  if (id.includes('qwen3'))         return 131072;
  if (id.includes('qwq'))           return 131072;
  if (id.includes('mistral'))       return 32768;
  if (id.includes('gemma'))         return 8192;
  if (id.includes('phi'))           return 131072;
  if (id.includes('deepseek'))      return 65536;
  if (id.includes('claude'))        return 200000;
  if (id.includes('gpt-4'))         return 128000;
  if (id.includes('smollm'))        return 8192;
  if (id.includes('functiongemma')) return 8192;
  return 8192; // conservative default
}

export async function coreStatus(): Promise<{ engine: string; binary: string }> {
  const avail = await native.isAvailable();
  return {
    engine: avail ? native.getEngine() : 'ts',
    binary: fs.existsSync(RS_BINARY) ? RS_BINARY
          : fs.existsSync(CPP_BINARY) ? CPP_BINARY : 'none',
  };
}

// Sync helpers for hot render path
export const stripAnsiSync  = (s: string): string   => ts_strip(s);
export const visibleLengthSync = (s: string): number => ts_vlen(s);
export const wrapTextSync   = (s: string, w: number): string[] => ts_wrap(s, w);
export const estimateTokensSync = (s: string): number => Math.ceil(s.length / 3.8);

process.on('exit', () => native.destroy());
