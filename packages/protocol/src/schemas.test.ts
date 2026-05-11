import { describe, expect, it } from 'vitest';
import {
	ackMessageSchema,
	parseControlMessage,
	parseProtocolEnvelope,
	safeParseProtocolEnvelope,
} from './schemas';

describe('protocol envelope schema', () => {
	it('parses a valid envelope', () => {
		const message = parseProtocolEnvelope({
			v: 1,
			id: 'evt_1',
			ts: 1700000000000,
			seq: 42,
			type: 'task:assign',
			channel: 'task:task_1',
			roomId: 'room_1',
			payload: { prompt: 'hello' },
		});

		expect(message.type).toBe('task:assign');
		expect(message.seq).toBe(42);
	});

	it('rejects invalid channel format', () => {
		const result = safeParseProtocolEnvelope({
			v: 1,
			id: 'evt_1',
			ts: 1700000000000,
			seq: 1,
			type: 'task:assign',
			channel: 'tasks:bad',
			payload: {},
		});

		expect(result.success).toBe(false);
	});

	it('strips unknown fields for forward compatibility', () => {
		const message = parseProtocolEnvelope({
			v: 1,
			id: 'evt_1',
			ts: 1700000000000,
			seq: 1,
			type: 'task:assign',
			channel: 'task:task_1',
			payload: {},
			unknownKey: 'ignored',
		});

		expect('unknownKey' in message).toBe(false);
	});
});

describe('control message schema', () => {
	it('parses ack message', () => {
		const message = ackMessageSchema.parse({
			v: 1,
			id: 'evt_ack_1',
			ts: 1700000000000,
			seq: 2,
			type: 'control:ack',
			channel: 'control',
			payload: {
				ackSeq: 1,
			},
		});

		expect(message.payload.ackSeq).toBe(1);
	});

	it('parses eventsSince result message', () => {
		const message = parseControlMessage({
			v: 1,
			id: 'evt_res_1',
			ts: 1700000000000,
			seq: 5,
			type: 'control:events-since:result',
			channel: 'control',
			payload: {
				sinceSeq: 3,
				nextSeq: 6,
				hasMore: false,
				events: [
					{
						v: 1,
						id: 'evt_4',
						ts: 1700000000004,
						seq: 4,
						type: 'task:assigned',
						channel: 'task:task_1',
						payload: {
							taskId: 'task_1',
						},
					},
				],
			},
		});

		expect(message.type).toBe('control:events-since:result');
		if (message.type !== 'control:events-since:result') {
			throw new Error('Expected control:events-since:result message');
		}
		expect(message.payload.events).toHaveLength(1);
	});
});
