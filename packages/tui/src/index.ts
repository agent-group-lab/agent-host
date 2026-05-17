#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
	BunSQLiteHistoryAdapter,
	SessionStore,
	UdsSessionPort,
	WebSocketSessionPort,
} from '@agent-group-lab/session';
import { render } from 'ink';
import React from 'react';
import { App } from './app';

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		ws: { type: 'string' },
		uds: { type: 'string' },
		name: { type: 'string' },
		adapter: { type: 'string' },
		db: { type: 'string' },
	},
	strict: true,
});

const endpointCount = Number(Boolean(values.ws)) + Number(Boolean(values.uds));

if (endpointCount !== 1 || !values.name || !values.adapter) {
	console.error(
		'Usage: agt-session (--ws <url> | --uds <socketPath>) --name <name> --adapter <id> [--db <path>]',
	);
	process.exit(1);
}

const agentId = createHash('sha256')
	.update(values.name)
	.digest('hex')
	.slice(0, 32);

const historyService = values.db
	? new BunSQLiteHistoryAdapter(new Database(values.db, { create: true }))
	: undefined;

const store = new SessionStore({
	mode: 'lead',
	workingDirectory: process.cwd(),
	port: values.uds
		? new UdsSessionPort(values.uds)
		: new WebSocketSessionPort(values.ws as string),
	historyService,
	onError: (_kind, error) => {
		// surface via store.error → status bar
		process.stderr.write(
			`[session error] ${error instanceof Error ? error.message : String(error)}\n`,
		);
	},
});

store.start(
	{ id: agentId, adapterId: values.adapter, name: values.name },
	{ sessionId: agentId },
);

const { unmount } = render(
	React.createElement(App, {
		store,
	}),
	{
		exitOnCtrlC: false,
	},
);

process.on('SIGINT', async () => {
	await store.stop();
	unmount();
	process.exit(0);
});
