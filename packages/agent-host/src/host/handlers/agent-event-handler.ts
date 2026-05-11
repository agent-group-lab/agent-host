import type {
	AgentEvent,
	IAgentEventEnvelope,
} from '@agent-group-lab/contracts/agent';
import {
	AGENT_EVENT,
	type IAgentEventPayload,
} from '@agent-group-lab/contracts/messages';
import type { ITimelineEntry } from '@agent-group-lab/contracts/timeline';
import type { WorkState } from '@agent-group-lab/contracts/work';
import { getTaskIdFromWorkState } from '~/domain/work-state';
import type { ITaskBoardStore, IWorkerRegistry } from '~/store/store';
import type { IConnectionContext } from '../infra/connection-manager';
import type { IMessageGateway } from '../infra/message-gateway';

type IAgentEventHandlerStore = IWorkerRegistry & ITaskBoardStore;

interface IAgentEventHandlerOptions {
	store: IAgentEventHandlerStore;
	messageGateway: IMessageGateway;
	transitionWorkerState: (agentId: string, nextState: WorkState) => void;
	onAgentEvent?: (payload: IAgentEventEnvelope) => void;
	onTimelineEntry: (entry: ITimelineEntry) => void;
	nextTimelineSeq: () => number;
	getSessionId: () => string;
	now: () => number;
	log: (message: string) => void;
}

const isAllowedPseudoAgentEventTaskId = (taskId: string) => {
	return taskId.startsWith('direct:') || taskId.startsWith('session:');
};

const inferNextWorkState = (
	current: WorkState,
	event: AgentEvent,
): WorkState | null => {
	const coordinationToolNames = new Set(['wait_for_children']);
	const taskId = getTaskIdFromWorkState(current);
	if (!taskId) {
		return null;
	}

	switch (event.type) {
		case 'tool:start':
			if (event.toolName && coordinationToolNames.has(event.toolName)) {
				// Coordination tools are driven by explicit coord:* protocol messages.
				return null;
			}
			// Keep a single-level tool wait state for compatibility.
			if (current.kind === 'focused') {
				if (event.toolName === 'delegate_task') {
					return {
						kind: 'waiting_delegation',
						taskId,
						toolName: event.toolName,
					};
				}
				return {
					kind: 'waiting_tool',
					taskId,
					toolName: event.toolName,
				};
			}
			return null;
		case 'tool:done':
			if (event.toolName && coordinationToolNames.has(event.toolName)) {
				// Coordination tools are driven by explicit coord:* protocol messages.
				return null;
			}
			if (
				current.kind === 'waiting_tool' ||
				current.kind === 'waiting_delegation'
			) {
				return { kind: 'focused', taskId };
			}
			return null;
		case 'error':
			if (
				event.fatal &&
				(current.kind === 'focused' ||
					current.kind === 'waiting_tool' ||
					current.kind === 'waiting_delegation' ||
					current.kind === 'waiting_peer')
			) {
				return {
					kind: 'blocked',
					taskId,
					reason: event.message,
				};
			}
			return null;
		default:
			return null;
	}
};

export class AgentEventHandler {
	private readonly options: IAgentEventHandlerOptions;

	constructor(options: IAgentEventHandlerOptions) {
		this.options = options;
	}

	handleAgentEvent = async (
		context: IConnectionContext,
		parsed: IAgentEventPayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker connection can send agent:event',
			);
			return;
		}
		const taskBoard = this.options.store.getTaskBoardEntry(parsed.taskId);
		if (taskBoard?.assigneeId) {
			if (
				context.meta.agentId !== parsed.agentId ||
				taskBoard.assigneeId !== parsed.agentId
			) {
				await this.options.messageGateway.sendProtocolError(
					context.live.connection,
					'protocol',
					'Worker mismatch for task agent:event',
					{ taskId: parsed.taskId, agentId: parsed.agentId },
				);
				return;
			}
		} else if (!isAllowedPseudoAgentEventTaskId(parsed.taskId)) {
			return;
		}
		if (!taskBoard && context.meta.agentId !== parsed.agentId) {
			await this.options.messageGateway.sendProtocolError(
				context.live.connection,
				'protocol',
				'Worker mismatch for pseudo task agent:event',
				{ taskId: parsed.taskId, agentId: parsed.agentId },
			);
			return;
		}

		if (taskBoard?.requesterConnectionId) {
			await this.options.messageGateway.sendToConnection(
				taskBoard.requesterConnectionId,
				{
					type: AGENT_EVENT,
					channel: `task:${parsed.taskId}`,
					trace: {
						taskId: parsed.taskId,
						turnId: taskBoard.turnId,
					},
					payload: parsed,
				},
			);
		}
		this.options.onAgentEvent?.(parsed);
		this.options.onTimelineEntry({
			sessionId: this.options.getSessionId(),
			timelineSeq: this.options.nextTimelineSeq(),
			ts: this.options.now(),
			kind: 'agent',
			agentEvent: parsed,
		});

		const worker = this.options.store.getWorker(parsed.agentId);
		if (!worker) {
			return;
		}
		if (getTaskIdFromWorkState(worker.workState) !== parsed.taskId) {
			return;
		}

		const nextState = inferNextWorkState(worker.workState, parsed.event);
		if (!nextState) {
			return;
		}
		try {
			this.options.transitionWorkerState(worker.agentId, nextState);
		} catch {
			this.options.log(
				`Ignored invalid work state transition for worker ${worker.agentId}`,
			);
		}
	};
}
