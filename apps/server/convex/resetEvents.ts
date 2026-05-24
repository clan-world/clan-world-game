import { query } from "./_generated/server";
import { v } from "convex/values";

export const getResetDuringDisconnect = query({
  args: {
    elderId: v.string(),
    sinceTs: v.number(),
    disconnectedAt: v.number(),
  },
  handler: async (ctx, { elderId, sinceTs, disconnectedAt }) => {
    const recent = await ctx.db
      .query("resetEventLog")
      .withIndex("by_elder_started", (q) =>
        q.eq("elderId", elderId).gte("startedAt", sinceTs),
      )
      .order("desc")
      .take(5);

    return (
      recent.find((event) =>
        event.completedAt === undefined || event.completedAt >= disconnectedAt
      ) ?? null
    );
  },
});
