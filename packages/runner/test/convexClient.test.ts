import { describe, expect, it } from "vitest";
import { RunnerConvexClient } from "../src/convexClient.js";

describe("RunnerConvexClient auth payloads", () => {
  it("adds the elder secret to runner queries and mutations", async () => {
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret-1");
    const payloads: any[] = [];
    (client as any).http = {
      async query(_ref: unknown, payload: any) {
        payloads.push(payload);
        return payload.tickNumber !== undefined || payload.uid !== undefined ? false : {};
      },
      async mutation(_ref: unknown, payload: any) {
        payloads.push(payload);
        if (payload.resetTick !== undefined) return "resetEventLog:1";
        if (payload.tickNumber !== undefined) return "tickSendLog:1";
        return undefined;
      },
    };

    await client.getStartupState();
    await client.getAuxiliary();
    await client.hasTickReceive(9);
    await client.isThematicUidTaken("uid-1");
    await client.hasMessageUidReceive("uid-2");
    await client.recordTickSend(9, "hash");
    await client.consumePendingMessages(["pendingMessages:1"], 123);
    await client.recordResetEvent(50, "scheduled");
    await client.completeResetEvent("resetEventLog:1");
    await client.recordRunnerEvent("hook_failure", "x");

    expect(payloads).toHaveLength(10);
    for (const payload of payloads) {
      expect(payload).toMatchObject({ elderId: "elder-1", secret: "secret-1" });
    }
  });

  it("adds the elder secret to the live auxiliary subscription", async () => {
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret-1");
    let subscriptionPayload: any;
    (client as any).live = {
      onUpdate(_ref: unknown, payload: any, onValue: (value: any) => void) {
        subscriptionPayload = payload;
        onValue({ tickClock: { tick: 1 } });
        return () => {};
      },
      close() {},
    };
    const ac = new AbortController();
    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();

    await iterator.next();
    ac.abort();
    await iterator.return?.();

    expect(subscriptionPayload).toEqual({ elderId: "elder-1", secret: "secret-1" });
  });
});
