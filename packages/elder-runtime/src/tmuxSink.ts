import { execFile } from "node:child_process";
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
    await execFileAsync("tmux", ["load-buffer", "-b", name, "-"], { input: content } as any);
  }

  async pasteBuffer(name: string, target: string, opts: { bracketed: boolean }): Promise<void> {
    const args = ["paste-buffer", "-b", name, "-t", target];
    if (opts.bracketed) args.push("-p");
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
