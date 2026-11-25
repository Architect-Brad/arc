// ─────────────────────────────────────────────────────────────────────────────
// backends/llamacli.ts — llama-cli (pipe) backend
//
// Spawns `llama-cli` per message in single-turn, non-interactive mode and
// streams only the model's reply through arc's renderer. No server, no ports,
// no background process — the model loads for each message (slow but nothing
// else gets in the way of your terminal).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Backend, BackendInfo, ArcModel, ArcMessage, StreamOptions } from './base';
import { expandHome, discoverGgufModels, whichBin } from './gguf';

// ── llama-cli output hygiene ──────────────────────────────────────────────────
// Guard 1: Some builds write the coloured banner to stdout even with
//          --log-disable. Strip ANSI before classifying a line so a coloured
//          "build : ..." is still recognised as noise.
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

// Guard 2: Whole-line banner / interactive prompt-echo signatures. Matched at
//          the start of a line, case-insensitively. These lines are dropped
//          before any text reaches onToken().
const NOISE_LINE = /^((?:build|model|ftype|type|modalities|system_info|sampling|params|llama_[a-z_]*|ggml[a-z_]*|logical_bridge|main)\s*:|available\s+commands\s*:|using\s+(?:custom\s+)?system\s+prompt|>|\[(?:start|end)\s+of\s+(?:thinking|reasoning|prompt|assistant))/i;

// Guard 3: While a line is still a *prefix* of one of the signatures above we
//          hold it back instead of emitting it. Once the line grows past the
//          prefix (e.g. "because ..." is not "build ...") it is released to
//          the renderer. This keeps first-token streaming intact.
const NOISE_PREFIXES = [
  'build', 'model', 'ftype', 'type', 'modalities', 'system_info', 'sampling',
  'params', 'llama_model_loader', 'llama_context', 'llama_kv_cache',
  'llama_memory', 'ggml', 'logical_bridge', 'main',
  'available commands:', 'using custom system prompt', 'using system prompt',
  '>', '[start of', '[end of',
];

type LineDecision = 'drop' | 'wait' | 'emit';

function classifyLine(rawLine: string): LineDecision {
  const s = rawLine.replace(ANSI_ESCAPE, '').trimStart().toLowerCase();
  if (s === '') return 'wait';                  // blank / leading whitespace
  if (NOISE_LINE.test(s)) return 'drop';        // definitely banner or prompt echo
  // Ignore trailing whitespace: "build " must still look like the start of
  // "build : ..." instead of being released as reply text.
  const prefix = s.replace(/\s+$/, '');
  for (const p of NOISE_PREFIXES) {
    if (p.startsWith(prefix)) return 'wait';    // might still become a banner line
  }
  return 'emit';                                // real reply text
}

/**
 * Streaming stdout filter. Banners arrive as complete newline-terminated
 * lines before the reply; the reply itself streams character by character.
 * Lines identified as noise are discarded in full, reply text is forwarded
 * as soon as it is unambiguous (so streaming latency is unaffected).
 */
function makeReplyParser(
  onText: (text: string) => void,
  onReplySeen: () => void,
): { push(chunk: string): void; flush(): void } {
  let pending  = '';       // bytes of the current, not-yet-released line
  let emitting = false;    // current line is reply -> forward chars immediately

  const deliver = (text: string): void => {
    if (!text) return;
    onReplySeen();
    onText(text);
  };

  return {
    push(chunk: string): void {
      let out = '';
      for (const ch of chunk) {
        if (emitting) {
          // Already inside the reply: forward everything, reset at newline.
          out += ch;
          if (ch === '\n') emitting = false;
          continue;
        }
        if (ch === '\n') {
          // Undecided/suppressed line ended: discard it (banner/prompt echo).
          pending = '';
          continue;
        }
        pending += ch;
        const decision = classifyLine(pending);
        if (decision === 'emit') {
          out += pending;
          pending = '';
          emitting = true;
        }
        // 'drop' / 'wait' both keep buffering until the terminating newline.
      }
      deliver(out);
    },

    flush(): void {
      // A reply with no trailing newline is still a reply.
      if (emitting && pending) deliver(pending);
      pending = '';
      emitting = false;
    },
  };
}

export class LlamaCliBackend implements Backend {
  readonly info: BackendInfo = {
    id:          'llamacli',
    name:        'llama-cli (pipe)',
    description: 'One-shot pipe mode via llama-cli — no server, no background process',
    icon:        '[>]',
    color:       [245, 158, 11],
  };

  async isAvailable(): Promise<boolean> {
    return whichBin('llama-cli') !== null;
  }

  async listModels(): Promise<ArcModel[]> {
    if (whichBin('llama-cli') === null) return [];
    return discoverGgufModels().map(m => ({ ...m, backend: 'llamacli' }));
  }

  async stream(model: ArcModel, messages: ArcMessage[], opts: StreamOptions): Promise<void> {
    const bin = whichBin('llama-cli');
    if (!bin) throw new Error('llama-cli is not installed (or not on PATH)');

    const gguf = this.resolveModel(model);
    if (!gguf) {
      throw new Error(`llama-cli: model "${model.id}" is not a local .gguf file`);
    }

    const prompt = buildPrompt(messages);
    const sys    = systemPrompt(messages);

    const args = [
      '-m', gguf,
      '-p', prompt,
      '-st',                       // single turn — llama.cpp documents -st + -p as non-interactive
      '--no-display-prompt',       // stdout = the reply, not prompt + reply
      '--log-disable',             // keep stderr/stdout free of log spam
      // DELIBERATELY NO `-r` / `--reverse-prompt` HERE.
      // llama.cpp defines -r as "halt generation at PROMPT, return control in
      // interactive mode". Passing it re-enables conversation mode even with
      // -st, which is what prints the banner, "available commands:" and the
      // "> <prompt>" echo. In genuine one-shot mode generation ends at EOS;
      // there is no next user turn to halt at, so -r is both harmful and
      // unnecessary. Removing it is the fix for the interactive-mode leak.
    ];
    if (sys) args.push('-sys', sys);
    // Generation flags are version-dependent — only send what the caller set.
    const gen = opts.generation;
    if (gen) {
      if (typeof gen.temperature === 'number') args.push('--temp',  String(gen.temperature));
      if (typeof gen.topP === 'number')       args.push('--top-p', String(gen.topP));
      if (typeof gen.seed === 'number')       args.push('--seed',  String(Math.trunc(gen.seed)));
    }

    return new Promise((resolve, reject) => {
      const proc: ChildProcess = spawn(bin, args, {
        // stdin : ignored  -> there must be no interactive input channel
        // stdout: piped    -> this is the reply channel we parse below
        // stderr: ignored  -> llama-cli's build/model/timing banners and logs
        //                     live here; rendering them would pollute the chat
        stdio: ['ignore', 'pipe', 'ignore'],
        env:   { ...process.env },
      });

      let gotOutput = false;       // set only for real reply text, never for banner-only stdout
      let timedOut  = false;       // distinguish a timeout kill from a clean exit

      // Guard 4: hard cap on a stalled/hung child. If it fires, report a
      // timeout explicitly instead of mislabelling it "produced no output".
      const killTimer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, 180_000);

      const parser = makeReplyParser(
        (text) => opts.onToken(text),
        ()    => { gotOutput = true; },
      );

      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', (chunk: string) => {
        if (opts.signal?.aborted) return;
        parser.push(chunk);
      });

      opts.signal?.addEventListener('abort', () => proc.kill('SIGTERM'));

      proc.on('error', (e) => {
        clearTimeout(killTimer);
        opts.onError?.(e);
        reject(e);
      });

      proc.on('close', (code) => {
        clearTimeout(killTimer);
        parser.flush();
        if (opts.signal?.aborted) { resolve(); return; }
        if (timedOut) {
          const err = new Error('llama-cli timed out after 180s');
          opts.onError?.(err);
          reject(err);
          return;
        }
        if (code !== 0) {
          const err = new Error(`llama-cli exited with code ${code}`);
          opts.onError?.(err);
          reject(err);
          return;
        }
        if (!gotOutput) {
          // Exit 0 but no reply text survived the banner filter — a real
          // failure (e.g. empty/EOF stdin or a model that emitted nothing).
          const err = new Error('llama-cli produced no output');
          opts.onError?.(err);
          reject(err);
          return;
        }
        opts.onDone?.();
        resolve();
      });
    });
  }

  /** If the model points at a local .gguf, return its absolute path */
  private resolveModel(model: ArcModel): string | null {
    const candidates = [model.raw, model.id].filter((s): s is string => typeof s === 'string' && s.length > 0);
    for (const c of candidates) {
      if (/\.gguf$/i.test(c) && fs.existsSync(c)) return path.resolve(c);
      const expanded = expandHome(c);
      if (/\.gguf$/i.test(expanded) && fs.existsSync(expanded)) return path.resolve(expanded);
    }
    return null;
  }
}

/**
 * llama-cli pipe mode is single-turn. For multi-turn chats we render the
 * history as a transcript into the prompt and tell the model to continue it.
 */
function buildPrompt(messages: ArcMessage[]): string {
  const convo = messages.filter(m => m.role !== 'system');

  if (convo.length <= 1) {
    return convo[convo.length - 1]?.content ?? '';
  }

  const transcript = convo
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  return (
    'The following is a conversation transcript. Reply with only the assistant\'s ' +
    'next message — no "User:" or "Assistant:" prefix, no role labels, no commentary.\n\n' +
    transcript +
    '\nAssistant:'
  );
}

function systemPrompt(messages: ArcMessage[]): string | undefined {
  const sys = messages.find(m => m.role === 'system');
  return sys ? sys.content : undefined;
}
