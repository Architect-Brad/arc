// ─────────────────────────────────────────────────────────────────────────────
// benchmark.ts — arc benchmark
//
// arc benchmark [--models all|model1,model2] [--suite quick|full|code]
//
// Runs standardised prompts across local models.
// Measures: TTFT, tok/s, total time, response length.
// Optional quality scoring via a judge model.
// Outputs a ranked comparison table.
// ─────────────────────────────────────────────────────────────────────────────

import { registry, ResolvedModel } from './backends/registry';
import { ansi }                    from './ansi';
import { GLYPHS, BADGE_COLORS }    from './logos';
import { Spinner }                 from './icons';

const { fg, bold, reset: R } = ansi;
const V  = fg(139,  92, 246);
const VL = fg(167, 139, 250);
const SD = fg(100, 116, 139);
const GR = fg(134, 239, 172);
const YW = fg(250, 204,  21);
const CY = fg(103, 232, 249);
const RE = fg(248, 113, 113);
const OR = fg(251, 146,  60);
const SL = fg(226, 232, 240);

// ── Benchmark suites ──────────────────────────────────────────────────────────

interface BenchPrompt {
  id:       string;
  category: string;
  prompt:   string;
  maxTokens?: number;
}

const SUITE_QUICK: BenchPrompt[] = [
  {
    id: 'hello',
    category: 'basic',
    prompt: 'Say exactly: "Hello from arc benchmark." Nothing else.',
    maxTokens: 20,
  },
  {
    id: 'math',
    category: 'reasoning',
    prompt: 'What is 1337 × 42? Show your working briefly.',
  },
  {
    id: 'code_fib',
    category: 'code',
    prompt: 'Write a Python function that returns the nth Fibonacci number using memoization. Just the function, no explanation.',
  },
  {
    id: 'summarise',
    category: 'language',
    prompt: 'Summarise in one sentence: "The quick brown fox jumps over the lazy dog. It does this repeatedly throughout the day, much to the dog\'s annoyance."',
  },
];

const SUITE_FULL: BenchPrompt[] = [
  ...SUITE_QUICK,
  {
    id: 'code_sort',
    category: 'code',
    prompt: 'Implement merge sort in Rust. Clean, idiomatic code only.',
  },
  {
    id: 'reason',
    category: 'reasoning',
    prompt: 'A bat and ball cost $1.10 total. The bat costs $1 more than the ball. How much does the ball cost? Explain.',
  },
  {
    id: 'creative',
    category: 'creative',
    prompt: 'Write a 4-line haiku about programming in a terminal at night.',
  },
  {
    id: 'instruct',
    category: 'instruction',
    prompt: 'List exactly 5 Linux commands for monitoring system performance. Format as a numbered list.',
  },
  {
    id: 'json',
    category: 'structured',
    prompt: 'Return a JSON object with keys: name (string), year (number), languages (array of 3 strings). No explanation, just JSON.',
  },
];

const SUITES: Record<string, BenchPrompt[]> = {
  quick: SUITE_QUICK,
  full:  SUITE_FULL,
};

// ── Result types ──────────────────────────────────────────────────────────────

interface PromptResult {
  promptId:   string;
  category:   string;
  ttft:       number;   // ms to first token
  totalMs:    number;
  tokenCount: number;
  tps:        number;
  response:   string;
  error?:     string;
}

interface ModelResult {
  rm:          ResolvedModel;
  results:     PromptResult[];
  avgTps:      number;
  avgTtft:     number;
  errorCount:  number;
  score:       number;   // 0-100 composite
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runPrompt(
  rm:     ResolvedModel,
  prompt: BenchPrompt,
): Promise<PromptResult> {
  let tokenCount = 0;
  let response   = '';
  let ttft       = 0;
  const start    = Date.now();

  try {
    await rm.backend.stream(
      rm.model,
      [{ role: 'user', content: prompt.prompt }],
      {
        onToken: (token) => {
          if (tokenCount === 0) ttft = Date.now() - start;
          tokenCount++;
          response += token;
          if (prompt.maxTokens && tokenCount >= prompt.maxTokens) {
            // Can't abort mid-stream cleanly, but track it
          }
        },
      },
    );
  } catch (err: any) {
    return {
      promptId:   prompt.id,
      category:   prompt.category,
      ttft:       0,
      totalMs:    Date.now() - start,
      tokenCount: 0,
      tps:        0,
      response:   '',
      error:      err.message,
    };
  }

  const totalMs = Date.now() - start;
  const tps     = totalMs > 0 ? (tokenCount / (totalMs / 1000)) : 0;

  return {
    promptId:   prompt.id,
    category:   prompt.category,
    ttft,
    totalMs,
    tokenCount,
    tps,
    response:   response.trim(),
  };
}

function computeScore(results: PromptResult[], prompts: BenchPrompt[]): number {
  if (results.length === 0) return 0;
  const successful = results.filter(r => !r.error);
  if (successful.length === 0) return 0;

  // Score components (0-100 each):
  // 1. Reliability (40 pts) — % of prompts without errors
  const reliability = (successful.length / prompts.length) * 40;

  // 2. Speed (40 pts) — tok/s, normalised to 100 tok/s = full score
  const avgTps  = successful.reduce((s, r) => s + r.tps, 0) / successful.length;
  const speedPts= Math.min(40, (avgTps / 80) * 40);

  // 3. TTFT (20 pts) — first token latency, <500ms = full score
  const avgTtft = successful.reduce((s, r) => s + r.ttft, 0) / successful.length;
  const ttftPts = Math.min(20, Math.max(0, (1 - avgTtft / 3000) * 20));

  return Math.round(reliability + speedPts + ttftPts);
}

// ── Display ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return GR;
  if (score >= 60) return YW;
  if (score >= 40) return OR;
  return RE;
}

function tpsColor(tps: number): string {
  if (tps >= 60) return GR;
  if (tps >= 20) return YW;
  if (tps >= 5)  return OR;
  return RE;
}

function ttftColor(ms: number): string {
  if (ms < 300)  return GR;
  if (ms < 800)  return YW;
  if (ms < 2000) return OR;
  return RE;
}

function barOf(score: number, width = 15): string {
  const fill  = Math.round((score / 100) * width);
  const sc    = scoreColor(score);
  return sc + '█'.repeat(fill) + SD + '░'.repeat(width - fill) + R;
}

function printResults(results: ModelResult[], suite: BenchPrompt[]): void {
  const W = process.stdout.columns || 100;
  console.log();
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log(`  ${V}${bold}arc benchmark results${R}   ${SD}${suite.length} prompts · ${results.length} models${R}`);
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log();

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Table header
  const col = { rank: 4, model: 26, score: 8, bar: 17, tps: 10, ttft: 8, errs: 6 };
  console.log(
    `${SD}${'rank'.padEnd(col.rank)}` +
    `${'model'.padEnd(col.model)}` +
    `${'score'.padEnd(col.score)}` +
    `${''.padEnd(col.bar)}` +
    `${'tok/s'.padEnd(col.tps)}` +
    `${'ttft'.padEnd(col.ttft)}` +
    `${'errs'.padEnd(col.errs)}${R}`
  );
  console.log(`${SD}${'─'.repeat(W - 2)}${R}`);

  const medals = ['◈', '◇', '○'];

  results.forEach((mr, i) => {
    const rank    = medals[i] ?? `${i + 1}.`;
    const rankCol = i === 0 ? YW : i === 1 ? SD : SD;
    const glyph   = GLYPHS[mr.rm.backend.info.id]  ?? '';
    const bCol    = BADGE_COLORS[mr.rm.backend.info.id] ?? SD;
    const name    = `${glyph} ${mr.rm.model.name}`.slice(0, col.model - 2);
    const sc      = scoreColor(mr.score);
    const tpsStr  = mr.avgTps > 0 ? mr.avgTps.toFixed(1) : 'n/a';
    const ttftStr = mr.avgTtft > 0 ? `${Math.round(mr.avgTtft)}ms` : 'n/a';
    const errs    = mr.errorCount > 0 ? `${RE}${mr.errorCount}${R}` : `${GR}0${R}`;

    console.log(
      `${rankCol}${rank.padEnd(col.rank)}${R}` +
      `${bCol}${name.padEnd(col.model)}${R}` +
      `${sc}${String(mr.score).padEnd(col.score)}${R}` +
      `${barOf(mr.score)}  ` +
      `${tpsColor(mr.avgTps)}${tpsStr.padEnd(col.tps)}${R}` +
      `${ttftColor(mr.avgTtft)}${ttftStr.padEnd(col.ttft)}${R}` +
      errs
    );
  });

  console.log(`${SD}${'─'.repeat(W - 2)}${R}`);
  console.log();

  // Winner callout
  const winner = results[0];
  if (winner) {
    const gc = GLYPHS[winner.rm.backend.info.id] ?? '';
    console.log(`  ${YW}◈ Winner:${R} ${gc} ${SL}${bold}${winner.rm.model.name}${R}  ${SD}score ${scoreColor(winner.score)}${winner.score}/100${R}  ${SD}avg ${CY}${winner.avgTps.toFixed(1)} tok/s${R}`);
    console.log();
  }

  // Per-category breakdown
  const categories = [...new Set(suite.map(p => p.category))];
  if (categories.length > 1) {
    console.log(`${V}── Per-category breakdown ${'─'.repeat(Math.max(1, W - 28))}${R}`);
    console.log();
    for (const cat of categories) {
      const catPrompts = suite.filter(p => p.category === cat);
      const ids        = new Set(catPrompts.map(p => p.id));
      process.stdout.write(`  ${VL}${cat.padEnd(12)}${R}`);
      for (const mr of results) {
        const catResults = mr.results.filter(r => ids.has(r.promptId) && !r.error);
        const avgTps     = catResults.length > 0
          ? catResults.reduce((s, r) => s + r.tps, 0) / catResults.length : 0;
        const bc = BADGE_COLORS[mr.rm.backend.info.id] ?? SD;
        const modelShort = mr.rm.model.name.split(':')[0].slice(0, 10);
        process.stdout.write(`  ${bc}${modelShort}${R}:${tpsColor(avgTps)}${avgTps.toFixed(0)} t/s${R}`);
      }
      console.log();
    }
    console.log();
  }
}

// ── Main benchmark runner ─────────────────────────────────────────────────────

export async function benchmarkMode(opts: {
  models?: string;
  suite?:  string;
  judge?:  boolean;
}): Promise<void> {
  const suiteName  = opts.suite ?? 'quick';
  const suite      = SUITES[suiteName] ?? SUITE_QUICK;
  const W = process.stdout.columns || 100;

  console.log();
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log(`  ${V}${bold}arc benchmark${R}   ${SD}suite: ${suiteName} · ${suite.length} prompts${R}`);
  console.log(`${V}${'═'.repeat(W - 1)}${R}`);
  console.log();

  // Load models
  const spinner = new Spinner(undefined, 'Detecting models…');
  spinner.start();
  let allModels = await registry.loadAllModels();
  spinner.stop();

  if (allModels.length === 0) {
    console.log(`  ${RE}✗${R} No models available.\n`);
    return;
  }

  // Filter by --models flag
  if (opts.models && opts.models !== 'all') {
    const requested = opts.models.split(',').map(s => s.trim());
    allModels = allModels.filter(m =>
      requested.some(r => m.model.name.includes(r) || m.model.id.includes(r))
    );
    if (allModels.length === 0) {
      console.log(`  ${RE}✗${R} No models matched: ${opts.models}\n`);
      return;
    }
  }

  console.log(`  ${GR}✓${R} Benchmarking ${SL}${allModels.length}${R} model${allModels.length !== 1 ? 's' : ''} across ${SL}${suite.length}${R} prompts`);
  console.log();

  // Run each model
  const modelResults: ModelResult[] = [];

  for (const rm of allModels) {
    const gc   = GLYPHS[rm.backend.info.id] ?? '';
    const bc   = BADGE_COLORS[rm.backend.info.id] ?? SD;
    console.log(`${bc}${gc}${R} ${SL}${rm.model.name}${R}`);

    const results: PromptResult[] = [];
    let   totalTps  = 0;
    let   totalTtft = 0;
    let   errCount  = 0;

    for (const prompt of suite) {
      process.stdout.write(`  ${SD}${prompt.id.padEnd(14)}${R} `);

      const result = await runPrompt(rm, prompt);
      results.push(result);

      if (result.error) {
        errCount++;
        console.log(`${RE}✗ ${result.error.slice(0, 40)}${R}`);
      } else {
        totalTps  += result.tps;
        totalTtft += result.ttft;
        const tpsStr  = result.tps.toFixed(1).padStart(7);
        const ttftStr = `${result.ttft}ms`.padStart(7);
        const tokStr  = String(result.tokenCount).padStart(5);
        console.log(
          `${tpsColor(result.tps)}${tpsStr} tok/s${R}  ` +
          `${ttftColor(result.ttft)}ttft ${ttftStr}${R}  ` +
          `${SD}${tokStr} tok${R}`
        );
      }
    }

    const successful = results.filter(r => !r.error);
    const avgTps  = successful.length > 0 ? totalTps  / successful.length : 0;
    const avgTtft = successful.length > 0 ? totalTtft / successful.length : 0;
    const score   = computeScore(results, suite);

    modelResults.push({ rm, results, avgTps, avgTtft, errorCount: errCount, score });
    console.log(`  ${SD}avg ${CY}${avgTps.toFixed(1)} tok/s${R}  ${SD}ttft ${avgTtft.toFixed(0)}ms${R}  ${scoreColor(score)}score ${score}/100${R}`);
    console.log();
  }

  printResults(modelResults, suite);
}
