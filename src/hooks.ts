// ─────────────────────────────────────────────────────────────────────────────
// hooks.ts — Shell hook installer (Ollama + llama-cli + KDE)
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { execSync } from 'child_process';

const v  = '\x1b[38;2;139;92;246m';
const gr = '\x1b[38;2;134;239;172m';
const sd = '\x1b[38;2;100;116;139m';
const b  = '\x1b[1m';
const r  = '\x1b[0m';

const MARKER_OPEN  = '# ── arc hooks: begin ───────────────────────────────────';
const MARKER_CLOSE = '# ── arc hooks: end ─────────────────────────────────────';

function resolveArcBin(): string {
  const local = path.join(os.homedir(), '.local', 'bin', 'arc');
  if (fs.existsSync(local)) return local;
  return 'arc';
}

function bashHookBlock(arcBin: string): string {
  const tools = ['ollama'];

  const wrapFn = (tool: string) => [
    ``,
    `# arc hook: ${tool}`,
    `if command -v ${tool} &>/dev/null 2>&1; then`,
    `  ${tool}() {`,
    `    if [ $# -eq 0 ]; then`,
    `      '${arcBin}' --backend ${tool}`,
    `      return`,
    `    fi`,
    `    if [ "$1" = "arc" ] && [ "$2" = "render" ]; then`,
    `      shift 2`,
    `      command ${tool} "$@" | '${arcBin}' --pipe`,
    `      return`,
    `    fi`,
    `    command ${tool} "$@" | '${arcBin}' --pipe`,
    `  }`,
    `fi`,
  ].join('\n');

  const cliFn = [
    ``,
    `# arc hook: llama-cli (one-shot pipe mode)`,
    `if command -v llama-cli &>/dev/null 2>&1; then`,
    `  llama-cli() {`,
    `    local one_shot=0`,
    `    for a in "$@"; do`,
    `      case "$a" in`,
    `        -p|-p?*|--prompt|--prompt=*|-st|--single-turn) one_shot=1; break;;`,
    `      esac`,
    `    done`,
    `    if [ $one_shot -eq 1 ]; then`,
    `      command llama-cli "$@" | '${arcBin}' --pipe`,
    `      return`,
    `    fi`,
    `    command llama-cli "$@"`,
    `  }`,
    `fi`,
  ].join('\n');

  return [
    '',
    MARKER_OPEN,
    '# arc — streaming markdown renderer by The Architect',
    ...tools.map(wrapFn),
    cliFn,
    '',
    MARKER_CLOSE,
    '',
  ].join('\n');
}

const SYSTEMD_SERVICE = `[Unit]
Description=arc — LLM Terminal Renderer by The Architect
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env arc --daemon
Restart=on-failure
RestartSec=5s
Environment=HOME=%h

[Install]
WantedBy=default.target
`;

const KDE_DESKTOP = `[Desktop Entry]
Version=1.0
Type=Application
Name=arc
GenericName=LLM Terminal Interface
Comment=Streaming markdown renderer for LLMs — by The Architect
Icon=utilities-terminal
Exec=arc
Terminal=true
Categories=System;TerminalEmulator;
Keywords=llm;ollama;ai;markdown;terminal;
StartupNotify=false
`;

export function install(): void {
  console.log(`\n${v}${b}◈ arc installer${r}\n`);
  const home      = os.homedir();
  const shellBin  = process.env.SHELL ?? '/bin/bash';
  const shellName = path.basename(shellBin);
  const arcBin    = resolveArcBin();
  const block     = bashHookBlock(arcBin);

  // Detect Termux (Android) — skip KDE/systemd, use $PREFIX paths
  const isTermux  = !!process.env.TERMUX_VERSION ||
                    fs.existsSync('/data/data/com.termux') ||
                    !!process.env.PREFIX;

  // Shell hook
  const rcFiles = shellName === 'zsh'
    ? [path.join(home, '.zshrc')]
    : [path.join(home, '.bashrc')];

  for (const rcFile of rcFiles) {
    if (!fs.existsSync(rcFile)) fs.writeFileSync(rcFile, '');
    const content = fs.readFileSync(rcFile, 'utf8');
    if (content.includes(MARKER_OPEN)) {
      const cleaned = content.replace(/\n# ── arc hooks: begin ─+[\s\S]*?# ── arc hooks: end ─+\n/, '\n');
      fs.writeFileSync(rcFile, cleaned + block);
      console.log(`  ${gr}✓${r} Shell hooks updated → ${v}${rcFile}${r}`);
    } else {
      fs.appendFileSync(rcFile, block);
      console.log(`  ${gr}✓${r} Shell hooks installed → ${v}${rcFile}${r}`);
    }
  }

  if (!isTermux) {
    // systemd (Linux only)
    const systemdDir  = path.join(home, '.config', 'systemd', 'user');
    const serviceFile = path.join(systemdDir, 'arc.service');
    try {
      fs.mkdirSync(systemdDir, { recursive: true });
      fs.writeFileSync(serviceFile, SYSTEMD_SERVICE);
      try {
        execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
        execSync('systemctl --user enable arc.service', { stdio: 'ignore' });
        console.log(`  ${gr}✓${r} systemd service enabled`);
      } catch { console.log(`  ${sd}·${r} systemd service saved (activate manually)`); }
    } catch (e: any) { console.log(`  ${sd}·${r} systemd: ${e.message}`); }

    // KDE (Linux only)
    const appDir      = path.join(home, '.local', 'share', 'applications');
    const desktopFile = path.join(appDir, 'arc.desktop');
    try {
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(desktopFile, KDE_DESKTOP);
      console.log(`  ${gr}✓${r} KDE launcher installed → ${v}${desktopFile}${r}`);
      try { execSync('kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null', { stdio: 'ignore', shell: '/bin/bash' }); } catch {}
    } catch (e: any) { console.log(`  ${sd}·${r} KDE desktop entry: ${e.message}`); }
  } else {
    console.log(`  ${sd}·${r} Termux detected — skipping KDE/systemd integration`);
    console.log(`  ${gr}✓${r} arc available as terminal command: ${v}arc${r}`);
  }

  const rcFile = shellName === 'zsh' ? path.join(home, '.zshrc') : path.join(home, '.bashrc');
  console.log(`
${v}  ◈ Installation complete${r}

  Reload: ${v}source ${rcFile}${r}

  Then just type your LLM tool — arc intercepts:
  ${v}ollama${r}            → arc TUI (model picker)
  ${v}ollama run llama3${r}  → arc intercepts + renders
  ${v}ollama arc render${r}  → explicit arc render
  ${v}llama-cli${r}          → arc renders one-shot output
`);
}

export function uninstall(): void {
  const home      = os.homedir();
  const shellBin  = process.env.SHELL ?? '/bin/bash';
  const shellName = path.basename(shellBin);
  const rcFile    = shellName === 'zsh'
    ? path.join(home, '.zshrc') : path.join(home, '.bashrc');

  if (fs.existsSync(rcFile)) {
    const content = fs.readFileSync(rcFile, 'utf8');
    if (content.includes(MARKER_OPEN)) {
      const cleaned = content.replace(/\n# ── arc hooks: begin ─+[\s\S]*?# ── arc hooks: end ─+\n/, '\n');
      fs.writeFileSync(rcFile, cleaned);
      console.log(`  ${gr}✓${r} Shell hooks removed`);
    }
  }
  const svc = path.join(home, '.config', 'systemd', 'user', 'arc.service');
  if (fs.existsSync(svc)) {
    try { execSync('systemctl --user disable arc.service', { stdio: 'ignore' }); } catch {}
    fs.unlinkSync(svc);
    console.log(`  ${gr}✓${r} systemd service removed`);
  }
  const desk = path.join(home, '.local', 'share', 'applications', 'arc.desktop');
  if (fs.existsSync(desk)) { fs.unlinkSync(desk); console.log(`  ${gr}✓${r} KDE desktop entry removed`); }
  console.log(`\n  ${gr}◈ arc uninstalled.${r}\n`);
}

export function installStatus(): { shellHook: boolean; systemd: boolean; desktop: boolean } {
  const home      = os.homedir();
  const shellBin  = process.env.SHELL ?? '/bin/bash';
  const shellName = path.basename(shellBin);
  const rcFile    = shellName === 'zsh'
    ? path.join(home, '.zshrc') : path.join(home, '.bashrc');
  const shellHook = fs.existsSync(rcFile) && fs.readFileSync(rcFile, 'utf8').includes(MARKER_OPEN);
  const systemd   = fs.existsSync(path.join(home, '.config', 'systemd', 'user', 'arc.service'));
  const desktop   = fs.existsSync(path.join(home, '.local', 'share', 'applications', 'arc.desktop'));
  return { shellHook, systemd, desktop };
}
