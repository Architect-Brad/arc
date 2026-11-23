// ─────────────────────────────────────────────────────────────────────────────
// ansi.ts — Terminal escape code primitives
// ─────────────────────────────────────────────────────────────────────────────

const E = '\x1b[';

export const ansi = {
  reset:     `${E}0m`,
  bold:      `${E}1m`,
  dim:       `${E}2m`,
  italic:    `${E}3m`,
  underline: `${E}4m`,
  strike:    `${E}9m`,

  // Named colors (fg)
  black:   `${E}30m`, red:     `${E}31m`, green:   `${E}32m`,
  yellow:  `${E}33m`, blue:    `${E}34m`, magenta: `${E}35m`,
  cyan:    `${E}36m`, white:   `${E}37m`,

  // Bright (fg)
  bBlack:   `${E}90m`, bRed:   `${E}91m`, bGreen: `${E}92m`,
  bYellow:  `${E}93m`, bBlue:  `${E}94m`, bMagenta:`${E}95m`,
  bCyan:    `${E}96m`, bWhite: `${E}97m`,

  // True color
  fg:  (r: number, g: number, b: number) => `${E}38;2;${r};${g};${b}m`,
  bg:  (r: number, g: number, b: number) => `${E}48;2;${r};${g};${b}m`,
  fg256: (n: number) => `${E}38;5;${n}m`,
  bg256: (n: number) => `${E}48;5;${n}m`,

  // Cursor & screen
  up:        (n = 1) => `${E}${n}A`,
  down:      (n = 1) => `${E}${n}B`,
  col:       (n = 1) => `${E}${n}G`,
  clearLine:           `${E}2K`,
  clearToEnd:          `${E}0K`,
  hideCursor:          `${E}?25l`,
  showCursor:          `${E}?25h`,
  saveCursor:          '\x1b7',
  restoreCursor:       '\x1b8',

  // Helpers
  width: () => process.stdout.columns || 100,
  isTTY: () => Boolean(process.stdout.isTTY),
};

/** Wrap text with ANSI codes and always reset after */
export function styled(codes: string, text: string): string {
  return `${codes}${text}${ansi.reset}`;
}

/** Split a string into ANSI-safe character parts for typewriting */
export function ansiChars(text: string): string[] {
  // Match ANSI sequences as atomic units, split everything else char by char
  const parts: string[] = [];
  const re = /\x1b\[[0-9;]*m|\x1b[^[]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Push individual chars before the sequence
    for (const ch of text.slice(last, m.index)) parts.push(ch);
    // Push the whole sequence as one atomic unit
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  for (const ch of text.slice(last)) parts.push(ch);
  return parts;
}

/** Strip all ANSI codes from a string (for width calculation) */
export function stripAnsi(text: string): string {
  // CSI sequences (…letter final byte) + OSC sequences (BEL-terminated)
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
}

/** Visible length of a string (excludes ANSI codes) */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/** Pad string to visible width */
export function padEnd(text: string, width: number, char = ' '): string {
  const vis = visibleLength(text);
  return vis >= width ? text : text + char.repeat(width - vis);
}
