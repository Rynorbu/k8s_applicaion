import { zodToJsonSchema } from 'zod-to-json-schema';

function toJsonSchema(schema) {
  const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  delete json.$schema;
  return json;
}

function toParameters(schema, location) {
  if (!schema) return [];
  const json = toJsonSchema(schema);
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name),
    schema: propSchema,
    description: propSchema.description,
  }));
}

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

/** Builds an OpenAPI 3 document from ApiRouter route definitions. */
export function buildOpenApi({ title, version = '1.0.0', description, routers, serverUrl = '/' }) {
  const paths = {};
  for (const route of routers.flatMap((r) => r.routes)) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const operation = {
      tags: route.tags,
      summary: route.summary,
      description: route.description,
      operationId: route.operationId,
      parameters: [...toParameters(route.params, 'path'), ...toParameters(route.query, 'query')],
      responses: {},
    };
    if (route.body) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: toJsonSchema(route.body) } } };
    } else if (route.requestBody) {
      operation.requestBody = route.requestBody;
    }
    const okStatus = String(route.status ?? 200);
    operation.responses[okStatus] = route.response
      ? { description: 'Success', content: { 'application/json': { schema: toJsonSchema(route.response) } } }
      : { description: route.responseDescription ?? 'Success' };
    if (route.params || route.query || route.body || route.requestBody) {
      operation.responses['400'] = errorResponse('Validation error');
    }
    if (route.auth === 'user' || route.auth === 'admin') {
      operation.security = [{ bearerAuth: [] }];
      operation.responses['401'] = errorResponse('Unauthenticated');
      if (route.auth === 'admin') operation.responses['403'] = errorResponse('Forbidden');
    } else if (route.auth === 'internal') {
      operation.security = [{ internalToken: [] }];
      operation.responses['401'] = errorResponse('Invalid internal token');
    } else {
      operation.security = [];
    }
    Object.assign(operation.responses, route.extraResponses ?? {});
    operation.responses['500'] = errorResponse('Unexpected error');
    paths[path] ??= {};
    paths[path][route.method] = operation;
  }
  return {
    openapi: '3.0.3',
    info: { title, version, description },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        internalToken: { type: 'apiKey', in: 'header', name: 'x-internal-token' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {},
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
