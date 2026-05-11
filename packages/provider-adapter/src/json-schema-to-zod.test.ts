import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { convertJsonSchemaToZodShape } from './json-schema-to-zod';

describe('convertJsonSchemaToZodShape', () => {
	it('converts required and optional fields', () => {
		const shape = convertJsonSchemaToZodShape({
			type: 'object',
			properties: {
				toAgentId: { type: 'string' },
				question: { type: 'string' },
				timeoutMs: { type: 'number' },
			},
			required: ['toAgentId', 'question'],
		});
		const schema = z.object(shape);

		expect(
			schema.parse({
				toAgentId: 'agent-b',
				question: 'Need review?',
			}),
		).toEqual({
			toAgentId: 'agent-b',
			question: 'Need review?',
		});
		expect(() => schema.parse({ question: 'missing target' })).toThrow();
		expect(() =>
			schema.parse({
				toAgentId: 'agent-b',
				question: 'bad timeout',
				timeoutMs: '1000',
			}),
		).toThrow();
	});

	it('throws if top-level schema has no properties object', () => {
		expect(() =>
			convertJsonSchemaToZodShape({
				type: 'object',
			}),
		).toThrow('Tool inputSchema must define object properties');
	});
});
