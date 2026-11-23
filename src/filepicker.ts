// ─────────────────────────────────────────────────────────────────────────────
// filepicker.ts — Inline filesystem picker for @file: command
//
// Activated when the user types @file: in the input box.
// Arrow keys navigate, Tab completes, Enter selects, Esc cancels.
// Shows directories (/) and files, filters as you type.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import { ansi }  from './ansi';

const { fg, bold, dim, reset: R } = ansi;
const V  = fg(139,  92, 246);
const VL = fg(167, 139, 250);
const SD = fg(100, 116, 139);
const GR = fg(134, 239, 172);
const YW = fg(250, 204,  21);
const CY = fg(103, 232, 249);
const SL = fg(226, 232, 240);

const UP   = (n: number) => `\x1b[${n}A`;
const COL1 = '\x1b[1G';
const CLR  = '\x1b[2K';

interface FsEntry {
  name:  string;
  isDir: boolean;
  full:  string;
}

function listDir(dirPath: string, filter: string): FsEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => {
        const n = e.name;
        if (n.startsWith('.') && !filter.startsWith('.')) return false;
        if (filter && !n.toLowerCase().startsWith(filter.toLowerCase())) return false;
        return true;
      })
      .map(e => ({
        name:  e.name + (e.isDirectory() ? '/' : ''),
        isDir: e.isDirectory(),
        full:  path.join(dirPath, e.name),
      }))
      .sort((a, b) => {
        // Dirs first, then files, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12); // max visible
  } catch {
    return [];
  }
}

function drawPicker(
  entries:   FsEntry[],
  sel:       number,
  dirPath:   string,
  filter:    string,
  drawnLines: number,
): number {
  if (!process.stdout.isTTY) return 0;
  const w     = process.stdout.columns || 100;
  const lines: string[] = [];

  const shortDir = dirPath.replace(process.env.HOME ?? '/root', '~');
  lines.push(`${V}╭─ ${YW}@file${R} ${SD}${shortDir}${R} ${filter ? `${SD}filter: ${VL}${filter}${R}` : ''}`);

  if (entries.length === 0) {
    lines.push(`  ${SD}(no matches)${R}`);
  } else {
    entries.forEach((e, i) => {
      const isSel  = i === sel;
      const cursor = isSel ? `${V}▶${R}` : ' ';
      const color  = e.isDir ? CY : SL;
      const icon   = e.isDir ? `${SD}/${R}` : ' ';
      const bg     = isSel ? ansi.bg(20, 15, 45) : '';
      const bgR    = isSel ? R : '';
      lines.push(`  ${cursor} ${bg}${color}${e.name}${R}${bgR}`);
    });
  }

  lines.push(`${V}╰${R} ${SD}↑↓ navigate  Tab complete  ↵ select  Esc cancel${R}`);

  let output = '';
  if (drawnLines > 0) output += UP(drawnLines) + COL1;
  for (const l of lines) output += CLR + l + '\n';
  process.stdout.write(output);
  return lines.length;
}

/**
 * Show the filesystem picker starting at `startPath`.
 * Returns the selected path or null if cancelled.
 */
export async function showFilePicker(startPath = process.cwd()): Promise<string | null> {
  if (!process.stdout.isTTY) return null;

  return new Promise((resolve) => {
    let dirPath = startPath;
    let filter  = '';
    let sel     = 0;
    let drawn   = 0;

    process.stdout.write(ansi.hideCursor);
    process.stdout.write('\n'); // space above picker

    const entries = () => listDir(dirPath, filter);
    drawn = drawPicker(entries(), sel, dirPath, filter, 0);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const done = (result: string | null) => {
      off();
      // Clear picker
      let output = '';
      if (drawn > 0) { output += UP(drawn) + COL1; for (let i=0;i<drawn;i++) output += CLR+'\n'; output += UP(drawn)+COL1; }
      output += ansi.showCursor;
      process.stdout.write(output);
      resolve(result);
    };

    const redraw = () => {
      const e = entries();
      sel   = Math.max(0, Math.min(sel, e.length - 1));
      drawn = drawPicker(e, sel, dirPath, filter, drawn);
    };

    const onKey = (key: string) => {
      if (key === '\u0003' || key === '\u001b') { done(null); return; }

      if (key === '\r' || key === '\n') {
        const e = entries();
        if (e.length === 0) { done(null); return; }
        const chosen = e[sel];
        if (chosen.isDir) {
          // Navigate into directory
          dirPath = chosen.full;
          filter  = '';
          sel     = 0;
          redraw();
        } else {
          done(chosen.full);
        }
        return;
      }

      if (key === '\u001b[A' || key === 'k') {   // up
        sel = Math.max(0, sel - 1); redraw();
      } else if (key === '\u001b[B' || key === 'j') { // down
        const e = entries();
        sel = Math.min(e.length - 1, sel + 1); redraw();
      } else if (key === '\t') {                  // tab — complete
        const e = entries();
        if (e.length === 1) {
          const chosen = e[0];
          if (chosen.isDir) { dirPath = chosen.full; filter = ''; sel = 0; redraw(); }
          else done(chosen.full);
        }
      } else if (key === '\u001b[D' || key === '\u007f') { // left or backspace — go up
        if (filter) { filter = filter.slice(0, -1); sel = 0; redraw(); }
        else { dirPath = path.dirname(dirPath); filter = ''; sel = 0; redraw(); }
      } else if (key.length === 1 && key >= ' ') { // type to filter
        filter += key; sel = 0; redraw();
      }
    };

    const off = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onKey);
      process.stdin.pause();
    };

    process.stdin.on('data', onKey);
  });
}

/**
 * Check if the current input buffer ends with @file: (possibly with partial path)
 * Returns { active: true, pathSoFar } if the picker should activate.
 */
export function shouldActivateFilePicker(buf: string): { active: boolean; prefix: string; partial: string } {
  const match = buf.match(/@file:([^\s]*)$/);
  if (!match) return { active: false, prefix: '', partial: '' };
  return {
    active:  true,
    prefix:  buf.slice(0, buf.lastIndexOf('@file:')),
    partial: match[1],
  };
}
