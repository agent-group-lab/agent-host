import type {
	ICoordWaitDonePayload,
	ICoordWaitStartPayload,
} from '@agent-group-lab/contracts/messages';
import type { WorkState } from '@agent-group-lab/contracts/work';
import type { IProtocolErrorPayload } from '@agent-group-lab/protocol';
import type { IConnectionContext } from '../infra/connection-manager';

interface ICoordinationHandlerOptions {
	sendProtocolError: (
		connection: IConnectionContext['live']['connection'],
		code: IProtocolErrorPayload['code'],
		message: string,
		details?: Record<string, unknown>,
	) => Promise<void>;
	transitionWorkerState: (agentId: string, nextState: WorkState) => void;
	resolveCurrentTaskId: (agentId: string) => string | undefined;
	log: (message: string) => void;
}

export class CoordinationHandler {
	private readonly options: ICoordinationHandlerOptions;

	constructor(options: ICoordinationHandlerOptions) {
		this.options = options;
	}

	handleCoordWaitStart = async (
		context: IConnectionContext,
		parsed: ICoordWaitStartPayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker can send coord:wait:start',
			);
			return;
		}
		const currentTaskId = this.options.resolveCurrentTaskId(
			context.meta.agentId,
		);
		const taskId = currentTaskId ?? parsed.parentTaskId;
		if (currentTaskId && currentTaskId !== parsed.parentTaskId) {
			this.options.log(
				`[coord] wait:start parentTaskId mismatch worker=${context.meta.agentId} payload=${parsed.parentTaskId} current=${currentTaskId}`,
			);
		}
		try {
			this.options.transitionWorkerState(context.meta.agentId, {
				kind: 'waiting_delegation',
				taskId,
				toolName: 'wait_for_children',
			});
		} catch {
			this.options.log(
				`Failed to transition worker ${context.meta.agentId} to waiting_delegation`,
			);
		}
	};

	handleCoordWaitDone = async (
		context: IConnectionContext,
		parsed: ICoordWaitDonePayload,
	) => {
		if (context.meta.connectionRole !== 'worker' || !context.meta.agentId) {
			await this.options.sendProtocolError(
				context.live.connection,
				'protocol',
				'Only worker can send coord:wait:done',
			);
			return;
		}
		const currentTaskId = this.options.resolveCurrentTaskId(
			context.meta.agentId,
		);
		const taskId = currentTaskId ?? parsed.parentTaskId;
		try {
			this.options.transitionWorkerState(context.meta.agentId, {
				kind: 'focused',
				taskId,
			});
		} catch {
			this.options.log(
				`Failed to transition worker ${context.meta.agentId} back to focused`,
			);
		}
	};
}
