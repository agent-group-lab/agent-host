import { z } from 'zod';

export const COORD_WAIT_DONE = 'coord:wait:done' as const;

export const coordWaitDonePayloadSchema = z.object({
	waitId: z.string(),
	parentTaskId: z.string(),
	outcome: z.enum(['completed', 'failed', 'cancelled']),
	reason: z.string().optional(),
});

export type ICoordWaitDonePayload = z.infer<typeof coordWaitDonePayloadSchema>;
