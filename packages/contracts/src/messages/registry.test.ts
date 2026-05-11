import { describe, expect, it } from 'vitest';

import { hostMessageTypes } from './host-message-types';
import {
	getMessageEntry,
	getMessagesByCategory,
	messageRegistryEntries,
	validatePayload,
} from './registry';
import { hostWorkerRecordSchema } from './reply/workers-list-result';

describe('message registry', () => {
	it('contains unique message names', () => {
		const names = messageRegistryEntries.map((entry) => entry.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has correct reply mappings for command messages', () => {
		expect(getMessageEntry('inbox:list')?.replyName).toBe('inbox:list:result');
		expect(getMessageEntry('message:post')?.replyName).toBe(
			'message:post:result',
		);
		expect(getMessageEntry('message:list')?.replyName).toBe(
			'message:list:result',
		);
		expect(getMessageEntry('member:join')?.replyName).toBe(
			'member:join:result',
		);
		expect(getMessageEntry('member:leave')?.replyName).toBe(
			'member:leave:result',
		);
		expect(getMessageEntry('member:list')?.replyName).toBe(
			'member:list:result',
		);
		expect(getMessageEntry('workers:list')?.replyName).toBe(
			'workers:list:result',
		);
		expect(getMessageEntry('task:assign')?.replyName).toBe('task:accepted');
		expect(getMessageEntry('task:publish-batch')?.replyName).toBe(
			'task:publish-batch:result',
		);
		expect(getMessageEntry('task:claim')?.replyName).toBe('task:claim:result');
		expect(getMessageEntry('task:claim:pull')?.replyName).toBe(
			'task:claim:pull:result',
		);
		expect(getMessageEntry('task:deliver')?.replyName).toBe(
			'task:deliver:result',
		);
		expect(getMessageEntry('task:children:status')?.replyName).toBe(
			'task:children:status:result',
		);
		expect(getMessageEntry('task:list')?.replyName).toBe('task:list:result');
		expect(getMessageEntry('taskboard:list')?.replyName).toBe(
			'taskboard:list:result',
		);
	});

	it('filters by category', () => {
		const commandCount = getMessagesByCategory('command').length;
		const replyCount = getMessagesByCategory('reply').length;
		const notificationCount = getMessagesByCategory('notification').length;
		expect(commandCount).toBeGreaterThan(0);
		expect(replyCount).toBeGreaterThan(0);
		expect(notificationCount).toBeGreaterThan(0);
		expect(commandCount + replyCount + notificationCount).toBe(
			messageRegistryEntries.length,
		);
	});

	it('keeps host message list in sync with registry names', () => {
		const registryNames = new Set(
			messageRegistryEntries.map((entry) => entry.name),
		);
		expect(hostMessageTypes).toHaveLength(messageRegistryEntries.length);
		expect(new Set(hostMessageTypes)).toEqual(registryNames);
	});

	it('validates payload by message schema', () => {
		const inboxOk = validatePayload('inbox:list', {
			targetAgentId: 'a',
			status: 'queued',
		});
		expect(inboxOk.success).toBe(true);

		const membershipOk = validatePayload('member:join', {
			agentId: 'a',
			agentName: 'A',
		});
		expect(membershipOk.success).toBe(true);

		const messagePostOk = validatePayload('message:post', {
			messageId: 'message-1',
			fromAgentId: 'agent-a',
			fromAgentName: 'Agent A',
			toAgentId: 'agent-b',
			content: 'hello',
		});
		expect(messagePostOk.success).toBe(true);

		const messageListOk = validatePayload('message:list', {
			toAgentId: 'agent-b',
			scope: 'all',
			limit: 30,
		});
		expect(messageListOk.success).toBe(true);

		const ok = validatePayload('task:assign', {
			taskId: 't1',
			turnId: 'turn-1',
			prompt: 'do work',
			workingDirectory: '/tmp',
		});
		expect(ok.success).toBe(true);

		const taskboardListOk = validatePayload('taskboard:list', {
			limit: 50,
		});
		expect(taskboardListOk.success).toBe(true);

		const taskClaimPullOk = validatePayload('task:claim:pull', {
			requestId: 'request-1',
			taskId: 'task-1',
		});
		expect(taskClaimPullOk.success).toBe(true);

		const taskDeliverOk = validatePayload('task:deliver', {
			requestId: 'request-2',
			taskId: 'task-1',
			assignmentToken: 'assignment-token-1',
			artifact: { ok: true },
		});
		expect(taskDeliverOk.success).toBe(true);

		const taskClaimPullResultOk = validatePayload('task:claim:pull:result', {
			requestId: 'request-1',
			status: 'claimed',
			taskId: 'task-1',
			assignmentToken: 'assignment-token-1',
			leaseExpiresAt: 123,
			task: {
				taskId: 'task-1',
				turnId: 'turn-1',
				prompt: 'do work',
				dependencies: [],
			},
		});
		expect(taskClaimPullResultOk.success).toBe(true);

		const taskDeliverResultOk = validatePayload('task:deliver:result', {
			requestId: 'request-2',
			status: 'delivered',
		});
		expect(taskDeliverResultOk.success).toBe(true);

		const workersListResultOk = validatePayload('workers:list:result', {
			workers: [
				{
					agentId: 'worker-1',
					agentName: 'Worker One',
					adapterId: 'codex',
					agentRole: 'executor',
					workerProfile: {
						profile: 'general',
					},
					workState: { kind: 'idle' },
					lastSeenAt: 123,
				},
			],
		});
		expect(workersListResultOk.success).toBe(true);

		const hostWorkerRecordOk = hostWorkerRecordSchema.safeParse({
			agentId: 'worker-1',
			agentName: 'Worker One',
			adapterId: 'codex',
			agentRole: 'executor',
			workerProfile: {
				profile: 'general',
			},
			workState: { kind: 'focused', taskId: 'task-1' },
			lastSeenAt: 123,
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
			workerType: 'session',
		});
		expect(hostWorkerRecordOk.success).toBe(true);

		const workerRegisterOk = validatePayload('worker:register', {
			agentId: 'worker-1',
			agentName: 'Worker One',
			workerType: 'session',
			adapterId: undefined,
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
		});
		expect(workerRegisterOk.success).toBe(true);

		const workerRegisterMissingType = validatePayload('worker:register', {
			agentId: 'worker-1',
			agentName: 'Worker One',
			adapterId: 'codex',
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
		});
		expect(workerRegisterMissingType.success).toBe(false);

		const failed = validatePayload('task:assign', {
			taskId: 't1',
			turnId: 'turn-1',
			workingDirectory: '/tmp',
		});
		expect(failed.success).toBe(false);
	});

	it('returns schema error for unknown message name', () => {
		const result = validatePayload('unknown:message', {});
		expect(result.success).toBe(false);
	});
});
