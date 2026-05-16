import { Box, Text, useInput } from 'ink';
import { observer } from 'mobx-react-lite';
import type { ISessionAgent } from '~/contracts/agent.contract';
import type { SessionStore } from '~/store/session.store';
import { TextInput } from './primitives/text-input';
import { useSessionInput } from './use-session-input';

type IProps = {
	store: SessionStore<ISessionAgent>;
	onSubmit: (prompt: string) => Promise<void>;
	onCancel: () => void;
	onError?: (err: Error) => void;
	placeholder?: string;
};

export const SessionInputBar = observer(function SessionInputBar({
	store,
	onSubmit,
	onCancel,
	onError,
	placeholder = 'Message agent…',
}: IProps) {
	const { inputValue, handleChange, handleSubmit } = useSessionInput({
		onSubmit,
	});

	useInput((_input, key) => {
		if (key.escape && store.isProcessing) {
			onCancel();
		}
	});

	const onSubmitWrapped = () => {
		if (store.isProcessing) {
			return;
		}
		handleSubmit()?.catch((err) => {
			onError?.(err instanceof Error ? err : new Error(String(err)));
		});
	};

	if (!store.isActive) {
		const inactiveMessage = (() => {
			if (store.status === 'disconnected') {
				const info = store.reconnectInfo;
				return info
					? `Reconnecting… (${info.attempt}/${info.maxAttempts})`
					: 'Reconnecting…';
			}
			if (store.status === 'rejected') {
				const reason = store.rejectedReason;
				if (reason === 'agent_limit_exceeded') {
					return 'Rejected: room is at capacity';
				}
				if (reason === 'max_reconnect_attempts_exceeded') {
					return 'Connection failed: max reconnect attempts exceeded';
				}
				if (reason === 'room_closed') {
					return 'Rejected: room has been closed';
				}
				return `Rejected: ${reason}`;
			}
			return 'Session unavailable';
		})();

		return (
			<Box>
				<Box
					borderBottom={true}
					borderColor='gray'
					borderLeft={false}
					borderRight={false}
					borderStyle='round'
					borderTop={true}
					paddingX={1}
				>
					<Text dimColor>{inactiveMessage}</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection='column' width='100%'>
			<Box
				borderBottom={true}
				borderColor='gray'
				borderLeft={false}
				borderRight={false}
				borderStyle='round'
				borderTop={true}
				paddingX={1}
			>
				<Text color='gray'>{'> '}</Text>
				<TextInput
					focus={true}
					history={true}
					multiline={true}
					onChange={handleChange}
					onSubmit={onSubmitWrapped}
					placeholder={placeholder}
					value={inputValue}
				/>
			</Box>
		</Box>
	);
});
