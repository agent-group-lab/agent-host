import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { AgreementService } from './agreement-service';
import { SessionExecutionService } from './session-execution-service';
import { TaskBoardService } from './task-board-service';

describe('SessionExecutionService', () => {
	it('claims task, creates delegation and accepted commitment, then focuses worker', async () => {
		const store = new InMemoryStore();
		const transitionWorkerState = vi.fn();
		const sendToConnection = vi.fn(async () => {});
		const agreementService = new AgreementService({
			store,
			onTransitionEvents: () => {},
		});
		const taskBoardService = new TaskBoardService({
			store,
			onTransitionEvents: () => {},
		});
		const service = new SessionExecutionService({
			store,
			agreementService,
			taskBoardService,
			transitionWorkerState,
			sendToConnection,
		});

		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-child',
				turnId: 'turn-1',
				prompt: 'child task',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-requester',
				requesterAgentId: 'lead-1',
				parentTaskId: 'task-parent',
				dispatchMode: 'claim',
			}),
		);

		const result = await service.claimAndAccept({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			task: store.getTaskBoardEntry('task-child')!,
			assignmentToken: 'token-1',
			claimLeaseMs: 10,
			claimLeaseExpiresAt: 1_010,
			executionLeaseMs: 1_000,
			at: 1_000,
		});

		expect(store.getTaskBoardEntry('task-child')).toMatchObject({
			taskId: 'task-child',
			assigneeId: 'session-agent',
			assignmentToken: 'token-1',
			claimLeaseMs: 10,
			claimLeaseExpiresAt: 1_010,
			executionLeaseMs: 1_000,
			executionLeaseExpiresAt: 2_000,
			status: 'doing',
		});
		expect(result.commitment).toMatchObject({
			taskId: 'task-child',
			assigneeId: 'session-agent',
			status: 'accepted',
			acceptedAt: 1_000,
		});
		expect(store.getDelegationsByOriginalTask('task-parent')).toHaveLength(1);
		expect(store.getDelegationsByOriginalTask('task-parent')[0]).toMatchObject({
			delegatorId: 'lead-1',
			delegateeId: 'session-agent',
			delegatedTaskId: 'task-child',
			status: 'accepted',
		});
		expect(transitionWorkerState).toHaveBeenCalledWith('session-agent', {
			kind: 'focused',
			taskId: 'task-child',
		});
		expect(sendToConnection).toHaveBeenCalledWith(
			'conn-requester',
			expect.objectContaining({
				type: 'task:accepted',
				channel: 'task:task-child',
			}),
		);
	});

	it('skips delegation creation when requesterAgentId is missing', async () => {
		const store = new InMemoryStore();
		const agreementService = new AgreementService({
			store,
			onTransitionEvents: () => {},
		});
		const taskBoardService = new TaskBoardService({
			store,
			onTransitionEvents: () => {},
		});
		const service = new SessionExecutionService({
			store,
			agreementService,
			taskBoardService,
			transitionWorkerState: vi.fn(),
			sendToConnection: vi.fn(async () => {}),
		});

		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-anon',
				turnId: 'turn-1',
				prompt: 'anonymous task',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
		);

		await service.claimAndAccept({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			task: store.getTaskBoardEntry('task-anon')!,
			assignmentToken: 'token-2',
			claimLeaseMs: 10,
			claimLeaseExpiresAt: 1_010,
			executionLeaseMs: 1_000,
			at: 1_000,
		});

		expect(store.getDelegationsByDelegatee('session-agent')).toHaveLength(0);
		expect(store.getCommitmentByTaskId('task-anon')?.status).toBe('accepted');
	});

	it('swallows requester notification failure after state is committed', async () => {
		const store = new InMemoryStore();
		const agreementService = new AgreementService({
			store,
			onTransitionEvents: () => {},
		});
		const taskBoardService = new TaskBoardService({
			store,
			onTransitionEvents: () => {},
		});
		const service = new SessionExecutionService({
			store,
			agreementService,
			taskBoardService,
			transitionWorkerState: vi.fn(),
			sendToConnection: vi.fn(async () => {
				throw new Error('connection closed');
			}),
		});

		store.setTaskBoardEntry(
			createTaskBoardEntry({
				taskId: 'task-disconnected',
				turnId: 'turn-1',
				prompt: 'disconnected requester',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
		);

		await expect(
			service.claimAndAccept({
				agentId: 'session-agent',
				agentName: 'Session Agent',
				task: store.getTaskBoardEntry('task-disconnected')!,
				assignmentToken: 'token-3',
				claimLeaseMs: 10,
				claimLeaseExpiresAt: 1_010,
				executionLeaseMs: 1_000,
				at: 1_000,
			}),
		).resolves.toMatchObject({
			task: {
				taskId: 'task-disconnected',
				status: 'doing',
			},
			commitment: {
				taskId: 'task-disconnected',
				status: 'accepted',
			},
		});
	});
});
