import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  WalrusKvStore,
  parseKvValue,
  elderKvNamespace,
  createWalrusKvStore,
} from '../src/walrusKvStore.js';

describe('parseKvValue', () => {
  it('extracts the value + version for an exact tagged line', () => {
    expect(parseKvValue('kv:active-strategy v=5 = "hold the ridge"', 'active-strategy')).toEqual({
      value: 'hold the ridge',
      version: 5,
    });
  });

  it('returns undefined when the key tag does not match (semantic near-miss guard)', () => {
    expect(parseKvValue('kv:other-key v=1 = "something"', 'active-strategy')).toBeUndefined();
  });

  it('supports an empty value', () => {
    expect(parseKvValue('kv:k v=1 = ""', 'k')).toEqual({ value: '', version: 1 });
  });

  it('preserves " = " inside the value', () => {
    expect(parseKvValue('kv:eq v=2 = "x = y = z"', 'eq')).toEqual({ value: 'x = y = z', version: 2 });
  });

  it('round-trips a value containing newlines (no truncation)', () => {
    // JSON-encoded value keeps the line single-line; the literal stored text is
    // `kv:k v=3 = "line1\nline2"` (with the \n escaped inside the JSON string).
    const encoded = `kv:k v=3 = ${JSON.stringify('line1\nline2')}`;
    expect(parseKvValue(encoded, 'k')).toEqual({ value: 'line1\nline2', version: 3 });
  });

  it('rejects a malformed (non-numeric version) line', () => {
    expect(parseKvValue('kv:k v=x = "y"', 'k')).toBeUndefined();
  });

  it('rejects a line missing the version field (legacy/unknown shape)', () => {
    expect(parseKvValue('kv:k = y', 'k')).toBeUndefined();
  });
});

describe('elderKvNamespace', () => {
  it('builds a stable per-elder namespace', () => {
    expect(elderKvNamespace(3)).toBe('elder-3-kv');
  });
});

describe('WalrusKvStore degrade behaviour (no credentials)', () => {
  it('isAvailable() is false when the credential file is missing', async () => {
    const store = new WalrusKvStore({
      namespace: 'elder-1-kv',
      credentialsPath: path.join(os.tmpdir(), `nope-${Date.now()}.json`),
    });
    expect(await store.isAvailable()).toBe(false);
  });

  it('save() degrades gracefully (ok:false) and recall() returns undefined', async () => {
    const store = new WalrusKvStore({
      namespace: 'elder-1-kv',
      credentialsPath: path.join(os.tmpdir(), `nope-${Date.now()}.json`),
    });
    const saved = await store.save('active-strategy', 'hold the ridge');
    expect(saved.ok).toBe(false);
    expect(saved.reason).toBeTruthy();
    expect(await store.recall('active-strategy')).toBeUndefined();
  });

  it('degrades when credential JSON is malformed', async () => {
    const file = path.join(os.tmpdir(), `bad-creds-${Date.now()}.json`);
    await fs.writeFile(file, '{ not valid json', 'utf8');
    const store = new WalrusKvStore({ namespace: 'elder-1-kv', credentialsPath: file });
    expect(await store.isAvailable()).toBe(false);
    await fs.unlink(file).catch(() => {});
  });

  it('degrades when required credential fields are absent', async () => {
    const file = path.join(os.tmpdir(), `partial-creds-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify({ accountId: '0xabc' }), 'utf8');
    const store = new WalrusKvStore({ namespace: 'elder-1-kv', credentialsPath: file });
    expect(await store.isAvailable()).toBe(false);
    await fs.unlink(file).catch(() => {});
  });
});

describe('WalrusKvStore with injected MemWal client', () => {
  function fakeMemwalFactory(remembered: unknown[], onRemember?: (t: string) => void) {
    return (() => ({
      async rememberAndWait(text: string) {
        onRemember?.(text);
        return { id: 'job', blob_id: 'blob123', owner: '0xowner', namespace: 'ns' };
      },
      async recall() {
        return { results: remembered, total: remembered.length };
      },
    })) as never;
  }

  const credsFile = async () => {
    const file = path.join(os.tmpdir(), `good-creds-${Date.now()}-${Math.random()}.json`);
    await fs.writeFile(
      file,
      JSON.stringify({
        delegatePrivateKey: 'deadbeef',
        accountId: '0xacct',
        relayerUrl: 'https://relayer.example',
      }),
      'utf8',
    );
    return file;
  };

  it('round-trips a save → recall, encoding value as versioned JSON', async () => {
    const file = await credsFile();
    let rememberedText = '';
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory(
        [{ blob_id: 'b', text: 'kv:active-strategy v=5 = "hold the ridge"', distance: 0.1 }],
        t => {
          rememberedText = t;
        },
      ),
    });

    const saved = await store.save('active-strategy', 'hold the ridge');
    expect(saved.ok).toBe(true);
    expect(saved.blobId).toBe('blob123');
    // Encoded as kv:<key> v=<version> = <json-value>.
    expect(rememberedText).toMatch(/^kv:active-strategy v=\d+ = "hold the ridge"$/);

    const recalled = await store.recall('active-strategy');
    expect(recalled).toBe('hold the ridge');
    await fs.unlink(file).catch(() => {});
  });

  it('save → recall round-trips a value containing newlines without truncation', async () => {
    const file = await credsFile();
    let rememberedText = '';
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory([], t => {
        rememberedText = t;
      }),
    });
    const multiline = 'hold the ridge\nfall back at dawn';
    await store.save('plan', multiline);
    // Stored text is a single line (newline escaped inside the JSON string).
    expect(rememberedText.includes('\n')).toBe(false);
    expect(parseKvValue(rememberedText, 'plan')?.value).toBe(multiline);
    await fs.unlink(file).catch(() => {});
  });

  it('recall ignores semantic near-miss neighbours that lack the exact tag', async () => {
    const file = await credsFile();
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory([
        { blob_id: 'b1', text: 'kv:some-other-key v=1 = "noise"', distance: 0.05 },
        { blob_id: 'b2', text: 'kv:active-strategy v=1 = "the real one"', distance: 0.4 },
      ]),
    });
    expect(await store.recall('active-strategy')).toBe('the real one');
    await fs.unlink(file).catch(() => {});
  });

  it('recall picks the highest-version entry among exact-tag matches (latest write wins)', async () => {
    const file = await credsFile();
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory([
        // Older write ranks higher on similarity, but newer version must win.
        { blob_id: 'b1', text: 'kv:active-strategy v=10 = "old"', distance: 0.01 },
        { blob_id: 'b2', text: 'kv:active-strategy v=42 = "new"', distance: 0.9 },
      ]),
    });
    expect(await store.recall('active-strategy')).toBe('new');
    await fs.unlink(file).catch(() => {});
  });

  it('recall returns undefined when no result carries the exact tag', async () => {
    const file = await credsFile();
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory([
        { blob_id: 'b1', text: 'kv:unrelated v=1 = "x"', distance: 0.05 },
      ]),
    });
    expect(await store.recall('active-strategy')).toBeUndefined();
    await fs.unlink(file).catch(() => {});
  });

  it('save degrades (ok:false) for a key containing a newline rather than colliding', async () => {
    const file = await credsFile();
    const store = createWalrusKvStore(2, {
      credentialsPath: file,
      memwalFactory: fakeMemwalFactory([]),
    });
    const saved = await store.save('bad\nkey', 'v');
    expect(saved.ok).toBe(false);
    expect(saved.reason).toMatch(/newline/);
    await fs.unlink(file).catch(() => {});
  });
});
