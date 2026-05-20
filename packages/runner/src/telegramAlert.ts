export interface TelegramAlertConfig {
  botToken?: string;
  chatId?: string;
  threadId?: string;
}

export interface TelegramAlertResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_DO_CREW_CHAT_ID = '-1003806628027';

export function telegramAlertConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramAlertConfig {
  return {
    botToken: env['TELEGRAM_BOT_TOKEN'],
    chatId: env['TELEGRAM_ALERT_CHAT_ID'] ?? DEFAULT_DO_CREW_CHAT_ID,
    threadId: env['TELEGRAM_ALERT_THREAD_ID'],
  };
}

export async function sendTelegramAlert(
  text: string,
  cfg: TelegramAlertConfig = telegramAlertConfigFromEnv(),
): Promise<TelegramAlertResult> {
  if (!cfg.botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };
  }
  const chatId = cfg.chatId ?? DEFAULT_DO_CREW_CHAT_ID;
  const body = new URLSearchParams({
    chat_id: chatId,
    text,
  });
  if (cfg.threadId) {
    body.set('message_thread_id', cfg.threadId);
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      body,
    });
    if (!response.ok) {
      const description = await response.text().catch(() => response.statusText);
      return {
        ok: false,
        error: scrubBotToken(`Telegram API ${response.status}: ${description}`, cfg.botToken),
      };
    }
    return { ok: true };
  } catch (err) {
    // Scrub the bot token from any error surface before returning. Token is
    // a URL path segment so leak is structural — undici/AggregateError can
    // expose it via err.cause, err.errors[i], or err.stack. Stringify the
    // whole error tree and scrub once. opus 4.7 R1 L1 + codex 5.5 R2.
    return { ok: false, error: scrubBotToken(stringifyError(err), cfg.botToken) };
  }
}

function stringifyError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return String(err);
  const seen = new Set<unknown>();
  // Collect nested message strings ONLY (skip stacks — they're noisy and
  // already get scrubbed via the same path before logging). We surface
  // cause + AggregateError.errors so undici-style nested failures don't
  // hide a token-bearing inner message.
  const collect = (node: unknown): string[] => {
    if (node === null || node === undefined) return [];
    if (typeof node !== 'object') return [String(node)];
    if (seen.has(node)) return [];
    seen.add(node);
    const out: string[] = [];
    const obj = node as { message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof obj.message === 'string') out.push(obj.message);
    if (obj.cause !== undefined) out.push(...collect(obj.cause));
    if (Array.isArray(obj.errors)) for (const inner of obj.errors) out.push(...collect(inner));
    return out;
  };
  const parts = collect(err);
  return parts.length > 0 ? parts.join(' | ') : String(err);
}

function scrubBotToken(text: string, botToken: string | undefined): string {
  if (!botToken) return text;
  return text.split(botToken).join('<redacted>');
}
