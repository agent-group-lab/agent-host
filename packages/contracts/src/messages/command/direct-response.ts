import { z } from 'zod';

import type { CommunicationAction } from '~/agent/actions';

export const DIRECT_RESPONSE = 'direct:response' as const;

export const directAckKindSchema = z.enum([
	'queued',
	'admission_rejected',
	'peer_rejected',
]);

export const directReasonCodeSchema = z.enum([
	'queued',
	'target_offline',
	'rate_limited',
	'queue_full',
	'ttl_expired',
	'loop_detected',
	'depth_exceeded',
	'timeout',
	'rejected',
	'busy',
	'other',
]);

export const directResponsePayloadSchema = z.object({
	requestId: z.string(),
	fromAgentId: z.string(),
	fromAgentName: z.string(),
	toAgentId: z.string(),
	toAgentName: z.string(),
	action: z.custom<CommunicationAction>(
		(value) => value === 'ACK' || value === 'DELIVER',
	),
	origin: z.enum(['host', 'worker']).optional(),
	ackKind: directAckKindSchema.optional(),
	content: z.string().optional(),
	reasonCode: directReasonCodeSchema.optional(),
	reason: z.string().optional(),
});

export type DirectAckKind = z.infer<typeof directAckKindSchema>;
export type DirectReasonCode = z.infer<typeof directReasonCodeSchema>;
export type IDirectResponsePayload = z.infer<
	typeof directResponsePayloadSchema
>;
