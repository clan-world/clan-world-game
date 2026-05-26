import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { postPasteSubmitted, prePasteReady } from "./pasteVerification.js";
import { sleep } from "./retry.js";

const execFileAsync = promisify(execFile);

export class TmuxSink {
  private readonly session: string;

  constructor(sessionName: string) {
    this.session = sessionName;
  }

  target(): string {
    return this.session;
  }

  async hasSession(): Promise<boolean> {
    try {
      await execFileAsync("tmux", ["has-session", "-t", this.session]);
      return true;
    } catch {
      return false;
    }
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

  async newSession(runScriptOrCwd = "/workspace"): Promise<void> {
    const args = ["new-session", "-d", "-s", this.session];
    if (runScriptOrCwd.startsWith("/")) {
      args.push("-c", runScriptOrCwd);
    } else {
      args.push(runScriptOrCwd);
    }
    await execFileAsync("tmux", args);
  }

  async launchClaude(opts: { continue: boolean; runScriptPath: string }): Promise<void> {
    const mode = opts.continue ? "always" : "never";
    const command = `CLAN_WORLD_CLAUDE_CONTINUE=${mode} ${shellQuote(opts.runScriptPath)}`;
    await this.sendLiteral(command);
    await this.sendKeys("Enter");
  }

  async sendSlashCommand(command: string): Promise<void> {
    // Slash commands (/rename, /color) need the same readiness + submit
    // verification as tick pastes. A fixed double-Enter raced the TUI and left
    // the 2nd command (/color) stuck unsubmitted in the input on a reset
    // (Liam-diagnosed 2026-05-26; codex co-design). Escape clears any stale
    // slash-autocomplete/input state; prePasteReady waits for an empty prompt;
    // a single Enter submits; postPasteSubmitted verifies the input returned to
    // empty (it retries Enter on render lag). Log-don't-throw so a stuck command
    // never strands the reset before the post-wipe continuity prompt.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.sendKeys("Escape");
      await sleep(250);
      if (!(await prePasteReady(this))) continue;
      await this.sendLiteral(command);
      await sleep(500);
      await this.sendKeys("Enter");
      await sleep(500);
      if (await postPasteSubmitted(this)) {
        await sleep(750);
        return;
      }
    }
    console.warn(`[tmux] slash command did not visibly submit after 3 attempts: ${command}`);
  }

  async sendLiteral(content: string): Promise<void> {
    await execFileAsync("tmux", ["send-keys", "-t", this.session, "-l", content]);
  }

  async pasteMessage(content: string): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "elder-runner-paste-"));
    const file = path.join(dir, "message.txt");
    const bufferName = `elder-input-${process.pid}`;
    try {
      await fs.writeFile(file, content, "utf8");
      await execFileAsync("tmux", ["load-buffer", "-b", bufferName, file]);
      await this.pasteBuffer(bufferName, this.session, { bracketed: true });
      await this.sendKeys("Enter");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async newSessionWithCommand(runScript: string): Promise<void> {
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
