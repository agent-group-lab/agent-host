import { describe, expect, it } from 'vitest';
import type { IHostCheckpoint, ITimelineEntry } from './timeline-entry.schema';

describe('timeline contracts', () => {
	it('supports agent and transition timeline entries with replay cursor semantics', () => {
		const agentEntry: ITimelineEntry = {
			sessionId: 'session_1',
			timelineSeq: 1,
			ts: Date.now(),
			kind: 'agent',
			agentEvent: {
				taskId: 'task-1',
				agentId: 'agent-1',
				agentName: 'Agent 1',
				event: {
					id: 'evt-1',
					ts: Date.now(),
					turnId: 'turn-1',
					taskId: 'task-1',
					adapterId: 'adapter-1',
					type: 'turn:start',
				},
			},
		};
		const transitionEntry: ITimelineEntry = {
			sessionId: 'session_1',
			timelineSeq: 2,
			ts: Date.now(),
			kind: 'transition',
			transitionEvent: null,
		};
		const checkpoint: IHostCheckpoint<{ seq: number }> = {
			snapshot: { seq: 3 },
			cursor: {
				sessionId: 'session_1',
				sessionStartedAt: Date.now(),
				timelineSeq: transitionEntry.timelineSeq,
				ts: Date.now(),
			},
		};

		expect(agentEntry.kind).toBe('agent');
		expect(transitionEntry.kind).toBe('transition');
		expect(checkpoint.cursor.timelineSeq).toBe(2);
	});
});
