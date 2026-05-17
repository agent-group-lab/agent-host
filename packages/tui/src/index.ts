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

const defaultConnect = '/tmp/swarm-host.sock';

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		connect: { type: 'string', default: defaultConnect },
		name: { type: 'string' },
		adapter: { type: 'string' },
		db: { type: 'string' },
	},
	strict: true,
});

if (!values.connect || !values.name || !values.adapter) {
	console.error(
		'Usage: agt-session [--connect <endpoint>] --name <name> --adapter <id> [--db <path>]',
	);
	process.exit(1);
}

const createSessionPort = (connect: string) => {
	if (connect.startsWith('ws://') || connect.startsWith('wss://')) {
		return new WebSocketSessionPort(connect);
	}
	return new UdsSessionPort(connect);
};

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
	port: createSessionPort(values.connect),
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

let unmount = () => {};
let isExiting = false;
const exit = async () => {
	if (isExiting) {
		return;
	}
	isExiting = true;
	await store.stop();
	unmount();
	process.exit(0);
};

const rendered = render(
	React.createElement(App, {
		onExit: exit,
		store,
	}),
	{
		exitOnCtrlC: false,
	},
);
unmount = rendered.unmount;

process.on('SIGINT', async () => {
	await exit();
});

process.on('SIGTERM', async () => {
	await exit();
});
