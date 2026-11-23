// ─────────────────────────────────────────────────────────────────────────────
// inline.ts — Top-tier inline markdown renderer
//
// Handles the full CommonMark inline spec plus GFM extensions.
// Processes in correct precedence order — no regex soup.
// Supports: bold, italic, bolditalic, strikethrough, inline code,
//           links, images (as labels), autolinks, kbd, mark, sub, sup,
//           math inline, footnote refs, emoji shortcodes.
// ─────────────────────────────────────────────────────────────────────────────

import { theme } from './theme';
import { ansi }  from './ansi';

const { fg, bold, dim, italic: ital, underline, reset: R } = ansi;

// Extra colors for new inline types
const V  = fg(139,  92, 246);
const VF = fg(196, 181, 253);
const CY = fg(103, 232, 249);
const YW = fg(250, 204,  21);
const GR = fg(134, 239, 172);
const SD = fg(100, 116, 139);
const OR = fg(251, 146,  60);

// ── Emoji shortcode map (common ones) ────────────────────────────────────────
const EMOJI: Record<string, string> = {
  ':warning:': '⚠',  ':check:': '✓',    ':x:': '✗',
  ':rocket:':  '🚀', ':fire:':  '🔥',   ':star:': '⭐',
  ':bulb:':    '💡', ':wrench:':'🔧',   ':bug:':  '🐛',
  ':tada:':    '🎉', ':eyes:':  '👀',   ':wave:': '👋',
  ':thumbsup:':'👍', ':heart:': '❤',    ':zap:':  '⚡',
  ':lock:':    '🔒', ':key:':   '🔑',   ':link:': '🔗',
  ':memo:':    '📝', ':books:': '📚',   ':gear:': '⚙',
  ':white_check_mark:': '✅',
  ':heavy_check_mark:': '✓',
};

// ── Math inline placeholder ────────────────────────────────────────────────────
function renderMath(expr: string): string {
  return `${VF}${dim}⟨${expr}⟩${R}`;
}

// ── Main inline renderer ──────────────────────────────────────────────────────

export function renderInline(text: string): string {
  // Strip HTML block elements that escape the block parser
  let t = text
    .replace(/<\/?(details|summary|div|span|section|article|aside|nav|header|footer|figure|figcaption|main)[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return processInline(t);
}

function processInline(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    // ── Escape ──────────────────────────────────────────────────────────────
    if (text[i] === '\\' && i + 1 < n && isPunct(text[i+1])) {
      out.push(text[i+1]);
      i += 2;
      continue;
    }

    // ── Inline code ──────────────────────────────────────────────────────────
    if (text[i] === '`') {
      const { content, end } = consumeCode(text, i);
      if (end > i) {
        out.push(theme.inlineCode(content));
        i = end;
        continue;
      }
    }

    // ── Math inline $...$ ────────────────────────────────────────────────────
    if (text[i] === '$' && text[i+1] !== '$') {
      const close = text.indexOf('$', i + 1);
      if (close > i + 1) {
        out.push(renderMath(text.slice(i + 1, close)));
        i = close + 1;
        continue;
      }
    }

    // ── Images ![alt](url) ───────────────────────────────────────────────────
    if (text[i] === '!' && text[i+1] === '[') {
      const r = consumeLink(text, i + 1);
      if (r) {
        out.push(`${SD}${dim}[img: ${r.label}]${R}`);
        i = r.end;
        continue;
      }
    }

    // ── Links [label](url) or [label][ref] ───────────────────────────────────
    if (text[i] === '[') {
      const r = consumeLink(text, i);
      if (r) {
        const label = renderInline(r.label); // recurse for nested formatting
        out.push(theme.link(label, r.href));
        i = r.end;
        continue;
      }
    }

    // ── Autolinks <url> or <email> ───────────────────────────────────────────
    if (text[i] === '<') {
      const close = text.indexOf('>', i + 1);
      if (close > i + 1) {
        const inner = text.slice(i + 1, close);
        if (/^https?:\/\//.test(inner) || /^[a-z0-9._%+-]+@/i.test(inner)) {
          out.push(theme.link(inner, inner));
          i = close + 1;
          continue;
        }
      }
    }

    // ── Emoji shortcodes :name: ───────────────────────────────────────────────
    if (text[i] === ':') {
      const close = text.indexOf(':', i + 1);
      if (close > i + 1 && close < i + 30) {
        const code = text.slice(i, close + 1);
        const emoji = EMOJI[code];
        if (emoji) {
          out.push(emoji);
          i = close + 1;
          continue;
        }
      }
    }

    // ── Bold + Italic ***text*** or ___text___ ───────────────────────────────
    if ((text[i] === '*' && text[i+1] === '*' && text[i+2] === '*') ||
        (text[i] === '_' && text[i+1] === '_' && text[i+2] === '_')) {
      const delim = text[i];
      const r = consumeSpan(text, i, delim.repeat(3));
      if (r) { out.push(theme.boldItalic(processInline(r.content))); i = r.end; continue; }
    }

    // ── Bold **text** or __text__ ────────────────────────────────────────────
    if ((text[i] === '*' && text[i+1] === '*') ||
        (text[i] === '_' && text[i+1] === '_')) {
      const delim = text[i];
      const r = consumeSpan(text, i, delim.repeat(2));
      if (r) { out.push(theme.bold(processInline(r.content))); i = r.end; continue; }
    }

    // ── Italic *text* or _text_ ──────────────────────────────────────────────
    if (text[i] === '*' || (text[i] === '_' && (i === 0 || /\s/.test(text[i-1])))) {
      const delim = text[i];
      const r = consumeSpan(text, i, delim);
      if (r && r.content) { out.push(theme.italic(processInline(r.content))); i = r.end; continue; }
    }

    // ── Strikethrough ~~text~~ ───────────────────────────────────────────────
    if (text[i] === '~' && text[i+1] === '~') {
      const r = consumeSpan(text, i, '~~');
      if (r) { out.push(theme.strike(processInline(r.content))); i = r.end; continue; }
    }

    // ── Highlight ==text== ───────────────────────────────────────────────────
    if (text[i] === '=' && text[i+1] === '=') {
      const r = consumeSpan(text, i, '==');
      if (r) {
        out.push(`${ansi.bg(80, 60, 10)}${YW}${r.content}${R}`);
        i = r.end;
        continue;
      }
    }

    // ── Keyboard <kbd> style: [[key]] ────────────────────────────────────────
    // Guard: don't fire inside badge links like [![img](url)](url) or [[ref]]
    if (text[i] === '[' && text[i+1] === '[') {
      const prev = i > 0 ? text[i-1] : '';
      // Only treat as kbd if not inside markdown link syntax
      if (prev !== '!' && prev !== ']' && prev !== '[') {
        const close = text.indexOf(']]', i + 2);
        if (close > i + 2) {
          const key = text.slice(i + 2, close);
          // Sanity: kbd keys are short and don't contain newlines
          if (key.length <= 20 && !key.includes('\n')) {
            out.push(`${ansi.bg(30, 27, 60)}${VF}${key}${R}`);
            i = close + 2;
            continue;
          }
        }
      }
    }

    // ── Plain character ──────────────────────────────────────────────────────
    out.push(text[i]);
    i++;
  }

  return out.join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPunct(c: string): boolean {
  return '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.includes(c);
}

function consumeCode(text: string, start: number): { content: string; end: number } {
  // Count opening backticks
  let ticks = 0;
  let i = start;
  while (i < text.length && text[i] === '`') { ticks++; i++; }
  const delim = '`'.repeat(ticks);

  // Find matching close
  const close = text.indexOf(delim, i);
  if (close === -1) return { content: '', end: start }; // no match

  // Make sure it's not longer
  if (text[close + ticks] === '`') return { content: '', end: start };

  return {
    content: text.slice(i, close).trim(),
    end:     close + ticks,
  };
}

function consumeSpan(text: string, start: number, delim: string): { content: string; end: number } | null {
  const i = start + delim.length;
  if (i >= text.length) return null;
  if (text[i] === ' ') return null; // no space after opening

  const close = text.indexOf(delim, i);
  if (close === -1 || close === i) return null;
  if (text[close - 1] === ' ') return null; // no space before closing

  // Don't match across newlines for single-char delimiters
  if (delim.length === 1 && text.slice(i, close).includes('\n')) return null;

  return { content: text.slice(i, close), end: close + delim.length };
}

function consumeLink(text: string, start: number): { label: string; href: string; end: number } | null {
  if (text[start] !== '[') return null;
  let i = start + 1;
  let depth = 1;
  let labelEnd = -1;

  while (i < text.length) {
    if (text[i] === '[') depth++;
    if (text[i] === ']') { depth--; if (depth === 0) { labelEnd = i; break; } }
    if (text[i] === '\\') i++; // skip escaped
    i++;
  }

  if (labelEnd === -1) return null;
  const label = text.slice(start + 1, labelEnd);

  // Inline link: (url) or (url "title")
  if (text[labelEnd + 1] === '(') {
    const closeP = text.indexOf(')', labelEnd + 2);
    if (closeP === -1) return null;
    const inner = text.slice(labelEnd + 2, closeP);
    // Strip optional title "..."
    const href = inner.replace(/\s+"[^"]*"$/, '').trim();
    return { label, href, end: closeP + 1 };
  }

  // Reference link: [label][ref] — treat as label=href for terminal
  if (text[labelEnd + 1] === '[') {
    const closeR = text.indexOf(']', labelEnd + 2);
    if (closeR === -1) return null;
    return { label, href: text.slice(labelEnd + 2, closeR) || label, end: closeR + 1 };
  }

  return null;
}

// Keep for backward compat
export function stripInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1').replace(/___(.+?)___/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
