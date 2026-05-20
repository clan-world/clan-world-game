import { describe, expect, it } from 'vitest';
import { shouldRefreshTickCountdownAnchor } from './TopHud';

describe('shouldRefreshTickCountdownAnchor', () => {
  it('refreshes when the fallback duration changes during the same tick', () => {
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 60_000 },
        12,
        45_000,
      ),
    ).toBe(true);
  });

  it('keeps the anchor when tick and duration are unchanged', () => {
    expect(
      shouldRefreshTickCountdownAnchor(
        { tick: 12, startedAtMs: 1_000, durationMs: 45_000 },
        12,
        45_000,
      ),
    ).toBe(false);
  });
});
