import { describe, expect, it } from 'vitest';
import { classifyMwaError, MwaError } from './mwa';

// Minimal coverage for AC-W1 — typed-error mapping is the only thing in mwa.ts
// that's testable without a real wallet transport. Hackathon rule: happy path
// + the explicit error-shape cases only.
describe('classifyMwaError', () => {
  it('passes MwaError through unchanged', () => {
    const original = new MwaError('UserDeclined', 'x');
    expect(classifyMwaError(original)).toBe(original);
  });

  it('classifies user-decline messages', () => {
    expect(classifyMwaError(new Error('user_cancel')).tag).toBe('UserDeclined');
    expect(classifyMwaError(new Error('User declined request')).tag).toBe(
      'UserDeclined',
    );
  });

  it('classifies wallet-unavailable messages', () => {
    expect(
      classifyMwaError(new Error('No compatible wallets installed')).tag,
    ).toBe('WalletUnavailable');
  });

  it('classifies expired-authorization messages', () => {
    expect(classifyMwaError(new Error('authorization expired')).tag).toBe(
      'AuthorizationExpired',
    );
    expect(classifyMwaError(new Error('invalid auth token')).tag).toBe(
      'AuthorizationExpired',
    );
  });

  it('falls back to Unknown', () => {
    expect(classifyMwaError(new Error('something weird')).tag).toBe('Unknown');
    expect(classifyMwaError('plain string').tag).toBe('Unknown');
  });
});
