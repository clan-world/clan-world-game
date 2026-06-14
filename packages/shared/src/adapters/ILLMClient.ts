// ILLMClient — abstraction over Elder reasoning backends.
//   - StubLLMClient   — local no-network stub for dev/testing
//   - AnthropicClient — direct Claude API (Wave 1+ narrator/utility uses)
//
// Note (per ~/claudes-world policy): Submission 1's Elders run as Claude Code sessions
// spawned by the orchestrator and reason via the Claude OAuth session, not via API
// keys. AnthropicClient here is for non-Elder LLM uses (e.g., the post-tick narrator).
import { readEnv } from './_env';

export interface ILLMClient {
  complete(prompt: string): Promise<string>;
}

class StubLLMClient implements ILLMClient {
  async complete(_prompt: string): Promise<string> {
    return '[stub LLM response]';
  }
}

class AnthropicClient implements ILLMClient {
  async complete(_prompt: string): Promise<string> {
    throw new Error('AnthropicClient: not implemented (Wave 1+)');
  }
}

export function createLLMClient(): ILLMClient {
  if (readEnv('CLAN_WORLD_USE_STUB_LLM') === 'true') return new StubLLMClient();
  return new AnthropicClient();
}
