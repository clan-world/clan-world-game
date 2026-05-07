import { describe, expect, it } from 'vitest';
import { classifyDevice, deviceLabel } from './device';

// AC-S1 — pure classifier behaviour. Real-device verification is AC-S2 and
// requires the user to run the APK on a Pixel emulator (and ideally a real
// Seeker if available).
describe('classifyDevice', () => {
  it('returns seeker for Solana-branded Android devices', () => {
    expect(
      classifyDevice({
        osName: 'Android',
        brand: 'Solana Mobile',
        modelName: 'Saga',
      }),
    ).toBe('seeker');
    expect(
      classifyDevice({
        osName: 'Android',
        brand: 'OSOM',
        modelName: 'Seeker',
      }),
    ).toBe('seeker');
  });

  it('returns generic-android for non-Solana Android', () => {
    expect(
      classifyDevice({
        osName: 'Android',
        brand: 'Google',
        modelName: 'Pixel 7',
      }),
    ).toBe('generic-android');
  });

  it('returns unknown for non-Android', () => {
    expect(
      classifyDevice({ osName: 'iOS', brand: 'Apple', modelName: 'iPhone 15' }),
    ).toBe('unknown');
    expect(classifyDevice({ osName: null, brand: null, modelName: null })).toBe(
      'unknown',
    );
  });

  it('deviceLabel maps each kind to a human label', () => {
    expect(deviceLabel('seeker')).toBe('Solana Seeker');
    expect(deviceLabel('generic-android')).toBe('Generic Android');
    expect(deviceLabel('unknown')).toBe('Unknown');
  });
});
