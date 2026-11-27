#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-remote.sh -- the thin fetch-and-clone wrapper around arc's installer
# ---------------------------------------------------------------------------
# Pipe this from curl to get arc without cloning by hand:
#
#   curl -fsSL https://raw.githubusercontent.com/Architect-Brad/arc/master/install-remote.sh | bash
#
# This wrapper does NOT build or configure arc. It only:
#   1. checks for git and node,
#   2. clones (or updates) the repo at lowercase $HOME/arc,
#   3. hands off to install.sh, which does the building, wiring, shell hooks.
# No dependencies beyond bash, git, node, and whatever curl/wget you used to
# fetch this file. System packages are never installed on your behalf.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_URL="https://github.com/Architect-Brad/arc.git"
INSTALL_DIR="${HOME:?HOME is not set}/arc"   # lowercase. Capital-A broke people.

# -- Environment -------------------------------------------------------------
IS_TERMUX=false
if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${PREFIX:-}" ] || [ -d /data/data/com.termux ]; then
  IS_TERMUX=true
  if [ -z "${PREFIX:-}" ]; then
    PREFIX="/data/data/com.termux/files/usr"
  fi
  export PREFIX   # install.sh detects Termux via $PREFIX
fi

echo ""
echo "============================================================"
echo " arc remote bootstrap -- fetch, clone, hand off"
echo "============================================================"
echo ""
if [ "$IS_TERMUX" = true ]; then
  echo " Platform: Android (Termux)   PREFIX=$PREFIX"
else
  echo " Platform: Linux"
fi
echo " Target:   $INSTALL_DIR"
echo " Source:   $REPO_URL"

# -- Tool checks. We report, we do not auto-install. -------------------------
NEED_GIT=false
NEED_NODE=false
command -v git  >/dev/null 2>&1 || NEED_GIT=true
command -v node >/dev/null 2>&1 || NEED_NODE=true

if [ "$NEED_GIT" = true ] || [ "$NEED_NODE" = true ]; then
  echo ""
  echo " Missing tools. I was asked to install arc, not your OS."
  if [ "$IS_TERMUX" = true ]; then
    echo " Install them with:  pkg install git nodejs"
  else
    echo " Install git and Node.js 18+ with your package manager, e.g.:"
    echo "   sudo apt install git nodejs      # Debian / Ubuntu"
    echo "   sudo dnf install git nodejs      # Fedora"
    echo "   https://nodejs.org               # any Linux"
  fi
  echo " Then re-run this command. Nothing was changed."
  exit 1
fi
echo " [ok] git and node found"

# -- stdin hygiene -----------------------------------------------------------
# Under `curl ... | bash`, fd 0 is the pipe carrying this script. Our children
# get /dev/null so they cannot nibble the remaining lines. install.sh gets a
# real terminal when there is one, otherwise /dev/null (it does not prompt).
INSTALL_STDIN=/dev/null
if (exec 3</dev/tty) 2>/dev/null; then
  INSTALL_STDIN=/dev/tty
fi

# -- Clone, or update an existing checkout -----------------------------------
if [ -e "$INSTALL_DIR" ]; then
  if [ ! -d "$INSTALL_DIR" ]; then
    echo ""
    echo " ! $INSTALL_DIR exists but is not a directory."
    echo "   Not deleting it. Move it aside and re-run."
    exit 1
  fi
  if git -C "$INSTALL_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo ""
    echo " [ok] existing arc checkout found -- updating, not re-cloning"
    if ! git -C "$INSTALL_DIR" pull --ff-only < /dev/null; then
      echo ""
      echo " ! git pull --ff-only failed in $INSTALL_DIR"
      echo "   Resolve the local git state (stash or drop local edits) and re-run."
      exit 1
    fi
  else
    echo ""
    echo " ! $INSTALL_DIR exists but is not a git repository."
    echo "   Refusing to overwrite it. Move it aside and re-run."
    exit 1
  fi
else
  echo ""
  echo " Cloning (shallow) into $INSTALL_DIR ..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" < /dev/null
fi

# -- Hand off to the real installer -----------------------------------------
cd "$INSTALL_DIR"
echo ""
echo " Handing off to install.sh -- that is the one that does the real work."
echo ""
bash install.sh < "$INSTALL_STDIN"

# -- Summary -----------------------------------------------------------------
if [ "$IS_TERMUX" = true ]; then
  BIN_PATH="$PREFIX/bin/arc"
else
  BIN_PATH="$HOME/.local/bin/arc"
fi

echo ""
echo "============================================================"
echo " arc is installed. Somehow, the internet worked."
echo "============================================================"
echo ""
echo " Repo:      $INSTALL_DIR"
echo " Binary:    $BIN_PATH"
if [ "$IS_TERMUX" = true ]; then
  echo " Shell:     source ~/.bashrc   # or just restart Termux"
else
  echo " PATH:      $HOME/.local/bin must be on your PATH"
  echo "           echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
  echo "           source ~/.bashrc"
fi
echo ""
echo " Try these:"
echo "   arc wiki        # the manual you actually have"
echo "   arc --help      # every flag, all at once"
echo "   arc --logo      # the face. no diamonds were invited"
echo ""
echo " Re-run the same curl line any time to update. It is idempotent,"
echo " unlike most things on the internet."
echo "============================================================"
echo ""
