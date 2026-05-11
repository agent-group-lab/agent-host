import type { IProviderAdapter } from '@agent-group-lab/contracts/agent';

export class AdapterRegistry {
	private adapters = new Map<string, IProviderAdapter>();

	register = (adapter: IProviderAdapter) => {
		this.adapters.set(adapter.id, adapter);
	};

	get = (id: string): IProviderAdapter | undefined => {
		return this.adapters.get(id);
	};

	list = (): IProviderAdapter[] => {
		return [...this.adapters.values()];
	};
}
