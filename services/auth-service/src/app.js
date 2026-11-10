import cookieParser from 'cookie-parser';
import { ApiRouter, BadRequest, createApp, extractBearer, requiredText, verifyAccessToken, z } from '@spendwise/common';

export const REFRESH_COOKIE = 'sw_refresh';
const COOKIE_PATH = '/api/v1/auth';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(128);

const sessionResponse = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), name: z.string(), roles: z.array(z.string()) }),
  accessToken: z.string(),
});

/** CSRF defence for cookie-authenticated endpoints: SameSite=Strict + a custom header browsers cannot send cross-site without CORS approval. */
function requireXhr(req, res, next) {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') return next(BadRequest('Missing X-Requested-With header'));
  next();
}

export function buildApp({ service, config, jwks, readiness = {} }) {
  const cookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH,
  };
  const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
  const sendSession = (res, session) => {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, expires: session.refreshExpiresAt });
    res.set('Cache-Control', 'no-store');
    return { user: session.user, accessToken: session.accessToken };
  };

  const auth = new ApiRouter({ prefix: '/api/v1/auth', tags: ['Authentication'] });

  auth.post('/register', {
    auth: 'none',
    summary: 'Register a new account',
    status: 201,
    body: z.object({ email, password, name: requiredText(100) }),
    response: sessionResponse,
    handler: async (req, res) => sendSession(res, await service.register(req.valid.body, meta(req))),
  });

  auth.post('/login', {
    auth: 'none',
    summary: 'Log in with email and password',
    body: z.object({ email, password }),
    response: sessionResponse,
    handler: async (req, res) => sendSession(res, await service.login(req.valid.body, meta(req))),
  });

  auth.post('/refresh', {
    auth: 'none',
    summary: 'Rotate the refresh token (httpOnly cookie) and obtain a new access token',
    middleware: [requireXhr],
    response: sessionResponse,
    handler: async (req, res) => {
      try {
        return sendSession(res, await service.refresh(req.cookies?.[REFRESH_COOKIE], meta(req)));
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions);
        throw err;
      }
    },
  });

  auth.post('/logout', {
    auth: 'none',
    summary: 'Log out the current session',
    middleware: [requireXhr],
    handler: async (req, res) => {
      let access = {};
      const bearer = extractBearer(req);
      if (bearer) {
        try {
          const payload = await verifyAccessToken(bearer);
          access = { accessJti: payload.jti, accessExp: payload.exp, userId: payload.sub };
        } catch {
          // expired access tokens are fine on logout
        }
      }
      await service.logout({ refreshToken: req.cookies?.[REFRESH_COOKIE], ...access });
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
    },
  });

  auth.post('/logout-all', {
    summary: 'Revoke every session of the current user',
    handler: async (req, res) => {
      await service.logoutAll(req.user.id, { accessJti: req.user.jti, accessExp: req.user.exp });
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
    },
  });

  auth.get('/me', { summary: 'Current user', handler: (req) => service.me(req.user.id) });

  auth.get('/sessions', { summary: 'List active sessions', handler: (req) => service.listSessions(req.user.id) });

  auth.delete('/sessions/:id', {
    summary: 'Revoke a session',
    params: z.object({ id: z.string().uuid() }),
    handler: (req) => service.revokeSession(req.user.id, req.valid.params.id),
  });

  auth.post('/forgot-password', {
    auth: 'none',
    summary: 'Request a password reset email (always returns 202)',
    status: 202,
    body: z.object({ email }),
    handler: async (req) => {
      await service.requestPasswordReset(req.valid.body.email);
      return { message: 'If an account exists for this email, a reset link has been sent.' };
    },
  });

  auth.post('/reset-password', {
    auth: 'none',
    summary: 'Reset the password with a token from the reset email',
    body: z.object({ token: z.string().min(20).max(200), password }),
    handler: (req) => service.resetPassword(req.valid.body),
  });

  auth.post('/change-password', {
    summary: 'Change password (requires the current password)',
    body: z.object({ currentPassword: password, newPassword: password }),
    handler: (req) => service.changePassword(req.user.id, req.valid.body),
  });

  const wellKnown = new ApiRouter({ prefix: '/.well-known', tags: ['Keys'] });
  wellKnown.get('/jwks.json', {
    auth: 'none',
    summary: 'JSON Web Key Set used by other services to verify access tokens',
    handler: (req, res) => {
      res.set('Cache-Control', 'public, max-age=300');
      return jwks;
    },
  });

  return createApp({
    name: 'auth-service',
    description: 'Registration, login, JWT access tokens, rotating refresh tokens, sessions and password reset.',
    routers: [auth, wellKnown],
    readiness,
    enableDocs: config.ENABLE_DOCS,
    configure: (app) => app.use(cookieParser()),
  });
}
