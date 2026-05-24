import { generateUniqueThematicUid } from "./thematicUid.js";
import { composeMessage, type ComposedMessage } from "./messageComposer.js";
import { postPasteSubmitted, prePasteReady } from "./pasteVerification.js";
import { sleep } from "./retry.js";
import type { RunnerConvexClient } from "./convexClient.js";
import type { TmuxSink } from "./tmuxSink.js";
import type { PendingMessage, ResetMetadata } from "./types.js";

export interface DeliverInput {
  tickNumber?: number;
  templates?: Array<{ fileName: string; content: string }>;
  fastForwardPrefix?: string;
  pendingMessages?: PendingMessage[];
  resetMetadata?: ResetMetadata;
  receiveTickNumber?: number;
  receiveTimeoutMs: number;
  receivePollMs: number;
  maxAttempts: number;
  signal?: AbortSignal;
}

export interface DeliveryResult extends ComposedMessage {
  confirmed: boolean;
}

export async function deliverMessage(
  convex: RunnerConvexClient,
  tmux: TmuxSink,
  input: DeliverInput,
): Promise<DeliveryResult> {
  const composed = await composeWithPendingUids(convex, input);
  if (input.tickNumber !== undefined) {
    await convex.recordTickSend(input.tickNumber, composed.messageHash, input.resetMetadata, input.signal);
  }

  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    input.signal?.throwIfAborted();
    if (!(await prePasteReady(tmux))) {
      await convex.recordRunnerEvent("ready_probe_timeout", `pre-paste readiness failed for tick ${input.tickNumber ?? "message"}`, input.signal);
      return { ...composed, confirmed: false };
    }
    await tmux.pasteMessage(composed.text);
    await postPasteSubmitted(tmux);

    if (input.receiveTickNumber === undefined) {
      await convex.consumePendingMessages(composed.pendingMessageIds, Date.now(), input.signal);
      return { ...composed, confirmed: true };
    }

    const received = await waitForReceive(convex, input.receiveTickNumber, input.receiveTimeoutMs, input.receivePollMs, input.signal);
    if (received) {
      await convex.consumePendingMessages(composed.pendingMessageIds, Date.now(), input.signal);
      return { ...composed, confirmed: true };
    }
  }

  await convex.recordRunnerEvent(
    "hook_failure",
    `No tickReceiveLog for tick ${input.receiveTickNumber} after ${input.maxAttempts} paste attempts`,
    input.signal,
  );
  return { ...composed, confirmed: false };
}

export async function deliverPendingOnly(
  convex: RunnerConvexClient,
  tmux: TmuxSink,
  input: Omit<DeliverInput, "tickNumber" | "templates" | "receiveTickNumber">,
): Promise<DeliveryResult | null> {
  if ((input.pendingMessages ?? []).length === 0) return null;
  const composed = await composeWithPendingUids(convex, input);
  const receiveUid = firstEnvelopeUid(composed.text);
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    input.signal?.throwIfAborted();
    if (!(await prePasteReady(tmux))) {
      await convex.recordRunnerEvent("ready_probe_timeout", "pre-paste readiness failed for pending message", input.signal);
      return { ...composed, confirmed: false };
    }
    await tmux.pasteMessage(composed.text);
    await postPasteSubmitted(tmux);
    if (receiveUid && await waitForUidReceive(convex, receiveUid, input.receiveTimeoutMs, input.receivePollMs, input.signal)) {
      await convex.consumePendingMessages(composed.pendingMessageIds, Date.now(), input.signal);
      return { ...composed, confirmed: true };
    }
  }
  await convex.recordRunnerEvent(
    "hook_failure",
    `No tickReceiveLog for pending message after ${input.maxAttempts} paste attempts`,
    input.signal,
  );
  return { ...composed, confirmed: false };
}

async function composeWithPendingUids(
  convex: RunnerConvexClient,
  input: DeliverInput,
): Promise<ComposedMessage> {
  const userMessages: Array<PendingMessage & { uid: string }> = [];
  const adminMessages: Array<PendingMessage & { uid: string }> = [];
  for (const message of input.pendingMessages ?? []) {
    const uid = await generateUniqueThematicUid((candidate) =>
      convex.isThematicUidTaken(candidate, input.signal),
    );
    if (message.source === "user-message") {
      userMessages.push({ ...message, uid });
    } else {
      adminMessages.push({ ...message, uid });
    }
  }
  return composeMessage({
    tickNumber: input.tickNumber,
    templates: input.templates,
    fastForwardPrefix: input.fastForwardPrefix,
    userMessages,
    adminMessages,
  });
}

async function waitForReceive(
  convex: RunnerConvexClient,
  tickNumber: number,
  timeoutMs: number,
  pollMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await convex.hasTickReceive(tickNumber, signal)) return true;
    await sleep(pollMs, signal);
  }
  return false;
}

async function waitForUidReceive(
  convex: RunnerConvexClient,
  uid: string,
  timeoutMs: number,
  pollMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await convex.hasMessageUidReceive(uid, signal)) return true;
    await sleep(pollMs, signal);
  }
  return false;
}

function firstEnvelopeUid(text: string): string | null {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const match = /^(?:whisper|special-msg):\s+(\S+)/.exec(firstLine);
  return match?.[1] ?? null;
}
