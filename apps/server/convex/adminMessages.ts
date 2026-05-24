import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireBusOperatorSecret } from "./authShared";

const elderId = v.union(
  v.literal("elder-1"),
  v.literal("elder-2"),
  v.literal("elder-3"),
  v.literal("elder-4"),
);

const messageSource = v.union(
  v.literal("admin-injection"),
  v.literal("user-message"),
);

export const injectMessage = mutation({
  args: {
    secret: v.string(),
    targetElderId: elderId,
    text: v.string(),
    source: messageSource,
  },
  handler: async (ctx, args) => {
    requireBusOperatorSecret(args.secret);

    const text = args.text.trim();
    if (!text) {
      throw new Error("text is required");
    }
    if (text.length > 2000) {
      throw new Error("text must be 2000 characters or fewer");
    }

    return await ctx.db.insert("pendingMessages", {
      targetElderId: args.targetElderId,
      text,
      source: args.source,
      insertedAt: Date.now(),
    });
  },
});
