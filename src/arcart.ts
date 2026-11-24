// ─────────────────────────────────────────────────────────────────────────────
// arcart.ts — arc's own face, drawn in-house.
// A diamond was considered for the logo. The diamond was asked to leave.
// It kept staring at people, so we built a bridge over a wordmark instead.
// Two variants, one grid: portable ASCII and colored ANSI. Every line is the
// same width. We don't ship ragged art. That's a promise, not a feature.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';

const { fg, reset } = ansi;

// arc palette
const V  = fg(139,  92, 246); // violet
const VL = fg(167, 139, 250); // light violet
const I  = fg( 99, 102, 241); // indigo
const SD = fg(148, 163, 184); // slate
const G  = fg(134, 239, 172); // green — the caret lives here

const W = 54;         // inner width
const TOTAL = W + 2;  // including the frame

/** One cell: its portable glyph, its ANSI glyph, and its color ('' = none). */
type Cell = { a: string; n: string; c: string };

const blankCell = (): Cell => ({ a: ' ', n: ' ', c: '' });
const blankRow  = (): Cell[] => Array.from({ length: TOTAL }, blankCell);

/** A content row already carries its left and right frame bars. */
const contentRow = (): Cell[] => {
  const row = blankRow();
  paint(row, 0, '|', '║', V);
  paint(row, W + 1, '|', '║', V);
  return row;
};

/** Paint a run of glyphs into a row at an absolute (frame-inclusive) column. */
function paint(row: Cell[], col: number, ascii: string, ansiGlyph: string, color: string): void {
  for (let i = 0; i < ascii.length; i++) {
    row[col + i] = { a: ascii[i], n: ansiGlyph[i] ?? ascii[i], c: color };
  }
}

/** Paint into the inner area (column 0 = just inside the left frame). */
const at = (row: Cell[], col: number, a: string, n: string, c: string) => paint(row, col + 1, a, n, c);

const center = (row: Cell[], a: string, n: string, c: string) =>
  at(row, Math.floor((W - a.length) / 2), a, n, c);

// ── the wordmark: a block-letter "arc", 6 wide x 5 tall, 2-space gaps ───────
const A = [' #### ', '##  ##', '######', '##  ##', '##  ##'];
const R = ['##### ', '##  ##', '##### ', '##  ##', '##  ##'];
const C = [' #####', '##    ', '##    ', '##    ', ' #####'];
const WORD = A.map((_, i) => A[i] + '  ' + R[i] + '  ' + C[i]); // 22 cols

// ── build the grid once ──────────────────────────────────────────────────────
const rows: Cell[][] = [];

// top frame
{
  const row = blankRow();
  paint(row, 0, '+', '╭', V);
  paint(row, 1, '='.repeat(W), '═'.repeat(W), V);
  paint(row, W + 1, '+', '╮', V);
  rows.push(row);
}

// curved bow: apex, shoulders, flanks
{
  const row = contentRow();
  at(row, 20, '_'.repeat(14), '═'.repeat(14), V);                 // apex
  rows.push(row);
}
{
  const row = contentRow();
  at(row, 15, '__', '══', V);                                    // left lead-in
  at(row, 17, '/', '/', I);
  at(row, 36, '\\', '\\', I);
  at(row, 37, '__', '══', V);                                    // right lead-in
  rows.push(row);
}
{
  const row = contentRow();
  at(row, 13, '/', '/', I);
  at(row, 40, '\\', '\\', I);
  rows.push(row);
}

// pillars + wordmark + caret
for (let i = 0; i < 5; i++) {
  const row = contentRow();
  at(row, 12, '|', '║', V);
  at(row, 41, '|', '║', V);
  at(row, 16, WORD[i], WORD[i].replace(/#/g, '█'), VL);
  if (i === 2) at(row, 38, '>_', '>_', G);                       // prompt caret
  rows.push(row);
}

// bridge deck closes the bow
{
  const row = contentRow();
  at(row, 13, '\\', '\\', I);
  at(row, 14, '_'.repeat(26), '═'.repeat(26), V);
  at(row, 40, '/', '/', I);
  rows.push(row);
}

// tagline
{
  const row = contentRow();
  center(row, 'terminal llm platform', 'terminal llm platform', SD);
  rows.push(row);
}

// bottom frame
{
  const row = blankRow();
  paint(row, 0, '+', '╰', V);
  paint(row, 1, '='.repeat(W), '═'.repeat(W), V);
  paint(row, W + 1, '+', '╯', V);
  rows.push(row);
}

// ── renderers ────────────────────────────────────────────────────────────────
const renderAsciiRow = (row: Cell[]) => row.map(c => c.a).join('');

function renderAnsiRow(row: Cell[]): string {
  let out = '';
  let current = '';
  for (const cell of row) {
    if (cell.c !== current) {
      out += cell.c || reset; // an empty color closes the previous run
      current = cell.c;
    }
    out += cell.n;
  }
  return out + reset;
}

/** Pure ASCII (0x20–0x7E). Works on any terminal, any font, any century. */
export const ARC_LOGO_ASCII: string = rows.map(renderAsciiRow).join('\n');

/** Colored ANSI art. Box-drawing and blocks, arc palette, ends with reset. */
export const ARC_LOGO_ANSI: string = rows.map(renderAnsiRow).join('\n');

/** Pick your poison: --ascii for the plain one, otherwise the pretty one. */
export function arcLogo(opts?: { ascii?: boolean }): string {
  return opts?.ascii ? ARC_LOGO_ASCII : ARC_LOGO_ANSI;
}
