import type { TerminalFrameStatus } from '../../hooks/useTerminalFrameReconnect';

export const RESET_DETECTION_WINDOW_MS = 10_000;
export const RESET_OVERLAY_MAX_DISPLAY_MS = 30_000;
export const RESET_OVERLAY_FADE_MS = 320;

export function getElderResetId(clanId: number): string {
  return `elder-${clanId}`;
}

export function shouldCheckForReset(status: TerminalFrameStatus): boolean {
  return status === 'reconnecting' || status === 'disconnected';
}
