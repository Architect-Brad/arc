// ─────────────────────────────────────────────────────────────────────────────
// config.ts — arc configuration system
//
// Reads/writes ~/.config/arc/config.toml
// Zero dependencies — custom parser handles the subset of TOML arc needs.
//
// Example config:
//   [defaults]
//   model    = "qwen2.5-coder:0.5b"
//   backend  = "ollama"
//   speed    = 240
//   persona  = "assistant"
//
//   [ui]
//   typewriter = true
//   compact    = false
//   show_stats = true
//
//   [aliases]
//   fast = "--backend ollama --model llama3.2"
//
//   [keybinds]
//   clear = "ctrl+l"
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ArcConfig {
  defaults: {
    model?:    string;
    backend?:  string;
    speed:     number;
    persona?:  string;
    system?:     string;
    ollamaHost?: string;
    llamacppModelDir?: string;
    temperature?: number;
    topP?:       number;
    seed?:       number;
  };
  ui: {
    typewriter:  boolean;
    compact:     boolean;
    show_stats:  boolean;
    show_ctx:    boolean;
  };
  aliases:   Record<string, string>;
  keybinds:  Record<string, string>;
  server: {
    port: number;
    host: string;
  };
}

const DEFAULT_CONFIG: ArcConfig = {
  defaults: {
    speed:    240,
    // temperature / topP / seed are intentionally unset: when absent, the
    // backend (or the model server) decides. See /temp, /top-p, /seed, /gen.
  },
  ui: {
    typewriter:  true,
    compact:     false,
    show_stats:  true,
    show_ctx:    true,
  },
  aliases:  {},
  keybinds: {
    clear: 'ctrl+l',
    model: 'ctrl+m',
    copy:  'ctrl+y',
  },
  server: {
    port: 7070,
    host: '127.0.0.1',
  },
};

// ── Paths ─────────────────────────────────────────────────────────────────────

export const CONFIG_DIR  = path.join(os.homedir(), '.config', 'arc');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');
export const PERSONA_DIR = path.join(CONFIG_DIR, 'personas');

// ── Tiny TOML parser (subset: sections, string/number/bool values) ─────────────

function parseTOML(src: string): Record<string, any> {
  const result: Record<string, any> = {};
  let section = '';

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Section header [name]
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      section = secMatch[1];
      if (!result[section]) result[section] = {};
      continue;
    }

    // Key = value
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();

    const target = section ? result[section] : result;

    // Parse value type
    if (val === 'true')  { target[key] = true;  continue; }
    if (val === 'false') { target[key] = false; continue; }
    if (/^-?\d+(\.\d+)?$/.test(val)) { target[key] = parseFloat(val); continue; }
    // String (strip quotes)
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      target[key] = val.slice(1, -1);
      continue;
    }
    target[key] = val; // bare string
  }
  return result;
}

// TOML written by older versions (or `config set` on an unset key) can leave
// numeric values as quoted strings. Coerce them at read time so generation
// params never reach a backend as "0.4".
const NUMERIC_DEFAULTS = ['speed', 'temperature', 'topP', 'seed'] as const;

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function serializeTOML(cfg: ArcConfig): string {
  const lines: string[] = [
    '# arc configuration',
    '# ~/.config/arc/config.toml',
    '# Built by The Architect',
    '',
    '[defaults]',
  ];

  if (cfg.defaults.model)      lines.push(`model      = "${cfg.defaults.model}"`);
  if (cfg.defaults.backend)    lines.push(`backend    = "${cfg.defaults.backend}"`);
  if (cfg.defaults.persona)    lines.push(`persona    = "${cfg.defaults.persona}"`);
  if (cfg.defaults.system)     lines.push(`system     = "${cfg.defaults.system}"`);
  if (cfg.defaults.ollamaHost) lines.push(`ollamaHost = "${cfg.defaults.ollamaHost}"`);
  if (cfg.defaults.llamacppModelDir) lines.push(`llamacppModelDir = "${cfg.defaults.llamacppModelDir}"`);
  lines.push(`speed   = ${cfg.defaults.speed}`);
  if (cfg.defaults.temperature !== undefined) lines.push(`temperature = ${cfg.defaults.temperature}`);
  if (cfg.defaults.topP        !== undefined) lines.push(`topP        = ${cfg.defaults.topP}`);
  if (cfg.defaults.seed        !== undefined) lines.push(`seed        = ${cfg.defaults.seed}`);

  lines.push('', '[ui]');
  lines.push(`typewriter = ${cfg.ui.typewriter}`);
  lines.push(`compact    = ${cfg.ui.compact}`);
  lines.push(`show_stats = ${cfg.ui.show_stats}`);
  lines.push(`show_ctx   = ${cfg.ui.show_ctx}`);

  lines.push('', '[server]');
  lines.push(`port = ${cfg.server.port}`);
  lines.push(`host = "${cfg.server.host}"`);

  if (Object.keys(cfg.aliases).length > 0) {
    lines.push('', '[aliases]');
    for (const [k, v] of Object.entries(cfg.aliases)) {
      lines.push(`${k} = "${v}"`);
    }
  }

  if (Object.keys(cfg.keybinds).length > 0) {
    lines.push('', '[keybinds]');
    for (const [k, v] of Object.entries(cfg.keybinds)) {
      lines.push(`${k} = "${v}"`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Config manager ────────────────────────────────────────────────────────────

class ConfigManager {
  private cfg: ArcConfig = structuredClone(DEFAULT_CONFIG);
  private loaded = false;

  load(): ArcConfig {
    if (this.loaded) return this.cfg;
    this.loaded = true;

    if (!fs.existsSync(CONFIG_FILE)) {
      // First run — create default config
      this.save();
      return this.cfg;
    }

    try {
      const src   = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = parseTOML(src);

      // Deep merge parsed over defaults
      this.cfg = {
        defaults: { ...DEFAULT_CONFIG.defaults, ...parsed.defaults },
        ui:       { ...DEFAULT_CONFIG.ui,       ...parsed.ui       },
        aliases:  { ...DEFAULT_CONFIG.aliases,  ...parsed.aliases  },
        keybinds: { ...DEFAULT_CONFIG.keybinds, ...parsed.keybinds },
        server:   { ...DEFAULT_CONFIG.server,   ...parsed.server   },
      };

      // Numeric generation values may arrive as strings — normalise them.
      for (const key of NUMERIC_DEFAULTS) {
        const value = (this.cfg.defaults as any)[key];
        if (value === undefined) continue;
        const n = coerceNumber(value);
        if (n === undefined) delete (this.cfg.defaults as any)[key];
        else (this.cfg.defaults as any)[key] = n;
      }
    } catch {
      // Malformed config — use defaults silently
    }

    return this.cfg;
  }

  get(): ArcConfig {
    return this.loaded ? this.cfg : this.load();
  }

  set<K extends keyof ArcConfig>(section: K, key: string, value: any): void {
    this.load();
    const target  = this.cfg[section] as any;
    const current = target[key];
    // CLI values arrive as strings — preserve the config's declared types
    const numeric = typeof current === 'number' ||
      (section === 'defaults' && (NUMERIC_DEFAULTS as readonly string[]).includes(key));
    if (numeric) {
      const n = Number(value);
      target[key] = Number.isFinite(n) ? n : current;
    } else if (typeof current === 'boolean') {
      target[key] = value === true || value === 'true';
    } else {
      target[key] = value;
    }
    this.save();
  }

  save(): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, serializeTOML(this.cfg));
  }

  // Apply CLI args on top of config (CLI always wins)
  applyArgs(args: {
    model?:   string;
    backend?: string;
    speed?:   number;
    persona?: string;
  }): void {
    if (args.model)   this.cfg.defaults.model   = args.model;
    if (args.backend) this.cfg.defaults.backend  = args.backend;
    if (args.speed)   this.cfg.defaults.speed    = args.speed;
    if (args.persona) this.cfg.defaults.persona  = args.persona;
  }
}

export const config = new ConfigManager();

// ── arc config CLI subcommand ─────────────────────────────────────────────────

import { ansi } from './ansi';
const V  = ansi.fg(139,  92, 246);
const VL = ansi.fg(167, 139, 250);
const SD = ansi.fg(100, 116, 139);
const GR = ansi.fg(134, 239, 172);
const YW = ansi.fg(250, 204,  21);
const R  = ansi.reset;

export function printConfig(): void {
  const cfg = config.load();
  console.log();
  console.log(`${V}── arc config ${SD}${CONFIG_FILE}${R} ${V}${'─'.repeat(20)}${R}`);
  console.log();

  console.log(`${VL}[defaults]${R}`);
  console.log(`  model   = ${SD}${cfg.defaults.model   ?? '(none — picked at startup)'}${R}`);
  console.log(`  backend = ${SD}${cfg.defaults.backend  ?? '(auto-detect)'}${R}`);
  console.log(`  persona = ${SD}${cfg.defaults.persona  ?? '(none)'}${R}`);
  console.log(`  system  = ${SD}${cfg.defaults.system   ?? '(none)'}${R}`);
  console.log(`  ollamaHost = ${SD}${cfg.defaults.ollamaHost ?? '(localhost:11434)'}${R}`);
  console.log(`  llamacppModelDir = ${SD}${cfg.defaults.llamacppModelDir ?? '(well-known dirs)'}${R}`);
  console.log(`  speed   = ${SD}${cfg.defaults.speed} chars/sec${R}`);
  console.log(`  temperature = ${SD}${cfg.defaults.temperature ?? '(server default)'}${R}`);
  console.log(`  topP        = ${SD}${cfg.defaults.topP        ?? '(server default)'}${R}`);
  console.log(`  seed        = ${SD}${cfg.defaults.seed        ?? '(server default)'}${R}`);
  console.log();

  console.log(`${VL}[ui]${R}`);
  const b = (v: boolean) => v ? `${GR}true${R}` : `${SD}false${R}`;
  console.log(`  typewriter = ${b(cfg.ui.typewriter)}`);
  console.log(`  compact    = ${b(cfg.ui.compact)}`);
  console.log(`  show_stats = ${b(cfg.ui.show_stats)}`);
  console.log(`  show_ctx   = ${b(cfg.ui.show_ctx)}`);
  console.log();

  if (Object.keys(cfg.aliases).length > 0) {
    console.log(`${VL}[aliases]${R}`);
    for (const [k, v] of Object.entries(cfg.aliases)) {
      console.log(`  ${YW}${k}${R} = ${SD}${v}${R}`);
    }
    console.log();
  }

  if (Object.keys(cfg.keybinds).length > 0) {
    console.log(`${VL}[keybinds]${R}`);
    for (const [k, v] of Object.entries(cfg.keybinds)) {
      console.log(`  ${YW}${k}${R} = ${SD}${v}${R}`);
    }
    console.log();
  }

  console.log(`${VL}[server]${R}`);
  console.log(`  port = ${SD}${cfg.server.port}${R}`);
  console.log(`  host = ${SD}${cfg.server.host}${R}`);
  console.log();

  console.log(`  ${SD}Edit: ${V}${CONFIG_FILE}${R}`);
  console.log(`  ${SD}Reset: ${V}arc config --reset${R}`);
  console.log();
}

export function handleConfigCmd(args: string[]): void {
  const [subcmd, key, ...rest] = args;

  if (!subcmd || subcmd === 'show') { printConfig(); return; }

  if (subcmd === '--reset' || subcmd === 'reset') {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, serializeTOML(DEFAULT_CONFIG));
    console.log(`  ${GR}✓${R} Config reset to defaults → ${V}${CONFIG_FILE}${R}\n`);
    return;
  }

  if (subcmd === 'set' && key) {
    const val = rest.join(' ');
    const [section, field] = key.includes('.') ? key.split('.', 2) : ['defaults', key];
    config.load();
    config.set(section as keyof ArcConfig, field, val);
    console.log(`  ${GR}✓${R} ${SD}${section}.${field}${R} = ${V}${val}${R}\n`);
    return;
  }

  if (subcmd === 'get' && key) {
    const cfg = config.load() as any;
    const [section, field] = key.includes('.') ? key.split('.', 2) : ['defaults', key];
    const val = cfg[section]?.[field];
    if (val !== undefined) console.log(`${val}\n`);
    else console.log(`  ${SD}(not set)${R}\n`);
    return;
  }

  console.log(`  Usage: arc config [show|set <key> <val>|get <key>|reset]\n`);
}
