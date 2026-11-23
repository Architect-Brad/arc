// ─────────────────────────────────────────────────────────────────────────────
// compress.ts — Smart context compression
//
// When context window hits 75%, silently summarises older messages and
// replaces them with a compact summary. The model never hits the limit.
// ─────────────────────────────────────────────────────────────────────────────

import { ArcMessage } from './backends/base';
import { ResolvedModel } from './backends/registry';
import { ansi } from './ansi';

const VF = ansi.fg(196, 181, 253);
const SD = ansi.fg(100, 116, 139);
const R  = ansi.reset;

export const COMPRESS_THRESHOLD = 0.75; // compress when 75% full
export const KEEP_RECENT        = 4;    // always keep last N message pairs

/**
 * Check if compression is needed and run it.
 * Returns the (possibly compressed) history and a notice string if it ran.
 */
export async function maybeCompress(
  history:     ArcMessage[],
  usedTokens:  number,
  maxTokens:   number,
  rm:          ResolvedModel,
): Promise<{ history: ArcMessage[]; notice: string | null }> {
  if (maxTokens === 0) return { history, notice: null };
  const pct = usedTokens / maxTokens;
  if (pct < COMPRESS_THRESHOLD) return { history, notice: null };

  // Identify messages to compress (all except system + last KEEP_RECENT pairs)
  const systemMsgs  = history.filter(m => m.role === 'system');
  const chatMsgs    = history.filter(m => m.role !== 'system');
  const keepCount   = KEEP_RECENT * 2; // pairs → messages
  const toCompress  = chatMsgs.slice(0, Math.max(0, chatMsgs.length - keepCount));
  const toKeep      = chatMsgs.slice(Math.max(0, chatMsgs.length - keepCount));

  if (toCompress.length < 2) return { history, notice: null };

  // Build the summarisation prompt
  const transcript = toCompress
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  const summaryPrompt = `Summarise this conversation concisely in 3-5 bullet points. Preserve key facts, decisions, and context. Be brief.\n\n${transcript}\n\nSummary:`;

  let summary = '';
  try {
    await rm.backend.stream(
      rm.model,
      [{ role: 'user', content: summaryPrompt }],
      { onToken: (t) => { summary += t; } },
    );
  } catch {
    // If compression fails, just return original — not fatal
    return { history, notice: null };
  }

  summary = summary.trim();
  if (!summary) return { history, notice: null };

  // Replace compressed messages with a summary system message
  const summaryMsg: ArcMessage = {
    role:    'system',
    content: `[Earlier conversation summary]\n${summary}`,
  };

  const newHistory = [...systemMsgs, summaryMsg, ...toKeep];

  const notice = `${VF}⟨ context compressed — ${toCompress.length} messages → summary ⟩${R}`;
  return { history: newHistory, notice };
}

/**
 * Estimate token count of a message array.
 * Uses the 3.8 chars/token heuristic.
 */
export function estimateHistoryTokens(history: ArcMessage[]): number {
  return Math.ceil(
    history.reduce((acc, m) => acc + m.content.length, 0) / 3.8
  );
}
