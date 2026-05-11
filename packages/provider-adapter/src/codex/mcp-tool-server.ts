import { createServer, type Server as IHttpServer } from 'node:http';
import type { IToolDefinition } from '@agent-group-lab/contracts/agent';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { convertJsonSchemaToZodShape } from '~/json-schema-to-zod';
import { serializeToolResult } from '~/shared';

export interface IMcpToolServer {
	url: string;
	close: () => Promise<void>;
}

const createMcpServer = (tools: IToolDefinition[]) => {
	const mcpServer = new McpServer(
		{ name: 'swarm-tools', version: '1.0.0' },
		{ capabilities: { tools: {} } },
	);

	for (const definition of tools) {
		mcpServer.registerTool(
			definition.name,
			{
				description: definition.description,
				inputSchema: z.object(
					convertJsonSchemaToZodShape(definition.inputSchema),
				),
			},
			async (input) => {
				const result = await definition.handler(
					input as Record<string, unknown>,
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: serializeToolResult(result),
						},
					],
				};
			},
		);
	}

	return mcpServer;
};

export const startMcpToolServer = async (
	tools: IToolDefinition[],
): Promise<IMcpToolServer> => {
	const mcpServer = createMcpServer(tools);
	const activeTransports = new Set<NodeStreamableHTTPServerTransport>();
	const httpServer = await startHttpServer(mcpServer, activeTransports);
	const address = httpServer.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to bind MCP tool server');
	}

	const url = `http://127.0.0.1:${address.port}/mcp`;

	return {
		url,
		close: async () => {
			const closePromises = [...activeTransports].map((transport) =>
				transport.close().catch(() => {}),
			);
			await Promise.all(closePromises);
			await mcpServer.close().catch(() => {});
			await new Promise<void>((resolve, reject) => {
				httpServer.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
};

const startHttpServer = (
	mcpServer: McpServer,
	activeTransports: Set<NodeStreamableHTTPServerTransport>,
) => {
	return new Promise<IHttpServer>((resolve, reject) => {
		const httpServer = createServer(async (req, res) => {
			try {
				const transport = new NodeStreamableHTTPServerTransport({
					sessionIdGenerator: undefined,
					enableJsonResponse: true,
				});
				activeTransports.add(transport);

				res.on('close', () => {
					transport.close().catch(() => {});
					activeTransports.delete(transport);
				});

				await mcpServer.connect(transport);
				await transport.handleRequest(req, res);
			} catch {
				if (!res.headersSent) {
					res.writeHead(400).end();
				}
			}
		});

		httpServer.listen(0, '127.0.0.1', () => {
			resolve(httpServer);
		});

		httpServer.on('error', reject);
	});
};
