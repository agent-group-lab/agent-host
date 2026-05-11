import { z } from 'zod';

export const WORKERS_LIST = 'workers:list' as const;

export const workersListPayloadSchema = z.object({
	includeOffline: z.boolean().optional(),
});

export type IWorkersListPayload = z.infer<typeof workersListPayloadSchema>;
