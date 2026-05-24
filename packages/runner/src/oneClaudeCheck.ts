import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function countClaudeProcesses(): Promise<number> {
  try {
    const result = await execFileAsync("pgrep", ["claude"]) as unknown;
    const stdout = typeof result === "string"
      ? result
      : (result as { stdout?: string }).stdout ?? "";
    return stdout.split(/\s+/).filter(Boolean).length;
  } catch (err: any) {
    if (err?.code === 1) return 0;
    throw err;
  }
}

export async function assertOneClaudeProcess(): Promise<void> {
  const count = await countClaudeProcesses();
  if (count > 1) {
    throw new Error(`one-claude invariant violated: found ${count} claude processes`);
  }
}
