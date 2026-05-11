import type { AgentEvent } from '@agent-group-lab/contracts/agent';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createEvent } from '~/shared';

interface IMapperContext {
	taskId: string;
	turnId: string;
	adapterId: string;
}

interface IMapperState {
	turnStarted: boolean;
	seenToolIds: Set<string>;
	toolNamesById: Map<string, string>;
	completedToolIds: Set<string>;
}

export const createMapperState = (): IMapperState => ({
	turnStarted: false,
	seenToolIds: new Set(),
	toolNamesById: new Map(),
	completedToolIds: new Set(),
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isToolResultError = (value: unknown) => {
	if (!isRecord(value)) {
		return false;
	}
	return value.is_error === true;
};

const stringifyToolOutput = (value: unknown) => {
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value ?? null);
	} catch {
		return String(value);
	}
};

const emitPendingToolDone = (input: {
	base: {
		taskId: string;
		turnId: string;
		adapterId: string;
	};
	state: IMapperState;
	events: AgentEvent[];
	isError: boolean;
	output: string;
}) => {
	for (const toolUseId of input.state.seenToolIds) {
		if (input.state.completedToolIds.has(toolUseId)) {
			continue;
		}
		input.state.completedToolIds.add(toolUseId);
		input.events.push(
			createEvent({
				...input.base,
				type: 'tool:done',
				toolName: input.state.toolNamesById.get(toolUseId) ?? 'unknown_tool',
				output: input.output,
				isError: input.isError,
			}),
		);
	}
};

export const mapClaudeEvent = (
	msg: SDKMessage,
	ctx: IMapperContext,
	state: IMapperState,
): AgentEvent[] => {
	const base = {
		taskId: ctx.taskId,
		turnId: ctx.turnId,
		adapterId: ctx.adapterId,
	};
	const events: AgentEvent[] = [];

	switch (msg.type) {
		case 'assistant': {
			if (!state.turnStarted) {
				state.turnStarted = true;
				events.push(createEvent({ ...base, type: 'turn:start' }));
			}

			const textParts: string[] = [];
			for (const block of msg.message.content) {
				if (block.type === 'text') {
					textParts.push(block.text);
				}
				if (block.type === 'tool_use') {
					const toolId = block.id;
					const toolName = block.name;
					if (!state.seenToolIds.has(toolId)) {
						state.seenToolIds.add(toolId);
						state.toolNamesById.set(toolId, toolName);
						events.push(
							createEvent({
								...base,
								type: 'tool:start',
								toolName,
								args: isRecord(block.input) ? block.input : {},
							}),
						);
					}
				}
			}
			if (textParts.length > 0) {
				events.push(
					createEvent({
						...base,
						type: 'text:done',
						content: textParts.join(''),
					}),
				);
			}
			break;
		}

		case 'stream_event': {
			const evt = msg.event;
			if (
				evt.type === 'content_block_delta' &&
				evt.delta.type === 'text_delta'
			) {
				events.push(
					createEvent({
						...base,
						type: 'text:delta',
						content: evt.delta.text,
					}),
				);
			}
			break;
		}

		case 'tool_progress': {
			if (!state.seenToolIds.has(msg.tool_use_id)) {
				state.seenToolIds.add(msg.tool_use_id);
				state.toolNamesById.set(msg.tool_use_id, msg.tool_name);
				events.push(
					createEvent({
						...base,
						type: 'tool:start',
						toolName: msg.tool_name,
						args: {},
					}),
				);
			}
			break;
		}

		case 'tool_use_summary': {
			for (const toolUseId of msg.preceding_tool_use_ids) {
				if (state.completedToolIds.has(toolUseId)) {
					continue;
				}
				state.completedToolIds.add(toolUseId);
				events.push(
					createEvent({
						...base,
						type: 'tool:done',
						toolName: state.toolNamesById.get(toolUseId) ?? 'unknown_tool',
						output: msg.summary,
						isError: false,
					}),
				);
			}
			break;
		}

		case 'user': {
			const toolUseId = msg.parent_tool_use_id;
			if (!toolUseId || state.completedToolIds.has(toolUseId)) {
				break;
			}
			state.completedToolIds.add(toolUseId);
			events.push(
				createEvent({
					...base,
					type: 'tool:done',
					toolName: state.toolNamesById.get(toolUseId) ?? 'unknown_tool',
					output: stringifyToolOutput(msg.tool_use_result ?? msg.message),
					isError: isToolResultError(msg.tool_use_result),
				}),
			);
			break;
		}

		case 'result': {
			if (msg.subtype === 'success') {
				emitPendingToolDone({
					base,
					state,
					events,
					isError: false,
					output: 'completed_on_turn_end',
				});
				events.push(createEvent({ ...base, type: 'turn:end' }));
			} else {
				const errors = 'errors' in msg ? (msg.errors as string[]) : [];
				emitPendingToolDone({
					base,
					state,
					events,
					isError: true,
					output: errors.join('; ') || msg.subtype,
				});
				events.push(
					createEvent({
						...base,
						type: 'error',
						message: errors.join('; ') || msg.subtype,
						fatal: true,
					}),
				);
			}
			break;
		}

		default:
			break;
	}

	return events;
};
