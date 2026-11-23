// ─────────────────────────────────────────────────────────────────────────────
// backends/base.ts — Unified backend interface
// Every LLM provider implements this contract
// ─────────────────────────────────────────────────────────────────────────────

export interface ArcModel {
  id:       string;       // unique identifier
  name:     string;       // display name
  size?:    string;       // "7B", "13B", "70B", "unknown"
  quant?:   string;       // "Q4_K_M", "f16", etc.
  family?:  string;       // "llama", "mistral", "qwen", etc.
  backend:  string;       // which backend owns this model
  raw?:     unknown;      // original API response
}

export interface ArcMessage {
  role:    'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamOptions {
  onToken:  (token: string) => void;
  onDone?:  () => void;
  onError?: (err: Error) => void;
  signal?:  AbortSignal;
  /** Per-call generation overrides. Optional: other callers keep backend defaults. */
  generation?: {
    temperature?: number;
    topP?:       number;
    seed?:       number;
  };
}

export interface BackendInfo {
  id:          string;      // "ollama" | "llamacpp" | "llamacli"
  name:        string;      // "Ollama" | "llama.cpp" | "llama-cli"
  description: string;
  icon:        string;      // Unicode glyph, no emoji
  color:       [number, number, number]; // RGB for ANSI
}

export interface Backend {
  readonly info: BackendInfo;

  /** Check if this backend is available on this system */
  isAvailable(): Promise<boolean>;

  /** List available models. Empty array = no models / not applicable */
  listModels(): Promise<ArcModel[]>;

  /**
   * Stream a response.
   * For chat-capable backends: uses full message history.
   * For pipe-mode backends (llama-cli): spawns the CLI and streams raw output.
   */
  stream(
    model:    ArcModel,
    messages: ArcMessage[],
    opts:     StreamOptions,
  ): Promise<void>;

  /** Optional: one-shot completion without history */
  complete?(prompt: string, model: ArcModel): Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function makeModel(partial: Partial<ArcModel> & { id: string; name: string; backend: string }): ArcModel {
  return {
    size:   'unknown',
    quant:  '',
    family: '',
    ...partial,
  };
}
