// ─────────────────────────────────────────────────────────────────────────────
// backends/ollama.ts — Ollama backend
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import { Backend, BackendInfo, ArcModel, ArcMessage, StreamOptions, makeModel } from './base';
import { config } from '../config';

export class OllamaBackend implements Backend {
  readonly info: BackendInfo = {
    id:          'ollama',
    name:        'Ollama',
    description: 'Run LLMs locally via Ollama',
    icon:        '[◉]',
    color:       [255, 255, 255],
  };

  private host: string;
  private port: number;
  private explicit: boolean;

  constructor(host?: string, port?: number) {
    this.explicit = host !== undefined || port !== undefined;
    this.host = host ?? 'localhost';
    this.port = port ?? 11434;
  }

  /** Explicit constructor args win; otherwise fall back to config's defaults.ollamaHost */
  private eff(): { host: string; port: number } {
    if (this.explicit) return { host: this.host, port: this.port };
    try {
      const raw = config.get().defaults.ollamaHost?.trim();
      if (raw) {
        const clean = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const [h, p] = clean.split(':');
        const port = parseInt(p ?? '', 10);
        return { host: h || 'localhost', port: isNaN(port) ? 11434 : port };
      }
    } catch { /* malformed config — fall through */ }
    return { host: this.host, port: this.port };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.get('/');
      return res.includes('Ollama');
    } catch { return false; }
  }

  async listModels(): Promise<ArcModel[]> {
    try {
      const raw = await this.get('/api/tags');
      const data = JSON.parse(raw);
      return (data.models ?? []).map((m: any) => makeModel({
        id:      m.name,
        name:    m.name,
        backend: 'ollama',
        size:    m.details?.parameter_size ?? formatBytes(m.size),
        quant:   m.details?.quantization_level ?? '',
        family:  m.details?.family ?? '',
        raw:     m,
      }));
    } catch { return []; }
  }

  async stream(model: ArcModel, messages: ArcMessage[], opts: StreamOptions): Promise<void> {
    const { host, port } = this.eff();
    const gen = opts.generation;
    const payload: Record<string, any> = { model: model.id, messages, stream: true };
    if (gen) {
      const options: Record<string, number> = {};
      if (typeof gen.temperature === 'number') options.temperature = gen.temperature;
      if (typeof gen.topP === 'number')       options.top_p       = gen.topP;
      if (typeof gen.seed === 'number')       options.seed        = gen.seed;
      if (Object.keys(options).length > 0) payload.options = options;
    }
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: host, port, path: '/api/chat',
          method: 'POST', timeout: 120_000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (opts.signal?.aborted) { req.destroy(); return; }
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const token: string = parsed.message?.content ?? '';
                if (token) opts.onToken(token);
                if (parsed.done) opts.onDone?.();
              } catch { /* skip malformed */ }
            }
          });
          res.on('end', resolve);
          res.on('error', (e) => { opts.onError?.(e); reject(e); });
        }
      );
      req.on('error', (e) => { opts.onError?.(e); reject(e); });
      opts.signal?.addEventListener('abort', () => req.destroy());
      req.write(body);
      req.end();
    });
  }

  private get(path: string): Promise<string> {
    const { host, port } = this.eff();
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: host, port, path, timeout: 5000 },
        (res) => {
          let data = '';
          res.on('data', (c: string) => data += c);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
    });
  }
}

function formatBytes(n: number): string {
  if (!n) return 'unknown';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}MB`;
  return `${n}B`;
}
