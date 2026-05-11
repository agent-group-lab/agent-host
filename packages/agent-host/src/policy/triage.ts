import type { WorkStateKind } from '@agent-group-lab/contracts/work';

export type TriageAction = 'deliver' | 'defer' | 'drop';

export interface ITriageDecision {
	action: TriageAction;
	ruleName: string;
}

export interface ITriageContext {
	toAgentId: string;
	fromAgentId: string;
	requestId: string;
}

export interface ITriageRule {
	name: string;
	priority: number;
	evaluate: (
		context: ITriageContext,
		deps: ITriageRuleDeps,
	) => TriageAction | null;
}

export interface ITriageRuleDeps {
	getWorkState: (agentId: string) => WorkStateKind;
	getQueuedCount: (agentId: string) => number;
}

export interface ITriage {
	evaluate: (context: ITriageContext) => ITriageDecision;
}

export const createDefaultRules = (): ITriageRule[] => [
	{
		name: 'idle-deliver',
		priority: 10,
		evaluate: (context, deps) => {
			const state = deps.getWorkState(context.toAgentId);
			if (state === 'idle' || state === 'finished') {
				return 'deliver';
			}
			return null;
		},
	},
	{
		name: 'blocked-deliver',
		priority: 15,
		evaluate: (context, deps) => {
			const state = deps.getWorkState(context.toAgentId);
			if (state === 'blocked') {
				return 'deliver';
			}
			return null;
		},
	},
	{
		name: 'busy-defer',
		priority: 20,
		evaluate: (context, deps) => {
			const state = deps.getWorkState(context.toAgentId);
			if (
				state === 'focused' ||
				state === 'waiting_tool' ||
				state === 'waiting_delegation' ||
				state === 'waiting_peer'
			) {
				return 'defer';
			}
			return null;
		},
	},
];

export class RuleTriage implements ITriage {
	private readonly rules: ITriageRule[];
	private readonly deps: ITriageRuleDeps;

	constructor(options: {
		rules?: ITriageRule[];
		getWorkState: (agentId: string) => WorkStateKind;
		getQueuedCount: (agentId: string) => number;
	}) {
		this.rules = (options.rules ?? createDefaultRules()).sort(
			(a, b) => a.priority - b.priority,
		);
		this.deps = {
			getWorkState: options.getWorkState,
			getQueuedCount: options.getQueuedCount,
		};
	}

	evaluate = (context: ITriageContext): ITriageDecision => {
		for (const rule of this.rules) {
			const action = rule.evaluate(context, this.deps);
			if (action !== null) {
				return { action, ruleName: rule.name };
			}
		}
		return { action: 'defer', ruleName: 'default' };
	};
}
