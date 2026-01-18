/**
 * Regression test: queued manual compaction should run after a turn ends,
 * even if AgentSession didn't capture a last assistant message via message_end.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("Queued compaction during streaming", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-queued-compaction-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (session) session.dispose();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession() {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					setTimeout(() => {
						stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Simulated error") });
					}, 10);
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		const modelRegistry = new ModelRegistry(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			modelRegistry,
		});

		return session;
	}

	it("should run queued compaction after agent_end even without last assistant message", async () => {
		createSession();

		const compactResult = {
			summary: "mock summary",
			firstKeptEntryId: "mock-entry-id",
			tokensBefore: 10,
		};

		const compactSpy = vi.spyOn(session, "compact").mockResolvedValue(compactResult);

		const promptPromise = session.prompt("First message").catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 1));
		expect(session.isStreaming).toBe(true);

		const compactionPromise = session.queueCompaction("Please compact");

		await promptPromise;
		await expect(compactionPromise).resolves.toEqual(compactResult);
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(compactSpy).toHaveBeenCalledWith("Please compact");
	});
});
