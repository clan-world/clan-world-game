/**
 * Boundary-condition tests for the heartbeat package.
 *
 * Targets: tick math edges, season/context-reset modulo boundaries, settle-window
 * edge cases, retry-backoff index clamping, and equality-edge comparators in
 * the scheduler (e.g. `nextHeartbeatAtTs*1000 <= nowMs()`).
 *
 * These tests do NOT modify source — they probe exact-equality boundaries where
 * off-by-one or strict/non-strict comparator bugs typically live.
 *
 * Agent B (boundary conditions) — parallel test-improvement experiment 2026-05-24.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeHeartbeatDelayMs,
  HEARTBEAT_JITTER_MS,
  HEARTBEAT_RETRY_BACKOFF_MS,
  classifyHeartbeatError,
  startHeartbeatScheduler,
} from '../src/heartbeatScheduler';
import {
  composeSituationBlock,
  isContextResetTick,
  isContextResetWarningTick,
  isRichBriefingTick,
  CONTEXT_RESET_INTERVAL_TICKS,
} from '../src/composeSituationBlock';
import { settleWindow } from '../src/settleWindow';
import { HeartbeatRateLimitedError, type IHeartbeatCaller } from '@clan-world/agents/seams';

class TestHeartbeatTimeoutError extends Error {
  override name = 'HeartbeatTimeoutError';
}

function makeHeartbeatCaller(overrides: Partial<IHeartbeatCaller> = {}): IHeartbeatCaller {
  return {
    async callHeartbeat() { return { txHash: '0xabc' }; },
    async readHeartbeatIntervalSeconds() { return 60; },
    async readNextHeartbeatAtTs() { return 0; },
    ...overrides,
  };
}

describe('computeHeartbeatDelayMs — boundary equality + sign edges', () => {
  it('returns exactly the jitter when nextHeartbeatAtTs*1000 === nowMs (boundary equality)', () => {
    // The Math.max(0, ...) branch is exercised when the difference is exactly 0:
    // nextHeartbeatAtTs = 60, nowMs = 60_000  → delay should be jitter (500ms default).
    expect(computeHeartbeatDelayMs(60, 60_000)).toBe(HEARTBEAT_JITTER_MS);
  });

  it('clamps to 0 (not negative) when nextHeartbeatAtTs is in the deep past', () => {
    // v2.17.x: the safety margin is folded INSIDE the clamp —
    // Math.max(0, ts*1000 + HEARTBEAT_SAFETY_MARGIN_MS - now). When the target
    // is far enough in the past that even the margin can't lift the sum above 0,
    // the result clamps to exactly 0 (fire-now), NOT to the jitter/margin.
    expect(computeHeartbeatDelayMs(0, 1_000_000)).toBe(0);
    expect(computeHeartbeatDelayMs(60, 120_000)).toBe(0);
  });

  it('returns 0 when nextHeartbeatAtTs*1000 === nowMs AND jitter=0 (no-jitter override)', () => {
    // Both clamps active: max(0,0) + 0 === 0. Caller must accept ms=0 paths.
    expect(computeHeartbeatDelayMs(60, 60_000, 0)).toBe(0);
  });

  it('returns 1ms exactly when one millisecond remains (no rounding loss)', () => {
    // nextHeartbeatAtTs=60s, nowMs=59_999 → delta=1ms; result = 1 + jitter.
    expect(computeHeartbeatDelayMs(60, 59_999)).toBe(1 + HEARTBEAT_JITTER_MS);
  });

  it('handles nextHeartbeatAtTs=0 (uninitialized chain) without overflow or sign flip', () => {
    // On-chain 0 means "fire immediately". With now=0 the sum is exactly the
    // safety margin (0*1000 + margin - 0); with now=1 the margin is decremented
    // by the elapsed 1ms (v2.17.x folds the margin inside the Math.max clamp,
    // so it is NOT a flat additive jitter).
    expect(computeHeartbeatDelayMs(0, 0)).toBe(HEARTBEAT_JITTER_MS);
    expect(computeHeartbeatDelayMs(0, 1)).toBe(HEARTBEAT_JITTER_MS - 1);
  });
});

describe('context-reset tick modulo — boundary at 0, 1, 49, 50, 51, 99, 100', () => {
  it('tick=0 is a reset tick (the modulo boundary itself)', () => {
    // 0 % 50 === 0 — explicit boundary. The runner guards with `chainTick > 0`,
    // but the predicate must still return true here to avoid surprise reuse later.
    expect(isContextResetTick(0)).toBe(true);
    expect(isContextResetWarningTick(0)).toBe(false);
    expect(isRichBriefingTick(0)).toBe(false);
  });

  it('tick=1 is the rich-briefing tick (exact T+1 after the genesis boundary)', () => {
    expect(isRichBriefingTick(1)).toBe(true);
    expect(isContextResetTick(1)).toBe(false);
    expect(isContextResetWarningTick(1)).toBe(false);
  });

  it('tick=49 is ONLY the warning tick — not reset, not briefing (off-by-one guard)', () => {
    expect(isContextResetWarningTick(49)).toBe(true);
    expect(isContextResetTick(49)).toBe(false);
    expect(isRichBriefingTick(49)).toBe(false);
  });

  it('tick=50 is ONLY the reset tick — not warning, not briefing', () => {
    expect(isContextResetTick(50)).toBe(true);
    expect(isContextResetWarningTick(50)).toBe(false);
    expect(isRichBriefingTick(50)).toBe(false);
  });

  it('tick=51 is ONLY the briefing tick (T+1 after reset)', () => {
    expect(isRichBriefingTick(51)).toBe(true);
    expect(isContextResetTick(51)).toBe(false);
    expect(isContextResetWarningTick(51)).toBe(false);
  });

  it('second cycle boundaries (99, 100, 101) behave identically to first cycle', () => {
    // Critical for long-running sessions: cycle N must equal cycle 1.
    expect(isContextResetWarningTick(99)).toBe(true);
    expect(isContextResetTick(100)).toBe(true);
    expect(isRichBriefingTick(101)).toBe(true);
    // Cross-class exclusivity at every boundary:
    expect(isContextResetTick(99)).toBe(false);
    expect(isContextResetWarningTick(100)).toBe(false);
    expect(isContextResetTick(101)).toBe(false);
  });

  it('CONTEXT_RESET_INTERVAL_TICKS constant exposes the cycle length (regression guard)', () => {
    // If the constant is ever changed (e.g. to 100), boundary tests above need updating.
    // Pin it so a silent constant flip surfaces here.
    expect(CONTEXT_RESET_INTERVAL_TICKS).toBe(50);
  });

  it('composeSituationBlock at tick=50 emits FINAL TICK content with the literal tick number', () => {
    // Exact-equality boundary: tick 50 must include both the marker AND the final-tick guidance.
    const block = composeSituationBlock({ elder: 1, clanId: '1', tick: 50 });
    // Assert on STABLE structural markers, not full guidance sentences (the
    // FINAL-TICK prose was reworded in source 2026-06-14 and broke a sentence
    // assertion this round — codex R1). 'FINAL TICK' (mode marker) + 'memory_save'
    // (the save API the guidance always references) are the stable anchors.
    expect(block).toContain('TICK 50 Started');
    expect(block).toContain('FINAL TICK');
    expect(block).toContain('memory_save');
    // Must NOT also carry the rich-briefing copy (that's tick 51's job).
    expect(block).not.toContain('Fresh context');
  });

  it('composeSituationBlock at tick=51 emits the next-reset-tick reference at exact +49', () => {
    // tick 51 + (50 - 1) = 100 → next reset boundary referenced literally.
    const block = composeSituationBlock({ elder: 2, clanId: '2', tick: 51 });
    expect(block).toContain('TICK 51 Started');
    expect(block).toContain('Fresh context');
    expect(block).toContain('Next reset at tick 100');
  });
});

describe('HEARTBEAT_RETRY_BACKOFF_MS — index clamping at max', () => {
  it('exposes exactly 4 backoff steps in 1s/2s/5s/10s order (constant shape regression)', () => {
    // The scheduler relies on `HEARTBEAT_RETRY_BACKOFF_MS.length` for clamping;
    // an off-by-one in this array would change the retry budget by one full cycle.
    expect(HEARTBEAT_RETRY_BACKOFF_MS).toEqual([1_000, 2_000, 5_000, 10_000]);
    expect(HEARTBEAT_RETRY_BACKOFF_MS.length).toBe(4);
  });
});

describe('settleWindow — minimum-duration and pre-aborted edges', () => {
  it('still returns "settled" when ms=0 (treats zero as a valid degenerate window)', async () => {
    // ms=0 must not hang nor reject; many tests pass settleWindowSec=0 via config.
    const result = await settleWindow(0);
    expect(result).toBe('settled');
  });

  it('respects pre-aborted signal even when ms=0 (abort takes priority at zero-duration)', async () => {
    // Boundary: if both branches fire "immediately", abort wins by spec (see source line 14).
    const ctl = new AbortController();
    ctl.abort();
    const result = await settleWindow(0, ctl.signal);
    expect(result).toBe('aborted');
  });

  it('returns "settled" for ms=1 (minimum positive timer)', async () => {
    // Smallest non-zero — verifies setTimeout path actually fires, not just the ms=0 branch.
    const result = await settleWindow(1);
    expect(result).toBe('settled');
  });
});

describe('classifyHeartbeatError — name matching boundary cases', () => {
  it('classifies a HeartbeatRateLimitedError instance as rate-limited (instanceof boundary)', () => {
    // Subclass detection — must not require name-string match, only instanceof.
    const err = new HeartbeatRateLimitedError(60);
    expect(classifyHeartbeatError(err)).toBe('rate-limited');
  });

  it('classifies any Error whose name contains "Timeout" as timeout (substring boundary)', () => {
    // The classifier uses `name.includes('Timeout')` — verify the substring rule, not equality.
    const exactTimeout = new TestHeartbeatTimeoutError('a');
    expect(classifyHeartbeatError(exactTimeout)).toBe('timeout');
    const substringMatch = new Error('a');
    substringMatch.name = 'EthersTimeoutError'; // substring match boundary
    expect(classifyHeartbeatError(substringMatch)).toBe('timeout');
  });

  it('classifies revert via name-substring OR message-regex (both branches)', () => {
    const byName = new Error('whatever');
    byName.name = 'ContractRevertError';
    expect(classifyHeartbeatError(byName)).toBe('revert');
    const byMessage = new Error('execution reverted: paused');
    expect(classifyHeartbeatError(byMessage)).toBe('revert');
  });

  it('falls through to "error" for non-Error inputs (string / null / undefined boundary)', () => {
    expect(classifyHeartbeatError('string')).toBe('error');
    expect(classifyHeartbeatError(null)).toBe('error');
    expect(classifyHeartbeatError(undefined)).toBe('error');
    expect(classifyHeartbeatError({ message: 'plain object' })).toBe('error');
  });
});

describe('heartbeat scheduler — hot-loop guard at exact equality boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('engages HOT_LOOP_GUARD when nextAfterSuccess*1000 === nowMs exactly (<= comparator boundary)', async () => {
    // Source line 137: `if (nextAfterSuccess !== undefined && nextAfterSuccess * 1000 <= nowMs())`.
    // The boundary is `<=`, so EQUAL must trigger the guard — verify by checking the warn log.
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const warn = vi.fn();
    // Source flow per iteration:
    //   call #1 — main loop reads nextHeartbeatAtTs to schedule the fire (returns 0 → fire immediately).
    //   call #2 — attemptHeartbeatWithBackoff reads nextAfterSuccess to stamp runnerStatus.
    //   call #3 — main loop reads nextAfterSuccess for the HOT_LOOP_GUARD `<=` check.
    // The boundary we're probing: call #3 returns exactly 2, nowMs=2000 → 2*1000 === 2000 (equal).
    let n = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        n++;
        if (n === 1) return 0; // schedule immediate fire
        if (n === 2) return 2; // post-success runnerStatus value
        if (n === 3) return 2; // hot-loop guard check — EXACT equality boundary
        return 60; // unblock next iteration so the loop isn't stuck after the guard sleep
      },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 2_000,
      log: { info: vi.fn(), warn, error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(501);
    // Behavioral proof the hot-loop guard engaged at the <= equality boundary:
    // exactly one heartbeat fired and the guard logged a warning. (We assert the
    // behavior, not the warning's prose — log copy is not a stable contract.)
    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    abort.abort();
  });

  it('clamps consecutive read-failure backoff at the last array slot (index >= length)', async () => {
    // Source line 110-112: `Math.min(consecutiveReadFailures, length-1)`.
    // After 5+ failures, backoff must STAY at 10_000ms (the max), never reach undefined/index-OOB.
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const readNextHeartbeatAtTs = vi.fn()
      .mockRejectedValueOnce(new Error('read-fail-1'))
      .mockRejectedValueOnce(new Error('read-fail-2'))
      .mockRejectedValueOnce(new Error('read-fail-3'))
      .mockRejectedValueOnce(new Error('read-fail-4'))
      .mockRejectedValueOnce(new Error('read-fail-5')) // index 4 — past array end, clamp boundary
      .mockRejectedValueOnce(new Error('read-fail-6')) // index 5 — still clamped
      .mockResolvedValue(60);
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 60_000,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Walk through the backoff sequence: 1s, 2s, 5s, 10s, then clamped 10s, 10s, ...
    // Total backoff before the 7th call (which succeeds) = 1+2+5+10+10+10 = 38s.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(2); // first fail + first retry after 1s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(3); // second retry after 2s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(4); // third retry after 5s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(5); // fourth retry after 10s (last array slot)
    // Now the index clamp kicks in: failures 5 and 6 must STILL wait 10s, not undefined/0.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(5); // not yet — proves backoff is still 10s, not 0
    await vi.advanceTimersByTimeAsync(1);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(6); // clamped retry fired at exact 10s boundary
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(7); // still clamped — and this one succeeds

    abort.abort();
  });
});
