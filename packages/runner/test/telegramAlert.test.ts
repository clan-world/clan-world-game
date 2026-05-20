import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramAlert, telegramAlertConfigFromEnv } from '../src/telegramAlert';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('telegramAlert', () => {
  it('returns a non-fatal error when TELEGRAM_BOT_TOKEN is missing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const result = await sendTelegramAlert('heartbeat failed', {
      chatId: '-1003806628027',
    });

    expect(result).toEqual({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN is not set',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to the do-crew chat and omits message_thread_id when unset', () => {
    const cfg = telegramAlertConfigFromEnv({
      TELEGRAM_BOT_TOKEN: 'token',
    } as NodeJS.ProcessEnv);

    expect(cfg).toEqual({
      botToken: 'token',
      chatId: '-1003806628027',
      threadId: undefined,
    });
  });

  it('posts message_thread_id when TELEGRAM_ALERT_THREAD_ID is set', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
    } satisfies Partial<Response>);
    vi.stubGlobal('fetch', fetch);

    const result = await sendTelegramAlert('heartbeat failed', {
      botToken: 'token',
      chatId: '-1003806628027',
      threadId: '123',
    });

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('chat_id')).toBe('-1003806628027');
    expect(body.get('text')).toBe('heartbeat failed');
    expect(body.get('message_thread_id')).toBe('123');
  });

  it('returns a non-fatal error for non-OK Telegram API responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: vi.fn().mockResolvedValue('rate limited'),
    } satisfies Partial<Response>));

    const result = await sendTelegramAlert('heartbeat failed', {
      botToken: 'token',
      chatId: '-1003806628027',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Telegram API 429: rate limited',
    });
  });

  it('returns a non-fatal error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await sendTelegramAlert('heartbeat failed', {
      botToken: 'token',
      chatId: '-1003806628027',
    });

    expect(result).toEqual({
      ok: false,
      error: 'network down',
    });
  });
});
