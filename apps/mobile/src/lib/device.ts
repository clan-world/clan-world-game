/**
 * Detected device family. Today: only "seeker" vs everything else. iOS is
 * out of scope for slice 0 — flagged as `'unknown'` so the Codex screen can
 * surface the limitation honestly instead of misclassifying.
 */
export type DeviceKind = 'seeker' | 'generic-android' | 'unknown';

/**
 * Pure classifier — exported separately from the runtime detector so it
 * can be unit-tested without dragging react-native into the vitest worker.
 */
export function classifyDevice(input: {
  osName: string | null;
  brand: string | null;
  modelName: string | null;
}): DeviceKind {
  const isAndroid = (input.osName ?? '').toLowerCase().includes('android');
  if (!isAndroid) return 'unknown';

  const brand = (input.brand ?? '').toLowerCase();
  const model = (input.modelName ?? '').toLowerCase();

  // Solana Saga + Seeker both report the brand "Solana Mobile" / "OSOM"
  // depending on firmware. Saga shipped as model "Saga"; Seeker ships as
  // model "Seeker". Match defensively — treat any mention of the family as
  // Seeker-class for the purposes of the Codex badge.
  if (brand.includes('solana') || brand.includes('osom')) return 'seeker';
  if (model.includes('saga') || model.includes('seeker')) return 'seeker';

  return 'generic-android';
}

export function deviceLabel(kind: DeviceKind): string {
  switch (kind) {
    case 'seeker':
      return 'Solana Seeker';
    case 'generic-android':
      return 'Generic Android';
    case 'unknown':
      return 'Unknown';
  }
}
