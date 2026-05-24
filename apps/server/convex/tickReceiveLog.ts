import { v } from "convex/values";

import { requireBusOperatorSecret } from "./authShared";
import { mutation } from "./_generated/server";

const KNOWN_ELDER_IDS = new Set(["elder-1", "elder-2", "elder-3", "elder-4"]);
const MESSAGE_PREVIEW_MAX = 100;
const UID_MAX = 200;

export const recordReceive = mutation({
  args: {
    // Bus operator secret: super-swarm R1 HIGH (3/5 cross-tier). Public mutation
    // let any caller with the Convex URL forge tick receipts, advancing the
    // runner past undelivered ticks. The Python hook reads BUS_OPERATOR_SECRET
    // from its container env (mounted via Docker secret) and passes it here.
    // Matches the auth pattern PR6's adminMessages established.
    secret: v.string(),
    elderId: v.string(),
    prefix: v.union(v.literal("tick"), v.literal("whisper"), v.literal("special-msg")),
    tickNumber: v.optional(v.number()),
    whisperUid: v.optional(v.string()),
    specialMsgUid: v.optional(v.string()),
    messagePreview: v.string(),
  },
  handler: async (ctx, args) => {
    requireBusOperatorSecret(args.secret);

    if (!KNOWN_ELDER_IDS.has(args.elderId)) {
      throw new Error(`unknown elderId: ${args.elderId}`);
    }

    // Exactly one id field must match the prefix; others must be absent.
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
    const whisperUid = args.whisperUid?.slice(0, UID_MAX);
    const specialMsgUid = args.specialMsgUid?.slice(0, UID_MAX);

    // Strip secret before inserting — never persist auth material.
    const { secret: _secret, ...rest } = args;
    void _secret;

    return await ctx.db.insert("tickReceiveLog", {
      ...rest,
      whisperUid,
      specialMsgUid,
      messagePreview,
      receivedAt: Date.now(),
    });
  },
});
