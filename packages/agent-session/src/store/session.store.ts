import type { IConversationRef } from '@agent-group-lab/contracts/agent';
import type { IAgentEventPayload } from '@agent-group-lab/contracts/messages';
import { action, computed, observable, runInAction } from 'mobx';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { IEventLogEntry } from '~/contracts/event-log.contract';
import type { IHistoryService } from '~/contracts/history.contract';
import type {
	ISessionPort,
	ISessionWorkerHandle,
} from '~/contracts/port.contract';
import type {
	ISessionStatus,
	ISessionWorkerMode,
} from '~/contracts/status.contract';

const getErrorMessage = (error: unknown, fallback: string) => {
	return error instanceof Error ? error.message : fallback;
};

export interface ISessionStoreOptions<TAgent extends ISessionAgent> {
	mode: ISessionWorkerMode;
	workingDirectory?: string;
	port: ISessionPort<TAgent>;
	historyService?: IHistoryService;
	onConversationReady?: (
		agent: TAgent,
		conversationId: string,
	) => Promise<void> | void;
	onError?: (kind: 'history' | 'conversation', error: unknown) => void;
}

export interface IStartOptions {
	sessionId?: string;
	conversationRef?: IConversationRef;
}

export class SessionStore<TAgent extends ISessionAgent> {
	@observable accessor status: ISessionStatus = 'idle';
	@observable accessor statusMessage: string | null = null;
	@observable accessor error: string | null = null;
	@observable accessor events: IEventLogEntry[] = [];
	@observable accessor streamingText = '';
	@observable accessor isProcessing = false;
	@observable accessor reconnectInfo: {
		attempt: number;
		maxAttempts: number;
	} | null = null;
	@observable accessor rejectedReason: string | null = null;

	private _agent: TAgent | null = null;
	private _sessionId: string | null = null;
	private _worker: ISessionWorkerHandle | null = null;
	private _conversationId: string | null = null;
	private _startGeneration = 0;

	private readonly _options: ISessionStoreOptions<TAgent>;

	constructor(options: ISessionStoreOptions<TAgent>) {
		this._options = options;
	}

	@computed
	get isActive() {
		return this.status === 'running' && this._worker !== null;
	}

	@computed
	get hasContent() {
		return this.events.length > 0 || this.streamingText.length > 0;
	}

	@action.bound
	start(agent: TAgent, options?: IStartOptions) {
		const generation = ++this._startGeneration;
		this._agent = agent;
		this._sessionId = options?.sessionId ?? agent.id;
		this.status = 'starting';
		this.statusMessage = null;
		this.error = null;
		this.streamingText = '';

		this._loadHistory(generation, this._sessionId).catch(() => {});
		this._runStart(agent, generation, options?.conversationRef).catch(() => {});
	}

	@action.bound
	async stop() {
		this._startGeneration++;

		const worker = this._worker;
		this._worker = null;
		this._agent = null;
		this._sessionId = null;
		this._conversationId = null;
		this.status = 'idle';
		this.statusMessage = null;
		this.error = null;
		this.streamingText = '';
		this.reconnectInfo = null;
		this.rejectedReason = null;
		this.isProcessing = false;

		if (worker) {
			await worker.close();
		}
	}

	@action.bound
	cancel() {
		this._worker?.cancelRunLocal();
		this.isProcessing = false;
		this.streamingText = '';
	}

	@action.bound
	async sendPrompt(prompt: string) {
		const content = prompt.trim();
		if (!content) {
			return;
		}

		if (!this._worker) {
			throw new Error('Session unavailable');
		}

		const promptEntry: IEventLogEntry = { kind: 'prompt', content };
		this.events.push(promptEntry);

		const sessionId = this._sessionId;
		if (sessionId) {
			this._options.historyService
				?.appendEvent(sessionId, promptEntry)
				.catch((e: unknown) => {
					this._options.onError?.('history', e);
				});
		}

		this.isProcessing = true;
		try {
			const result = await this._worker.runLocal({
				prompt: content,
				workingDirectory: this._options.workingDirectory ?? process.cwd(),
			});
			if (result.status === 'failed' || result.status === 'busy') {
				const message =
					result.status === 'busy'
						? result.activeTaskId
							? `Agent is busy (task: ${result.activeTaskId})`
							: 'Agent is busy'
						: (result.reason ?? 'Prompt delivery failed');
				const errorEntry: IEventLogEntry = { kind: 'error', message };
				runInAction(() => {
					this.events.push(errorEntry);
				});
				this._appendHistoryEvent(errorEntry);
				throw new Error(message);
			}
		} finally {
			runInAction(() => {
				this.isProcessing = false;
			});
		}
	}

	@action.bound
	handleAgentEvent(payload: IAgentEventPayload) {
		const event = payload.event;

		if (event.type === 'conversation:ready') {
			if (!this._agent) {
				return;
			}
			this._handleConversationReady(this._agent, event.conversationId).catch(
				() => {},
			);
			return;
		}

		if (event.type === 'text:delta') {
			this.streamingText += event.content;
			return;
		}

		if (event.type === 'text:done') {
			this.streamingText = '';
			const textEntry: IEventLogEntry = {
				kind: 'text',
				content: event.content,
			};
			this.events.push(textEntry);
			this._appendHistoryEvent(textEntry);
			return;
		}

		if (event.type === 'tool:start') {
			this.events.push({ kind: 'tool', toolName: event.toolName, done: false });
			return;
		}

		if (event.type === 'tool:done') {
			const toolEntry: IEventLogEntry = {
				kind: 'tool',
				toolName: event.toolName,
				done: true,
				output: event.output,
				isError: event.isError,
			};
			this.events.push(toolEntry);
			this._appendHistoryEvent(toolEntry);
			return;
		}

		if (event.type === 'file:change') {
			const fileEntry: IEventLogEntry = {
				kind: 'file',
				filePath: event.filePath,
				operation: event.operation,
			};
			this.events.push(fileEntry);
			this._appendHistoryEvent(fileEntry);
			return;
		}

		if (event.type === 'error') {
			const errorEntry: IEventLogEntry = {
				kind: 'error',
				message: event.message,
			};
			this.events.push(errorEntry);
			this._appendHistoryEvent(errorEntry);
		}
	}

	private _appendHistoryEvent(entry: IEventLogEntry) {
		const sessionId = this._sessionId;
		if (!sessionId) {
			return;
		}
		this._options.historyService
			?.appendEvent(sessionId, entry)
			.catch((e: unknown) => {
				this._options.onError?.('history', e);
			});
	}

	private async _loadHistory(generation: number, sessionId: string) {
		let history: IEventLogEntry[];
		try {
			history = await (this._options.historyService?.loadHistory(sessionId) ??
				Promise.resolve([]));
		} catch (e) {
			this._options.onError?.('history', e);
			return;
		}

		if (this._startGeneration !== generation || history.length === 0) {
			return;
		}

		runInAction(() => {
			this.events = [...history];
		});
	}

	private async _runStart(
		agent: TAgent,
		generation: number,
		conversationRef?: IConversationRef,
	) {
		let worker: ISessionWorkerHandle | null = null;

		try {
			if (conversationRef) {
				this._conversationId = conversationRef.id;
			}

			if (this._startGeneration !== generation) {
				return;
			}

			worker = await this._options.port.createWorker({
				mode: this._options.mode,
				agent,
				conversationRef,
				onEvent: (payload) => {
					if (this._startGeneration === generation) {
						this.handleAgentEvent(payload);
					}
				},
				onLog: (message) => {
					if (this._startGeneration === generation) {
						runInAction(() => {
							this.statusMessage = message;
						});
					}
				},
			});

			if (this._startGeneration !== generation) {
				worker.close().catch(() => {});
				return;
			}

			worker.onLifecycleEvent((event) => {
				if (this._startGeneration !== generation) {
					return;
				}
				runInAction(() => {
					if (event.type === 'disconnected') {
						this.status = 'disconnected';
						this.reconnectInfo = null;
					} else if (event.type === 'reconnect_attempt') {
						this.reconnectInfo = {
							attempt: event.attempt,
							maxAttempts: event.maxAttempts,
						};
					} else if (event.type === 'reconnected') {
						this.status = 'running';
						this.reconnectInfo = null;
					} else if (event.type === 'rejected') {
						this.status = 'rejected';
						this.rejectedReason = event.reason;
					} else if (event.type === 'gave_up') {
						this.status = 'rejected';
						this.rejectedReason = 'max_reconnect_attempts_exceeded';
					}
				});
			});

			await worker.start();

			runInAction(() => {
				this._worker = worker;
				this.status = 'running';
				this.statusMessage = null;
			});
		} catch (error) {
			if (this._startGeneration !== generation) {
				worker?.close().catch(() => {});
				return;
			}

			runInAction(() => {
				this.status = 'error';
				this.statusMessage = null;
				this.error = getErrorMessage(error, 'Failed to start worker');
			});
		}
	}

	private async _handleConversationReady(
		agent: TAgent,
		conversationId: string,
	) {
		if (this._conversationId === conversationId) {
			return;
		}

		this._conversationId = conversationId;

		try {
			await this._options.onConversationReady?.(agent, conversationId);
		} catch (e) {
			this._options.onError?.('conversation', e);
		}
	}
}
