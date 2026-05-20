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
      body,
    });
    if (!response.ok) {
      const description = await response.text().catch(() => response.statusText);
      return { ok: false, error: `Telegram API ${response.status}: ${description}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
