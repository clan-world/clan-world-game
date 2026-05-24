import type { IncomingMessage, ServerResponse } from "node:http";
import { generateThematicSlug } from "./thematicSlug";
import { injectPendingMessage, type ElderId, type MessageSource } from "./convex";
import { verifyAdminRequest } from "./auth";

const ELDERS: ElderId[] = ["elder-1", "elder-2", "elder-3", "elder-4"];
const SOURCES: MessageSource[] = ["admin-injection", "user-message"];
const MAX_TEXT_LENGTH = 2000;

type Target = ElderId | "all";

type JsonRecord = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, body: JsonRecord): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseBody(raw: string): { targetElderId: Target; text: string; source: MessageSource } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("body must be an object");
  }

  const body = parsed as Record<string, unknown>;
  const targetElderId = body.targetElderId;
  const text = body.text;
  const source = body.source;

  if (targetElderId !== "all" && !ELDERS.includes(targetElderId as ElderId)) {
    throw new Error("targetElderId must be elder-1, elder-2, elder-3, elder-4, or all");
  }
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("text is required");
  }
  if (text.trim().length > MAX_TEXT_LENGTH) {
    throw new Error("text must be 2000 characters or fewer");
  }
  if (!SOURCES.includes(source as MessageSource)) {
    throw new Error("source must be admin-injection or user-message");
  }

  return {
    targetElderId: targetElderId as Target,
    text: text.trim(),
    source: source as MessageSource,
  };
}

export async function handleInjectMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST" } });
    return;
  }

  const auth = await verifyAdminRequest(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: { code: auth.code, message: auth.message } });
    return;
  }

  let body: ReturnType<typeof parseBody>;
  try {
    body = parseBody(await readBody(req));
  } catch (err) {
    sendJson(res, 400, {
      error: {
        code: "validation_error",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  const targets = body.targetElderId === "all" ? ELDERS : [body.targetElderId];
  const slugs: Array<{ targetElderId: ElderId; pendingMessageId: string; slug: string }> = [];
  const errors: Array<{ targetElderId: ElderId; message: string }> = [];

  for (const targetElderId of targets) {
    const slug = generateThematicSlug();
    try {
      const pendingMessageId = await injectPendingMessage({
        targetElderId,
        text: body.text,
        source: body.source,
      });
      slugs.push({ targetElderId, pendingMessageId, slug });
    } catch (err) {
      errors.push({
        targetElderId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (body.targetElderId !== "all" && slugs[0] && errors.length === 0) {
    sendJson(res, 200, {
      pendingMessageId: slugs[0].pendingMessageId,
      slug: slugs[0].slug,
    });
    return;
  }

  if (slugs.length === 0 && errors.length > 0) {
    sendJson(res, 500, { slugs, errors });
    return;
  }

  sendJson(res, errors.length > 0 ? 207 : 200, { slugs, errors });
}
