// ─────────────────────────────────────────────────────────────────────────────
// storage.ts — Chat persistence layer
// Uses sql.js (pure-JS SQLite wasm) — zero native deps.
// Stores: chats, messages, model usage stats
// Auto-naming: fires a one-shot inference after first exchange to name the chat
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';

// ── Schema ─────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'New Chat',
  backend     TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  tokens      INTEGER NOT NULL DEFAULT 0,
  thinking    TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id)
);

CREATE TABLE IF NOT EXISTS stats (
  backend     TEXT NOT NULL,
  model       TEXT NOT NULL,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_chats  INTEGER NOT NULL DEFAULT 0,
  last_used    INTEGER NOT NULL,
  PRIMARY KEY(backend, model)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Chat {
  id:         string;
  title:      string;
  backend:    string;
  model:      string;
  created_at: number;
  updated_at: number;
  token_count:number;
  pinned:     boolean;
}

export interface Message {
  id:         string;
  chat_id:    string;
  role:       'user' | 'assistant' | 'system';
  content:    string;
  created_at: number;
  tokens:     number;
  thinking?:  string;
}

// ── Storage class ─────────────────────────────────────────────────────────────

export class ChatStorage {
  private db:     any   = null;
  private sqljs:  any   = null;
  private dbPath: string;
  private dirty:  boolean = false;
  private saveTimer?: ReturnType<typeof setInterval>;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(os.homedir(), '.config', 'arc', 'chats.db');
  }

  async init(): Promise<void> {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    try {
      const initSqlJs = require('sql.js');
      this.sqljs = await initSqlJs();
    } catch {
      // sql.js not available — run in memory-only mode
      this.db = null;
      return;
    }

    // Load existing DB or create new
    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db   = new this.sqljs.Database(buf);
    } else {
      this.db = new this.sqljs.Database();
    }

    this.db.run(SCHEMA);
    this.persist();

    // Auto-save every 30s when dirty
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.persist();
    }, 30_000);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  persist(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this.dirty = false;
    } catch { /* best effort */ }
  }

  close(): void {
    clearInterval(this.saveTimer);
    this.persist();
    this.db?.close();
  }

  private available(): boolean { return !!this.db; }

  // ── Chat CRUD ───────────────────────────────────────────────────────────────

  createChat(backend: string, model: string): Chat {
    const chat: Chat = {
      id:          `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title:       'New Chat',
      backend,
      model,
      created_at:  Date.now(),
      updated_at:  Date.now(),
      token_count: 0,
      pinned:      false,
    };

    if (this.available()) {
      this.db.run(
        `INSERT INTO chats (id,title,backend,model,created_at,updated_at,token_count,pinned)
         VALUES (?,?,?,?,?,?,?,?)`,
        [chat.id, chat.title, chat.backend, chat.model,
         chat.created_at, chat.updated_at, 0, 0]
      );
      this.dirty = true;
    }
    return chat;
  }

  updateTitle(chatId: string, title: string): void {
    if (!this.available()) return;
    this.db.run(`UPDATE chats SET title=?, updated_at=? WHERE id=?`,
      [title.slice(0, 80), Date.now(), chatId]);
    this.dirty = true;
  }

  updateTokenCount(chatId: string, delta: number): void {
    if (!this.available()) return;
    this.db.run(
      `UPDATE chats SET token_count=token_count+?, updated_at=? WHERE id=?`,
      [delta, Date.now(), chatId]);
    this.dirty = true;
  }

  listChats(limit = 20): Chat[] {
    if (!this.available()) return [];
    const stmt = this.db.prepare(
      `SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC LIMIT ?`);
    stmt.bind([limit]);
    const rows: Chat[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push({ ...r, pinned: !!r.pinned } as any);
    }
    stmt.free();
    return rows;
  }

  getChat(chatId: string): Chat | null {
    if (!this.available()) return null;
    const stmt = this.db.prepare(`SELECT * FROM chats WHERE id=?`);
    stmt.bind([chatId]);
    if (!stmt.step()) { stmt.free(); return null; }
    const r = stmt.getAsObject();
    stmt.free();
    return { ...r, pinned: !!r.pinned } as any;
  }

  deleteChat(chatId: string): void {
    if (!this.available()) return;
    this.db.run(`DELETE FROM messages WHERE chat_id=?`, [chatId]);
    this.db.run(`DELETE FROM chats WHERE id=?`, [chatId]);
    this.dirty = true;
  }

  pinChat(chatId: string, pinned: boolean): void {
    if (!this.available()) return;
    this.db.run(`UPDATE chats SET pinned=? WHERE id=?`, [pinned ? 1 : 0, chatId]);
    this.dirty = true;
  }

  searchChats(query: string): Chat[] {
    if (!this.available()) return [];
    const q = `%${query}%`;
    const stmt = this.db.prepare(
      `SELECT DISTINCT c.* FROM chats c
       LEFT JOIN messages m ON m.chat_id=c.id
       WHERE c.title LIKE ? OR m.content LIKE ?
       ORDER BY c.updated_at DESC LIMIT 20`);
    stmt.bind([q, q]);
    const rows: Chat[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push({ ...r, pinned: !!r.pinned } as any);
    }
    stmt.free();
    return rows;
  }

  // ── Messages ────────────────────────────────────────────────────────────────

  addMessage(chatId: string, role: Message['role'], content: string, tokens = 0, thinking?: string): Message {
    const msg: Message = {
      id:         `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chat_id:    chatId,
      role,
      content,
      created_at: Date.now(),
      tokens,
      thinking,
    };

    if (this.available()) {
      this.db.run(
        `INSERT INTO messages (id,chat_id,role,content,created_at,tokens,thinking)
         VALUES (?,?,?,?,?,?,?)`,
        [msg.id, chatId, role, content, msg.created_at, tokens, thinking ?? null]
      );
      if (tokens > 0) this.updateTokenCount(chatId, tokens);
      this.dirty = true;
    }
    return msg;
  }

  getMessages(chatId: string): Message[] {
    if (!this.available()) return [];
    const stmt = this.db.prepare(
      `SELECT * FROM messages WHERE chat_id=? ORDER BY created_at ASC`);
    stmt.bind([chatId]);
    const rows: Message[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();
    return rows;
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  recordUsage(backend: string, model: string, tokens: number): void {
    if (!this.available()) return;
    this.db.run(
      `INSERT INTO stats (backend,model,total_tokens,total_chats,last_used)
       VALUES (?,?,?,1,?)
       ON CONFLICT(backend,model) DO UPDATE SET
         total_tokens=total_tokens+?,
         last_used=?`,
      [backend, model, tokens, Date.now(), tokens, Date.now()]
    );
    this.dirty = true;
  }

  getStats(): Array<{ backend: string; model: string; total_tokens: number; total_chats: number }> {
    if (!this.available()) return [];
    const stmt = this.db.prepare(`SELECT * FROM stats ORDER BY total_tokens DESC`);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  exportChat(chatId: string, format: 'md' | 'json' = 'md'): string {
    const chat = this.getChat(chatId);
    const msgs = this.getMessages(chatId);
    if (!chat) return '';

    if (format === 'json') {
      return JSON.stringify({ chat, messages: msgs }, null, 2);
    }

    // Markdown export
    const lines = [
      `# ${chat.title}`,
      ``,
      `> **Model:** ${chat.backend} / ${chat.model}`,
      `> **Date:** ${new Date(chat.created_at).toLocaleString()}`,
      `> **Tokens:** ${chat.token_count}`,
      ``,
      '---',
      '',
    ];

    for (const m of msgs) {
      if (m.role === 'system') continue;
      const label = m.role === 'user' ? '**You**' : '**Arc**';
      lines.push(`${label}\n`);
      lines.push(m.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ── Auto-naming ───────────────────────────────────────────────────────────────

/**
 * Fire a silent one-shot inference to generate a 4-word chat title.
 * Non-blocking — runs in background and updates storage when done.
 */
export async function autoNameChat(
  storage:  ChatStorage,
  chatId:   string,
  firstUser: string,
  firstReply: string,
  streamFn: (prompt: string, onToken: (t: string) => void) => Promise<void>,
): Promise<void> {
  const prompt =
    `Based on this exchange, give a short 3-5 word title for the conversation.\n` +
    `Respond with ONLY the title, no punctuation, no quotes.\n\n` +
    `User: ${firstUser.slice(0, 200)}\n` +
    `Assistant: ${firstReply.slice(0, 200)}\n\n` +
    `Title:`;

  let title = '';
  try {
    await streamFn(prompt, (t) => { title += t; });
    title = title
      .trim()
      .replace(/^["']|["']$/g, '')   // strip quotes
      .replace(/[^\w\s\-]/g, '')      // strip special chars
      .split('\n')[0]                  // first line only
      .slice(0, 60);

    if (title.length > 2) {
      storage.updateTitle(chatId, title);
    }
  } catch { /* non-fatal */ }
}

// Singleton
export const globalStorage = new ChatStorage();

// Persist any dirty in-memory DB on process exit so the 30s
// autosave doesn't lose the last messages on crash/quit
process.on('exit', () => { try { globalStorage.persist(); } catch { /* best effort */ } });
