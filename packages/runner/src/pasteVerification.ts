import type { TmuxSink } from "./tmuxSink.js";
import { sleep } from "./retry.js";

export const READY_PROBE_TIMEOUT_MS = 10_000;
export const READY_PROBE_INTERVAL_MS = 250;
export const STUCK_INPUT_MAX_RETRIES = 3;
export const STUCK_INPUT_RETRY_DELAY_MS = 500;
// Initial settle before first post-paste check: pasteMessage's terminating
// Enter may not have rendered yet, so the first capturePane otherwise
// races against TUI render lag and can fire a spurious Enter retry.
export const POST_PASTE_INITIAL_SETTLE_MS = 200;

const PRE_PASTE_CAPTURE_LINES = 20;
const POST_PASTE_CAPTURE_LINES = 20;
const INPUT_REGION_LINES = 5;

export async function prePasteReady(tmux: TmuxSink): Promise<boolean> {
  const deadline = Date.now() + READY_PROBE_TIMEOUT_MS;
  while (true) {
    if (hasReadyPrompt(await tmux.capturePane(PRE_PASTE_CAPTURE_LINES))) {
      return true;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await sleep(Math.min(READY_PROBE_INTERVAL_MS, remainingMs));
  }
}

export async function postPasteSubmitted(tmux: TmuxSink): Promise<boolean> {
  // Give the TUI time to render the paste's terminating Enter before the
  // first stuck-input check. Without this, fast-running tests + real
  // delivery both race against TUI render lag and trigger spurious retries.
  await sleep(POST_PASTE_INITIAL_SETTLE_MS);
  for (let retry = 0; retry <= STUCK_INPUT_MAX_RETRIES; retry++) {
    if (isInputSubmitted(await tmux.capturePane(POST_PASTE_CAPTURE_LINES))) {
      return true;
    }
    if (retry === STUCK_INPUT_MAX_RETRIES) return false;
    await tmux.sendKeys("Enter");
    await sleep(STUCK_INPUT_RETRY_DELAY_MS);
  }
  return false;
}

function hasReadyPrompt(pane: string): boolean {
  return inputRegion(pane).some((line) => isEmptyPrompt(inputPromptText(line)));
}

/**
 * Claude Code >=2.1.x renders a placeholder hint INSIDE the empty input box
 * (e.g. `❯ Try "fix typecheck errors"`). The hint vanishes the moment real
 * text is typed, so a hint-bearing prompt IS an empty prompt. Without this,
 * the readiness probe reads the hint as typed text and every per-tick paste
 * dies with ready_probe_timeout — the same silent-pipeline failure mode as
 * the stale ">"-only glyph regex documented on inputPromptText (caught live
 * 2026-06-12 after the elder image refresh bundled Claude Code 2.1.175).
 */
function isEmptyPrompt(text: string | null): boolean {
  if (text === null) return false;
  return text === "" || /^Try ".+"$/.test(text);
}

/**
 * Returns true ONLY if the input box is visible AND empty. False-positives
 * from a blank/crashed pane (no prompt visible at all) used to read as
 * "submitted" — gemini R1 MED. Now we require positive evidence of an
 * empty prompt before claiming success. If the TUI disappeared, runner
 * retries via the resend cap, and the upstream healthcheck catches a truly
 * dead tmux/claude.
 */
function isInputSubmitted(pane: string): boolean {
  const promptLines = inputRegion(pane)
    .map(inputPromptText)
    .filter((text): text is string => text !== null);
  if (promptLines.length === 0) return false;
  return promptLines.every((text) => isEmptyPrompt(text));
}

function inputRegion(pane: string): string[] {
  return pane.split(/\r?\n/).slice(-INPUT_REGION_LINES);
}

function inputPromptText(line: string): string | null {
  const withoutCursor = line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  // Prompt glyph: classic Claude Code used ASCII ">"; newer TUI builds render
  // "\u276f" (\u276f) and some themes use "\u203a" (\u203a). Accept all three so the
  // readiness probe keeps matching across Claude Code TUI versions. A stale
  // ">"-only regex silently broke the per-tick paste pipeline after an elder
  // image refresh bundled a newer Claude Code (ready_probe_timeout every tick).
  const match = /^\s*(?:[\u2502\u2503|]\s*)?[>\u276f\u203a]\s*(.*?)\s*$/.exec(withoutCursor);
  return match?.[1] ?? null;
}
