interface IHostCliService {
	close: () => Promise<void>;
	waitUntilClosed: () => Promise<void>;
}

export interface IRunHostCliOptions {
	label: string;
	start: () => Promise<IHostCliService>;
	usage: string;
}

export const runHostCli = async (options: IRunHostCliOptions) => {
	let host: IHostCliService | null = null;
	let closing = false;

	const close = async (signal: NodeJS.Signals) => {
		if (closing) {
			return;
		}
		closing = true;
		process.stderr.write(`[${options.label}] received ${signal}, closing\n`);
		try {
			await host?.close();
			await host?.waitUntilClosed();
			process.exit(0);
		} catch (error) {
			process.stderr.write(
				`[${options.label}] close failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			process.exit(1);
		}
	};

	process.once('SIGINT', () => {
		close('SIGINT').catch(() => {});
	});
	process.once('SIGTERM', () => {
		close('SIGTERM').catch(() => {});
	});

	try {
		host = await options.start();
		await host.waitUntilClosed();
	} catch (error) {
		process.stderr.write(
			`${options.usage}\n[${options.label}] failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	}
};
