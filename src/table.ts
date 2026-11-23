// ─────────────────────────────────────────────────────────────────────────────
// table.ts — Advanced table renderer
// Handles wide tables: horizontal scroll, smart column sizing, wrap mode
// ─────────────────────────────────────────────────────────────────────────────

import { ansi, stripAnsi, visibleLength } from './ansi';
import { renderInline }                    from './inline';

const VL = ansi.fg(167, 139, 250);
const SD = ansi.fg(100, 116, 139);
const SL = ansi.fg(226, 232, 240);
const R  = ansi.reset;

// ── Column alignment ──────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right' | null;

function alignCell(text: string, width: number, align: Align): string {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  const pad = width - vis;
  if (align === 'right')  return ' '.repeat(pad) + text;
  if (align === 'center') return ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2));
  return text + ' '.repeat(pad); // left (default)
}

// ── Column width calculator ───────────────────────────────────────────────────

function calcColWidths(
  headers: string[],
  rows:    string[][],
  termWidth: number,
  maxColWidth = 40,
): { widths: number[]; truncated: boolean } {
  const cols = headers.length;

  // Natural widths (content + 2 padding)
  const natural = Array.from({ length: cols }, (_, i) => {
    const allCells = [headers[i], ...rows.map(r => r[i] ?? '')];
    return Math.min(
      maxColWidth,
      Math.max(...allCells.map(c => stripAnsi(c).length)) + 2,
    );
  });

  // Total width including borders: cols+1 border chars + sum of col widths
  const borderOverhead = cols + 1;
  const totalNatural   = natural.reduce((a, b) => a + b, 0) + borderOverhead;

  if (totalNatural <= termWidth) {
    return { widths: natural, truncated: false };
  }

  // Need to compress — shrink proportionally, min 6 per column
  const budget  = termWidth - borderOverhead;
  const minW    = 6;
  let widths    = [...natural];
  let total     = natural.reduce((a, b) => a + b, 0);

  // Iteratively shrink the widest column
  while (total > budget) {
    const maxIdx = widths.indexOf(Math.max(...widths));
    if (widths[maxIdx] <= minW) break;
    widths[maxIdx] = Math.max(minW, widths[maxIdx] - 1);
    total = widths.reduce((a, b) => a + b, 0);
  }

  return { widths, truncated: total + borderOverhead > termWidth };
}

// ── Render helpers ────────────────────────────────────────────────────────────

/** Wrap text at word boundaries to fit within width */
function wrapCellText(text: string, maxW: number): string[] {
  if (text.length <= maxW) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (!cur) { cur = word; }
    else if (cur.length + 1 + word.length <= maxW) { cur += ' ' + word; }
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [text.slice(0, maxW)];
}

/** Render a cell as multiple display lines (for word-wrapped content) */
function renderCellLines(raw: string, width: number, align: Align, isHeader: boolean): string[] {
  const plain = stripAnsi(renderInline(raw));
  const inner = width - 2;
  const color = isHeader ? `${VL}${ansi.bold}` : SL;

  const wrapped = wrapCellText(plain, inner);
  return wrapped.map(line => ` ${color}${alignCell(line, inner, align)}${R} `);
}

/** Render one display line per wrapped cell line; pads short cells with blank lines */
function renderMultilineRow(
  cells:    string[],
  widths:   number[],
  align:    Align[],
  isHeader: boolean,
): string[] {
  const pipe   = `${SD}│${R}`;
  const cellLs = cells.map((c, i) => renderCellLines(c, widths[i], align[i] ?? null, isHeader));
  const maxLen = Math.max(1, ...cellLs.map(l => l.length));
  const lines: string[] = [];
  for (let li = 0; li < maxLen; li++) {
    const parts = cellLs.map((l, i) => l[li] ?? ' '.repeat(widths[i]));
    lines.push(`${SD}│${R}${parts.join(pipe)}${SD}│${R}`);
  }
  return lines;
}

function borderRow(
  widths: number[],
  left:   string,
  mid:    string,
  right:  string,
  fill:   string,
): string {
  return `${SD}${left}${widths.map(w => fill.repeat(w)).join(mid)}${right}${R}`;
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export interface TableRenderOptions {
  headers:   string[];
  rows:      string[][];
  align?:    Align[];
  termWidth?: number;
}

export function renderTable(opts: TableRenderOptions): string[] {
  const { headers, rows, align = [], termWidth = process.stdout.columns || 100 } = opts;

  if (headers.length === 0) return [];

  const { widths, truncated } = calcColWidths(headers, rows, termWidth - 2);

  const lines: string[] = [];

  // Top border
  lines.push(borderRow(widths, '╭', '┬', '╮', '─'));

  // Header row (may wrap to multiple display lines)
  lines.push(...renderMultilineRow(headers, widths, align, true));

  // Header separator
  lines.push(borderRow(widths, '├', '┼', '┤', '─'));

  // Data rows (word-wrapped content flows across multiple display lines)
  rows.forEach((row, ri) => {
    const cells = headers.map((_, i) => row[i] ?? '');
    lines.push(...renderMultilineRow(cells, widths, align, false));

    // Subtle alternating row: no bg color (avoids clashes), just a dimmer separator
    if (ri < rows.length - 1) {
      lines.push(borderRow(widths, '├', '┼', '┤', '╌'));
    }
  });

  // Bottom border
  lines.push(borderRow(widths, '╰', '┴', '╯', '─'));

  // Truncation notice
  if (truncated) {
    lines.push(`  ${SD}← columns compressed to fit terminal (${termWidth} cols)${R}`);
  }

  return lines;
}

// ── Wide table ────────────────────────────────────────────────────────────────
// Kept as a separate entry point for API compatibility (renderer.ts imports it).
// The old implementation hid overflowing columns (no scroll keys ever existed);
// it now always falls back to the compressing, wrapping renderer, which shrinks
// columns to a 6-char minimum and wraps cell text across multiple display rows.

export function renderWideTable(opts: TableRenderOptions): string[] {
  return renderTable(opts);
}
