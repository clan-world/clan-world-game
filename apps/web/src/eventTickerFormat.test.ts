import { describe, expect, it } from 'vitest';
import { formatChainEvent, type ChainEventForTicker } from './eventTickerFormat';

const event = (input: ChainEventForTicker): ChainEventForTicker => input;

describe('formatChainEvent', () => {
  it('formats WorldPaused as a global event without a clan label', () => {
    const entry = formatChainEvent(event({
      eventName: 'WorldPaused',
      args: { tick: 12 },
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('World paused at tick 12');
    expect(entry?.text).not.toContain('Clan');
  });

  it('formats WorldUnpaused with the tick from the top-level field', () => {
    const entry = formatChainEvent(event({
      eventName: 'WorldUnpaused',
      args: {},
      tick: 13,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('World unpaused at tick 13');
    expect(entry?.text).not.toContain('Clan');
  });

  it('formats ClansmanRevived with clan name and clansman id', () => {
    const entry = formatChainEvent(event({
      eventName: 'ClansmanRevived',
      args: {},
      clanId: 2,
      clansmanId: 7,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('Clan Iron Guard revived clansman #7');
  });

  it('formats WallDamagedByBandit reading newLevel (not wallLevel) — closes #173', () => {
    // The contract emits this event with `newLevel`; an earlier ticker version
    // mistakenly read `args.wallLevel` and always showed "level 0". This test
    // pins the formatter to the correct ABI field name so a future rename or
    // regression is caught here instead of in user-facing UI.
    const entry = formatChainEvent(event({
      eventName: 'WallDamagedByBandit',
      args: { newLevel: 3 },
      clanId: 1,
    }));

    expect(entry).not.toBeNull();
    expect(entry?.text).toBe('Clan 1 wall damaged → level 3');
  });

  it('ignores legacy args.wallLevel for WallDamagedByBandit', () => {
    // Negative case: if someone copies the old (buggy) emit shape, we want
    // the entry to render `level 0` (safeNum fallback), not the stale value.
    const entry = formatChainEvent(event({
      eventName: 'WallDamagedByBandit',
      args: { wallLevel: 99 },
      clanId: 1,
    }));

    expect(entry?.text).toBe('Clan 1 wall damaged → level 0');
  });

  it('returns null for unknown eventName', () => {
    const entry = formatChainEvent(event({
      eventName: 'SomeUnknownFutureEvent',
      args: {},
    }));

    expect(entry).toBeNull();
  });
});
