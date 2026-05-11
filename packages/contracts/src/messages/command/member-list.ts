import { z } from 'zod';

export const MEMBER_LIST = 'member:list' as const;

export const memberListPayloadSchema = z.object({});

export type IMemberListPayload = z.infer<typeof memberListPayloadSchema>;
