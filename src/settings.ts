// ─────────────────────────────────────────────────────────────────────────────
// settings.ts — full-screen interactive settings pane for arc
//
// Runs in the alternate screen buffer so the chat scrollback is never touched.
// Every edit is persisted immediately through the config singleton.
// ─────────────────────────────────────────────────────────────────────────────

import { ansi } from './ansi';
import { config } from './config';

// ── palette ──────────────────────────────────────────────────────────────────

const V      = ansi.fg(139,  92, 246); // violet  (brand / keys)
const VL     = ansi.fg(167, 139, 250); // light violet (row labels)
const SD     = ansi.fg(100, 116, 139); // slate   (chrome / inactive)
const GR     = ansi.fg(134, 239, 172); // green   (active / set values)
const SEL_BG = ansi.bg(139,  92, 246); // selected-row highlight
const R      = ansi.reset;

const ENTER_ALT  = '\x1b[?1049h';
const LEAVE_ALT  = '\x1b[?1049l';
const CLEAR_HOME = '\x1b[2J\x1b[H';

// ── row model ────────────────────────────────────────────────────────────────

interface Row {
  label: string;
  valueText: () => string;
  positive: () => boolean;
  activate: () => void;
}

function makeToggle(
  label: string,
  read: () => boolean,
  write: (value: boolean) => void,
): Row {
  return {
    label,
    valueText: () => (read() ? 'on' : 'off'),
    positive: read,
    activate: () => write(!read()),
  };
}

type CycleFormat = (
  index: number,
  values: readonly number[],
  current: number | undefined,
) => string;

/**
 * A numeric row that cycles through `values`.
 * `unsetIndex` marks a sentinel slot that deletes the key instead of setting
 * a number (used by temperature / topP / seed).
 */
function makeCycle(
  label: string,
  values: readonly number[],
  unsetIndex: number | null,
  fallbackIndex: number,
  current: () => number | undefined,
  write: (value: number | undefined) => void,
  format: CycleFormat,
): Row {
  const currentIndex = (): number => {
    const value = current();
    if (value === undefined) return unsetIndex ?? fallbackIndex;
    const found = values.indexOf(value);
    return found >= 0 ? found : fallbackIndex;
  };

  return {
    label,
    valueText: () => format(currentIndex(), values, current()),
    positive: () => (unsetIndex === null ? true : currentIndex() !== unsetIndex),
    activate: () => {
      const next = (currentIndex() + 1) % values.length;
      write(next === unsetIndex ? undefined : values[next]);
    },
  };
}

// ── row definitions ──────────────────────────────────────────────────────────

function buildRows(): Row[] {
  const ui        = () => config.get().ui;
  const defaults  = () => config.get().defaults;

  // config.set() coerces numeric keys via Number(value); Number(undefined) is
  // NaN, so "unset" cannot go through set(). Mutate the live config object and
  // re-serialize instead — serializeTOML() skips undefined/absent keys.
  const unsetDefault = (key: 'temperature' | 'topP' | 'seed'): void => {
    const cfg = config.get();
    delete (cfg.defaults as any)[key];
    config.save();
  };
  const setDefault = (key: string, value: number): void => {
    config.set('defaults', key, value);
  };

  const speedValues = [80, 200, 400, 0] as const;
  const speedLabels = ['slow', 'normal', 'fast', 'instant'] as const;

  const speedFormat: CycleFormat = (index, values, current) => {
    if (current !== undefined && !values.includes(current)) {
      return `custom (${current})`;
    }
    return `${speedLabels[index]} (${values[index]})`;
  };

  const numberFormat: CycleFormat = (index, values, current) => {
    if (current !== undefined && !values.includes(current)) {
      return `custom (${current})`;
    }
    return index === 0 ? 'unset' : String(values[index]);
  };

  return [
    makeToggle('typewriter',
      () => ui().typewriter,
      (v) => config.set('ui', 'typewriter', v)),

    makeToggle('compact',
      () => ui().compact,
      (v) => config.set('ui', 'compact', v)),

    makeToggle('show_stats',
      () => ui().show_stats,
      (v) => config.set('ui', 'show_stats', v)),

    makeToggle('show_ctx',
      () => ui().show_ctx,
      (v) => config.set('ui', 'show_ctx', v)),

    // ui.jokes is being typed by another agent; read defensively for now.
    makeToggle('jokes',
      () => (ui() as any).jokes ?? true,
      (v) => config.set('ui', 'jokes', v)),

    makeCycle('speed', speedValues, null, 1,
      () => defaults().speed,
      (v) => { if (v !== undefined) setDefault('speed', v); },
      speedFormat),

    makeCycle('temperature', [NaN, 0.2, 0.4, 0.7, 1.0], 0, 0,
      () => defaults().temperature,
      (v) => (v === undefined ? unsetDefault('temperature') : setDefault('temperature', v)),
      numberFormat),

    makeCycle('topP', [NaN, 0.5, 0.8, 0.9, 1.0], 0, 0,
      () => defaults().topP,
      (v) => (v === undefined ? unsetDefault('topP') : setDefault('topP', v)),
      numberFormat),

    makeCycle('seed', [NaN, 1, 42, 1234], 0, 0,
      () => defaults().seed,
      (v) => (v === undefined ? unsetDefault('seed') : setDefault('seed', v)),
      numberFormat),
  ];
}

// ── rendering helpers (all operate on plain strings; width is in columns) ────

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

// `inner` is already fitted to (width - 4) visible columns and may contain
// ANSI codes — do NOT measure it with String.length here.
function boxLine(inner: string): string {
  return SD + '| ' + R + inner + SD + ' |' + R;
}

function hintLine(text: string, width: number): string {
  const fitted = fit(text, width).replace(/\[[^\]]*\]/g, (m) => V + m + SD);
  return SD + fitted + R;
}

function settingRow(row: Row, selected: boolean, inner: number, width: number): string {
  const marker = selected ? '◈' : ' ';
  const left   = `  ${marker} ${row.label}`;
  const right  = row.valueText();
  const gap    = inner - left.length - right.length;

  const plain = gap >= 1
    ? left + ' '.repeat(gap) + right
    : fit(left + ' ' + right, inner);

  if (selected) {
    // One solid violet band across the full line.
    return SEL_BG + ansi.white + ansi.bold + fit('| ' + plain + ' |', width) + R;
  }

  const colored = gap >= 1
    ? VL + left + R + ' '.repeat(gap) + (row.positive() ? GR : SD) + right + R
    : SD + plain + R;

  return boxLine(colored);
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Open the full-screen settings pane. Resolves when the user quits with
 * q / Escape (or aborts with Ctrl+C). All terminal state is restored in a
 * finally block, including raw mode, the data listener and the main screen.
 */
export async function openSettings(): Promise<void> {
  const stdin  = process.stdin;
  const stdout = process.stdout;
  const canRaw = stdin.isTTY === true && typeof stdin.setRawMode === 'function';
  const wasRaw = stdin.isRaw === true;

  const rows     = buildRows();
  let   selected = 0;
  let   closed   = false;
  let   finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = () => resolve(); });

  let pending  = '';
  let escTimer: ReturnType<typeof setTimeout> | null = null;

  const clearEscTimer = (): void => {
    if (escTimer !== null) {
      clearTimeout(escTimer);
      escTimer = null;
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearEscTimer();
    finish();
  };

  const render = (): void => {
    if (closed) return;
    const width = Math.max(1, process.stdout.columns ?? 80);
    const inner = Math.max(0, width - 4);

    const border = SD + '+' + '-'.repeat(Math.max(0, width - 2)) + '+' + R;
    const out: string[] = [
      CLEAR_HOME,
      '',
      border,
      boxLine(V + ansi.bold + fit('arc settings', inner) + R),
      boxLine(hintLine('Adjust arc defaults - every change saves immediately.', inner)),
      border,
    ];

    for (let i = 0; i < rows.length; i++) {
      out.push(settingRow(rows[i], i === selected, inner, width));
    }

    out.push(border);
    out.push(boxLine(hintLine(
      '[up/down] move  [space/enter] toggle/cycle  [q/esc] save & exit',
      inner,
    )));
    out.push(border);
    out.push('');

    stdout.write(out.join('\n'));
  };

  const handleKey = (key: string): void => {
    if (closed) return;
    switch (key) {
      case 'up':
      case 'k':
        selected = (selected - 1 + rows.length) % rows.length;
        render();
        break;
      case 'down':
      case 'j':
        selected = (selected + 1) % rows.length;
        render();
        break;
      case ' ':
      case '\r':
      case '\n': {
        const row = rows[selected];
        if (row) row.activate();
        render();
        break;
      }
      case 'q':
      case 'esc':
      case '\x03': // Ctrl+C
        close();
        break;
      default:
        break;
    }
  };

  // Escape bytes can arrive split across writes, so buffer and parse them.
  // A lone ESC is treated as the Escape key after a short grace period so
  // that ESC-prefixed arrow sequences are still recognised.
  const drain = (): void => {
    while (pending.length > 0 && !closed) {
      const code = pending.charCodeAt(0);

      if (code === 0x1b) {
        const csi = /^\x1b\[([A-Za-z])/.exec(pending) ?? /^\x1bO([A-Za-z])/.exec(pending);
        if (csi) {
          const letter = csi[1];
          const key = letter === 'A' ? 'up'
                    : letter === 'B' ? 'down'
                    : letter === 'C' ? 'right'
                    : letter === 'D' ? 'left'
                    : '';
          pending = pending.slice(csi[0].length);
          if (key) handleKey(key);
          continue;
        }
        if (pending.length === 1) break; // wait to disambiguate lone ESC
        pending = pending.slice(1);
        handleKey('esc');
        continue;
      }

      const ch = pending[0];
      pending = pending.slice(1);
      handleKey(ch);
    }

    if (pending.startsWith('\x1b') && !closed) {
      clearEscTimer();
      escTimer = setTimeout(() => {
        escTimer = null;
        if (closed || !pending.startsWith('\x1b')) return;
        pending = '';
        handleKey('esc');
      }, 50);
    } else {
      clearEscTimer();
    }
  };

  const onData = (data: Buffer | string): void => {
    if (closed) return;
    pending += String(data);
    drain();
  };

  try {
    stdout.write(ENTER_ALT + CLEAR_HOME + ansi.hideCursor);
    if (canRaw) stdin.setRawMode(true);
    stdin.on('data', onData);
    render();
    await done;
  } finally {
    closed = true;
    clearEscTimer();
    stdin.removeListener('data', onData);
    if (canRaw) stdin.setRawMode(wasRaw);
    stdout.write(ansi.showCursor + LEAVE_ALT);
  }
}
