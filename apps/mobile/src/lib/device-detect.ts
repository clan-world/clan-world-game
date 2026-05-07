import * as Device from 'expo-device';
import { classifyDevice } from './device';
import type { DeviceKind } from './device';

/**
 * Runtime detector. Imported only by app code (not test code) so the
 * react-native module graph stays out of the vitest worker.
 */
export function detectDeviceKind(): DeviceKind {
  return classifyDevice({
    osName: Device.osName ?? null,
    brand: Device.brand ?? null,
    modelName: Device.modelName ?? null,
  });
}
