import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { setContextValue } from './context.js';
import { AppError, Forbidden, Unauthorized } from './errors.js';

const state = {
  keySource: null,
  issuer: 'spendwise-auth',
  audience: 'spendwise',
  internalToken: null,
  isRevoked: null,
};

/**
 * Configures JWT verification. Services verify RS256 access tokens against the auth
 * service's JWKS (defense in depth: the gateway verifies too, but services never trust
 * the network). `key` allows a local key (auth-service itself and tests).
 */
export function configureAuth({ jwksUrl, key, issuer, audience, internalToken, isRevoked } = {}) {
  if (jwksUrl) {
    state.keySource = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 5_000, cacheMaxAge: 600_000 });
  } else if (key) {
    state.keySource = key;
  }
  if (issuer) state.issuer = issuer;
  if (audience) state.audience = audience;
  if (internalToken) state.internalToken = Buffer.from(internalToken);
  if (isRevoked) state.isRevoked = isRevoked;
}

export async function verifyAccessToken(token) {
  if (!state.keySource) throw new Error('JWT verification is not configured');
  const { payload } = await jwtVerify(token, state.keySource, {
    issuer: state.issuer,
    audience: state.audience,
    algorithms: ['RS256'],
    clockTolerance: 5,
  });
  if (payload.typ !== 'access') throw Unauthorized('Invalid token type');
  if (state.isRevoked && payload.jti && (await state.isRevoked(payload.jti))) throw Unauthorized('Token has been revoked');
  return payload;
}

export function extractBearer(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

export async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return next(Unauthorized('Missing bearer token'));
  try {
    const payload = await verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      jti: payload.jti,
      exp: payload.exp,
    };
    req.accessToken = token;
    setContextValue('userId', payload.sub);
    next();
  } catch (err) {
    next(err instanceof AppError ? err : Unauthorized('Invalid or expired token'));
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(Unauthorized());
    if (!roles.some((role) => req.user.roles.includes(role))) return next(Forbidden());
    next();
  };
}

/** Service-to-service endpoints (/internal/*) require a shared secret; the gateway never routes them. */
export function requireInternal(req, res, next) {
  const provided = Buffer.from(req.get('x-internal-token') ?? '');
  const expected = state.internalToken;
  if (!expected || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return next(Unauthorized('Invalid internal credentials'));
  }
  next();
}
