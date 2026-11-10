import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, exportJWK, generateKeyPair, importPKCS8 } from 'jose';
import { getLogger } from '@spendwise/common';
import { createPublicKey } from 'node:crypto';

// OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, ARGON2_OPTIONS);

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Pre-computed hash used to keep login timing constant for unknown emails.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(dummyHash, password);
  return false;
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const generateOpaqueToken = () => randomBytes(48).toString('base64url');

export async function loadSigningKeys({ privateKeyBase64, keyId, production }) {
  let privateKey;
  if (privateKeyBase64) {
    const pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    privateKey = await importPKCS8(pem, 'RS256', { extractable: true });
  } else {
    if (production) throw new Error('JWT_PRIVATE_KEY is required in production');
    getLogger().warn('JWT_PRIVATE_KEY not set: generating an ephemeral development key');
    ({ privateKey } = await generateKeyPair('RS256', { extractable: true }));
    // A unique kid per ephemeral key makes JWKS clients (gateway, services) refetch
    // immediately after a restart instead of verifying against a stale cached key.
    keyId = `${keyId}-dev-${randomBytes(4).toString('hex')}`;
  }
  const publicKey = createPublicKey(privateKey);
  const jwk = { ...(await exportJWK(publicKey)), kid: keyId, alg: 'RS256', use: 'sig' };
  return { privateKey, publicKey, jwks: { keys: [jwk] }, keyId };
}

export function createTokenSigner({ privateKey, keyId, issuer, audience, accessTokenTtl }) {
  return {
    async signAccessToken(user) {
      const jti = randomUUID();
      const token = await new SignJWT({ email: user.email, name: user.name, roles: user.roles, typ: 'access' })
        .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'JWT' })
        .setSubject(user.id)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setJti(jti)
        .setExpirationTime(accessTokenTtl)
        .sign(privateKey);
      return { token, jti };
    },
  };
}

/** Password policy: 10-128 chars with upper, lower and digit; not equal to the email. */
export function checkPasswordPolicy(password, email) {
  const problems = [];
  if (password.length < 10) problems.push('at least 10 characters');
  if (password.length > 128) problems.push('at most 128 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/\d/.test(password)) problems.push('a digit');
  const local = email?.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) problems.push('not contain your email');
  return problems;
}
