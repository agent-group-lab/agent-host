import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import {
	type ICommitmentRecord,
	type ITransitionCommitmentInput,
	transitionCommitment,
} from '~/domain/commitment';
import {
	type IDelegationRecord,
	type ITransitionDelegationInput,
	transitionDelegation,
} from '~/domain/delegation';
import type { IHostStore } from '~/store/store';

interface IAgreementServiceOptions {
	store: IHostStore;
	onTransitionEvents: (events: ITransitionEvent[]) => void;
}

export class AgreementService {
	private readonly options: IAgreementServiceOptions;

	constructor(options: IAgreementServiceOptions) {
		this.options = options;
	}

	applyCommitmentTransition = (
		input: ITransitionCommitmentInput,
	): ICommitmentRecord => {
		const result = transitionCommitment(input);
		this.options.store.setCommitment(result.state);
		this.options.onTransitionEvents(result.domainEvents);
		return result.state;
	};

	applyDelegationTransition = (
		input: ITransitionDelegationInput,
	): IDelegationRecord => {
		const result = transitionDelegation(input);
		this.options.store.setDelegation(result.state);
		this.options.onTransitionEvents(result.domainEvents);
		return result.state;
	};

	findActiveDelegationByTask = (
		taskId: string,
		delegateeId: string,
	): IDelegationRecord | undefined => {
		return this.options.store
			.getDelegationsByDelegatee(delegateeId)
			.find(
				(delegation) =>
					delegation.delegatedTaskId === taskId &&
					(delegation.status === 'pending' || delegation.status === 'accepted'),
			);
	};
}
