// ─────────────────────────────────────────────────────────────────────────────
// backends/gguf.ts — Shared .gguf model discovery for the llama.cpp backends
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { execSync } from 'child_process';
import { makeModel, ArcModel } from './base';
import { config } from '../config';

// Well-known places people keep .gguf files
export const DEFAULT_MODEL_DIRS = [
  '~/models',
  '~/gguf',
  '~/.local/share/llama-models',
  '~/llama.cpp/models',
];

export const expandHome = (p: string): string =>
  p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;

export function findGgufFiles(dirs: string[], maxDepth = 2): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > maxDepth || seen.has(dir)) return;
    seen.add(dir);
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice(0, 500)) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        scan(full, depth + 1);
      } else if (/\.gguf$/i.test(e.name)) {
        try {
          const st = fs.statSync(full);
          if (st.size > 0) out.push(full);
        } catch { /* unreadable file */ }
      }
    }
  };
  for (const d of dirs) scan(expandHome(d), 0);
  return out.sort();
}

/** Absolute path to a llama.cpp binary (llama-server, llama-cli, …), or null */
export function whichBin(name: string): string | null {
  try {
    const p = execSync(`command -v ${name}`, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (p) return p;
  } catch { /* not installed */ }
  return null;
}

/** Discover every .gguf the user can load — config dir wins, else defaults */
export function discoverGgufModels(): ArcModel[] {
  const configured = (() => {
    try { return config.get().defaults.llamacppModelDir?.trim() || undefined; }
    catch { return undefined; }
  })();
  const dirs  = configured ? [configured] : [...DEFAULT_MODEL_DIRS, process.cwd()];
  const files = findGgufFiles(dirs, configured ? 3 : 2);
  return files.map(f => {
    const name = path.basename(f, '.gguf');
    let size = 'unknown';
    try { size = formatBytes(fs.statSync(f).size); } catch { /* best effort */ }
    return makeModel({
      id:      f,
      name,
      backend: 'llamacpp',
      family:  'gguf',
      size,
      quant:   extractQuant(name),
      raw:     f,
    });
  });
}

export function extractSize(name: string): string {
  const m = name.match(/(\d+\.?\d*)[Bb]/);
  return m ? `${m[1]}B` : 'unknown';
}

export function extractQuant(name: string): string {
  const m = name.match(/(Q\d+_[A-Z0-9_]+|f16|f32|fp16|fp32)/i);
  return m ? m[1].toUpperCase() : '';
}

export function formatBytes(n: number): string {
  if (!n) return 'unknown';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}MB`;
  return `${n}B`;
}
