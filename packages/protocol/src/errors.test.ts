import { describe, expect, it } from 'vitest';
import {
	createProtocolViolationError,
	createRetryableProtocolError,
	isRetryableProtocolError,
	toProtocolErrorPayload,
} from './errors';

describe('protocol errors', () => {
	it('creates protocol violation error with protocol code', () => {
		const error = createProtocolViolationError('invalid transition', {
			state: 'init',
		});

		expect(error.code).toBe('protocol');
		expect(error.message).toBe('invalid transition');
	});

	it('detects retryable protocol error', () => {
		const retryable = createRetryableProtocolError('temporary network issue');
		const generic = new Error('random');

		expect(isRetryableProtocolError(retryable)).toBe(true);
		expect(isRetryableProtocolError(generic)).toBe(false);
	});

	it('converts unknown error to payload', () => {
		const payload = toProtocolErrorPayload(new Error('boom'));

		expect(payload.code).toBe('fatal');
		expect(payload.message).toBe('boom');
	});
});
