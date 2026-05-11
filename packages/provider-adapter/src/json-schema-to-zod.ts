import { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === 'object' && value !== null;
};

const isLiteralValue = (
	value: unknown,
): value is string | number | boolean | null => {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value === null
	);
};

const withDescription = (schema: z.ZodTypeAny, input: unknown) => {
	if (!isRecord(input) || typeof input.description !== 'string') {
		return schema;
	}
	return schema.describe(input.description);
};

const createUnionSchema = (schemas: z.ZodTypeAny[]) => {
	if (schemas.length === 0) {
		return z.unknown();
	}
	if (schemas.length === 1) {
		return schemas[0];
	}
	const [first, second, ...rest] = schemas;
	return z.union([first, second, ...rest]);
};

const buildBaseSchema = (schema: unknown): z.ZodTypeAny => {
	if (!isRecord(schema)) {
		return z.unknown();
	}

	if ('const' in schema) {
		if (isLiteralValue(schema.const)) {
			return withDescription(z.literal(schema.const), schema);
		}
		return z.unknown();
	}

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const enumValues = schema.enum.filter(
			(value) => typeof value === 'string',
		) as string[];
		if (enumValues.length > 0) {
			return withDescription(z.enum(enumValues), schema);
		}
	}

	if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
		const variants = schema.anyOf.map((item) => schemaToZodType(item));
		return withDescription(createUnionSchema(variants), schema);
	}

	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		const variants = schema.oneOf.map((item) => schemaToZodType(item));
		return withDescription(createUnionSchema(variants), schema);
	}

	const rawType = schema.type;
	const types = Array.isArray(rawType)
		? rawType.filter((value): value is string => typeof value === 'string')
		: typeof rawType === 'string'
			? [rawType]
			: [];

	const coreType = types.find((type) => type !== 'null');
	const allowsNull = types.includes('null');

	let base: z.ZodTypeAny;
	switch (coreType) {
		case 'string':
			base = z.string();
			break;
		case 'number':
			base = z.number();
			break;
		case 'integer':
			base = z.number().int();
			break;
		case 'boolean':
			base = z.boolean();
			break;
		case 'array':
			base = z.array(schemaToZodType(schema.items));
			break;
		case 'object':
			base = z.object(convertJsonSchemaToZodShape(schema));
			break;
		default:
			base = z.unknown();
			break;
	}

	const described = withDescription(base, schema);
	return allowsNull ? createUnionSchema([described, z.null()]) : described;
};

const schemaToZodType = (schema: unknown): z.ZodTypeAny => {
	return buildBaseSchema(schema);
};

export const convertJsonSchemaToZodShape = (
	inputSchema: Record<string, unknown>,
) => {
	const rawProperties = inputSchema.properties;
	if (!isRecord(rawProperties)) {
		throw new Error('Tool inputSchema must define object properties');
	}

	const required = new Set(
		Array.isArray(inputSchema.required)
			? inputSchema.required.filter(
					(value): value is string => typeof value === 'string',
				)
			: [],
	);

	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [propertyName, propertySchema] of Object.entries(rawProperties)) {
		const propertyType = schemaToZodType(propertySchema);
		shape[propertyName] = required.has(propertyName)
			? propertyType
			: propertyType.optional();
	}
	return shape as z.ZodRawShape;
};
