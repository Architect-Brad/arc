#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh — arc installer for Linux (KDE) and Android (Termux)
# ─────────────────────────────────────────────────────────────────────────────

set -e

V='\033[38;2;139;92;246m'
G='\033[38;2;134;239;172m'
R='\033[38;2;248;113;113m'
S='\033[38;2;100;116;139m'
B='\033[1m'
E='\033[0m'

# ── Detect environment ─────────────────────────────────────────────────────────
IS_TERMUX=false
IS_LINUX=false

if [ -n "$TERMUX_VERSION" ] || [ -d "/data/data/com.termux" ] || [ -n "$PREFIX" ]; then
  IS_TERMUX=true
  PLATFORM="Android (Termux)"
else
  IS_LINUX=true
  PLATFORM="Linux"
fi

echo ""
echo -e "${V}══════════════════════════════════════════${E}"
echo -e "  ${V}${B}arc${E}  ${S}by The Architect${E}"
echo -e "  ${S}Streaming LLM Renderer · ${PLATFORM}${E}"
echo -e "${V}══════════════════════════════════════════${E}"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# ── Node.js check ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "  ${R}✗${E} Node.js not found"
  if $IS_TERMUX; then
    echo -e "  Install with: ${V}pkg install nodejs${E}"
  else
    echo -e "  Install with: ${V}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -${E}"
  fi
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
echo -e "  ${G}✓${E} Node.js ${NODE_VER}"

# ── Ollama check ──────────────────────────────────────────────────────────────
if command -v ollama &>/dev/null; then
  echo -e "  ${G}✓${E} Ollama found"
elif $IS_TERMUX; then
  echo -e "  ${S}·${E} Ollama not found — install from ${V}https://ollama.com${E}"
  echo -e "    ${S}(Termux: use ${V}proot-distro${S} or connect to a desktop Ollama server)${E}"
fi

# ── Build arc (TypeScript) ─────────────────────────────────────────────────────
cd "$SCRIPT_DIR"
echo ""
echo -e "  ${S}Building arc…${E}"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null
echo -e "  ${G}✓${E} Built successfully"

# ── Install binary ─────────────────────────────────────────────────────────────
if $IS_TERMUX; then
  # Verify we're in the Termux home directory
  TERMUX_HOME="$HOME"
  if [[ "$SCRIPT_DIR" != "$TERMUX_HOME"* ]]; then
    echo ""
    echo -e "  ${R}⚠  arc must be installed inside your Termux home directory${E}"
    echo -e "  ${S}Current: ${SCRIPT_DIR}${E}"
    echo -e "  ${S}Required: somewhere inside ${TERMUX_HOME}/${E}"
    echo ""
    echo -e "  Move arc to your home directory and re-run:"
    echo -e "  ${V}mv \"${SCRIPT_DIR}\" ~/arc && cd ~/arc && bash install.sh${E}"
    echo ""
    exit 1
  fi
  INSTALL_DIR="$PREFIX/bin"
  INSTALL_PATH="$INSTALL_DIR/arc"
else
  INSTALL_DIR="$HOME/.local/bin"
  INSTALL_PATH="$INSTALL_DIR/arc"
fi

mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_PATH" << WRAPPER
#!/usr/bin/env bash
node "$SCRIPT_DIR/dist/index.js" "\$@"
WRAPPER
chmod +x "$INSTALL_PATH"
echo -e "  ${G}✓${E} arc installed → ${V}${INSTALL_PATH}${E}"

# ── PATH check ─────────────────────────────────────────────────────────────────
if $IS_TERMUX; then
  # Termux $PREFIX/bin is always in PATH
  true
elif [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo ""
  echo -e "  ${S}Add to PATH:${E} ${V}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc${E}"
fi

# ── Compile C++ core ──────────────────────────────────────────────────────────
if command -v g++ &>/dev/null; then
  echo ""
  echo -e "  ${S}Compiling C++ core…${E}"
  if g++ -std=c++17 -O3 -o "$SCRIPT_DIR/core/arc_core" "$SCRIPT_DIR/core/arc_core.cpp" 2>/dev/null; then
    echo -e "  ${G}✓${E} C++ core compiled"
  else
    echo -e "  ${S}·${E} C++ core skipped (g++ failed — TS fallback active)"
  fi
fi

# ── Compile Rust core (preferred) ─────────────────────────────────────────────
if command -v cargo &>/dev/null; then
  echo ""
  if $IS_TERMUX; then
    echo -e "  ${S}Compiling Rust core (first time takes ~3 min on Android)…${E}"
  else
    echo -e "  ${S}Compiling Rust core…${E}"
  fi
  if cd "$SCRIPT_DIR/arc-core-rs" && cargo build --release --quiet 2>/dev/null; then
    cp target/release/arc_core_rs "$SCRIPT_DIR/core/arc_core_rs"
    chmod +x "$SCRIPT_DIR/core/arc_core_rs" 2>/dev/null || true
    cp target/release/arc_render  "$SCRIPT_DIR/core/arc_render" 2>/dev/null || true
    chmod +x "$SCRIPT_DIR/core/arc_render" 2>/dev/null || true
    echo -e "  ${G}✓${E} Rust core compiled — blazing fast engine active"
    cd "$SCRIPT_DIR"
  else
    echo -e "  ${S}·${E} Rust build failed — C++/TS fallback active"
    cd "$SCRIPT_DIR"
  fi
else
  if $IS_TERMUX; then
    echo -e "  ${S}·${E} Install Rust for native speed: ${V}pkg install rust${E}"
  fi
fi

# ── Run arc --install for shell hooks + platform integration ───────────────────
echo ""
node "$SCRIPT_DIR/dist/index.js" --install

# ── Termux extras ─────────────────────────────────────────────────────────────
if $IS_TERMUX; then
  echo ""
  echo -e "${V}  Termux tips:${E}"
  echo -e "  ${S}·${E} Connect to desktop Ollama: ${V}arc config set defaults.ollamaHost 192.168.x.x:11434${E}"
  echo -e "  ${S}·${E} Install Rust:    ${V}pkg install rust${E}"
  echo -e "  ${S}·${E} Install Node 20: ${V}pkg install nodejs-lts${E}"
  echo -e "  ${S}·${E} arc serve        ${S}(web UI works in Android browser)${E}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${V}══════════════════════════════════════════${E}"
echo -e "  ${G}${B}◈ arc is ready${E} on ${PLATFORM}"
echo ""
echo -e "  ${V}arc${E}              open chat interface"
echo -e "  ${V}arc --help${E}       all commands"
echo -e "  ${V}arc --version${E}    version + author"
echo -e "  ${V}arc serve${E}        web UI at localhost:7070"
echo -e "  ${V}arc benchmark${E}    test your models"
echo ""
if $IS_LINUX; then
  echo -e "  Then type ${V}ollama${E} — arc intercepts automatically."
fi
echo -e "${V}══════════════════════════════════════════${E}"
echo ""
