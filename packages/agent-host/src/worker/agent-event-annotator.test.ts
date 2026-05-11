import { describe, expect, it } from 'vitest';
import { annotateToolStartEvent } from './agent-event-annotator';

const createToolStartEvent = (input: {
	toolName: string;
	args: Record<string, unknown>;
}) => {
	return {
		id: 'event-1',
		ts: Date.now(),
		turnId: 'turn-1',
		taskId: 'task-1',
		adapterId: 'adapter-1',
		type: 'tool:start' as const,
		toolName: input.toolName,
		args: input.args,
	};
};

describe('annotateToolStartEvent', () => {
	it('annotates ask_peer targetAgentIds', () => {
		const result = annotateToolStartEvent(
			createToolStartEvent({
				toolName: 'swarm-tools/ask_peer',
				args: { toAgentId: 'agent-b' },
			}),
		);
		expect(result.type).toBe('tool:start');
		if (result.type !== 'tool:start') {
			return;
		}
		expect(result.targetAgentIds).toEqual(['agent-b']);
		expect(result.relatedTaskIds).toBeUndefined();
	});

	it('annotates publish_claimable_tasks relatedTaskIds', () => {
		const result = annotateToolStartEvent(
			createToolStartEvent({
				toolName: 'swarm-tools/publish_claimable_tasks',
				args: {
					nodes: [{ taskId: 'task-a' }, { taskId: 'task-b' }, { foo: 'bar' }],
				},
			}),
		);
		expect(result.type).toBe('tool:start');
		if (result.type !== 'tool:start') {
			return;
		}
		expect(result.relatedTaskIds).toEqual(['task-a', 'task-b']);
	});

	it('keeps non tool:start events unchanged', () => {
		const event = {
			id: 'event-1',
			ts: Date.now(),
			turnId: 'turn-1',
			taskId: 'task-1',
			adapterId: 'adapter-1',
			type: 'tool:done' as const,
			toolName: 'swarm-tools/ask_peer',
			output: '',
			isError: false,
		};
		const result = annotateToolStartEvent(event);
		expect(result).toEqual(event);
	});
});
