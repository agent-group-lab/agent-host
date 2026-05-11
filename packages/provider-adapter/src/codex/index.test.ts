import type { IToolDefinition } from '@agent-group-lab/contracts/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	codexClients: [] as Array<{
		startThread: ReturnType<typeof vi.fn>;
		resumeThread: ReturnType<typeof vi.fn>;
	}>,
	startThreadImpl: vi.fn(),
	resumeThreadImpl: vi.fn(),
	startMcpToolServer: vi.fn(),
	resolveExecutable: vi.fn(),
}));

vi.mock('@openai/codex-sdk', () => {
	class Codex {
		startThread = vi.fn((options?: unknown) => mocks.startThreadImpl(options));
		resumeThread = vi.fn((id: string, options?: unknown) =>
			mocks.resumeThreadImpl(id, options),
		);

		constructor() {
			mocks.codexClients.push(this);
		}
	}

	return {
		Codex,
	};
});

vi.mock('./mcp-tool-server', () => ({
	startMcpToolServer: (tools: IToolDefinition[]) =>
		mocks.startMcpToolServer(tools),
}));

vi.mock('./resolve-executable', () => ({
	resolveExecutable: () => mocks.resolveExecutable(),
}));

import { CodexAdapter } from './index';

const createEvents = <T>(events: T[]) =>
	(async function* () {
		for (const event of events) {
			yield event;
		}
	})();

const createMockThread = (id: string | null, events: unknown[]) => {
	let currentId = id;

	return {
		get id() {
			return currentId;
		},
		runStreamed: vi.fn(async () => {
			if (!currentId) {
				const startedEvent = events.find(
					(event): event is { type: 'thread.started'; thread_id: string } =>
						typeof event === 'object' &&
						event !== null &&
						'type' in event &&
						event.type === 'thread.started' &&
						'thread_id' in event &&
						typeof event.thread_id === 'string',
				);
				currentId = startedEvent?.thread_id ?? currentId;
			}

			return {
				events: createEvents(events),
			};
		}),
	};
};

const collectEvents = async (iterable: AsyncIterable<unknown>) => {
	const events: unknown[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
};

const createMockTool = (name: string): IToolDefinition => ({
	name,
	description: `Mock tool: ${name}`,
	inputSchema: {
		type: 'object',
		properties: {},
	},
	handler: vi.fn(async () => 'ok'),
});

describe('CodexAdapter', () => {
	beforeEach(() => {
		mocks.codexClients.length = 0;
		mocks.startThreadImpl.mockReset();
		mocks.resumeThreadImpl.mockReset();
		mocks.startMcpToolServer.mockReset();
		mocks.resolveExecutable.mockReset();
	});

	it('resumes a persisted thread id after the client is recreated', async () => {
		const firstThread = createMockThread(null, [
			{ type: 'thread.started', thread_id: 'thread-1' },
			{ type: 'turn.started' },
			{
				type: 'turn.completed',
				usage: {
					input_tokens: 1,
					cached_input_tokens: 0,
					output_tokens: 1,
				},
			},
		]);
		const resumedThread = createMockThread('thread-1', [
			{ type: 'turn.started' },
			{
				type: 'turn.completed',
				usage: {
					input_tokens: 1,
					cached_input_tokens: 0,
					output_tokens: 1,
				},
			},
		]);

		mocks.startThreadImpl.mockReturnValue(firstThread);
		mocks.resumeThreadImpl.mockReturnValue(resumedThread);
		mocks.startMcpToolServer.mockResolvedValue({
			url: 'http://127.0.0.1:8787/mcp',
			close: vi.fn(async () => {}),
		});

		const adapter = new CodexAdapter();

		await collectEvents(
			adapter.runTurn({
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'first',
				workingDirectory: '/repo',
				tools: undefined,
			}),
		);

		await collectEvents(
			adapter.runTurn({
				taskId: 'task-1',
				turnId: 'turn-2',
				prompt: 'second',
				workingDirectory: '/other-repo',
				tools: [createMockTool('echo')],
			}),
		);

		expect(mocks.codexClients).toHaveLength(2);
		expect(mocks.codexClients[0]?.startThread).toHaveBeenCalledWith({
			workingDirectory: '/repo',
		});
		expect(mocks.codexClients[1]?.resumeThread).toHaveBeenCalledWith(
			'thread-1',
			{
				workingDirectory: '/repo',
			},
		);
	});
});
