import { z } from 'zod';
import {
	taskboardCursorSchema,
	taskboardListItemSchema,
} from './taskboard-item';

export const TASKBOARD_LIST_RESULT = 'taskboard:list:result' as const;

export const taskboardListResultPayloadSchema = z.object({
	tasks: z.array(taskboardListItemSchema),
	nextCursor: taskboardCursorSchema.optional(),
});

export type ITaskboardListResultPayload = z.infer<
	typeof taskboardListResultPayloadSchema
>;
