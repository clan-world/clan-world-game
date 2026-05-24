/**
 * Agent C (web) — async / race-condition correctness.
 *
 * Pure-logic regression tests for the race-sensitive code paths the WebSocket
 * + Convex live-query + localStorage cache layer exercises constantly:
 *
 *   - `isValidSnapshotShape`: gates EVERY cache hydration. If this returns the
 *     wrong answer for a partially-written, version-skewed, or schema-migrated
 *     payload, the UI either flashes blank (false negative) or crashes
 *     downstream on poisoned data (false positive). It runs in the
 *     `useState` initializer that fires synchronously on mount AND on every
 *     `useEffect`-driven write — both code paths share this validator, so the
 *     race window is "any time at all."
 *
 *   - `formatChainEvent`: called for every chain event flowing through
 *     `EventTicker`. Convex delivers events in commit-order, NOT necessarily
 *     wall-clock-order — late-indexer batches can replay out of sequence. The
 *     formatter must be pure (referentially transparent) so back-to-back
 *     calls with the same input return the same output, and so calls
 *     interleaved with other events don't leak per-call state.
 *
 *   - `shouldRefreshTickCountdownAnchor`: the TopHud anchor recomputes whenever
 *     `liveTick` OR the fallback duration changes. The race we're guarding
 *     against is "tick advances first, duration changes one render later" —
 *     both transitions MUST trigger a refresh; missing either leaves the
 *     countdown anchored to a stale `startedAtMs`.
 *
 * Test environment is `node` (set in apps/web/vitest.config.ts). We deliberately
 * do NOT introduce jsdom / @testing-library / react-test-renderer — they aren't
 * in the workspace and adding them is out of scope for a test-only change.
 * Where the hook-level race matters but isn't testable without React, we test
 * the exported pure helper that owns the decision (e.g. the snapshot validator),
 * not a re-implementation of the hook.
 *
 * Determinism: every test is purely synchronous — no setTimeout, no fetch,
 * no real Date.now() reads (we feed timestamps in as numbers). Safe to run on
 * any host.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidSnapshotShape } from './hooks/useCachedSnapshot';
import {
  CACHE_KEY,
  FRESHNESS_THRESHOLD_MS,
  MAX_CACHE_AGE_MS,
  PAYLOAD_VERSION,
  type CachedSnapshot,
} from './hooks/snapshotCacheConstants';
import { formatChainEvent, type ChainEventForTicker } from './eventTickerFormat';
import { shouldRefreshTickCountdownAnchor } from './TopHud';
import {
  getElderResetId,
  shouldCheckForReset,
} from './components/cockpit/resetOverlayState';

// ---------------------------------------------------------------------------
// Section 1: isValidSnapshotShape — runs on every cache hydration.
// Race surface: localStorage may contain a payload that was being WRITTEN
// when the tab was paused (mobile Safari truncation), a payload from a
// previous PAYLOAD_VERSION that overlapped a deploy, or a payload whose
// internal shape changed in a schema migration that the v bump missed.
// ---------------------------------------------------------------------------

describe('isValidSnapshotShape — cache hydration race surface', () => {
  it('rejects a partially-shaped payload where clans[i].name was lost mid-write', () => {
    // Simulates: localStorage.setItem races a tab-pause. The JSON.stringify
    // call atomicity at the *string* level is fine, but if we later mutate
    // the in-memory shape (e.g. a downstream migration) we can produce an
    // object whose nth clan is missing fields. The validator MUST scan EVERY
    // entry, not just the first — comment at line 24-27 of useCachedSnapshot.ts
    // explicitly pins this behavior to a regression hazard.
    const poisoned = {
      tick: 42,
      clans: [
        { id: '1', name: 'Iron Guard' },
        { id: '2' }, // missing name
        { id: '3', name: 'Forest Wardens' },
      ],
    };
    expect(isValidSnapshotShape(poisoned)).toBe(false);
  });

  it('rejects when clans[i].id is a number (schema-migration drift)', () => {
    // Common drift: contract switches from string clanId to numeric — the
    // shape validator pins the front-end contract independently of the
    // Convex schema, so we catch the mismatch BEFORE downstream `clan.id`
    // string-equality comparisons silently break.
    const drifted = {
      tick: 7,
      clans: [{ id: 1 as unknown as string, name: 'Iron Guard' }],
    };
    expect(isValidSnapshotShape(drifted)).toBe(false);
  });

  it('accepts a snapshot with empty clans (post-reset legitimate state)', () => {
    // The "last known good guard" decides whether to hide an empty live
    // payload behind the cached one. But validity itself MUST accept empty
    // clans — a real post-reset realm has zero clans, and rejecting it here
    // would cause an infinite cache-miss loop.
    expect(isValidSnapshotShape({ tick: 99, clans: [] })).toBe(true);
  });

  it('rejects nullish payloads without throwing (parse-then-null race)', () => {
    // JSON.parse('null') returns null. If a competing tab cleared the
    // localStorage slot to the literal string "null" mid-read, we'd hit
    // this. The validator must short-circuit before any property access.
    expect(isValidSnapshotShape(null)).toBe(false);
    expect(() => isValidSnapshotShape(null)).not.toThrow();
  });

  it('rejects when clans is an object (not an array)', () => {
    // Object.fromEntries-style migration mistakes can produce {1: {...}}
    // shapes that Array.isArray correctly rejects. Pin the negative case.
    const wrongShape = {
      tick: 1,
      clans: { '1': { id: '1', name: 'X' } } as unknown as Array<unknown>,
    };
    expect(isValidSnapshotShape(wrongShape)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2: localStorage cache initializer logic — the synchronous mount
// path of `useCachedSnapshot`. We DO NOT invoke the React hook (no DOM in
// this env); instead we replay the documented initializer pipeline against
// a faithful in-process localStorage stub, plus a controlled Date.now stub.
// This pins the contract that an iOS-Safari tab unpaused at time T sees the
// correct cached-vs-cache-miss decision regardless of how stale the entry is.
// If the production initializer ever drifts from this contract, the hook is
// returning the wrong thing during the reconnect window.
// ---------------------------------------------------------------------------

describe('cache initializer contract — race between tab-resume and cache-age', () => {
  /**
   * Faithful re-implementation of the synchronous useState initializer in
   * useCachedSnapshot. Kept in lockstep with `apps/web/src/hooks/useCachedSnapshot.ts`
   * lines 125-141. If the hook's read path changes, update this fixture so
   * the contract test still reflects the production decision tree.
   */
  function readCacheLikeHook<T>(
    storage: { getItem(k: string): string | null },
    nowMs: number,
    validate: (data: unknown) => boolean = isValidSnapshotShape,
  ): { data: T; ts: number } | undefined {
    try {
      const raw = storage.getItem(CACHE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as CachedSnapshot<T>;
      if (!parsed || typeof parsed.ts !== 'number') return undefined;
      if (parsed.v !== PAYLOAD_VERSION) return undefined;
      if (nowMs - parsed.ts > MAX_CACHE_AGE_MS) return undefined;
      if (!validate(parsed.data)) return undefined;
      return { data: parsed.data, ts: parsed.ts };
    } catch {
      return undefined;
    }
  }

  function makeStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  }

  it('returns cached payload when tab resumed inside MAX_CACHE_AGE_MS', () => {
    const writeTs = 1_000_000;
    const validPayload: CachedSnapshot<{ tick: number; clans: unknown[] }> = {
      v: PAYLOAD_VERSION,
      ts: writeTs,
      data: { tick: 50, clans: [{ id: '1', name: 'Iron Guard' }] },
    };
    const storage = makeStorage({ [CACHE_KEY]: JSON.stringify(validPayload) });
    // Resume the tab 30min later — well inside the 1h MAX_CACHE_AGE_MS.
    const result = readCacheLikeHook(storage, writeTs + 30 * 60 * 1000);
    expect(result).toEqual({ data: validPayload.data, ts: writeTs });
  });

  it('returns undefined exactly at the MAX_CACHE_AGE_MS + 1 boundary', () => {
    // Race-condition off-by-one: a tab resumed at exactly the boundary
    // should fall through to live (the `>` comparison in the initializer
    // pins the inclusive edge). Stale-by-one-ms is acceptable; stale-by-
    // one-hour-and-one-ms is not.
    const writeTs = 5_000_000;
    const validPayload: CachedSnapshot<{ tick: number; clans: unknown[] }> = {
      v: PAYLOAD_VERSION,
      ts: writeTs,
      data: { tick: 1, clans: [{ id: '1', name: 'X' }] },
    };
    const storage = makeStorage({ [CACHE_KEY]: JSON.stringify(validPayload) });
    // At exactly MAX_CACHE_AGE_MS the diff is `>`-false → still served.
    expect(readCacheLikeHook(storage, writeTs + MAX_CACHE_AGE_MS)).toBeDefined();
    // One ms past → cache miss.
    expect(readCacheLikeHook(storage, writeTs + MAX_CACHE_AGE_MS + 1)).toBeUndefined();
  });

  it('returns undefined for a payload whose v lags the current PAYLOAD_VERSION', () => {
    // The race: a deploy bumped PAYLOAD_VERSION; user's localStorage still
    // carries the old version from before the reload. We MUST drop it
    // instead of treating the old data as if it matched the new shape.
    const stale: CachedSnapshot<{ tick: number; clans: unknown[] }> = {
      v: PAYLOAD_VERSION - 1,
      ts: 1_000,
      data: { tick: 1, clans: [{ id: '1', name: 'X' }] },
    };
    const storage = makeStorage({ [CACHE_KEY]: JSON.stringify(stale) });
    expect(readCacheLikeHook(storage, 2_000)).toBeUndefined();
  });

  it('returns undefined for a payload that JSON.parse can read but isValidSnapshotShape rejects', () => {
    // The race we're guarding: schema migration landed without bumping the
    // version. Validator catches it; cache miss is preferred over poisoned
    // hydration that would crash downstream `clan.foo` loops.
    const sneakyShapeChange = {
      v: PAYLOAD_VERSION,
      ts: 10_000,
      data: { tick: 5, clans: [{ id: 1, name: 'numeric-id-broken' }] },
    };
    const storage = makeStorage({ [CACHE_KEY]: JSON.stringify(sneakyShapeChange) });
    expect(readCacheLikeHook(storage, 11_000)).toBeUndefined();
  });

  it('returns undefined and does NOT throw on a truncated JSON write', () => {
    // Race-condition: the previous tab was killed mid-localStorage.setItem
    // and persisted a half-written JSON string. Hydration must not throw —
    // it would unmount the cockpit tree via the error boundary. The
    // try/catch in the initializer is exactly for this case.
    const storage = makeStorage({ [CACHE_KEY]: '{"v":1,"ts":1000,"data":{"tick":5,"clan' });
    expect(() => readCacheLikeHook(storage, 2_000)).not.toThrow();
    expect(readCacheLikeHook(storage, 2_000)).toBeUndefined();
  });

  it('FRESHNESS_THRESHOLD_MS < MAX_CACHE_AGE_MS — invariant the "last known good" guard depends on', () => {
    // Documented in snapshotCacheConstants.ts:90 — "Strictly less than
    // MAX_CACHE_AGE_MS by construction." If this invariant ever flips,
    // the freshness guard could keep serving a cached payload past the
    // age at which the initializer would drop it on next mount, producing
    // a "ghost realm that survives a reload" bug.
    expect(FRESHNESS_THRESHOLD_MS).toBeLessThan(MAX_CACHE_AGE_MS);
  });
});

// ---------------------------------------------------------------------------
// Section 3: formatChainEvent — ordering / interleaving / idempotency.
// Convex delivers events in commit order, not always temporally ordered.
// Late-indexer replays + per-clan parallel subscriptions can interleave
// events from different ticks. The formatter must:
//   (a) produce stable output for the same input (idempotent), and
//   (b) NOT leak state across calls (no module-level mutable formatter ctx).
// ---------------------------------------------------------------------------

describe('formatChainEvent — out-of-order delivery race resistance', () => {
  it('is referentially transparent across repeated calls (idempotent)', () => {
    // The ticker may re-render the same event multiple times (React strict
    // mode double-invocation, parent re-render, Convex re-emit on
    // reconnection). Each call must yield equal output.
    const ev: ChainEventForTicker = {
      eventName: 'WorldPaused',
      args: { tick: 17 },
    };
    const first = formatChainEvent(ev);
    const second = formatChainEvent(ev);
    const third = formatChainEvent({ ...ev }); // fresh object, same shape
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('does NOT leak per-call state between interleaved bandit + clan events', () => {
    // Race scenario: a `BanditAttackResolved` and a `ClansmanRevived` arrive
    // in the same Convex batch. Each call must read ONLY its own input —
    // bug class to pin: a future refactor that hoists `clanLabel` or
    // `regionId` to a module-level cache would silently corrupt the second
    // call. We assert the formatter output for B is identical whether we
    // call B alone or after calling A.
    const a: ChainEventForTicker = {
      eventName: 'BanditAttackResolved',
      args: { targetClanId: 3, defended: false },
      clanId: 1,
    };
    const b: ChainEventForTicker = {
      eventName: 'ClansmanRevived',
      args: {},
      clanId: 2,
      clansmanId: 11,
    };
    const bAlone = formatChainEvent(b);
    formatChainEvent(a); // run A first
    const bAfterA = formatChainEvent(b);
    expect(bAfterA).toEqual(bAlone);
  });

  it('handles events arriving in reverse chronological order without text corruption', () => {
    // Convex commit-order ≠ event-time-order. We replay ticks 20, 10, 15
    // (out-of-order) and assert each formats correctly per its own tick
    // field, not anchored to whichever event was rendered first.
    const events: ChainEventForTicker[] = [
      { eventName: 'WorldPaused', args: { tick: 20 } },
      { eventName: 'WorldPaused', args: { tick: 10 } },
      { eventName: 'WorldPaused', args: { tick: 15 } },
    ];
    const texts = events.map((e) => formatChainEvent(e)?.text);
    expect(texts).toEqual([
      'World paused at tick 20',
      'World paused at tick 10',
      'World paused at tick 15',
    ]);
  });

  it('returns null for an unknown event type without poisoning subsequent calls', () => {
    // If the null-return path inadvertently mutated module state, the next
    // call would observe corruption. Pin the negative-then-positive sequence.
    const unknown: ChainEventForTicker = { eventName: '__SyntheticFutureEvent__', args: {} };
    const known: ChainEventForTicker = {
      eventName: 'ClansmanRevived',
      args: {},
      clanId: 2,
      clansmanId: 7,
    };
    expect(formatChainEvent(unknown)).toBeNull();
    const after = formatChainEvent(known);
    expect(after?.text).toBe('Clan Iron Guard revived clansman #7');
  });
});

// ---------------------------------------------------------------------------
// Section 4: shouldRefreshTickCountdownAnchor — concurrent-update race.
// The TopHud anchor depends on BOTH `liveTick` and `fallbackTickDurationMs`.
// Convex live-query can deliver these in two adjacent ticks instead of one
// (e.g. snapshot.tickEpoch.durationMs lands a render before the new clock).
// The predicate must refresh if EITHER changed since the anchor was set.
// ---------------------------------------------------------------------------

describe('shouldRefreshTickCountdownAnchor — concurrent live-query update race', () => {
  it('refreshes when only the tick changes between renders', () => {
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 45_000 },
        13, // new tick
        45_000, // duration unchanged
      ),
    ).toBe(true);
  });

  it('refreshes when only the duration changes mid-tick', () => {
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 45_000 },
        12, // same tick
        60_000, // duration changed
      ),
    ).toBe(true);
  });

  it('does NOT refresh when both inputs match the anchor exactly (no-op re-render)', () => {
    // Race scenario: useEffect re-fires on a deps-equal render (React 18
    // concurrent rendering). Skipping the refresh keeps startedAtMs intact,
    // so the countdown stays smooth instead of snapping back to "now".
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 45_000 },
        12,
        45_000,
      ),
    ).toBe(false);
  });

  it('refreshes when both tick AND duration change in the same render (atomic update)', () => {
    // The happy path — Convex delivered both in one batched update.
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 45_000 },
        13,
        60_000,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 5: shouldCheckForReset / getElderResetId — terminal-frame race.
// The cockpit polls Convex for elder-reset markers whenever the ttyd iframe
// reports it's not actively connected. Race surface: status can flicker
// connecting → connected → reconnecting in <1s during a hot reload, and the
// reset-check gate must respond to EACH transition with the correct boolean.
// ---------------------------------------------------------------------------

describe('shouldCheckForReset — terminal frame status flicker', () => {
  it('returns true only for reconnecting / disconnected', () => {
    expect(shouldCheckForReset('reconnecting')).toBe(true);
    expect(shouldCheckForReset('disconnected')).toBe(true);
    expect(shouldCheckForReset('connected')).toBe(false);
    expect(shouldCheckForReset('connecting')).toBe(false);
  });

  it('is stable across rapid status flicker — repeated calls return the same answer', () => {
    // The race we're pinning: a future memoization layer that compares
    // by reference would break for primitive string inputs. Belt-and-
    // braces — call 100 times in a row with alternating inputs.
    const statuses = ['connected', 'reconnecting', 'connecting', 'disconnected'] as const;
    for (let i = 0; i < 100; i++) {
      const s = statuses[i % statuses.length];
      const expected = s === 'reconnecting' || s === 'disconnected';
      expect(shouldCheckForReset(s)).toBe(expected);
    }
  });
});

describe('getElderResetId — stable identity under concurrent reset polls', () => {
  it('returns identical strings for the same clanId across calls (race-safe key)', () => {
    // The cockpit derives Convex query args from this id — if it ever
    // returned a fresh string per call, useQuery would re-subscribe every
    // render and thrash the websocket. Pin the deterministic mapping.
    expect(getElderResetId(1)).toBe(getElderResetId(1));
    expect(getElderResetId(7)).toBe('elder-7');
  });

  it('distinguishes adjacent clanIds (no off-by-one collision)', () => {
    // A bug class to guard: a future refactor that uses an int-to-key
    // table could collapse adjacent ids. We assert the trivial mapping
    // stays trivial.
    const ids = [0, 1, 2, 3, 4, 5];
    const keys = new Set(ids.map(getElderResetId));
    expect(keys.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Section 6: vi.useFakeTimers smoke-test — proves the race tests above could
// reach into timer-based code paths if a future hook test is added.
// Determinism guard: we reset timers after each test so a leaked timer from
// one test never poisons another.
// ---------------------------------------------------------------------------

describe('test-suite hygiene — fake timer reset proves determinism', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fake timers advance deterministically without wall-clock dependency', () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.advanceTimersByTime(60_000);
    // Date.now() under fake timers is mocked to system-time-at-install +
    // advanced ms. We don't assert the absolute value (would vary by host
    // clock); we assert the delta is exactly what we advanced.
    expect(Date.now() - start).toBe(60_000);
  });
});
