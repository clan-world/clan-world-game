/**
 * Error-path coverage for `isValidSnapshotShape` — the runtime guard the
 * snapshot localStorage cache uses BEFORE hydrating React state.
 *
 * Why these tests matter: if a malformed payload sneaks through the
 * envelope-version check (e.g. partial schema migration where v didn't bump,
 * or a poisoned localStorage entry from an old build), downstream consumers
 * do `clan.id.split(...)` / `for (const c of snapshot.clans)` against a
 * shape they don't expect → crash inside the WorldMap render path → the
 * outer CockpitErrorBoundary trips and the user sees the global "COCKPIT
 * OFFLINE" screen instead of the placeholder.
 *
 * The validator is the choke point that converts schema drift into a silent
 * cache miss. Tests pin BOTH the happy shape AND the malformed paths the
 * UI must never hydrate.
 */
import { describe, expect, it } from 'vitest';
import { isValidSnapshotShape } from './hooks/useCachedSnapshot';

describe('isValidSnapshotShape — malformed payload rejection', () => {
  it('accepts the happy-path shape with multiple clan entries', () => {
    expect(
      isValidSnapshotShape({
        tick: 42,
        clans: [
          { id: '1', name: 'Storm Riders' },
          { id: '2', name: 'Iron Guard' },
        ],
      }),
    ).toBe(true);
  });

  it('accepts an empty clans array (legitimate post-reset state)', () => {
    // Empty-clans is a valid runtime shape — the realm can briefly have zero
    // clans during a full-game-reset. The validator must let it through so
    // the last-known-good guard upstream (not the validator) decides whether
    // to surface it.
    expect(isValidSnapshotShape({ tick: 0, clans: [] })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidSnapshotShape(null)).toBe(false);
  });

  it('rejects non-object scalars', () => {
    expect(isValidSnapshotShape(42)).toBe(false);
    expect(isValidSnapshotShape('snapshot')).toBe(false);
    expect(isValidSnapshotShape(true)).toBe(false);
    expect(isValidSnapshotShape(undefined)).toBe(false);
  });

  it('rejects payload missing tick', () => {
    expect(isValidSnapshotShape({ clans: [] })).toBe(false);
  });

  it('rejects payload where tick is a numeric string ("42") not a number', () => {
    // Catches accidental JSON-stringified-tick migrations — downstream
    // arithmetic (tick - lastTick) would silently produce NaN.
    expect(isValidSnapshotShape({ tick: '42', clans: [] })).toBe(false);
  });

  it('rejects payload missing clans', () => {
    expect(isValidSnapshotShape({ tick: 1 })).toBe(false);
  });

  it('rejects payload where clans is an object map (not array)', () => {
    // Catches a future "keyed clans by id" migration that landed without a
    // PAYLOAD_VERSION bump.
    expect(isValidSnapshotShape({ tick: 1, clans: { '1': { id: '1', name: 'x' } } })).toBe(false);
  });

  it('rejects payload where clan id is a number not a string', () => {
    expect(
      isValidSnapshotShape({
        tick: 1,
        clans: [{ id: 1, name: 'Storm Riders' }],
      }),
    ).toBe(false);
  });

  it('rejects payload where clan name is missing', () => {
    expect(
      isValidSnapshotShape({
        tick: 1,
        clans: [{ id: '1' }],
      }),
    ).toBe(false);
  });

  it('rejects when first clan is valid but second is malformed — regression for "only-check-first" validators', () => {
    // This is the "every clan" check that the validator's docstring explicitly
    // promises. A naive earlier validator might only have inspected clans[0];
    // pinning this prevents silently re-introducing that bug.
    expect(
      isValidSnapshotShape({
        tick: 1,
        clans: [
          { id: '1', name: 'Storm Riders' },
          { id: '2', name: 99 }, // bad
          { id: '3', name: 'Crimson' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects when a clan entry is itself null', () => {
    // Convex never emits a null entry, but a poisoned cache might. The loop
    // does `typeof c === "object"` — `typeof null === "object"` in JS is the
    // classic footgun, so we pin that null is rejected (the validator handles
    // it with an explicit `c === null` check).
    expect(
      isValidSnapshotShape({
        tick: 1,
        clans: [{ id: '1', name: 'Storm Riders' }, null],
      }),
    ).toBe(false);
  });
});
