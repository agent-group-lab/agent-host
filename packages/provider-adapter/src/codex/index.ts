import type {
	AgentEvent,
	ICapabilities,
	IProviderAdapter,
	IProviderAdapterOptions,
	IRunTurnRequest,
	IToolDefinition,
} from '@agent-group-lab/contracts/agent';
import { Codex, type Thread, type ThreadEvent } from '@openai/codex-sdk';
import { createEvent } from '~/shared';
import { mapCodexEvent } from './event-mapper';
import { type IMcpToolServer, startMcpToolServer } from './mcp-tool-server';
import { resolveExecutable } from './resolve-executable';

const computeToolFingerprint = (tools: IToolDefinition[] | undefined) => {
	if (!tools || tools.length === 0) {
		return '';
	}
	return [...tools]
		.map((t) => t.name)
		.sort()
		.join(',');
};

export class CodexAdapter implements IProviderAdapter {
	readonly id = 'codex';
	readonly displayName = 'Codex (OpenAI)';

	private client: Codex | null = null;
	private thread: Thread | null = null;
	private threadId: string | undefined;
	private threadWorkingDirectory: string | undefined;
	private mcpServer: IMcpToolServer | null = null;
	private toolFingerprint = '';
	private readonly hasFixedConversationRef: boolean;
	private conversationReadyEmitted = false;
	private activeAbortController: AbortController | null = null;

	private *handleThreadStarted(
		event: ThreadEvent,
		request: IRunTurnRequest,
	): Iterable<AgentEvent> {
		if (this.hasFixedConversationRef) return;
		if (event.type !== 'thread.started') return;

		this.threadId = event.thread_id;

		if (this.conversationReadyEmitted) return;
		this.conversationReadyEmitted = true;
		yield createEvent({
			type: 'conversation:ready',
			taskId: request.taskId,
			turnId: request.turnId,
			adapterId: this.id,
			conversationId: event.thread_id,
		});
	}

	constructor(options: IProviderAdapterOptions = {}) {
		this.threadId = options.conversationRef?.id;
		this.hasFixedConversationRef = Boolean(options.conversationRef?.id);
	}

	capabilities = async (): Promise<ICapabilities> => ({
		streaming: true,
		toolUse: true,
		codeExecution: true,
		fileRead: true,
		fileWrite: true,
	});

	abort = () => {
		this.activeAbortController?.abort();
	};

	private ensureClient = async (tools: IToolDefinition[] | undefined) => {
		const fingerprint = computeToolFingerprint(tools);

		if (this.client && fingerprint === this.toolFingerprint) {
			return;
		}

		if (this.mcpServer) {
			await this.mcpServer.close();
			this.mcpServer = null;
		}

		if (tools && tools.length > 0) {
			this.mcpServer = await startMcpToolServer(tools);
		}

		const codexPathOverride = resolveExecutable();

		const config = this.mcpServer
			? {
					mcp_servers: {
						'swarm-tools': { url: this.mcpServer.url },
					},
				}
			: undefined;

		this.client = new Codex({
			...(codexPathOverride ? { codexPathOverride } : {}),
			...(config ? { config } : {}),
		});

		this.thread = null;
		this.toolFingerprint = fingerprint;
	};

	runTurn = async function* (
		this: CodexAdapter,
		request: IRunTurnRequest,
	): AsyncIterable<AgentEvent> {
		await this.ensureClient(request.tools);
		const prompt = request.systemPromptSuffix
			? `${request.systemPromptSuffix}\n\n---\n\n${request.prompt}`
			: request.prompt;

		if (!this.thread) {
			if (this.threadId) {
				this.thread = this.client!.resumeThread(this.threadId, {
					workingDirectory:
						this.threadWorkingDirectory ?? request.workingDirectory,
				});
			} else {
				this.threadWorkingDirectory = request.workingDirectory;
				this.thread = this.client!.startThread({
					workingDirectory: this.threadWorkingDirectory,
				});
			}
		}

		const abortController = new AbortController();
		this.activeAbortController = abortController;

		try {
			const streamed = await this.thread.runStreamed(prompt, {
				signal: abortController.signal,
			});
			const ctx = {
				taskId: request.taskId,
				turnId: request.turnId,
				adapterId: this.id,
			};

			for await (const event of streamed.events) {
				if (abortController.signal.aborted) break;
				yield* this.handleThreadStarted(event, request);
				yield* mapCodexEvent(event, ctx);
			}

			if (!this.hasFixedConversationRef && !this.threadId && this.thread?.id) {
				this.threadId = this.thread.id;
				if (!this.conversationReadyEmitted) {
					this.conversationReadyEmitted = true;
					yield createEvent({
						type: 'conversation:ready',
						taskId: request.taskId,
						turnId: request.turnId,
						adapterId: this.id,
						conversationId: this.thread.id,
					});
				}
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				return;
			}
			throw err;
		} finally {
			this.activeAbortController = null;
		}
	};
}
