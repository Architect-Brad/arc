// ─────────────────────────────────────────────────────────────────────────────
// ollama.ts — Ollama REST API client (zero dependencies)
// Connects to localhost:11434 by default
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';

export interface OllamaModel {
  name:       string;
  size:       number;
  modified_at: string;
  details?: {
    family:     string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaChatMessage {
  role:    'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaStreamChunk {
  model:   string;
  message: OllamaChatMessage;
  done:    boolean;
}

export interface OllamaConfig {
  host?: string;
  port?: number;
  timeout?: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class OllamaClient {
  private host: string;
  private port: number;
  private timeout: number;

  constructor(cfg: OllamaConfig = {}) {
    this.host    = cfg.host    ?? 'localhost';
    this.port    = cfg.port    ?? 11434;
    this.timeout = cfg.timeout ?? 120_000;
  }

  /** Check if Ollama is running */
  async isRunning(): Promise<boolean> {
    try {
      const res = await this.get('/');
      return res.includes('Ollama');
    } catch {
      return false;
    }
  }

  /** List available models */
  async listModels(): Promise<OllamaModel[]> {
    const raw = await this.get('/api/tags');
    const data = JSON.parse(raw);
    return (data.models ?? []) as OllamaModel[];
  }

  /**
   * Stream a chat completion.
   * Calls onToken for each streamed text chunk.
   * Returns the full assembled response.
   */
  async chat(
    model:    string,
    messages: OllamaChatMessage[],
    onToken:  (token: string) => void,
    onDone?:  () => void,
  ): Promise<string> {
    const body = JSON.stringify({ model, messages, stream: true });
    return new Promise((resolve, reject) => {
      let full = '';

      const req = http.request(
        {
          hostname: this.host,
          port:     this.port,
          path:     '/api/chat',
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
            buf += chunk;
            // Ollama sends one JSON object per line
            const lines = buf.split('\n');
            buf = lines.pop() ?? ''; // keep incomplete last line

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed: OllamaStreamChunk = JSON.parse(line);
                const token = parsed.message?.content ?? '';
                if (token) {
                  full += token;
                  onToken(token);
                }
                if (parsed.done) {
                  onDone?.();
                }
              } catch {
                // ignore malformed lines
              }
            }
          });

          res.on('end', () => resolve(full));
          res.on('error', reject);
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timed out'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Stream a raw generate completion (single prompt, no chat history).
   */
  async generate(
    model:   string,
    prompt:  string,
    onToken: (token: string) => void,
  ): Promise<string> {
    const body = JSON.stringify({ model, prompt, stream: true });
    return new Promise((resolve, reject) => {
      let full = '';

      const req = http.request(
        {
          hostname: this.host,
          port:     this.port,
          path:     '/api/generate',
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const token: string = parsed.response ?? '';
                if (token) { full += token; onToken(token); }
              } catch { /* skip */ }
            }
          });

          res.on('end', () => resolve(full));
          res.on('error', reject);
        }
      );

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
      req.write(body);
      req.end();
    });
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private get(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: this.host, port: this.port, path, timeout: 5000 },
        (res) => {
          let data = '';
          res.on('data', (c: string) => data += c);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format model size in human-readable form */
export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
  return `${bytes}B`;
}
