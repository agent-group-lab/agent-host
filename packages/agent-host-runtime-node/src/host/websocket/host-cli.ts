#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runHostCli } from '~/host/shared/run-host-cli';
import { startHostService } from './host-service';

const usage =
	'Usage: host-websocket [--listen <ws://host:port/path>] [--store-dir <path>] [--task-claim-v2]';
const defaultListen = 'ws://127.0.0.1:8787';
const defaultStoreDir = '.agent-host';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		listen: { type: 'string', default: defaultListen },
		'store-dir': { type: 'string' },
		'task-claim-v2': { type: 'boolean', default: false },
	},
	strict: true,
});

const listen = (() => {
	try {
		return new URL(values.listen ?? defaultListen);
	} catch {
		return null;
	}
})();

const port = listen?.port ? Number(listen.port) : Number.NaN;

if (
	!listen ||
	listen.protocol !== 'ws:' ||
	!Number.isInteger(port) ||
	port < 0 ||
	port > 65_535
) {
	process.stderr.write(`${usage}\n`);
	process.exit(1);
}

await runHostCli({
	label: 'host:websocket',
	usage,
	start: async () => {
		return await startHostService({
			port,
			host: listen.hostname,
			path: listen.pathname === '/' ? undefined : listen.pathname,
			storeDir: values['store-dir'] ?? defaultStoreDir,
			taskClaimV2Enabled: values['task-claim-v2'],
			onLog: (message) => {
				process.stderr.write(`[host:websocket] ${message}\n`);
			},
		});
	},
});
