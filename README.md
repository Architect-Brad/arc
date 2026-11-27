[![CI](https://github.com/Architect-Brad/arc/actions/workflows/ci.yml/badge.svg)](https://github.com/Architect-Brad/arc/actions/workflows/ci.yml)

# arc

**The terminal LLM platform nobody asked for but everyone needed.**

Built by The Architect. Runs on Linux. Runs on Android. Looks better than your IDE.
Ships with easter eggs. Has had four input box rewrites. Is not finished.
Will never be finished. Is shipping anyway.

### Branding

arc draws its own face now: a curved bridge over a block-letter `arc`, with a
green prompt caret and a tagline. Run `arc --logo` for the ANSI version, or
`arc logo --ascii` for the plain-ASCII one that works in any terminal. A single
diamond glyph was considered for the job and politely shown the door — it kept
staring at people and never said anything useful. No emojis were invited back.

```
|======================================================|
|                    ______________                    |
|               __/                  \__               |
|             /                          \             |
|            |    ####   #####    #####   |            |
|            |   ##  ##  ##  ##  ##       |            |
|            |   ######  #####   ##    >_ |            |
|            |   ##  ##  ##  ##  ##       |            |
|            |   ##  ##  ##  ##   #####   |            |
|             \__________________________/             |
|                terminal llm platform                 |
|======================================================|
```

---

## What arc actually is

You came here expecting a markdown renderer.

You found a streaming LLM client with three backends, a dual-mode
per-character/per-word typewriter engine, a Rust-powered ANSI pipeline,
split-pane model comparison, a self-hosted web UI, a benchmark suite,
a persona system, context window tracking with auto-compression, chat
persistence with auto-naming, a filesystem picker, a custom web scraper,
shell hooks that intercept Ollama and llama-cli, KDE integration,
Termux support, and easter eggs.

This is what happens when you say "I'll just make a quick markdown renderer"
and nobody stops you.

---

## Install

**Prerequisites:** Node.js 18 or newer. You also need *something that runs
models* — Ollama, `llama-server`, or `llama-cli`. arc renders and manages
those; it does not ship a model. Pick a backend, then install arc.

**One-line install (Linux / Termux):**
```bash
curl -fsSL https://raw.githubusercontent.com/Architect-Brad/arc/master/install-remote.sh | bash
```

Yes, it pipes a script from the internet into bash. So does half of Termux.
Read it first if you're that kind of person. It clones into lowercase `~/arc`
(the capital-A path was a real bug that broke people), then runs the same
`install.sh` as the manual steps below. Re-run it any time to update.

**Linux / KDE:**
```bash
git clone https://github.com/Architect-Brad/arc.git arc
cd arc
bash install.sh
source ~/.bashrc
```

**Android (Termux):**
```bash
pkg install nodejs git
cd ~
git clone https://github.com/Architect-Brad/arc.git arc
cd ~/arc
bash install.sh
```

**Important:** arc must live in your Termux home directory (`~/arc`).
Termux's filesystem is sandboxed. Paths outside `~` (`/sdcard`, `/data/...`)
don't have the right permissions for execution. The installer writes to
`$PREFIX/bin/arc` which is in Termux's PATH. If you put arc anywhere else,
the shell hooks will write the wrong path into your `.bashrc` and nothing
will work. You'll know because typing `arc` will say "command not found"
despite the installer saying it succeeded. Put it in `~`. It's not negotiable.

arc detects Termux automatically via `$TERMUX_VERSION` or `$PREFIX`.
Skips KDE and systemd. Uses `$PREFIX/bin`. Works in Termux's terminal.
The web UI works in Android browser at `http://localhost:7070`.
It shouldn't work this well. It does anyway.

**Termux quick setup (copy-paste this entire block):**
```bash
pkg update && pkg install nodejs git rust
cd ~
git clone https://github.com/Architect-Brad/arc.git arc
cd ~/arc
bash install.sh
source ~/.bashrc
arc
```

The `rust` package is optional but gives you the native core.
First Rust compile takes ~5 minutes on Android. Worth it.

**npm (if you already live in npm):**
```bash
npm install -g @architect-brad/arc
```
The npm package omits the native Rust/C++ binaries, so arc falls back to the
TypeScript renderer. That renderer works fine -- you just lose the native
speed path. Want the native cores? Use the git install above.

To update: re-run the one-line curl installer (it pulls and re-runs
`install.sh`), or do it by hand: `cd ~/arc && git pull && bash install.sh`.
Idempotent, replaces hooks, recompiles core.

**iOS:**

No.

Apple does not allow user-installed terminal emulators with meaningful
filesystem access. There is no package manager. There is no shell.
The only "terminal" apps on iOS are severely sandboxed or require a
jailbreak, neither of which arc supports or endorses.

If you want arc on a mobile device, get an Android phone and install Termux.
If you already have an iPhone and want arc on it, the answer is still Android.

We are not being difficult. The platform genuinely cannot run arc.
Node.js requires filesystem access. Termux-style environments require
Linux syscalls. iOS provides neither in an accessible way.

If Apple ever ships a real terminal with real POSIX support, we will
reconsider. We are not holding our breath.

---

## Quick start

```bash
arc                          # open arc (resume picker → model picker → chat)
arc --model qwen2.5-coder    # skip the picker
arc compare                  # two models, one prompt, side by side
arc serve                    # web UI at http://localhost:7070
arc benchmark --suite full   # find your fastest model
arc config                   # show configuration
arc wiki                     # read the manual you actually have
arc --logo                   # print the logo (diamonds need not apply)
arc logo --ascii             # same logo, no color, any terminal
arc --help                   # the full list
```

---

## Typewriter modes

arc ships with two streaming animation modes. Switch anytime:

```
/typing char      per-character — cinematic, each letter appears individually
/typing word      per-word — buffers tokens until word boundary, feels like typing
/typing instant   no animation
```

**char mode** uses an ANSI-safe character iterator — escape sequences are
atomic units, never split mid-sequence. Punctuation-aware pausing:
`.!?` → 90ms, `,;:` → 30ms, newlines → 15ms.

**word mode** buffers incoming tokens until whitespace. `'He'+'ll'+'o '` holds
until the space arrives, then emits `'Hello'` as one unit. Feels like a fast
typist rather than a printer.

Both modes fall back to instant in non-TTY environments (pipes, scripts).

---

## Backends

| Backend | Glyph | Detection | Notes |
|---|---|---|---|
| Ollama | `[◉]` | `localhost:11434` | Local models. The main event. |
| llama.cpp | `[▲]` | `llama-server` on PATH or running | Auto-spawns `llama-server` (free port, `.gguf` pick) or adopts a healthy one on `:8080` |
| llama-cli | `[>]` | `llama-cli` on PATH | One-shot pipe mode, no server — streams raw tokens through the renderer |

The Ollama backend talks HTTP to a local server you run yourself — local
models with no renderer of their own. The llama.cpp pair loads `.gguf`
models directly from disk (config `defaults.llamacppModelDir`, or the
well-known dirs `~/models`, `~/gguf`, `~/.local/share/llama-models`,
`~/llama.cpp/models`, or `.`). `[▲]` keeps a persistent `llama-server`
alive for the session; `[>]` spawns `llama-cli` per message (loads the
model every turn — slower, but nothing holds your terminal or a port).

The cloud/CLI-wrapper backends (Claude Code, Qwen, OpenCode, Copilot)
were dropped in v1.9.0 — each of those ships its own rendering interface,
and wrapping one in another is just two TUIs arguing. Use them directly.

No emojis. Pure ASCII. Renders identically in Konsole, Alacritty, kitty,
tmux, and Termux. The emoji question was settled in v1.4.1. It wasn't pretty.

---

## Chat commands

```
/help              show all commands
/typing <mode>     char · word · instant
/persona <name>    switch persona (/persona list for options)
/persona new <n>   scaffold a custom persona template
/model             return to model picker
/clear             wipe history
/retry             resend last message
/undo              remove last exchange
/system <text>     set system prompt
/temp 0.7          temperature, 0..2 (session only)
/top-p 0.9         nucleus sampling, 0..1 (session only)
/seed 42           fixed integer seed (session only)
/gen               show current generation settings
/save              export to markdown
/copy              copy last response (wl-copy / xclip / xsel)
/tokens            session token count
/chats             recent chat sessions
/wiki              open this manual (also: arc wiki from a shell)
/joke              one free joke, no model involved
/settings          full-screen settings pane
/exit              leave
```

**The new toys.** `/wiki` (or `arc wiki` from a shell) opens the shipped
`WIKI.md` — a manual that lives in the repo instead of on a wiki nobody can
find. `/joke` prints one of 60+ locally stored one-liners; the model is not
consulted, because it already has enough opinions. `/settings` opens a
full-screen pane in the alternate screen buffer — Up/Down to move, Space/Enter
to toggle or cycle, `q` or Escape to leave. Every change saves immediately, so
there is no save button and no pretending. `/help` also got an expansion: it now
lists slash commands, @-commands, code-block keys, and personas, which is what
a help command should have been doing all along.

**Generation parameters.** `/temp`, `/top-p`, `/seed` and `/gen` control how
the *current chat session* samples tokens. Values survive `/retry` and every
message in that chat, then vanish when you leave — arc is a renderer with the
memory of a goldfish, not a configuration file. To start every session with a
value, set `defaults.temperature`, `defaults.topP` or `defaults.seed` in
`~/.config/arc/config.toml` (`arc config set defaults.topP 0.9` works too).
The settings travel to Ollama as `options`, to llama-server as top-level JSON,
and to `llama-cli` as flags — each backend gets its own dialect, because of
course it does.

Shell hooks are a different animal. `arc --install` hooks Ollama and
`llama-cli`; hooked invocations go through `arc --pipe`, which renders text
that some other program already generated. No backend is called, no sampling
happens, and `/gen` has nothing to say. Ask the hooked CLI about its own
sampling flags. The hook is a renderer, not a genie.

**@-commands** inject context before the message hits the model:

```
@file:path          → opens filesystem picker, attach selected file
@url:https://...    → custom scraper fetches + extracts text
@paste              → clipboard contents
@cwd                → directory tree (max depth 2)
@system:You are...  → inline system context
```

The `@file:` picker is a full arrow-key filesystem navigator. Appears as
an overlay above the input box. Filter by typing, Tab to complete, Enter
to select, Esc to cancel. Because typing full paths is 1995 behaviour.

The `@url:` scraper is custom. Zero dependencies. Handles redirects (8 hops),
gzip/deflate/brotli, extracts main content from HTML (`<article>` preferred),
pretty-prints JSON, passes through plain text. 512KB cap. 12s timeout.
It was faster to write correctly than to debug a library.

---

## Personas

```
/persona assistant    default — accurate and direct
/persona coder        code first, explanations optional
/persona explain      teacher mode, first principles
/persona debate       steel-mans both sides, has opinions
/persona shell        Linux expert, shows exact commands
/persona review       brutal code reviewer, finds every flaw
/persona brainstorm   10+ ideas fast, quantity over quality
/persona concise      one paragraph max, no filler
```

Custom personas: `~/.config/arc/personas/name.toml`

```toml
description = "My persona"
icon        = "◇"

[system]
You are a senior distributed systems architect.
You have strong opinions about CAP theorem.
You have seen what happens when people ignore it.
You would like to not see it again.
```

---

## The Markdown Engine

arc's inline renderer is a single-pass tokeniser, not a chain of regex
replacements. Correct precedence. Handles nested formatting. Supports:

| Syntax | Result |
|---|---|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `***bolditalic***` | ***bolditalic*** |
| `~~strike~~` | ~~strikethrough~~ |
| `` `code` `` | `inline code` |
| `==highlight==` | highlighted text |
| `[[Ctrl+C]]` | keyboard key style |
| `$x^2 + y^2$` | math (rendered as ⟨x^2 + y^2⟩) |
| `[link](url)` | link with URL |
| `:rocket:` | 🚀 |
| `\*escaped\*` | literal asterisk |

Tables support word-wrapped cells — long content flows across multiple
display rows within the same table row. The borders line up correctly.
This took more effort than it should have.

Syntax highlighting covers: JavaScript, TypeScript, Python, Rust, Go,
Java, C/C++, Bash, SQL, JSON, HTML, CSS. The highlighter is in both the
Rust core and the TypeScript fallback.

Thinking blocks (`<think>...</think>`) render as a collapsible dimmed
section with a live spinner during streaming. Collapses to a summary
when `</think>` arrives. Supported automatically for QwQ, DeepSeek-R1,
Claude extended thinking.

---

## Easter eggs

There are easter eggs. We're not going to tell you all of them.

Some starting points:
- `arc matrix`
- `arc manifesto`
- `arc vs glow`
- `arc speedrun`
- `the architect`
- `what is arc`
- `how many rewrites`

These are handled before the message reaches the model. The model never
knows they happened. This is probably fine.

---

## The Rust core

`core/arc_core_rs` — compiled Rust, ships with arc.

Handles the streaming hot path: ANSI measurement, markdown tokenizer,
syntax highlighter state machine, word wrapper, context window tracker.
All zero-allocation. Runs as a persistent child process with a
line-delimited JSON protocol.

Announces itself: `{"r":"pong","engine":"rust"}`

Falls back transparently to C++ (`core/arc_core`) then TypeScript.
You will not notice the fallback. The TS implementation is correct.
It is just slightly less fast at 180 tokens/second where the difference
is immeasurable.

Install Rust for native speed: `cargo` on Linux, `pkg install rust` on Termux.

---

## Context window tracking

```
████░░░░░░░░░░░░░░░░░░░░░░░░  4700/131072  4%
```

Green → yellow → red. At 75%, arc silently compresses old messages into
a bullet-point summary. You see:

```
⟨ context compressed — 18 messages → summary ⟩
```

And the conversation continues. The model never hits the limit.
You never have to think about it. This was the goal.

Context sizes are estimated per model family. They're close enough.
QwQ/Qwen2.5/llama3: 131K. Claude: 200K. Mistral: 32K. Gemma: 8K.
If the estimate is wrong, file an issue. Or don't. The compression
handles it either way.

---

## Honorary bugs

These bugs existed. They are gone. They are remembered.

**The Multiplying Box** (v1.3–1.5)
Every keystroke spawned a new input box below the previous one. Typing
"hello" produced six stacked boxes, one per character. The user described
it as "genuinely concerning and persistent." They were correct. The root
cause was mixing relative cursor movement with mid-line cursor positioning.
The fix was an invariant. The four rewrites were educational.

**The Scroll Cliff** (v1.4)
`\x1b7`/`\x1b8` (DEC save/restore) stores absolute row numbers. When the
terminal scrolled, the saved row was off-screen. RESTORE teleported to
the shadow realm. New boxes spawned at row 0 of the visible terminal.
The screenshots were haunting. The fix was relative geometry.

**The Silent Send** (v1.6 web UI)
Clicking Send in the web UI did nothing. No error, no response, no
indication. The WebSocket frame decoder didn't handle fragmented TCP
delivery. Browser frames are always masked. The incomplete buffer was
silently discarded. Fixed with a proper frame accumulator. Three test
cases pass.

**The Emoji Incident** (v1.4)
The picker was rendering 🦙 🔥 🧠 as backend icons. In some terminals
these rendered as wide characters, broke column alignment, and made the
picker look like a children's menu. Replaced with ASCII block art.
The decision was unanimous. It was not actually unanimous.

**The Great Operator Precedence War** (multiple versions)
`a ?? b || c` is ambiguous in TypeScript strict mode. This error appeared
in at least three separate files across four versions. Each time it
was fixed. Each time a new file added it. The lesson was not learned.
It was eventually learned.

**The Speed Illusion** (v1.8.0)
arc was reported as "30% slower than glow." Investigation revealed arc renders
at 45,400 lines/second in instant mode. glow renders at approximately 10,000.
The "slower" arc was running in per-character animation mode with intentional
80ms pauses between characters. The reporter was correct that it was slower.
They were benchmarking a typewriter against a laser printer and concluding the
typewriter was defective. The bug was real. The analysis was wrong. Both things
are true. The honorary status stands for the confusion it caused and the
thorough investigation it required. Node.js startup overhead (200ms) remains
a legitimate complaint and is being addressed separately.

**The Gzip That Wasn't** (v1.7 scraper)
The custom web scraper initially didn't check `Content-Encoding` before
piping the response. Gzip-compressed pages returned binary garbage. The
fix required adding brotli support too, because of course some servers
use brotli. Three decompression paths. Two lines of code each. Fine.

---

## Hard features

These were not easy. Here is an honest account.

**The streaming markdown pipeline**
The hard part isn't rendering markdown. It's rendering markdown
incrementally as tokens arrive, without waiting for a complete block.
The `BlockAccumulator` maintains state across token boundaries — you
might get `"```py"` in one token and `"thon"` in the next. The pipeline
handles this. It took careful design. It works.

**The thinking block renderer**
Models like QwQ emit `<think>...</think>` around their reasoning. The
renderer must detect the opening tag mid-stream, switch to a dimmed
display mode, animate a spinner, buffer the thinking content, then
collapse it all when `</think>` arrives. This runs entirely on the
streaming token path with no buffering delay. The tag detection handles
partial tags split across token boundaries.

**Per-character ANSI-safe animation**
ANSI escape sequences can be many bytes long. A naive character-by-character
iterator splits them in the middle, producing garbage. The `ansiUnits`
generator in `typewriter.ts` identifies complete escape sequences and
yields them as atomic units. Each code unit (including multi-byte UTF-8)
is handled correctly. The delay only applies to visible characters.

**The WebSocket implementation**
Hand-rolled. 80 lines. Handles masked and unmasked frames, three payload
length encodings (7-bit, 16-bit, 64-bit), and fragmented TCP delivery.
The frame accumulator maintains a buffer across `data` events and peels
off complete frames. It was faster to write correctly from scratch.
This is a recurring pattern in this codebase.

**Context auto-compression**
When context hits 75%, arc fires a background summarisation call to the
same model, replaces old messages with the summary, and continues. This
runs on the same backend connection as the main conversation. The hard
part is estimating token counts accurately enough to trigger at the right
time without false positives. The 3.8 chars/token heuristic is crude but
empirically correct for English text with most tokenisers.

**The filesystem picker**
A full arrow-key directory navigator as an input box overlay. Suspends
raw input mode, launches the picker, re-attaches input when done. The
tricky part is that the input box is itself in raw mode — you have to
release it, run the picker (which needs its own raw mode), then
re-establish the original handler. The state machine for this is
more complex than it looks.

---

## Architect's notes

**On the input box:**
It took four rewrites. The problem is that every terminal cursor
positioning strategy has a failure mode. `readline` is too limited.
`ansi.up(N)` drifts after scroll. `\x1b7/\x1b8` stores absolute row
numbers that become stale when the terminal scrolls. The solution was
an invariant: after every draw, the cursor is always at column 1 of the
line immediately below the box. This is maintained by the geometry of
`UP(n) + CLR + write + \n`, which is scroll-safe because it's relative.
The visual cursor `▋` is drawn as a character in the box content.
The real terminal cursor hides below the box and never moves during typing.
This is now correct. It has been correct since v1.6. Please stop finding
bugs in it.

**On the comparison with glow:**
glow renders static markdown files. arc is a full LLM platform.
This comparison comes up regularly. We understand why — the original
pitch was "a better glow." The original pitch was wrong within the first
week. Comparing arc to glow is now like comparing a database to `cat`.
We're not angry about it. We're just noting it for the record.

**On zero dependencies:**
arc has `sql.js` for chat storage. That's it. Everything else — the
WebSocket server, the web scraper, the HTTP server, the TOML parser,
the Rust IPC bridge, the syntax highlighter, the markdown renderer,
the ANSI engine — is written from scratch. This was a deliberate
choice. Dependencies have upgrade cycles. Dependencies have breaking
changes. Dependencies have their own bugs. Arc has its own bugs.
At least we know where they are.

**On Termux:**
The Architect still does not own an Android device. He does have reports
from the field now — arc has been used on Termux with real LFM2.5 models,
and it holds up. The key insight is that Termux is just Linux with a
different path layout (`$PREFIX` instead of `/usr`) and no systemd.
`install.sh` detects `$TERMUX_VERSION` and adjusts. The web UI works —
it's just HTTP. The rest is fine too, apparently. He's still not buying
a phone. Field reports and bug reports both welcome.

**On the easter eggs:**
Yes, there's a matrix animation. Yes, there's a speedrun. Yes, typing
"the architect" in the chat gets a response that doesn't go to the model.
This took about an hour to write. The input box took four rewrites and
three versions. The easter eggs work perfectly on the first try.
No further comment.

**On shipping:**
arc started as a weekend project. It is now 7,500+ lines of TypeScript,
Rust, and C++ across 35 source files. It has three backends, two native
cores, a web UI, a benchmark suite, a persona system, and easter eggs.
The original goal was "render markdown from ollama output."
That goal was achieved in version 0.1.
Everything since then has been scope creep.
Magnificent, necessary scope creep.

---

## Release notes

### v1.10.0

**The manual, the jokes, and the control panel**
- `arc wiki` / `/wiki` — a 1,400-line manual ships with arc. No pager, no
  network, no "see the website." It is right there, and it renders through
  the same engine as everything else
- `/joke` — 63 original jokes, because a terminal that never laughs is just
  a keyboard with ambitions. Occasional jokes also appear at chat startup;
  turn them off with `ui.jokes = false` in config or in settings
- `/settings` — a full-screen TUI pane. Toggle typewriter, compact mode,
  stats, context bar, and jokes; cycle speed and generation defaults. Nine
  rows, arrow keys, space to change, `q` to leave. Everything saves as you
  go, which is more than we can say for most of our life choices
- Expanded `/help` — grouped, scannable, and warmer. The old help was a list;
  this one has sections and opinions
- The overall tone is lighter. The Architect still has opinions, but now
  delivers them with a small smile

### v1.9.0

**Backends reworked**
- llama.cpp is now a first-class native backend. Detection checks the
  terminal (`command -v llama-server`), discovers `.gguf` models on disk
  (config `defaults.llamacppModelDir`, else `~/models`, `~/gguf`,
  `~/.local/share/llama-models`, `~/llama.cpp/models`, `.`), spawns
  `llama-server` itself on a free port, waits for `/health` in the
  background, and kills the child on exit. An already-healthy server gets
  adopted instead — verified against the model by `/v1/models`
- New **llama-cli (pipe)** backend (`[>]`). One-shot `llama-cli` invocations
  stream raw tokens through the renderer — no server, no background
  process, nothing holding your terminal or a port. Multi-turn history is
  rendered into the prompt as a transcript
- Shell hook: `llama-cli` invocations with `-p` / `--prompt` / `-st` are
  piped through `arc --pipe`; interactive sessions pass through untouched
- Dropped Claude Code, Qwen, OpenCode and Copilot backends — each ships
  its own TUI, and wrapping one in another is two renderers arguing

**New: native `arc-render` fast path**
- Standalone Rust binary (`core/arc_render`) renders `--pipe`/`--render`
  in ~30ms with ~4MB RSS — no Node runtime on the output hot path
- `--pipe` / `--render` use it automatically; falls back to the TS renderer
  silently on Termux and unusual mounts

**Generation parameters that actually do something**
- `/temp`, `/top-p`, `/seed` and `/gen` now reach all three backends — Ollama
  as `options`, llama-server as top-level JSON, llama-cli as flags. `/temp`
  was previously a no-op: it took your number, thanked you, and threw it away
- Values are session-scoped, survive `/retry`, and can be seeded from config
- Hooked CLI calls go through `--pipe` and are unaffected. They generate
  nothing. This is by design, not an oversight

**Fixes**
- `--speed` is now honored for `--pipe` / `--render` (was parsed, never applied)
- ANSI stripping no longer leaks cursor-control sequences (CSI final bytes)
- `arc --pipe` no longer crashes when the native binary can't be spawned
  (e.g. `noexec` mounts) — falls back to the TS engine
- Wide tables: cells now word-wrap across multiple display rows instead of
  hiding overflowing columns
- `config set defaults.ollamaHost` actually works (backend reads it)
- `arc_render` gained 75 unit tests and survived a multi-byte input panic.
  Divider widths and table wrapping now match the TS renderer, right down to
  the pixels we can measure
- Post-removal cleanup: dead backend references, unused imports, and stale
  help text purged. `config set` now preserves declared types instead of
  turning everything into a string

### v1.7.0
- Per-character typewriter mode (`/typing char`) — ANSI-safe, each unit atomic
- Per-word typewriter mode (`/typing word`) — buffers until word boundary
- `/typing` command to switch modes at runtime
- Easter eggs: `arc matrix`, `arc manifesto`, `arc vs glow`, `arc speedrun` and more
- Top-tier inline markdown engine — single-pass tokeniser, correct precedence
- Highlight (`==text==`), keyboard keys (`[[Ctrl+C]]`), math inline (`$expr$`)
- Emoji shortcodes (`:rocket:`, `:warning:`, etc.)
- Termux/Android support in `install.sh` and `hooks.ts`
- Table cell word-wrapping — long content flows across display rows
- `@file:` filesystem picker overlay
- Custom web scraper for `@url:` — zero deps, gzip/brotli, HTML extraction
- Web UI send bug fixed (WebSocket frame accumulator)
- Status toast in web UI

### v1.6.1
- Input box rewrite #4 — invariant-based, scroll-safe, provably correct
- Visual cursor `▋` drawn in box content, terminal cursor hidden below

### v1.6.0
- Config system: `~/.config/arc/config.toml`
- Persona system: 8 built-ins + `~/.config/arc/personas/*.toml`
- `arc benchmark` — TTFT + tok/s + reliability scoring
- `/persona` command with autocomplete

### v1.5.0
- `arc compare` — split-pane dual-model streaming
- `arc serve` — local web UI via WebSocket
- Smart context compression at 75% fill
- Multi-line input (Shift+Enter)

### v1.4.x
- Rust core (`core/arc_core_rs`) — zero-alloc streaming engine
- Chat resume picker on startup
- Context window bar
- ASCII logos — no emojis (The Emoji Incident)

### v1.3.0
- SQLite chat storage with auto-naming
- `@file`, `@url`, `@paste`, `@cwd` commands

### v1.2.0
- `/command` autocomplete dropdown
- Thinking block renderer
- Code block action bar

### v1.1.x
- Multi-backend: llama.cpp (Claude Code, Qwen, OpenCode and Copilot added later, dropped in v1.9.0 — CLI-wrappers with their own TUIs shipped their own markdown rendering; arc wraps local servers instead)
- Two-level picker: backend → model
- Shell hooks for Ollama + llama-cli

### v1.0.0
- Ollama streaming, typewriter effect
- Model picker, KDE integration, C++ core

---

## Tips

**The fastest way to start:** set defaults in config. arc skips every
picker and opens straight to chat.

```bash
arc config set defaults.model qwen2.5-coder:0.5b
arc config set defaults.persona coder
arc config set defaults.speed 400      # typewriter speed (chars/sec)
```

**For long code sessions:** `/persona coder` + `/typing instant`.
The per-character animation is beautiful but you don't need it at 200 tok/s.

**For reading long responses:** `/typing char`. Slower, but you actually
read it instead of scrolling past a wall of text.

**For benchmarking new models:** `arc benchmark --suite full`.
The quick suite is 4 prompts. Full is 9, including code, JSON, reasoning,
creative writing. The score is not scientifically rigorous. It's directionally
correct, which is all you need for picking between local models.

**For the web UI:** `arc serve --host 0.0.0.0` exposes it to your network.
Useful for accessing your local models from a phone or tablet. The web UI
renders thinking blocks, supports all backends, and actually sends messages
now (fixed in v1.7.0).

**For Termux:** connect to a desktop Ollama server:
```bash
arc config set defaults.ollamaHost 192.168.1.x:11434
```
Your phone becomes a chat client for your desktop's GPU. This is
objectively cool and also slightly overkill.

---

## Developing

Build it, break it, rebuild it. That's the whole methodology.

```bash
npm install && npm run build
```

On a `noexec` FUSE mount like `/mnt/sdcard`, compiled binaries refuse to run
from the source tree. Build in a temp dir instead — `/tmp` is your friend.
This is a filesystem limitation, not an arc bug. We checked. Twice.

The Rust renderer has its own test suite:

```bash
cd arc-core-rs && CARGO_TARGET_DIR=/tmp/arc_render_tests CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=/data/data/com.termux/files/usr/bin/clang cargo test
```

75 tests for `arc_render`. They pass. They had better.

Contributors verify backends with stubs, not real models — nobody is
downloading a 30GB model to test a renderer. The stubs are honest about
being stubs. Mostly.

---

**arc v1.10.0 · Linux · KDE · Android (Termux) · Built by The Architect**

*The input box is fixed.*
*Please stop finding bugs in it.*
*We know you will anyway.*

---

## v1.8.0 release notes

### Fixes

**All broken slash commands restored** — `/persona`, `/typing`, `/config`,
`/tokens`, `/temp`, `/export`, `/bench` were missing from the switch block
after a version merge. They are all back. Use `/examples` to see usage.

**Thinking blocks now always-on** — the model whitelist (qwq, deepseek-r1,
etc.) was too strict. `modelHasThinking()` now returns `true` for all models.
The parser costs nothing when `<think>` tags are absent (state stays `outside`).
Any model that emits thinking blocks now renders them correctly.

**`@paste` and `@commands` properly injected** — the AT command expansion
was stripping the `@paste` token from visible text but not injecting the
resolved content into the right position in the history. Fixed. The AI now
receives the full context. The display shows a summary line of what was attached.

**AI is now aware of @commands** — a system prompt is automatically injected
explaining the `<file>`, `<paste>`, `<url>`, `<cwd>` XML wrappers. The AI
treats attached context naturally instead of wondering what `<paste>` means.

**`[[kbd]]` no longer breaks GitHub badge links** — `[![badge](url)](url)` 
was being partially consumed by the keyboard key handler. Now guards against
`!`, `]`, `[` preceding the `[[`. GitHub READMEs render correctly.

**HTML block tags stripped** — `<details>`, `</details>`, `<summary>` etc.
from GitHub READMEs now silently discarded in both the parser and inline renderer.

**Action bar no longer leaks into output** — `[c] copy · [s] save` was
appearing as literal text after code blocks because `codeActionBar()` was
added to the rendered lines array which flows through the typewriter. Removed.
Code block actions will be re-implemented as a proper post-render interaction.

**Web UI clickable code buttons** — replaced text-based `[c] copy` action
bar with real buttons: `⎘ copy`, `↓ save`, `▶ run`. Copy uses base64-encoded
`data-code` attribute so it works correctly across rendering passes.

**Web UI ping/pong health check** — the server now responds to `{"type":"ping"}`
with `{"type":"pong","ts":timestamp}`. The UI pings every 20 seconds and shows
round-trip latency in the connection indicator. Use `node dist/test-webui.js`
to run automated WebSocket tests.

### Speed plan

**The honest truth about arc vs glow:**

Pure rendering throughput: arc = **45,400 lines/sec**. glow (Go) ≈ 5,000–15,000.
arc is faster at rendering. The benchmark is not close.

The 30% slower perception comes from **Node.js startup time** (~200ms).
glow is a compiled Go binary that starts in ~5ms. Node.js starts in ~180ms.
The rendering itself is not the problem.

**Fixes applied in v1.8.0:**
- `--pipe` and `--render` modes now always instant (no typewriter delays)
- `printLines()` batched into a single `stdout.write()` syscall
- Instant mode bypasses the async queue entirely — synchronous render path
- The Rust core handles hot-path operations at native speed

**What remains:** Node.js startup. Solutions considered:
- `arc-render` compiled Rust binary for static file rendering — DONE in v1.9.0,
  `--pipe`/`--render` use it automatically when `core/arc_render` is executable
- `#!/usr/bin/env -S node --experimental-vm-modules` with precompiled bytecode
- Persistent daemon mode that arc-cli talks to via IPC

For now: `cat file.md | arc --pipe` is the fast path. It is very fast.
The 200ms you notice is Node.js, not arc.

### Honorary bug: The Speed Illusion

Added to the honorary bugs section. arc was accused of being 30% slower
than glow. Investigation revealed arc renders at 45,400 lines/second.
glow renders at approximately 10,000 lines/second. The "slower" arc was
running in per-character animation mode, which has intentional delays.
In instant mode arc is faster. The bug was a mode configuration issue,
not a performance issue. The honorary status stands because the confusion
was real and the investigation was thorough.

---

## Platform notes

### Linux / KDE

The canonical platform. Everything works. If something doesn't work,
that's a bug. File it.

```bash
bash install.sh
source ~/.bashrc
```

### Android — Termux

arc works on Android via Termux. There are rules.

**The arc directory must live in Termux's home directory.**

```bash
# Correct
~/arc/

# Wrong — will fail with permission errors
/sdcard/arc/
/storage/emulated/0/arc/
~/Downloads/arc/   # if Downloads is symlinked to external storage
```

Termux's home is `$HOME` which resolves to `/data/data/com.termux/files/home`.
Everything outside that path runs into Android's storage permission model.
The install script puts the arc binary in `$PREFIX/bin` (Termux's `/usr/bin`
equivalent). That works. External storage does not.

```bash
# Setup
pkg install nodejs git
cd ~
git clone https://github.com/Architect-Brad/arc.git arc
cd arc
bash install.sh
# Source your shell config
source ~/.bashrc   # or restart Termux
arc --version
```

**Connecting to a desktop Ollama server from Termux:**

Your phone and desktop must be on the same network.

```bash
# On your desktop — make Ollama listen on all interfaces
OLLAMA_HOST=0.0.0.0 ollama serve

# Find your desktop's IP
ip addr show | grep "inet 192"

# In arc on Termux
arc config set defaults.ollamaHost 192.168.1.x:11434
```

arc's web UI (`arc serve`) works in Android browser. Open Chrome,
navigate to `http://localhost:7070`. Your local models are there.
This is genuinely useful. It also feels slightly illegal. It isn't.

**Termux-specific install notes:**
- arc skips KDE launcher and systemd (neither exist in Termux)
- Shell hooks work in bash and zsh (Termux ships both)
- The Rust core compiles with `pkg install rust` — first compile is slow on
  older phones, subsequent builds are cached
- Node.js via `pkg install nodejs` (or `nodejs-lts` if you prefer the
  slower-moving build — the installer mentions it too)

### iOS — Termux doesn't exist there

No.

iOS does not have Termux. iOS does not have a terminal with meaningful
filesystem access. iOS does not allow apps to run persistent background
processes. iOS does not let you install arbitrary binaries. iOS does not
want you to run a local LLM inference server.

There is iSH, which emulates an x86 Linux environment in userspace.
It is slow. It is limited. It requires significant configuration.
It will not run Ollama because Ollama requires native binary execution.
arc's Rust core will not compile because iSH's Alpine Linux environment
has dependency conflicts with the versions of llvm it ships.

You could potentially run arc in iSH in pure TS fallback mode,
connecting to a remote Ollama server. This would technically work.
The performance would be approximately what you'd expect from
emulating x86 on an A-series ARM chip through a userspace sandbox.

The Architect's position on iOS support:

> Apple controls what software you can run, how it runs, and when it runs.
> arc is a platform for running LLMs locally, privately, without asking
> permission. These two things are philosophically incompatible.
> Build arc on a device you own. iOS devices are licensed, not owned.
> The answer is no. The answer has always been no. The answer will
> continue to be no until Apple changes their policies, which they won't.

If you have an iPhone, the web UI (`arc serve`) works in Safari when
you're on the same network as a machine running arc. That's the iOS
experience. It's not bad. It's just not native.

Android users: you made the right choice.

---
