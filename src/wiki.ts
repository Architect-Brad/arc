// ─────────────────────────────────────────────────────────────────────────────
// wiki.ts — path/content helpers for the shipped WIKI.md
// No side effects, no rendering. The caller decides how to display it.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import * as fs from 'fs';

/** Absolute path to the shipped manual (WIKI.md sits beside dist/). */
export function getWikiPath(): string {
  return path.join(__dirname, '..', 'WIKI.md');
}

/** True when the wiki file is present. */
export function wikiExists(): boolean {
  return fs.existsSync(getWikiPath());
}

/** UTF-8 contents of the wiki, or null if missing/unreadable. */
export function readWiki(): string | null {
  try {
    return fs.readFileSync(getWikiPath(), 'utf8');
  } catch {
    return null;
  }
}
