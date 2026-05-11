import type { AgentEvent } from '@agent-group-lab/contracts/agent';
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import { createEvent } from '~/shared';

interface IMapperContext {
	taskId: string;
	turnId: string;
	adapterId: string;
}

export const mapCodexEvent = (
	event: ThreadEvent,
	ctx: IMapperContext,
): AgentEvent[] => {
	const base = {
		taskId: ctx.taskId,
		turnId: ctx.turnId,
		adapterId: ctx.adapterId,
	};

	switch (event.type) {
		case 'turn.started':
			return [createEvent({ ...base, type: 'turn:start' })];

		case 'turn.completed':
			return [createEvent({ ...base, type: 'turn:end' })];

		case 'turn.failed':
			return [
				createEvent({
					...base,
					type: 'error',
					message: event.error.message,
					fatal: true,
				}),
			];

		case 'error':
			return [
				createEvent({
					...base,
					type: 'error',
					message: event.message,
					fatal: true,
				}),
			];

		case 'item.updated':
			if (event.item.type === 'agent_message') {
				return [
					createEvent({
						...base,
						type: 'text:delta',
						content: event.item.text,
					}),
				];
			}
			return [];

		case 'item.completed':
			return mapItemCompleted(event.item, base);

		case 'item.started':
			return mapItemStarted(event.item, base);

		case 'thread.started':
			return [];

		default:
			return [];
	}
};

const mapItemCompleted = (
	item: ThreadItem,
	base: { taskId: string; turnId: string; adapterId: string },
): AgentEvent[] => {
	switch (item.type) {
		case 'agent_message':
			return [
				createEvent({
					...base,
					type: 'text:done',
					content: item.text,
				}),
			];

		case 'command_execution':
			return [
				createEvent({
					...base,
					type: 'tool:done',
					toolName: 'command_execution',
					output: item.aggregated_output,
					isError: item.status === 'failed',
				}),
			];

		case 'file_change':
			return item.changes.map((change) =>
				createEvent({
					...base,
					type: 'file:change' as const,
					filePath: change.path,
					operation: change.kind,
				}),
			);

		case 'mcp_tool_call':
			return [
				createEvent({
					...base,
					type: 'tool:done',
					toolName: `${item.server}/${item.tool}`,
					output: item.error?.message ?? JSON.stringify(item.result ?? ''),
					isError: item.status === 'failed',
				}),
			];

		default:
			return [];
	}
};

const mapItemStarted = (
	item: ThreadItem,
	base: { taskId: string; turnId: string; adapterId: string },
): AgentEvent[] => {
	switch (item.type) {
		case 'command_execution':
			return [
				createEvent({
					...base,
					type: 'tool:start',
					toolName: 'command_execution',
					args: { command: item.command },
				}),
			];

		case 'mcp_tool_call':
			return [
				createEvent({
					...base,
					type: 'tool:start',
					toolName: `${item.server}/${item.tool}`,
					args: (item.arguments as Record<string, unknown>) ?? {},
				}),
			];

		default:
			return [];
	}
};
