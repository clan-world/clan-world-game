import type { IncomingMessage } from "node:http";

type AuthResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

function isDevBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_AUTH_BYPASS === "true";
}

function bearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const [scheme, token] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function verifyAdminRequest(req: IncomingMessage): Promise<AuthResult> {
  if (isDevBypassEnabled()) {
    return { ok: true };
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return {
      ok: false,
      status: 401,
      code: "clerk_not_configured",
      message: "Clerk admin auth is not configured",
    };
  }

  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "missing_session",
      message: "Missing Clerk session token",
    };
  }

  try {
    const clerk = await import("@clerk/backend");
    await clerk.verifyToken(token, { secretKey });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 401,
      code: "invalid_session",
      message,
    };
  }
}
