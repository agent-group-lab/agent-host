import type { IToolDefinition } from '@agent-group-lab/contracts/agent';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type IMcpToolServer, startMcpToolServer } from './mcp-tool-server';

interface IJsonRpcSuccess<TResult> {
	jsonrpc: '2.0';
	id: number;
	result: TResult;
}

interface IJsonRpcError {
	jsonrpc: '2.0';
	id: number | null;
	error: {
		code: number;
		message: string;
	};
}

const createMcpClient = async (url: string) => {
	await fetch(url, {
		method: 'POST',
		headers: createMcpHeaders(),
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: LATEST_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {
					name: 'test-client',
					version: '1.0.0',
				},
			},
		}),
	});

	await fetch(url, {
		method: 'POST',
		headers: createMcpHeaders(),
		body: JSON.stringify({
			jsonrpc: '2.0',
			method: 'notifications/initialized',
		}),
	});

	return {
		listTools: async () => {
			const response = await sendJsonRpcRequest<{ tools: { name: string }[] }>(
				url,
				{
					id: 2,
					method: 'tools/list',
					params: {},
				},
			);
			return response.tools;
		},
		callTool: async (name: string, args: Record<string, unknown>) => {
			const response = await sendJsonRpcRequest<{
				content: Array<{ type: string; text: string }>;
			}>(url, {
				id: 3,
				method: 'tools/call',
				params: {
					name,
					arguments: args,
				},
			});
			return response;
		},
	};
};

const sendJsonRpcRequest = async <TResult>(
	url: string,
	request: {
		id: number;
		method: string;
		params: Record<string, unknown>;
	},
) => {
	const response = await fetch(url, {
		method: 'POST',
		headers: createMcpHeaders(),
		body: JSON.stringify({
			jsonrpc: '2.0',
			...request,
		}),
	});

	const payload = (await response.json()) as
		| IJsonRpcSuccess<TResult>
		| IJsonRpcError;

	if ('error' in payload) {
		throw new Error(payload.error.message);
	}

	return payload.result;
};

const createMcpHeaders = () => ({
	Accept: 'application/json, text/event-stream',
	'Content-Type': 'application/json',
	'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
});

describe('startMcpToolServer', () => {
	let server: IMcpToolServer | null = null;

	afterEach(async () => {
		if (server) {
			await server.close();
			server = null;
		}
	});

	const createMockTool = (
		name: string,
		handler: (input: Record<string, unknown>) => Promise<unknown>,
	): IToolDefinition => ({
		name,
		description: `Mock tool: ${name}`,
		inputSchema: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
			required: ['message'],
		},
		handler: vi.fn(handler),
	});

	it('binds to 127.0.0.1 and returns a valid URL', async () => {
		const tool = createMockTool('echo', async (input) => input.message);
		server = await startMcpToolServer([tool]);

		expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
	});

	it('exposes tools callable via MCP client', async () => {
		const tool = createMockTool(
			'echo',
			async (input) => `echo: ${input.message}`,
		);
		server = await startMcpToolServer([tool]);

		const client = await createMcpClient(server.url);
		const result = await client.callTool('echo', { message: 'hello' });

		expect(result.content).toEqual([{ type: 'text', text: 'echo: hello' }]);
		expect(tool.handler).toHaveBeenCalledWith({ message: 'hello' });
	});

	it('handles multiple tools', async () => {
		const add = createMockTool('add', async () => 42);
		const greet = createMockTool(
			'greet',
			async (input) => `hi ${input.message}`,
		);
		server = await startMcpToolServer([add, greet]);

		const client = await createMcpClient(server.url);
		const tools = await client.listTools();
		const toolNames = tools.map((tool) => tool.name).sort();
		expect(toolNames).toEqual(['add', 'greet']);

		const result = await client.callTool('greet', { message: 'world' });
		expect(result.content).toEqual([{ type: 'text', text: 'hi world' }]);
	});

	it('shuts down cleanly', async () => {
		const tool = createMockTool('noop', async () => 'ok');
		server = await startMcpToolServer([tool]);
		const url = server.url;

		await server.close();
		server = null;

		await expect(
			fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
			}),
		).rejects.toThrow();
	});
});
