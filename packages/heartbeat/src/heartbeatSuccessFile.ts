import { renameSync, writeFileSync } from 'node:fs';

const DEFAULT_HEARTBEAT_SUCCESS_FILE = '/tmp/last-heartbeat-success';

export function writeHeartbeatSuccessFile(
  successFile =
    process.env['HEARTBEAT_SUCCESS_FILE_OVERRIDE'] ?? DEFAULT_HEARTBEAT_SUCCESS_FILE,
): void {
  try {
    const tmpFile = `${successFile}.${process.pid}.tmp`;
    writeFileSync(tmpFile, String(Math.floor(Date.now() / 1000)));
    renameSync(tmpFile, successFile);
  } catch (err) {
    console.warn('[heartbeatSuccessFile] heartbeat success file write failed:', err);
  }
}
