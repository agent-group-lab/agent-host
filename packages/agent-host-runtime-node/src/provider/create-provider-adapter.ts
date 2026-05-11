import type {
	IProviderAdapter,
	IProviderAdapterOptions,
} from '@agent-group-lab/contracts/agent';
import { ClaudeAdapter } from '@agent-group-lab/provider-adapter/claude';
import { CodexAdapter } from '@agent-group-lab/provider-adapter/codex';

export const createProviderAdapter = (
	adapterId: string,
	options: IProviderAdapterOptions = {},
): IProviderAdapter | null => {
	switch (adapterId) {
		case 'codex':
			return new CodexAdapter(options);
		case 'claude':
			return new ClaudeAdapter(options);
		default:
			return null;
	}
};
