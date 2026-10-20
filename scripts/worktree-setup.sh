#!/usr/bin/env bash
# Prepares a fresh checkout or worktree: dependencies, agent instructions, and reference repositories for agents.
# T3 runs it when it creates a worktree for a thread.
set -euo pipefail

corepack install 2>/dev/null || true
pnpm install --frozen-lockfile

# Read-only references for agents, never built or imported: Effect's sources and its .agents skills.
mkdir -p .repos
if [ ! -d .repos/effect ]; then
  git clone --depth 1 https://github.com/Effect-TS/effect.git .repos/effect || echo "skipped .repos/effect (offline?)"
fi
