import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class TmuxSink {
  private readonly session: string;

  constructor(sessionName: string) {
    this.session = sessionName;
  }

  async sendKeys(text: string): Promise<void> {
    await execFileAsync("tmux", ["send-keys", "-t", this.session, "-l", text]);
    await execFileAsync("tmux", ["send-keys", "-t", this.session, "Enter"]);
    // Double-Enter: CC occasionally drops first Enter after literal paste
    await new Promise(r => setTimeout(r, 250));
    await execFileAsync("tmux", ["send-keys", "-t", this.session, "Enter"]);
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

  async sessionExists(): Promise<boolean> {
    try {
      await execFileAsync("tmux", ["has-session", "-t", this.session]);
      return true;
    } catch {
      return false;
    }
  }
}
