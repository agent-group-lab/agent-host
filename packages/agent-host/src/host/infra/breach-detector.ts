import type { ICommitmentRecord } from '~/domain/commitment';
import type { ICommitmentStore } from '~/store/store';

export interface IBreachDetectorOptions {
	store: ICommitmentStore;
	onBreach: (commitment: ICommitmentRecord) => Promise<void> | void;
	now?: () => number;
}

export class BreachDetector {
	private readonly options: IBreachDetectorOptions;
	private readonly now: () => number;

	constructor(options: IBreachDetectorOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	scanOnce = async () => {
		const current = this.now();
		const activeCommitments = this.options.store.getActiveCommitments();
		for (const commitment of activeCommitments) {
			if (commitment.status !== 'accepted') {
				continue;
			}
			if (typeof commitment.slaDeadline !== 'number') {
				continue;
			}
			if (commitment.slaDeadline > current) {
				continue;
			}
			await this.options.onBreach(commitment);
		}
	};
}
