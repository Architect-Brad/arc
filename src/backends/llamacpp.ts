// ─────────────────────────────────────────────────────────────────────────────
// backends/llamacpp.ts — llama.cpp backend
//
// Two modes:
//   1. Adopt an already-running llama-server (default: localhost:8080,
//      or the port/host passed to the constructor).
//   2. Spawn llama-server ourselves on demand:
//      • detects the binary via `command -v llama-server`
//      • discovers *.gguf models (config defaults.llamacppModelDir, else
//        ~/models, ~/gguf, ~/.local/share/llama-models, ~/llama.cpp/models,
//        and the working directory)
//      • starts the server on a free port, waits for /health, and kills
//        the child when arc exits
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import * as net  from 'net';
import { spawn, ChildProcess } from 'child_process';
import { Backend, BackendInfo, ArcModel, ArcMessage, StreamOptions, makeModel } from './base';
import { expandHome, discoverGgufModels, whichBin, extractSize, extractQuant } from './gguf';

/** Reserve an ephemeral localhost port for a server we spawn */
function freePort(): Promise<number> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(8080));
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class LlamaCppBackend implements Backend {
  readonly info: BackendInfo = {
    id:          'llamacpp',
    name:        'llama.cpp',
    description: 'Local inference via llama-server (auto-spawns or adopts a running one)',
    icon:        '[▲]',
    color:       [251, 146, 60],
  };

  private host: string;
  private port: number;
  private explicit: boolean;

  // Server we spawned (if any) — killed when arc exits
  private spawned:      ChildProcess | null = null;
  private spawnedModel: string | null       = null;
  private spawnedPort:  number | null       = null;

  constructor(host?: string, port?: number) {
    this.explicit = host !== undefined || port !== undefined;
    this.host = host ?? 'localhost';
    this.port = port ?? 8080;
    const cleanup = () => this.killSpawned();
    process.on('exit', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('SIGHUP', cleanup);
  }

  // ── Detection ─────────────────────────────────────────────────────────────

  private async serverHealthy(host = this.host, port = this.port): Promise<boolean> {
    try {
      const res  = await this.get('/health', host, port);
      const data = JSON.parse(res);
      return data.status === 'ok' || data.status === 'no slot available' || !!data.status;
    } catch { return false; }
  }

  /** Installed = a healthy server is reachable, or we can spawn one ourselves */
  async isAvailable(): Promise<boolean> {
    if (await this.serverHealthy(this.host, this.port)) return true;
    if (this.explicit) return false;           // explicit target only — don't spawn elsewhere
    return whichBin('llama-server') !== null;
  }

  // ── Model listing ─────────────────────────────────────────────────────────

  async listModels(): Promise<ArcModel[]> {
    // A healthy server takes precedence — ask it what it's serving
    if (await this.serverHealthy(this.host, this.port)) {
      return this.serverModels(this.host, this.port);
    }
    // No server — discover on-disk .gguf models so the user can pick one
    if (whichBin('llama-server') === null) return [];
    return discoverGgufModels().map(m => ({ ...m, backend: 'llamacpp' }));
  }

  private async serverModels(host: string, port: number): Promise<ArcModel[]> {
    try {
      // llama-server exposes the loaded model via /props
      const raw  = await this.get('/props', host, port);
      const props = JSON.parse(raw);
      const modelPath: string = props.default_generation_settings?.model ?? props.model_path ?? 'llama.cpp model';
      const modelName = modelPath.split('/').pop()?.replace(/\.(gguf|bin|ggml)$/i, '') ?? modelPath;

      // Also try OpenAI-compat /v1/models
      try {
        const modRaw  = await this.get('/v1/models', host, port);
        const modData = JSON.parse(modRaw);
        if (modData.data?.length) {
          return modData.data.map((m: any) => makeModel({
            id:      m.id,
            name:    m.id.split('/').pop()?.replace(/\.(gguf|bin)$/i, '') ?? m.id,
            backend: 'llamacpp',
            family:  'llama.cpp',
            raw:     m.id,
          }));
        }
      } catch { /* fall through to single model */ }

      return [makeModel({
        id:      modelName,
        name:    modelName,
        backend: 'llamacpp',
        family:  'llama.cpp',
        size:    extractSize(modelName),
        quant:   extractQuant(modelName),
        raw:     modelPath,
      })];
    } catch { return []; }
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  async stream(model: ArcModel, messages: ArcMessage[], opts: StreamOptions): Promise<void> {
    // Model backed by an on-disk .gguf → ensure a server is serving it
    const gguf = this.ggufFor(model);

    if (!gguf) {
      // No local file — use the configured/assumed server as-is
      if (this.explicit || await this.serverHealthy(this.host, this.port)) {
        return this.streamHttp(this.host, this.port, model, messages, opts);
      }
      throw new Error(`llama-server: model "${model.id}" is not a local .gguf and no server is running on :${this.port}`);
    }

    // Already serving this exact model from our spawned server?
    if (this.spawnedPort && this.spawnedModel === gguf && await this.serverHealthy('localhost', this.spawnedPort)) {
      return this.streamHttp('localhost', this.spawnedPort, model, messages, opts);
    }

    // Adopt an already-running server if it is serving this file
    if (await this.adoptIfMatches(gguf)) {
      return this.streamHttp(this.host, this.port, model, messages, opts);
    }

    // Otherwise spawn our own on a free port
    const bin = whichBin('llama-server');
    if (!bin) throw new Error('llama-server is not installed (or not on PATH)');
    const port = await this.ensureSpawned(bin, gguf);
    return this.streamHttp('localhost', port, model, messages, opts);
  }

  /** If the model looks like a local .gguf, return its absolute path */
  private ggufFor(model: ArcModel): string | null {
    const candidates = [model.raw, model.id].filter((s): s is string => typeof s === 'string' && s.length > 0);
    for (const c of candidates) {
      if (/\.gguf$/i.test(c) && fs.existsSync(c)) return path.resolve(c);
      const expanded = expandHome(c);
      if (/\.gguf$/i.test(expanded) && fs.existsSync(expanded)) return path.resolve(expanded);
    }
    return null;
  }

  /** Is the external/default server healthy AND serving this .gguf? */
  private async adoptIfMatches(gguf: string): Promise<boolean> {
    if (!(await this.serverHealthy(this.host, this.port))) return false;
    const base = path.basename(gguf, '.gguf');
    try {
      const modRaw  = await this.get('/v1/models', this.host, this.port);
      const modData = JSON.parse(modRaw);
      if (modData.data?.some((m: any) =>
        typeof m.id === 'string' && (m.id.includes(base) || m.id.includes(gguf)))) {
        return true;
      }
    } catch {
      try {
        const raw  = await this.get('/props', this.host, this.port);
        const props = JSON.parse(raw);
        const mp: string = props.default_generation_settings?.model ?? props.model_path ?? '';
        return mp.includes(base) || mp.includes(gguf);
      } catch { /* fall through — adopt anyway, err on the side of not spawning */ }
      return true;
    }
    return false;
  }

  private async ensureSpawned(bin: string, gguf: string): Promise<number> {
    this.killSpawned(); // different model — restart
    const port = await freePort();

    this.spawned = spawn(bin, ['-m', gguf, '--host', '127.0.0.1', '--port', String(port)], {
      stdio: 'ignore',
      env:   { ...process.env },
    });
    this.spawned.on('error', () => { /* surfaced via health timeout below */ });
    this.spawnedModel = gguf;
    this.spawnedPort  = port;

    // Large models take a while to load — poll /health for up to 180s
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (this.spawned.exitCode !== null) {
        const code = this.spawned.exitCode;
        this.killSpawned();
        throw new Error(`llama-server exited with code ${code} while loading ${path.basename(gguf)}`);
      }
      if (await this.serverHealthy('localhost', port)) return port;
      await sleep(500);
    }
    this.killSpawned();
    throw new Error(`llama-server did not become ready within 180s while loading ${path.basename(gguf)}`);
  }

  private killSpawned(): void {
    if (this.spawned) {
      try { this.spawned.kill('SIGTERM'); } catch { /* best effort */ }
    }
    this.spawned = null;
    this.spawnedModel = null;
    this.spawnedPort  = null;
  }

  private streamHttp(host: string, port: number, model: ArcModel, messages: ArcMessage[], opts: StreamOptions): Promise<void> {
    const gen = opts.generation;
    const payload: Record<string, any> = {
      model:    model.id,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream:   true,
    };
    if (gen) {
      if (typeof gen.temperature === 'number') payload.temperature = gen.temperature;
      if (typeof gen.topP === 'number')       payload.top_p       = gen.topP;
      if (typeof gen.seed === 'number')       payload.seed        = gen.seed;
    }
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: host,
          port,
          path:     '/v1/chat/completions',
          method:   'POST',
          timeout:  120_000,
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
            if (opts.signal?.aborted) { req.destroy(); return; }
            buf += chunk;
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.replace(/^data:\s*/, '').trim();
              if (!trimmed || trimmed === '[DONE]') continue;
              try {
                const parsed = JSON.parse(trimmed);
                const token: string = parsed.choices?.[0]?.delta?.content ?? '';
                if (token) opts.onToken(token);
                if (parsed.choices?.[0]?.finish_reason === 'stop') opts.onDone?.();
              } catch { /* skip */ }
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

  private get(path: string, host = this.host, port = this.port): Promise<string> {
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
