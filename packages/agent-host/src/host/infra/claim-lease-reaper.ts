import { releaseTaskClaim } from '~/domain/task-board';
import type { IHostStore } from '~/store/store';

export interface IClaimLeaseReaperOptions {
	store: IHostStore;
	now?: () => number;
	onReaped?: (input: {
		taskId: string;
		agentId?: string;
		token?: string;
	}) => Promise<void> | void;
	onExecutionLeaseExpired?: (input: {
		taskId: string;
		agentId: string;
	}) => Promise<void> | void;
}

export class ClaimLeaseReaper {
	private readonly options: IClaimLeaseReaperOptions;
	private readonly now: () => number;

	constructor(options: IClaimLeaseReaperOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	scanOnce = async () => {
		const now = this.now();
		const todoEntries = this.options.store.getTaskBoardEntries({
			status: 'todo',
		});
		for (const entry of todoEntries) {
			if (entry.dispatchMode !== 'claim' || !entry.assigneeId) {
				continue;
			}
			if (
				typeof entry.claimLeaseExpiresAt !== 'number' ||
				entry.claimLeaseExpiresAt > now
			) {
				continue;
			}
			const commitment = this.options.store.getCommitmentByTaskId(entry.taskId);
			if (commitment && commitment.status === 'accepted') {
				continue;
			}
			this.options.store.setTaskBoardEntry(releaseTaskClaim(entry));
			await this.options.onReaped?.({
				taskId: entry.taskId,
				agentId: entry.assigneeId,
				token: entry.assignmentToken,
			});
		}

		if (!this.options.onExecutionLeaseExpired) {
			return;
		}

		const doingEntries = this.options.store.getTaskBoardEntries({
			status: 'doing',
		});
		for (const entry of doingEntries) {
			if (
				typeof entry.executionLeaseExpiresAt !== 'number' ||
				entry.executionLeaseExpiresAt > now
			) {
				continue;
			}
			if (!entry.assigneeId) {
				continue;
			}
			const worker = this.options.store.getWorker(entry.assigneeId);
			if (worker?.workerType !== 'session') {
				continue;
			}
			await this.options.onExecutionLeaseExpired({
				taskId: entry.taskId,
				agentId: entry.assigneeId,
			});
		}
	};
}
