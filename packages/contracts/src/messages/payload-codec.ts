import type { ZodType } from 'zod';
import {
	agentEventPayloadSchema,
	commitmentActionPayloadSchema,
	directCancelPayloadSchema,
	directRequestPayloadSchema,
	directResponsePayloadSchema,
	inboxListPayloadSchema,
	messageListPayloadSchema,
	messagePostPayloadSchema,
	taskAssignPayloadSchema,
	taskboardListPayloadSchema,
	taskChildrenStatusPayloadSchema,
	taskClaimPayloadSchema,
	taskClaimPullPayloadSchema,
	taskCompletedPayloadSchema,
	taskDeliverPayloadSchema,
	taskFailedPayloadSchema,
	taskListPayloadSchema,
	taskPublishBatchPayloadSchema,
} from './command';
import {
	inboxListResultPayloadSchema,
	messageListResultPayloadSchema,
	messagePostResultPayloadSchema,
	taskAcceptedPayloadSchema,
	taskboardListResultPayloadSchema,
	taskChildrenStatusResultPayloadSchema,
	taskClaimPullResultPayloadSchema,
	taskClaimResultPayloadSchema,
	taskDeliverResultPayloadSchema,
	taskListResultPayloadSchema,
	taskPublishBatchResultPayloadSchema,
	workersListResultPayloadSchema,
} from './reply';

export const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const parseWithSchema = <T>(schema: ZodType<T>, payload: unknown): T | null => {
	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		return null;
	}
	return parsed.data;
};

export const parseTaskAcceptedPayload = (payload: unknown) => {
	return parseWithSchema(taskAcceptedPayloadSchema, payload);
};

export const parseTaskAssignPayload = (payload: unknown) => {
	return parseWithSchema(taskAssignPayloadSchema, payload);
};

export const parseTaskPublishBatchPayload = (payload: unknown) => {
	return parseWithSchema(taskPublishBatchPayloadSchema, payload);
};

export const parseTaskPublishBatchResultPayload = (payload: unknown) => {
	return parseWithSchema(taskPublishBatchResultPayloadSchema, payload);
};

export const parseTaskClaimPayload = (payload: unknown) => {
	return parseWithSchema(taskClaimPayloadSchema, payload);
};

export const parseTaskClaimResultPayload = (payload: unknown) => {
	return parseWithSchema(taskClaimResultPayloadSchema, payload);
};

export const parseTaskClaimPullPayload = (payload: unknown) => {
	return parseWithSchema(taskClaimPullPayloadSchema, payload);
};

export const parseTaskClaimPullResultPayload = (payload: unknown) => {
	return parseWithSchema(taskClaimPullResultPayloadSchema, payload);
};

export const parseTaskChildrenStatusPayload = (payload: unknown) => {
	return parseWithSchema(taskChildrenStatusPayloadSchema, payload);
};

export const parseTaskListPayload = (payload: unknown) => {
	return parseWithSchema(taskListPayloadSchema, payload);
};

export const parseTaskChildrenStatusResultPayload = (payload: unknown) => {
	return parseWithSchema(taskChildrenStatusResultPayloadSchema, payload);
};

export const parseTaskListResultPayload = (payload: unknown) => {
	return parseWithSchema(taskListResultPayloadSchema, payload);
};

export const parseTaskboardListPayload = (payload: unknown) => {
	return parseWithSchema(taskboardListPayloadSchema, payload);
};

export const parseTaskboardListResultPayload = (payload: unknown) => {
	return parseWithSchema(taskboardListResultPayloadSchema, payload);
};

export const parseAgentEventPayload = (payload: unknown) => {
	return parseWithSchema(agentEventPayloadSchema, payload);
};

export const parseTaskCompletedPayload = (payload: unknown) => {
	return parseWithSchema(taskCompletedPayloadSchema, payload);
};

export const parseTaskFailedPayload = (payload: unknown) => {
	return parseWithSchema(taskFailedPayloadSchema, payload);
};

export const parseTaskDeliverPayload = (payload: unknown) => {
	return parseWithSchema(taskDeliverPayloadSchema, payload);
};

export const parseTaskDeliverResultPayload = (payload: unknown) => {
	return parseWithSchema(taskDeliverResultPayloadSchema, payload);
};

export const parseCommitmentActionPayload = (payload: unknown) => {
	return parseWithSchema(commitmentActionPayloadSchema, payload);
};

export const parseWorkersListResultPayload = (payload: unknown) => {
	return parseWithSchema(workersListResultPayloadSchema, payload);
};

export const parseDirectRequestPayload = (payload: unknown) => {
	return parseWithSchema(directRequestPayloadSchema, payload);
};

export const parseDirectResponsePayload = (payload: unknown) => {
	return parseWithSchema(directResponsePayloadSchema, payload);
};

export const parseDirectCancelPayload = (payload: unknown) => {
	return parseWithSchema(directCancelPayloadSchema, payload);
};

export const parseInboxListPayload = (payload: unknown) => {
	return parseWithSchema(inboxListPayloadSchema, payload);
};

export const parseInboxListResultPayload = (payload: unknown) => {
	return parseWithSchema(inboxListResultPayloadSchema, payload);
};

export const parseMessagePostPayload = (payload: unknown) => {
	return parseWithSchema(messagePostPayloadSchema, payload);
};

export const parseMessageListPayload = (payload: unknown) => {
	return parseWithSchema(messageListPayloadSchema, payload);
};

export const parseMessagePostResultPayload = (payload: unknown) => {
	return parseWithSchema(messagePostResultPayloadSchema, payload);
};

export const parseMessageListResultPayload = (payload: unknown) => {
	return parseWithSchema(messageListResultPayloadSchema, payload);
};
