// ─────────────────────────────────────────────────────────────────────────────
// picker.ts — Two-level interactive picker
//   Level 1: Backend selector  (Ollama · llama.cpp · llama-cli)
//   Level 2: Model dropdown    (arrow keys, instant select, search filter)
// ─────────────────────────────────────────────────────────────────────────────

import { registry, ResolvedModel } from './backends/registry';
import { GLYPHS }                   from './logos';
import { Backend }                 from './backends/base';
import { ansi, ansiChars, visibleLength } from './ansi';

const v   = ansi.fg(139,  92, 246);
const vl  = ansi.fg(167, 139, 250);
const vf  = ansi.fg(196, 181, 253);
const sl  = ansi.fg(226, 232, 240);
const sd  = ansi.fg(100, 116, 139);
const gr  = ansi.fg(134, 239, 172);
const re  = ansi.fg(248, 113, 113);
const cy  = ansi.fg(103, 232, 249);
const yw  = ansi.fg(250, 204,  21);
const b   = ansi.bold;
const dim = ansi.dim;
const r   = ansi.reset;
const W   = () => process.stdout.columns || 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

function backendColor(b: Backend): string {
  const [R, G, Bl] = b.info.color;
  return ansi.fg(R, G, Bl);
}

// ── Redraw invariant (same deal as inputbox.ts) ───────────────────────────────
// After every render the cursor is at col 1 of the row just below the picker.
// A redraw goes up exactly `drawn` rows in ONE write, then paints each row as
// `clearLine + content + '\n'`. No save/restore, no drift, no per-line writes.
//
// The old code nudged up one row per line in a separate write and wrote bare
// content. On narrow terminals (Termux, looking at you) a single long line
// wraps to two physical rows, so "up 1" landed mid-block and the top rows
// survived the wipe. Every arrow press bookmarked another copy of the prompt.
// Clipping to the real width keeps one logical line == one physical row.
// ─────────────────────────────────────────────────────────────────────────────

function clipLine(line: string, max: number): string {
  if (visibleLength(line) <= max) return line;
  let out = '';
  let used = 0;
  for (const part of ansiChars(line)) {
    // Color/bold/dim escapes are free; only glyphs spend columns.
    if (part.charCodeAt(0) === 0x1b) { out += part; continue; }
    for (const ch of part) {
      if (used >= max) return out + r;   // don't leak color into the next row
      out += ch;
      used++;
    }
  }
  return out;
}

function render(lines: string[], drawn: number): number {
  const w   = Math.max(1, W());
  const buf = lines.map(l => clipLine(l, w));
  let out = '';
  if (drawn > 0) {
    // Wipe the whole old block, not just the rows the new one happens to
    // cover; a filter can shrink the list, and the leftover tail would
    // otherwise sit there like an unpaid bill.
    out += ansi.up(drawn) + ansi.col(1);
    for (let i = 0; i < drawn; i++) out += ansi.clearLine + '\n';
    out += ansi.up(drawn) + ansi.col(1);
  }
  for (const l of buf) out += ansi.clearLine + l + '\n';
  process.stdout.write(out);            // one syscall, one atomic repaint
  return buf.length;
}

function erase(drawn: number): void {
  if (drawn <= 0) return;
  let out = ansi.up(drawn) + ansi.col(1);
  for (let i = 0; i < drawn; i++) out += ansi.clearLine + '\n';
  process.stdout.write(out + ansi.showCursor);
}

function rawMode(on: boolean) {
  if (process.stdin.isTTY) {
    if (on) { process.stdin.setRawMode(true);  process.stdin.resume(); }
    else    { process.stdin.setRawMode(false); process.stdin.pause();  }
  }
}

// ── Loading spinner ───────────────────────────────────────────────────────────

const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn();
  process.stdout.write(ansi.hideCursor);
  let frame = 0;
  const iv = setInterval(() => {
    process.stdout.write(`\r${v}${SPINNER[frame++ % SPINNER.length]}${r}  ${sd}${label}${r}  `);
  }, 80);
  try {
    const result = await fn();
    clearInterval(iv);
    process.stdout.write(`\r${ansi.clearLine}`);
    process.stdout.write(ansi.showCursor);
    return result;
  } catch (e) {
    clearInterval(iv);
    process.stdout.write(`\r${ansi.clearLine}`);
    process.stdout.write(ansi.showCursor);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 1 — Backend picker (shown when no backend is locked)
// ─────────────────────────────────────────────────────────────────────────────

function drawBackendList(backends: Backend[], sel: number, drawn: number): number {
  const lines: string[] = [];

  lines.push(`${vl}  Choose a provider  ${sd}(↑↓ · Enter · q quit)${r}`);
  lines.push('');

  backends.forEach((bk, i) => {
    const isSel  = i === sel;
    const c      = backendColor(bk);
    const cursor = isSel ? `${v}▶${r}` : ' ';
    const icon   = `${c}${GLYPHS[bk.info.id] ?? bk.info.icon}${r}`;
    const name   = isSel ? `${c}${b}${bk.info.name}${r}` : `${sl}${bk.info.name}${r}`;
    const desc   = `${dim}${sd}${bk.info.description}${r}`;
    const bg     = isSel ? ansi.bg(20, 15, 45) : '';
    const bgr    = isSel ? r : '';
    lines.push(`  ${cursor} ${bg}${icon}  ${name}   ${desc}${bgr}`);
  });

  lines.push('');
  lines.push(`  ${sd}↵ select   q quit${r}`);

  return render(lines, drawn);
}

export async function pickBackend(onlyFrom?: Backend[]): Promise<Backend | null> {
  const backends = onlyFrom ??
    await withSpinner('Detecting providers…', () => registry.detectBackends());

  if (backends.length === 0) {
    console.log(`  ${re}✗${r} No LLM providers found.\n`);
    console.log(`  Install one of: ${v}ollama${r}  ${v}llama-server${r}  ${v}llama-cli${r}\n`);
    return null;
  }

  if (backends.length === 1) return backends[0]; // skip picker

  return new Promise((resolve) => {
    let sel      = 0;
    let drawn    = 0;

    process.stdin.setEncoding('utf8');
    rawMode(true);
    process.stdout.write(ansi.hideCursor);

    drawn = drawBackendList(backends, sel, 0);

    const onKey = (key: string) => {
      if (key === '\u001b[A' || key === 'k') {         // up
        sel = (sel - 1 + backends.length) % backends.length;
        drawn = drawBackendList(backends, sel, drawn);
      } else if (key === '\u001b[B' || key === 'j') {  // down
        sel = (sel + 1) % backends.length;
        drawn = drawBackendList(backends, sel, drawn);
      } else if (key === '\r' || key === '\n') {        // enter
        cleanup(); resolve(backends[sel]);
      } else if (key === 'q' || key === '\u0003') {     // q / ctrl+c
        cleanup(); resolve(null);
      }
    };

    const cleanup = () => {
      rawMode(false);
      process.stdin.removeListener('data', onKey);
      // Take the list with us. Otherwise the next level (or the next lap
      // around the Esc loop) parks a fresh header on top of this one.
      erase(drawn);
    };

    process.stdin.on('data', onKey);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL 2 — Model picker (shown after backend is chosen OR for a single backend)
// ─────────────────────────────────────────────────────────────────────────────

function modelLabel(rm: ResolvedModel): string {
  const m = rm.model;
  const c = backendColor(rm.backend);
  const namePart  = `${sl}${m.name}${r}`;
  const sizePart  = m.size && m.size !== 'unknown' ? `  ${cy}${m.size}${r}` : '';
  const quantPart = m.quant ? `  ${sd}${m.quant}${r}` : '';
  const famPart   = m.family ? `  ${dim}${sd}${m.family}${r}` : '';
  const backPart  = `  ${c}${dim}${GLYPHS[rm.backend.info.id] ?? rm.backend.info.icon}${r}`;
  return `${namePart}${sizePart}${quantPart}${famPart}${backPart}`;
}

function drawModelList(
  models:  ResolvedModel[],
  sel:     number,
  filter:  string,
  drawn:   number,
  backend: Backend | null,
) {
  const visible = filter
    ? models.filter(m =>
        m.model.name.toLowerCase().includes(filter.toLowerCase()) ||
        m.model.id.toLowerCase().includes(filter.toLowerCase()))
    : models;

  const lines: string[] = [];
  const bLabel = backend ? `${backendColor(backend)}${GLYPHS[backend.info.id] ?? backend.info.icon} ${backend.info.name}${r}  ` : '';
  lines.push(`${bLabel}${vl}  Select a model  ${sd}(↑↓ · Enter · type to filter · Esc back)${r}`);

  if (filter) {
    lines.push(`  ${sd}Filter:${r} ${v}${filter}${r}  ${sd}${visible.length} match${visible.length !== 1 ? 'es' : ''}${r}`);
  } else {
    lines.push(`  ${sd}${models.length} model${models.length !== 1 ? 's' : ''}${r}`);
  }
  lines.push('');

  const MAX_VISIBLE = Math.min(12, process.stdout.rows - 8 || 12);
  // Sliding window
  let start = Math.max(0, Math.min(sel - Math.floor(MAX_VISIBLE / 2), visible.length - MAX_VISIBLE));
  const window = visible.slice(start, start + MAX_VISIBLE);

  if (start > 0) lines.push(`  ${sd}  ↑ ${start} more${r}`);

  window.forEach((rm, wi) => {
    const absIdx = start + wi;
    const isSel  = absIdx === sel;
    const cursor = isSel ? `${v}▶${r}` : ' ';
    const bg     = isSel ? ansi.bg(20, 15, 45) : '';
    const bgr    = isSel ? r : '';
    lines.push(`  ${cursor} ${bg} ${modelLabel(rm)} ${bgr}`);
  });

  const remaining = visible.length - start - window.length;
  if (remaining > 0) lines.push(`  ${sd}  ↓ ${remaining} more${r}`);

  if (visible.length === 0) lines.push(`  ${sd}No models match "${filter}"${r}`);

  lines.push('');
  lines.push(`  ${sd}↵ select   Esc back   q quit${r}`);

  return render(lines, drawn);
}

export async function pickModel(
  backend: Backend | null,
  preloaded?: ResolvedModel[],
): Promise<ResolvedModel | null> {
  let models: ResolvedModel[];

  if (preloaded) {
    models = backend ? preloaded.filter(m => m.backend.info.id === backend.info.id) : preloaded;
  } else if (backend) {
    models = await withSpinner(`Loading ${backend.info.name} models…`, async () => {
      const ms = await backend.listModels();
      return ms.map(m => ({ model: m, backend: backend! }));
    });
  } else {
    models = await withSpinner('Loading all models…', () => registry.loadAllModels());
  }

  if (models.length === 0) {
    console.log(`  ${re}✗${r} No models available for ${backend?.info.name ?? 'any backend'}.\n`);
    return null;
  }

  if (models.length === 1) return models[0]; // skip picker

  return new Promise((resolve) => {
    let sel    = 0;
    let filter = '';
    let drawn  = 0;

    process.stdin.setEncoding('utf8');
    rawMode(true);
    process.stdout.write(ansi.hideCursor);

    const visible = () => filter
      ? models.filter(m =>
          m.model.name.toLowerCase().includes(filter.toLowerCase()) ||
          m.model.id.toLowerCase().includes(filter.toLowerCase()))
      : models;

    drawn = drawModelList(models, sel, filter, 0, backend);

    const onKey = (key: string) => {
      const vis = visible();

      if (key === '\u001b[A' || key === 'k') {         // up
        sel = Math.max(0, sel - 1);
        drawn = drawModelList(models, sel, filter, drawn, backend);
      } else if (key === '\u001b[B' || key === 'j') {  // down
        sel = Math.min(vis.length - 1, sel + 1);
        drawn = drawModelList(models, sel, filter, drawn, backend);
      } else if (key === '\r' || key === '\n') {        // enter
        const chosen = vis[sel];
        cleanup();
        resolve(chosen ?? null);
      } else if (key === '\u001b' || key === '\u001b[D') { // esc / left
        cleanup();
        resolve(null); // signal "go back"
      } else if (key === 'q' || key === '\u0003') {     // q / ctrl+c
        cleanup();
        resolve(null);
      } else if (key === '\u007f' || key === '\b') {    // backspace
        filter = filter.slice(0, -1);
        sel = 0;
        drawn = drawModelList(models, sel, filter, drawn, backend);
      } else if (key.length === 1 && key >= ' ') {     // printable — filter
        filter += key;
        sel = 0;
        drawn = drawModelList(models, sel, filter, drawn, backend);
      }
    };

    const cleanup = () => {
      rawMode(false);
      process.stdin.removeListener('data', onKey);
      // Take the list with us. Otherwise the next level (or the next lap
      // around the Esc loop) parks a fresh header on top of this one.
      erase(drawn);
    };

    process.stdin.on('data', onKey);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined flow: run the full two-level picker
// Returns the chosen model+backend, or null if the user quit.
// If `lockBackend` is provided, skips the backend picker.
// ─────────────────────────────────────────────────────────────────────────────

export async function runPicker(opts: {
  lockBackend?: Backend;
  preloadedModels?: ResolvedModel[];
} = {}): Promise<ResolvedModel | null> {
  // Preload all models in background while showing the backend picker
  const allModelsPromise = opts.preloadedModels
    ? Promise.resolve(opts.preloadedModels)
    : registry.loadAllModels();

  let backend: Backend | null = opts.lockBackend ?? null;

  if (!backend) {
    const backends = await withSpinner('Detecting providers…', () => registry.detectBackends());
    if (backends.length === 0) {
      console.log(`\n  ${re}✗${r} No LLM providers found.\n`);
      return null;
    }
    backend = await pickBackend(backends);
    if (!backend) return null;
  }

  // Level 2: model
  const preloaded = await allModelsPromise;
  while (true) {
    const chosen = await pickModel(backend, preloaded);
    if (chosen) return chosen;       // user picked a model
    if (opts.lockBackend) return null; // backend is locked, Esc = quit
    // Esc → go back to backend picker
    const backends = await registry.detectBackends();
    backend = await pickBackend(backends);
    if (!backend) return null;
  }
}
