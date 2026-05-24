import type { TmuxSink } from "./tmuxSink.js";
import { sleep } from "./retry.js";

export const READY_PROBE_TIMEOUT_MS = 10_000;
export const READY_PROBE_INTERVAL_MS = 250;
export const STUCK_INPUT_MAX_RETRIES = 3;
export const STUCK_INPUT_RETRY_DELAY_MS = 500;

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
  for (let retry = 0; retry <= STUCK_INPUT_MAX_RETRIES; retry++) {
    if (!hasStuckInput(await tmux.capturePane(POST_PASTE_CAPTURE_LINES))) {
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

function hasStuckInput(pane: string): boolean {
  return inputRegion(pane).some((line) => {
    const text = inputPromptText(line);
    return text !== null && text.length > 0;
  });
}

function inputRegion(pane: string): string[] {
  return pane.split(/\r?\n/).slice(-INPUT_REGION_LINES);
}

function inputPromptText(line: string): string | null {
  const withoutCursor = line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const match = /^\s*(?:[\u2502\u2503|]\s*)?>\s*(.*?)\s*$/.exec(withoutCursor);
  return match?.[1] ?? null;
}
