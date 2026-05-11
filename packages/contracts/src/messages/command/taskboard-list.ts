import { z } from 'zod';
import { taskboardCursorSchema } from '../reply/taskboard-item';

export const TASKBOARD_LIST = 'taskboard:list' as const;

export const taskboardListPayloadSchema = z.object({
	after: taskboardCursorSchema.optional(),
	limit: z.number().int().positive().max(200).optional(),
	includeArtifacts: z.boolean().optional(),
});

export type ITaskboardListPayload = z.infer<typeof taskboardListPayloadSchema>;
