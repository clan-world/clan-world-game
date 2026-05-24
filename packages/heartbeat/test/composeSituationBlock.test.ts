import { describe, it, expect } from 'vitest';
import { composeSituationBlock } from '../src/composeSituationBlock';

describe('composeSituationBlock', () => {
  it('returns only the short tick marker for ordinary ticks', () => {
    const block = composeSituationBlock({ elder: 1, clanId: '1', tick: 8 });

    expect(block).toBe('TICK 8 Started');
  });

  it('warns on tick 49 (T-1) that message history is about to be erased', () => {
    const block = composeSituationBlock({ elder: 2, clanId: '2', tick: 49 });

    expect(block).toContain('TICK 49 Started');
    expect(block).toContain('MEMORY-WIPE WARNING');
    expect(block).toContain('your message history is erased on the next tick');
    expect(block).toContain('elder memory save <key> <value>');
    expect(block).toContain('Saved memory survives the wipe');
  });

  it('warns on tick 50 (final) to save continuity and ack-clear', () => {
    const block = composeSituationBlock({ elder: 3, clanId: '3', tick: 50 });

    expect(block).toContain('TICK 50 Started');
    expect(block).toContain('FINAL TICK');
    expect(block).toContain('Last chance to save');
    expect(block).toContain('elder memory save active-strategy');
    expect(block).toContain('elder ack-clear');
  });

  it('repeats the warning cycle every 50 ticks', () => {
    expect(composeSituationBlock({ elder: 4, clanId: '4', tick: 99 })).toContain(
      'MEMORY-WIPE WARNING',
    );
    expect(composeSituationBlock({ elder: 4, clanId: '4', tick: 100 })).toContain(
      'elder ack-clear',
    );
  });
});
