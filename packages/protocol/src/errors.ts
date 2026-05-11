import type { IProtocolErrorPayload } from './types';

export class ProtocolError extends Error {
	readonly code: IProtocolErrorPayload['code'];
	readonly details?: Record<string, unknown>;

	constructor(payload: IProtocolErrorPayload, options?: { cause?: unknown }) {
		super(payload.message, options);
		this.name = 'ProtocolError';
		this.code = payload.code;
		this.details = payload.details;
	}
}

export const createProtocolError = (
	payload: IProtocolErrorPayload,
	options?: { cause?: unknown },
) => {
	return new ProtocolError(payload, options);
};

export const createRetryableProtocolError = (
	message: string,
	details?: Record<string, unknown>,
) => {
	return createProtocolError({
		code: 'retryable',
		message,
		details,
	});
};

export const createFatalProtocolError = (
	message: string,
	details?: Record<string, unknown>,
) => {
	return createProtocolError({
		code: 'fatal',
		message,
		details,
	});
};

export const createProtocolViolationError = (
	message: string,
	details?: Record<string, unknown>,
) => {
	return createProtocolError({
		code: 'protocol',
		message,
		details,
	});
};

export const isProtocolError = (error: unknown): error is ProtocolError => {
	return error instanceof ProtocolError;
};

export const isRetryableProtocolError = (error: unknown) => {
	if (!isProtocolError(error)) {
		return false;
	}

	return error.code === 'retryable';
};

export const toProtocolErrorPayload = (
	error: unknown,
	fallbackCode: IProtocolErrorPayload['code'] = 'fatal',
): IProtocolErrorPayload => {
	if (isProtocolError(error)) {
		return {
			code: error.code,
			message: error.message,
			details: error.details,
		};
	}

	if (error instanceof Error) {
		return {
			code: fallbackCode,
			message: error.message,
			details: {
				name: error.name,
			},
		};
	}

	return {
		code: fallbackCode,
		message: 'Unknown protocol error',
		details:
			typeof error === 'object' && error !== null
				? (error as Record<string, unknown>)
				: undefined,
	};
};
