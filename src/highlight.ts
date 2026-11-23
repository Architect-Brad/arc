// ─────────────────────────────────────────────────────────────────────────────
// highlight.ts — Zero-dep ANSI syntax highlighter
// Covers: js/ts, python, rust, go, java, c/cpp, shell, json, html/xml, css, sql
// ─────────────────────────────────────────────────────────────────────────────

import { theme } from './theme';
const s = theme.syn;

// ── Token types ───────────────────────────────────────────────────────────────
type SynToken = { type: keyof typeof theme.syn; value: string } | { type: 'plain'; value: string };

// ── Language rule sets ────────────────────────────────────────────────────────
interface LangRule {
  pattern: RegExp;
  type: keyof typeof theme.syn;
}

const JS_KEYWORDS = /\b(const|let|var|function|class|extends|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|import|export|default|from|async|await|try|catch|finally|throw|void|this|super|static|get|set|null|undefined|true|false|yield|type|interface|enum|implements|declare|abstract|readonly|keyof|infer|never|unknown|any)\b/g;

const PY_KEYWORDS  = /\b(def|class|return|if|elif|else|for|while|with|as|import|from|in|not|and|or|is|lambda|try|except|finally|raise|pass|break|continue|global|nonlocal|del|yield|assert|True|False|None|async|await|self|cls)\b/g;
const RS_KEYWORDS  = /\b(fn|let|mut|pub|use|mod|struct|enum|impl|trait|for|while|if|else|match|return|self|Self|super|crate|const|static|type|where|in|ref|move|async|await|dyn|box|loop|break|continue|extern|unsafe|true|false|Some|None|Ok|Err)\b/g;
const GO_KEYWORDS  = /\b(func|var|const|type|struct|interface|map|chan|go|select|defer|return|if|else|for|range|switch|case|break|continue|fallthrough|goto|import|package|nil|true|false|iota|make|new|len|cap|append|copy|delete|close|panic|recover|print|println)\b/g;
const JAVA_KEYWORDS= /\b(public|private|protected|class|interface|extends|implements|return|if|else|for|while|do|switch|case|break|continue|new|import|package|static|final|void|null|true|false|this|super|abstract|synchronized|volatile|transient|native|try|catch|finally|throw|throws|instanceof|enum|record|var)\b/g;
const C_KEYWORDS   = /\b(int|char|float|double|long|short|unsigned|signed|void|struct|union|enum|typedef|return|if|else|for|while|do|switch|case|break|continue|goto|sizeof|const|static|extern|register|volatile|inline|nullptr|true|false|auto|class|public|private|protected|namespace|template|typename|virtual|override|new|delete)\b/g;
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|IN|IS|NULL|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|DISTINCT|COUNT|SUM|AVG|MAX|MIN|COALESCE|CASE|WHEN|THEN|ELSE|END|WITH|UNION|ALL|EXISTS|LIKE|BETWEEN|ASC|DESC)\b/gi;

// Rules applied in order; first match wins per position
function makeRules(lang: string): LangRule[] {
  const base: LangRule[] = [
    // Strings (handle before keywords)
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, type: 'string' },
    // Numbers
    { pattern: /\b(0x[\da-fA-F]+|\d+\.?\d*([eE][+-]?\d+)?[fFuUlL]*)\b/g, type: 'number' },
  ];

  const langRules: Record<string, LangRule[]> = {
    javascript: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                         type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                   type: 'comment' },
      { pattern: JS_KEYWORDS,                            type: 'keyword' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
      { pattern: /\b(\w+)(?=\s*\()/g,                   type: 'func' },
    ],
    typescript: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                         type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                   type: 'comment' },
      { pattern: JS_KEYWORDS,                            type: 'keyword' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
      { pattern: /\b(\w+)(?=\s*\()/g,                   type: 'func' },
    ],
    python: [
      ...base,
      { pattern: /#[^\n]*/g,                            type: 'comment' },
      { pattern: /("""[\s\S]*?"""|'''[\s\S]*?''')/g,    type: 'string' },
      { pattern: PY_KEYWORDS,                            type: 'keyword' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
      { pattern: /\b(\w+)(?=\s*\()/g,                   type: 'func' },
    ],
    rust: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                         type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                   type: 'comment' },
      { pattern: RS_KEYWORDS,                            type: 'keyword' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
      { pattern: /\b(\w+)(?=\s*\()/g,                   type: 'func' },
      { pattern: /(&|->|=>|::|\.\.)/g,                  type: 'operator' },
    ],
    go: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                         type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                   type: 'comment' },
      { pattern: GO_KEYWORDS,                            type: 'keyword' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
      { pattern: /\b(\w+)(?=\s*\()/g,                   type: 'func' },
    ],
    java: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                         type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                   type: 'comment' },
      { pattern: JAVA_KEYWORDS,                          type: 'keyword' },
      { pattern: /@\w+/g,                               type: 'builtin' },
      { pattern: /\b([A-Z]\w*)\b/g,                     type: 'type' },
    ],
    json: [
      { pattern: /("(?:[^"\\]|\\.)*")(?=\s*:)/g,       type: 'property' },
      { pattern: /("(?:[^"\\]|\\.)*")/g,               type: 'string' },
      { pattern: /\b(\d+\.?\d*)\b/g,                   type: 'number' },
      { pattern: /\b(true|false|null)\b/g,              type: 'keyword' },
      { pattern: /([{}\[\],:])/g,                       type: 'punctuation' },
    ],
    bash: [
      ...base,
      { pattern: /#[^\n]*/g,                            type: 'comment' },
      { pattern: /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|local|export|echo|cd|ls|mkdir|rm|cp|mv|cat|grep|sed|awk|find|curl|wget|source|export|unset|readonly|declare)\b/g, type: 'keyword' },
      { pattern: /(\$\{?\w+\}?|\$\(.*?\))/g,          type: 'builtin' },
    ],
    shell: [
      ...base,
      { pattern: /#[^\n]*/g,                            type: 'comment' },
      { pattern: /\b(if|then|else|fi|for|while|do|done|echo|export|source)\b/g, type: 'keyword' },
      { pattern: /(\$\{?\w+\}?)/g,                     type: 'builtin' },
    ],
    html: [
      { pattern: /<!--[\s\S]*?-->/g,                   type: 'comment' },
      { pattern: /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)/g,    type: 'tag' },
      { pattern: /\b([a-zA-Z-]+)(?=\s*=)/g,           type: 'attr' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, type: 'string' },
    ],
    css: [
      { pattern: /\/\*[\s\S]*?\*\//g,                  type: 'comment' },
      { pattern: /([.#]?[a-zA-Z][\w-]*)(?=\s*{)/g,   type: 'type' },
      { pattern: /([a-zA-Z-]+)(?=\s*:)/g,             type: 'property' },
      { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, type: 'string' },
      { pattern: /#[0-9a-fA-F]{3,6}\b/g,              type: 'number' },
      { pattern: /\b(\d+\.?\d*)(px|em|rem|vh|vw|%|s|ms)\b/g, type: 'number' },
    ],
    sql: [
      ...base,
      { pattern: /--[^\n]*/g,                          type: 'comment' },
      { pattern: SQL_KEYWORDS,                          type: 'keyword' },
    ],
    c: [
      ...base,
      { pattern: /\/\/[^\n]*/g,                        type: 'comment' },
      { pattern: /\/\*[\s\S]*?\*\//g,                  type: 'comment' },
      { pattern: /#\w+/g,                              type: 'builtin' },
      { pattern: C_KEYWORDS,                            type: 'keyword' },
    ],
  };

  const aliases: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python',
    rs: 'rust', sh: 'shell', htm: 'html',
    cpp: 'c', 'c++': 'c',
  };

  const key = aliases[lang.toLowerCase()] ?? lang.toLowerCase();
  return langRules[key] ?? base;
}

// ── Core tokenizer ─────────────────────────────────────────────────────────────
export function highlight(code: string, lang: string): string {
  if (!lang) return s.plain(code);

  const rules = makeRules(lang);
  // Build a map of position → token
  const spans: Array<{ start: number; end: number; type: keyof typeof theme.syn }> = [];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(code)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Don't overlap with existing spans
      if (!spans.some(sp => sp.start < end && sp.end > start)) {
        spans.push({ start, end, type: rule.type });
      }
    }
  }

  spans.sort((a, b) => a.start - b.start);

  let result = '';
  let pos = 0;
  for (const span of spans) {
    if (span.start > pos) {
      result += s.plain(code.slice(pos, span.start));
    }
    if (span.start >= pos) {
      result += s[span.type](code.slice(span.start, span.end));
      pos = span.end;
    }
  }
  result += s.plain(code.slice(pos));
  return result;
}

/** Highlight code line by line, returning array of highlighted lines */
export function highlightLines(code: string, lang: string): string[] {
  const highlighted = highlight(code, lang);
  return highlighted.split('\n');
}
