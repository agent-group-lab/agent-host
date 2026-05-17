#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runHostCli } from '~/host/shared/run-host-cli';
import { startHostService } from './host-service';

const usage =
	'Usage: host-uds [--listen <socketPath>] [--store-dir <path>] [--task-claim-v2]';
const defaultListen = '/tmp/swarm-host.sock';
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

if (!values.listen) {
	process.stderr.write(`${usage}\n`);
	process.exit(1);
}

await runHostCli({
	label: 'host:uds',
	usage,
	start: async () => {
		return await startHostService({
			socketPath: values.listen,
			storeDir: values['store-dir'] ?? defaultStoreDir,
			taskClaimV2Enabled: values['task-claim-v2'],
			onLog: (message) => {
				process.stderr.write(`[host:uds] ${message}\n`);
			},
		});
	},
});
