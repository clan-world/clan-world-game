import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRecentChainEvents, useSnapshot } from '@/hooks/useSnapshot';
import { tokens } from '@/theme/tokens';

const SEASON_LEN = 200;

export default function Hearth() {
  const snapshot = useSnapshot();
  const events = useRecentChainEvents();

  const isLoading = snapshot === undefined;
  const tick = snapshot?.tick ?? 0;
  const seasonStart = snapshot?.seasonStartTick ?? null;
  const seasonEnd = snapshot?.seasonEndTick ?? null;
  // Season number is 1-indexed off the season start tick. The Convex query
  // doesn't expose it directly — same derivation the cockpit's TopHud uses.
  const season =
    seasonStart !== null ? Math.floor(seasonStart / SEASON_LEN) + 1 : null;
  const seasonProgress =
    seasonStart !== null && seasonEnd !== null && seasonEnd > seasonStart
      ? Math.max(0, Math.min(1, (tick - seasonStart) / (seasonEnd - seasonStart)))
      : 0;
  const ticksUntilSeasonEnd =
    seasonEnd !== null ? Math.max(0, seasonEnd - tick) : null;
  const winterActive = snapshot?.winterActive === true;

  const lastEvent = events?.[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.space.lg,
          gap: tokens.space.lg,
        }}
      >
        <SectionLabel>The Realm</SectionLabel>

        <ParchmentPanel>
          <Row>
            <FieldLabel>Tick</FieldLabel>
            <FieldValueMono>
              {isLoading ? '—' : String(tick)}
            </FieldValueMono>
          </Row>
          <Hairline />
          <Row>
            <FieldLabel>Season</FieldLabel>
            <FieldValueMono>
              {isLoading || season === null ? '—' : `S${season}`}
            </FieldValueMono>
          </Row>
          <Hairline />
          <Row>
            <FieldLabel>Until next season</FieldLabel>
            <FieldValueMono>
              {ticksUntilSeasonEnd === null
                ? '—'
                : `${ticksUntilSeasonEnd} ticks`}
            </FieldValueMono>
          </Row>

          <View style={{ height: tokens.space.md }} />

          <ProgressBar progress={seasonProgress} />

          {winterActive ? (
            <View style={{ marginTop: tokens.space.sm }}>
              <Text
                style={{
                  fontFamily: tokens.font.bodyMedium,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: tokens.text.danger,
                }}
              >
                Winter is upon us
              </Text>
            </View>
          ) : null}
        </ParchmentPanel>

        <SectionLabel>Last event</SectionLabel>

        <ParchmentPanel>
          {events === undefined ? (
            <Text
              style={{
                fontFamily: tokens.font.body,
                color: tokens.text.onParchmentDim,
                fontSize: 12,
              }}
            >
              Listening for chain events…
            </Text>
          ) : !lastEvent ? (
            <Text
              style={{
                fontFamily: tokens.font.body,
                color: tokens.text.onParchmentDim,
                fontSize: 12,
              }}
            >
              No events yet on this deployment.
            </Text>
          ) : (
            <View style={{ gap: tokens.space.xs }}>
              <Text
                style={{
                  fontFamily: tokens.font.displayBold,
                  fontSize: 13,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: tokens.text.onParchment,
                }}
              >
                {String(lastEvent.eventName)}
              </Text>
              <Text
                style={{
                  fontFamily: tokens.font.mono,
                  fontSize: 10,
                  color: tokens.text.onParchmentDim,
                }}
              >
                tick {lastEvent.tick ?? '—'} · block {lastEvent.blockNumber}
              </Text>
              <Text
                style={{
                  fontFamily: tokens.font.mono,
                  fontSize: 10,
                  color: tokens.text.muted,
                }}
                numberOfLines={1}
              >
                {String(lastEvent.txHash).slice(0, 14)}…
              </Text>
            </View>
          )}
        </ParchmentPanel>

        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: tokens.text.onIronDim,
            textAlign: 'center',
            letterSpacing: 1,
            marginTop: tokens.space.md,
          }}
        >
          {SEASON_LEN}-TICK SEASONS · LIVE FROM CONVEX
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: tokens.font.display,
        fontSize: 11,
        color: tokens.text.onIronDim,
        letterSpacing: 2,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

function ParchmentPanel({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: tokens.bg.parchment,
        borderColor: tokens.border.iron,
        borderWidth: 1,
        borderRadius: tokens.radius.md,
        padding: tokens.space.lg,
        gap: tokens.space.sm,
        ...tokens.shadow.panel,
      }}
    >
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      {children}
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: tokens.font.body,
        fontSize: 13,
        color: tokens.text.onParchmentDim,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

function FieldValueMono({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: tokens.font.monoBold,
        fontSize: 18,
        color: tokens.text.onParchment,
        letterSpacing: 1,
      }}
    >
      {children}
    </Text>
  );
}

function Hairline() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: tokens.border.parchmentEdge,
        opacity: 0.5,
      }}
    />
  );
}

function ProgressBar({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View
      style={{
        height: 4,
        backgroundColor: tokens.bg.parchmentDim,
        borderRadius: tokens.radius.sm,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: tokens.text.accent,
        }}
      />
    </View>
  );
}
