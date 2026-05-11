import { z } from 'zod';

import type { ICapabilities } from '~/agent/models';

export const WORKER_REGISTER = 'worker:register' as const;

export const agentRoleSchema = z.enum(['lead', 'executor', 'reviewer']);

export const workerProfileSchema = z
	.object({
		tags: z.array(z.string()).optional(),
		profile: z.string().optional(),
	})
	.optional();

export const workerRegisterPayloadSchema = z.object({
	agentId: z.string(),
	agentName: z.string(),
	workerType: z.enum(['persistent', 'session']),
	adapterId: z.string().optional(),
	capabilities: z.custom<ICapabilities>(
		(value) => typeof value === 'object' && value !== null,
	),
	role: agentRoleSchema.optional(),
	workerProfile: workerProfileSchema,
});

export type AgentRole = z.infer<typeof agentRoleSchema>;
export type IWorkerProfile = Exclude<
	z.infer<typeof workerProfileSchema>,
	undefined
>;
export type IWorkerRegisterPayload = z.infer<
	typeof workerRegisterPayloadSchema
>;
