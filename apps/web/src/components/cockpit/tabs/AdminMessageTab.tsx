import { useMemo, useState } from 'react';
import { tokens } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

type TargetElderId = 'elder-1' | 'elder-2' | 'elder-3' | 'elder-4' | 'all';
type Source = 'admin-injection' | 'user-message';

type ApiSlug = {
  targetElderId: string;
  pendingMessageId: string;
  slug: string;
};

type ApiError = {
  targetElderId?: string;
  message: string;
};

type ApiResponse =
  | { pendingMessageId: string; slug: string; error?: never }
  | { slugs: ApiSlug[]; errors?: ApiError[]; error?: never }
  | { error: { code?: string; message: string } };

const MAX_CHARS = 2000;

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken: () => Promise<string | null>;
      } | null;
    };
  }
}

async function getClerkToken(): Promise<string | null> {
  return await (window.Clerk?.session?.getToken() ?? Promise.resolve(null));
}

function defaultTarget(elder: ElderDef): TargetElderId {
  return `elder-${elder.clanId}` as TargetElderId;
}

export function AdminMessageTab({ elder, testIdPrefix }: Props) {
  const [targetElderId, setTargetElderId] = useState<TargetElderId>(() => defaultTarget(elder));
  const [source, setSource] = useState<Source>('admin-injection');
  const [text, setText] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<ApiSlug[]>([]);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_CHARS - text.length;
  const canSubmit = text.trim().length > 0 && remaining >= 0 && !isSubmitting;

  const targetOptions = useMemo(
    () => [
      { value: 'elder-1', label: 'Elder 1' },
      { value: 'elder-2', label: 'Elder 2' },
      { value: 'elder-3', label: 'Elder 3' },
      { value: 'elder-4', label: 'Elder 4' },
      { value: 'all', label: 'All elders' },
    ],
    [elder],
  );

  async function submit() {
    setSubmitting(true);
    setError(null);
    setSuccess([]);
    try {
      const token = await getClerkToken();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;

      const res = await fetch('/api/admin/inject-message', {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetElderId, text, source }),
      });
      const json = (await res.json()) as ApiResponse;

      if ('error' in json && json.error) {
        throw new Error(json.error.message);
      }
      if ('pendingMessageId' in json) {
        setSuccess([{ targetElderId, pendingMessageId: json.pendingMessageId, slug: json.slug }]);
      } else {
        setSuccess(json.slugs);
        if (json.errors?.length) {
          setError(json.errors.map((e) => `${e.targetElderId ?? 'unknown'}: ${e.message}`).join('; '));
        }
      }
      if (!res.ok && !('slugs' in json)) {
        throw new Error(`Request failed with ${res.status}`);
      }
      if (!('errors' in json) || !json.errors?.length) {
        setText('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid={`${testIdPrefix}-content-admin`}
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
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: tokens.space.md,
          borderBottom: `1px solid ${tokens.border.parchmentEdge}`,
          paddingBottom: '4px',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: tokens.font.display,
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: tokens.text.onParchmentDim,
          }}
        >
          Admin — Elder {elder.clanId}
        </h3>
        <span style={{ fontFamily: tokens.font.mono, fontSize: '10px', color: remaining < 0 ? '#9c2f2f' : tokens.text.onParchmentDim }}>
          {text.length}/{MAX_CHARS}
        </span>
      </div>

      <label style={labelStyle}>
        Target
        <select
          data-testid={`${testIdPrefix}-admin-target`}
          value={targetElderId}
          onChange={(event) => setTargetElderId(event.currentTarget.value as TargetElderId)}
          style={controlStyle}
        >
          {targetOptions.map((option, index) => (
            <option key={`${option.value}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Source
        <select
          data-testid={`${testIdPrefix}-admin-source`}
          value={source}
          onChange={(event) => setSource(event.currentTarget.value as Source)}
          style={controlStyle}
        >
          <option value="admin-injection">admin-injection</option>
          <option value="user-message">user-message</option>
        </select>
      </label>

      <label style={{ ...labelStyle, flex: 1, minHeight: '140px' }}>
        Message
        <textarea
          data-testid={`${testIdPrefix}-admin-text`}
          value={text}
          maxLength={MAX_CHARS + 1}
          onChange={(event) => setText(event.currentTarget.value)}
          style={{
            ...controlStyle,
            flex: 1,
            minHeight: '110px',
            resize: 'vertical',
            lineHeight: 1.35,
          }}
        />
      </label>

      {success.length > 0 && (
        <div data-testid={`${testIdPrefix}-admin-success`} style={successStyle}>
          {success.map((item) => (
            <div key={`${item.targetElderId}-${item.pendingMessageId}`}>
              Injected {item.targetElderId} as <code>{item.slug}</code>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div data-testid={`${testIdPrefix}-admin-error`} style={errorStyle}>
          {error}
        </div>
      )}

      <button
        type="button"
        data-testid={`${testIdPrefix}-admin-submit`}
        disabled={!canSubmit}
        onClick={() => void submit()}
        style={{
          alignSelf: 'flex-start',
          border: `1px solid ${tokens.border.iron}`,
          borderRadius: tokens.radius.sm,
          background: canSubmit ? tokens.text.accent : 'rgba(60,45,28,0.18)',
          color: canSubmit ? tokens.bg.ink : tokens.text.onParchmentDim,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily: tokens.font.mono,
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          padding: '8px 12px',
          textTransform: 'uppercase',
        }}
      >
        {isSubmitting ? 'Injecting' : 'Inject'}
      </button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  color: tokens.text.onParchmentDim,
  fontFamily: tokens.font.display,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

const controlStyle: React.CSSProperties = {
  border: `1px solid ${tokens.border.parchmentEdge}`,
  borderRadius: tokens.radius.sm,
  background: 'rgba(255,255,255,0.45)',
  color: tokens.text.onParchment,
  fontFamily: tokens.font.body,
  fontSize: '13px',
  padding: '8px 9px',
  width: '100%',
};

const successStyle: React.CSSProperties = {
  border: '1px solid rgba(88,126,72,0.45)',
  borderRadius: tokens.radius.sm,
  background: 'rgba(88,126,72,0.12)',
  color: '#355528',
  fontFamily: tokens.font.mono,
  fontSize: '11px',
  lineHeight: 1.5,
  padding: '8px',
};

const errorStyle: React.CSSProperties = {
  border: '1px solid rgba(156,47,47,0.45)',
  borderRadius: tokens.radius.sm,
  background: 'rgba(156,47,47,0.12)',
  color: '#7a2525',
  fontFamily: tokens.font.mono,
  fontSize: '11px',
  lineHeight: 1.5,
  padding: '8px',
};
