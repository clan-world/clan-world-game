export type ElderN = "elder-1" | "elder-2" | "elder-3" | "elder-4";
export type Health = "green" | "yellow" | "red";
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
