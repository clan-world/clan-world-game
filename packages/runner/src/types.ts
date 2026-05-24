export type ElderN = "elder-1" | "elder-2" | "elder-3" | "elder-4";
export type Health = "green" | "yellow" | "red";
export type PendingMessageSource = "admin-injection" | "user-message";
export type RunnerEventKind =
  | "hook_failure"
  | "convex_outage_recovery"
  | "settings_drift_panic"
  | "invariant_violation"
  | "ready_probe_timeout";
export type ResetReason = "scheduled" | "manual" | "memory_wipe_gap" | "late_join";

export type CommandKind =
  | "user_message"
  | "system_message"
  | "snapshot_request"
  | "reset"
  | "freeze"
  | "unfreeze";

export interface AgentCommand {
  _id: string;
  targetAgentId: string;
  kind: CommandKind;
  payload: unknown;
  source: string;
  createdAt: number;
  status: string;
}

export interface ElderRuntimeConfig {
  elderId: ElderN;
  convexUrl: string;
  busSecret: string;
  stateDir: string;
  ancientWisdomPath: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  noncePollIntervalMs: number;
  nonceTimeoutMs: number;
  runScriptPath: string;
}

export interface RunnerConfig extends ElderRuntimeConfig {
  runnerSecret: string;
  lockPath: string;
  wipeMarkerPath: string;
  readyPath: string;
  promptDir: string;
  elderConfigPath: string;
  workspaceDir: string;
  appendSystemPromptFile: string;
  hookReceiveTimeoutMs: number;
  hookReceivePollMs: number;
  maxPasteAttempts: number;
}

export interface TickClock {
  tick: number;
  blockNumber?: number;
  tickEpochStartedAt: number;
  tickEpochDurationMs: number;
  heartbeatIntervalSeconds?: number;
  currentSeasonNumber?: number;
  seasonStartTick: number;
  seasonEndTick: number;
  winterActive: boolean;
  winterStartsAtTick?: number;
}

export interface GameSettings {
  heartbeatIntervalSeconds: number;
  memoryWipeTickInterval: number;
  winterStartTick: number;
  winterDurationTicks: number;
  winterPeriodTicks: number;
  seasonDurationTicks: number;
  contractAddress: string;
}

export interface PendingMessage {
  _id: string;
  targetElderId: ElderN;
  text: string;
  source: PendingMessageSource;
  insertedAt: number;
  consumedAt?: number;
}

export interface ChainEvent {
  eventName: string;
  tick?: number;
  args: unknown;
  [key: string]: unknown;
}

export interface BanditView {
  exists: boolean;
  id: number;
  state: number;
  stateEnteredTick: number;
  nextActionTick: number;
  [key: string]: unknown;
}

export interface RunnerAuxiliary {
  tickClock: TickClock;
  gameSettings: GameSettings;
  banditView: BanditView | null;
  chainEvents: ChainEvent[];
  pendingMessages: PendingMessage[];
}

export interface RunnerStartupState {
  tickClock: TickClock;
  gameSettings: GameSettings;
  lastReceivedTick: number | null;
  sentForCurrentTick: boolean;
}

export interface ResetMetadata {
  resetTick: number;
  resetReason: ResetReason;
  resetEventId: string;
}

export interface TickSendResult {
  sendLogId: string;
}

export type RestartDecision =
  | { kind: "wait"; caseName: "A" }
  | { kind: "send-current"; caseName: "B" | "C"; resend: boolean }
  | { kind: "reset"; caseName: "D"; reason: "memory_wipe_gap" | "late_join" }
  | { kind: "fast-forward"; caseName: "E"; fromTick: number; toTick: number };

export interface ElderDisplayConfig {
  displayName: string;
  color: string;
  glyph: string;
}
