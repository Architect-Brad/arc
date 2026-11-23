// ─────────────────────────────────────────────────────────────────────────────
// easter.ts — arc easter eggs
//
// Triggered by specific chat messages or CLI args.
// The Architect put these here. Nobody asked him to.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';

const { fg, bold, dim, italic, reset: R } = ansi;
const V  = fg(139,  92, 246);
const VL = fg(167, 139, 250);
const VF = fg(196, 181, 253);
const SD = fg(100, 116, 139);
const GR = fg(134, 239, 172);
const CY = fg(103, 232, 249);
const YW = fg(250, 204,  21);
const RE = fg(248, 113, 113);
const OR = fg(251, 146,  60);
const SL = fg(226, 232, 240);
const W  = () => process.stdout.columns || 100;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// The arc ASCII art logo — rendered with progressive reveal
// ─────────────────────────────────────────────────────────────────────────────

const BIG_LOGO = `
${V}    ██████╗ ██████╗  ██████╗ ${R}
${V}   ██╔══██╗██╔══██╗██╔════╝ ${R}
${VL}   ███████║██████╔╝██║      ${R}
${VL}   ██╔══██║██╔══██╗██║      ${R}
${VF}   ██║  ██║██║  ██║╚██████╗ ${R}
${VF}   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ${R}
${SD}   by ${SL}The Architect${R}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Easter egg registry
// ─────────────────────────────────────────────────────────────────────────────

export interface EasterEgg {
  triggers:  string[];          // exact strings that trigger this
  pattern?:  RegExp;            // OR regex match
  handler:   () => Promise<string | null>;  // null = let LLM answer normally
}

// ── The matrix ────────────────────────────────────────────────────────────────
async function doMatrix(): Promise<string | null> {
  const w    = W();
  const chars = 'ｦｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'.split('');
  const cols  = Math.floor(w / 2);
  const drops = Array(cols).fill(0).map(() => Math.floor(Math.random() * 20));

  for (let frame = 0; frame < 60; frame++) {
    let row = '';
    for (let c = 0; c < cols; c++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      row += drops[c] === frame
        ? `${GR}${bold}${ch}${R} `
        : `${fg(0, Math.max(40, 200 - (frame - drops[c]) * 15), 0)}${ch}${R} `;
    }
    process.stdout.write('\r' + row.slice(0, w - 1));
    drops.forEach((d, i) => { if (d < frame - 10) drops[i] = frame + Math.floor(Math.random() * 5); });
    await sleep(50);
  }
  process.stdout.write('\n\n');
  process.stdout.write(`${GR}  Wake up, The Architect.${R}\n`);
  await sleep(800);
  process.stdout.write(`${GR}  arc has you.${R}\n\n`);
  return null;
}

// ── The architect manifesto ───────────────────────────────────────────────────
async function doManifesto(): Promise<string | null> {
  const lines = [
    '',
    `${V}${'═'.repeat(W() - 1)}${R}`,
    `  ${V}${bold}THE ARCHITECT'S MANIFESTO${R}`,
    `${V}${'═'.repeat(W() - 1)}${R}`,
    '',
    `  ${SL}I built arc because the alternatives were insulting.${R}`,
    '',
    `  ${SD}glow renders static files.${R}`,
    `  ${SD}ollama's CLI has no rendering at all.${R}`,
    `  ${SD}lm-studio requires a GUI.${R}`,
    `  ${SD}Everything else is someone's weekend project they abandoned.${R}`,
    '',
    `  ${VL}So I built the terminal LLM platform.${R}`,
    `  ${VL}From scratch. In TypeScript, C++, and Rust.${R}`,
    `  ${VL}With a proper rendering pipeline.${R}`,
    `  ${VL}And a fixed input box.${R}  ${SD}(eventually)${R}`,
    '',
    `  ${SL}The input box took four rewrites.${R}`,
    `  ${SL}The cursor positioning bug existed in three versions.${R}`,
    `  ${SL}I am not proud. I am shipping.${R}`,
    '',
    `  ${VF}arc is not finished.${R}`,
    `  ${VF}arc is never finished.${R}`,
    `  ${VF}arc is just less broken than yesterday.${R}`,
    '',
    `  ${SD}— The Architect, somewhere between the third and fourth rewrite${R}`,
    '',
    `${V}${'═'.repeat(W() - 1)}${R}`,
    '',
  ];

  for (const line of lines) {
    process.stdout.write(line + '\n');
    await sleep(60);
  }
  return null;
}

// ── Glow comparison ───────────────────────────────────────────────────────────
async function doGlowComparison(): Promise<string | null> {
  const w = W();
  await sleep(200);
  process.stdout.write('\n');
  process.stdout.write(`${V}${'─'.repeat(w - 1)}${R}\n`);
  process.stdout.write(`  ${YW}arc${R} vs ${SD}glow${R} — the definitive comparison\n`);
  process.stdout.write(`${V}${'─'.repeat(w - 1)}${R}\n\n`);

  const rows = [
    ['Feature',                   'arc v1.9',      'glow'],
    ['Streams LLM tokens',        '✓',             '✗'],
    ['Per-character animation',   '✓',             '✗'],
    ['Three backends',            '✓',             '✗'],
    ['Model picker',              '✓',             '✗'],
    ['Chat persistence',          '✓',             '✗'],
    ['Thinking blocks',           '✓',             '✗'],
    ['Context window bar',        '✓',             '✗'],
    ['Split-pane comparison',     '✓',             '✗'],
    ['Web UI',                    '✓',             '✗'],
    ['Benchmark suite',           '✓',             '✗'],
    ['Persona system',            '✓',             '✗'],
    ['Rust core',                 '✓',             '✗'],
    ['Easter eggs',               '✓',             '✗'],
    ['Renders static .md files',  '✓ (also this)', '✓'],
  ];

  for (const [feat, arc, glow] of rows) {
    if (feat === 'Feature') {
      process.stdout.write(`  ${VL}${bold}${feat.padEnd(34)}${R}  ${V}${arc.padEnd(16)}${R}  ${SD}${glow}${R}\n`);
    } else {
      const arcCol  = arc.startsWith('✓') ? GR : RE;
      const glowCol = glow.startsWith('✓') ? GR : RE;
      process.stdout.write(`  ${SL}${feat.padEnd(34)}${R}  ${arcCol}${arc.padEnd(16)}${R}  ${glowCol}${glow}${R}\n`);
      await sleep(40);
    }
  }
  process.stdout.write('\n');
  process.stdout.write(`  ${SD}glow is a fine tool. It renders static markdown files.${R}\n`);
  process.stdout.write(`  ${SD}This is not an insult. It is a scope definition.${R}\n\n`);
  return null;
}

// ── Input box history ─────────────────────────────────────────────────────────
async function doInputBoxHistory(): Promise<string | null> {
  const revisions = [
    { v: 'v1.0', approach: 'readline.createInterface()', result: 'worked, but basic' },
    { v: 'v1.2', approach: 'raw mode + ansi.up(N) clearLines()', result: 'drifted after scroll' },
    { v: 'v1.3', approach: '\\x1b7/\\x1b8 save/restore cursor', result: 'wrong when terminal scrolled' },
    { v: 'v1.4', approach: 'save/restore + extraLines tracking', result: 'still drifted. slightly slower.' },
    { v: 'v1.6', approach: 'invariant: cursor always below box, UP(n) relative', result: '✓ correct' },
    { v: 'v1.7', approach: 'same, with ▋ drawn in content', result: '✓ still correct (so far)' },
  ];

  process.stdout.write('\n');
  process.stdout.write(`  ${V}${bold}The Input Box — A History of Failure${R}\n\n`);

  for (const r of revisions) {
    const ok = r.result.startsWith('✓');
    process.stdout.write(
      `  ${V}${r.v.padEnd(6)}${R}  ${SD}${r.approach.padEnd(42)}${R}  ` +
      `${ok ? GR : RE}${r.result}${R}\n`
    );
    await sleep(80);
  }

  process.stdout.write('\n');
  process.stdout.write(`  ${SD}The screenshot that broke v1.3 showed "hello" typed 6 times.${R}\n`);
  process.stdout.write(`  ${SD}Each keystroke spawned a new box. It looked like an art installation.${R}\n`);
  process.stdout.write(`  ${SD}It was not an art installation.${R}\n\n`);
  return null;
}

// ── The speed run ─────────────────────────────────────────────────────────────
async function doSpeedRun(): Promise<string | null> {
  const w = W();
  process.stdout.write('\n');
  process.stdout.write(`${V}${'═'.repeat(w-1)}${R}\n`);
  process.stdout.write(`  ${YW}${bold}arc speedrun any%${R}  ${SD}— glitchless${R}\n`);
  process.stdout.write(`${V}${'═'.repeat(w-1)}${R}\n\n`);

  const steps = [
    [0,   `${SD}[0:00]${R}  The Architect says "I'll just make a quick markdown renderer"`,             ],
    [120, `${SD}[0:02]${R}  Adds streaming support. Now it needs a proper pipeline.`                   ],
    [240, `${SD}[0:04]${R}  Adds the pipeline. Now it needs a theme system.`                           ],
    [360, `${SD}[0:06]${R}  Adds themes. Now it needs a syntax highlighter.`                           ],
    [500, `${SD}[0:08]${R}  Adds syntax highlighter. Now it needs backends.`                           ],
    [650, `${SD}[0:11]${R}  Adds Ollama. Now it needs a model picker.`                                 ],
    [810, `${SD}[0:13]${R}  Adds model picker. Now it needs chat storage.`                             ],
    [980, `${SD}[0:16]${R}  Adds storage. Now it needs a Rust core for speed.`                         ],
    [1160,`${SD}[0:19]${R}  ${RE}SPLITS THE INPUT BOX. 4 rewrites. Time loss: 3 versions.${R}`         ],
    [1400,`${SD}[0:23]${R}  Adds easter eggs instead of fixing the input box first.`                   ],
    [1550,`${SD}[0:26]${R}  ${GR}Fixes the input box. Invariant-based. Correct.${R}`                   ],
    [1700,`${SD}[0:28]${R}  ${YW}Adds 7 more features. Ships v1.7.${R}`                               ],
    [1900,`${VL}[0:31]${R}  ${V}${bold}DONE. arc is a full LLM platform.${R}  ${SD}(GG)${R}`          ],
  ];

  for (const [, text] of steps) {
    process.stdout.write(`  ${text}\n`);
    await sleep(70);
  }
  process.stdout.write('\n');
  return null;
}

// ── /dev/null ─────────────────────────────────────────────────────────────────
async function doDevNull(): Promise<string | null> {
  await sleep(300);
  process.stdout.write(`\n  ${SD}your message has been carefully considered${R}\n`);
  await sleep(600);
  process.stdout.write(`  ${SD}and discarded into /dev/null${R}\n`);
  await sleep(400);
  process.stdout.write(`  ${SD}as requested${R}\n\n`);
  return null;
}

// ── --help but make it weird ──────────────────────────────────────────────────
async function doWhatIsArc(): Promise<string | null> {
  const lines = [
    '',
    `  arc is a ${V}markdown renderer${R}.`,
    `  arc is an ${VL}LLM client${R}.`,
    `  arc is a ${CY}streaming pipeline${R}.`,
    `  arc is a ${GR}benchmark suite${R}.`,
    `  arc is a ${YW}web UI server${R}.`,
    `  arc is a ${OR}shell interceptor${R}.`,
    `  arc is a ${RE}Termux app${R}.`,
    `  arc is ${V}three backends${R}.`,
    `  arc is ${VL}one input box${R}${SD} (rewritten four times)${R}.`,
    '',
    `  arc is whatever The Architect needed it to be that week.${R}`,
    `  ${SD}It has gotten out of hand.${R}`,
    `  ${SD}Nobody is stopping it.${R}`,
    '',
  ];
  for (const line of lines) {
    process.stdout.write(line + '\n');
    await sleep(80);
  }
  return null;
}

// ── Big logo reveal ───────────────────────────────────────────────────────────
async function doLogo(): Promise<string | null> {
  process.stdout.write('\n');
  for (const line of BIG_LOGO.split('\n')) {
    process.stdout.write(line + '\n');
    await sleep(60);
  }
  process.stdout.write(`  ${SD}v1.7.0 · Linux · KDE · Termux · by The Architect${R}\n\n`);
  return null;
}

// ── Konami code ───────────────────────────────────────────────────────────────
async function doKonami(): Promise<string | null> {
  process.stdout.write('\n');
  process.stdout.write(`  ${YW}${bold}+30 lives granted.${R}\n`);
  process.stdout.write(`  ${SD}(Unfortunately this is a terminal LLM tool, not a game.)${R}\n`);
  process.stdout.write(`  ${SD}(The 30 lives have been redirected to your token budget.)${R}\n\n`);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const EASTER_EGGS: EasterEgg[] = [
  {
    triggers: ['arc matrix', 'wake up neo', 'the matrix'],
    handler: doMatrix,
  },
  {
    triggers: ['arc manifesto', 'why did you build this', 'why arc'],
    handler: doManifesto,
  },
  {
    triggers: ['arc vs glow', 'compare arc glow', 'is arc better than glow'],
    handler: doGlowComparison,
  },
  {
    triggers: ['arc history', 'input box history', 'how many rewrites'],
    handler: doInputBoxHistory,
  },
  {
    triggers: ['arc speedrun', 'speedrun arc'],
    handler: doSpeedRun,
  },
  {
    triggers: ['/dev/null', 'send to dev null'],
    handler: doDevNull,
  },
  {
    triggers: ['what is arc', 'what even is arc'],
    handler: doWhatIsArc,
  },
  {
    triggers: ['arc logo', 'show logo', '◈'],
    handler: doLogo,
  },
  {
    triggers: ['up up down down left right left right b a', 'konami'],
    handler: doKonami,
  },
  {
    // Hidden: typing exactly 'the architect' reveales a greeting
    triggers: ['the architect', 'hello architect', 'hi architect'],
    handler: async () => {
      process.stdout.write('\n');
      process.stdout.write(`  ${V}${bold}◈${R}  ${VL}Hello, Architect.${R}\n`);
      await sleep(400);
      process.stdout.write(`  ${SD}arc is running.${R}\n`);
      await sleep(300);
      process.stdout.write(`  ${SD}The input box is fixed.${R}\n`);
      await sleep(300);
      process.stdout.write(`  ${SD}For now.${R}\n\n`);
      return null;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Check if a message triggers an easter egg
// Returns: handler result (null = handled, don't call LLM)
//          or 'PASS' = not an easter egg, pass to LLM
// ─────────────────────────────────────────────────────────────────────────────

export async function checkEasterEgg(input: string): Promise<'PASS' | null> {
  const lower = input.toLowerCase().trim();

  for (const egg of EASTER_EGGS) {
    const match = egg.triggers.some(t => lower === t || lower.includes(t))
      || (egg.pattern && egg.pattern.test(lower));

    if (match) {
      await egg.handler();
      return null; // handled — don't send to LLM
    }
  }
  return 'PASS';
}
