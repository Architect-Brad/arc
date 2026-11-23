// ─────────────────────────────────────────────────────────────────────────────
// pipeline.ts — Core streaming markdown rendering pipeline
//
//  LLM token stream
//       ↓
//  LineBuffer  (accumulates tokens into complete lines)
//       ↓
//  BlockAccumulator  (groups lines into markdown blocks)
//       ↓
//  renderBlock()  (ANSI-styled output lines)
//       ↓
//  Typewriter  (character-level animation)
//       ↓
//  stdout
//
// ─────────────────────────────────────────────────────────────────────────────

import { BlockAccumulator, Block } from './parser';
import { renderBlock }             from './renderer';
import { Typewriter, TypewriterOptions } from './typewriter';
import { ansi }                    from './ansi';

export interface PipelineOptions {
  typewriter?: TypewriterOptions;
  /** Instantly render code blocks (skips typewriter for code). Default: true */
  instantCode?: boolean;
  /** Show a blinking cursor while streaming. Default: true */
  cursor?: boolean;
  /** Extra blank line between blocks. Default: false */
  spacedBlocks?: boolean;
  /** System markdown intercept mode: suppress blank lines between paragraphs */
  compact?: boolean;
}

const CURSOR = `${ansi.fg(...[139,92,246] as [number,number,number])}▋${ansi.reset}`;
const CURSOR_CLEAR = `\r${ansi.clearToEnd}`;

// Block types that should be rendered instantly (no typewriter)
const INSTANT_TYPES = new Set(['code', 'table', 'mermaid', 'svg', 'chartjs', 'hr']);

// ── Pipeline ──────────────────────────────────────────────────────────────────

export class MarkdownPipeline {
  private acc     = new BlockAccumulator();
  private tw      : Typewriter;
  private opts    : Required<PipelineOptions>;
  private queue   : Array<() => Promise<void>> = [];
  private running = false;
  private lineBuf = '';
  private cursorActive = false;

  constructor(opts: PipelineOptions = {}) {
    this.opts = {
      typewriter:   opts.typewriter  ?? {},
      instantCode:  opts.instantCode ?? true,
      cursor:       opts.cursor      ?? true,
      spacedBlocks: opts.spacedBlocks ?? false,
      compact:      opts.compact     ?? false,
    };
    this.tw = new Typewriter({
      mode: 'char',
      cps:  180,
      wpm:  600,
      ...this.opts.typewriter,
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Feed raw token(s) from the LLM stream */
  write(token: string): void {
    this.hideCursor();

    this.lineBuf += token;
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      const blocks = this.acc.feed(line);
      for (const block of blocks) {
        // Fast path: instant mode skips the async queue entirely
        if (this.opts.typewriter?.mode === 'instant') {
          const rendered = renderBlock(block);
          this.tw.printLines(rendered);
        } else {
          this.enqueue(block);
        }
      }
    }
    this.showCursor();
  }

  /** Signal end of stream — flush any remaining buffered content */
  async end(): Promise<void> {
    this.hideCursor();

    // Feed leftover buffer content
    if (this.lineBuf) {
      const blocks = this.acc.feed(this.lineBuf);
      for (const block of blocks) this.enqueue(block);
      this.lineBuf = '';
    }

    // Flush accumulator state
    const final = this.acc.flush();
    for (const block of final) this.enqueue(block);

    // Wait for render queue to drain
    await this.drain();
    this.showCursor(true); // always restore cursor on end
  }

  /** Abort streaming immediately */
  abort(): void {
    this.tw.abort();
    this.queue = [];
    this.hideCursor();
    process.stdout.write('\n');
    this.showCursor(true);
  }

  /** Pipe a Node.js Readable stream through the pipeline (e.g. stdin) */
  async pipeFrom(stream: NodeJS.ReadableStream): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => this.write(chunk));
      stream.on('end',  async () => { await this.end(); resolve(); });
      stream.on('error', reject);
    });
  }

  /** Render a complete markdown string (non-streaming, with typewriter) */
  async render(md: string): Promise<void> {
    for (const token of md) this.write(token);
    await this.end();
  }

  /** Render instantly (no typewriter animation) */
  renderInstant(md: string): void {
    const lines = md.split('\n');
    for (const line of lines) {
      const blocks = this.acc.feed(line);
      for (const block of blocks) {
        const rendered = renderBlock(block);
        this.tw.printLines(rendered);
      }
    }
    const final = this.acc.flush();
    for (const block of final) {
      this.tw.printLines(renderBlock(block));
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private enqueue(block: Block): void {
    // Skip consecutive blanks in compact mode
    if (this.opts.compact && block.type === 'blank') return;

    const fn = async () => {
      const lines = renderBlock(block);
      const instant = INSTANT_TYPES.has(block.type) && this.opts.instantCode;

      if (instant) {
        // Code blocks, tables, HR — print instantly
        this.tw.printLines(lines);
      } else if (block.type === 'paragraph' || block.type === 'list_item' || block.type === 'blockquote') {
        // Text blocks — per-word streaming for natural typing feel
        for (const line of lines) {
          await this.tw.feedToken(line + '\n');
        }
        await this.tw.flush();
      } else {
        // Headings, blank lines etc — type line by line
        await this.tw.typeLines(lines, { instant: false });
      }

      if (this.opts.spacedBlocks && block.type !== 'blank') {
        process.stdout.write('\n');
      }
    };

    this.queue.push(fn);
    if (!this.running) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
    }
    this.running = false;
  }

  private async drain(): Promise<void> {
    // Poll until queue is empty and not running
    while (this.running || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  private showCursor(force = false): void {
    if ((this.opts.cursor || force) && process.stdout.isTTY) {
      if (this.cursorActive || force) {
        process.stdout.write(ansi.showCursor);
        this.cursorActive = false;
      }
    }
  }

  private hideCursor(): void {
    if (this.opts.cursor && process.stdout.isTTY && !this.cursorActive) {
      process.stdout.write(ansi.hideCursor);
      this.cursorActive = true;
    }
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

/** Create a pipeline and render a complete markdown string */
export async function renderMarkdown(md: string, opts?: PipelineOptions): Promise<void> {
  const p = new MarkdownPipeline(opts);
  await p.render(md);
}

/** Create a pipeline and pipe stdin through it */
export async function pipeStdin(opts?: PipelineOptions): Promise<void> {
  const p = new MarkdownPipeline(opts);
  await p.pipeFrom(process.stdin);
}
