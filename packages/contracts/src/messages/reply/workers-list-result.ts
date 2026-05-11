import { z } from 'zod';
import { capabilitiesSchema } from '~/agent/models';
import { workStateSchema } from '~/work/state';
import {
	agentRoleSchema,
	workerProfileSchema,
} from '../command/worker-register';

export const WORKERS_LIST_RESULT = 'workers:list:result' as const;

export const workerSummarySchema = z.object({
	agentId: z.string(),
	agentName: z.string(),
	adapterId: z.string().optional(),
	agentRole: agentRoleSchema,
	workerProfile: workerProfileSchema,
	workState: workStateSchema,
	lastSeenAt: z.number(),
});

export const hostWorkerRecordSchema = workerSummarySchema.extend({
	connectionId: z.string().optional(),
	workerType: z.enum(['persistent', 'session']),
	capabilities: capabilitiesSchema,
});

export const workersListResultPayloadSchema = z.object({
	workers: z.array(workerSummarySchema),
});

export type IWorkerSummary = z.infer<typeof workerSummarySchema>;
export type IHostWorkerRecord = z.infer<typeof hostWorkerRecordSchema>;
export type IWorkersListResultPayload = z.infer<
	typeof workersListResultPayloadSchema
>;
