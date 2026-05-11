import { z } from 'zod';

export const DIRECT_CANCEL = 'direct:cancel' as const;

export const directCancelPayloadSchema = z.object({
	requestId: z.string(),
	fromAgentId: z.string(),
	fromAgentName: z.string(),
	toAgentId: z.string(),
	toAgentName: z.string(),
	sourceTaskId: z.string().optional(),
	reasonCode: z.enum(['requester_timeout', 'requester_cancelled']).optional(),
});

export type IDirectCancelPayload = z.infer<typeof directCancelPayloadSchema>;
