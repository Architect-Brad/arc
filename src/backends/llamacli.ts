// ─────────────────────────────────────────────────────────────────────────────
// backends/llamacli.ts — llama-cli (pipe) backend
//
// Spawns `llama-cli` per message in single-turn, non-interactive mode and
// streams its raw stdout through arc's renderer. No server, no ports, no
// background process — the model loads for each message (slow but nothing
// else gets in the way of your terminal).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Backend, BackendInfo, ArcModel, ArcMessage, StreamOptions } from './base';
import { expandHome, discoverGgufModels, whichBin } from './gguf';

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
      '-st',                       // single turn — don't enter conversation mode
      '--no-display-prompt',       // stdout = the reply, not prompt + reply
      '--log-disable',             // keep stderr/stdout free of log spam
      '-r', '\nUser:',             // halt if the model starts simulating the next turn
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
        stdio: ['ignore', 'pipe', 'ignore'],
        env:   { ...process.env },
      });

      let gotOutput = false;
      const killTimer = setTimeout(() => proc.kill('SIGTERM'), 180_000);

      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', (chunk: string) => {
        if (opts.signal?.aborted) return;
        gotOutput = true;
        opts.onToken(chunk);
      });

      opts.signal?.addEventListener('abort', () => proc.kill('SIGTERM'));

      proc.on('error', (e) => {
        clearTimeout(killTimer);
        opts.onError?.(e);
        reject(e);
      });

      proc.on('close', (code) => {
        clearTimeout(killTimer);
        if (opts.signal?.aborted) { resolve(); return; }
        if (code !== 0) {
          const err = new Error(`llama-cli exited with code ${code}`);
          opts.onError?.(err);
          reject(err);
          return;
        }
        if (!gotOutput) {
          // Non-zero not detected, but nothing was printed either — treat as failure
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
