import { tokens } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';
import { useSafeQuery as useQuery } from '../../../hooks/useSafeQuery';
import { api } from '../../../../../server/convex/_generated/api';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

/** Claude/Walrus coral — signals decentralized, encrypted, on-chain storage. */
const WALRUS_CORAL = '#d97757';

interface KvRow {
  key: string;
  value: string;
  /**
   * Storage backend the row lives on. `"walrus"` (added by PR4's schema work)
   * means the value is encrypted on Walrus + owned per-Elder on Sui; anything
   * else is local/demo scratch. Read as a widened string so this UI compiles
   * before the schema literal lands and renders correctly once it does.
   */
  source: string;
  /** Walrus blob id (on-chain proof), present once a row is published. */
  blobId?: string;
  /** Sui object / account id owning the encrypted memory. */
  accountId?: string;
}

/** Free-text episodic reflection (memwal_remember), distinct from KV state. */
interface ReflectionRow {
  tick?: number;
  text: string;
  source: string;
  blobId?: string;
  accountId?: string;
}

interface CrudRow {
  tick: number;
  op: 'READ' | 'WRITE';
  key: string;
  note?: string;
}

interface BulletinRow {
  body: string;
  age: string;
}

const STUB_KV: KvRow[] = [
  { key: 'last_grudge',     value: 'clan-3',    source: 'local' },
  { key: 'wood_threshold',  value: '80',        source: 'local' },
  { key: 'pref_target',     value: 'forest',    source: 'local' },
  { key: 'mood',            value: 'cautious',  source: 'local' },
];

/**
 * Reflections are intentionally stub-only until PR4 wires the live
 * `memwal_remember` free-text feed. We do NOT fabricate on-chain ids here —
 * the section renders an explicit "awaiting live data" affordance instead.
 */
const STUB_REFLECTIONS: ReflectionRow[] = [
  { tick: 5, text: 'Crimson feinted at the river then pulled back — likely baiting a wall commitment. Hold the millers.', source: 'demo' },
  { tick: 3, text: 'Winter is two ticks out and the granary is thin. Prioritise wheat over wood until the threshold clears.', source: 'demo' },
];

const STUB_CRUD: CrudRow[] = [
  { tick: 4, op: 'WRITE', key: 'mood',         note: 'cautious → wary'   },
  { tick: 3, op: 'READ',  key: 'last_grudge',  note: 'planning retort'   },
  { tick: 2, op: 'WRITE', key: 'wood_threshold', note: 'raise to 80'     },
  { tick: 1, op: 'READ',  key: 'pref_target',  note: 'mission seeding'   },
];

const STUB_BULLETINS: BulletinRow[] = [
  { age: '2t', body: '"Wood scarce — millers prioritize."' },
  { age: '5t', body: '"Crimson moves — watch the river."'  },
];

/** Coerce the stored bulletin slot/updatedAt pair into a short "Nt" age label. */
function bulletinAge(slot: number, currentSlot: number): string {
  const diff = Math.max(0, currentSlot - slot);
  return `${diff}t`;
}

/**
 * Read a string field off a Convex memory doc without depending on the schema
 * literal. PR4 adds the `"walrus"` source value plus `blobId`/`accountId`
 * on-chain proof fields; until its generated types land, those keys aren't on
 * the inferred row type, so we widen through `unknown` and validate at runtime.
 */
function readStr(row: unknown, ...keys: string[]): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const rec = row as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Read a finite number field off a Convex doc without depending on its type. */
function readNum(row: unknown, ...keys: string[]): number | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const rec = row as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** True when a memory row lives on decentralized Walrus storage. */
function isWalrus(source: string): boolean {
  return source === 'walrus';
}

// Explorer roots. Single source of truth so a future testnet/devnet toggle is
// a one-line change. ClanWorld targets Sui + Walrus mainnet.
const SUISCAN_ROOT = 'https://suiscan.xyz/mainnet';
const WALRUSCAN_ROOT = 'https://walruscan.com/mainnet';

/**
 * Explorer link for an on-chain proof id. A Walrus blob id is a content digest
 * resolved on Walruscan; a Sui object id resolves on Suiscan. They are
 * different namespaces, so route by which field carried the id.
 *
 * NOTE (PR4): we currently treat the non-blob id as a Sui *object* (`/object/`).
 * If PR4 surfaces an owner *address* in `accountId` rather than an object id,
 * switch that branch to `/account/` — confirm the id semantics when the live
 * field lands.
 */
function proofUrl(kind: 'blob' | 'object', id: string): string {
  return kind === 'blob'
    ? `${WALRUSCAN_ROOT}/blob/${id}`
    : `${SUISCAN_ROOT}/object/${id}`;
}

/** Shorten a long hex/base64 id to `head…tail` for chip display. */
function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function ZeroGTab({ elder, testIdPrefix }: Props) {
  // ─── Live Convex queries with stub fallback ────────────────────────────
  // Every section follows the same discipline as CommsTab:
  //   - useQuery returns undefined while loading → fallback to stub
  //   - useQuery returns [] (cold backend, no rows) → fallback to stub
  //   - data-source attribute on the section root advertises live vs stub
  // The cockpit must demo cleanly on a cold Convex (free tier exhausted).
  const liveMemory = useQuery(api.memory.getByClan, { clanId: elder.clanId });
  const liveEvents = useQuery(api.memory.getEventsByClan, { clanId: elder.clanId });
  const liveBulletins = useQuery(api.bulletins.getByClan, { clanId: elder.clanId });

  // KV state: prefer live memoryEntries, else stub. Reflection-kind rows (if
  // PR4 ever returns them from this same query) are excluded here so they only
  // appear in the Reflections section below — the two sections stay mutually
  // exclusive regardless of how PR4 routes free-text memories.
  const liveKv = (liveMemory ?? []).filter(
    (m) => readStr(m, 'kind', 'memType') !== 'reflection',
  );
  const memorySource: 'live' | 'stub' = liveKv.length > 0 ? 'live' : 'stub';
  const kvRows: KvRow[] =
    liveKv.length > 0
      ? liveKv.map((m) => ({
          key: m.key,
          value: m.value,
          source: readStr(m, 'source') ?? 'local',
          blobId: readStr(m, 'blobId', 'blob_id'),
          accountId: readStr(m, 'accountId', 'account_id'),
        }))
      : STUB_KV;

  // ─── Walrus Reflections (free-text episodic, memwal_remember) ───────────
  // No live free-text feed exists yet (PR4 owns the dedicated query + the row
  // discriminator). We deliberately do NOT scrape KV rows by value length —
  // that would double-render a long KV value in both the KV table and here.
  // Instead we only surface rows EXPLICITLY tagged as reflections via a `kind`
  // discriminator (`kind === "reflection"`, which PR4 will set). Until such
  // rows exist, fall back to the stub with an explicit "awaiting live data"
  // affordance. We never fabricate on-chain ids.
  const liveReflections: ReflectionRow[] = (liveMemory ?? [])
    .filter((m) => readStr(m, 'kind', 'memType') === 'reflection')
    .map((m) => ({
      tick: readNum(m, 'tick'),
      text: m.value,
      source: readStr(m, 'source') ?? 'local',
      blobId: readStr(m, 'blobId', 'blob_id'),
      accountId: readStr(m, 'accountId', 'account_id'),
    }));
  const reflectionsSource: 'live' | 'stub' =
    liveReflections.length > 0 ? 'live' : 'stub';
  const reflectionRows: ReflectionRow[] =
    liveReflections.length > 0 ? liveReflections : STUB_REFLECTIONS;

  const eventsSource: 'live' | 'stub' =
    liveEvents && liveEvents.length > 0 ? 'live' : 'stub';
  const crudRows: CrudRow[] =
    liveEvents && liveEvents.length > 0
      ? liveEvents.map((e) => ({
          tick: e.tick,
          op: e.op === 'write' ? 'WRITE' : 'READ',
          key: e.key,
          note: e.note,
        }))
      : STUB_CRUD;

  const bulletinsSource: 'live' | 'stub' =
    liveBulletins && liveBulletins.length > 0 ? 'live' : 'stub';
  // Newest slot = "now" anchor for relative ages.
  const currentSlot = liveBulletins && liveBulletins.length > 0
    ? Math.max(...liveBulletins.map((b) => b.slot))
    : 0;
  const bulletinRows: BulletinRow[] =
    liveBulletins && liveBulletins.length > 0
      ? liveBulletins.map((b) => ({
          body: b.body,
          age: bulletinAge(b.slot, currentSlot),
        }))
      : STUB_BULLETINS;

  return (
    <div
      data-testid={`${testIdPrefix}-content-0g`}
      style={{
        flex: 1,
        background: tokens.bg.parchment,
        color: tokens.text.onParchment,
        padding: tokens.space.md,
        overflowY: 'auto',
        fontFamily: tokens.font.body,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.md,
      }}
    >
      {/* NFT metadata */}
      <section>
        <SectionHeader>NFT — Elder #{elder.clanId}</SectionHeader>
        <div
          style={{
            marginTop: tokens.space.sm,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 12px',
            fontFamily: tokens.font.mono,
            fontSize: '10px',
          }}
        >
          <Field k="token_id"     v={`0x${(0xe1de7000 + elder.clanId).toString(16)}`} />
          <Field k="owner"        v="demo-owner" />
          <Field k="archetype"    v={elder.archetype} />
          <Field k="state_root"   v="local-memory" />
          <Field k="version"      v="v0.4.6" />
        </div>
      </section>

      {/* Walrus memory sections side-by-side on wide, stacked on narrow */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        <div data-testid={`${testIdPrefix}-0g-kv`} data-source={memorySource}>
          <SectionHeader>Walrus KV State</SectionHeader>
          <div
            style={{
              marginTop: tokens.space.sm,
              fontFamily: tokens.font.mono,
              fontSize: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            {kvRows.map((kv) => {
              const onWalrus = isWalrus(kv.source);
              const hasProof = Boolean(kv.blobId ?? kv.accountId);
              return (
                <div
                  key={kv.key}
                  data-testid={`${testIdPrefix}-0g-kv-row`}
                  data-source={kv.source}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: tokens.space.sm,
                    padding: '3px 6px',
                    background: 'rgba(255,255,255,0.18)',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      minWidth: 0,
                    }}
                  >
                    <SourceBadge source={kv.source} testId={`${testIdPrefix}-0g-kv-badge`} />
                    <span
                      style={{
                        color: tokens.text.onParchmentDim,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {kv.key}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {onWalrus && hasProof && (
                      <ProofChip
                        blobId={kv.blobId}
                        accountId={kv.accountId}
                        testId={`${testIdPrefix}-0g-kv-proof`}
                      />
                    )}
                    <span style={{ color: elder.accent, fontWeight: 600 }}>{kv.value}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div data-testid={`${testIdPrefix}-0g-crud`} data-source={eventsSource}>
          <SectionHeader>Walrus Memory CRUD</SectionHeader>
          <ul
            style={{
              listStyle: 'none',
              margin: `${tokens.space.sm} 0 0`,
              padding: 0,
              fontFamily: tokens.font.mono,
              fontSize: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            {crudRows.map((c, i) => (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 52px 1fr',
                  gap: '6px',
                  padding: '3px 6px',
                  background: 'rgba(255,255,255,0.18)',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: tokens.text.muted }}>T{c.tick}</span>
                <span
                  style={{
                    fontWeight: 700,
                    color: c.op === 'WRITE' ? '#7a3a1a' : tokens.text.muted,
                  }}
                >
                  {c.op}
                </span>
                <span>
                  <span style={{ color: tokens.text.onParchmentDim }}>{c.key}</span>
                  {c.note && (
                    <span style={{ color: tokens.text.onParchment, marginLeft: '6px' }}>
                      — {c.note}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div
          data-testid={`${testIdPrefix}-0g-reflections`}
          data-source={reflectionsSource}
        >
          <SectionHeader>Walrus Reflections</SectionHeader>
          {reflectionsSource === 'stub' && (
            <div
              data-testid={`${testIdPrefix}-0g-reflections-awaiting`}
              style={{
                marginTop: tokens.space.sm,
                padding: '4px 8px',
                fontFamily: tokens.font.mono,
                fontSize: '9px',
                letterSpacing: '0.04em',
                color: tokens.text.muted,
                background: 'rgba(0,0,0,0.06)',
                border: `1px dashed ${tokens.border.parchmentEdge}`,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ color: tokens.text.accent }}>◌</span>
              awaiting live data — sample reflections shown
            </div>
          )}
          <ul
            style={{
              listStyle: 'none',
              margin: `${tokens.space.sm} 0 0`,
              padding: 0,
              fontFamily: tokens.font.body,
              fontSize: '11px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {reflectionRows.map((r, i) => {
              const onWalrus = isWalrus(r.source);
              const hasProof = Boolean(r.blobId ?? r.accountId);
              return (
                <li
                  key={r.blobId ?? r.accountId ?? `${r.tick ?? 'x'}-${r.text.slice(0, 24)}-${i}`}
                  data-testid={`${testIdPrefix}-0g-reflection-row`}
                  data-source={r.source}
                  style={{
                    padding: '6px 8px',
                    background: onWalrus
                      ? 'rgba(217,119,87,0.10)'
                      : 'rgba(255,255,255,0.18)',
                    borderLeft: `2px solid ${onWalrus ? WALRUS_CORAL : tokens.border.parchmentEdge}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <SourceBadge source={r.source} testId={`${testIdPrefix}-0g-reflection-badge`} />
                    {typeof r.tick === 'number' && (
                      <span
                        style={{
                          fontFamily: tokens.font.mono,
                          fontSize: '9px',
                          color: tokens.text.muted,
                        }}
                      >
                        T{r.tick}
                      </span>
                    )}
                    {onWalrus && hasProof && (
                      <ProofChip
                        blobId={r.blobId}
                        accountId={r.accountId}
                        testId={`${testIdPrefix}-0g-reflection-proof`}
                      />
                    )}
                  </div>
                  <span style={{ color: tokens.text.onParchment, lineHeight: 1.4 }}>
                    {r.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div data-testid={`${testIdPrefix}-0g-bulletins`} data-source={bulletinsSource}>
          <SectionHeader>bulletins</SectionHeader>
          <ul
            style={{
              listStyle: 'none',
              margin: `${tokens.space.sm} 0 0`,
              padding: 0,
              fontFamily: tokens.font.body,
              fontSize: '11px',
              fontStyle: 'italic',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {bulletinRows.map((b, i) => (
              <li
                key={i}
                style={{
                  padding: '6px 8px',
                  background: 'rgba(212,165,68,0.1)',
                  borderLeft: `2px solid ${tokens.text.accent}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: tokens.space.sm,
                }}
              >
                <span>{b.body}</span>
                <span
                  style={{
                    color: tokens.text.muted,
                    fontFamily: tokens.font.mono,
                    fontStyle: 'normal',
                    fontSize: '9px',
                    flexShrink: 0,
                  }}
                >
                  {b.age}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span style={{ color: tokens.text.onParchmentDim }}>{k}</span>
      <span style={{ color: tokens.text.onParchment, fontWeight: 600 }}>{v}</span>
    </>
  );
}

/**
 * Storage-source badge. `"walrus"` rows get a coral "● Walrus" pill signalling
 * encrypted, per-Elder-owned decentralized storage; everything else gets a
 * muted "local" pill.
 */
function SourceBadge({ source, testId }: { source: string; testId?: string }) {
  const onWalrus = isWalrus(source);
  return (
    <span
      data-testid={testId}
      data-source={source}
      title={
        onWalrus
          ? 'Encrypted on Walrus — owned per-Elder on Sui'
          : 'Local scratch memory (not on decentralized storage)'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        flexShrink: 0,
        padding: '1px 6px',
        borderRadius: '999px',
        fontFamily: tokens.font.mono,
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: onWalrus ? WALRUS_CORAL : tokens.text.muted,
        background: onWalrus ? 'rgba(217,119,87,0.14)' : 'rgba(0,0,0,0.06)',
        border: `1px solid ${onWalrus ? 'rgba(217,119,87,0.5)' : tokens.border.parchmentEdge}`,
      }}
    >
      <span aria-hidden style={{ fontSize: '7px', lineHeight: 1 }}>●</span>
      {onWalrus ? 'Walrus' : 'local'}
    </span>
  );
}

/**
 * On-chain-proof chip — renders a short monospace id linking to the right
 * explorer: a Walrus blob id → Walruscan, else a Sui object/account id →
 * Suiscan. Only rendered when a real id is present (never fabricated).
 */
function ProofChip({
  blobId,
  accountId,
  testId,
}: {
  blobId?: string;
  accountId?: string;
  testId?: string;
}) {
  // Prefer the Walrus blob id (the strongest "encrypted on Walrus" proof);
  // fall back to the Sui object/account id.
  const kind: 'blob' | 'object' = blobId ? 'blob' : 'object';
  const id = blobId ?? accountId;
  if (!id) return null;
  return (
    <a
      data-testid={testId}
      data-proof-kind={kind}
      href={proofUrl(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      title={`On-chain proof (${kind === 'blob' ? 'Walrus blob' : 'Sui object'}) — ${id}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        padding: '1px 5px',
        borderRadius: tokens.radius.sm,
        fontFamily: tokens.font.mono,
        fontSize: '8px',
        textDecoration: 'none',
        color: WALRUS_CORAL,
        background: 'rgba(217,119,87,0.08)',
        border: `1px solid rgba(217,119,87,0.35)`,
      }}
    >
      {shortId(id)}
    </a>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontFamily: tokens.font.display,
        fontSize: '11px',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: tokens.text.onParchmentDim,
        borderBottom: `1px solid ${tokens.border.parchmentEdge}`,
        paddingBottom: '4px',
      }}
    >
      {children}
    </h3>
  );
}
