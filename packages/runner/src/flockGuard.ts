import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface FlockHandle {
  release(): void;
}

export function acquireFlock(lockPath: string): FlockHandle {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = fs.openSync(lockPath, "w");
  const result = spawnSync("flock", ["-n", "3"], {
    stdio: ["ignore", "pipe", "pipe", fd],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fs.closeSync(fd);
    const stderr = result.stderr ? `: ${result.stderr.trim()}` : "";
    throw new Error(`could not acquire flock ${lockPath}${stderr}`);
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      fs.closeSync(fd);
    },
  };
}
