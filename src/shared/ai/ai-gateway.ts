// The gateway to the AI function (2.16.0). No module calls the network: everything goes through
// AiService, which goes through this interface. Changing the provider or the model is a change on
// the server (secrets of xmoney-ai), never here. Uses the same client and session as the sync
// (plain fetch, no supabase-js, no key).
import { ApiError, XMoneyApiClient } from '../data-layer/api-client';
import { AiServerCode, AiServerUsage, AiWireRequest } from './ai.types';

export type GatewayFailure = AiServerCode | 'no-session' | 'offline';

export type GatewayResult =
  | { ok: true; output: string; usage: { inputTokens: number; outputTokens: number }; model: string; requestId: string }
  | { ok: false; code: GatewayFailure };

export type GatewayUsage = { ok: true; usage: AiServerUsage } | { ok: false; code: GatewayFailure };

export interface AiGateway {
  run(request: AiWireRequest): Promise<GatewayResult>;
  usage(): Promise<GatewayUsage>;
}

// What the screens can say about each failure is decided by the code; the server text is never shown
export function failureOf(error: unknown): GatewayFailure {
  if (!(error instanceof ApiError)) return 'provider_error';
  if (error.status === 0) return 'offline';
  if (error.code === 'session_expired' || error.status === 401) return 'no-session';
  if (error.status === 403) return 'unauthorized'; // the account has no AI enabled
  if (error.code === 'quota') return 'quota';
  if (error.code === 'rate_limited' || error.status === 429) return 'rate_limited';
  if (error.code === 'timeout' || error.status === 504) return 'timeout';
  if (error.status === 400 || error.status === 413) return 'bad_request';
  return 'provider_error';
}

export class XMoneyAiGateway implements AiGateway {
  constructor(
    private client: Pick<XMoneyApiClient, 'call'>,
    private baseUrl: string
  ) {}

  async run(request: AiWireRequest): Promise<GatewayResult> {
    try {
      // never retried by the client: a repeated request would cost twice
      const r = await this.client.call<{ ok: true; output: string; usage: { inputTokens: number; outputTokens: number }; model: string; requestId: string }>('run', request, { base: this.baseUrl });
      return { ok: true, output: String(r.output ?? ''), usage: { inputTokens: Number(r.usage?.inputTokens ?? 0), outputTokens: Number(r.usage?.outputTokens ?? 0) }, model: String(r.model ?? ''), requestId: String(r.requestId ?? request.requestId) };
    } catch (error) {
      return { ok: false, code: failureOf(error) };
    }
  }

  async usage(): Promise<GatewayUsage> {
    try {
      const r = await this.client.call<{ ok: true } & AiServerUsage>('usage', {}, { base: this.baseUrl });
      return { ok: true, usage: { requests: Number(r.requests), tokens: Number(r.tokens), requestCap: Number(r.requestCap), tokenCap: Number(r.tokenCap), month: String(r.month) } };
    } catch (error) {
      return { ok: false, code: failureOf(error) };
    }
  }
}
