import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { FunctionReference } from "convex/server";

type ElderId = "elder-1" | "elder-2" | "elder-3" | "elder-4";
type MessageSource = "admin-injection" | "user-message";

type InjectMessageArgs = {
  secret: string;
  targetElderId: ElderId;
  text: string;
  source: MessageSource;
};

const injectMessageRef = (anyApi as unknown as {
  adminMessages: {
    injectMessage: FunctionReference<"mutation", "public", InjectMessageArgs, string>;
  };
}).adminMessages.injectMessage;

function readOperatorSecret(): string {
  // Default points at the canonical bind-mount location used by all elder
  // containers (matches BUS_ELDER_SECRET_FILE convention). Relative paths
  // are resolved against process.cwd(), which is reliable inside a container
  // entrypoint but brittle when running `node` from a subdirectory locally.
  // Always pass an absolute path in production.
  const secretFile = process.env.BUS_OPERATOR_SECRET_FILE
    ?? "/etc/clan-world/secrets/bus-operator.key";
  const resolved = path.isAbsolute(secretFile)
    ? secretFile
    : path.resolve(process.cwd(), secretFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `BUS operator secret file not found at ${resolved} ` +
      `(BUS_OPERATOR_SECRET_FILE='${secretFile}'). ` +
      `Set BUS_OPERATOR_SECRET_FILE to an absolute path.`,
    );
  }
  return fs.readFileSync(resolved, "utf8").trim();
}

function convexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.CONVEX_DEPLOY_URL ?? process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL, CONVEX_DEPLOY_URL, or VITE_CONVEX_URL is required");
  }
  return url;
}

export async function injectPendingMessage(args: Omit<InjectMessageArgs, "secret">): Promise<string> {
  const client = new ConvexHttpClient(convexUrl());
  return await client.mutation(injectMessageRef, {
    secret: readOperatorSecret(),
    ...args,
  });
}

export type { ElderId, MessageSource };
