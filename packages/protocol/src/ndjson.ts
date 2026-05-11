import { nanoid } from 'nanoid';
import { parseProtocolEnvelope } from './schemas';
import type { ICreateEnvelopeInput, IProtocolEnvelope } from './types';
import { PROTOCOL_VERSION } from './types';

export class ProtocolFrameDecodeError extends Error {
	readonly frame: string;

	constructor(message: string, frame: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'ProtocolFrameDecodeError';
		this.frame = frame;
	}
}

export type IReceivedEnvelope = IProtocolEnvelope<
	string,
	Record<string, unknown>
>;

export interface IDecodeFramesResult {
	messages: IReceivedEnvelope[];
	rest: string;
}

export const createEnvelope = <TType extends string, TPayload>(
	input: ICreateEnvelopeInput<TType, TPayload>,
): IProtocolEnvelope<TType, TPayload> => {
	return {
		v: input.v ?? PROTOCOL_VERSION,
		id: input.id ?? nanoid(),
		ts: input.ts ?? Date.now(),
		seq: input.seq,
		type: input.type,
		channel: input.channel,
		roomId: input.roomId,
		actor: input.actor,
		trace: input.trace,
		payload: input.payload,
	};
};

export const encodeEnvelopeFrame = (
	message: IProtocolEnvelope<string, unknown>,
) => {
	return `${JSON.stringify(message)}\n`;
};

export const decodeEnvelopeFrame = (frame: string) => {
	const trimmedFrame = frame.trim();
	if (!trimmedFrame) {
		throw new ProtocolFrameDecodeError('Received empty protocol frame', frame);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmedFrame);
	} catch (error) {
		throw new ProtocolFrameDecodeError(
			'Protocol frame is not valid JSON',
			frame,
			{ cause: error },
		);
	}

	try {
		return parseProtocolEnvelope(parsed);
	} catch (error) {
		throw new ProtocolFrameDecodeError(
			'Protocol frame does not match envelope schema',
			frame,
			{ cause: error },
		);
	}
};

export const decodeEnvelopeFrames = (
	chunk: string,
	previousRest = '',
): IDecodeFramesResult => {
	const combined = `${previousRest}${chunk}`;
	const lines = combined.split('\n');
	const rest = lines.pop() ?? '';
	const messages: IReceivedEnvelope[] = [];

	for (const line of lines) {
		if (line.trim().length === 0) {
			continue;
		}
		messages.push(decodeEnvelopeFrame(line));
	}

	return {
		messages,
		rest,
	};
};
