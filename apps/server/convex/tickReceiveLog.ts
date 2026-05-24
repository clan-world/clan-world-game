import { v } from "convex/values";

import { mutation } from "./_generated/server";

const KNOWN_ELDER_IDS = new Set(["elder-1", "elder-2", "elder-3", "elder-4"]);
const MESSAGE_PREVIEW_MAX = 100;

export const recordReceive = mutation({
  args: {
    elderId: v.string(),
    prefix: v.union(v.literal("tick"), v.literal("whisper"), v.literal("special-msg")),
    tickNumber: v.optional(v.number()),
    whisperUid: v.optional(v.string()),
    specialMsgUid: v.optional(v.string()),
    messagePreview: v.string(),
  },
  handler: async (ctx, args) => {
    if (!KNOWN_ELDER_IDS.has(args.elderId)) {
      throw new Error(`unknown elderId: ${args.elderId}`);
    }

    // Exactly one id field must match the prefix; others must be absent.
    // Defends the public mutation against malformed callers (the hook is well-behaved,
    // but the endpoint is unauthenticated — see docs/design/bundle-4-simplified-communications.md).
    if (args.prefix === "tick") {
      if (args.tickNumber === undefined) {
        throw new Error(`prefix=tick requires tickNumber`);
      }
      if (args.whisperUid !== undefined || args.specialMsgUid !== undefined) {
        throw new Error(`prefix=tick must not set whisperUid or specialMsgUid`);
      }
    } else if (args.prefix === "whisper") {
      if (args.whisperUid === undefined) {
        throw new Error(`prefix=whisper requires whisperUid`);
      }
      if (args.tickNumber !== undefined || args.specialMsgUid !== undefined) {
        throw new Error(`prefix=whisper must not set tickNumber or specialMsgUid`);
      }
    } else if (args.prefix === "special-msg") {
      if (args.specialMsgUid === undefined) {
        throw new Error(`prefix=special-msg requires specialMsgUid`);
      }
      if (args.tickNumber !== undefined || args.whisperUid !== undefined) {
        throw new Error(`prefix=special-msg must not set tickNumber or whisperUid`);
      }
    }

    const messagePreview = args.messagePreview.slice(0, MESSAGE_PREVIEW_MAX);

    return await ctx.db.insert("tickReceiveLog", {
      ...args,
      messagePreview,
      receivedAt: Date.now(),
    });
  },
});
