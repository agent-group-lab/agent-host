import type { AgentAction } from '@agent-group-lab/contracts/agent';
import type { AgentRole } from '@agent-group-lab/contracts/messages';

export interface IRolePolicy {
	role: AgentRole;
	canExecuteTools: boolean;
	canAssignTasks: boolean;
	canReviewDeliverables: boolean;
	allowedActions: ReadonlySet<AgentAction>;
}

const leadPolicy: IRolePolicy = {
	role: 'lead',
	canExecuteTools: false,
	canAssignTasks: true,
	canReviewDeliverables: true,
	allowedActions: new Set<AgentAction>([
		'ACK',
		'DEFER',
		'ACCEPT',
		'DECLINE',
		'ESCALATE',
		'UPDATE',
		'DELIVER',
		'FAIL',
	]),
};

const executorPolicy: IRolePolicy = {
	role: 'executor',
	canExecuteTools: true,
	canAssignTasks: true,
	canReviewDeliverables: false,
	allowedActions: new Set<AgentAction>([
		'ACK',
		'ACCEPT',
		'DECLINE',
		'ESCALATE',
		'UPDATE',
		'DELIVER',
		'FAIL',
	]),
};

const reviewerPolicy: IRolePolicy = {
	role: 'reviewer',
	canExecuteTools: false,
	canAssignTasks: false,
	canReviewDeliverables: true,
	allowedActions: new Set<AgentAction>([
		'ACK',
		'ACCEPT',
		'DECLINE',
		'DELIVER',
		'ESCALATE',
	]),
};

export const rolePolicies: Record<AgentRole, IRolePolicy> = {
	lead: leadPolicy,
	executor: executorPolicy,
	reviewer: reviewerPolicy,
};

export const getRolePolicy = (role: AgentRole): IRolePolicy => {
	return rolePolicies[role];
};
