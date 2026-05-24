import { describe, expect, it } from "vitest";
import { composeMessage } from "../src/messageComposer.js";

describe("composeMessage", () => {
  it("starts with tick prefix and uses separators only between sections", () => {
    const result = composeMessage({
      tickNumber: 42,
      templates: [{ fileName: "00.md", content: "world update" }],
      userMessages: [{
        _id: "pendingMessages:1",
        targetElderId: "elder-1",
        text: "hello",
        source: "user-message",
        insertedAt: 1,
        uid: "crimson-quartz-warning-a1b2",
      }],
    });

    expect(result.text.startsWith("tick: 42")).toBe(true);
    expect(result.text.startsWith("---")).toBe(false);
    expect(result.text).toContain("\n---\nwhisper: crimson-quartz-warning-a1b2");
    expect(result.pendingMessageIds).toEqual(["pendingMessages:1"]);
    expect(result.messageHash).toHaveLength(64);
  });

  it("can compose a pending-only admin injection with special-msg first", () => {
    const result = composeMessage({
      adminMessages: [{
        _id: "pendingMessages:2",
        targetElderId: "elder-1",
        text: "debug",
        source: "admin-injection",
        insertedAt: 1,
        uid: "storm-fox-murmur-b2c3",
      }],
    });

    expect(result.text).toBe("special-msg: storm-fox-murmur-b2c3\ndebug");
  });
});
