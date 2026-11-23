// ─────────────────────────────────────────────────────────────────────────────
// compare.ts — Split-pane model comparison
//
// arc compare [model-a] [model-b]
//
// Streams the same prompt to two models simultaneously.
// Renders both responses side-by-side in real time.
//
//  ╔══ llama3 ══════════════════╦══ qwen2.5-coder ═══════════════╗
//  ║ Streaming response...      ║ Streaming response...           ║
//  ║                            ║                                 ║
//  ╠══ ◦ 247 tok · 77 tok/s ═══╬══ ◦ 183 tok · 102 tok/s ═══════╣
//  ╚════════════════════════════╩═════════════════════════════════╝
//
// ─────────────────────────────────────────────────────────────────────────────

import * as readline from 'readline';
import { registry, ResolvedModel } from './backends/registry';
import { ArcMessage }              from './backends/base';
import { runPicker }               from './picker';
import { BlockAccumulator }        from './parser';
import { renderBlock }             from './renderer';
import { ansi }                    from './ansi';
import { GLYPHS, BADGE_COLORS }    from './logos';

const { fg, bold, reset: R } = ansi;
const V  = fg(139,  92, 246);
const VL = fg(167, 139, 250);
const SD = fg(100, 116, 139);
const GR = fg(134, 239, 172);
const RE = fg(248, 113, 113);
const CY = fg(103, 232, 249);
const YW = fg(250, 204,  21);
const SL = fg(226, 232, 240);

// ── Layout ────────────────────────────────────────────────────────────────────

function termW(): number { return process.stdout.columns || 120; }
function paneW(): number { return Math.floor((termW() - 3) / 2); } // 3 = left│mid│right borders

function hline(left: string, mid: string, right: string, fill: string, w = termW()): string {
  const inner = paneW();
  return `${V}${left}${fill.repeat(inner)}${mid}${fill.repeat(w - inner - inner - 3)}${right}${R}`;
}

function paneHeader(rm: ResolvedModel, w: number): string {
  const glyph = GLYPHS[rm.backend.info.id] ?? '';
  const bCol  = BADGE_COLORS[rm.backend.info.id] ?? V;
  const label = ` ${glyph} ${rm.model.name} `;
  const pad   = Math.max(0, w - label.replace(/\x1b\[[0-9;]*m/g, '').length - 2);
  return `${V}║${R}${bCol}${bold}${label}${R}${SD}${'─'.repeat(pad)}${R}`;
}

// Split a rendered ANSI line to visible width w, padding with spaces
function fitLine(line: string, w: number): string {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  if (stripped.length > w) {
    // Truncate — approximate by cutting raw string
    let vis = 0, i = 0;
    while (i < line.length && vis < w - 1) {
      if (line[i] === '\x1b') { while (i < line.length && line[i] !== 'm') i++; i++; continue; }
      vis++; i++;
    }
    return line.slice(0, i) + R + ' ';
  }
  return line + ' '.repeat(w - stripped.length);
}

// ── Side-by-side streamer ─────────────────────────────────────────────────────

interface PaneState {
  rm:         ResolvedModel;
  lines:      string[];       // rendered output lines
  partial:    string;         // current unfinished line
  acc:        BlockAccumulator;
  tokenCount: number;
  startTime:  number;
  done:       boolean;
}

export async function compareMode(modelA?: string, modelB?: string): Promise<void> {
  const W = termW();
  const PW = paneW();

  console.log();
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log(`  ${V}${bold}arc compare${R}   ${SD}Two models. One prompt. Side by side.${R}`);
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log();

  // Pick two models
  const allModels = await (async () => {
    const sp = new (await import('./icons')).Spinner(undefined, 'Loading models…');
    sp.start();
    const m = await registry.loadAllModels();
    sp.stop();
    return m;
  })();

  if (allModels.length < 2) {
    console.log(`  ${RE}✗${R} Need at least 2 models available. Pull some with: ${V}ollama pull <model>${R}\n`);
    return;
  }

  // Resolve model A
  let rmA: ResolvedModel | null = null;
  if (modelA) {
    rmA = allModels.find(m => m.model.name.includes(modelA) || m.model.id.includes(modelA)) ?? null;
  }
  if (!rmA) {
    console.log(`${VL}  Select Model A:${R}`);
    rmA = await runPicker({ preloadedModels: allModels });
    if (!rmA) return;
  }

  // Resolve model B — exclude model A from list
  let rmB: ResolvedModel | null = null;
  if (modelB) {
    rmB = allModels.find(m =>
      (m.model.name.includes(modelB) || m.model.id.includes(modelB)) &&
      m.model.id !== rmA!.model.id
    ) ?? null;
  }
  if (!rmB) {
    console.log(`\n${VL}  Select Model B:${R}`);
    const remaining = allModels.filter(m => m.model.id !== rmA!.model.id);
    rmB = await runPicker({ preloadedModels: remaining });
    if (!rmB) return;
  }

  // Print compare header
  console.log();
  console.log(hline('╔', '╦', '╗', '═'));
  const hA = paneHeader(rmA, PW);
  const hB = paneHeader(rmB, W - PW - 3);
  console.log(`${hA}${V}║${R}${paneHeader(rmB, W - PW - 3)}${V}║${R}`);
  console.log(hline('╠', '╬', '╣', '═'));
  console.log();

  // Chat loop
  const historyA: ArcMessage[] = [];
  const historyB: ArcMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
    prompt: `\n${V}compare${R} ${SD}(q to quit)${R} ${V}›${R} `,
  });
  rl.prompt();

  for await (const userInput of rl) {
    const text = userInput.trim();
    if (!text) { rl.prompt(); continue; }
    if (text === 'q' || text === '/exit') { rl.close(); break; }

    historyA.push({ role: 'user', content: text });
    historyB.push({ role: 'user', content: text });

    // Render user turn
    console.log();
    const youLine = `  ${CY}you${R}  ${SL}${text}${R}`;
    console.log(hline('╠', '╬', '╣', '─'));
    console.log(`${V}║${R} ${fitLine(youLine, PW - 1)}${V}║${R} ${fitLine(youLine, W - PW - 4)}${V}║${R}`);
    console.log(hline('╠', '╬', '╣', '═'));
    console.log();

    // Set up pane state
    const stateA: PaneState = {
      rm: rmA!, lines: [], partial: '',
      acc: new BlockAccumulator(), tokenCount: 0,
      startTime: Date.now(), done: false,
    };
    const stateB: PaneState = {
      rm: rmB!, lines: [], partial: '',
      acc: new BlockAccumulator(), tokenCount: 0,
      startTime: Date.now(), done: false,
    };

    // Render loop — we draw both panes each time either updates
    let drawnRows = 0;
    const MAX_DISPLAY_LINES = Math.max(8, Math.floor((process.stdout.rows || 30) - 12));

    const redraw = () => {
      // Clear previously drawn rows
      if (drawnRows > 0) {
        process.stdout.write(ansi.up(drawnRows) + ansi.col(1));
        for (let i = 0; i < drawnRows; i++) {
          process.stdout.write(ansi.clearLine + (i < drawnRows - 1 ? ansi.down(1) : ''));
        }
        process.stdout.write(ansi.up(drawnRows - 1) + ansi.col(1));
      }

      const rowsA = [...stateA.lines.slice(-MAX_DISPLAY_LINES)];
      const rowsB = [...stateB.lines.slice(-MAX_DISPLAY_LINES)];

      // Add partial line if streaming
      const dispA = stateA.done ? rowsA : [...rowsA, stateA.partial + (stateA.done ? '' : `${V}▋${R}`)];
      const dispB = stateB.done ? rowsB : [...rowsB, stateB.partial + (stateB.done ? '' : `${V}▋${R}`)];

      const rows = Math.max(dispA.length, dispB.length, 3);
      const out: string[] = [];

      for (let i = 0; i < rows; i++) {
        const lineA = dispA[i] ?? '';
        const lineB = dispB[i] ?? '';
        out.push(`${V}║${R} ${fitLine(lineA, PW - 2)}${V}║${R} ${fitLine(lineB, W - PW - 4)}${V}║${R}`);
      }

      process.stdout.write(out.join('\n') + '\n');
      drawnRows = out.length;
    };

    // Stream both in parallel
    const streamPane = async (state: PaneState, history: ArcMessage[]): Promise<string> => {
      let full = '';
      await state.rm.backend.stream(state.rm.model, history, {
        onToken: (token) => {
          state.tokenCount++;
          full += token;
          state.partial += token;

          // When we hit a newline, commit the line to state.lines
          const parts = state.partial.split('\n');
          for (let i = 0; i < parts.length - 1; i++) {
            const blocks = state.acc.feed(parts[i]);
            for (const block of blocks) {
              const rendered = renderBlock(block);
              for (const r of rendered) state.lines.push(r);
            }
          }
          state.partial = parts[parts.length - 1];
          redraw();
        },
      });
      // Flush remaining
      if (state.partial.trim()) {
        const blocks = [...state.acc.feed(state.partial), ...state.acc.flush()];
        for (const block of blocks) {
          const rendered = renderBlock(block);
          for (const r of rendered) state.lines.push(r);
        }
        state.partial = '';
      } else {
        state.acc.flush();
      }
      state.done = true;
      return full;
    };

    // Run both streams concurrently
    const [fullA, fullB] = await Promise.all([
      streamPane(stateA, historyA),
      streamPane(stateB, historyB),
    ]);

    redraw();
    console.log();

    // Stats bar
    const msA  = Date.now() - stateA.startTime;
    const msB  = Date.now() - stateB.startTime;
    const tpsA = (stateA.tokenCount / Math.max(msA / 1000, 0.001)).toFixed(0);
    const tpsB = (stateB.tokenCount / Math.max(msB / 1000, 0.001)).toFixed(0);
    const durA = msA < 1000 ? `${msA}ms` : `${(msA / 1000).toFixed(1)}s`;
    const durB = msB < 1000 ? `${msB}ms` : `${(msB / 1000).toFixed(1)}s`;

    const statA = `  ${SD}◦ ${stateA.tokenCount} tok · ${durA} · ${CY}${tpsA} tok/s${R}`;
    const statB = `  ${SD}◦ ${stateB.tokenCount} tok · ${durB} · ${CY}${tpsB} tok/s${R}`;
    console.log(hline('╠', '╬', '╣', '─'));
    console.log(`${V}║${R}${fitLine(statA, PW)}${V}║${R}${fitLine(statB, W - PW - 3)}${V}║${R}`);
    console.log(hline('╠', '╬', '╣', '═'));

    historyA.push({ role: 'assistant', content: fullA });
    historyB.push({ role: 'assistant', content: fullB });

    rl.prompt();
  }

  // Close
  console.log();
  console.log(hline('╚', '╩', '╝', '═'));
  console.log(`\n  ${SD}Compare session ended.${R}\n`);
}
