// ─────────────────────────────────────────────────────────────────────────────
// theme.ts — Claude-inspired terminal color theme
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';

const { fg, bg } = ansi;

// Palette — Claude's signature violet/dark aesthetic
const p = {
  violet:      [139, 92,  246] as const,  // arc violet
  violetLight: [167, 139, 250] as const,  // h2
  violetFaint: [196, 181, 253] as const,  // h3+
  indigo:      [99,  102, 241] as const,  // accent
  slateLight:  [226, 232, 240] as const,  // body text
  slate:       [148, 163, 184] as const,  // muted text
  slateDark:   [100, 116, 139] as const,  // very muted
  codeBg:      [15,  15,  30 ] as const,  // code block bg
  codeText:    [199, 210, 254] as const,  // code text
  codeBorder:  [55,  48,  107] as const,  // code block border
  inlineBg:    [30,  27,  75 ] as const,  // inline code bg
  inlineText:  [167, 139, 250] as const,  // inline code text
  quoteBar:    [124, 58,  237] as const,  // blockquote bar
  quoteText:   [148, 163, 184] as const,  // blockquote text
  linkColor:   [96,  165, 250] as const,  // link blue
  bulletColor: [139, 92,  246] as const,  // list bullet
  hrColor:     [71,  85,  105] as const,  // hr line
  tableHead:   [139, 92,  246] as const,  // table header
  tableAlt:    [17,  17,  34 ] as const,  // table alt row
  tableBorder: [55,  48,  107] as const,  // table borders

  // Syntax highlighting palette
  syn: {
    keyword:   [197, 165, 197] as const,  // keywords (purple)
    string:    [152, 195, 121] as const,  // strings (green)
    comment:   [92,  99,  112] as const,  // comments (grey)
    number:    [229, 192, 123] as const,  // numbers (yellow)
    func:      [97,  175, 239] as const,  // function names (blue)
    type:      [230, 160, 100] as const,  // types/classes (orange)
    operator:  [86,  182, 194] as const,  // operators (cyan)
    property:  [224, 108, 117] as const,  // properties (red)
    builtin:   [97,  175, 239] as const,  // builtins (blue)
    tag:       [224, 108, 117] as const,  // HTML tags
    attr:      [229, 192, 123] as const,  // HTML attributes
    punctuation:[171,178,191] as const,  // punctuation
    plain:     [187, 187, 187] as const,  // plain code text
  },
};

export const theme = {
  // ── Headings ──────────────────────────────────────────────────────────────
  h1: (t: string) => `${fg(...p.violet)}${ansi.bold}${t}${ansi.reset}`,
  h2: (t: string) => `${fg(...p.violetLight)}${ansi.bold}${t}${ansi.reset}`,
  h3: (t: string) => `${fg(...p.violetFaint)}${ansi.bold}${t}${ansi.reset}`,
  h4: (t: string) => `${fg(...p.violetFaint)}${t}${ansi.reset}`,
  h5: (t: string) => `${fg(...p.slate)}${ansi.bold}${t}${ansi.reset}`,
  h6: (t: string) => `${fg(...p.slateDark)}${t}${ansi.reset}`,

  // ── Inline formatting ──────────────────────────────────────────────────────
  bold:       (t: string) => `${ansi.bold}${fg(...p.slateLight)}${t}${ansi.reset}`,
  italic:     (t: string) => `${ansi.italic}${fg(...p.slate)}${t}${ansi.reset}`,
  boldItalic: (t: string) => `${ansi.bold}${ansi.italic}${fg(...p.violetFaint)}${t}${ansi.reset}`,
  strike:     (t: string) => `${ansi.strike}${fg(...p.slateDark)}${t}${ansi.reset}`,

  // ── Code ──────────────────────────────────────────────────────────────────
  inlineCode: (t: string) =>
    `${bg(...p.inlineBg)}${fg(...p.inlineText)} ${t} ${ansi.reset}`,

  codeBlockTop: (lang: string, width: number) => {
    const label = lang ? ` ${lang} ` : '';
    const bar = '─'.repeat(Math.max(0, width - visLen(label) - 4));
    return `${fg(...p.codeBorder)}╭${fg(...p.violet)}${ansi.bold}${label}${ansi.reset}${fg(...p.codeBorder)}${bar}╮${ansi.reset}`;
  },
  codeBlockLine: (t: string, width: number) => {
    const padded = t.padEnd(width - 4);
    return `${fg(...p.codeBorder)}│${ansi.reset}${bg(...p.codeBg)} ${padded} ${fg(...p.codeBorder)}│${ansi.reset}`;
  },
  codeBlockBot: (width: number) =>
    `${fg(...p.codeBorder)}╰${'─'.repeat(width - 4)}╯${ansi.reset}`,

  // ── Block elements ─────────────────────────────────────────────────────────
  blockquote: (t: string) =>
    `${fg(...p.quoteBar)}▌${ansi.reset} ${ansi.italic}${fg(...p.quoteText)}${t}${ansi.reset}`,

  hr: (width: number) =>
    `${fg(...p.hrColor)}${'─'.repeat(width - 2)}${ansi.reset}`,

  // ── Lists ──────────────────────────────────────────────────────────────────
  bullet:    (depth: number) => `${fg(...p.bulletColor)}${'  '.repeat(depth)}●${ansi.reset}`,
  numBullet: (n: number, depth: number) =>
    `${fg(...p.violet)}${'  '.repeat(depth)}${n}.${ansi.reset}`,

  // ── Table ──────────────────────────────────────────────────────────────────
  tableHeader: (t: string) => `${fg(...p.tableHead)}${ansi.bold}${t}${ansi.reset}`,
  tableBorder: (t: string) => `${fg(...p.tableBorder)}${t}${ansi.reset}`,
  tableCell:   (t: string) => `${fg(...p.slateLight)}${t}${ansi.reset}`,

  // ── Links ─────────────────────────────────────────────────────────────────
  link: (label: string, url: string) =>
    `${ansi.underline}${fg(...p.linkColor)}${label}${ansi.reset}` +
    `${fg(...p.slateDark)} (${url})${ansi.reset}`,

  // ── Plain text ────────────────────────────────────────────────────────────
  text:   (t: string) => `${fg(...p.slateLight)}${t}${ansi.reset}`,
  muted:  (t: string) => `${fg(...p.slateDark)}${t}${ansi.reset}`,

  // ── Syntax ────────────────────────────────────────────────────────────────
  syn: {
    keyword:     (t: string) => `${fg(...p.syn.keyword)}${t}${ansi.reset}`,
    string:      (t: string) => `${fg(...p.syn.string)}${t}${ansi.reset}`,
    comment:     (t: string) => `${ansi.italic}${fg(...p.syn.comment)}${t}${ansi.reset}`,
    number:      (t: string) => `${fg(...p.syn.number)}${t}${ansi.reset}`,
    func:        (t: string) => `${fg(...p.syn.func)}${t}${ansi.reset}`,
    type:        (t: string) => `${fg(...p.syn.type)}${t}${ansi.reset}`,
    operator:    (t: string) => `${fg(...p.syn.operator)}${t}${ansi.reset}`,
    property:    (t: string) => `${fg(...p.syn.property)}${t}${ansi.reset}`,
    builtin:     (t: string) => `${fg(...p.syn.builtin)}${t}${ansi.reset}`,
    tag:         (t: string) => `${fg(...p.syn.tag)}${t}${ansi.reset}`,
    attr:        (t: string) => `${fg(...p.syn.attr)}${t}${ansi.reset}`,
    punctuation: (t: string) => `${fg(...p.syn.punctuation)}${t}${ansi.reset}`,
    plain:       (t: string) => `${fg(...p.syn.plain)}${t}${ansi.reset}`,
  },

  // Expose palette for external use
  p,
};

// Utility: visible length without ANSI (local to this module)
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
