import type { IReceivedEnvelope } from '@agent-group-lab/protocol';

interface IWaiter {
	matcher: (message: IReceivedEnvelope) => boolean;
	resolve: (message: IReceivedEnvelope) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

export class MessageWaiters {
	private readonly waiters = new Set<IWaiter>();

	waitForMessage = async (
		matcher: (message: IReceivedEnvelope) => boolean,
		timeoutMs = 15_000,
	) => {
		return await new Promise<IReceivedEnvelope>((resolve, reject) => {
			const waiter: IWaiter = {
				matcher,
				resolve: (message) => {
					if (waiter.timer) {
						clearTimeout(waiter.timer);
					}
					this.waiters.delete(waiter);
					resolve(message);
				},
				reject: (error) => {
					if (waiter.timer) {
						clearTimeout(waiter.timer);
					}
					this.waiters.delete(waiter);
					reject(error);
				},
			};
			waiter.timer = setTimeout(() => {
				waiter.reject(new Error('Timed out waiting for message'));
			}, timeoutMs);
			this.waiters.add(waiter);
		});
	};

	resolveMatching = (message: IReceivedEnvelope) => {
		for (const waiter of [...this.waiters]) {
			if (waiter.matcher(message)) {
				waiter.resolve(message);
			}
		}
	};

	rejectAll = (error: Error) => {
		for (const waiter of [...this.waiters]) {
			waiter.reject(error);
		}
	};
}
