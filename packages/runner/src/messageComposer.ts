import { createHash } from "node:crypto";
import type { PendingMessage } from "./types.js";
import type { SelectedTemplate } from "./templateLoader.js";

export interface ComposeInput {
  tickNumber?: number;
  templates?: SelectedTemplate[];
  fastForwardPrefix?: string;
  userMessages?: Array<PendingMessage & { uid: string }>;
  adminMessages?: Array<PendingMessage & { uid: string }>;
}

export interface ComposedMessage {
  text: string;
  messageHash: string;
  pendingMessageIds: string[];
}

export function composeMessage(input: ComposeInput): ComposedMessage {
  const sections: string[] = [];
  if (input.tickNumber !== undefined) {
    const bodyParts = [
      input.fastForwardPrefix,
      ...(input.templates ?? []).map((template) => template.content.trim()),
    ].filter((part): part is string => Boolean(part && part.trim().length > 0));
    sections.push([`tick: ${input.tickNumber}`, ...bodyParts].join("\n"));
  }

  for (const message of input.userMessages ?? []) {
    sections.push([`whisper: ${message.uid}`, message.text].join("\n"));
  }
  for (const message of input.adminMessages ?? []) {
    sections.push([`special-msg: ${message.uid}`, message.text].join("\n"));
  }

  if (sections.length === 0) {
    throw new Error("cannot compose empty runner message");
  }

  const text = sections.join("\n---\n");
  return {
    text,
    messageHash: sha256(text),
    pendingMessageIds: [
      ...(input.userMessages ?? []).map((message) => message._id),
      ...(input.adminMessages ?? []).map((message) => message._id),
    ],
  };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
