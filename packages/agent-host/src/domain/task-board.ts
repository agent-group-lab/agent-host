import type { AgentRole } from '@agent-group-lab/contracts/messages';

import {
	assertMachineTransition,
	canTransitionByMachine,
	createStatusMachine,
	createTransitionEvents,
	type ITransitionEventContext,
	type ITransitionResult,
} from './machine-adapter';

export type TaskBoardStatus =
	| 'todo'
	| 'assigned'
	| 'doing'
	| 'blocked'
	| 'done'
	| 'cancelled';

export interface ITaskBoardEntry {
	taskId: string;
	turnId: string;
	prompt: string;
	requesterConnectionId: string;
	workingDirectory?: string;
	parentTaskId?: string;
	assigneeId?: string;
	assigneeName?: string;
	assigneeRole?: AgentRole;
	status: TaskBoardStatus;
	dependencies: string[];
	deliverableSpec?: string;
	slaDeadline?: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	failureMessage?: string;
	deliveredArtifact?: unknown;
	dispatchMode?: 'push' | 'claim';
	suggestedAgentIds?: string[];
	suggestionPolicy?: 'strict' | 'preferred';
	requesterAgentId?: string;
	assignmentToken?: string;
	lastAssignmentToken?: string;
	claimLeaseMs?: number;
	claimLeaseExpiresAt?: number;
	executionLeaseMs?: number;
	executionLeaseExpiresAt?: number;
	claimAttempt?: number;
	claimedAt?: number;
}

const terminalTaskBoardStatuses = new Set<TaskBoardStatus>([
	'done',
	'cancelled',
]);

const allowedTaskBoardTransitions: Record<
	TaskBoardStatus,
	readonly TaskBoardStatus[]
> = {
	todo: ['assigned', 'blocked', 'cancelled', 'done'],
	assigned: ['doing', 'todo', 'cancelled'],
	doing: ['todo', 'blocked', 'done', 'cancelled'],
	blocked: ['todo', 'cancelled'],
	done: [],
	cancelled: [],
};

const taskBoardStatuses = [
	'todo',
	'assigned',
	'doing',
	'blocked',
	'done',
	'cancelled',
] as const satisfies readonly TaskBoardStatus[];

const taskBoardStatusMachine = createStatusMachine(
	'task-board-status-machine',
	taskBoardStatuses,
	allowedTaskBoardTransitions,
);

export interface ICreateTaskBoardEntryInput {
	taskId: string;
	turnId: string;
	prompt: string;
	requesterConnectionId: string;
	workingDirectory?: string;
	parentTaskId?: string;
	assigneeId?: string;
	assigneeName?: string;
	assigneeRole?: AgentRole;
	dependencies?: string[];
	deliverableSpec?: string;
	slaDeadline?: number;
	dispatchMode?: 'push' | 'claim';
	suggestedAgentIds?: string[];
	suggestionPolicy?: 'strict' | 'preferred';
	requesterAgentId?: string;
	assignmentToken?: string;
	claimLeaseExpiresAt?: number;
	claimedAt?: number;
}

export const isTaskBoardTerminal = (status: TaskBoardStatus) => {
	return terminalTaskBoardStatuses.has(status);
};

export const canTransitionTaskBoardStatus = (
	from: TaskBoardStatus,
	to: TaskBoardStatus,
) => {
	return canTransitionByMachine(taskBoardStatusMachine, from, to);
};

export const validateNoCycle = (
	taskId: string,
	dependencies: string[],
	existingTasks: Map<string, ITaskBoardEntry>,
) => {
	const memo = new Map<string, boolean>();
	const hasCycle = (currentId: string, inStack: Set<string>): boolean => {
		if (currentId === taskId) {
			return true;
		}
		if (inStack.has(currentId)) {
			return false;
		}
		const cached = memo.get(currentId);
		if (cached !== undefined) {
			return cached;
		}
		const task = existingTasks.get(currentId);
		if (!task) {
			memo.set(currentId, false);
			return false;
		}
		inStack.add(currentId);
		const result = task.dependencies.some((dependencyId) =>
			hasCycle(dependencyId, inStack),
		);
		inStack.delete(currentId);
		memo.set(currentId, result);
		return result;
	};

	for (const dependencyId of dependencies) {
		if (hasCycle(dependencyId, new Set<string>())) {
			throw new Error(
				`Adding dependency ${dependencyId} to task ${taskId} would create a cycle`,
			);
		}
	}
};

const hasUnresolvedDependencies = (
	dependencies: string[],
	existingTasks: Map<string, ITaskBoardEntry>,
) => {
	for (const dependencyId of dependencies) {
		const dependency = existingTasks.get(dependencyId);
		if (!dependency || dependency.status !== 'done') {
			return true;
		}
	}
	return false;
};

export interface ICreateTaskBoardEntryOptions {
	at?: number;
	existingTasks?: Map<string, ITaskBoardEntry>;
}

export const createTaskBoardEntry = (
	input: ICreateTaskBoardEntryInput,
	options?: ICreateTaskBoardEntryOptions,
) => {
	const existingTasks =
		options?.existingTasks ?? new Map<string, ITaskBoardEntry>();
	const dependencies = Array.from(new Set(input.dependencies ?? []));
	validateNoCycle(input.taskId, dependencies, existingTasks);

	const initialStatus = hasUnresolvedDependencies(dependencies, existingTasks)
		? 'blocked'
		: 'todo';

	return {
		taskId: input.taskId,
		turnId: input.turnId,
		prompt: input.prompt,
		workingDirectory: input.workingDirectory,
		requesterConnectionId: input.requesterConnectionId,
		parentTaskId: input.parentTaskId,
		assigneeId: input.assigneeId,
		assigneeName: input.assigneeName,
		assigneeRole: input.assigneeRole,
		status: initialStatus,
		dependencies,
		deliverableSpec: input.deliverableSpec,
		slaDeadline: input.slaDeadline,
		...(input.dispatchMode ? { dispatchMode: input.dispatchMode } : {}),
		...(input.suggestedAgentIds
			? { suggestedAgentIds: [...input.suggestedAgentIds] }
			: {}),
		...(input.suggestionPolicy
			? { suggestionPolicy: input.suggestionPolicy }
			: {}),
		...(input.requesterAgentId
			? { requesterAgentId: input.requesterAgentId }
			: {}),
		...(input.assignmentToken
			? { assignmentToken: input.assignmentToken }
			: {}),
		...(typeof input.claimLeaseExpiresAt === 'number'
			? { claimLeaseExpiresAt: input.claimLeaseExpiresAt }
			: {}),
		...(typeof input.claimedAt === 'number'
			? { claimedAt: input.claimedAt }
			: {}),
		createdAt: options?.at ?? Date.now(),
	} satisfies ITaskBoardEntry;
};

export interface ITransitionTaskBoardStateInput {
	task: ITaskBoardEntry;
	nextStatus: TaskBoardStatus;
	at?: number;
	failureMessage?: string;
	deliveredArtifact?: unknown;
}

export interface ITransitionTaskBoardInput
	extends ITransitionTaskBoardStateInput {
	eventContext?: Omit<
		Partial<ITransitionEventContext>,
		'aggregateType' | 'aggregateId' | 'fromState' | 'toState' | 'trigger'
	>;
}

export const transitionTaskBoardState = (
	input: ITransitionTaskBoardStateInput,
) => {
	assertMachineTransition(
		taskBoardStatusMachine,
		input.task.status,
		input.nextStatus,
		`Invalid task-board status transition: ${input.task.status} -> ${input.nextStatus}`,
	);

	const at = input.at ?? Date.now();
	const nextTask: ITaskBoardEntry = {
		...input.task,
		status: input.nextStatus,
	};

	if (input.nextStatus === 'doing') {
		nextTask.startedAt = at;
		nextTask.completedAt = undefined;
		nextTask.failureMessage = undefined;
		nextTask.deliveredArtifact = undefined;
		if (
			typeof nextTask.executionLeaseMs === 'number' &&
			!nextTask.executionLeaseExpiresAt
		) {
			nextTask.executionLeaseExpiresAt = at + nextTask.executionLeaseMs;
		}
		return nextTask;
	}
	if (input.nextStatus === 'done') {
		nextTask.completedAt = at;
		nextTask.failureMessage = undefined;
		nextTask.deliveredArtifact = input.deliveredArtifact;
		nextTask.lastAssignmentToken = undefined;
		return nextTask;
	}
	if (input.nextStatus === 'cancelled') {
		nextTask.completedAt = at;
		nextTask.failureMessage = input.failureMessage;
		nextTask.deliveredArtifact = undefined;
		return nextTask;
	}

	nextTask.failureMessage = undefined;
	return nextTask;
};

export const transitionTaskBoard = (
	input: ITransitionTaskBoardInput,
): ITransitionResult<ITaskBoardEntry> => {
	const state = transitionTaskBoardState(input);
	const domainEvents = createTransitionEvents({
		aggregateType: 'task',
		aggregateId: state.taskId,
		fromState: input.task.status,
		toState: input.nextStatus,
		trigger: input.nextStatus,
		occurredAt: input.at,
		actor: input.eventContext?.actor,
		actorName: input.eventContext?.actorName,
		correlationId: input.eventContext?.correlationId,
		causationId: input.eventContext?.causationId,
		metadata: input.eventContext?.metadata,
	});

	return {
		changed: input.task.status !== input.nextStatus,
		state,
		domainEvents,
	};
};

export interface IResolveCompletedTaskInput {
	completedTaskId: string;
	taskBoard: Map<string, ITaskBoardEntry>;
	at?: number;
}

export const resolveCompletedTask = (input: IResolveCompletedTaskInput) => {
	const unlockedTaskIds: string[] = [];
	for (const task of input.taskBoard.values()) {
		if (task.status !== 'blocked') {
			continue;
		}
		if (!task.dependencies.includes(input.completedTaskId)) {
			continue;
		}
		const ready = task.dependencies.every((dependencyId) => {
			const dependency = input.taskBoard.get(dependencyId);
			return dependency?.status === 'done';
		});
		if (!ready) {
			continue;
		}
		const unlocked = transitionTaskBoardState({
			task,
			nextStatus: 'todo',
			at: input.at,
		});
		input.taskBoard.set(task.taskId, unlocked);
		unlockedTaskIds.push(task.taskId);
	}
	return unlockedTaskIds;
};

export interface IReassignTaskBoardEntryInput {
	task: ITaskBoardEntry;
	assigneeId: string;
	assigneeName: string | undefined;
}

export const reassignTaskBoardEntry = (input: IReassignTaskBoardEntryInput) => {
	if (input.task.status === 'done' || input.task.status === 'cancelled') {
		throw new Error(
			`Cannot reassign terminal task-board entry: ${input.task.taskId}`,
		);
	}

	return {
		...input.task,
		assigneeId: input.assigneeId,
		assigneeName: input.assigneeName,
		status: 'todo',
		startedAt: undefined,
		completedAt: undefined,
		failureMessage: undefined,
		deliveredArtifact: undefined,
		assignmentToken: undefined,
		claimLeaseExpiresAt: undefined,
		claimedAt: undefined,
	} satisfies ITaskBoardEntry;
};

export interface IApplyTaskClaimInput {
	task: ITaskBoardEntry;
	assigneeId: string;
	assigneeName: string | undefined;
	assignmentToken: string;
	claimLeaseMs: number;
	claimLeaseExpiresAt: number;
	executionLeaseMs: number;
	at?: number;
}

export const applyTaskClaim = (input: IApplyTaskClaimInput) => {
	if (input.task.status !== 'todo') {
		throw new Error(`Task ${input.task.taskId} is not claimable`);
	}

	return {
		...input.task,
		assigneeId: input.assigneeId,
		assigneeName: input.assigneeName,
		assignmentToken: input.assignmentToken,
		lastAssignmentToken: undefined,
		claimLeaseMs: input.claimLeaseMs,
		claimLeaseExpiresAt: input.claimLeaseExpiresAt,
		executionLeaseMs: input.executionLeaseMs,
		claimedAt: input.at ?? Date.now(),
	} satisfies ITaskBoardEntry;
};

export const releaseTaskClaim = (task: ITaskBoardEntry) => {
	return {
		...task,
		assigneeId: undefined,
		assigneeName: undefined,
		assignmentToken: undefined,
		claimLeaseMs: undefined,
		claimLeaseExpiresAt: undefined,
		executionLeaseMs: undefined,
		executionLeaseExpiresAt: undefined,
		claimedAt: undefined,
	} satisfies ITaskBoardEntry;
};

export const requeueTask = (task: ITaskBoardEntry) => {
	if (task.status !== 'doing') {
		throw new Error(
			`Cannot requeue task ${task.taskId}: expected status 'doing', got '${task.status}'`,
		);
	}
	return {
		...task,
		status: 'todo' as const,
		assigneeId: undefined,
		assigneeName: undefined,
		lastAssignmentToken: task.assignmentToken,
		assignmentToken: undefined,
		claimLeaseMs: undefined,
		claimLeaseExpiresAt: undefined,
		executionLeaseMs: undefined,
		executionLeaseExpiresAt: undefined,
		claimedAt: undefined,
		startedAt: undefined,
		claimAttempt: (task.claimAttempt ?? 0) + 1,
	} satisfies ITaskBoardEntry;
};
