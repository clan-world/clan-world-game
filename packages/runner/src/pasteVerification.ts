import type { TmuxSink } from "./tmuxSink.js";

export async function prePasteReady(_tmux: TmuxSink): Promise<boolean> {
  // TODO(PR4): pre-paste readiness probe via tmux capture-pane.
  return true;
}

export async function postPasteSubmitted(_tmux: TmuxSink): Promise<boolean> {
  // TODO(PR4): post-paste stuck-input detection and Enter retry.
  return true;
}
