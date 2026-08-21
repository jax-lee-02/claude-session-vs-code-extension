#!/usr/bin/env bash
#
# Build this fork of the Claude Sessions Explorer extension from source and
# install it into VS Code. Run it from inside a clone of this repository:
#
#   git clone https://github.com/jax-lee-02/claude-session-vs-code-extension.git
#   cd claude-session-vs-code-extension
#   ./install.sh
#
# After it finishes, reload the VS Code window (Cmd/Ctrl+Shift+P -> "Reload
# Window") to activate the newly installed version.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VSIX_OUT="claude-sessions.vsix"

# --- prerequisites -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH. Install Node.js first." >&2
  exit 1
fi

if ! command -v code >/dev/null 2>&1; then
  echo "error: VS Code 'code' CLI not found on PATH." >&2
  echo "       In VS Code run: Cmd/Ctrl+Shift+P -> 'Shell Command: Install code command in PATH'." >&2
  exit 1
fi

# --- build -------------------------------------------------------------------
echo "==> Installing npm dependencies"
npm install

echo "==> Compiling TypeScript"
npm run compile

echo "==> Packaging VSIX ($VSIX_OUT)"
npx --yes @vscode/vsce package --allow-missing-repository --skip-license -o "$VSIX_OUT"

# --- install -----------------------------------------------------------------
echo "==> Installing extension into VS Code"
code --install-extension "$VSIX_OUT" --force

echo
echo "Done. Reload the VS Code window to activate the extension."
