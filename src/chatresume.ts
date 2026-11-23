// ─────────────────────────────────────────────────────────────────────────────
// chatresume.ts — Session resume picker
// Shown on arc startup when saved chats exist.
// Arrow keys to pick, / to search, N for new chat, Enter to resume.
// ─────────────────────────────────────────────────────────────────────────────

import { ChatStorage, Chat } from './storage';
import { ansi }              from './ansi';
import { GLYPHS, BADGE_COLORS } from './logos';

const V  = ansi.fg(139,  92, 246);
const VL = ansi.fg(167, 139, 250);
const SD = ansi.fg(100, 116, 139);
const SL = ansi.fg(226, 232, 240);
const GR = ansi.fg(134, 239, 172);
const CY = ansi.fg(103, 232, 249);
const YW = ansi.fg(250, 204,  21);
const b  = ansi.bold;
const dim= ansi.dim;
const R  = ansi.reset;
const W  = () => process.stdout.columns || 100;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function clearLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write(ansi.up(1) + ansi.col(1) + ansi.clearLine);
  }
}

export interface ResumeResult {
  action:  'new' | 'resume';
  chat?:   Chat;
}

export async function showResumePicker(storage: ChatStorage): Promise<ResumeResult> {
  const chats = storage.listChats(15);

  // No saved chats — skip the picker entirely
  if (chats.length === 0) return { action: 'new' };

  if (!process.stdout.isTTY) return { action: 'new' };

  return new Promise((resolve) => {
    let sel     = 0;
    let filter  = '';
    let drawn   = 0;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write(ansi.hideCursor);

    const visible = () => filter
      ? chats.filter(c =>
          c.title.toLowerCase().includes(filter.toLowerCase()) ||
          c.model.toLowerCase().includes(filter.toLowerCase()))
      : chats;

    const draw = (init = false): void => {
      const w    = W();
      const vis  = visible();
      const lines: string[] = [];

      // Header
      lines.push(`${V}── ${VL}${b}Continue a chat${R}  ${SD}or press ${V}N${SD} to start new  ·  type to search  ·  q quit${R}`);
      lines.push('');

      if (filter) {
        lines.push(`  ${SD}Search: ${YW}${filter}${R}  ${SD}${vis.length} match${vis.length !== 1 ? 'es' : ''}${R}`);
      }

      const MAX = Math.min(10, vis.length);
      const start = Math.max(0, sel - Math.floor(MAX / 2));
      const window = vis.slice(start, start + MAX);

      if (start > 0) lines.push(`  ${SD}↑ ${start} more${R}`);

      window.forEach((chat, wi) => {
        const absIdx = start + wi;
        const isSel  = absIdx === sel;
        const cursor = isSel ? `${V}▶${R}` : ' ';
        const bg2    = isSel ? ansi.bg(20, 15, 45) : '';
        const bgR    = isSel ? R : '';

        const bCol  = BADGE_COLORS[chat.backend] ?? SD;
        const glyph = GLYPHS[chat.backend]       ?? '';
        const pin   = chat.pinned ? `${YW} ★${R}` : '';
        const ago   = timeAgo(chat.updated_at);
        const toks  = chat.token_count > 0 ? `${SD}~${chat.token_count} tok${R}  ` : '';
        const title = chat.title.slice(0, 45);

        // Right-align the timestamp
        const left  = `  ${cursor} ${bg2}${pin}${SL}${b}${title}${R}  ${toks}${bCol}${glyph} ${chat.model}${R}`;
        const leftV = left.replace(/\x1b\[[0-9;]*m/g, '').length;
        const gap   = Math.max(1, w - leftV - ago.length - 4);

        lines.push(`${left}${' '.repeat(gap)}${SD}${ago}${R}${bgR}`);
      });

      const remaining = vis.length - start - window.length;
      if (remaining > 0) lines.push(`  ${SD}↓ ${remaining} more${R}`);

      lines.push('');
      lines.push(`  ${SD}↑↓ navigate  ↵ resume  ${R}${V}N${SD} new chat  ↵ on blank = new  q quit${R}`);

      if (!init) clearLines(drawn);
      drawn = lines.length;
      lines.forEach(l => process.stdout.write(l + '\n'));
    };

    draw(true);

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onKey);
      process.stdin.pause();
      process.stdout.write(ansi.showCursor);
    };

    const onKey = (key: string): void => {
      const vis = visible();

      if (key === '\u0003' || key === 'q') {
        cleanup();
        clearLines(drawn);
        process.exit(0);
      }
      if (key === 'n' || key === 'N') {
        cleanup();
        clearLines(drawn);
        resolve({ action: 'new' });
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        clearLines(drawn);
        if (vis.length === 0 || !vis[sel]) {
          resolve({ action: 'new' });
        } else {
          resolve({ action: 'resume', chat: vis[sel] });
        }
        return;
      }
      if (key === '\u001b[A' || key === 'k') {
        sel = Math.max(0, sel - 1); draw();
      } else if (key === '\u001b[B' || key === 'j') {
        sel = Math.min(vis.length - 1, sel + 1); draw();
      } else if (key === '\u007f' || key === '\b') {
        filter = filter.slice(0, -1); sel = 0; draw();
      } else if (key.length === 1 && key >= ' ' && key !== 'n' && key !== 'N') {
        filter += key; sel = 0; draw();
      }
    };

    process.stdin.on('data', onKey);
  });
}
