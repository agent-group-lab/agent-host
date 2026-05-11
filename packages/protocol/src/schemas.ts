import { z } from 'zod';
import type { ProtocolChannel } from './constants';
import { PROTOCOL_VERSION } from './constants';

const isProtocolChannel = (value: unknown) => {
	if (typeof value !== 'string') {
		return false;
	}

	return (
		value === 'control' ||
		/^room:.+$/.test(value) ||
		/^task:.+$/.test(value) ||
		/^direct:.+$/.test(value)
	);
};

export const protocolChannelSchema = z.custom<ProtocolChannel>(
	(value) => isProtocolChannel(value),
	{
		message: 'Invalid channel format',
	},
);

export const protocolActorSchema = z.object({
	userId: z.string().min(1),
	deviceId: z.string().min(1),
	agentId: z.string().min(1).optional(),
});

export const protocolTraceSchema = z.object({
	taskId: z.string().min(1).optional(),
	turnId: z.string().min(1).optional(),
	spanId: z.string().min(1).optional(),
});

export const protocolEnvelopeSchema = z.object({
	v: z.literal(PROTOCOL_VERSION),
	id: z.string().min(1),
	ts: z.number().int().nonnegative(),
	seq: z.number().int().nonnegative(),
	type: z.string().min(1),
	channel: protocolChannelSchema,
	roomId: z.string().min(1).optional(),
	actor: protocolActorSchema.optional(),
	trace: protocolTraceSchema.optional(),
	payload: z.record(z.string(), z.unknown()),
});

export const controlHelloPayloadSchema = z.object({
	protoVersion: z.literal(PROTOCOL_VERSION),
	appVersion: z.string().min(1),
	capabilitiesHash: z.string().min(1).optional(),
});

export const controlReadyPayloadSchema = z.object({
	connectionId: z.string().min(1),
	resumedFromSeq: z.number().int().nonnegative().optional(),
});

export const controlHeartbeatPayloadSchema = z.object({
	nonce: z.string().min(1).optional(),
});

export const ackPayloadSchema = z.object({
	ackSeq: z.number().int().nonnegative(),
});

export const eventsSinceRequestPayloadSchema = z.object({
	sinceSeq: z.number().int().nonnegative(),
	limit: z.number().int().positive().max(1000).optional(),
});

export const protocolErrorPayloadSchema = z.object({
	code: z.enum(['retryable', 'fatal', 'protocol']),
	message: z.string().min(1),
	details: z.record(z.string(), z.unknown()).optional(),
});

const controlEnvelopeBaseSchema = protocolEnvelopeSchema.extend({
	channel: z.literal('control'),
});

export const controlHelloMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:hello'),
	payload: controlHelloPayloadSchema,
});

export const controlReadyMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:ready'),
	payload: controlReadyPayloadSchema,
});

export const controlHeartbeatMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:heartbeat'),
	payload: controlHeartbeatPayloadSchema,
});

export const ackMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:ack'),
	payload: ackPayloadSchema,
});

export const eventsSinceRequestMessageSchema = controlEnvelopeBaseSchema.extend(
	{
		type: z.literal('control:events-since'),
		payload: eventsSinceRequestPayloadSchema,
	},
);

export const eventsSinceResultPayloadSchema = z.object({
	sinceSeq: z.number().int().nonnegative(),
	nextSeq: z.number().int().nonnegative(),
	hasMore: z.boolean(),
	events: z.array(protocolEnvelopeSchema),
});

export const eventsSinceResultMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:events-since:result'),
	payload: eventsSinceResultPayloadSchema,
});

export const controlErrorMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:error'),
	payload: protocolErrorPayloadSchema,
});

export const controlDisconnectReasonSchema = z.enum([
	'agent_limit_exceeded',
	'room_closed',
	'kicked',
	'maintenance',
]);

export const controlDisconnectPayloadSchema = z.object({
	reason: controlDisconnectReasonSchema,
	message: z.string().min(1),
	retryable: z.boolean(),
	retryAfterMs: z.number().int().nonnegative().optional(),
});

export const controlDisconnectMessageSchema = controlEnvelopeBaseSchema.extend({
	type: z.literal('control:disconnect'),
	payload: controlDisconnectPayloadSchema,
});

export const controlMessageSchema = z.discriminatedUnion('type', [
	controlHelloMessageSchema,
	controlReadyMessageSchema,
	controlHeartbeatMessageSchema,
	ackMessageSchema,
	eventsSinceRequestMessageSchema,
	eventsSinceResultMessageSchema,
	controlErrorMessageSchema,
	controlDisconnectMessageSchema,
]);

export const parseProtocolEnvelope = (input: unknown) => {
	return protocolEnvelopeSchema.parse(input);
};

export const safeParseProtocolEnvelope = (input: unknown) => {
	return protocolEnvelopeSchema.safeParse(input);
};

export const parseControlMessage = (input: unknown) => {
	return controlMessageSchema.parse(input);
};

export const safeParseControlMessage = (input: unknown) => {
	return controlMessageSchema.safeParse(input);
};
