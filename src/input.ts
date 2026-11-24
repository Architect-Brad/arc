// ─────────────────────────────────────────────────────────────────────────────
// input.ts — Enhanced readline with:
//   • /command autocomplete dropdown (live as you type)
//   • @command autocomplete dropdown (file, url, system, paste, history)
//   • Code block action bar (run, copy, save) after each response
// ─────────────────────────────────────────────────────────────────────────────

import * as fs            from 'fs';
import * as path          from 'path';
import * as readline      from 'readline';
import { execSync, exec } from 'child_process';
import { ansi }           from './ansi';
import { slashPill, atPill, RUNNABLE_LANGS } from './icons';

const V  = ansi.fg(139,  92, 246);
const VL = ansi.fg(167, 139, 250);
const SD = ansi.fg(100, 116, 139);
const GR = ansi.fg(134, 239, 172);
const RE = ansi.fg(248, 113, 113);
const CY = ansi.fg(103, 232, 249);
const YW = ansi.fg(250, 204,  21);
const R  = ansi.reset;

// ─────────────────────────────────────────────────────────────────────────────
// /command registry
// ─────────────────────────────────────────────────────────────────────────────

export interface SlashCommand {
  name:    string;
  desc:    string;
  alias?:  string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help',    desc: 'Show all commands' },
  { name: 'clear',   desc: 'Clear conversation history' },
  { name: 'model',   desc: 'Switch model / backend' },
  { name: 'copy',    desc: 'Copy last response to clipboard' },
  { name: 'save',    desc: 'Save conversation to file' },
  { name: 'export',  desc: 'Export conversation as Markdown or JSON' },
  { name: 'system',  desc: 'Set a system prompt for this session' },
  { name: 'temp',    desc: 'Set temperature 0..2 (e.g. /temp 0.7)' },
  { name: 'top-p',   desc: 'Set top-p 0..1 (e.g. /top-p 0.9)' },
  { name: 'seed',    desc: 'Set integer seed (e.g. /seed 42)' },
  { name: 'gen',     desc: 'Show generation settings for this session' },
  { name: 'tokens',  desc: 'Show token usage for this session' },
  { name: 'retry',   desc: 'Resend last message' },
  { name: 'undo',    desc: 'Remove last exchange from history' },
  { name: 'reset',   desc: 'Reset to a fresh session' },
  { name: 'exit',    desc: 'Exit arc' },
  { name: 'persona',  desc: 'Switch persona: /persona coder  or  /persona list' },
  { name: 'typing',   desc: 'Typewriter mode: /typing char · word · instant' },
  { name: 'config',   desc: 'Show arc config: /config' },
  { name: 'bench',    desc: 'Quick benchmark: /bench' },
  { name: 'settings', desc: 'Open the settings pane (no wrench required)' },
  { name: 'wiki',     desc: 'Open the manual you actually have' },
  { name: 'joke',     desc: 'One free joke (The Architect approves)' },
];

// ─────────────────────────────────────────────────────────────────────────────
// @command registry
// ─────────────────────────────────────────────────────────────────────────────

export interface AtCommand {
  name:    string;
  desc:    string;
  resolve: (arg: string) => Promise<string | null>;
}

export const AT_COMMANDS: AtCommand[] = [
  {
    name: 'file',
    desc: 'Attach a file: @file:path/to/file',
    resolve: async (arg) => {
      try {
        const content = fs.readFileSync(path.resolve(arg), 'utf8');
        return `\n\n<file path="${arg}">\n${content}\n</file>`;
      } catch { return null; }
    },
  },
  {
    name: 'url',
    desc: 'Fetch a URL and attach its text: @url:https://...',
    resolve: async (arg) => {
      try {
        const { scrapeUrl, formatScrapeResult } = await import('./scraper');
        const result = await scrapeUrl(arg);
        if (result.error) return `[Error fetching ${arg}: ${result.error}]`;
        return '\n\n' + formatScrapeResult(result);
      } catch (e: any) { return `[Scrape error: ${e.message}]`; }
    },
  },
  {
    name: 'paste',
    desc: 'Paste clipboard contents inline: @paste',
    resolve: async () => {
      try {
        for (const cmd of ['wl-paste', 'xclip -selection clipboard -o', 'xsel --clipboard --output']) {
          try {
            const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim();
            if (out) return `\n\n<paste>\n${out}\n</paste>`;
          } catch { /* try next */ }
        }
        return null;
      } catch { return null; }
    },
  },
  {
    name: 'system',
    desc: 'Insert text as system context: @system:You are a ...',
    resolve: async (arg) => arg ? `[SYSTEM: ${arg}]` : null,
  },
  {
    name: 'history',
    desc: 'Summarise conversation so far: @history',
    resolve: async () => '[CONTEXT: see attached history]',
  },
  {
    name: 'cwd',
    desc: 'Attach current directory tree: @cwd',
    resolve: async () => {
      try {
        const out = execSync('find . -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null',
          { encoding: 'utf8' }).trim();
        return `\n\n<cwd>\n${out}\n</cwd>`;
      } catch { return null; }
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Autocomplete dropdown renderer
// ─────────────────────────────────────────────────────────────────────────────

class Dropdown {
  private rows:    string[]  = [];
  private visible: boolean   = false;

  show(rows: string[]): void {
    this.hide();
    this.rows    = rows;
    this.visible = true;
    if (!process.stdout.isTTY) return;
    process.stdout.write('\n');
    rows.forEach(r => process.stdout.write(r + '\n'));
  }

  hide(): void {
    if (!this.visible || !process.stdout.isTTY) return;
    const count = this.rows.length + 1;
    for (let i = 0; i < count; i++) {
      process.stdout.write(ansi.up(1) + ansi.col(1) + ansi.clearLine);
    }
    this.visible = false;
    this.rows    = [];
  }

  isVisible(): boolean { return this.visible; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced prompt line — handles @/command autocomplete in raw mode
// ─────────────────────────────────────────────────────────────────────────────

export interface InputResult {
  text:         string;
  attachments:  string[];   // resolved @command injections
  isSlashCmd?:  string;     // e.g. "clear", "exit"
  slashArgs?:   string;
}

export class EnhancedInput {
  private dropdown   = new Dropdown();
  private slashSel   = 0;
  private atSel      = 0;
  private dropType:  'slash' | 'at' | null = null;
  private buf        = '';
  private cursorPos  = 0;
  private history:   string[] = [];
  private histIdx:   number   = -1;
  private promptStr: string;

  constructor(promptStr = `${V}›${R} `) {
    this.promptStr = promptStr;
  }

  /** Read one line with full autocomplete support. Returns null on Ctrl+C. */
  async readline(): Promise<InputResult | null> {
    return new Promise((resolve) => {
      this.buf       = '';
      this.cursorPos = 0;
      this.histIdx   = -1;
      this.dropType  = null;

      if (!process.stdin.isTTY) {
        // Non-TTY: fall back to simple readline
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(this.promptStr, (line) => {
          rl.close();
          resolve(this.parseResult(line));
        });
        return;
      }

      process.stdout.write(this.promptStr);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onKey = async (key: string) => {
        // Ctrl+C
        if (key === '\u0003') {
          this.cleanup();
          resolve(null);
          return;
        }
        // Enter
        if (key === '\r' || key === '\n') {
          // If dropdown visible and slash selected — complete it
          if (this.dropType === 'slash' && this.dropdown.isVisible()) {
            const matches = this.slashMatches();
            if (matches[this.slashSel]) {
              const cmd = matches[this.slashSel];
              const spaceIdx = this.buf.indexOf(' ');
              const args = spaceIdx !== -1 ? this.buf.slice(spaceIdx + 1) : '';
              this.dropdown.hide();
              this.cleanup();
              resolve({ text: `/${cmd.name}${args ? ' ' + args : ''}`, attachments: [], isSlashCmd: cmd.name, slashArgs: args });
              return;
            }
          }
          this.dropdown.hide();
          process.stdout.write('\n');
          this.cleanup();
          resolve(await this.parseResult(this.buf));
          return;
        }
        // Escape
        if (key === '\u001b' || key === '\u001b[') {
          this.dropdown.hide();
          this.dropType = null;
          this.redrawLine();
          return;
        }
        // Tab — complete first match
        if (key === '\t') {
          if (this.dropType === 'slash') {
            const m = this.slashMatches();
            if (m[0]) { this.buf = '/' + m[0].name + ' '; this.cursorPos = this.buf.length; }
          } else if (this.dropType === 'at') {
            const m = this.atMatches();
            if (m[0]) { this.buf = '@' + m[0].name + ':'; this.cursorPos = this.buf.length; }
          }
          this.dropdown.hide();
          this.dropType = null;
          this.redrawLine();
          return;
        }
        // Arrow up/down in dropdown
        if (key === '\u001b[A') { // up
          if (this.dropType === 'slash') {
            const m = this.slashMatches();
            this.slashSel = (this.slashSel - 1 + m.length) % Math.max(1, m.length);
            this.showSlashDropdown();
          } else if (this.dropType === 'at') {
            const m = this.atMatches();
            this.atSel = (this.atSel - 1 + m.length) % Math.max(1, m.length);
            this.showAtDropdown();
          } else {
            // History navigation
            if (this.histIdx < this.history.length - 1) {
              this.histIdx++;
              this.buf = this.history[this.history.length - 1 - this.histIdx];
              this.cursorPos = this.buf.length;
              this.redrawLine();
            }
          }
          return;
        }
        if (key === '\u001b[B') { // down
          if (this.dropType === 'slash') {
            const m = this.slashMatches();
            this.slashSel = (this.slashSel + 1) % Math.max(1, m.length);
            this.showSlashDropdown();
          } else if (this.dropType === 'at') {
            const m = this.atMatches();
            this.atSel = (this.atSel + 1) % Math.max(1, m.length);
            this.showAtDropdown();
          } else {
            if (this.histIdx > 0) { this.histIdx--; this.buf = this.history[this.history.length - 1 - this.histIdx]; }
            else { this.histIdx = -1; this.buf = ''; }
            this.cursorPos = this.buf.length;
            this.redrawLine();
          }
          return;
        }
        // Left/right
        if (key === '\u001b[C') { this.cursorPos = Math.min(this.buf.length, this.cursorPos + 1); this.redrawLine(); return; }
        if (key === '\u001b[D') { this.cursorPos = Math.max(0, this.cursorPos - 1); this.redrawLine(); return; }
        // Backspace
        if (key === '\u007f' || key === '\b') {
          if (this.cursorPos > 0) {
            this.buf = this.buf.slice(0, this.cursorPos - 1) + this.buf.slice(this.cursorPos);
            this.cursorPos--;
          }
        } else if (key.length === 1 && key >= ' ') {
          this.buf = this.buf.slice(0, this.cursorPos) + key + this.buf.slice(this.cursorPos);
          this.cursorPos++;
        }

        this.redrawLine();
        this.updateDropdown();
      };

      process.stdin.on('data', onKey);
      (this as any)._cleanup = () => {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        process.stdin.pause();
      };
    });
  }

  addHistory(line: string): void {
    if (line && (this.history.length === 0 || this.history[this.history.length - 1] !== line)) {
      this.history.push(line);
      if (this.history.length > 200) this.history.shift();
    }
  }

  private cleanup(): void { (this as any)._cleanup?.(); }

  private redrawLine(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write('\r' + ansi.clearLine);
    process.stdout.write(this.promptStr + this.coloredBuf());
    // Reposition cursor
    const visPrompt = this.promptStr.replace(/\x1b\[[0-9;]*m/g, '').length;
    const moveBack  = this.buf.length - this.cursorPos;
    if (moveBack > 0) process.stdout.write(`\x1b[${moveBack}D`);
  }

  private coloredBuf(): string {
    // Color /commands violet, @commands yellow
    return this.buf
      .replace(/^(\/\w*)/, `${V}$1${R}`)
      .replace(/(@\w+)/g, `${YW}$1${R}`);
  }

  private slashMatches(): SlashCommand[] {
    const q = this.buf.startsWith('/') ? this.buf.slice(1).split(' ')[0].toLowerCase() : '';
    return SLASH_COMMANDS.filter(c => c.name.startsWith(q));
  }

  private atMatches(): AtCommand[] {
    const q = this.buf.startsWith('@') ? this.buf.slice(1).split(':')[0].toLowerCase() : '';
    return AT_COMMANDS.filter(c => c.name.startsWith(q));
  }

  private updateDropdown(): void {
    if (this.buf.startsWith('/')) {
      this.dropType = 'slash';
      this.slashSel = 0;
      this.showSlashDropdown();
    } else if (this.buf.startsWith('@')) {
      this.dropType = 'at';
      this.atSel    = 0;
      this.showAtDropdown();
    } else {
      if (this.dropdown.isVisible()) { this.dropdown.hide(); this.redrawLine(); }
      this.dropType = null;
    }
  }

  private showSlashDropdown(): void {
    const matches = this.slashMatches();
    if (matches.length === 0) { this.dropdown.hide(); return; }
    const MAX = Math.min(8, matches.length);
    const rows = matches.slice(0, MAX).map((c, i) =>
      '  ' + slashPill(c.name, c.desc, i === this.slashSel));
    this.dropdown.show(rows);
    this.redrawLine();
  }

  private showAtDropdown(): void {
    const matches = this.atMatches();
    if (matches.length === 0) { this.dropdown.hide(); return; }
    const MAX = Math.min(6, matches.length);
    const rows = matches.slice(0, MAX).map((c, i) =>
      '  ' + atPill(c.name, c.desc, i === this.atSel));
    this.dropdown.show(rows);
    this.redrawLine();
  }

  private async parseResult(raw: string): Promise<InputResult> {
    const text = raw.trim();
    this.addHistory(text);

    // Slash command?
    if (text.startsWith('/')) {
      const parts   = text.slice(1).split(' ');
      const cmdName = parts[0];
      const args    = parts.slice(1).join(' ');
      const found   = SLASH_COMMANDS.find(c => c.name === cmdName || c.alias === cmdName);
      if (found) return { text, attachments: [], isSlashCmd: found.name, slashArgs: args };
    }

    // @command expansions
    const attachments: string[] = [];
    let   processed = text;

    const atRegex = /@(\w+)(?::([^\s]+))?/g;
    let   m: RegExpExecArray | null;
    const replacements: Array<{ full: string; resolved: string }> = [];

    while ((m = atRegex.exec(text)) !== null) {
      const [full, name, arg = ''] = m;
      const cmd = AT_COMMANDS.find(c => c.name === name);
      if (cmd) {
        const resolved = await cmd.resolve(arg);
        if (resolved) replacements.push({ full, resolved });
      }
    }

    for (const { full, resolved } of replacements) {
      processed = processed.replace(full, '');
      attachments.push(resolved);
    }

    return { text: processed.trim(), attachments };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code block action bar — interactive after each code block renders
// ─────────────────────────────────────────────────────────────────────────────

export interface CodeBlockAction {
  lang:  string;
  code:  string;
}

export async function codeBlockActions(block: CodeBlockAction): Promise<void> {
  if (!process.stdout.isTTY) return;

  const { lang, code } = block;
  const isRunnable = RUNNABLE_LANGS.has(lang.toLowerCase());

  const parts: string[] = [];
  if (isRunnable) parts.push(`${GR}[r]${R} ${SD}run${R}`);
  parts.push(`${CY}[c]${R} ${SD}copy${R}`);
  parts.push(`${SD}[s]${R} ${SD}save${R}`);
  parts.push(`${SD}[↵]${R} ${SD}continue${R}`);
  const bar = '  ' + parts.join(`  ${SD}·${R}  `);

  process.stdout.write(bar + '\n');

  // Wait for keypress
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = async (key: string) => {
      process.stdin.removeListener('data', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();

      // Clear the action bar line
      process.stdout.write(ansi.up(1) + ansi.col(1) + ansi.clearLine);

      if (key === 'c') {
        await clipboardCopy(code);
        process.stdout.write(`  ${GR}✓${R} ${SD}Copied${R}\n`);
      } else if (key === 'r' && isRunnable) {
        process.stdout.write(`  ${SD}Running…${R}\n`);
        await runCode(lang, code);
      } else if (key === 's') {
        const fname = `arc-code-${Date.now()}.${langToExt(lang)}`;
        fs.writeFileSync(fname, code);
        process.stdout.write(`  ${GR}✓${R} ${SD}Saved → ${V}${fname}${R}\n`);
      }
      resolve();
    };

    process.stdin.on('data', onKey);
  });
}

async function clipboardCopy(text: string): Promise<void> {
  for (const cmd of ['wl-copy', 'xclip -selection clipboard', 'xsel --clipboard --input']) {
    try {
      const { execSync: es } = await import('child_process');
      es(`printf '%s' ${JSON.stringify(text)} | ${cmd}`, { shell: '/bin/bash', stdio: ['pipe','pipe','ignore'] });
      return;
    } catch { /* try next */ }
  }
}

async function runCode(lang: string, code: string): Promise<void> {
  const tmp = `/tmp/arc_run_${Date.now()}`;
  const ext = langToExt(lang);
  const file = `${tmp}.${ext}`;
  fs.writeFileSync(file, code);

  const runners: Record<string, string> = {
    js:         `node ${file}`,
    javascript: `node ${file}`,
    ts:         `ts-node ${file}`,
    typescript: `ts-node ${file}`,
    py:         `python3 ${file}`,
    python:     `python3 ${file}`,
    sh:         `bash ${file}`,
    bash:       `bash ${file}`,
    shell:      `bash ${file}`,
    rb:         `ruby ${file}`,
    ruby:       `ruby ${file}`,
    go:         `go run ${file}`,
    rs:         `rustc ${file} -o ${tmp}_bin && ${tmp}_bin`,
    rust:       `rustc ${file} -o ${tmp}_bin && ${tmp}_bin`,
  };

  const runner = runners[lang.toLowerCase()];
  if (!runner) { process.stdout.write(`  ${SD}No runner for ${lang}${R}\n`); return; }

  const { spawn } = await import('child_process');
  const proc = spawn('/bin/bash', ['-c', runner], { stdio: 'inherit' });
  await new Promise<void>(res => proc.on('close', () => res()));
  try { fs.unlinkSync(file); } catch {}
}

function langToExt(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js', typescript: 'ts', python: 'py',
    bash: 'sh', shell: 'sh', ruby: 'rb', rust: 'rs',
    go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    json: 'json', html: 'html', css: 'css', sql: 'sql',
  };
  return map[lang.toLowerCase()] ?? (lang.toLowerCase() || 'txt');
}
