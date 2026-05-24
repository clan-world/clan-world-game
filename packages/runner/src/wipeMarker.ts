import fs from "node:fs";
import path from "node:path";

export function readWipeMarker(markerPath: string): number | null {
  try {
    const raw = fs.readFileSync(markerPath, "utf8").trim();
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeWipeMarker(markerPath: string, tick: number): void {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const tmpPath = `${markerPath}.tmp`;
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, `${tick}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, markerPath);
}

export function clearWipeMarker(markerPath: string): void {
  try {
    fs.unlinkSync(markerPath);
  } catch {
    // already clear
  }
}
