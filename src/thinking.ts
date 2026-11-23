// ─────────────────────────────────────────────────────────────────────────────
// thinking.ts — Thinking block parser + streaming renderer
//
// Supports:
//   <think>...</think>          (QwQ, DeepSeek-R1, Qwen3)
//   <thinking>...</thinking>   (Claude extended thinking)
//   [THINKING]...[/THINKING]   (some open models)
//   <!--think-->...<!--/think--> (rare)
//
// In streaming mode, detects the opening tag mid-stream and renders
// the thinking content in a distinct dimmed fenced block, collapsed
// once the closing tag arrives.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi }                       from './ansi';
import { thinkingHeader, thinkingFooter, thinkingLine, SPINNER_THINK } from './icons';

const VF = ansi.fg(196, 181, 253);
const SD = ansi.fg(100, 116, 139);
const R  = ansi.reset;

// ── Tag patterns ──────────────────────────────────────────────────────────────

const THINK_OPEN_RE  = /<think(?:ing)?>|\[THINKING\]|<!--think-->/i;
const THINK_CLOSE_RE = /<\/think(?:ing)?>|\[\/THINKING\]|<!--\/think-->/i;

// ── Streaming state machine ───────────────────────────────────────────────────

export type ThinkingState = 'outside' | 'inside' | 'done';

export interface ThinkChunk {
  type:    'thinking' | 'content' | 'boundary';
  text:    string;
}

/**
 * Split a raw LLM token stream into thinking vs content chunks.
 * Call feed() for each token; it returns an array of typed chunks.
 */
export class ThinkingParser {
  private state:  ThinkingState = 'outside';
  private buf:    string        = '';

  get currentState(): ThinkingState { return this.state; }

  feed(token: string): ThinkChunk[] {
    this.buf += token;
    const out: ThinkChunk[] = [];

    while (this.buf.length > 0) {
      if (this.state === 'outside') {
        const m = THINK_OPEN_RE.exec(this.buf);
        if (!m) {
          // No open tag — might be a partial tag at the end; hold last 20 chars
          const safe = this.buf.slice(0, Math.max(0, this.buf.length - 20));
          if (safe) { out.push({ type: 'content', text: safe }); this.buf = this.buf.slice(safe.length); }
          break;
        }
        // Emit content before the tag
        if (m.index > 0) out.push({ type: 'content', text: this.buf.slice(0, m.index) });
        out.push({ type: 'boundary', text: 'open' });
        this.buf  = this.buf.slice(m.index + m[0].length);
        this.state = 'inside';

      } else if (this.state === 'inside') {
        const m = THINK_CLOSE_RE.exec(this.buf);
        if (!m) {
          // No close tag — emit all but last 20 chars as thinking content
          const safe = this.buf.slice(0, Math.max(0, this.buf.length - 20));
          if (safe) { out.push({ type: 'thinking', text: safe }); this.buf = this.buf.slice(safe.length); }
          break;
        }
        if (m.index > 0) out.push({ type: 'thinking', text: this.buf.slice(0, m.index) });
        out.push({ type: 'boundary', text: 'close' });
        this.buf  = this.buf.slice(m.index + m[0].length);
        this.state = 'done';

      } else {
        // done — remainder is all content
        if (this.buf) { out.push({ type: 'content', text: this.buf }); this.buf = ''; }
        break;
      }
    }
    return out;
  }

  flush(): ThinkChunk[] {
    const out: ThinkChunk[] = [];
    if (this.buf) {
      out.push({ type: this.state === 'inside' ? 'thinking' : 'content', text: this.buf });
      this.buf = '';
    }
    return out;
  }

  reset(): void { this.state = 'outside'; this.buf = ''; }
}

// ── Streaming thinking renderer ───────────────────────────────────────────────
// Renders thinking content inline with animation, then collapses it.

export class ThinkingRenderer {
  private lines:      string[] = [];
  private lineCount:  number   = 0;
  private spinFrame:  number   = 0;
  private spinIv?:    ReturnType<typeof setInterval>;
  private isOpen:     boolean  = false;
  private startTime:  number   = 0;
  private charCount:  number   = 0;
  private partialLine: string  = '';
  private W = () => process.stdout.columns || 100;

  /** Called when <think> tag detected */
  open(): void {
    if (!process.stdout.isTTY) return;
    this.isOpen    = true;
    this.startTime = Date.now();
    this.lines     = [];
    this.lineCount = 0;
    this.charCount = 0;
    this.partialLine = '';

    process.stdout.write(ansi.hideCursor);
    process.stdout.write('\n' + thinkingHeader(this.W()) + '\n');
    this.lineCount += 2; // blank + header

    // Start the spinner on the thinking line
    this.spinIv = setInterval(() => {
      const f = SPINNER_THINK[this.spinFrame++ % SPINNER_THINK.length];
      process.stdout.write(`\r${thinkingLine(f + '  ' + this.partialLine.slice(-60))}   `);
    }, 150);
  }

  /** Stream thinking text character by character */
  write(text: string): void {
    if (!this.isOpen) return;
    this.charCount += text.length;
    this.partialLine += text;

    // When we get a newline, commit the line
    const parts = this.partialLine.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      this.commitLine(parts[i]);
    }
    this.partialLine = parts[parts.length - 1];
  }

  private commitLine(line: string): void {
    // Don't render thinking lines in non-TTY
    if (!process.stdout.isTTY) return;
    const w = this.W();
    const truncated = line.slice(0, w - 6);
    this.lines.push(truncated);
    // Keep max 3 visible thinking lines while streaming
    if (this.lines.length > 3) this.lines.shift();
  }

  /**
   * Called when </think> tag detected.
   * Collapses the thinking block to a single summary line.
   */
  close(): void {
    if (!this.isOpen) return;
    clearInterval(this.spinIv);

    const elapsed = Date.now() - this.startTime;
    const dur     = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
    const w       = this.W();

    if (process.stdout.isTTY) {
      // Move up past the open header + spinner line and redraw as collapsed
      // We don't know exact line count so redraw footer then summary on same area
      process.stdout.write('\r' + ansi.clearToEnd);
      // Summary line
      const summary = `  ${VF}${ansi.dim}✓ thought for ${dur} · ${this.charCount} chars${R}`;
      process.stdout.write(thinkingFooter(w) + '\n');
      process.stdout.write(summary + '\n\n');
    }

    this.isOpen = false;
    process.stdout.write(ansi.showCursor);
  }

  /** Non-TTY: just write a static collapsed block */
  renderStatic(content: string): void {
    const w     = this.W();
    const lines = content.split('\n').filter(l => l.trim());
    const MAX   = 5;
    process.stdout.write(thinkingHeader(w) + '\n');
    lines.slice(0, MAX).forEach(l => process.stdout.write(thinkingLine(l.slice(0, w - 6)) + '\n'));
    if (lines.length > MAX) process.stdout.write(thinkingLine(`… ${lines.length - MAX} more lines`) + '\n');
    process.stdout.write(thinkingFooter(w) + '\n\n');
  }
}

// ── Convenience: strip thinking tags from final text ─────────────────────────

export function stripThinkingTags(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/\[THINKING\][\s\S]*?\[\/THINKING\]/gi, '')
    .trim();
}

/** Check if a model is known to emit thinking blocks */
export function modelHasThinking(modelId: string): boolean {
  // Always parse - <think> tags only appear in models that use them.
  // Parsing is zero-cost when no tags are present (state stays 'outside').
  // Better to always handle than to maintain a fragile whitelist.
  return true;
}
