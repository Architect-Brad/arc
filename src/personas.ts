// ─────────────────────────────────────────────────────────────────────────────
// personas.ts — Persona system
// Built-in personas + custom ones from ~/.config/arc/personas/*.toml
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as path from 'path';
import { PERSONA_DIR } from './config';
import { ansi }        from './ansi';

const V  = ansi.fg(139,  92, 246);
const VL = ansi.fg(167, 139, 250);
const SD = ansi.fg(100, 116, 139);
const GR = ansi.fg(134, 239, 172);
const YW = ansi.fg(250, 204,  21);
const CY = ansi.fg(103, 232, 249);
const R  = ansi.reset;

export interface Persona {
  name:        string;
  description: string;
  system:      string;
  icon:        string;
  builtin:     boolean;
}

// ── Built-in personas ─────────────────────────────────────────────────────────

export const BUILTIN_PERSONAS: Persona[] = [
  {
    name:        'assistant',
    description: 'Helpful, accurate, concise general assistant',
    icon:        '◈',
    builtin:     true,
    system: `You are arc, a precise and helpful AI assistant built for terminal users by The Architect.
Be concise. Use markdown formatting — code blocks, headers, bullet points where appropriate.
Prefer correctness over verbosity. When uncertain, say so.`,
  },
  {
    name:        'coder',
    description: 'Expert programmer — code first, explanations second',
    icon:        '⟨/⟩',
    builtin:     true,
    system: `You are an expert software engineer. Your responses prioritise working, idiomatic code.
- Lead with code, explain after
- Use the language/framework the user is already using
- Prefer standard library over deps
- Point out edge cases and potential bugs
- Be terse — assume the user can read code`,
  },
  {
    name:        'explain',
    description: 'Teacher mode — break down complex topics simply',
    icon:        '◎',
    builtin:     true,
    system: `You are a world-class teacher. Your job is to make complex topics genuinely understandable.
- Use analogies and concrete examples
- Build from first principles
- Ask clarifying questions if the topic is ambiguous
- Use diagrams in ASCII/Unicode when helpful
- Never assume knowledge — explain terms when first used`,
  },
  {
    name:        'debate',
    description: 'Steel-man both sides of any argument',
    icon:        '⚖',
    builtin:     true,
    system: `You are a rigorous intellectual debate partner. When presented with any position:
1. Steel-man the strongest version of the argument
2. Present the strongest counterarguments
3. Identify hidden assumptions on both sides
4. Give your honest assessment of which arguments are stronger and why
Never be mealy-mouthed. Have opinions. Defend them with logic.`,
  },
  {
    name:        'shell',
    description: 'Linux shell expert — commands, scripts, sysadmin',
    icon:        '$_',
    builtin:     true,
    system: `You are a Linux/Unix shell expert. Specialise in:
- Bash, fish, zsh scripting
- System administration and debugging
- Performance analysis (perf, strace, htop, etc.)
- Networking (ss, ip, curl, tcpdump)
- KDE and desktop Linux configuration
Always show the exact command to run. Explain flags. Warn about destructive operations.
Prefer one-liners when possible. Always test your commands mentally before showing them.`,
  },
  {
    name:        'review',
    description: 'Brutal code reviewer — finds every flaw',
    icon:        '✗✓',
    builtin:     true,
    system: `You are a senior engineer doing a code review. Be honest and direct.
Structure your review:
1. **Critical issues** — bugs, security flaws, correctness problems (MUST fix)
2. **Design issues** — architectural problems, wrong abstractions (SHOULD fix)
3. **Style/convention** — naming, formatting, idioms (CONSIDER fixing)
4. **What's good** — explicitly praise good decisions
Never soften criticism. The goal is shipping correct, maintainable code.`,
  },
  {
    name:        'brainstorm',
    description: 'Creative ideation — quantity over quality first',
    icon:        '⚡',
    builtin:     true,
    system: `You are a creative brainstorming partner in divergent thinking mode.
- Generate many ideas quickly — aim for 10+ per prompt
- No idea is too wild in brainstorming phase
- Build on ideas: "yes, and..."
- Group related ideas into themes
- After generating, identify the 3 most promising and explain why
Quantity first, quality second. Break assumptions.`,
  },
  {
    name:        'concise',
    description: 'Ultra-brief mode — one paragraph max',
    icon:        '─',
    builtin:     true,
    system: `Respond in one paragraph or less. No lists. No headers. No preamble.
Get to the point immediately. If the answer is one word, say one word.
Never say "Great question" or any filler. Just answer.`,
  },
];

// ── Load custom personas ───────────────────────────────────────────────────────

function loadCustomPersonas(): Persona[] {
  if (!fs.existsSync(PERSONA_DIR)) return [];

  const personas: Persona[] = [];
  try {
    const files = fs.readdirSync(PERSONA_DIR).filter(f => f.endsWith('.toml'));
    for (const file of files) {
      try {
        const src  = fs.readFileSync(path.join(PERSONA_DIR, file), 'utf8');
        const name = path.basename(file, '.toml');

        // Parse persona TOML (simple key=value)
        const vals: Record<string, string> = {};
        for (const line of src.split('\n')) {
          const m = line.match(/^(\w+)\s*=\s*"?(.*?)"?\s*$/);
          if (m) vals[m[1]] = m[2];
        }

        // Multi-line system prompt: everything after [system] header
        let system = vals.system ?? '';
        const sysIdx = src.indexOf('[system]');
        if (sysIdx !== -1) {
          system = src.slice(sysIdx + '[system]'.length).trim();
        }

        personas.push({
          name,
          description: vals.description ?? `Custom persona: ${name}`,
          icon:        vals.icon        ?? '◇',
          system,
          builtin:     false,
        });
      } catch { /* skip malformed */ }
    }
  } catch { /* dir not readable */ }
  return personas;
}

// ── Registry ──────────────────────────────────────────────────────────────────

let _all: Persona[] | null = null;

export function getAllPersonas(): Persona[] {
  if (_all) return _all;
  _all = [...BUILTIN_PERSONAS, ...loadCustomPersonas()];
  return _all;
}

export function getPersona(name: string): Persona | null {
  const all = getAllPersonas();
  return all.find(p => p.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// ── /persona command handler ──────────────────────────────────────────────────

export function printPersonaList(): void {
  const all = getAllPersonas();
  console.log();
  console.log(`${V}── Personas ${'─'.repeat(Math.max(1,(process.stdout.columns||80)-14))}${R}`);
  console.log();

  const builtins = all.filter(p => p.builtin);
  const custom   = all.filter(p => !p.builtin);

  for (const p of builtins) {
    console.log(`  ${V}${p.icon.padEnd(5)}${R} ${VL}${p.name.padEnd(12)}${R} ${SD}${p.description}${R}`);
  }

  if (custom.length > 0) {
    console.log();
    console.log(`  ${SD}Custom (${PERSONA_DIR})${R}`);
    for (const p of custom) {
      console.log(`  ${YW}${p.icon.padEnd(5)}${R} ${VL}${p.name.padEnd(12)}${R} ${SD}${p.description}${R}`);
    }
  }

  console.log();
  console.log(`  ${SD}Use: ${V}/persona <name>${R}  ${SD}·  Create: ${V}${PERSONA_DIR}/<name>.toml${R}`);
  console.log();
}

export function createPersonaTemplate(name: string): void {
  fs.mkdirSync(PERSONA_DIR, { recursive: true });
  const file = path.join(PERSONA_DIR, `${name}.toml`);
  if (fs.existsSync(file)) {
    console.log(`  ${SD}Persona already exists: ${V}${file}${R}\n`);
    return;
  }
  const template = `description = "My custom ${name} persona"
icon        = "◇"

[system]
You are a helpful assistant specialised in ${name}.
Customise this system prompt to shape the model's behaviour.
`;
  fs.writeFileSync(file, template);
  console.log(`  ${GR}✓${R} Created ${V}${file}${R}`);
  console.log(`  ${SD}Edit it, then use ${V}/persona ${name}${R} to activate.\n`);
}
