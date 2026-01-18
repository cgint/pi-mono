# Compaction during an active task

Status: queued `/compact` is implemented and should be tried in real workflows first; before upstreaming, apply the quality follow-ups listed below.

Try it locally: `bash scripts/try-queued-compact.sh`

## Diagram

![Compaction during an active task](./COMPACTION_DURING_TASK.svg)

## What happens now

- If you enter `/compact` while the agent is streaming, compaction is queued and the current turn is allowed to finish.
- Compaction runs after the current turn completes (before queued follow-up messages continue).
- While compaction is running, the pending display shows `Compaction: running` (and queued `/compact` shows `Compaction: queued`).
- In RPC mode, `{"type":"compact"}` behaves the same way (waits for the turn to complete, then compacts).

## What happened before

- `/compact` aborted the in-flight task and compacted immediately.

## How queuing works

- `/compact` queues via `AgentSession.queueCompaction()` when streaming.
- The agent is paused after the current turn so follow-up queue processing stops.
- After compaction, queued steering/follow-up messages resume.

## Notes from implementation + tryout

- Issue observed: `Compaction: queued` could remain stuck and never execute; additional steering/follow-ups might execute (or appear queued) while compaction still didn’t run.
- Root cause: queued compaction flush was only triggered on `agent_end` if `AgentSession` had captured a “last assistant message” via `message_end`. In some end-of-turn paths that value can be missing, so `_flushQueuedCompactions()` was never scheduled.
- Fix: handle `agent_end` unconditionally and fall back to scanning agent state for the last assistant message; queued compactions now flush reliably even when `_lastAssistantMessage` is missing (`packages/coding-agent/src/core/agent-session.ts:301`).
- Regression test: `packages/coding-agent/test/queued-compaction-during-streaming.test.ts:51`.
- Issue observed: after `/compact` is queued, a user can still enqueue a steering message (Enter) and it may run before compaction, which defeats “compact between turns” semantics.
- Root cause: `Agent.requestPauseAfterTurn()` originally only paused follow-up queue consumption; steering messages could still be pulled in the same run.
- Fix: pause both steering and follow-up retrieval when a manual compaction is queued (`packages/agent/src/agent.ts:189`).
- Issue observed: in some interactive runs, compaction was shown as queued but never executed (and queued follow-ups remained pending).
- Hypothesis/root cause: relying solely on `agent_end` handling to trigger `_flushQueuedCompactions()` can be brittle in UI-driven concurrency.
- Fix: `queueCompaction()` also schedules a flush after `agent.waitForIdle()` resolves (`packages/coding-agent/src/core/agent-session.ts:1216`).
- Debug finding: compaction could run and be persisted, but queued follow-ups remained stuck because the resume path tried to `continue()` from an assistant-last context.
- Root cause: `Agent.continueWithQueuedMessages()` incorrectly used the “continue” loop (`agentLoopContinue`), which throws `Cannot continue from message role: assistant` after a completed turn.
- Fix: resume starts a new loop with queued user prompt(s) instead of using continue (`packages/agent/src/agent.ts:255`).

## Troubleshooting

- If you queued `/compact` in an already-running TUI and then updated code, you must restart the process to pick up the changes.
- If `Compaction: queued` stays stuck:
  - Run `/debug` and inspect the reported debug log path.
  - Confirm you are running the repo source version (`./pi-test.sh` or `bash scripts/try-queued-compact.sh`), not a globally installed `pi`.
  - Confirm compaction can run (API key configured); failures should clear the queue, so “stuck queued” usually indicates the flush didn’t run.
- If compaction fails when it eventually runs, interactive `/compact` now shows an explicit error (instead of silently rejecting a background promise).

## Other queueing (related)

- While compaction is running, additional user inputs are queued in a separate “compaction queue” and flushed after compaction finishes.

## Quality follow-ups (before upstreaming)

- Patch hygiene: drop unrelated staged artifacts (e.g. tool-analysis markdown dumps), and only include the minimal set of files needed for this feature.
- Lockfile discipline: avoid `package-lock.json` churn unless required by dependency changes.
- Error reporting: interactive mode currently queues `/compact` fire-and-forget; ensure compaction failures are surfaced to the user explicitly (and decide whether queued follow-ups should resume on failure).
- Retry/auto-compaction policy: confirm the “manual queued compaction skips auto-compaction on that `agent_end`” rule is correct in all modes.
- API surface review: `Agent.requestPauseAfterTurn()` and `Agent.continueWithQueuedMessages()` are new public methods; confirm naming, docs, and invariants match existing patterns.
- Concurrency/ordering: verify compaction runs exactly once “between turns”, and that multiple queued `/compact` requests coalesce in an intentional way (currently: last non-empty `customInstructions` wins).
- Tests: add a higher-level session/mode test if there’s an existing harness (agent unit test exists, but the cross-package behavior is the risk).
- UX polish: show queue count (e.g. `Compaction: queued (n)`), and optionally show when the queued compaction actually starts/finishes.

## Where this behavior is implemented (code pointers)

- Interactive `/compact` handling: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` (queues via `session.queueCompaction()` when streaming).
- Session compaction queue + flush: `packages/coding-agent/src/core/agent-session.ts` (`queueCompaction()`, `_flushQueuedCompactions()`).
- Agent pause/resume hooks: `packages/agent/src/agent.ts` (`requestPauseAfterTurn()`, `continueWithQueuedMessages()`).
- RPC `compact`: `packages/coding-agent/src/modes/rpc/rpc-mode.ts` (dispatches to `session.queueCompaction()`).
