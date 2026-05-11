interface IReconnectLoopOptions {
	reconnectBaseDelayMs: number;
	reconnectMaxDelayMs: number;
	maxReconnectAttempts?: number;
	isClosing: () => boolean;
	log: (message: string) => void;
	reconnectOnce: () => Promise<void>;
	onAttempt?: (attempt: number) => void;
	onGiveUp?: () => void;
}

export class ReconnectLoop {
	private readonly options: IReconnectLoopOptions;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	private reconnecting = false;

	constructor(options: IReconnectLoopOptions) {
		this.options = options;
	}

	handleDisconnected = (reason: string) => {
		if (this.options.isClosing()) {
			return;
		}
		this.scheduleReconnect(reason);
	};

	scheduleReconnect = (reason: string) => {
		if (this.options.isClosing() || this.reconnecting || this.reconnectTimer) {
			return;
		}

		const attempt = this.reconnectAttempts + 1;
		const { maxReconnectAttempts } = this.options;
		if (maxReconnectAttempts !== undefined && attempt > maxReconnectAttempts) {
			this.options.log(
				`[reconnect] giving up after ${maxReconnectAttempts} attempts (${reason})`,
			);
			this.options.onGiveUp?.();
			return;
		}

		this.reconnectAttempts = attempt;
		this.options.onAttempt?.(attempt);
		const delay = Math.min(
			this.options.reconnectBaseDelayMs * 2 ** (attempt - 1),
			this.options.reconnectMaxDelayMs,
		);
		this.options.log(
			`[reconnect] attempt ${attempt} in ${delay}ms (${reason})`,
		);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.reconnect().catch((error) => {
				this.options.log(
					`[error] reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}, delay);
	};

	isReconnecting = () => {
		return this.reconnecting;
	};

	dispose = () => {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	};

	private reconnect = async () => {
		if (this.options.isClosing() || this.reconnecting) {
			return;
		}

		let shouldRetry = false;
		this.reconnecting = true;
		try {
			await this.options.reconnectOnce();
			this.reconnectAttempts = 0;
			this.options.log('[reconnect] connected');
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown reconnect error';
			this.options.log(`[reconnect] failed: ${message}`);
			shouldRetry = true;
		} finally {
			this.reconnecting = false;
		}

		if (shouldRetry) {
			this.scheduleReconnect('reconnect failed');
		}
	};
}
