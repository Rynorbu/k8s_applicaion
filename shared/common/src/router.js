import express from 'express';
import { requireAuth, requireInternal, requireRoles } from './auth.js';

/** Validates params/query/body with zod and exposes the parsed values on `req.valid`. */
export function validate({ params, query, body } = {}) {
  return (req, res, next) => {
    req.valid = {};
    if (params) req.valid.params = params.parse(req.params);
    if (query) req.valid.query = query.parse(req.query);
    if (body) req.valid.body = body.parse(req.body ?? {});
    next();
  };
}

/**
 * Express router that keeps a declarative description of each route. The same
 * definition drives authentication, validation, response handling AND the generated
 * OpenAPI document, so docs can never drift from the implementation.
 */
export class ApiRouter {
  constructor({ prefix = '', tags = [] } = {}) {
    this.prefix = prefix;
    this.tags = tags;
    this.router = express.Router();
    this.routes = [];
  }

  #register(method, path, def) {
    const {
      auth = 'user',
      roles,
      params,
      query,
      body,
      handler,
      status = 200,
      middleware = [],
      raw = false,
    } = def;
    const chain = [];
    if (auth === 'user' || auth === 'admin') chain.push(requireAuth);
    if (auth === 'admin') chain.push(requireRoles('admin'));
    if (roles?.length) chain.push(requireRoles(...roles));
    if (auth === 'internal') chain.push(requireInternal);
    chain.push(...middleware);
    chain.push(validate({ params, query, body }));
    chain.push(async (req, res) => {
      const result = await handler(req, res);
      if (raw || res.headersSent) return;
      if (result === undefined) return res.status(204).end();
      res.status(status).json(result);
    });
    this.router[method](path, ...chain);
    const fullPath = path === '/' ? this.prefix || '/' : `${this.prefix}${path}`;
    this.routes.push({ ...def, method, auth, status, path: fullPath, tags: def.tags ?? this.tags });
    return this;
  }

  get(path, def) {
    return this.#register('get', path, def);
  }
  post(path, def) {
    return this.#register('post', path, def);
  }
  put(path, def) {
    return this.#register('put', path, def);
  }
  patch(path, def) {
    return this.#register('patch', path, def);
  }
  delete(path, def) {
    return this.#register('delete', path, def);
  }
}
