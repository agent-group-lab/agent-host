import { z } from 'zod';

export const TASK_CHILDREN_STATUS = 'task:children:status' as const;

export const taskChildrenStatusPayloadSchema = z.object({
	requestId: z.string(),
	parentTaskId: z.string(),
	recursive: z.boolean().optional(),
	maxDepth: z.number().int().positive().default(20),
	includeArtifacts: z.boolean().optional(),
});

export type ITaskChildrenStatusPayload = z.infer<
	typeof taskChildrenStatusPayloadSchema
>;
