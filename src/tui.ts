// ─────────────────────────────────────────────────────────────────────────────
// tui.ts — Full chat loop: InputBox + storage + auto-naming + thinking + logos
// ─────────────────────────────────────────────────────────────────────────────

import { ArcMessage }            from './backends/base';
import { ResolvedModel }          from './backends/registry';
import { MarkdownPipeline }       from './pipeline';
import { ThinkingParser, ThinkingRenderer, modelHasThinking } from './thinking';
import { SLASH_COMMANDS }                 from './input';
import { InputBox }               from './inputbox';
import { ChatStorage, autoNameChat } from './storage';
import { ansi }                   from './ansi';
import { ContextWindow, modelContextSize } from './core';
import { getPersona, getAllPersonas, printPersonaList, createPersonaTemplate } from './personas';
import { checkEasterEgg } from './easter';
import { maybeCompress, estimateHistoryTokens } from './compress';
import { config, handleConfigCmd } from './config';
import {
  GLYPHS, BADGE_COLORS,
} from './logos';

const V  = ansi.fg(139,  92, 246);
const VL = ansi.fg(167, 139, 250);
const SL = ansi.fg(226, 232, 240);
const SD = ansi.fg(100, 116, 139);
const GR = ansi.fg(134, 239, 172);
const RE = ansi.fg(248, 113, 113);
const CY = ansi.fg(103, 232, 249);
const YW = ansi.fg(250, 204,  21);
const b  = ansi.bold;
const R  = ansi.reset;
const W  = () => process.stdout.columns || 100;

function bc(rm: ResolvedModel): string {
  return BADGE_COLORS[rm.backend.info.id] ?? SD;
}

function doubleDividerLocal(w = W()): string {
  return `${V}${'═'.repeat(Math.max(1, w - 1))}${R}`;
}

function dividerLocal(w = W()): string {
  return `${V}${'─'.repeat(Math.max(1, w - 1))}${R}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat header
// ─────────────────────────────────────────────────────────────────────────────

function printChatHeader(rm: ResolvedModel, chatTitle: string): void {
  const w    = W();
  const bCol = bc(rm);
  const glyph = GLYPHS[rm.backend.info.id] ?? '';
  console.log();
  console.log(doubleDividerLocal(w));
  console.log(`  ${bCol}${b}${glyph}  ${rm.backend.info.name}${R}  ${V}◈${R}  ${SL}${b}${rm.model.name}${R}  ${SD}${rm.model.size ?? ''}${R}`);
  if (chatTitle && chatTitle !== 'New Chat') {
    console.log(`  ${SD}${chatTitle}${R}`);
  }
  console.log(`  ${SD}@file @url @paste @cwd  ·  /help /model /save /copy /retry  ·  Ctrl+C quit${R}`);
  console.log(doubleDividerLocal(w));
  console.log();
}

function printUserTurn(text: string, attachments: string[]): void {
  const w = W();
  console.log();
  console.log(`${SD}${'╌'.repeat(w - 1)}${R}`);
  console.log(`  ${CY}you${R}  ${SL}${text}${R}`);
  attachments.forEach(a => {
    const preview = a.slice(0, 80).replace(/\n/g, ' ');
    console.log(`  ${YW}@${R}  ${SD}${preview}…${R}`);
  });
  console.log(`${SD}${'╌'.repeat(w - 1)}${R}`);
  console.log();
}

function printAssistantLabel(rm: ResolvedModel): void {
  const glyph = GLYPHS[rm.backend.info.id] ?? '';
  const bCol  = bc(rm);
  console.log(`  ${V}${b}arc${R}  ${bCol}${glyph} ${rm.backend.info.name}${R}  ${SD}${rm.model.name}${R}`);
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  const w = W();
  console.log();
  console.log(`${V}── ${VL}${b}Slash Commands${R} ${SD}${'─'.repeat(Math.max(0, w - 18))}${R}`);
  SLASH_COMMANDS.forEach(c =>
    console.log(`  ${V}/${c.name.padEnd(10)}${R}  ${SD}${c.desc}${R}`));
  console.log(`  ${SD}Generation: ${V}/temp <0-2>${R} · ${V}/top-p <0-1>${R} · ${V}/seed <int>${R} · ${V}/gen${R} ${SD}(session only)${R}`);
  console.log();
  console.log(`${V}── ${VL}${b}@-Commands${R} ${SD}${'─'.repeat(Math.max(0, w - 14))}${R}`);
  [
    ['@file:path',  "Attach file contents"],
    ['@url:https…', "Fetch and attach URL"],
    ['@paste',      "Paste clipboard"],
    ['@cwd',        "Attach directory tree"],
    ['@system:…',   "Set system context"],
  ].forEach(([cmd, desc]) =>
    console.log(`  ${YW}${(cmd as string).padEnd(16)}${R}  ${SD}${desc}${R}`));
  console.log();
  console.log(`${V}── ${VL}${b}Code Block Keys${R} ${SD}${'─'.repeat(Math.max(0, w - 19))}${R}`);
  console.log(`  ${GR}[r]${R} run  ${CY}[c]${R} copy  ${SD}[s] save  [↵] continue${R}`);
  console.log();
  console.log(`${V}── ${VL}${b}Personas${R} ${SD}${'─'.repeat(Math.max(1, W() - 12))}${R}`);
  getAllPersonas().slice(0, 6).forEach(p =>
    console.log(`  ${V}${p.icon.padEnd(5)}${R} ${VL}/persona ${p.name.padEnd(12)}${R} ${SD}${p.description}${R}`)
  );
  console.log(`  ${SD}All: ${V}/persona list${R}  Create: ${V}/persona new <name>${R}`);
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main chat loop
// ─────────────────────────────────────────────────────────────────────────────

export async function chatLoop(
  rm:       ResolvedModel,
  onSwitch: () => Promise<void>,
  storage:  ChatStorage,
): Promise<void> {
  const hasThinking = modelHasThinking(rm.model.id);
  const history:    ArcMessage[] = [];
  let   lastResponse = '';
  let   systemPrompt = '';

  // Session generation overrides — seeded from config, changed by /temp etc.
  // Never injected into compare / benchmark / web UI / auto-naming streams.
  const defaults = config.get().defaults;
  const generation: { temperature?: number; topP?: number; seed?: number } = {};
  if (typeof defaults.temperature === 'number') generation.temperature = defaults.temperature;
  if (typeof defaults.topP === 'number')       generation.topP        = defaults.topP;
  if (typeof defaults.seed === 'number')       generation.seed        = defaults.seed;

  // Create persistent chat record
  const chat = storage.createChat(rm.backend.info.id, rm.model.id);
  printChatHeader(rm, chat.title);

  const ctxWindow = new ContextWindow();
  await ctxWindow.init(rm.model.id, modelContextSize(rm.model.id));

  const inputBox = new InputBox({
    modelName:     rm.model.name,
    backendId:     rm.backend.info.id,
    contextWindow: ctxWindow,
  });

  let firstExchange = true;

  while (true) {
    const result = await inputBox.read();

    if (result.cancelled) { goodbye(); process.exit(0); }
    const { text } = result;
    if (!text) continue;

    // ── Slash commands ────────────────────────────────────────────────────────
    if (text.startsWith('/')) {
      const parts   = text.slice(1).split(' ');
      const cmdName = parts[0];
      const args    = parts.slice(1).join(' ');

      switch (cmdName) {
        case 'help':   printHelp();                                          break;
        case 'clear':
          history.length = 0; await ctxWindow.init(rm.model.id, modelContextSize(rm.model.id));
          console.log(`  ${GR}✓${R} ${SD}History cleared${R}\n`);
          break;
        case 'model':  storage.persist(); await onSwitch(); return;
        case 'exit':   storage.persist(); goodbye(); process.exit(0);
        case 'system': systemPrompt = args; console.log(`  ${GR}✓${R} ${SD}System prompt set${R}\n`); break;
        case 'reset':
          history.length = 0; systemPrompt = ''; await ctxWindow.init(rm.model.id, modelContextSize(rm.model.id));
          console.log(`  ${GR}✓${R} ${SD}Session reset${R}\n`);
          break;
        case 'undo':
          if (history.length >= 2) { history.splice(-2); console.log(`  ${GR}✓${R} ${SD}Last exchange removed${R}\n`); }
          else console.log(`  ${SD}Nothing to undo${R}\n`);
          break;
        case 'retry':
          if (history.length >= 1) {
            const lastUser = [...history].reverse().find(m => m.role === 'user');
            if (lastUser) {
              if (history[history.length-1]?.role === 'assistant') {
                history.pop();
                storage.deleteTrailingAssistant(chat.id);
              }
              const resp = await streamResponse(rm, history, lastUser.content, [], hasThinking, storage, chat.id, generation);
              if (resp) { history.push({ role: 'assistant', content: resp }); lastResponse = resp; }
            }
          }
          break;
        case 'save': {
          const { writeFileSync } = await import('fs');
          const fname = `arc-chat-${Date.now()}.md`;
          writeFileSync(fname, storage.exportChat(chat.id, 'md'));
          console.log(`  ${GR}✓${R} Saved → ${V}${fname}${R}\n`);
          break;
        }
        case 'chats': {
          const chats = storage.listChats(10);
          if (chats.length === 0) { console.log(`  ${SD}No saved chats${R}\n`); break; }
          console.log();
          chats.forEach((c, i) => {
            const date = new Date(c.updated_at).toLocaleDateString();
            console.log(`  ${SD}${(i+1).toString().padStart(2)}.${R} ${SL}${c.title}${R}  ${SD}${c.model} · ${date} · ~${c.token_count} tok${R}`);
          });
          console.log();
          break;
        }
        case 'copy': {
          if (lastResponse) {
            const { execSync } = await import('child_process');
            for (const cmd of ['wl-copy', 'xclip -selection clipboard', 'xsel --clipboard --input']) {
              try { execSync(`printf '%s' ${JSON.stringify(lastResponse)} | ${cmd}`, { shell:'/bin/bash', stdio:['pipe','pipe','ignore'] }); break; } catch {}
            }
            console.log(`  ${GR}✓${R} ${SD}Copied${R}\n`);
          } else console.log(`  ${SD}Nothing to copy yet${R}\n`);
          break;
        }
        case 'persona': {
          const parg = args.trim();
          if (!parg || parg === 'list') { printPersonaList(); break; }
          if (parg.startsWith('new ')) { createPersonaTemplate(parg.slice(4).trim()); break; }
          const persona = getPersona(parg);
          if (!persona) { console.log(`  ${RE}✗${R} Unknown persona: ${V}${parg}${R} — try /persona list\n`); break; }
          systemPrompt = persona.system;
          history.length = 0;
          console.log(`  ${GR}✓${R} ${V}${persona.icon}${R} Persona: ${VL}${persona.name}${R}  ${SD}${persona.description}${R}`);
          console.log(`  ${SD}History cleared. Persona active from next message.${R}\n`);
          break;
        }
        case 'typing': {
          const mode = args.trim();
          if (mode === 'char' || mode === 'word' || mode === 'instant') {
            (process as any).__arcTypingMode = mode;
            const desc = mode === 'char' ? 'per-character' : mode === 'word' ? 'per-word' : 'instant';
            console.log(`  ${GR}✓${R} ${SD}Typewriter: ${V}${desc}${R}\n`);
          } else {
            const cur = (process as any).__arcTypingMode ?? 'char';
            console.log(`  ${SD}Typewriter: ${V}${cur}${R}  Options: ${V}char${R} · ${V}word${R} · ${V}instant${R}\n`);
          }
          break;
        }
        case 'config': {
          handleConfigCmd(args.trim().split(' ').filter(Boolean));
          break;
        }
        case 'tokens': {
          console.log(`  ${SD}Context used: ${V}${ctxWindow.getUsed()}${R}/${SD}${ctxWindow.getMax()}${R} tokens  (${(ctxWindow.getPct()*100).toFixed(1)}%)\n`);
          break;
        }
        case 'temp': {
          const raw = args.trim();
          const t   = Number(raw);
          if (raw === '' || !Number.isFinite(t)) {
            console.log(`  ${RE}✗${R} Usage: ${V}/temp 0.7${R}  ${SD}(0.0–2.0)${R}\n`);
          } else {
            const v = Math.min(2, Math.max(0, t));
            generation.temperature = v;
            console.log(`  ${GR}✓${R} ${SD}Temperature: ${V}${v}${R}${v !== t ? ` ${SD}(clamped to 0..2)${R}` : ''}\n`);
          }
          break;
        }
        case 'top-p': {
          const raw = args.trim();
          const p   = Number(raw);
          if (raw === '' || !Number.isFinite(p)) {
            console.log(`  ${RE}✗${R} Usage: ${V}/top-p 0.9${R}  ${SD}(0.0–1.0)${R}\n`);
          } else {
            const v = Math.min(1, Math.max(0, p));
            generation.topP = v;
            console.log(`  ${GR}✓${R} ${SD}Top-p: ${V}${v}${R}${v !== p ? ` ${SD}(clamped to 0..1)${R}` : ''}\n`);
          }
          break;
        }
        case 'seed': {
          const raw = args.trim();
          const n   = Number(raw);
          if (raw === '' || !Number.isFinite(n)) {
            console.log(`  ${RE}✗${R} Usage: ${V}/seed 42${R}  ${SD}(integer)${R}\n`);
          } else {
            const v = Math.trunc(n);
            generation.seed = v;
            console.log(`  ${GR}✓${R} ${SD}Seed: ${V}${v}${R}\n`);
          }
          break;
        }
        case 'gen': {
          const t = generation.temperature, p = generation.topP, s = generation.seed;
          console.log(`  ${VL}Generation${R}  ${SD}temp=${V}${t ?? 'default'}${R}  ${SD}top-p=${V}${p ?? 'default'}${R}  ${SD}seed=${V}${s ?? 'default'}${R}`);
          console.log(`  ${SD}Session only. Config: ${V}defaults.temperature${R} · ${V}defaults.topP${R} · ${V}defaults.seed${R}\n`);
          break;
        }
        case 'export': {
          const fmt = (args.trim() || 'md') as 'md' | 'json';
          const { writeFileSync } = await import('fs');
          const fname = `arc-export-${Date.now()}.${fmt}`;
          writeFileSync(fname, storage.exportChat(chat.id, fmt));
          console.log(`  ${GR}✓${R} Exported → ${V}${fname}${R}\n`);
          break;
        }
        case 'bench': {
          console.log(`  ${SD}Running quick benchmark…${R}\n`);
          const { benchmarkMode } = await import('./benchmark');
          await benchmarkMode({ suite: args.trim() || 'quick' });
          break;
        }
        case 'examples': {
          console.log();
          console.log(`${V}── @-command examples ${'─'.repeat(Math.max(1,W()-23))}${R}`);
          console.log(`  ${YW}@file:src/main.ts${R}      ${SD}attach a file's contents${R}`);
          console.log(`  ${YW}@url:https://...${R}       ${SD}fetch and attach a URL${R}`);
          console.log(`  ${YW}@paste${R}                 ${SD}attach clipboard contents${R}`);
          console.log(`  ${YW}@cwd${R}                   ${SD}attach directory tree${R}`);
          console.log(`  ${YW}@system:You are...${R}     ${SD}set inline system context${R}`);
          console.log();
          console.log(`${V}── /command examples ${'─'.repeat(Math.max(1,W()-22))}${R}`);
          console.log(`  ${V}/persona coder${R}          ${SD}switch to coder persona${R}`);
          console.log(`  ${V}/persona list${R}           ${SD}show all personas${R}`);
          console.log(`  ${V}/typing char${R}            ${SD}per-character animation${R}`);
          console.log(`  ${V}/temp 0.7${R}               ${SD}set temperature${R}`);
          console.log(`  ${V}/system You are...${R}      ${SD}set system prompt${R}`);
          console.log(`  ${V}/save${R}                   ${SD}save conversation to file${R}`);
          console.log(`  ${V}/export json${R}            ${SD}export as JSON${R}`);
          console.log(`  ${V}/bench${R}                  ${SD}run quick benchmark${R}`);
          console.log(`  ${V}/tokens${R}                 ${SD}show context usage${R}`);
          console.log(`  ${V}/retry${R}                  ${SD}resend last message${R}`);
          console.log();
          break;
        }
        default: console.log(`  ${RE}Unknown command.${R} /help  or  /examples\n`);
      }
      continue;
    }

    // ── @-command expansion ───────────────────────────────────────────────────
    let userContent = text;
    const atMatches = text.match(/@(\w+)(?::([^\s]*))?/g) ?? [];
    const attachmentSummaries: string[] = [];

    for (const at of atMatches) {
      const m = at.match(/@(\w+)(?::(.+))?/);
      if (!m) continue;
      const [, name, arg = ''] = m;
      const { AT_COMMANDS } = await import('./input');
      const cmd = AT_COMMANDS.find(c => c.name === name);
      if (cmd) {
        const resolved = await cmd.resolve(arg);
        if (resolved) {
          // Replace @cmd with empty in the display text but inject content
          userContent = userContent.replace(at, '').trim();
          userContent += '\n' + resolved;
          // Build a readable summary for the user turn display
          const preview = resolved.replace(/\n/g,' ').trim().slice(0, 60);
          attachmentSummaries.push(`${name}${arg ? ':'+arg.split('/').pop() : ''} → ${preview}…`);
        }
      }
    }

    // ── Stream response ───────────────────────────────────────────────────────
    // Check easter eggs first
    const eggResult = await checkEasterEgg(text);
    if (eggResult === null) { continue; } // handled by easter egg

    printUserTurn(text, attachmentSummaries);
    history.push({ role: 'user', content: userContent });
    // Always inject @command awareness as system context
    const atAwareNote = `You may receive context injected via arc's @-commands:
- <file path="...">...</file> — file contents attached with @file:path
- <paste>...</paste> — clipboard contents attached with @paste
- <url src="...">...</url> — web page content attached with @url:url
- <cwd>...</cwd> — directory tree attached with @cwd
Treat these as provided context. Reference them naturally in your response.`;

    const sysContent = systemPrompt
      ? systemPrompt + '\n\n' + atAwareNote
      : atAwareNote;

    if (!history.find(m => m.role === 'system')) {
      history.unshift({ role: 'system', content: sysContent });
    }

    // Save user message
    storage.addMessage(chat.id, 'user', userContent);

    // Auto-compress context if near limit
    if (ctxWindow.getMax() > 0) {
      const { history: compressed, notice } = await maybeCompress(
        history, ctxWindow.getUsed(), ctxWindow.getMax(), rm
      );
      if (notice) {
        // Splice history in place
        history.length = 0;
        compressed.forEach(m => history.push(m));
        console.log(`  ${notice}`);
        console.log();
        // Reset context estimate
        await ctxWindow.init(rm.model.id, ctxWindow.getMax());
        await ctxWindow.add(estimateHistoryTokens(history));
      }
    }

    printAssistantLabel(rm);
    const response = await streamResponse(rm, history, text, [], hasThinking, storage, chat.id, generation);

    if (response) {
      history.push({ role: 'assistant', content: response });
      lastResponse = response;
      const newTokens = Math.ceil((userContent.length + response.length) / 3.8);
      await ctxWindow.add(newTokens);

      // Auto-name the chat after first exchange
      if (firstExchange) {
        firstExchange = false;
        // Fire and forget — doesn't block the user
        autoNameChat(
          storage, chat.id, text, response,
          async (prompt, onToken) => {
            await rm.backend.stream(
              rm.model,
              [{ role: 'user', content: prompt }],
              { onToken },
            );
          },
        ).then(() => {
          // Silently update — user sees it next time they open /chats
        }).catch(() => {});
      }
    } else {
      history.pop();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core stream response handler
// ─────────────────────────────────────────────────────────────────────────────

async function streamResponse(
  rm:          ResolvedModel,
  history:     ArcMessage[],
  text:        string,
  attachments: string[],
  hasThinking: boolean,
  storage:     ChatStorage,
  chatId:      string,
  generation?: { temperature?: number; topP?: number; seed?: number },
): Promise<string | null> {
  const typingMode  = (process as any).__arcTypingMode ?? 'char';
  const pipeline   = new MarkdownPipeline({
    typewriter: { mode: typingMode as any, cps: 180, wpm: 600 },
    instantCode: true, cursor: true,
  });
  const thinkParser= hasThinking ? new ThinkingParser() : null;
  const thinkRend  = hasThinking ? new ThinkingRenderer() : null;
  const ac         = new AbortController();
  const start      = Date.now();
  let   tokenCount = 0;
  let   fullContent= '';
  let   thinkContent='';
  let   inThinking = false;

  const sigint = () => { ac.abort(); pipeline.abort(); };
  process.once('SIGINT', sigint);

  try {
    await rm.backend.stream(rm.model, history, {
      onToken: (token) => {
        tokenCount++;
        if (!thinkParser) { pipeline.write(token); fullContent += token; return; }

        const chunks = thinkParser.feed(token);
        for (const chunk of chunks) {
          if (chunk.type === 'boundary') {
            if (chunk.text === 'open')  { inThinking = true;  thinkRend!.open(); }
            if (chunk.text === 'close') { inThinking = false; thinkRend!.close(); }
          } else if (chunk.type === 'thinking') {
            thinkRend!.write(chunk.text);
            thinkContent += chunk.text;
          } else {
            pipeline.write(chunk.text);
            fullContent += chunk.text;
          }
        }
      },
      // Only this call site applies generation params — other backend callers
      // (Web UI, compare, benchmark, compression) keep their own defaults.
      generation: generation ? { ...generation } : undefined,
      signal: ac.signal,
    });

    if (thinkParser) {
      const rem = thinkParser.flush();
      for (const c of rem) {
        if (c.type === 'content') { pipeline.write(c.text); fullContent += c.text; }
      }
      if (inThinking) thinkRend!.close();
    }

    await pipeline.end();
    process.removeListener('SIGINT', sigint);

    const elapsed = Date.now() - start;
    const tps     = (tokenCount / Math.max(elapsed / 1000, 0.001)).toFixed(0);
    const dur     = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed/1000).toFixed(1)}s`;
    const bCol    = BADGE_COLORS[rm.backend.info.id] ?? SD;
    const glyph   = GLYPHS[rm.backend.info.id] ?? '';

    console.log();
    console.log(`  ${SD}◦  ${SD}${tokenCount} tok${R}  ${SD}${dur}${R}  ${CY}${tps} tok/s${R}  ${bCol}${glyph} ${rm.model.name}${R}`);

    // Persist to storage
    const trimmed = fullContent.trim();
    if (trimmed) {
      storage.addMessage(chatId, 'assistant', trimmed, tokenCount, thinkContent || undefined);
      storage.recordUsage(rm.backend.info.id, rm.model.id, tokenCount);
    }

    return trimmed;

  } catch (err: any) {
    await pipeline.end();
    process.removeListener('SIGINT', sigint);
    if (!ac.signal.aborted) {
      console.log();
      console.log(`  ${RE}✗ Error:${R} ${SD}${err.message}${R}\n`);
    }
    return null;
  }
}

export function goodbye(): void {
  console.log(`\n${V}  ◈${R} ${SD}arc — by The Architect. Until next time.${R}\n`);
}
