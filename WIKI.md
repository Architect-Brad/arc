# arc wiki

**The complete manual for the terminal LLM platform nobody asked for but everyone needed.**

Version 1.10.0. Built by The Architect. Linux, KDE, Android (Termux).
No cloud. No account. No telemetry. No apology for the input box jokes.

This document ships with arc. Read it with `arc wiki` from a shell, or `/wiki`
from inside a chat. Both open this exact file. If your pager is missing, arc
prints it directly, because a manual that requires a manual is a design failure.

---

## Table of contents

1. [What arc is](#1-what-arc-is)
2. [Quick start](#2-quick-start)
3. [Installation](#3-installation)
4. [CLI reference](#4-cli-reference)
5. [Interactive chat](#5-interactive-chat)
6. [New in 1.10.0: wiki, jokes, settings, better help](#6-new-in-1100-wiki-jokes-settings-better-help)
7. [Backends in depth](#7-backends-in-depth)
8. [Generation parameters](#8-generation-parameters)
9. [Configuration reference](#9-configuration-reference)
10. [The markdown engine](#10-the-markdown-engine)
11. [Typewriter modes](#11-typewriter-modes)
12. [Personas, system prompts, compare, benchmark, web UI, storage](#12-personas-system-prompts-compare-benchmark-web-ui-storage)
13. [Shell hooks, KDE, Termux](#13-shell-hooks-kde-termux)
14. [Keyboard reference](#14-keyboard-reference)
15. [Troubleshooting and FAQ](#15-troubleshooting-and-faq)
16. [Architecture and contributing](#16-architecture-and-contributing)
17. [Easter eggs](#17-easter-eggs)

---

## 1. What arc is

arc is a streaming markdown renderer that grew into a terminal LLM platform.
It runs local models, renders their output as it arrives, and keeps the whole
conversation in a local database. Three backends, two native cores, one web UI,
one benchmark suite, and an input box that took four rewrites to get right.

The philosophy, stated plainly:

- **Renderer first.** The hard problem was never "call an LLM". It was
  rendering incomplete markdown, token by token, without waiting for a
  complete block. arc was born to solve that and never stopped.
- **Local by default.** Ollama, llama.cpp server, and llama-cli all talk to
  models on your machine (or on a machine you point them at). There is no
  cloud backend, no API key, no account, and no network call to anyone else.
  The cloud/CLI-wrapper backends were removed in v1.9.0: each ships its own
  rendering interface, and wrapping one TUI in another is two renderers
  arguing in a small room.
- **Terminal-native.** Pure ASCII output, fixed-width tables, ANSI-safe
  animation. It renders identically in Konsole, Alacritty, kitty, tmux, and
  Termux. The emoji question was settled in v1.4.1. It was not pretty.
- **Zero-dependency where it counts.** One runtime dependency (`sql.js` for
  SQLite). The WebSocket server, scraper, HTTP server, TOML parser, markdown
  engine, syntax highlighter, and Rust IPC bridge are written from scratch.
  Dependencies have upgrade cycles. arc has its own bugs. At least we know
  where they are.
- **Never finished.** arc is shipping anyway. This is not a roadmap; it is a
  personality trait.

If you expected a markdown renderer and got a platform, you are in the right
place. That is how all of this started.

---

## 2. Quick start

```bash
arc                          # resume picker, model picker, chat
arc --backend ollama         # skip backend detection
arc --model qwen2.5-coder    # skip the model picker
arc compare                  # two models, one prompt, side by side
arc serve                    # web UI at http://localhost:7070
arc benchmark --suite full   # find your fastest local model
arc config                   # show configuration
arc wiki                     # this document
arc --help                   # the full list
```

The fastest path to zero pickers: set defaults once.

```bash
arc config set defaults.model qwen2.5-coder:0.5b
arc config set defaults.backend ollama
arc config set defaults.persona coder
arc config set defaults.speed 400
arc                          # straight to chat
```

Inside chat, type `/help` for commands, `/wiki` for this manual, `/settings`
for the full-screen settings pane, and `/joke` when the model is taking itself
too seriously.

---

## 3. Installation

### 3.1 Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node.js 18+ | Runs the TypeScript TUI | `node --version` |
| npm | Installs `sql.js`, builds `dist/` | `npm --version` |
| A local model server or CLI | Provides inference | `command -v ollama` / `command -v llama-server` / `command -v llama-cli` |
| rustc + cargo (optional) | Native core and `arc-render` fast path | `cargo --version` |
| g++ (optional) | C++ fallback core | `g++ --version` |
| bash or zsh | Shell hooks | `echo $SHELL` |

The native cores are optional. arc falls back to the TypeScript engine, and it
will tell you which engine is active at startup. A missing compiler is not a
broken install.

### 3.2 Linux / KDE

```bash
git clone https://github.com/Architect-Brad/arc.git
cd arc
bash install.sh
source ~/.bashrc          # or reopen the terminal
arc --version
```

The installer:

1. Checks for Node.js.
2. Runs `npm install` and `npm run build` in the source tree.
3. Installs a wrapper script at `~/.local/bin/arc` that executes
   `node <source>/dist/index.js "$@"`.
4. Compiles the C++ core if `g++` exists.
5. Compiles the Rust core and `arc_render` if `cargo` exists
   (copied to `core/arc_core_rs` and `core/arc_render`).
6. Runs `arc --install` to add shell hooks, a systemd user service, and a KDE
   launcher.

If `~/.local/bin` is not in your PATH, the installer prints the exact line to
add. It does not edit PATH for you; that is your one job.

To update: `bash install.sh` again. It is idempotent — it rebuilds, replaces
the hook block between its marker comments, and recompiles the cores.

### 3.3 Android (Termux)

```bash
pkg install nodejs git
cd ~
git clone https://github.com/Architect-Brad/arc.git arc
cd ~/arc
bash install.sh
source ~/.bashrc
arc
```

Full copy-paste block, including the optional native core:

```bash
pkg update && pkg install nodejs git rust
cd ~
git clone https://github.com/Architect-Brad/arc.git arc
cd ~/arc
bash install.sh
source ~/.bashrc
arc
```

**The source directory must live inside the Termux home directory** (`~/arc`).
The installer hard-checks this and refuses to continue otherwise. Termux is
sandboxed: paths under `/sdcard` or `/storage/emulated/0` do not allow the
execution semantics arc needs. Put it in `~`. It is not negotiable.

Termux specifics:

| Aspect | Behaviour |
|---|---|
| Binary location | `$PREFIX/bin/arc` (already in PATH) |
| Detection | `$TERMUX_VERSION`, `/data/data/com.termux`, or `$PREFIX` |
| KDE / systemd | Skipped entirely; neither exists here |
| Shell hooks | Written to `~/.bashrc` (bash) or `~/.zshrc` (zsh) |
| Web UI | Works in Android browser at `http://localhost:7070` |
| Rust core | `pkg install rust`; first compile is slow, subsequent builds cached |
| Node | `pkg install nodejs` or `nodejs-lts` |

To use a desktop GPU from your phone, put both devices on the same network and
point arc at the desktop server:

```bash
# On the desktop
OLLAMA_HOST=0.0.0.0 ollama serve

# In arc on Termux
arc config set defaults.ollamaHost 192.168.1.x:11434
```

Your phone becomes a chat client for your desktop's GPU. Objectively cool,
slightly overkill.

### 3.4 iOS

No.

iOS has no Termux, no terminal with meaningful filesystem access, no arbitrary
binary execution, and no persistent background processes. iSH emulates x86 in
userspace; it is slow, and arc's Rust core will not compile there. The web UI
works in Safari when the machine running arc is on the same network — that is
the iOS experience. It is not native, and it is not bad.

### 3.5 Where files go

| Path | Contents |
|---|---|
| `~/.config/arc/config.toml` | Main configuration |
| `~/.config/arc/personas/*.toml` | Custom personas |
| `~/.config/arc/chats.db` | SQLite chat storage |
| `~/.local/bin/arc` | Linux wrapper script |
| `$PREFIX/bin/arc` | Termux wrapper script |
| `~/.bashrc` / `~/.zshrc` | Marked shell-hook block |
| `~/.config/systemd/user/arc.service` | systemd user service (Linux) |
| `~/.local/share/applications/arc.desktop` | KDE launcher (Linux) |
| `core/arc_core_rs`, `core/arc_core`, `core/arc_render` | Native binaries |
| `dist/` | Generated JavaScript (gitignored) |
| `WIKI.md` | This document, shipped beside `dist/` |

---

## 4. CLI reference

Everything below comes from `arc --help` and the implemented command paths.
Flags are detected as `--flag`; a few single-letter forms exist (`-h`, `-v`).
Value-taking flags should always use the long form (`--model NAME`, not
`-m NAME`).

### 4.1 Core usage

| Invocation | What it does |
|---|---|
| `arc` | Interactive chat: resume picker, backend/model picker, chat loop |
| `arc --backend <id>` | Lock to one backend: `ollama`, `llamacpp`, `llamacli` |
| `arc --model <name>` | Jump to a matching model (prefix match on id or name) |
| `arc --backends` | Detect backends in parallel and list up to five models each |
| `arc --version` | Print version, author, and platform |
| `arc --help` | Print the help screen |
| `arc --wiki` / `arc wiki` | Open this manual |
| `arc --status` | Show shell hook, systemd service, and KDE launcher status |

Short forms: `-h` is help, `-v` is version. `--backend` and `--model` accept
their values only after the full flag name.

### 4.2 Rendering modes

| Invocation | What it does |
|---|---|
| `arc --pipe` | Render markdown from stdin through the pipeline |
| `arc --render <file>` | Render a markdown file |
| `arc --speed <value>` | Typewriter speed for `--pipe` / `--render` |
| `arc --instant` | Force instant mode for `--pipe` / `--render` |
| `arc --no-cursor` | Hide the blinking cursor in `--pipe` |
| `arc --compact` | Suppress extra blank lines between blocks in `--pipe` |
| `arc --pull <model>` | Run `ollama pull <model>` through arc |

`--speed` accepts `slow` (80 chars/sec), `normal` (200), `fast` (400),
`instant` (0), or a raw integer. The default for pipe/render is 200. In instant
mode the async render queue is bypassed entirely and all lines are written in a
single syscall. This is the "glow-class" fast path; when `core/arc_render` is
executable, `--pipe` and `--render` hand off to the native Rust binary (~30ms
startup, ~4MB RSS) and fall back to TypeScript silently on Termux or `noexec`
mounts.

Examples:

```bash
cat README.md | arc --pipe
cat README.md | arc --pipe --speed instant --no-cursor
arc --render WIKI.md --speed fast
ollama run qwen2.5-coder:0.5b | arc --pipe --compact
arc --pull llama3.2
```

`--pipe` and `--render` honour SIGINT: the pipeline aborts, the cursor is
restored, and arc exits cleanly.

### 4.3 Features and integrations

| Invocation | What it does |
|---|---|
| `arc compare [modelA] [modelB]` | Split-pane, two-model streaming (also `--compare`) |
| `arc benchmark [--suite quick\|full] [--models all\|a,b]` | Benchmark local models |
| `arc config` | Show config (also `arc config show`) |
| `arc config set <key> <value>` | Set a key, preserving its declared type |
| `arc config get <key>` | Print a key's value |
| `arc config reset` | Restore defaults (also `--reset`) |
| `arc serve [--port 7070] [--host 127.0.0.1]` | Start the web UI |
| `arc --install` | Install shell hooks + systemd + KDE launcher |
| `arc --uninstall` | Remove all of the above |
| `arc --daemon` | Idle process for the systemd service; hooks stay active |

Benchmark example:

```bash
arc benchmark --suite full
arc benchmark --models qwen2.5-coder:0.5b,llama3.2 --suite quick
arc serve --host 0.0.0.0 --port 7070
```

### 4.4 What the help screen lists

The `--help` screen is deliberately short. It lists the usage block (including
`--wiki`), supported backends with glyphs, shell interception examples, a
handful of chat commands, and the speed values. It is a map, not the territory.
This wiki is the territory.

---

## 5. Interactive chat

Run `arc`, pick a backend, pick a model, and you land in a bordered input box
with a live context bar in the top border. The header reminds you of the
essentials: `@file @url @paste @cwd`, `/help /model /save /copy /retry`, and
`Ctrl+C quit`.

### 5.1 Slash commands

Type `/` and the input layer shows a live autocomplete dropdown (up to eight
matches). Tab completes the first match, arrow keys move the selection, Enter
accepts it.

| Command | Effect |
|---|---|
| `/help` | Expanded help: all slash commands, @-commands, code keys, personas |
| `/clear` | Clear conversation history and reset the context window |
| `/model` | Persist and return to the model/backend picker |
| `/copy` | Copy the last response via `wl-copy`, `xclip`, or `xsel` |
| `/save` | Write the chat to `arc-chat-<timestamp>.md` |
| `/export [md\|json]` | Write a full export to `arc-export-<timestamp>.<fmt>` |
| `/system <text>` | Set the system prompt for this session |
| `/temp <0-2>` | Sampling temperature (session only) |
| `/top-p <0-1>` | Nucleus sampling (session only) |
| `/seed <int>` | Fixed integer seed (session only) |
| `/gen` | Show current generation settings |
| `/tokens` | Show context used, max, and percentage |
| `/retry` | Resend the last user message; drops a trailing assistant reply first |
| `/undo` | Remove the last user/assistant exchange |
| `/reset` | Fresh session: clear history and system prompt |
| `/exit` | Persist and leave |
| `/persona <name>` | Switch persona (`/persona list`, `/persona new <name>`) |
| `/typing <mode>` | `char`, `word`, or `instant` |
| `/config` | The config CLI, without leaving chat |
| `/bench [suite]` | Run a quick benchmark (or the named suite) |
| `/chats` | List the ten most recent saved chats |
| `/examples` | Worked examples for @-commands and slash commands |
| `/wiki` | Open this manual |
| `/joke` | Print one random joke from the built-in library |
| `/settings` | Open the full-screen settings pane |

Unknown commands print a short pointer to `/help` and `/examples`. No harm
done; the model never sees them.

### 5.2 @-commands

@-commands inject context into the message before it reaches the model. Type
`@` for the autocomplete dropdown (up to six matches). The display shows a
short summary line of what was attached, while the model receives the full
content wrapped in XML-ish tags.

| Command | Effect |
|---|---|
| `@file:path` | Attach a file's contents as `<file path="...">...</file>` |
| `@url:https://...` | Fetch and attach extracted page text as `<url src="...">...</url>` |
| `@paste` | Attach clipboard contents as `<paste>...</paste>` |
| `@cwd` | Attach a directory tree (max depth 2) as `<cwd>...</cwd>` |
| `@system:You are...` | Insert inline system context as `[SYSTEM: ...]` |
| `@history` | Insert a "see attached history" context marker |

Implementation notes that matter:

- `@file:` resolves against the current working directory with `path.resolve`.
  A missing or unreadable file silently resolves to nothing rather than
  crashing the turn.
- The `@url:` scraper is custom and dependency-free. It follows up to eight
  redirects, handles gzip/deflate/brotli, prefers `<article>` content,
  pretty-prints JSON, passes plain text through, caps at 512KB, and times out
  after 12 seconds. It was faster to write correctly than to debug a library.
- `@paste` tries `wl-paste`, then `xclip -selection clipboard -o`, then
  `xsel --clipboard --output`.
- `@cwd` runs `find . -maxdepth 2`, excluding `node_modules` and `.git`.
- arc automatically injects a short system note explaining the `<file>`,
  `<paste>`, `<url>`, and `<cwd>` wrappers so the model treats them as
  provided context instead of wondering what the angle brackets mean.

The `@file:` picker overlay described in older release notes is the arrow-key
filesystem navigator; the direct `@file:path` form documented here is what the
current command resolver executes.

### 5.3 Chat lifecycle

1. On startup, if saved chats exist, the resume picker appears. Arrow keys
   select, typing filters by title or model, `N` starts a new chat, Enter
   resumes, `q` quits. With no saved chats it is skipped.
2. A chat record is created with the backend id and model id.
3. Each exchange is persisted: user message, assistant message, token count,
   and any thinking content.
4. After the first exchange, a background one-shot inference names the chat.
   It does not block you; the new title appears next time you run `/chats`.
5. Context usage is estimated at roughly 3.8 characters per token. At 75% of
   the model's context window, arc compresses old messages into a bullet-point
   summary and continues. You see a one-line notice; the model never notices.
6. `/exit`, `/model`, and Ctrl+C persist the database before leaving.

Context sizes are estimated by model family: `llama3`, `qwen2.5`, `qwen3`,
`qwq`, `phi` = 131K; `claude` = 200K; `mistral` = 32K; `gemma`, `smollm`,
`functiongemma` = 8K; unknown models default to a conservative 8K.

---

## 6. New in 1.10.0: wiki, jokes, settings, better help

Four small features with an outsized impact on daily use.

### 6.1 `arc wiki` and `/wiki`

The manual now ships with the repository. `arc wiki` (also `arc --wiki`) and
the in-chat `/wiki` command open `WIKI.md` — the file you are reading. The
helpers live in `src/wiki.ts`:

```ts
getWikiPath()  // absolute path: <install>/WIKI.md
wikiExists()   // true when the file is present
readWiki()     // UTF-8 contents, or null if missing/unreadable
```

No rendering, no side effects. The caller decides whether to page it or print
it. If the file is missing, arc says so instead of dumping an empty buffer.

### 6.2 `/joke`

`/joke` prints one random one-liner from a built-in library of 60+ jokes. It
is local, instant, deterministic in its lack of determinism, and never sent to
the model. Sample output:

```text
  A hallucination is just a fact that skipped the peer review.
```

The Architect finds these funny. He is rarely wrong about such things. There is
also a config toggle, `ui.jokes`, for an occasional joke at chat startup; set it
to `false` if your sense of humour needs a holiday.

### 6.3 `/settings`

`/settings` opens a full-screen pane in the alternate screen buffer, so your
chat scrollback is untouched. Every change is written to `config.toml`
immediately.

| Key | Action |
|---|---|
| Up / Down or `k` / `j` | Move between rows |
| Space or Enter | Toggle a boolean or cycle a numeric value |
| `q`, Escape, Ctrl+C | Save and exit (everything already persisted) |

Rows and their cycles:

| Row | Values |
|---|---|
| `typewriter` | on / off |
| `compact` | on / off |
| `show_stats` | on / off |
| `show_ctx` | on / off |
| `jokes` | on / off |
| `speed` | slow (80) / normal (200) / fast (400) / instant (0), plus custom |
| `temperature` | unset / 0.2 / 0.4 / 0.7 / 1.0, plus custom |
| `topP` | unset / 0.5 / 0.8 / 0.9 / 1.0, plus custom |
| `seed` | unset / 1 / 42 / 1234, plus custom |

"unset" removes the key entirely, returning that parameter to the backend's
default. Custom values entered in config are displayed as `custom (N)`.

### 6.4 Expanded `/help`

`/help` is no longer a stub. It prints four sections: all slash commands with
descriptions, all @-commands, code block keys (`[r] run`, `[c] copy`, `[s]
save`, `[enter] continue`), and the first six personas with a pointer to
`/persona list` and `/persona new <name>`. Generation commands are called out
separately with their session-only caveat.

---

## 7. Backends in depth

### 7.1 Detection and selection

`src/backends/registry.ts` holds three backends in priority order:

```text
[◉] ollama     localhost:11434
[▲] llamacpp   llama-server, auto-spawn or adopt
[>] llamacli   one-shot llama-cli pipe
```

`detectBackends()` calls `isAvailable()` on all three in parallel with
`Promise.allSettled`, caches the result, and ignores failures. `loadAllModels()`
does the same for model lists. `arc --backends` prints the detected backends,
their glyphs, and the first five models of each.

Selection happens in three ways:

1. `--backend <id>` / `--model <name>` on the command line.
2. `defaults.backend` / `defaults.model` in config.
3. `/model` in chat, which returns to the two-level backend-then-model picker.

`--backend` accepts an id (`ollama`, `llamacpp`, `llamacli`) or a case-insensitive
backend name. An unknown id is a hard error listing the three known ones. If a
locked backend is not available, arc says so and exits — it does not silently
fall back, because silently falling back is how you spend an hour talking to the
wrong model.

### 7.2 Ollama

| Aspect | Detail |
|---|---|
| Detection | `GET /` must contain the string `Ollama` |
| Default endpoint | `localhost:11434` |
| Model discovery | `GET /api/tags`; size, quantisation, and family from `details` |
| Streaming endpoint | `POST /api/chat`, newline-delimited JSON |
| Timeout | 120 seconds |
| Host override | `defaults.ollamaHost` (strips `http://` and trailing `/`, splits on `:`) |

Wire format for generation parameters — Ollama uses an `options` object:

```json
{
  "model": "qwen2.5-coder:0.5b",
  "messages": [{ "role": "user", "content": "hello" }],
  "stream": true,
  "options": { "temperature": 0.7, "top_p": 0.9, "seed": 42 }
}
```

Each streamed line is parsed; `message.content` becomes a token and `done`
triggers completion. A malformed line is skipped, not fatal.

### 7.3 llama.cpp server (auto-spawn or adopt)

This backend has two modes and picks between them automatically.

**Adopt:** if a server is healthy at `localhost:8080` (or the explicit
host/port), it is used as-is. Health is `GET /health` with any `status` value;
`no slot available` still counts as healthy. Model listing queries `/props`
for the loaded model path and `/v1/models` for OpenAI-compatible ids.

**Spawn:** if no server is healthy but `llama-server` is on PATH, arc discovers
`.gguf` files and starts a server itself:

```text
llama-server -m /abs/path/model.gguf --host 127.0.0.1 --port <free port>
```

The port is reserved with a temporary listener on `127.0.0.1`, then released.
Health is polled every 500ms for up to 180 seconds. The child is killed with
SIGTERM when arc exits, receives SIGTERM, or receives SIGHUP. If a different
model is selected, the old child is killed and a new one spawned. If a healthy
external server already serves the chosen file (`/v1/models` or `/props`
matches the basename), arc adopts it instead of spawning.

**Model discovery directories:**

1. `defaults.llamacppModelDir` if set (search depth 3)
2. `~/models`
3. `~/gguf`
4. `~/.local/share/llama-models`
5. `~/llama.cpp/models`
6. the current working directory (search depth 2)

Each directory is scanned up to 500 entries; hidden directories and
`node_modules` are skipped. Quantisation (`Q4_K_M`, `f16`, ...) and size are
parsed from filenames and file stats.

Wire format — llama-server takes generation parameters at the top level of
`/v1/chat/completions`:

```json
{
  "model": "model-id",
  "messages": [{ "role": "user", "content": "hello" }],
  "stream": true,
  "temperature": 0.7,
  "top_p": 0.9,
  "seed": 42
}
```

Responses are Server-Sent Events: lines prefixed with `data:`, `[DONE]` ends
the stream, text comes from `choices[0].delta.content`, and
`choices[0].finish_reason === "stop"` signals completion.

If a chosen model is not a local `.gguf` and no server is running, arc reports
the mismatch instead of guessing. An explicit host/port disables spawning: you
asked for that endpoint, so that endpoint is what you get.

### 7.4 llama-cli (one-shot pipe)

Detection is simply `command -v llama-cli`. Models are the same discovered
`.gguf` files. There is no server, no port, and no background process: arc
spawns `llama-cli` once per message and streams raw stdout through the renderer.
The model reloads every turn — slower, but nothing holds your terminal hostage.

Typical invocation:

```text
llama-cli -m model.gguf -p PROMPT -st --no-display-prompt --log-disable -r "\nUser:" [-sys SYSTEM]
          [--temp 0.7] [--top-p 0.9] [--seed 42]
```

Flags: `-st` forces single-turn mode, `--no-display-prompt` keeps the prompt
out of stdout, `--log-disable` suppresses chatter, and `-r '\nUser:'` stops the
model from simulating the next user turn. Generation flags are only sent when
the caller actually set them, because their names vary across llama.cpp
versions. A 180-second timer kills a hung process. Non-zero exit or zero
output is treated as an error.

Multi-turn history is rendered into the prompt as a transcript:

```text
The following is a conversation transcript. Reply with only the assistant's
next message - no "User:" or "Assistant:" prefix, no role labels, no commentary.

User: first question
Assistant: first answer
User: second question
Assistant:
```

The system message is extracted from history and passed with `-sys`.

### 7.5 Shell hook interception

`arc --install` wraps `ollama` and `llama-cli` in shell functions. See
[section 13](#13-shell-hooks-kde-termux) for the exact rules. The short version:
a bare `ollama` opens arc, `ollama run ...` is piped through arc, one-shot
`llama-cli` calls are piped through arc, and interactive `llama-cli` sessions
pass through untouched.

---

## 8. Generation parameters

`/temp`, `/top-p`, `/seed`, and `/gen` control how the **current chat session**
samples tokens.

| Command | Range | Behaviour |
|---|---|---|
| `/temp 0.7` | 0.0-2.0 | Clamped to range; non-numeric input prints usage |
| `/top-p 0.9` | 0.0-1.0 | Clamped to range |
| `/seed 42` | integer | Truncated with `Math.trunc` |
| `/gen` | - | Prints `temp`, `top-p`, `seed`, and the config keys |

Rules:

- Values are seeded from `defaults.temperature`, `defaults.topP`, and
  `defaults.seed` when present. When absent, the backend or model server
  decides — no value is sent at all.
- Values survive `/retry` and every message in the chat, then vanish when you
  leave. arc is a renderer with the memory of a goldfish, not a config file.
- Only the main chat stream call site applies them. Compare mode, benchmark,
  the web UI, context compression, and background chat naming keep their own
  defaults. This is deliberate: a benchmark with per-session overrides would
  measure your settings, not the model.
- Each backend gets its own dialect (see section 7): Ollama `options`,
  llama-server top-level JSON, `llama-cli` flags.

**Hooks caveat.** Hooked CLI calls go through `arc --pipe`, which renders text
that some other program already generated. No backend is called, no sampling
happens, and `/gen` has nothing to say about them. Ask the hooked CLI about its
own sampling flags. The hook is a renderer, not a genie.

Example session:

```text
/temp 0.2
/top-p 0.9
/seed 42
/gen
  Generation  temp=0.2  top-p=0.9  seed=42
  Session only. Config: defaults.temperature · defaults.topP · defaults.seed
```

To make a value permanent, set it in config:

```bash
arc config set defaults.temperature 0.2
arc config set defaults.topP 0.9
arc config set defaults.seed 42
# Or use /settings and cycle the rows to "unset" to remove them again.
```

---

## 9. Configuration reference

Config lives at `~/.config/arc/config.toml`. It is created on first run with
defaults, parsed by a small custom TOML subset (sections, strings, numbers,
booleans), deep-merged over defaults, and re-serialised in a stable order.
Malformed config silently falls back to defaults. Numeric generation values
that arrive as quoted strings are coerced at read time, so `"0.4"` never
reaches a backend as a string.

### 9.1 Every key in ArcConfig

| Key | Type | Default | Purpose |
|---|---|---|---|
| `defaults.model` | string? | unset | Skip the model picker |
| `defaults.backend` | string? | unset | Skip backend detection (`ollama`, `llamacpp`, `llamacli`) |
| `defaults.speed` | number | 240 | Typewriter speed in chars/sec |
| `defaults.persona` | string? | unset | Persona active at chat start |
| `defaults.system` | string? | unset | System prompt seed |
| `defaults.ollamaHost` | string? | `localhost:11434` | Ollama endpoint |
| `defaults.llamacppModelDir` | string? | unset | Override `.gguf` search dir |
| `defaults.temperature` | number? | unset | Session temperature seed |
| `defaults.topP` | number? | unset | Session top-p seed |
| `defaults.seed` | number? | unset | Session seed seed (yes, really) |
| `ui.typewriter` | boolean | true | Animation preference; live mode is set by `/typing` |
| `ui.compact` | boolean | false | Suppress blank lines between blocks |
| `ui.show_stats` | boolean | true | Show per-response token/speed stats |
| `ui.show_ctx` | boolean | true | Show the context bar in the input box |
| `ui.jokes` | boolean? | true | Occasional joke at chat startup |
| `aliases` | table | empty | Reserved command aliases |
| `keybinds.clear` | string | `ctrl+l` | Declared clear binding |
| `keybinds.model` | string | `ctrl+m` | Declared model binding |
| `keybinds.copy` | string | `ctrl+y` | Declared copy binding |
| `server.port` | number | 7070 | Web UI port |
| `server.host` | string | `127.0.0.1` | Web UI bind address |

The `keybinds` table declares the configuration surface; the chat input box
currently uses its own fixed key map (section 14). Treat these as the shape of
things to come, not a promise that `ctrl+l` clears your history today.

### 9.2 Complete config example

```toml
# ~/.config/arc/config.toml
# Built by The Architect

[defaults]
model      = "qwen2.5-coder:0.5b"
backend    = "ollama"
persona    = "coder"
system     = "Prefer working code over explanations."
ollamaHost = "localhost:11434"
llamacppModelDir = "~/gguf"
speed      = 240
temperature = 0.7
topP        = 0.9
seed        = 42

[ui]
typewriter = true
compact    = false
show_stats = true
show_ctx   = true
jokes      = true

[server]
port = 7070
host = "127.0.0.1"

[aliases]
fast = "--backend ollama --model llama3.2"

[keybinds]
clear = "ctrl+l"
model = "ctrl+m"
copy  = "ctrl+y"
```

### 9.3 Config CLI

```bash
arc config                          # pretty-print the whole config
arc config show                     # same thing
arc config get defaults.model       # print one value
arc config set defaults.model llama3.2
arc config set defaults.topP 0.9
arc config set ui.jokes false
arc config reset                    # or: arc config --reset
```

`config set` splits dotted keys into section and field (`defaults.topP`); a
bare key is assumed to be in `[defaults]`. Values are coerced to the key's
declared type: numbers stay numbers, booleans accept `true`/`false`, everything
else is a string. `/config` inside chat runs the same CLI without leaving the
session.

---

## 10. The markdown engine

arc's inline renderer is a single-pass tokeniser, not a chain of regex
replacements. Precedence is correct, nesting works, and escape sequences are
atomic. The streaming path adds a `BlockAccumulator` that keeps state across
token boundaries — you might receive `"```py"` in one token and `"thon"` in
the next, and the pipeline still produces one Python code block.

### 10.1 Inline features

| Syntax | Result |
|---|---|
| `**bold**` / `__bold__` | bold |
| `*italic*` / `_italic_` | italic |
| `***bolditalic***` / `___bolditalic___` | bold + italic |
| `~~strike~~` | strikethrough |
| `` `code` `` | inline code (multiple backticks supported) |
| `==highlight==` | highlighted text (amber background) |
| `[[Ctrl+C]]` | keyboard-key style |
| `$x^2 + y^2$` | inline math in angle brackets |
| `[label](url "title")` | link with URL; title is stripped for display |
| `[label][ref]` | reference link |
| `<https://example.com>` / `<user@example.com>` | autolink |
| `![alt](url)` | image shown as `[img: alt]` |
| `:rocket:` | emoji shortcode (when the code is known) |
| `\*escaped\*` | literal asterisk |

Shortcodes are resolved from a fixed map: `:warning:`, `:check:`, `:x:`,
`:rocket:`, `:fire:`, `:star:`, `:bulb:`, `:wrench:`, `:bug:`, `:tada:`,
`:eyes:`, `:wave:`, `:thumbsup:`, `:heart:`, `:zap:`, `:lock:`, `:key:`,
`:link:`, `:memo:`, `:books:`, `:gear:`, `:white_check_mark:`, and
`:heavy_check_mark:`. Terminal glyphs are used, never full-colour emoji art.

The `[[key]]` handler guards against Markdown badge links such as
`[![badge](url)](url)`, so GitHub READMEs render correctly. HTML block tags
(`<details>`, `<summary>`, `<div>`, ...) and comments are silently stripped in
both the block and inline parsers.

### 10.2 Block features

| Syntax | Rendering |
|---|---|
| `# Heading` ... `###### Heading` | Six levels; h1 framed with double bars, h2 with a single bar |
| `---`, `===`, `***`, `___` | Horizontal rule |
| `> quote` | Blockquote |
| `- item`, `* item`, `+ item` | Unordered list, depth from indentation |
| `1. item` | Ordered list with the parsed index |
| Fenced code with language | Bordered, syntax-highlighted block |
| GFM tables | Bordered table with alignment and wrapped cells |

Tables support word-wrapped cells: long content flows across multiple display
rows inside the same logical row, and borders stay aligned. If a table is
wider than the terminal, columns shrink proportionally down to a six-character
minimum and cells wrap; a one-line notice says the columns were compressed.
This took more effort than it should have.

### 10.3 Syntax highlighting

Highlighter rules exist for JavaScript, TypeScript, Python, Rust, Go, Java,
C/C++, Bash/Shell, SQL, JSON, HTML/XML, and CSS. Aliases: `js`, `ts`, `py`,
`rs`, `sh`, `htm`, `cpp`, `c++`. Token classes include keywords, strings,
numbers, comments, types, function calls, operators, builtins, JSON
properties and punctuation, HTML tags and attributes, and CSS units/colours.
The highlighter is implemented in both the Rust core and the TypeScript
fallback.

### 10.4 Thinking blocks

Models such as QwQ, DeepSeek-R1, and Qwen3 emit reasoning wrapped in tags. arc
recognises all of these:

```text
<think>...</think>
<thinking>...</thinking>
[THINKING]...[/THINKING]
<!--think--><!--/think-->
```

During streaming, the opening tag switches to a dimmed block with a live
spinner (about 150ms per frame), keeping at most three visible reasoning lines.
The closing tag collapses it to a summary:

```text
  thought for 1.3s · 842 chars
```

The parser is always on. When no tags are present it stays in the `outside`
state and costs nothing — a fragile model whitelist was removed in v1.8.0.
Thinking content is stored separately in the database and rendered as a static
collapsed block in non-TTY environments.

### 10.5 Special fences

| Fence | Rendering |
|---|---|
| ```mermaid | Framed notice: "paste into mermaid.live to render" |
| ```svg | Framed notice: "open as .svg in browser" |
| ```chartjs / ```chart | Framed notice: "paste into chartjs.org to render" |

The first twenty lines of content are shown inside the frame. arc does not try
to draw diagrams in a terminal; it tells you where they belong. A reasonable
division of labour.

### 10.6 Code block keys

After a code block, TTY sessions expose a post-render action bar:

```text
  [r] run  [c] copy  [s] save  [enter] continue
```

| Key | Action |
|---|---|
| `r` | Run the code (only for runnable languages) |
| `c` | Copy via `wl-copy`, `xclip`, or `xsel` |
| `s` | Save to `arc-code-<timestamp>.<ext>` |
| Enter | Continue without acting |

Runners: JavaScript -> `node`, TypeScript -> `ts-node`, Python -> `python3`,
shell -> `bash`, Ruby -> `ruby`, Go -> `go run`, Rust -> `rustc` + execute. Other
languages can be copied and saved but not run. The action bar is rendered after
the stream completes, so it never leaks into the output text.

---

## 11. Typewriter modes

Three modes, switchable at any time with `/typing <mode>`:

| Mode | Behaviour |
|---|---|
| `char` | Per-character animation. Cinematic. Default. |
| `word` | Buffers tokens until whitespace, then emits a whole word. Feels like a fast typist. |
| `instant` | No animation. Fastest; one batched write for static blocks. |

Details:

- `char` defaults to 180 characters/sec. Punctuation-aware pausing: `.!?` adds
  90ms, `,;:` adds 30ms, newlines add 15ms.
- `word` defaults to 600 words/min, scaled by word length.
- Both modes use an ANSI-safe unit iterator: escape sequences are yielded
  atomically and never split mid-sequence, and multi-byte UTF-8 code points are
  single units. Delays apply only to visible characters.
- Non-TTY environments (pipes, scripts) always fall back to instant mode, no
  matter what you asked for.
- Code blocks, tables, rules, and special fences are rendered instantly even
  in animated modes.
- `--speed` applies to `--pipe` and `--render`, not to interactive chat. The
  interactive typewriter uses its own defaults; set `defaults.speed` in config
  to change the preference.

```text
/typing char       # each letter appears individually
/typing word       # "He" + "ll" + "o " becomes "Hello"
/typing instant    # dump the response immediately
/typing            # show the current mode and options
```

The per-character engine was the second-biggest source of input-box-adjacent
trauma in the project's history. The first was the input box.

---

## 12. Personas, system prompts, compare, benchmark, web UI, storage

### 12.1 Personas

Eight built-ins ship with arc:

| Persona | Description |
|---|---|
| `assistant` | Accurate, concise, direct general assistant |
| `coder` | Code first, explanations optional |
| `explain` | Teacher mode, first principles, analogies |
| `debate` | Steel-mans both sides, then has opinions |
| `shell` | Linux expert, exact commands, warns on destructive ops |
| `review` | Brutal code reviewer: critical, design, style, praise |
| `brainstorm` | Ten-plus ideas fast, quantity before quality |
| `concise` | One paragraph max, no filler, no "Great question" |

```text
/persona list          # list all built-ins and customs
/persona coder         # switch (clears history; active next message)
/persona new myname    # scaffold ~/.config/arc/personas/myname.toml
```

Custom personas live at `~/.config/arc/personas/<name>.toml`:

```toml
description = "My persona"
icon        = "◇"

[system]
You are a senior distributed systems architect.
You have strong opinions about CAP theorem.
You have seen what happens when people ignore it.
You would like to not see it again.
```

Everything after `[system]` is the system prompt, including newlines. Switching
personas clears history so the previous persona's context cannot leak in.

### 12.2 System prompts

`/system <text>` sets a session-scoped system prompt. It is combined with the
automatic @-command awareness note before the first user message. `/persona`
replaces it with the persona's prompt. `/reset` clears both the prompt and the
history. For a permanent prompt, use `defaults.system` in config.

### 12.3 Compare mode

```bash
arc compare                         # pick two models interactively
arc compare qwen2.5-coder llama3.2   # skip the picker
```

Two models receive the same prompt and stream side by side in a split pane,
each with its own backend glyph and colour. It uses the same renderer and
thinking parser as the chat path. It intentionally does not apply session
generation overrides.

### 12.4 Benchmark

```bash
arc benchmark
arc benchmark --suite full
arc benchmark --models all --suite quick
```

The quick suite has four prompts (exact phrase, arithmetic, Fibonacci code,
summarisation). The full suite adds five more (merge sort in Rust, bat-and-ball
reasoning, haiku, Linux commands, strict JSON). Each prompt is timed for
time-to-first-token, tokens/sec, total duration, and response length, then
models are ranked by a composite 0-100 score. The score is not scientifically
rigorous; it is directionally correct, which is all you need when choosing
between local models.

In chat, `/bench [suite]` runs the same suite as a one-off.

### 12.5 Web UI

```bash
arc serve                                  # 127.0.0.1:7070
arc serve --host 0.0.0.0 --port 7070       # reachable from your network
```

The server is hand-rolled HTTP plus a hand-rolled WebSocket implementation:
masked and unmasked frames, all three payload-length encodings, and a frame
accumulator that survives fragmented TCP delivery. The UI pings every 20
seconds and shows round-trip latency. It renders thinking blocks, exposes code
buttons (copy, save, run), and supports all three backends. Messages actually
send — that was fixed in v1.7.0 after a memorable incident involving discarded
partial frames.

The `server.port` and `server.host` config keys supply defaults; CLI flags win.
From a phone on the same network, `http://<your-machine>:7070` works too.

### 12.6 Chat storage and export

Storage is `sql.js` (pure-JS SQLite wasm) at `~/.config/arc/chats.db`. Three
tables: `chats` (title, backend, model, token count, pinned), `messages`
(role, content, tokens, thinking), and `stats` (usage by backend/model). The
database is written when dirty, with an automatic save every 30 seconds.

| Command | Output |
|---|---|
| `/chats` | Ten most recent chats with model, date, and approximate tokens |
| `/save` | `arc-chat-<timestamp>.md` |
| `/export md` | `arc-export-<timestamp>.md` (also the default) |
| `/export json` | `arc-export-<timestamp>.json` |
| `/clear` | Wipe in-memory history, reset context |
| `/undo` | Remove the last exchange |
| `/retry` | Resend the last user message |
| `/exit` | Persist and leave |

Startup resume is handled by the resume picker described in section 5.3.

Context usage is shown in the input box's top border and by `/tokens`. The bar
goes green, then yellow past 60%, then red past 85%. At 75% of the model window
arc compresses old messages into a summary and resets the estimate.

---

## 13. Shell hooks, KDE, Termux

### 13.1 `arc --install`

The installer writes a marked block between
`# -- arc hooks: begin` and `# -- arc hooks: end` comments into `~/.bashrc`
(or `~/.zshrc` for zsh). Re-running replaces the block rather than appending a
second copy. On Linux it also installs:

- a systemd user service at `~/.config/systemd/user/arc.service`, which runs
  `arc --daemon` and restarts on failure;
- a KDE launcher at `~/.local/share/applications/arc.desktop`, with
  `Terminal=true`, then refreshes the desktop cache with `kbuildsycoca6` or
  `kbuildsycoca5`.

The hook functions resolve the arc binary to `~/.local/bin/arc` when present,
otherwise plain `arc` on PATH.

### 13.2 What the hooks do

| Command typed | Result |
|---|---|
| `ollama` (no args) | `arc --backend ollama` — opens the arc TUI |
| `ollama run llama3` | `command ollama run llama3 | arc --pipe` |
| `ollama arc render ...` | `command ollama ... | arc --pipe` (explicit render subcommand) |
| `llama-cli -p "..."` | One-shot detected: `command llama-cli ... | arc --pipe` |
| `llama-cli` (interactive) | Passed through untouched |

One-shot detection for `llama-cli` looks for `-p`, `--prompt`, `-st`, or
`--single-turn` among the arguments. Interactive sessions are left alone
because wrapping an interactive REPL in a pipe is how you get a very confused
shell.

Remember: hooked invocations render text that another program generated. They
do not invoke an arc backend and do not apply generation parameters.

### 13.3 Status and removal

```bash
arc --status      # shell hooks: yes/no; systemd service: yes/no; KDE launcher: yes/no
arc --uninstall   # removes the hook block, service, and desktop entry
```

`--uninstall` is surgical: it removes only arc's marked block from your shell
rc file and leaves everything else alone.

### 13.4 Termux notes recap

- Keep the source in `~/arc`; the installer refuses other locations.
- The wrapper goes to `$PREFIX/bin/arc`, which is already in PATH.
- KDE and systemd steps are skipped.
- `arc serve` works in Android browsers at `http://localhost:7070`.
- `pkg install rust` enables the native core; first compile takes minutes.
- A desktop Ollama server can be reached via `defaults.ollamaHost`.
- Native binaries on unusual mounts fall back to the TypeScript engine, so arc
  still runs even when execution permissions are awkward.

---

## 14. Keyboard reference

### 14.1 Chat input box

| Key | Action |
|---|---|
| Enter | Send the message |
| Ctrl+C | Cancel/quit (history is persisted) |
| Up / Down | Previous / next input from history |
| Left / Right | Move the cursor within the line |
| Home / Ctrl+A | Move to the start of the line |
| End / Ctrl+E | Move to the end of the line |
| Ctrl+U | Clear the current buffer |
| Ctrl+W | Delete the previous word |
| Backspace | Delete the character before the cursor |
| Delete | Delete the character at the cursor |
| Escape | Clear the buffer |
| Shift+Enter / Ctrl+J | Insert a newline (multi-line input) |
| Tab | Complete the first autocomplete match |
| `r` / `c` / `s` / Enter | Code-block action bar after a response |

The visual cursor is `▋`, drawn as a character inside the box content. The real
terminal cursor stays hidden below the box. This invariant — after every draw,
the cursor is at column 1 of the line below the box — is what makes the input
box scroll-safe. Please stop finding bugs in it.

### 14.2 Picker and resume screens

| Key | Action |
|---|---|
| Up / Down | Move the selection |
| Enter | Select the highlighted item |
| `/` (resume screen) | Filter chats by title or model |
| `N` (resume screen) | Start a new chat |
| `q` (resume screen) | Quit |
| Escape | Dismiss autocomplete dropdown |

### 14.3 Settings pane

| Key | Action |
|---|---|
| Up / Down or `k` / `j` | Move between rows |
| Space / Enter | Toggle or cycle the selected row |
| `q` / Escape / Ctrl+C | Exit (changes are already saved) |

---

## 15. Troubleshooting and FAQ

### 15.1 "No backends found"

Run `arc --backends`. Then check each candidate:

```bash
command -v ollama
command -v llama-server
command -v llama-cli
curl -s http://localhost:11434/          # Ollama: should mention "Ollama"
curl -s http://localhost:8080/health     # llama-server: should return a status
```

- Ollama must be running (`ollama serve`) at the configured host. Check
  `defaults.ollamaHost`; a stale value here overrides localhost.
- llama.cpp needs either a healthy server or `llama-server` on PATH plus at
  least one discoverable `.gguf`.
- llama-cli needs `llama-cli` on PATH and a `.gguf` file.
- `--backend <id>` disables fallback to a different backend. Remove the lock
  to let detection choose.

### 15.2 "Model discovery found nothing"

- Set `defaults.llamacppModelDir` to the directory containing your `.gguf`
  files: `arc config set defaults.llamacppModelDir ~/models`.
- Check the search directories in section 7.3. Hidden directories and
  `node_modules` are skipped; only the first 500 entries per directory are
  scanned.
- A configured directory is searched to depth 3; the defaults to depth 2.
- If you already run `llama-server`, arc asks it for models instead of scanning
  disk.

### 15.3 "llama-server never becomes ready"

arc polls `/health` for 180 seconds. Large models take time to load. Check that
the `.gguf` path is readable and that the model fits in memory. If a different
model was selected mid-session, the old child is killed first. If an external
server is healthy on the default port but serves a different model, arc adopts
it only when the model name matches; otherwise it spawns its own on a free
port.

### 15.4 "`noexec` mount / native binary fallback"

On mounts such as `/mnt/sdcard`, compiled binaries cannot be executed. arc
detects this: the native core handshake times out or the spawn fails, and the
TypeScript engine takes over silently. The startup status line tells you which
engine is active. `--pipe` / `--render` fall back to the TypeScript renderer
the same way. Nothing is broken; permissions are just being permissions.

For development on such a mount, build in `/tmp`:

```bash
mkdir -p /tmp/arc-build
cp -r src package.json tsconfig.json /tmp/arc-build/
cd /tmp/arc-build && npm install && npm run build
cp -r dist /path/to/arc/
```

### 15.5 "Clipboard commands do nothing"

`/copy` and code-block `c` try `wl-copy`, `xclip -selection clipboard`, and
`xsel --clipboard --input` in order. If none is installed, nothing is copied.
Install one. On Wayland use `wl-copy`; on X11 use `xclip` or `xsel`.

### 15.6 "`arc: command not found` after install"

- Linux: add `~/.local/bin` to PATH and reload your shell.
- Termux: the source must be inside `$HOME`; the installer writes to
  `$PREFIX/bin`. If you cloned to `/sdcard`, move it and re-run.
- Always `source ~/.bashrc` (or `~/.zshrc`) after `--install`.

### 15.7 "Why does `/temp` do nothing with `ollama run`?"

Because `ollama run` is hooked into `arc --pipe`: the text was already
generated before arc saw it. Use arc's own chat interface (or the unhooked CLI
with `--backend`) to apply generation parameters. See section 8.

### 15.8 FAQ

**Is any data sent to the cloud?** No. All three backends are local servers or
local processes. The `@url:` scraper fetches a URL you explicitly provide; that
is the only outbound request arc makes.

**Why were the cloud backends removed?** Claude Code, Qwen, OpenCode, and
Copilot each ship their own rendering interface. Wrapping one TUI in another
produced two renderers arguing over the same terminal. Use them directly.

**Where are my chats?** `~/.config/arc/chats.db`. `/save` and `/export` write
Markdown or JSON into the current directory.

**How do I read the manual offline?** `arc wiki` or `/wiki`. The file is
`WIKI.md` beside `dist/`.

**Is arc faster than glow?** At pure rendering, yes — instant mode batches
lines into a single write and the native renderer starts in tens of
milliseconds. The perceived slowdown was per-character animation with
intentional pauses, and Node.js startup of roughly 200ms. Both were investigated
thoroughly and immortalised as an honorary bug.

**Why no iOS?** See section 3.4. The answer has always been no.

**Are there easter eggs?** Yes. See section 17, but only if you like surprises.
Some of them are documented; the interesting ones are not.

---

## 16. Architecture and contributing

### 16.1 Pipeline

```text
LLM token stream
      |
LineBuffer       accumulate tokens into complete lines
      |
BlockAccumulator group lines into blocks (state survives token boundaries)
      |
renderBlock      block -> ANSI lines (inline tokeniser, highlighter, tables)
      |
Typewriter       char / word / instant animation
      |
stdout
```

`src/pipeline.ts` orchestrates this. In instant mode it bypasses the async
queue and writes all rendered lines in one call. Code, tables, rules, and
special fences are always instant. Thinking tags are split from the token
stream before it reaches the pipeline.

### 16.2 Source map

| Area | Files |
|---|---|
| CLI entry | `src/index.ts` |
| Chat loop and help | `src/tui.ts` |
| Input layer and commands | `src/input.ts`, `src/inputbox.ts` |
| Markdown | `src/parser.ts`, `src/inline.ts`, `src/renderer.ts`, `src/table.ts`, `src/highlight.ts`, `src/theme.ts` |
| Streaming | `src/pipeline.ts`, `src/typewriter.ts`, `src/thinking.ts` |
| Backends | `src/backends/{base,registry,ollama,llamacpp,llamacli,gguf}.ts` |
| Config and personas | `src/config.ts`, `src/personas.ts` |
| Storage | `src/storage.ts`, `src/chatresume.ts`, `src/compress.ts` |
| Features | `src/compare.ts`, `src/benchmark.ts`, `src/serve.ts`, `src/hooks.ts`, `src/scraper.ts`, `src/easter.ts`, `src/jokes.ts`, `src/settings.ts`, `src/wiki.ts` |
| Native bridge | `src/core.ts`, `core/arc_core_rs`, `core/arc_core`, `core/arc_render` |

The native core speaks a line-delimited JSON protocol over stdin/stdout. A
`{"cmd":"ping"}` is answered with `{"r":"pong","engine":"rust"}`. Preference
order is Rust, then C++, then the TypeScript fallback; a failed handshake or
stalled call degrades gracefully.

### 16.3 Building

```bash
npm install && npm run build
node dist/index.js         # or: npm start
```

Rust tests:

```bash
cd arc-core-rs && CARGO_TARGET_DIR=/tmp/arc_render_tests cargo test
```

On Termux add the linker override:

```bash
CARGO_TARGET_DIR=/tmp/arc_render_tests \
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=/data/data/com.termux/files/usr/bin/clang \
cargo test
```

`CARGO_TARGET_DIR` keeps test binaries on an executable filesystem. The first
compile is slow. Go make coffee.

### 16.4 House rules

- ASCII only in terminal output. `◈`, `◉`, `▲`, and `[>]` are terminal glyphs,
  not emoji, and are fine. If a glyph renders wider than one column, do not
  ship it.
- Contributors verify with stub backends; users test against real models.
  Nobody downloads a 30GB model to test a renderer.
- Keep the humour in the docs. If you delete a joke, replace it with a better
  one. The input box jokes are load-bearing.
- Generated files (`dist/`, `target/`, `node_modules/`, `*.db`, `*.gguf`,
  `*.log`) stay out of git.
- Pull requests should be small, focused, and say what broke. Being correct
  tends to win over The Architect's strong opinions.

---

## 17. Easter eggs

There are easter eggs. We are not going to tell you all of them.

Some starting points that have escaped into the wild:

```bash
arc matrix
arc manifesto
arc vs glow
arc speedrun
```

And in chat, phrases like `what is arc`, `how many rewrites`, and `the architect`
are handled before the message reaches the model. The model never knows they
happened. This is probably fine.

Some are hidden behind exact phrases, some are triggered by CLI arguments, and
at least one involves a classic eight-direction keyboard sequence. If you find
one you were not told about, that is the point. No further comment.

---

**arc v1.10.0 · Linux · KDE · Android (Termux) · Built by The Architect**

*This manual is shipped, not fetched.*
*The input box is fixed.*
*Please stop finding bugs in it.*
