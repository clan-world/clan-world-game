import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireBusElderSecret,
  requireBusOperatorSecret,
  requireIndexerSecret,
} from "./authShared";

// authShared.ts has THREE auth helpers gating every public mutation/query
// surface, but none of them have direct unit tests in the baseline. The
// existing comms/runner/tickReceiveLog tests cover the happy path through
// individual mutations, but the negative branches (env unset, regex bypass,
// wrong-elder secret on every elder slot) are not exercised end-to-end.
//
// This file targets the helpers themselves so a regression in the helper
// (e.g. fail-OPEN when env unset, accepting elder-0 / elder-5 / elder-X)
// would be caught even if no caller's tests change.

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireIndexerSecret", () => {
  it("rejects when INDEXER_SECRET is unset (fail-closed)", () => {
    vi.stubEnv("INDEXER_SECRET", "");
    // empty-string env is treated as "unset" by the helper (falsy check)
    expect(() => requireIndexerSecret("anything"))
      .toThrow("INDEXER_SECRET is not configured on this Convex deployment");
  });

  it("rejects when supplied secret mismatches", () => {
    vi.stubEnv("INDEXER_SECRET", "expected");
    expect(() => requireIndexerSecret("wrong"))
      .toThrow("invalid indexer secret");
  });

  it("rejects when supplied secret is empty string against a configured secret", () => {
    vi.stubEnv("INDEXER_SECRET", "expected");
    expect(() => requireIndexerSecret(""))
      .toThrow("invalid indexer secret");
  });

  it("accepts when supplied secret matches", () => {
    vi.stubEnv("INDEXER_SECRET", "expected");
    expect(() => requireIndexerSecret("expected")).not.toThrow();
  });
});

describe("requireBusOperatorSecret", () => {
  // adminMessages.injectMessage is the sole caller. If BUS_OPERATOR_SECRET is
  // accidentally unset on a deployment, the operator surface MUST refuse
  // every write — otherwise anyone with the Convex URL can post into any
  // elder's pendingMessages queue.
  it("rejects when BUS_OPERATOR_SECRET is unset (fail-closed)", () => {
    vi.stubEnv("BUS_OPERATOR_SECRET", "");
    expect(() => requireBusOperatorSecret("anything"))
      .toThrow("BUS_OPERATOR_SECRET is not configured on this Convex deployment");
  });

  it("rejects when supplied secret mismatches", () => {
    vi.stubEnv("BUS_OPERATOR_SECRET", "operator-pass");
    expect(() => requireBusOperatorSecret("wrong"))
      .toThrow("invalid bus operator secret");
  });

  it("accepts when supplied secret matches", () => {
    vi.stubEnv("BUS_OPERATOR_SECRET", "operator-pass");
    expect(() => requireBusOperatorSecret("operator-pass")).not.toThrow();
  });
});

describe("requireBusElderSecret", () => {
  it("rejects unknown elderId formats (no elder-N prefix)", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "x");
    // Both bare strings and other dash-suffixed names must be rejected by
    // the regex BEFORE the env var lookup runs.
    expect(() => requireBusElderSecret("bandit-1", "x"))
      .toThrow("unknown elderId: bandit-1");
    expect(() => requireBusElderSecret("elder", "x"))
      .toThrow("unknown elderId: elder");
    expect(() => requireBusElderSecret("", "x"))
      .toThrow("unknown elderId: ");
  });

  it("rejects elder-0 and elder-5 (out of [1-4] range)", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "x");
    // The regex is [1-4]; 0 and 5+ slip past prefix-only checks but MUST
    // be caught here. If a future contributor relaxes the regex to \d+
    // without adding env vars, this test catches it.
    expect(() => requireBusElderSecret("elder-0", "x"))
      .toThrow("unknown elderId: elder-0");
    expect(() => requireBusElderSecret("elder-5", "x"))
      .toThrow("unknown elderId: elder-5");
    expect(() => requireBusElderSecret("elder-9", "x"))
      .toThrow("unknown elderId: elder-9");
  });

  it("rejects multi-digit elder ids that share a digit prefix", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "x");
    // Anchored regex /^elder-([1-4])$/ — multi-digit "elder-12" must NOT
    // partial-match to elder-1's secret. If $ anchor were dropped, an
    // attacker could brute against secret-1 by guessing "elder-12345".
    expect(() => requireBusElderSecret("elder-12", "x"))
      .toThrow("unknown elderId: elder-12");
    expect(() => requireBusElderSecret("elder-1a", "x"))
      .toThrow("unknown elderId: elder-1a");
  });

  it("rejects elder-N when BUS_ELDER_SECRET_N env is unset", () => {
    // No env stubs for ANY elder — fail-closed for each slot.
    for (const elderN of [1, 2, 3, 4]) {
      expect(() => requireBusElderSecret(`elder-${elderN}`, "x"))
        .toThrow(`BUS_ELDER_SECRET_${elderN} is not configured on this Convex deployment`);
    }
  });

  it("rejects cross-elder secret reuse for every elder slot", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
    vi.stubEnv("BUS_ELDER_SECRET_2", "secret-2");
    vi.stubEnv("BUS_ELDER_SECRET_3", "secret-3");
    vi.stubEnv("BUS_ELDER_SECRET_4", "secret-4");

    // Each elder's secret must NOT validate against another elder's id.
    // Existing runner.test.ts only checks elder-1 with secret-2 wrong.
    // Sweep all 4 slots to catch a future "secret-1 also accepted on
    // elder-3" cross-contamination regression.
    const pairs: Array<[string, string]> = [
      ["elder-1", "secret-2"],
      ["elder-1", "secret-3"],
      ["elder-1", "secret-4"],
      ["elder-2", "secret-1"],
      ["elder-2", "secret-3"],
      ["elder-3", "secret-1"],
      ["elder-3", "secret-4"],
      ["elder-4", "secret-1"],
      ["elder-4", "secret-2"],
    ];
    for (const [elderId, suppliedSecret] of pairs) {
      expect(() => requireBusElderSecret(elderId, suppliedSecret))
        .toThrow("invalid bus elder secret");
    }
  });

  it("accepts each elder with its own correct secret", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
    vi.stubEnv("BUS_ELDER_SECRET_2", "secret-2");
    vi.stubEnv("BUS_ELDER_SECRET_3", "secret-3");
    vi.stubEnv("BUS_ELDER_SECRET_4", "secret-4");
    expect(() => requireBusElderSecret("elder-1", "secret-1")).not.toThrow();
    expect(() => requireBusElderSecret("elder-2", "secret-2")).not.toThrow();
    expect(() => requireBusElderSecret("elder-3", "secret-3")).not.toThrow();
    expect(() => requireBusElderSecret("elder-4", "secret-4")).not.toThrow();
  });

  it("rejects empty supplied secret against a configured slot", () => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
    expect(() => requireBusElderSecret("elder-1", ""))
      .toThrow("invalid bus elder secret");
  });
});
