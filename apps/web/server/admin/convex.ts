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
  const secretFile = process.env.BUS_OPERATOR_SECRET_FILE ?? "agents/secrets/bus-operator.key";
  const resolved = path.isAbsolute(secretFile) ? secretFile : path.resolve(process.cwd(), secretFile);
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
