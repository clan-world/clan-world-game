export interface RetryOptions {
  label: string;
  signal?: AbortSignal;
  onRecovered?: () => Promise<void>;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export async function withBackoff<T>(
  run: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let delayMs = opts.initialDelayMs ?? 1_000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  let failed = false;

  while (true) {
    opts.signal?.throwIfAborted();
    try {
      const result = await run();
      if (failed && opts.onRecovered) {
        await opts.onRecovered().catch((err) => {
          console.warn(`[retry] recovery event failed after ${opts.label}:`, err);
        });
      }
      return result;
    } catch (err) {
      failed = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[retry] ${opts.label} failed; retrying in ${delayMs}ms: ${msg}`);
      await sleep(delayMs, opts.signal);
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let onAbort: () => void = () => {};
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
