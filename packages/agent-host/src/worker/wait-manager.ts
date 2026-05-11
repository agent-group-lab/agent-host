import {
	COORD_WAIT_DONE,
	COORD_WAIT_START,
	type ICoordWaitDonePayload,
	type ICoordWaitStartPayload,
	type ITaskChildDeliveredPayload,
	type ITaskChildrenCompletedPayload,
	type ITaskChildrenStatusResultPayload,
	type ITaskFailedPayload,
	TASK_CHILDREN_STATUS,
} from '@agent-group-lab/contracts/messages';
import type { IProtocolEnvelope } from '@agent-group-lab/protocol';
import { nanoid } from 'nanoid';
import type { IWorkerClientPort } from '~/ports/worker-client-port';

interface IWaitingItem {
	waitId: string;
	parentTaskId: string;
	failFast: boolean;
	resolve: (value: { status: 'completed'; parentTaskId: string }) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
	epoch: number;
	recovering: boolean;
}

export interface IStartWaitInput {
	parentTaskId: string;
	failFast?: boolean;
	timeoutMs?: number;
}

interface IWaitManagerOptions {
	clientPort: IWorkerClientPort;
	createEnvelope: (
		message: Omit<
			IProtocolEnvelope<string, unknown>,
			'id' | 'seq' | 'ts' | 'v'
		>,
	) => IProtocolEnvelope<string, unknown>;
	log: (message: string) => void;
}

export class WaitManager {
	private readonly options: IWaitManagerOptions;
	private readonly waits = new Map<string, IWaitingItem>();
	private readonly childToParent = new Map<string, string>();
	private currentEpoch = 0;

	constructor(options: IWaitManagerOptions) {
		this.options = options;
	}

	startWaitForChildren = async (input: IStartWaitInput) => {
		const existing = this.waits.get(input.parentTaskId);
		if (existing) {
			throw new Error(`Wait already active for ${input.parentTaskId}`);
		}
		const waitId = nanoid();
		const failFast = input.failFast ?? true;
		const resultPromise = new Promise<{
			status: 'completed';
			parentTaskId: string;
		}>((resolve, reject) => {
			const item: IWaitingItem = {
				waitId,
				parentTaskId: input.parentTaskId,
				failFast,
				resolve,
				reject,
				epoch: this.currentEpoch,
				recovering: false,
			};
			if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
				item.timer = setTimeout(() => {
					this.finishWithError(
						input.parentTaskId,
						new Error(`wait_for_children timed out for ${input.parentTaskId}`),
					);
				}, input.timeoutMs);
			}
			this.waits.set(input.parentTaskId, item);
		});

		const startPayload: ICoordWaitStartPayload = {
			waitId,
			parentTaskId: input.parentTaskId,
		};
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: COORD_WAIT_START,
				channel: `task:${input.parentTaskId}`,
				payload: startPayload,
			}),
		);
		await this.requestChildrenStatus(input.parentTaskId);

		return await resultPromise;
	};

	handleChildrenCompleted = async (payload: ITaskChildrenCompletedPayload) => {
		const item = this.waits.get(payload.parentTaskId);
		if (!item) {
			return;
		}
		if (item.epoch !== this.currentEpoch || item.recovering) {
			return;
		}
		await this.finishSuccess(payload.parentTaskId);
	};

	handleChildDelivered = async (payload: ITaskChildDeliveredPayload) => {
		this.childToParent.set(payload.childTaskId, payload.parentTaskId);
	};

	handleTaskFailed = async (payload: ITaskFailedPayload) => {
		const parentTaskId = this.childToParent.get(payload.taskId);
		if (parentTaskId) {
			const item = this.waits.get(parentTaskId);
			if (!item || !item.failFast) {
				return;
			}
			await this.finishWithError(
				parentTaskId,
				new Error(payload.message || 'child task failed'),
			);
			return;
		}
		// Fallback: child mapping might be stale, force status re-sync for all failFast waits.
		for (const item of this.waits.values()) {
			if (!item.failFast) {
				continue;
			}
			await this.requestChildrenStatus(item.parentTaskId);
		}
	};

	handleChildrenStatusResult = async (
		payload: ITaskChildrenStatusResultPayload,
	) => {
		const item = this.waits.get(payload.parentTaskId);
		if (!item) {
			return;
		}
		for (const child of payload.children) {
			this.childToParent.set(child.taskId, payload.parentTaskId);
		}
		if (item.recovering) {
			item.epoch = this.currentEpoch;
			item.recovering = false;
		}
		if (payload.allChildrenDone) {
			await this.finishSuccess(payload.parentTaskId);
			return;
		}
		if (!item.failFast && payload.allChildrenTerminal) {
			await this.finishSuccess(payload.parentTaskId);
			return;
		}
		if (item.failFast && payload.summary.cancelled > 0) {
			await this.finishWithError(
				payload.parentTaskId,
				new Error(`children failed for ${payload.parentTaskId}`),
			);
		}
	};

	onReconnect = (epoch: number) => {
		this.currentEpoch = epoch;
		for (const item of this.waits.values()) {
			item.recovering = true;
			this.requestChildrenStatus(item.parentTaskId).catch((error) => {
				this.options.log(
					`[wait] failed to request children status: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			});
		}
	};

	onDisconnect = () => {
		for (const item of this.waits.values()) {
			item.recovering = true;
		}
	};

	rejectAll = (error: Error) => {
		for (const item of this.waits.values()) {
			if (item.timer) {
				clearTimeout(item.timer);
			}
			item.reject(error);
		}
		this.waits.clear();
	};

	private finishSuccess = async (parentTaskId: string) => {
		const item = this.waits.get(parentTaskId);
		if (!item) {
			return;
		}
		this.waits.delete(parentTaskId);
		for (const [
			childTaskId,
			mappedParentTaskId,
		] of this.childToParent.entries()) {
			if (mappedParentTaskId === parentTaskId) {
				this.childToParent.delete(childTaskId);
			}
		}
		if (item.timer) {
			clearTimeout(item.timer);
		}
		const donePayload: ICoordWaitDonePayload = {
			waitId: item.waitId,
			parentTaskId: item.parentTaskId,
			outcome: 'completed',
		};
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: COORD_WAIT_DONE,
				channel: `task:${item.parentTaskId}`,
				payload: donePayload,
			}),
		);
		item.resolve({ status: 'completed', parentTaskId: item.parentTaskId });
	};

	private finishWithError = async (parentTaskId: string, error: Error) => {
		const item = this.waits.get(parentTaskId);
		if (!item) {
			return;
		}
		this.waits.delete(parentTaskId);
		for (const [
			childTaskId,
			mappedParentTaskId,
		] of this.childToParent.entries()) {
			if (mappedParentTaskId === parentTaskId) {
				this.childToParent.delete(childTaskId);
			}
		}
		if (item.timer) {
			clearTimeout(item.timer);
		}
		const donePayload: ICoordWaitDonePayload = {
			waitId: item.waitId,
			parentTaskId: item.parentTaskId,
			outcome: 'failed',
			reason: error.message,
		};
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: COORD_WAIT_DONE,
				channel: `task:${item.parentTaskId}`,
				payload: donePayload,
			}),
		);
		item.reject(error);
	};

	private requestChildrenStatus = async (parentTaskId: string) => {
		await this.options.clientPort.send(
			this.options.createEnvelope({
				type: TASK_CHILDREN_STATUS,
				channel: `task:${parentTaskId}`,
				payload: {
					requestId: nanoid(),
					parentTaskId,
					includeArtifacts: false,
				},
			}),
		);
	};
}
