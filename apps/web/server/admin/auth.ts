import type { IncomingMessage } from "node:http";

type AuthResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

// Positive check: only the literal string "development" enables bypass.
// "test"/"staging"/unset will NOT bypass. This closes the "NODE_ENV unset
// in preview deploy" hole that codex flagged on R1.
function isDevBypassEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.ADMIN_AUTH_BYPASS === "true";
}

function bearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const [scheme, token] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

// Admin allowlist: a valid Clerk session is necessary but NOT sufficient.
// Any user signed into the Clerk instance has a valid session; only the
// userIds listed in ADMIN_ALLOWED_USER_IDS are operators. Empty list = no
// admins (fails closed). Each entry trimmed; whitespace tolerated.
function parseAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
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
    const claims = await clerk.verifyToken(token, { secretKey });

    const allowed = parseAdminAllowlist();
    if (allowed.size === 0) {
      return {
        ok: false,
        status: 503,
        code: "admin_allowlist_unconfigured",
        message:
          "Admin allowlist is empty. Set ADMIN_ALLOWED_USER_IDS to a comma-separated list of Clerk userIds before enabling admin auth.",
      };
    }

    const userId = (claims as { sub?: string }).sub;
    if (!userId || !allowed.has(userId)) {
      return {
        ok: false,
        status: 403,
        code: "not_admin",
        message: "User is signed in but not on the admin allowlist",
      };
    }

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
