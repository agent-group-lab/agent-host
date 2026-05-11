import { z } from 'zod';

import { nonNegativeIntegerSchema } from '~/shared/schemas';

export const DIRECT_REQUEST = 'direct:request' as const;

export const directRequestPayloadSchema = z.object({
	requestId: z.string(),
	fromAgentId: z.string(),
	fromAgentName: z.string(),
	toAgentId: z.string(),
	toAgentName: z.string(),
	prompt: z.string(),
	workingDirectory: z.string().optional(),
	sourceTaskId: z.string().optional(),
	timeoutMs: nonNegativeIntegerSchema.optional(),
	ttlMs: nonNegativeIntegerSchema.optional(),
	hopCount: nonNegativeIntegerSchema.optional(),
	maxHops: nonNegativeIntegerSchema.optional(),
	requestChain: z.array(z.string()).optional(),
	intent: z.string().optional(),
});

export type IDirectRequestPayload = z.infer<typeof directRequestPayloadSchema>;
