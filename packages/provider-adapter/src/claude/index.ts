import type {
	AgentEvent,
	ICapabilities,
	IProviderAdapter,
	IProviderAdapterOptions,
	IRunTurnRequest,
	IToolDefinition,
} from '@agent-group-lab/contracts/agent';
import {
	createSdkMcpServer,
	query,
	type SDKMessage,
	tool,
} from '@anthropic-ai/claude-agent-sdk';
import { convertJsonSchemaToZodShape } from '~/json-schema-to-zod';
import { createEvent, serializeToolResult } from '~/shared';
import { createMapperState, mapClaudeEvent } from './event-mapper';
import { resolveExecutable } from './resolve-executable';

const createInjectedMcpServer = (tools: IToolDefinition[] | undefined) => {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	const sdkTools = tools.map((definition) =>
		tool(
			definition.name,
			definition.description,
			convertJsonSchemaToZodShape(definition.inputSchema),
			async (input) => {
				// Provider boundary: injected tool handlers use provider-agnostic
				// Record-based payloads even though SDK infers stronger types.
				const result = await definition.handler(
					input as Record<string, unknown>,
				);
				return {
					content: [
						{
							type: 'text',
							text: serializeToolResult(result),
						},
					],
				};
			},
		),
	);
	return createSdkMcpServer({
		name: 'swarm-tools',
		tools: sdkTools,
	});
};

export class ClaudeAdapter implements IProviderAdapter {
	readonly id = 'claude';
	readonly displayName = 'Claude (Anthropic)';

	private sessionId: string | undefined;
	private readonly hasFixedConversationRef: boolean;
	private conversationReadyEmitted = false;
	private activeAbortController: AbortController | null = null;

	constructor(options: IProviderAdapterOptions = {}) {
		this.sessionId = options.conversationRef?.id;
		this.hasFixedConversationRef = Boolean(options.conversationRef?.id);
	}

	private *handleConversationId(
		msg: SDKMessage,
		request: IRunTurnRequest,
	): Iterable<AgentEvent> {
		if (this.hasFixedConversationRef) return;
		if (!('session_id' in msg) || !msg.session_id) return;

		this.sessionId = msg.session_id;

		if (this.conversationReadyEmitted) return;
		this.conversationReadyEmitted = true;
		yield createEvent({
			type: 'conversation:ready',
			taskId: request.taskId,
			turnId: request.turnId,
			adapterId: this.id,
			conversationId: msg.session_id,
		});
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

	runTurn = async function* (
		this: ClaudeAdapter,
		request: IRunTurnRequest,
	): AsyncIterable<AgentEvent> {
		const executablePath = resolveExecutable();
		const ctx = {
			taskId: request.taskId,
			turnId: request.turnId,
			adapterId: this.id,
		};
		const state = createMapperState();
		const mcpServer = createInjectedMcpServer(request.tools);
		const abortController = new AbortController();
		this.activeAbortController = abortController;

		try {
			const q = query({
				prompt: request.prompt,
				options: {
					cwd: request.workingDirectory,
					permissionMode: 'bypassPermissions',
					allowDangerouslySkipPermissions: true,
					includePartialMessages: true,
					abortController,
					...(executablePath
						? { pathToClaudeCodeExecutable: executablePath }
						: {}),
					...(this.sessionId ? { resume: this.sessionId } : {}),
					...(mcpServer ? { mcpServers: { 'swarm-tools': mcpServer } } : {}),
					...(request.systemPromptSuffix
						? {
								systemPrompt: {
									type: 'preset' as const,
									preset: 'claude_code' as const,
									append: request.systemPromptSuffix,
								},
							}
						: {}),
				},
			});

			for await (const msg of q) {
				if (abortController.signal.aborted) break;
				yield* this.handleConversationId(msg, request);
				yield* mapClaudeEvent(msg, ctx, state);
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
