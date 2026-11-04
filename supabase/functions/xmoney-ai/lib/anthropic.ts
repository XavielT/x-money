// Anthropic implementation of Provider (Messages API over plain fetch). The API key is read by the
// caller from a function secret and is never logged or put into an error.
import { ProviderError, type Provider, type ProviderRequest, type ProviderResponse } from './provider.ts';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export function createAnthropicProvider(apiKey: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Provider {
  return {
    name: 'anthropic',
    async complete(req: ProviderRequest): Promise<ProviderResponse> {
      let res: Response;
      try {
        res = await fetchFn(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
          body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }] }),
          signal: req.signal,
        });
      } catch (error) {
        if (req.signal.aborted || (error as { name?: string })?.name === 'AbortError') throw new ProviderError('timeout');
        throw new ProviderError('provider_error', 0, true); // network failure: retryable once
      }
      if (res.status === 429) throw new ProviderError('rate_limited', 429, true);
      if (res.status >= 500) throw new ProviderError('provider_error', res.status, true);
      if (!res.ok) throw new ProviderError('provider_error', res.status, false); // 4xx: our request or our key, retrying will not help
      let data: { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      try {
        data = await res.json();
      } catch {
        throw new ProviderError('provider_error', res.status, false);
      }
      const text = (data.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      return { text, inputTokens: Number(data.usage?.input_tokens ?? 0), outputTokens: Number(data.usage?.output_tokens ?? 0) };
    },
  };
}
