// The model provider behind xmoney-ai. The handler only knows this interface: adding another
// provider means writing one implementation and naming it in the XMONEY_AI_PROVIDER secret.
export interface ProviderRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
}

export interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Provider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type ProviderFailure = 'rate_limited' | 'timeout' | 'provider_error';

// `retryable`: only 429 and 5xx of the provider are retried (once), never a timeout or a 4xx
export class ProviderError extends Error {
  constructor(
    public kind: ProviderFailure,
    public status = 0,
    public retryable = false
  ) {
    super(kind); // the message never carries provider text: it could echo the request
  }
}
