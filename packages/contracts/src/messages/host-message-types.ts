import { messageRegistryEntries } from './registry';

export const hostMessageTypes = messageRegistryEntries.map(
	(entry) => entry.name,
) as readonly (typeof messageRegistryEntries)[number]['name'][];

export type HostMessageType = (typeof messageRegistryEntries)[number]['name'];
