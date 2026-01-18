#!/usr/bin/env bash
set -euo pipefail

# Manual repro helper for "queue /compact after current turn".
#
# This starts the coding agent from source (tsx), isolates config/session data in a temp dir,
# and provides a prompt that should trigger a long-running tool call.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tmp_agent_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-coding-agent-queued-compact.XXXXXX")"

export PI_CODING_AGENT_DIR="$tmp_agent_dir"

cat <<'TXT'
Queued /compact manual test
==========================

This launches the interactive TUI with an isolated agent directory:
  PI_CODING_AGENT_DIR=<tmp>

What to test:
  1) Wait for the agent to start a long task (prompt below should trigger a bash `sleep`).
  2) While it is still busy, type a follow-up message and press Enter (this queues input).
  3) While it is still busy, type `/compact` and press Enter.

Expected:
  - The current task is NOT aborted.
  - You see "Compaction: queued" in the pending display.
  - After the current turn ends, compaction runs.
  - Only after compaction finishes, the queued follow-up message is processed.

Notes:
  - Compaction requires an API key (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY / etc.) or a configured auth.json.
  - This script does not delete the temp dir, so you can inspect logs/config if needed.

Press Ctrl+C to exit the TUI when done.
TXT

echo
echo "Temp agent dir: ${tmp_agent_dir}"
echo

initial_prompt=$'We are working on the pi-coding-agent module.\nUse the bash tool to run a long command: `sleep 15`.\nDo not ask questions; do not propose alternatives; actually call the tool now.\nAfter it finishes, write exactly: DONE'

cd "$ROOT_DIR"
exec npx tsx packages/coding-agent/src/cli.ts "$initial_prompt"
