import { tokens } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';
import { useSafeQuery as useQuery } from '../../../hooks/useSafeQuery';
import { api } from '../../../../../server/convex/_generated/api';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

interface KvRow {
  key: string;
  value: string;
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
  { key: 'last_grudge',     value: 'clan-3'             },
  { key: 'wood_threshold',  value: '80'                 },
  { key: 'pref_target',     value: 'forest'             },
  { key: 'mood',            value: 'cautious'           },
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

  // KV state: prefer live memoryEntries, else stub.
  const memorySource: 'live' | 'stub' =
    liveMemory && liveMemory.length > 0
        ? 'live'
        : 'stub';
  const kvRows: KvRow[] =
    (liveMemory && liveMemory.length > 0
      ? liveMemory.map((m) => ({ key: m.key, value: m.value }))
      : STUB_KV);

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
            {kvRows.map((kv) => (
              <div
                key={kv.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '3px 6px',
                  background: 'rgba(255,255,255,0.18)',
                }}
              >
                <span style={{ color: tokens.text.onParchmentDim }}>{kv.key}</span>
                <span style={{ color: elder.accent, fontWeight: 600 }}>{kv.value}</span>
              </div>
            ))}
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
