import type { ICallerIdentity } from '@agent-group-lab/contracts/agent';
import type { ITaskAssignPayload } from '@agent-group-lab/contracts/messages';
import { describe, expect, it } from 'vitest';
import { PromptComposer } from './prompt-composer';

const createTask = (
	overrides?: Partial<ITaskAssignPayload>,
): ITaskAssignPayload => {
	return {
		taskId: overrides?.taskId ?? 'task-1',
		turnId: overrides?.turnId ?? 'turn-1',
		prompt: overrides?.prompt ?? 'do work',
		workingDirectory: overrides?.workingDirectory ?? '/tmp',
		...overrides,
	};
};

const selfIdentity = { agentId: 'agent-1', agentName: 'Agent One' };
const callerIdentity: ICallerIdentity = { kind: 'local-user' };

describe('prompt-composer', () => {
	it('puts role in systemPromptSuffix and dependency segment in prompt', () => {
		const composer = new PromptComposer();
		const composed = composer.compose({
			task: createTask({
				dependencies: ['dep-1', 'dep-2'],
				prompt: 'sum numbers',
			}),
			workerRole: 'executor',
			selfIdentity,
			callerIdentity,
		});

		expect(composed.systemPromptSuffix).toContain('## Worker Role');
		expect(composed.systemPromptSuffix).toContain(
			'## Peer Communication Rules',
		);
		expect(composed.systemPromptSuffix).toContain('## Identity');
		expect(composed.systemPromptSuffix).toContain('Agent One');
		expect(composed.prompt).toContain('[From: local user]');
		expect(composed.prompt).toContain('## Dependency Inputs');
		expect(composed.prompt).toContain(
			'Declared dependency taskIds: dep-1, dep-2',
		);
		expect(composed.prompt).toContain('sum numbers');
	});

	it('omits dependency segment when task has no dependencies', () => {
		const composer = new PromptComposer();
		const composed = composer.compose({
			task: createTask({ prompt: 'plain task' }),
			workerRole: 'executor',
			selfIdentity,
			callerIdentity,
		});

		expect(composed.prompt).toContain('plain task');
		expect(composed.prompt).toContain('[From: local user]');
		expect(composed.systemPromptSuffix).toContain('## Worker Role');
		expect(composed.systemPromptSuffix).not.toContain('## Available Peers');
	});

	it('includes caller agent identity when called by another agent', () => {
		const composer = new PromptComposer();
		const agentCaller: ICallerIdentity = {
			kind: 'agent',
			agentId: 'agent-2',
			agentName: 'Agent Two',
		};
		const composed = composer.compose({
			task: createTask({ prompt: 'peer question' }),
			workerRole: 'executor',
			selfIdentity,
			callerIdentity: agentCaller,
		});

		expect(composed.prompt).toContain('[From: agent Agent Two (id: agent-2)]');
	});
});
