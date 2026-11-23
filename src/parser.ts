// ─────────────────────────────────────────────────────────────────────────────
// parser.ts — Block-level markdown AST builder
// ─────────────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'heading'
  | 'code'
  | 'blockquote'
  | 'list_item'
  | 'hr'
  | 'table'
  | 'paragraph'
  | 'blank'
  | 'mermaid'
  | 'svg'
  | 'chartjs';

export interface Block {
  type: BlockType;
  // heading
  level?: number;
  // code / mermaid / svg / chartjs
  lang?: string;
  code?: string;
  // paragraph / heading / blockquote / list_item
  text?: string;
  // list_item
  ordered?: boolean;
  index?: number;
  depth?: number;
  // table
  headers?: string[];
  rows?: string[][];
  align?: Array<'left' | 'center' | 'right' | null>;
}

// ── Streaming block accumulator ───────────────────────────────────────────────
// Used during live streaming — feeds lines one at a time and emits complete blocks

export class BlockAccumulator {
  private lines: string[] = [];
  private inCode = false;
  private codeLang = '';
  private codeLines: string[] = [];
  private inTable = false;
  private tableHeaders: string[] = [];
  private tableAlign: Block['align'] = [];
  private tableRows: string[][] = [];
  private pendingEmit: Block[] = [];
  private listIndex = 0;

  /** Feed one line; returns any newly complete blocks */
  feed(line: string): Block[] {
    this.pendingEmit = [];

    // ── Code fence open ───────────────────────────────────────────────────────
    if (!this.inCode && /^```(\w*)/.test(line)) {
      const lang = line.match(/^```(\w*)/)?.[1] ?? '';
      this.inCode = true;
      this.codeLang = lang;
      this.codeLines = [];
      return [];
    }

    // ── Code fence close ──────────────────────────────────────────────────────
    if (this.inCode && line.startsWith('```')) {
      this.inCode = false;
      const code = this.codeLines.join('\n');
      const lang = this.codeLang.toLowerCase();

      if (lang === 'mermaid') {
        this.emit({ type: 'mermaid', lang, code });
      } else if (lang === 'svg') {
        this.emit({ type: 'svg', lang, code });
      } else if (lang === 'chartjs' || lang === 'chart') {
        this.emit({ type: 'chartjs', lang, code });
      } else {
        this.emit({ type: 'code', lang, code });
      }
      return this.pendingEmit;
    }

    // ── Inside code fence ─────────────────────────────────────────────────────
    if (this.inCode) {
      this.codeLines.push(line);
      return [];
    }

    // ── HTML block tags — strip silently ─────────────────────────────────────
    // <details>, </details>, <summary>, etc. come from GitHub READMEs
    if (/^<\/?(?:details|summary|div|section|article|aside|nav|header|footer|figure|main)(?:\s[^>]*)?>\s*$/.test(line.trim())) {
      return []; // discard entirely
    }
    // HTML comments
    if (/^<!--/.test(line.trim())) {
      return [];
    }

    // ── Blank line ────────────────────────────────────────────────────────────
    if (/^\s*$/.test(line)) {
      if (this.inTable) this.flushTable();
      this.listIndex = 0;
      this.emit({ type: 'blank' });
      return this.pendingEmit;
    }

    // ── HR  ---  or  *** or ___  ─────────────────────────────────────────────
    if (/^(?:---|===|\*\*\*|___)$/.test(line.trim())) {
      this.emit({ type: 'hr' });
      return this.pendingEmit;
    }

    // ── Headings  # ## ### ────────────────────────────────────────────────────
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      if (this.inTable) this.flushTable();
      this.emit({ type: 'heading', level: hMatch[1].length, text: hMatch[2].trim() });
      return this.pendingEmit;
    }

    // ── Blockquote  > text ────────────────────────────────────────────────────
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      this.emit({ type: 'blockquote', text: bqMatch[1] });
      return this.pendingEmit;
    }

    // ── Unordered list  - item  or  * item  or  + item ────────────────────────
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      const depth = Math.floor(ulMatch[1].length / 2);
      this.emit({ type: 'list_item', text: ulMatch[2], ordered: false, depth });
      return this.pendingEmit;
    }

    // ── Ordered list  1. item ─────────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      const depth = Math.floor(olMatch[1].length / 2);
      this.listIndex = parseInt(olMatch[2]);
      this.emit({ type: 'list_item', text: olMatch[3], ordered: true, index: this.listIndex, depth });
      return this.pendingEmit;
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    if (line.includes('|')) {
      const cells = splitTableRow(line);
      if (cells.length >= 1) {
        // Detect separator row
        if (cells.every(c => /^:?-+:?$/.test(c.trim()))) {
          // Parse alignment
          this.tableAlign = cells.map(c => {
            const t = c.trim();
            if (t.startsWith(':') && t.endsWith(':')) return 'center';
            if (t.endsWith(':')) return 'right';
            if (t.startsWith(':')) return 'left';
            return null;
          });
          return [];
        }
        if (!this.inTable) {
          this.inTable = true;
          this.tableHeaders = cells;
          this.tableRows = [];
          return [];
        } else {
          this.tableRows.push(cells);
          return [];
        }
      }
    }

    // Flush table if we hit non-table line
    if (this.inTable) this.flushTable();

    // ── Paragraph ─────────────────────────────────────────────────────────────
    this.emit({ type: 'paragraph', text: line });
    return this.pendingEmit;
  }

  /** Flush any partial state at end of input */
  flush(): Block[] {
    this.pendingEmit = [];
    if (this.inCode) {
      const code = this.codeLines.join('\n');
      this.emit({ type: 'code', lang: this.codeLang, code });
      this.inCode = false;
    }
    if (this.inTable) this.flushTable();
    return this.pendingEmit;
  }

  private flushTable() {
    this.emit({
      type: 'table',
      headers: this.tableHeaders,
      rows: this.tableRows,
      align: this.tableAlign ?? [],
    });
    this.inTable = false;
    this.tableHeaders = [];
    this.tableRows = [];
    this.tableAlign = [];
  }

  private emit(block: Block) {
    this.pendingEmit.push(block);
  }
}

// ── Batch parser (non-streaming) ──────────────────────────────────────────────
export function parseMarkdown(md: string): Block[] {
  const acc = new BlockAccumulator();
  const blocks: Block[] = [];
  for (const line of md.split('\n')) {
    blocks.push(...acc.feed(line));
  }
  blocks.push(...acc.flush());
  return blocks;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}
