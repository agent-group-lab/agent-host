import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { createMapperState, mapClaudeEvent } from './event-mapper';

const ctx = {
	taskId: 'task-1',
	turnId: 'turn-1',
	adapterId: 'claude',
};

describe('mapClaudeEvent', () => {
	it('maps assistant tool_use block to tool:start', () => {
		const state = createMapperState();
		const message = {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						id: 'toolu_1',
						name: 'ask_peer',
						input: {
							toAgentId: 'codex-peer',
							question: 'hello',
						},
					},
				],
			},
		} as unknown as SDKMessage;

		const mapped = mapClaudeEvent(message, ctx, state);
		const toolStart = mapped.find((event) => event.type === 'tool:start');
		expect(toolStart).toBeDefined();
		expect(
			toolStart && toolStart.type === 'tool:start' && toolStart.toolName,
		).toBe('ask_peer');
	});

	it('maps tool_use_summary to tool:done with known tool name', () => {
		const state = createMapperState();
		mapClaudeEvent(
			{
				type: 'tool_progress',
				tool_use_id: 'toolu_2',
				tool_name: 'ask_peer',
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const mapped = mapClaudeEvent(
			{
				type: 'tool_use_summary',
				summary: 'Tool completed',
				preceding_tool_use_ids: ['toolu_2'],
			} as unknown as SDKMessage,
			ctx,
			state,
		);
		const toolDone = mapped.find((event) => event.type === 'tool:done');
		expect(toolDone).toBeDefined();
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.toolName).toBe(
			'ask_peer',
		);
	});

	it('maps synthetic user tool_use_result to tool:done when summary is missing', () => {
		const state = createMapperState();
		mapClaudeEvent(
			{
				type: 'tool_progress',
				tool_use_id: 'toolu_3',
				tool_name: 'wait_for_children',
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const mapped = mapClaudeEvent(
			{
				type: 'user',
				parent_tool_use_id: 'toolu_3',
				tool_use_result: {
					ok: true,
				},
				message: {
					role: 'user',
					content: [],
				},
			} as unknown as SDKMessage,
			ctx,
			state,
		);
		const toolDone = mapped.find((event) => event.type === 'tool:done');
		expect(toolDone).toBeDefined();
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.toolName).toBe(
			'wait_for_children',
		);
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.isError).toBe(
			false,
		);
	});

	it('emits fallback tool:done on turn success when tool completion summary is missing', () => {
		const state = createMapperState();
		mapClaudeEvent(
			{
				type: 'tool_progress',
				tool_use_id: 'toolu_4',
				tool_name: 'publish_claimable_tasks',
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const mapped = mapClaudeEvent(
			{
				type: 'result',
				subtype: 'success',
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const toolDone = mapped.find((event) => event.type === 'tool:done');
		const turnEnd = mapped.find((event) => event.type === 'turn:end');
		expect(toolDone).toBeDefined();
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.toolName).toBe(
			'publish_claimable_tasks',
		);
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.isError).toBe(
			false,
		);
		expect(turnEnd).toBeDefined();
	});

	it('emits fallback error tool:done on turn error when tool completion summary is missing', () => {
		const state = createMapperState();
		mapClaudeEvent(
			{
				type: 'tool_progress',
				tool_use_id: 'toolu_5',
				tool_name: 'wait_for_children',
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const mapped = mapClaudeEvent(
			{
				type: 'result',
				subtype: 'error_during_execution',
				errors: ['timeout'],
			} as unknown as SDKMessage,
			ctx,
			state,
		);

		const toolDone = mapped.find((event) => event.type === 'tool:done');
		const errorEvent = mapped.find((event) => event.type === 'error');
		expect(toolDone).toBeDefined();
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.toolName).toBe(
			'wait_for_children',
		);
		expect(toolDone && toolDone.type === 'tool:done' && toolDone.isError).toBe(
			true,
		);
		expect(errorEvent).toBeDefined();
	});
});
