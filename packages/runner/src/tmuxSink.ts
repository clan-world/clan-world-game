import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { postPasteSubmitted, prePasteReady } from "./pasteVerification.js";
import { sleep } from "./retry.js";

const execFileAsync = promisify(execFile);

// Map a clan display color (the Claude Code /color enum) to a tmux status-bar
// bg + a readable fg, so the clan color shows in the tmux chrome even when the
// Claude TUI's own /color doesn't render. Unknown colors fall back to tmux's
// default green bar.
const CLAN_COLOR_TO_TMUX: Record<string, { bg: string; fg: string }> = {
  red: { bg: "red", fg: "white" },
  blue: { bg: "blue", fg: "white" },
  green: { bg: "green", fg: "black" },
  yellow: { bg: "yellow", fg: "black" },
  purple: { bg: "colour93", fg: "white" },
  orange: { bg: "colour208", fg: "black" },
  pink: { bg: "colour213", fg: "black" },
  cyan: { bg: "cyan", fg: "black" },
};

export function clanColorToTmuxStyle(color: string): { bg: string; fg: string } {
  return CLAN_COLOR_TO_TMUX[color] ?? { bg: "green", fg: "black" };
}

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
    // (Liam-diagnosed 2026-05-26; codex co-design). prePasteReady waits for an
    // empty prompt; a single Enter submits; postPasteSubmitted verifies the
    // input returned to empty (it retries Enter on render lag). Log-don't-throw
    // so a stuck command never strands the reset before the post-wipe
    // continuity prompt.
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Only Escape when the input isn't already idle: clears stale
      // slash/autocomplete text or a previous failed attempt, while never
      // cancelling a generation that happened to be running on an empty
      // prompt (codex R1 MED). On the happy path (fresh post-launch prompt)
      // this is a no-op and we go straight to typing.
      if (!(await prePasteReady(this))) {
        await this.sendKeys("Escape");
        await sleep(250);
        if (!(await prePasteReady(this))) continue;
      }
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

  // Theme this session's tmux status bar: a clean "Ælder <name>" window name in
  // the clan color. We disable automatic-rename first — otherwise tmux captures
  // the terminal-title escape from /rename (and pasted text) into the window
  // name, which renders as garbled cruft in the bar (Liam-observed 2026-05-26).
  // Belt-and-suspenders with /color so the clan color shows in the tmux chrome
  // even when the Claude TUI /color doesn't render. Resilient: logs, never
  // throws, so a tmux hiccup can't strand the reset's continuity prompt.
  async setStatusBar(windowName: string, color: string): Promise<void> {
    const { bg, fg } = clanColorToTmuxStyle(color);
    const styleStr = `bg=${bg},fg=${fg}`;
    try {
      // automatic-rename is a WINDOW option (-w) — without it tmux keeps
      // re-clobbering the window name with the active process ("claude").
      await execFileAsync("tmux", ["set-option", "-t", this.session, "-w", "automatic-rename", "off"]);
      await execFileAsync("tmux", ["rename-window", "-t", this.session, windowName]);
      // Color the whole bar: status-style (left/right) AND the active window
      // segment (window-status-current-style, its own default-green style).
      await execFileAsync("tmux", ["set-option", "-t", this.session, "status-style", styleStr]);
      await execFileAsync("tmux", ["set-option", "-t", this.session, "-w", "window-status-current-style", styleStr]);
      // Drop the Æ-mangled pane title from the default status-right; keep the clock.
      await execFileAsync("tmux", ["set-option", "-t", this.session, "status-right", "%H:%M %d-%b-%y"]);
    } catch (err) {
      console.warn(`[tmux] failed to set status bar for ${this.session}: ${String(err)}`);
    }
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
