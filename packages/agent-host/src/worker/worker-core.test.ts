import type {
	IProviderAdapter,
	IRunTurnRequest,
} from '@agent-group-lab/contracts/agent';
import {
	createEnvelope,
	type IProtocolEnvelope,
} from '@agent-group-lab/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { IWorkerClientPort } from '~/ports/worker-client-port';
import { WorkerCore } from './worker-core';

type IReceivedEnvelope = IProtocolEnvelope<string, Record<string, unknown>>;

class FakeWorkerClientPort implements IWorkerClientPort {
	readonly sent: IProtocolEnvelope<string, unknown>[] = [];
	private listeners: Array<(message: IReceivedEnvelope) => void> = [];
	private disconnectListeners: Array<() => void> = [];
	private workers: Array<{
		agentId: string;
		agentName: string;
		adapterId: string;
		workState: { kind: string };
		lastSeenAt: number;
	}> = [];

	connect = async () => {};

	send = async (message: IProtocolEnvelope<string, unknown>) => {
		this.sent.push(message);
	};

	subscribe = (listener: (message: IReceivedEnvelope) => void) => {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	};

	onDisconnect = (listener: () => void) => {
		this.disconnectListeners.push(listener);
		return () => {
			this.disconnectListeners = this.disconnectListeners.filter(
				(item) => item !== listener,
			);
		};
	};

	waitForMessage = async (
		matcher: (message: IReceivedEnvelope) => boolean,
	): Promise<IReceivedEnvelope> => {
		const messages: IReceivedEnvelope[] = [
			createEnvelope({
				seq: 1,
				type: 'control:ready',
				channel: 'control',
				payload: {},
			}),
			createEnvelope({
				seq: 2,
				type: 'workers:list:result',
				channel: 'control',
				payload: {
					workers: this.workers,
				},
			}),
		];
		for (const message of messages) {
			if (matcher(message)) {
				return message;
			}
		}
		throw new Error('No mocked message matched waitForMessage matcher');
	};

	close = async () => {};

	emit = (message: IProtocolEnvelope) => {
		for (const listener of this.listeners) {
			listener(message);
		}
	};

	setWorkers = (
		workers: Array<{
			agentId: string;
			agentName: string;
			adapterId: string;
			workState: { kind: string };
			lastSeenAt: number;
		}>,
	) => {
		this.workers = workers;
	};
}

const createAdapter = (): IProviderAdapter => {
	return {
		id: 'test-adapter',
		displayName: 'Test Adapter',
		capabilities: async () => ({
			streaming: true,
			toolUse: true,
			codeExecution: true,
			fileRead: true,
			fileWrite: true,
		}),
		runTurn: async function* () {},
	};
};

const wait = async (ms: number) => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

describe('WorkerCore direct outbound', () => {
	it('resolves pending direct request on direct:response', async () => {
		const port = new FakeWorkerClientPort();
		const logs: string[] = [];
		const core = new WorkerCore(
			{
				agentId: 'agent-a',
				onLog: (message) => logs.push(message),
			},
			createAdapter(),
			port,
		);
		await core.start();

		const pending = core.sendDirectRequestAndWait({
			toAgentId: 'agent-b',
			toAgentName: 'Agent B',
			prompt: 'hello',
		});

		const requestMessage = port.sent.find(
			(message) => message.type === 'direct:request',
		);
		expect(requestMessage).toBeDefined();
		const requestPayload = requestMessage?.payload as { requestId: string };

		port.emit(
			createEnvelope({
				seq: 99,
				type: 'direct:response',
				channel: `direct:${requestPayload.requestId}`,
				payload: {
					requestId: requestPayload.requestId,
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'ok',
				},
			}),
		);

		const response = await pending;
		expect(response.action).toBe('DELIVER');
		expect(response.content).toBe('ok');
		expect(logs.some((item) => item.includes('late_response_dropped'))).toBe(
			false,
		);

		await core.close();
	});

	it('times out and sends direct:cancel', async () => {
		const port = new FakeWorkerClientPort();
		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			createAdapter(),
			port,
		);
		await core.start();

		const pending = core.sendDirectRequestAndWait({
			toAgentId: 'agent-b',
			toAgentName: 'Agent B',
			prompt: 'hello',
			timeoutMs: 20,
		});

		await expect(pending).rejects.toThrow('timed out');
		await wait(5);

		const cancelMessage = port.sent.find(
			(message) => message.type === 'direct:cancel',
		);
		expect(cancelMessage).toBeDefined();
		expect((cancelMessage?.payload as { reasonCode: string }).reasonCode).toBe(
			'requester_timeout',
		);

		await core.close();
	});

	it('drops late responses after timeout and records audit log', async () => {
		const port = new FakeWorkerClientPort();
		const onLog = vi.fn();
		const core = new WorkerCore(
			{
				agentId: 'agent-a',
				onLog,
			},
			createAdapter(),
			port,
		);
		await core.start();

		const pending = core.sendDirectRequestAndWait({
			toAgentId: 'agent-b',
			toAgentName: 'Agent B',
			prompt: 'hello',
			timeoutMs: 20,
		});
		await expect(pending).rejects.toThrow();

		const request = port.sent.find(
			(message) => message.type === 'direct:request',
		);
		const requestId = (request?.payload as { requestId: string }).requestId;
		port.emit(
			createEnvelope({
				seq: 100,
				type: 'direct:response',
				channel: `direct:${requestId}`,
				payload: {
					requestId,
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'late',
				},
			}),
		);

		expect(onLog).toHaveBeenCalledWith(
			expect.stringContaining('late_response_dropped'),
		);

		await core.close();
	});

	it('injects ask_peer tool and peer directory into adapter runTurn request', async () => {
		const port = new FakeWorkerClientPort();
		port.setWorkers([
			{
				agentId: 'agent-a',
				agentName: 'agent-a',
				adapterId: 'test-adapter',
				workState: { kind: 'focused' },
				lastSeenAt: Date.now(),
			},
			{
				agentId: 'agent-b',
				agentName: 'agent-b',
				adapterId: 'claude',
				workState: { kind: 'idle' },
				lastSeenAt: Date.now(),
			},
		]);

		const receivedRequests: IRunTurnRequest[] = [];
		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* (request) {
				receivedRequests.push(request);
				yield {
					id: 'evt-start',
					ts: Date.now(),
					type: 'turn:start',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 10,
				type: 'task:assign',
				channel: 'task:task-1',
				payload: {
					taskId: 'task-1',
					turnId: 'turn-1',
					prompt: 'do work',
					workingDirectory: '/tmp',
				},
			}),
		);

		await wait(10);
		expect(receivedRequests).toHaveLength(1);
		expect(
			receivedRequests[0]?.tools?.some((tool) => tool.name === 'ask_peer'),
		).toBe(true);
		expect(
			receivedRequests[0]?.tools?.some((tool) => tool.name === 'get_peers'),
		).toBe(true);
		expect(receivedRequests[0]?.systemPromptSuffix).toContain(
			'## Peer Communication Rules',
		);
		expect(port.sent.some((message) => message.type === 'workers:list')).toBe(
			false,
		);

		await core.close();
	});

	it('ask_peer tool handler bridges to direct request and returns response shape', async () => {
		const port = new FakeWorkerClientPort();
		port.setWorkers([
			{
				agentId: 'agent-a',
				agentName: 'agent-a',
				adapterId: 'test-adapter',
				workState: { kind: 'focused' },
				lastSeenAt: Date.now(),
			},
			{
				agentId: 'agent-b',
				agentName: 'agent-b',
				adapterId: 'claude',
				workState: { kind: 'idle' },
				lastSeenAt: Date.now(),
			},
		]);

		let toolResult: unknown;
		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* (request) {
				const askPeer = request.tools?.find((tool) => tool.name === 'ask_peer');
				expect(askPeer).toBeDefined();
				toolResult = await askPeer?.handler({
					toAgentId: 'agent-b',
					toAgentName: 'agent-b',
					question: 'Need help',
				});
				yield {
					id: 'evt-start',
					ts: Date.now(),
					type: 'turn:start',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 20,
				type: 'task:assign',
				channel: 'task:task-ask',
				payload: {
					taskId: 'task-ask',
					turnId: 'turn-ask',
					prompt: 'ask peer',
					workingDirectory: '/tmp',
				},
			}),
		);

		await wait(10);
		const outbound = port.sent.find(
			(message) => message.type === 'direct:request',
		);
		expect(outbound).toBeDefined();
		const requestId = (outbound?.payload as { requestId: string }).requestId;
		port.emit(
			createEnvelope({
				seq: 21,
				type: 'direct:response',
				channel: `direct:${requestId}`,
				payload: {
					requestId,
					fromAgentId: 'agent-b',
					fromAgentName: 'agent-b',
					toAgentId: 'agent-a',
					toAgentName: 'agent-a',
					action: 'DELIVER',
					content: 'peer answer',
				},
			}),
		);

		await wait(10);
		expect(toolResult).toEqual({
			status: 'DELIVER',
			fromAgentId: 'agent-b',
			fromAgentName: 'agent-b',
			toAgentId: 'agent-a',
			toAgentName: 'agent-a',
			content: 'peer answer',
			origin: undefined,
			ackKind: undefined,
			reasonCode: undefined,
			reason: undefined,
		});

		await core.close();
	});

	it('caches peer directory lookups between nearby turns', async () => {
		const port = new FakeWorkerClientPort();
		port.setWorkers([
			{
				agentId: 'agent-a',
				agentName: 'agent-a',
				adapterId: 'test-adapter',
				workState: { kind: 'idle' },
				lastSeenAt: Date.now(),
			},
			{
				agentId: 'agent-b',
				agentName: 'agent-b',
				adapterId: 'claude',
				workState: { kind: 'idle' },
				lastSeenAt: Date.now(),
			},
		]);

		const receivedRequests: IRunTurnRequest[] = [];
		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* (request) {
				receivedRequests.push(request);
				const getPeers = request.tools?.find(
					(tool) => tool.name === 'get_peers',
				);
				expect(getPeers).toBeDefined();
				await getPeers?.handler({});
				yield {
					id: 'evt-start',
					ts: Date.now(),
					type: 'turn:start',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
				peerDirectoryCacheTtlMs: 60_000,
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 30,
				type: 'task:assign',
				channel: 'task:task-cache-1',
				payload: {
					taskId: 'task-cache-1',
					turnId: 'turn-cache-1',
					prompt: 'first task',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		port.emit(
			createEnvelope({
				seq: 31,
				type: 'task:assign',
				channel: 'task:task-cache-2',
				payload: {
					taskId: 'task-cache-2',
					turnId: 'turn-cache-2',
					prompt: 'second task',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		expect(receivedRequests).toHaveLength(2);
		const workerListCalls = port.sent.filter(
			(message) => message.type === 'workers:list',
		);
		expect(workerListCalls).toHaveLength(1);

		await core.close();
	});

	it('uses explicit no-peer guidance when peer list is empty', async () => {
		const port = new FakeWorkerClientPort();
		port.setWorkers([
			{
				agentId: 'agent-a',
				agentName: 'agent-a',
				adapterId: 'test-adapter',
				workState: { kind: 'idle' },
				lastSeenAt: Date.now(),
			},
		]);

		const receivedRequests: IRunTurnRequest[] = [];
		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* (request) {
				receivedRequests.push(request);
				yield {
					id: 'evt-start',
					ts: Date.now(),
					type: 'turn:start',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 40,
				type: 'task:assign',
				channel: 'task:no-peer',
				payload: {
					taskId: 'task-no-peer',
					turnId: 'turn-no-peer',
					prompt: 'no peers available',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		expect(receivedRequests).toHaveLength(1);
		expect(receivedRequests[0]?.systemPromptSuffix).toContain('## Worker Role');
		expect(receivedRequests[0]?.systemPromptSuffix).not.toContain(
			'| (none) | worker | n/a | offline |',
		);

		await core.close();
	});

	it('sends commitment ACCEPT and DELIVER for assigned task', async () => {
		const port = new FakeWorkerClientPort();
		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* (request) {
				yield {
					id: 'evt-start',
					ts: Date.now(),
					type: 'turn:start',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
				yield {
					id: 'evt-text-done',
					ts: Date.now(),
					type: 'text:done',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
					content: 'done',
				};
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: request.taskId,
					turnId: request.turnId,
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 50,
				type: 'task:assign',
				channel: 'task:task-commitment',
				payload: {
					taskId: 'task-commitment',
					turnId: 'turn-commitment',
					prompt: 'do work',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		const actions = port.sent.filter(
			(message) => message.type === 'commitment:action',
		);
		expect(actions).toHaveLength(2);
		expect((actions[0]?.payload as { action: string }).action).toBe('ACCEPT');
		expect((actions[1]?.payload as { action: string }).action).toBe('DELIVER');

		await core.close();
	});

	it('sends commitment FAIL when task execution throws', async () => {
		const port = new FakeWorkerClientPort();
		const adapter: IProviderAdapter = {
			...createAdapter(),
			// biome-ignore lint/correctness/useYield: throw error
			runTurn: async function* () {
				throw new Error('adapter boom');
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 60,
				type: 'task:assign',
				channel: 'task:task-fail',
				payload: {
					taskId: 'task-fail',
					turnId: 'turn-fail',
					prompt: 'do work',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		const actions = port.sent.filter(
			(message) => message.type === 'commitment:action',
		);
		expect(actions).toHaveLength(2);
		expect((actions[0]?.payload as { action: string }).action).toBe('ACCEPT');
		expect((actions[1]?.payload as { action: string }).action).toBe('FAIL');
		expect((actions[1]?.payload as { reason: string }).reason).toContain(
			'adapter boom',
		);

		await core.close();
	});

	it('sends task:failed when ACCEPT cannot be sent', async () => {
		const port = new FakeWorkerClientPort();
		const originalSend = port.send;
		port.send = async (message) => {
			if (
				message.type === 'commitment:action' &&
				(message.payload as { action?: string }).action === 'ACCEPT'
			) {
				throw new Error('accept send failed');
			}
			await originalSend(message);
		};

		const adapter: IProviderAdapter = {
			...createAdapter(),
			runTurn: async function* () {
				yield {
					id: 'evt-end',
					ts: Date.now(),
					type: 'turn:end',
					taskId: 'task-accept-send-fail',
					turnId: 'turn-accept-send-fail',
					adapterId: 'test-adapter',
				};
			},
		};

		const core = new WorkerCore(
			{
				agentId: 'agent-a',
			},
			adapter,
			port,
		);
		await core.start();

		port.emit(
			createEnvelope({
				seq: 61,
				type: 'task:assign',
				channel: 'task:task-accept-send-fail',
				payload: {
					taskId: 'task-accept-send-fail',
					turnId: 'turn-accept-send-fail',
					prompt: 'do work',
					workingDirectory: '/tmp',
				},
			}),
		);
		await wait(15);

		const taskFailed = port.sent.filter(
			(message) => message.type === 'task:failed',
		);
		expect(taskFailed).toHaveLength(1);
		expect((taskFailed[0]?.payload as { message: string }).message).toContain(
			'accept send failed',
		);

		const actions = port.sent.filter(
			(message) => message.type === 'commitment:action',
		);
		expect(actions).toHaveLength(0);

		await core.close();
	});

	it('retries claim when claimed task is not assigned before timeout', async () => {
		const port = new FakeWorkerClientPort();
		const core = new WorkerCore(
			{
				agentId: 'exec-1',
				workerRole: 'executor',
				enableTaskClaim: true,
				claimBackoffBaseMs: 20,
				claimBackoffMaxMs: 20,
				claimAwaitAssignTimeoutMs: 20,
			},
			createAdapter(),
			port,
		);
		await core.start();
		await wait(130);

		const firstClaim = port.sent.find(
			(message) => message.type === 'task:claim',
		);
		expect(firstClaim).toBeDefined();
		const firstRequestId = (firstClaim?.payload as { requestId: string })
			.requestId;
		port.emit(
			createEnvelope({
				seq: 999,
				type: 'task:claim:result',
				channel: `task:${firstRequestId}`,
				payload: {
					requestId: firstRequestId,
					status: 'claimed',
					taskId: 'task-claim-1',
					assignmentToken: 'token-1',
					leaseExpiresAt: Date.now() + 30_000,
				},
			}),
		);

		await wait(180);
		const claimMessages = port.sent.filter(
			(message) => message.type === 'task:claim',
		);
		expect(claimMessages.length).toBeGreaterThanOrEqual(2);

		await core.close();
	});
});
