#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// index.ts — arc CLI  (v1.10.0 — multi-backend)
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { registry } from './backends/registry';
import { ALL_BACKENDS } from './backends/registry';
import { MarkdownPipeline } from './pipeline';
import { runPicker } from './picker';
import { chatLoop, goodbye } from './tui';
import { globalStorage } from './storage';
import { showResumePicker } from './chatresume';
import { coreStatus } from './core';
import { install, uninstall, installStatus } from './hooks';
import { compareMode }   from './compare';
import { config, handleConfigCmd } from './config';
import { benchmarkMode }              from './benchmark';
import { serveMode }      from './serve';
import { ansi } from './ansi';
import { arcLogo } from './arcart';
import { getWikiPath, wikiExists } from './wiki';

const NAME    = 'arc';
const VERSION = '1.10.0';
const AUTHOR  = 'The Architect';

const v  = ansi.fg(139,  92, 246);
const vl = ansi.fg(167, 139, 250);
const sl = ansi.fg(226, 232, 240);
const sd = ansi.fg(100, 116, 139);
const gr = ansi.fg(134, 239, 172);
const re = ansi.fg(248, 113, 113);
const cy = ansi.fg(103, 232, 249);
const b  = ansi.bold;
const r  = ansi.reset;
const W  = () => process.stdout.columns || 100;

const args = process.argv.slice(2);
const has  = (f: string) => args.includes(`--${f}`) || args.includes(`-${f[0]}`);
const opt  = (f: string): string | undefined => { const i = args.indexOf(`--${f}`); return i !== -1 ? args[i + 1] : undefined; };

(async () => {

// ── --version ─────────────────────────────────────────────────────────────────
if (has('version')) {
  console.log(`\n${v}${b}${NAME}${r}  ${sd}v${VERSION}${r}`);
  console.log(`${sd}Built by ${r}${v}${b}${AUTHOR}${r}`);
  console.log(`${sd}Linux · KDE · One dependency${r}\n`);
  process.exit(0);
}

// ── --logo ────────────────────────────────────────────────────────────────────
// The diamond was considered. We all agreed it needed a hobby instead.
if (has('logo') || args[0] === 'logo') {
  const ascii = has('ascii') || has('no-color');
  process.stdout.write(`${arcLogo({ ascii })}\n`);
  process.exit(0);
}

// ── --help ────────────────────────────────────────────────────────────────────
if (has('help') || has('h')) {
  const ln = `${v}${'─'.repeat(W() - 1)}${r}`;
  console.log(`
${v}${'═'.repeat(W()-1)}${r}
  ${v}${b}arc${r}  ${sd}v${VERSION}${r}   ${sd}Streaming markdown renderer · LLM interface${r}
  ${sd}Built by ${r}${v}${b}${AUTHOR}${r}
${v}${'═'.repeat(W()-1)}${r}

${vl}${b}USAGE${r}
  ${v}arc${r}                          Open interactive chat (provider → model → chat)
  ${v}arc${r} ${sl}--backend${r} ${cy}<id>${r}           Lock to a specific backend
  ${v}arc${r} ${sl}--model${r}   ${cy}<name>${r}          Jump to a specific model
  ${v}arc${r} ${sl}--pipe${r}                    Render markdown from stdin
  ${v}arc${r} ${sl}--render${r}  ${cy}<file>${r}          Render a markdown file
  ${v}arc${r} ${sl}--wiki${r}                    Open the manual you actually have
  ${v}arc${r} ${sl}config${r}                    Show or change configuration
  ${v}arc${r} ${sl}serve${r}                     Web UI at localhost:7070
  ${v}arc${r} ${sl}benchmark${r}                 Test your models
  ${v}arc${r} ${sl}--install${r}                 Install shell hooks + KDE integration
  ${v}arc${r} ${sl}--uninstall${r}               Remove all arc integrations
  ${v}arc${r} ${sl}--status${r}                  Show installation status
  ${v}arc${r} ${sl}--backends${r}                List detected backends + models
  ${v}arc${r} ${sl}--version${r}                 Print version and author
  ${v}arc${r} ${sl}--logo${r}                    Print the logo (diamonds need not apply)
  ${v}arc${r} ${sl}--help${r}                    Show this help

${ln}

${vl}${b}SUPPORTED BACKENDS${r}
  ${v}[◉] ollama${r}       ${sd}Local models via Ollama (localhost:11434)${r}
  ${v}[▲]  llamacpp${r}     ${sd}Local models via llama-server (localhost:8080, auto-spawns)${r}
  ${v}[>]  llamacli${r}     ${sd}One-shot pipe mode via llama-cli (no server)${r}

${ln}

${vl}${b}SHELL INTERCEPTION${r}
  After ${v}arc --install${r}, just type your tool — arc handles the rest:

  ${cy}ollama${r}                  → arc TUI (model picker)
  ${cy}ollama run llama3${r}       → arc intercepts + renders
  ${cy}ollama arc render${r}       → explicit arc render subcommand
  ${cy}llama-cli${r}               → arc renders one-shot output (pipe mode)
  ${cy}any-llm | arc --pipe${r}    → pipe any LLM through arc

${ln}

${vl}${b}CHAT COMMANDS${r}
  ${v}/help${r}  ${v}/clear${r}  ${v}/model${r}  ${v}/copy${r}  ${v}/save${r}  ${v}/exit${r}
  ${v}/settings${r}  ${v}/wiki${r}  ${v}/joke${r}       ${sd}(tune the rig · read the manual · laugh)${r}
  ${v}/temp${r}  ${v}/top-p${r}  ${v}/seed${r}  ${v}/gen${r}  ${v}/tokens${r}  ${sd}(generation dials)${r}
  ${v}/config${r}  ${v}/persona${r}  ${v}/typing${r}  ${v}/bench${r}  ${sd}(more knobs, still fun)${r}

${ln}

${vl}${b}SPEED${r}
  ${v}--speed${r} ${cy}slow${r}|${cy}normal${r}|${cy}fast${r}|${cy}instant${r}     (for --pipe and --render)

${v}${'═'.repeat(W()-1)}${r}
  ${sd}arc v${VERSION} · Linux · KDE · Built by ${r}${v}${b}${AUTHOR}${r}
${v}${'═'.repeat(W()-1)}${r}
`);
  process.exit(0);
}

// ── --status ──────────────────────────────────────────────────────────────────
if (has('status')) {
  const { shellHook, systemd, desktop } = installStatus();
  const tick  = (ok: boolean) => ok ? `${gr}✓${r}` : `${re}✗${r}`;
  const label = (ok: boolean, t: string, f: string) => ok ? `${gr}${t}${r}` : `${sd}${f}${r}`;
  console.log(`\n${v}  arc installation status${r}\n`);
  console.log(`  ${tick(shellHook)}  Shell hooks     ${label(shellHook,'active — LLM tools intercepted','not installed  →  arc --install')}`);
  console.log(`  ${tick(systemd)}  systemd service ${label(systemd,'installed','not installed')}`);
  console.log(`  ${tick(desktop)}  KDE launcher    ${label(desktop,'installed','not installed')}\n`);
  process.exit(0);
}

// ── --backends ────────────────────────────────────────────────────────────────
if (has('backends')) {
  console.log(`\n${v}  Detecting backends…${r}\n`);
  const backends = await registry.detectBackends();
  if (backends.length === 0) {
    console.log(`  ${re}None found.${r} Install ollama or llama.cpp (llama-server / llama-cli).\n`);
    process.exit(0);
  }
  for (const bk of backends) {
    const c = ansi.fg(...bk.info.color);
    console.log(`  ${gr}✓${r}  ${c}${bk.info.icon}  ${bk.info.name}${r}  ${sd}${bk.info.description}${r}`);
    const models = await bk.listModels();
    for (const m of models.slice(0, 5)) {
      console.log(`       ${sd}· ${m.name}${m.size && m.size !== 'unknown' ? '  ' + m.size : ''}${r}`);
    }
    if (models.length > 5) console.log(`       ${sd}  … and ${models.length - 5} more${r}`);
    console.log();
  }
  process.exit(0);
}

// ── --install / --uninstall ───────────────────────────────────────────────────
if (has('install'))   { install();   process.exit(0); }
if (has('uninstall')) { uninstall(); process.exit(0); }

// Native fast path for pipe mode — glow-class startup, no Node typewriter
const RENDER_BIN = path.join(__dirname, '..', 'core', 'arc_render');
const hasNativeRenderer = (() => {
  try { fs.accessSync(RENDER_BIN, fs.constants.X_OK); return true; } catch { return false; }
})();

// ── --pipe ────────────────────────────────────────────────────────────────────
if (has('pipe')) {
  if (hasNativeRenderer) {
    await new Promise<void>((resolve) => {
      const child = spawn(RENDER_BIN, [], { stdio: ['inherit', 'inherit', 'inherit'] });
      child.on('exit', code => process.exit(code ?? 0));
      child.on('error', () => resolve()); // fall through to TS
    });
  }
  const speedMap: Record<string, number> = { slow: 80, normal: 200, fast: 400 };
  const sa  = opt('speed');
  const cps = sa ? (speedMap[sa] ?? (parseInt(sa) || 200)) : 200;
  const pipeline = new MarkdownPipeline({
    typewriter:  { mode: has('instant') ? 'instant' : 'char', cps },
    instantCode: true,
    cursor:      !has('no-cursor'),
    compact:     has('compact'),
  });
  process.on('SIGINT', () => { pipeline.abort(); process.exit(0); });
  pipeline.pipeFrom(process.stdin)
    .then(() => process.exit(0))
    .catch(err => { process.stderr.write(`arc: ${err.message}\n`); process.exit(1); });
  return;
}


// ── --compare ─────────────────────────────────────────────────────────────────
if (has('compare') || args[0] === 'compare') {
  const models = args.filter(a => !a.startsWith('-') && a !== 'compare');
  await compareMode(models[0], models[1]);
  process.exit(0);
}


// ── arc benchmark ─────────────────────────────────────────────────────────────
if (has('benchmark') || args[0] === 'benchmark') {
  const modelsArg = opt('models');
  const suiteArg  = opt('suite') ?? (args.includes('full') ? 'full' : 'quick');
  await benchmarkMode({ models: modelsArg, suite: suiteArg });
  process.exit(0);
}

// ── arc config ────────────────────────────────────────────────────────────────
if (has('config') || args[0] === 'config') {
  const subArgs = args.filter(a => !a.startsWith('--')).slice(args[0] === 'config' ? 1 : 0);
  handleConfigCmd(subArgs);
  process.exit(0);
}

// ── --serve ───────────────────────────────────────────────────────────────────
if (has('serve') || args[0] === 'serve') {
  const port = parseInt(opt('port') ?? '7070');
  const host = opt('host') ?? '127.0.0.1';
  await serveMode(port, host);
  process.exit(0);
}

// ── --render <file> ───────────────────────────────────────────────────────────
if (has('render')) {
  const file = opt('render') ?? args.find(a => !a.startsWith('-'));
  if (!file || !fs.existsSync(file)) {
    console.error(`arc: no such file: ${file ?? '(none)'} - double-check the path and try again`);
    process.exit(1);
  }
  if (hasNativeRenderer) {
    await new Promise<void>((resolve) => {
      const child = spawn(RENDER_BIN, [file!], { stdio: ['inherit', 'inherit', 'inherit'] });
      child.on('exit', code => process.exit(code ?? 0));
      child.on('error', () => resolve()); // fall through to TS
    });
  }
  const speedMap: Record<string, number> = { slow: 80, normal: 200, fast: 400 };
  const sa  = opt('speed');
  const cps = sa ? (speedMap[sa] ?? (parseInt(sa) || 200)) : 200;
  const pipeline = new MarkdownPipeline({ typewriter: { mode: has('instant') ? 'instant' : 'char', cps }, instantCode: true });
  process.on('SIGINT', () => { pipeline.abort(); process.exit(0); });
  await pipeline.pipeFrom(fs.createReadStream(file, 'utf8'));
  process.exit(0);
}

// ── --wiki ────────────────────────────────────────────────────────────────────
// Same pipeline as --render, just pointed at arc's own manual.
if (has('wiki') || args[0] === 'wiki') {
  if (!wikiExists()) {
    console.error(`\n${re}  x  No wiki found.${r}`);
    console.error(`  ${sd}Drop a wiki.md where arc expects it, then try ${v}arc wiki${r}${sd} again.${r}\n`);
    process.exit(1);
  }
  const file = getWikiPath();
  if (hasNativeRenderer) {
    await new Promise<void>((resolve) => {
      const child = spawn(RENDER_BIN, [file], { stdio: ['inherit', 'inherit', 'inherit'] });
      child.on('exit', code => process.exit(code ?? 0));
      child.on('error', () => resolve()); // fall through to TS
    });
  }
  const speedMap: Record<string, number> = { slow: 80, normal: 200, fast: 400 };
  const sa  = opt('speed');
  const cps = sa ? (speedMap[sa] ?? (parseInt(sa) || 200)) : 200;
  const pipeline = new MarkdownPipeline({
    typewriter: { mode: has('instant') ? 'instant' : 'char', cps },
    instantCode: true,
    cursor:      !has('no-cursor'),
    compact:     has('compact'),
  });
  process.on('SIGINT', () => { pipeline.abort(); process.exit(0); });
  await pipeline.pipeFrom(fs.createReadStream(file, 'utf8'));
  process.exit(0);
}

// ── --daemon ──────────────────────────────────────────────────────────────────
if (has('daemon')) {
  process.stdout.write(`${v}arc${r} ${sd}v${VERSION} daemon running — shell hooks active${r}\n`);
  setInterval(() => {}, 1 << 30);
  return;
}

// ── --pull ────────────────────────────────────────────────────────────────────
if (has('pull')) {
  const model = opt('pull') ?? args.find(a => !a.startsWith('-'));
  if (!model) { console.error('arc: --pull requires a model name'); process.exit(1); }
  console.log(`${v}◈${r} Pulling ${sl}${model}${r} via Ollama…`);
  const proc = spawn('ollama', ['pull', model], { stdio: 'inherit' });
  proc.on('exit', code => process.exit(code ?? 0));
  return;
}

// ── Interactive chat (default + --backend + --model) ──────────────────────────
const w = W();
console.log();
console.log(`${v}${'═'.repeat(w-1)}${r}`);
console.log(`  ${v}${b}arc${r}  ${sd}v${VERSION}${r}   ${sd}LLM Terminal Interface${r}`);
console.log(`  ${sd}Built by ${r}${v}${b}${AUTHOR}${r}   ${sd}Linux · KDE${r}`);
console.log(`${v}${'═'.repeat(w-1)}${r}`);
console.log();

// Resolve backend lock if --backend flag passed
const backendId  = opt('backend') ?? opt('b') ?? config.get().defaults.backend;
const modelName  = opt('model')   ?? opt('m') ?? config.get().defaults.model;

let lockBackend: import('./backends/base').Backend | undefined;

// Resume picker — show saved chats if any exist
let resumeChat: import('./storage').Chat | undefined;
if (!modelName && !backendId) {
  const resume = await showResumePicker(globalStorage);
  if (resume.action === 'resume' && resume.chat) {
    resumeChat = resume.chat;
  }
}


if (backendId) {
  lockBackend = ALL_BACKENDS.find(b => b.info.id === backendId || b.info.name.toLowerCase() === backendId.toLowerCase());
  if (!lockBackend) {
    console.log(`  ${re}✗${r} Unknown backend: ${backendId}`);
    console.log(`  Known: ollama · llamacpp · llamacli\n`);
    process.exit(1);
  }
  const avail = await lockBackend.isAvailable();
  if (!avail) {
    const c = ansi.fg(...lockBackend.info.color);
    console.log(`  ${re}✗${r} ${c}${lockBackend.info.name}${r} is not running or not installed.\n`);
    process.exit(1);
  }
}

// Load config
config.load();

// Init storage
await globalStorage.init();

// Show core engine status briefly
const cStat = await coreStatus();
const engineLabel = cStat.engine === 'rust' ? `${gr}✓${r} ${sd}Rust engine active${r}`
                  : cStat.engine === 'cpp'  ? `${gr}✓${r} ${sd}C++ engine active${r}`
                  : `${sd}· TS engine (install g++ or cargo for native speed)${r}`;
console.log(`  ${engineLabel}`);
console.log();

// Chat loop — re-enter on /model
while (true) {
  // If resuming a saved chat, find its backend+model
  let rm;
  if (resumeChat) {
    const allModels = await registry.loadAllModels();
    const found = allModels.find(m =>
      m.backend.info.id === resumeChat!.backend &&
      (m.model.id === resumeChat!.model || m.model.name === resumeChat!.model)
    );
    rm = found ?? await runPicker({ lockBackend, preloadedModels: undefined });
    resumeChat = undefined; // only resume once
  } else {
    rm = await runPicker({ lockBackend, preloadedModels: undefined });
  }

  // --model override: find matching model
  if (modelName && rm) {
    const models = await registry.loadAllModels();
    const found  = models.find(m =>
      m.model.id.startsWith(modelName) ||
      m.model.name.toLowerCase().startsWith(modelName.toLowerCase())
    );
    if (found) rm = found;
  }

  if (!rm) break;

  let switchRequested = false;
  await chatLoop(rm, async () => { switchRequested = true; }, globalStorage);
  if (!switchRequested) break;
}

goodbye();
process.exit(0);

})().catch(err => {
  process.stderr.write(`arc: fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
