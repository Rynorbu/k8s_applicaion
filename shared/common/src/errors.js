import { ZodError } from 'zod';
import { getContext } from './context.js';
import { getLogger } from './logger.js';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (message = 'Bad request', details) => new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const Forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const NotFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const Conflict = (message = 'Resource conflict', details) => new AppError(409, 'CONFLICT', message, details);
export const PayloadTooLarge = (message = 'Payload too large') => new AppError(413, 'PAYLOAD_TOO_LARGE', message);
export const UnprocessableEntity = (message, details) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);
export const TooManyRequests = (message = 'Too many requests') => new AppError(429, 'TOO_MANY_REQUESTS', message);
export const ServiceUnavailable = (message = 'A dependency is temporarily unavailable') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

function formatZodIssues(error) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** Maps any thrown error to a safe JSON response. Internal details are logged, never returned. */
export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Request validation failed', details: formatZodIssues(err) };
  }
  if (err?.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Malformed JSON body' };
  if (err?.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
  if (err?.code === 'LIMIT_FILE_SIZE') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'File too large' };
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return { status: 400, code: 'BAD_REQUEST', message: 'Unexpected file field' };
  // PostgreSQL errors
  if (err?.code === '23505') return { status: 409, code: 'CONFLICT', message: 'A resource with these values already exists' };
  if (err?.code === '23503') return { status: 409, code: 'CONFLICT', message: 'Referenced resource does not exist' };
  if (err?.code === '22P02') return { status: 400, code: 'BAD_REQUEST', message: 'Invalid identifier format' };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: getContext().requestId } });
}

export function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = toErrorResponse(err);
  const log = getLogger();
  if (status >= 500) log.error({ err, method: req.method, path: req.path }, 'request failed');
  else log.warn({ code, status, method: req.method, path: req.path }, message);
  if (res.headersSent) return;
  res.status(status).json({ error: { code, message, details, requestId: getContext().requestId ?? req.id } });
}
