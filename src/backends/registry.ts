// ─────────────────────────────────────────────────────────────────────────────
// backends/registry.ts — Backend registry + auto-detection
// ─────────────────────────────────────────────────────────────────────────────

import { Backend, ArcModel } from './base';
import { OllamaBackend }     from './ollama';
import { LlamaCppBackend }   from './llamacpp';
import { LlamaCliBackend }   from './llamacli';

export interface ResolvedModel {
  model:   ArcModel;
  backend: Backend;
}

// All backends in priority order
const ALL_BACKENDS: Backend[] = [
  new OllamaBackend(),
  new LlamaCppBackend(),
  new LlamaCliBackend(),
];

// Singleton cache
let _available: Backend[]  | null = null;
let _models:    ResolvedModel[] | null = null;

// ── Registry ──────────────────────────────────────────────────────────────────

export const registry = {

  /** Detect all available backends in parallel */
  async detectBackends(force = false): Promise<Backend[]> {
    if (_available && !force) return _available;

    const results = await Promise.allSettled(
      ALL_BACKENDS.map(async (b) => ({ backend: b, ok: await b.isAvailable() }))
    );

    _available = results
      .filter((r): r is PromiseFulfilledResult<{ backend: Backend; ok: boolean }> =>
        r.status === 'fulfilled' && r.value.ok)
      .map(r => r.value.backend);

    return _available;
  },

  /** Load all models from all available backends */
  async loadAllModels(force = false): Promise<ResolvedModel[]> {
    if (_models && !force) return _models;

    const backends = await registry.detectBackends(force);

    const modelLists = await Promise.allSettled(
      backends.map(async (b) => {
        const models = await b.listModels();
        return models.map(m => ({ model: m, backend: b }));
      })
    );

    _models = modelLists
      .filter((r): r is PromiseFulfilledResult<ResolvedModel[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    return _models;
  },

  /** Get models for a specific backend id */
  async modelsFor(backendId: string): Promise<ResolvedModel[]> {
    const all = await registry.loadAllModels();
    return all.filter(r => r.backend.info.id === backendId);
  },

  /** Find the backend that handles a given CLI command name */
  backendForCommand(cmd: string): Backend | undefined {
    const map: Record<string, string> = {
      ollama:        'ollama',
      llama:         'llamacpp',
      'llama-server': 'llamacpp',
      'llama.cpp':    'llamacpp',
      'llama-cli':    'llamacli',
    };
    const backendId = map[cmd.toLowerCase()];
    if (!backendId) return undefined;
    return ALL_BACKENDS.find(b => b.info.id === backendId);
  },

  /** Find a specific model by name across all backends */
  async findModel(name: string): Promise<ResolvedModel | undefined> {
    const all = await registry.loadAllModels();
    return all.find(r =>
      r.model.id === name ||
      r.model.name.toLowerCase() === name.toLowerCase() ||
      r.model.id.startsWith(name)
    );
  },

  /** Invalidate cache */
  reset() {
    _available = null;
    _models    = null;
  },
};

export { ALL_BACKENDS };
export type { Backend, ArcModel };
