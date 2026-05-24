import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class TmuxSink {
  private readonly session: string;

  constructor(sessionName: string) {
    this.session = sessionName;
  }

  async sendKeys(key: string): Promise<void> {
    await execFileAsync("tmux", ["send-keys", "-t", this.session, key, ""]);
  }

  async loadBuffer(name: string, content: string): Promise<void> {
    // NOTE: execFile's `input` option is documented on execFileSync but NOT on
    // the async execFile — the async variant silently drops it, leaving tmux
    // with an empty buffer (exit 0, no error). We spawn explicitly and pipe
    // content through stdin until EOF, which is what `tmux load-buffer -b NAME -`
    // reads. See PR #544 / fix for PR #543.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tmux", ["load-buffer", "-b", name, "-"]);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tmux load-buffer exited with code ${code}`));
      });
      child.stdin.on("error", reject);
      child.stdin.end(content, "utf8");
    });
  }

  async pasteBuffer(name: string, target: string, opts: { bracketed: boolean }): Promise<void> {
    const args = ["paste-buffer", "-b", name, "-t", target];
    if (opts.bracketed) args.push("-p", "-r"); // -p: bracketed paste mode; -r: no LF→CR replacement
    await execFileAsync("tmux", args);
  }

  async capturePane(lines = 100): Promise<string> {
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane", "-t", this.session, "-p", "-S", String(-lines),
    ]);
    return stdout;
  }

  async killSession(): Promise<void> {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", this.session]);
    } catch {
      // ignore — session may not exist
    }
  }

  async newSession(runScript: string): Promise<void> {
    await execFileAsync("tmux", [
      "new-session", "-d", "-s", this.session, runScript,
    ]);
  }

  async respawnPane(): Promise<void> {
    // Respawns the first pane of the first window in the session.
    // ttyd stays attached to the session; the pane gets a fresh process.
    await execFileAsync("tmux", ["respawn-pane", "-k", "-t", `${this.session}:0.0`]);
  }
}
