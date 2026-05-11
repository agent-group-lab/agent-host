import { describe, expect, it } from 'vitest';
import {
	createEnvelope,
	decodeEnvelopeFrame,
	decodeEnvelopeFrames,
	encodeEnvelopeFrame,
	ProtocolFrameDecodeError,
} from './ndjson';

describe('ndjson protocol framing', () => {
	it('encodes and decodes a single frame', () => {
		const envelope = createEnvelope({
			seq: 10,
			type: 'control:heartbeat',
			channel: 'control',
			payload: { nonce: 'n1' },
			id: 'evt_heartbeat',
			ts: 1700000000000,
		});

		const frame = encodeEnvelopeFrame(envelope);
		const decoded = decodeEnvelopeFrame(frame);

		expect(decoded.id).toBe('evt_heartbeat');
		expect(decoded.seq).toBe(10);
	});

	it('decodes multiple frames with rest buffer', () => {
		const frame1 = encodeEnvelopeFrame(
			createEnvelope({
				seq: 1,
				type: 'control:ack',
				channel: 'control',
				payload: { ackSeq: 0 },
				id: 'evt_1',
				ts: 1700000000001,
			}),
		);
		const frame2 = encodeEnvelopeFrame(
			createEnvelope({
				seq: 2,
				type: 'control:heartbeat',
				channel: 'control',
				payload: { nonce: 'n2' },
				id: 'evt_2',
				ts: 1700000000002,
			}),
		);
		const partial = '{"v":1';
		const combined = `${frame1}${frame2}${partial}`;

		const result = decodeEnvelopeFrames(combined);

		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].id).toBe('evt_1');
		expect(result.messages[1].id).toBe('evt_2');
		expect(result.rest).toBe(partial);
	});

	it('throws typed error when frame is invalid', () => {
		expect(() => {
			decodeEnvelopeFrame('{"x":1}\n');
		}).toThrow(ProtocolFrameDecodeError);
	});
});
