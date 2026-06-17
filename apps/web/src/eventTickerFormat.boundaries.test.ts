/**
 * Boundary tests for formatChainEvent — covers numeric edges, missing fields,
 * and out-of-range enum values that the existing eventTickerFormat.test.ts
 * (which focuses on happy-path formatting) does not exercise.
 *
 * Authored by Agent B in the 2026-05-24 parallel test-improvement experiment.
 * Approach: BOUNDARY CONDITIONS — empty/missing args, clanId/tick at 0,
 * Number.MAX_SAFE_INTEGER, BigInt inputs (chain events arrive as BigInts
 * before convex JSON-ifies them), unknown enum/region ids.
 *
 * Agent E is running property-based tests on formatters in parallel — these
 * boundary tests complement that by pinning specific edge BEHAVIOURS (the
 * exact string output) rather than invariants.
 */
import { describe, expect, it } from 'vitest';
import { formatChainEvent, type ChainEventForTicker } from './eventTickerFormat';

const event = (input: ChainEventForTicker): ChainEventForTicker => input;

describe('formatChainEvent — empty / missing fields', () => {
  it('handles a fully-empty args object without crashing (BuildingUpgraded)', () => {
    // Defensive: snapshot from a buggy emit could lack `args.building` and
    // `args.newLevel`. We expect a sensible fallback ('structure', level 0),
    // not undefined or 'NaN' in the rendered ticker text.
    const entry = formatChainEvent(event({
      eventName: 'BuildingUpgraded',
      args: {},
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('Clan 1 upgraded structure → level 0');
    expect(entry?.text).not.toContain('undefined');
    expect(entry?.text).not.toContain('NaN');
  });

  it('handles missing clanId gracefully (renders "Unknown" instead of "Clan 0")', () => {
    // Boundary: chain event with no clan attribution. Renders "Unknown" per
    // line 112 — `clanId > 0 ? \`Clan ${clanId}\` : 'Unknown'`. Pin that exact
    // fallback string so a future change doesn't silently say "Clan 0".
    const entry = formatChainEvent(event({
      eventName: 'WorkerArrived',
      args: { region: 1 },
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toContain('Unknown');
    expect(entry?.text).not.toContain('Clan 0');
  });

  it('returns null for ResourcesGathered with zero deltas', () => {
    // Boundary case: chain emitted the event but all gather deltas are 0
    // (clansman walked to region but actual gather failed / was capped).
    // Documented contract: empty parts → null (no ticker entry).
    const entry = formatChainEvent(event({
      eventName: 'ResourcesGathered',
      args: { woodGained: 0, ironGained: 0, wheatGained: 0, fishGained: 0 },
      clanId: 1,
    }));

    expect(entry).toBeNull();
  });

  it('returns null for ResourcesGathered with all-null/undefined deltas', () => {
    // Per-resource keys may be entirely missing from the args object. The
    // formatter treats this identically to "0" — `args[key] ?? args[r]` ->
    // safeNum -> 0 -> resourceAmount returns ''. Net: null entry.
    const entry = formatChainEvent(event({
      eventName: 'ResourcesGathered',
      args: {},
      clanId: 1,
    }));

    expect(entry).toBeNull();
  });

  it('renders a generic message for ResourcesDeposited with no parts', () => {
    // Different contract from Gathered: Deposited returns a generic
    // "deposited resources" string instead of null. Pin that distinction.
    const entry = formatChainEvent(event({
      eventName: 'ResourcesDeposited',
      args: {},
      clanId: 2,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('Clan 2 deposited resources');
  });

  it('returns null when ImmediateMarketActionExecuted has -1 resourceIn (missing arg)', () => {
    // Sentinel: the formatter sets safeNum default to -1 specifically to
    // detect "this arg is genuinely absent" vs "value is 0". Pin that
    // detection here so a refactor doesn't silently default to 0 instead.
    const entry = formatChainEvent(event({
      eventName: 'ImmediateMarketActionExecuted',
      args: { amountIn: 5, amountOut: 5 },
      clanId: 1,
    }));

    expect(entry).toBeNull();
  });
});

describe('formatChainEvent — numeric extremes', () => {
  it('handles tick = 0 (genesis tick) without dropping the suffix', () => {
    const entry = formatChainEvent(event({
      eventName: 'WorldPaused',
      args: { tick: 0 },
    }));

    expect(entry?.text).toBe('World paused at tick 0');
  });

  it('handles Number.MAX_SAFE_INTEGER tick (defensive vs uint256 conversion overflow)', () => {
    // BigInt → Number conversion at MAX_SAFE_INTEGER is the documented safe
    // upper bound. Above this, precision is lost but the function should
    // still produce a valid string — not "Infinity" or "NaN".
    const huge = Number.MAX_SAFE_INTEGER;
    const entry = formatChainEvent(event({
      eventName: 'WorldUnpaused',
      args: {},
      tick: huge,
    }));

    expect(entry?.text).toContain(String(huge));
    expect(entry?.text).not.toContain('Infinity');
    expect(entry?.text).not.toContain('NaN');
  });

  it('handles BigInt tick value (raw chain emit before JSON serialisation)', () => {
    // safeNum() explicitly handles bigint inputs via `Number(v)`. Pin that.
    const entry = formatChainEvent(event({
      eventName: 'WorldPaused',
      args: { tick: 42n as unknown as number },
    }));

    expect(entry?.text).toBe('World paused at tick 42');
  });

  it("formats huge resource amounts using wei-scale heuristic (≥1e12 → divide by 1e18) (KNOWN BUG: pins current '5.0' output)", () => {
    // resourceAmount() switches to wei-scale division when raw value ≥1e12
    // (a heuristic for "this looks like an 18-decimal token amount"). Boundary:
    // 1e18 wei should render as 1 unit. 5e18 → 5 units.
    //
    // FINDING (Agent B 2026-05-24): The current source has a regex bug:
    //   .replace(/\\.0$/, '')
    // The author intended `/\.0$/` (strip trailing ".0") but typed a double-
    // escaped backslash that matches the literal text `\.0` instead. So 5e18
    // renders as "5.0 wood" rather than the intended "5 wood". Same bug
    // appears on line 106 for the `<1` branch. Pinned here as the OBSERVED
    // behaviour — flip the assertion when the source bug is fixed. See
    // research log entry under PR description.
    const entry = formatChainEvent(event({
      eventName: 'ResourcesGathered',
      args: { woodGained: 5e18, ironGained: 0, wheatGained: 0, fishGained: 0 },
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    // ⚠ KNOWN BUG (wei-scale .0 double-escape in eventTickerFormat): asserts
    // CURRENT buggy output. When the source regex is fixed, flip this to
    // 'Clan 1 gathered 5 wood'. Do NOT just delete.
    expect(entry?.text).toBe('Clan 1 gathered 5.0 wood');
    // The important invariants still hold even with the regex bug — no
    // scientific notation or raw wei leak through:
    expect(entry?.text).not.toContain('e+');
    expect(entry?.text).not.toContain('5000000000000000000');
  });

  it('formats sub-1 unit resource amounts with two decimal places', () => {
    // resourceAmount() returns 2-decimal precision when human < 1 (after
    // the wei-scale conversion). E.g. 0.5e18 wei → 0.5 → "0.5".
    const entry = formatChainEvent(event({
      eventName: 'ResourcesGathered',
      args: { woodGained: 5e17, ironGained: 0, wheatGained: 0, fishGained: 0 },
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toMatch(/0\.5/);
  });

  it('uses string numerics in args via safeNum parse path', () => {
    // The contract sometimes emits stringified BigInts ("12345"). safeNum
    // accepts string via Number() parse — pin that path.
    const entry = formatChainEvent(event({
      eventName: 'WorldPaused',
      args: { tick: '12345' as unknown as number },
    }));

    expect(entry?.text).toBe('World paused at tick 12345');
  });
});

describe('formatChainEvent — unknown / out-of-range enums', () => {
  it('renders "Region N" fallback for unknown region id', () => {
    // Boundary: region id present but not in REGION_NAMES table (e.g. a new
    // region added on-chain but front-end not redeployed yet). Should fall
    // back to a numeric label, NOT crash or render "undefined".
    const entry = formatChainEvent(event({
      eventName: 'WorkerArrived',
      args: { region: 999 },
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('Clan 1 worker arrived at Region 999');
    expect(entry?.text).not.toContain('undefined');
  });

  it('renders ACTION enum name fallback for unknown action', () => {
    // MissionAssigned with an out-of-range action int. The ACTION_LABELS
    // map is built from the generated enum so anything beyond the highest
    // value should hit the `?? 'act'` fallback.
    const entry = formatChainEvent(event({
      eventName: 'MissionAssigned',
      args: { action: 99999, region: 1 },
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toContain('to act');
    expect(entry?.text).not.toContain('undefined');
  });

  it('returns null for completely unknown eventName (forward-compat for new emits)', () => {
    // Boundary: chain emits a new event the front-end doesn't recognise. The
    // formatter MUST return null so the ticker silently skips it instead of
    // rendering "[object Object]" or crashing the render loop.
    const entry = formatChainEvent(event({
      eventName: 'BrandNewFutureEvent2027',
      args: { foo: 'bar' },
    }));

    expect(entry).toBeNull();
  });

  it('rotates clan colors safely beyond the 8-slot palette (clanId=9)', () => {
    // slotColor() uses `(clanId - 1) % CLAN_SLOT_COLORS.length`. Boundary:
    // clan 9 should wrap to slot 0's color (red), not return undefined.
    const entry = formatChainEvent(event({
      eventName: 'WorkerArrived',
      args: { region: 1 },
      clanId: 9,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.clanColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles BanditStateChanged with unknown newState as null (silent drop)', () => {
    // The formatter only handles the Attacking state explicitly; everything
    // else returns null. Pin that — a future "Retreating" state should NOT
    // accidentally print "Bandits attacking" with a different number.
    const entry = formatChainEvent(event({
      eventName: 'BanditStateChanged',
      args: { newState: 99 },
      clanId: 1,
    }));

    expect(entry).toBeNull();
  });
});
