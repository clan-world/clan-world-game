/**
 * Error-path coverage for the admin inject-message HTTP handler.
 *
 * Targets failures the cockpit UI (AdminMessageTab) and any other API consumer
 * can hit: method rejection, missing/invalid auth, body validation rejections,
 * downstream Convex rejection, and the partial-failure "all elders" path.
 *
 * Tests are pure Node (no DOM) — vitest env is `node` in apps/web and there is
 * no @testing-library installed. The handler under test (`handleInjectMessage`)
 * is itself pure Node — it accepts IncomingMessage + ServerResponse — so we
 * fake those with small in-memory shims rather than spinning up a real http
 * server.
 *
 * Mocks: `./convex` (so we don't pull ConvexHttpClient + read /etc/clan-world
 * operator secret) and `@clerk/backend` (so the auth path is deterministic).
 */
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the convex module BEFORE importing handleInjectMessage — vitest hoists
// vi.mock calls automatically. The mock state is reset between tests via the
// vi.mocked() controls below.
vi.mock('../server/admin/convex', () => ({
  injectPendingMessage: vi.fn(),
}));

// Mock @clerk/backend so any path that calls verifyToken is deterministic
// without needing a real Clerk secret + signed JWT.
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

import { handleInjectMessage } from '../server/admin/injectMessage';
import { injectPendingMessage } from '../server/admin/convex';
import { verifyToken } from '@clerk/backend';

type FakeReq = {
  method: string;
  headers: Record<string, string>;
  body?: string;
};

/**
 * Build a Readable stream + IncomingMessage-shaped object that
 * `handleInjectMessage`'s `readBody` helper can consume.
 */
function fakeRequest({ method, headers, body }: FakeReq): import('node:http').IncomingMessage {
  // Readable.from + assigning the additional IncomingMessage fields gives us
  // everything `handleInjectMessage` touches (method, headers, on('data'),
  // on('end'), setEncoding, destroy).
  const stream = Readable.from(body ?? '');
  // setEncoding is a no-op on Readable.from — but the handler calls it.
  // Override with an empty fn so the assertion doesn't trip the wrong path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).setEncoding = () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).method = method;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stream as any).headers = headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stream as any;
}

/**
 * Minimal ServerResponse shim that captures statusCode + body. Mirrors the
 * shape of the calls `sendJson` makes (statusCode setter, setHeader, end).
 */
function fakeResponse() {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(payload?: string) {
      body = payload ?? '';
    },
    // Expose captured state for assertions.
    get body() {
      return body;
    },
    get json(): unknown {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    },
    get headers() {
      return headers;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res as any;
}

const VALID_BODY = JSON.stringify({
  targetElderId: 'elder-1',
  text: 'hello world',
  source: 'admin-injection',
});

// Save + restore the env so tests don't leak NODE_ENV / CLERK_SECRET_KEY /
// ADMIN_ALLOWED_USER_IDS / ADMIN_AUTH_BYPASS into sibling tests.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Default to "auth fully configured + caller is admin" so individual tests
  // only override what they need.
  process.env.NODE_ENV = 'test';
  process.env.CLERK_SECRET_KEY = 'sk_test_anything';
  process.env.ADMIN_ALLOWED_USER_IDS = 'user_admin_1';
  delete process.env.ADMIN_AUTH_BYPASS;
  vi.mocked(verifyToken).mockResolvedValue({ sub: 'user_admin_1' } as never);
  vi.mocked(injectPendingMessage).mockResolvedValue('pending_xyz');
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('handleInjectMessage — error paths', () => {
  it('rejects non-POST with 405 method_not_allowed', async () => {
    const req = fakeRequest({ method: 'GET', headers: {} });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.json).toEqual({
      error: { code: 'method_not_allowed', message: 'Use POST' },
    });
    // Auth must NOT run before the method gate — otherwise a GET probe leaks
    // CLERK_SECRET_KEY-bound timing differences.
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 clerk_not_configured when CLERK_SECRET_KEY is unset', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer anything' },
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.json).toMatchObject({
      error: { code: 'clerk_not_configured' },
    });
  });

  it('returns 401 missing_session when bearer header is absent', async () => {
    const req = fakeRequest({
      method: 'POST',
      headers: {},
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.json).toMatchObject({
      error: { code: 'missing_session' },
    });
    // Downstream MUST NOT be invoked when auth fails — otherwise a malformed
    // bearer call would still write to Convex.
    expect(injectPendingMessage).not.toHaveBeenCalled();
  });

  it('returns 403 not_admin when caller is signed in but not on allowlist', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'user_random_42' } as never);
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.json).toMatchObject({ error: { code: 'not_admin' } });
    expect(injectPendingMessage).not.toHaveBeenCalled();
  });

  it('returns 503 admin_allowlist_unconfigured when allowlist env is empty', async () => {
    // Empty allowlist must FAIL CLOSED — a successful Clerk verify is necessary
    // but not sufficient for admin access.
    process.env.ADMIN_ALLOWED_USER_IDS = '   ,  , ';
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.json).toMatchObject({
      error: { code: 'admin_allowlist_unconfigured' },
    });
  });

  it('returns 400 validation_error on invalid JSON body', async () => {
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: '{ not json',
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.json).toMatchObject({
      error: { code: 'validation_error', message: expect.stringMatching(/JSON/i) },
    });
  });

  it('returns 400 when targetElderId is not in allowlist', async () => {
    const body = JSON.stringify({
      targetElderId: 'elder-99',
      text: 'hello',
      source: 'admin-injection',
    });
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.json as { error?: { message?: string } }).error?.message).toMatch(/targetElderId/);
  });

  it('returns 400 when text is whitespace-only', async () => {
    // Trim-then-check guards against "   " bypassing the empty-string check.
    const body = JSON.stringify({
      targetElderId: 'elder-1',
      text: '     ',
      source: 'admin-injection',
    });
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.json as { error?: { message?: string } }).error?.message).toMatch(/text is required/);
  });

  it('returns 400 when text exceeds MAX_TEXT_LENGTH (2000)', async () => {
    const body = JSON.stringify({
      targetElderId: 'elder-1',
      text: 'a'.repeat(2001),
      source: 'admin-injection',
    });
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.json as { error?: { message?: string } }).error?.message).toMatch(/2000/);
  });

  it('returns 400 when source is unrecognized', async () => {
    const body = JSON.stringify({
      targetElderId: 'elder-1',
      text: 'hello',
      source: 'system-bus', // not in admin-injection / user-message
    });
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(400);
    expect((res.json as { error?: { message?: string } }).error?.message).toMatch(/source/);
  });

  it('returns 500 when Convex rejects the only target', async () => {
    vi.mocked(injectPendingMessage).mockRejectedValue(new Error('convex out of quota'));
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    // Single-target failure path: slugs.length === 0, errors.length > 0 → 500.
    expect(res.statusCode).toBe(500);
    const json = res.json as { slugs: unknown[]; errors: Array<{ message: string }> };
    expect(json.slugs).toEqual([]);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]?.message).toMatch(/convex out of quota/);
  });

  it('returns 207 partial-success when "all" target sees mixed Convex outcomes', async () => {
    // First elder succeeds, second rejects, third + fourth succeed —
    // exercises the multi-status path that single-target callers never hit.
    let call = 0;
    vi.mocked(injectPendingMessage).mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error('elder-2 convex burst');
      return `pending_${call}`;
    });
    const body = JSON.stringify({
      targetElderId: 'all',
      text: 'broadcast',
      source: 'admin-injection',
    });
    const req = fakeRequest({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(207);
    const json = res.json as {
      slugs: Array<{ targetElderId: string; pendingMessageId: string }>;
      errors: Array<{ targetElderId: string; message: string }>;
    };
    expect(json.slugs.map((s) => s.targetElderId)).toEqual(['elder-1', 'elder-3', 'elder-4']);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]?.targetElderId).toBe('elder-2');
    expect(json.errors[0]?.message).toMatch(/elder-2 convex burst/);
  });

  it('honors dev bypass ONLY when NODE_ENV=development AND ADMIN_AUTH_BYPASS=true', async () => {
    // The bypass guard is positive — anything other than the exact pair must
    // still require a valid bearer. This pins the "no NODE_ENV in prod" hole.
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_AUTH_BYPASS = 'true';
    // Remove CLERK_SECRET_KEY to prove the bypass short-circuits BEFORE the
    // clerk_not_configured check.
    delete process.env.CLERK_SECRET_KEY;
    const req = fakeRequest({
      method: 'POST',
      headers: {}, // no bearer
      body: VALID_BODY,
    });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(200);
    expect((res.json as { pendingMessageId?: string }).pendingMessageId).toBe('pending_xyz');
    expect(verifyToken).not.toHaveBeenCalled();

    // Negative: same env but ADMIN_AUTH_BYPASS unset → falls through to the
    // CLERK_SECRET_KEY check and returns 401.
    delete process.env.ADMIN_AUTH_BYPASS;
    const res2 = fakeResponse();
    await handleInjectMessage(
      fakeRequest({ method: 'POST', headers: {}, body: VALID_BODY }),
      res2,
    );
    expect(res2.statusCode).toBe(401);
    expect((res2.json as { error?: { code?: string } }).error?.code).toBe('clerk_not_configured');
  });

  it('returns 204 with empty body for CORS preflight (OPTIONS)', async () => {
    // Important so the in-browser fetch from AdminMessageTab survives
    // preflight when the cockpit subdomain ever diverges from the API host.
    const req = fakeRequest({ method: 'OPTIONS', headers: {} });
    const res = fakeResponse();
    await handleInjectMessage(req, res);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
