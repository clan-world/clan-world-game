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
  return inputRegion(pane).some((line) => inputPromptText(line) === "");
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
  return promptLines.every((text) => text.length === 0);
}

function inputRegion(pane: string): string[] {
  return pane.split(/\r?\n/).slice(-INPUT_REGION_LINES);
}

function inputPromptText(line: string): string | null {
  const withoutCursor = line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  // Claude TUI 2.x renders the prompt indicator as `\u276f` (U+276F) instead of
  // ASCII `>`. Accept both so the runner stays compatible across versions.
  // Without this, prePasteReady never matches and the runner emits
  // `ready_probe_timeout` every tick. Validated 2026-05-24 self-hosted cutover
  // (Phase 2 tick-delivery blocker).
  const match = /^\s*(?:[\u2502\u2503|]\s*)?[>\u276f]\s*(.*?)\s*$/.exec(withoutCursor);
  return match?.[1] ?? null;
}
