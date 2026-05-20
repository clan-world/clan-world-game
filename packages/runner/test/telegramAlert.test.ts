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

  it('scrubs bot token from err.cause-bearing fetch errors', async () => {
    // undici TypeError surfaces the request URL through err.cause.message
    // in some Node 20.x configurations — the URL has the bot token as a
    // path segment, so it must be scrubbed regardless of nesting depth.
    const causeErr = new Error('connect ECONNREFUSED https://api.telegram.org/bot01234SECRETTOKEN/sendMessage');
    const outerErr = new TypeError('fetch failed');
    (outerErr as Error & { cause?: unknown }).cause = causeErr;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(outerErr));

    const result = await sendTelegramAlert('test', {
      botToken: '01234SECRETTOKEN',
      chatId: '-1003806628027',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain('01234SECRETTOKEN');
    expect(result.error).toContain('<redacted>');
    // confirm the cause's message did get surfaced (with token redacted)
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('scrubs bot token from AggregateError.errors nested fetch failures', async () => {
    const inner1 = new Error('https://api.telegram.org/botSECRET99/sendMessage timed out');
    const inner2 = new Error('https://api.telegram.org/botSECRET99/sendMessage retry failed');
    const agg = new AggregateError([inner1, inner2], 'all upstreams failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(agg));

    const result = await sendTelegramAlert('test', {
      botToken: 'SECRET99',
      chatId: '-1003806628027',
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('SECRET99');
    expect(result.error).toContain('<redacted>');
  });

  it('scrubs bot token from non-OK response body', async () => {
    // A misrouted Telegram 401 sometimes echoes the request URL in the body
    // text (proxy / dev-tunnel error pages). Scrub the body before logging.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Invalid request to https://api.telegram.org/botPROXY_LEAK/sendMessage'),
    }));

    const result = await sendTelegramAlert('test', {
      botToken: 'PROXY_LEAK',
      chatId: '-1003806628027',
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('PROXY_LEAK');
    expect(result.error).toContain('<redacted>');
    expect(result.error).toContain('Telegram API 401');
  });
});
