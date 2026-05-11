import { z } from 'zod';

export const COORD_WAIT_START = 'coord:wait:start' as const;

export const coordWaitStartPayloadSchema = z.object({
	waitId: z.string(),
	parentTaskId: z.string(),
});

export type ICoordWaitStartPayload = z.infer<
	typeof coordWaitStartPayloadSchema
>;
