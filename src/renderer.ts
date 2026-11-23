// ─────────────────────────────────────────────────────────────────────────────
// renderer.ts — Block → ANSI lines (updated: new table + code action bar)
// ─────────────────────────────────────────────────────────────────────────────

import { Block }            from './parser';
import { theme }            from './theme';
import { renderInline }     from './inline';
import { highlightLines }   from './highlight';
import { ansi, visibleLength } from './ansi';
import { renderWideTable }  from './table';

const WIDTH = () => Math.min(process.stdout.columns || 100, 140);

// ── Special fence notice (mermaid / svg / chartjs) ───────────────────────────
function renderSpecialFence(type: string, code: string): string[] {
  const w = WIDTH();
  const labels: Record<string, string> = {
    mermaid: '◈ Mermaid Diagram', svg: '◈ SVG Graphic', chartjs: '◈ Chart.js Chart',
  };
  const hints: Record<string, string> = {
    mermaid: 'paste into mermaid.live to render',
    svg:     'open as .svg in browser',
    chartjs: 'paste into chartjs.org to render',
  };
  const _ = ansi.fg(...theme.p.violet as [number,number,number]);
  const d = ansi.fg(...theme.p.slateDark as [number,number,number]);
  const r = ansi.reset;
  const label = labels[type] ?? type;
  const hint  = hints[type]  ?? '';
  const lines: string[] = [];
  lines.push(`${_}╭─ ${label} ${'─'.repeat(Math.max(0, w - label.length - 7))}╮${r}`);
  lines.push(`${_}│${r} ${d}${hint}${r}`);
  code.split('\n').slice(0, 20).forEach(cl => {
    const padded = cl.slice(0, w - 6).padEnd(w - 6);
    lines.push(`${_}│${r}  ${ansi.dim}${ansi.fg(...theme.p.codeText as [number,number,number])}${padded}${r}`);
  });
  lines.push(`${_}╰${'─'.repeat(w - 4)}╯${r}`);
  return lines;
}

// ── Code block ────────────────────────────────────────────────────────────────
function renderCodeBlock(lang: string, code: string): string[] {
  const w      = WIDTH();
  const innerW = w - 4;
  const lines: string[] = [];

  lines.push(theme.codeBlockTop(lang, w));

  const highlighted = highlightLines(code, lang);
  highlighted.forEach(hl => {
    const truncated = visibleLength(hl) > innerW ? hl.slice(0, innerW - 1) + '…' : hl;
    lines.push(theme.codeBlockLine(truncated, w));
  });

  lines.push(theme.codeBlockBot(w));
  // Action bar rendered separately via post-block hook (not mid-stream)
  return lines;
}

// ── Heading ───────────────────────────────────────────────────────────────────
function renderHeading(level: number, text: string): string[] {
  const w  = WIDTH();
  const fns = [theme.h1, theme.h2, theme.h3, theme.h4, theme.h5, theme.h6];
  const fn  = fns[Math.min(level - 1, 5)];
  const styled = fn(text);
  if (level === 1) {
    const bar = ansi.fg(...theme.p.violet as [number,number,number]) + '═'.repeat(w - 2) + ansi.reset;
    return [bar, `  ${styled}`, bar];
  }
  if (level === 2) {
    const bar = ansi.fg(...theme.p.violetLight as [number,number,number]) + '─'.repeat(w - 2) + ansi.reset;
    return [`  ${styled}`, bar];
  }
  return [`  ${styled}`];
}

// ── Main block renderer ───────────────────────────────────────────────────────
export function renderBlock(block: Block): string[] {
  switch (block.type) {
    case 'blank':      return [''];
    case 'hr':         return [theme.hr(WIDTH() - 2)];
    case 'heading':    return renderHeading(block.level!, block.text!);
    case 'paragraph':  return [theme.text(renderInline(block.text!))];
    case 'blockquote': return [theme.blockquote(renderInline(block.text!))];
    case 'list_item': {
      const depth  = block.depth ?? 0;
      const pad    = '  '.repeat(depth);
      const bullet = block.ordered ? theme.numBullet(block.index!, depth) : theme.bullet(depth);
      return [`${pad}${bullet} ${renderInline(block.text!)}`];
    }
    case 'code':    return renderCodeBlock(block.lang ?? '', block.code ?? '');
    case 'mermaid': return renderSpecialFence('mermaid', block.code ?? '');
    case 'svg':     return renderSpecialFence('svg',     block.code ?? '');
    case 'chartjs': return renderSpecialFence('chartjs', block.code ?? '');
    case 'table':
      return renderWideTable({
        headers:   block.headers ?? [],
        rows:      block.rows    ?? [],
        align:     block.align   as any,
        termWidth: WIDTH(),
      });
    default:
      return [block.text ? theme.text(renderInline(block.text)) : ''];
  }
}

export function renderBlocks(blocks: Block[]): string[] {
  return blocks.flatMap(renderBlock);
}
