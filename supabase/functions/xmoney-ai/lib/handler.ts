// xmoney-ai: the contract of the AI function. Pure logic (no Deno imports); the provider, the
// store and the authenticator are injected, so tests run without a network or a database.
//
//   run   { feature, input, locale, requestId }  ->  { ok: true, output, usage, model, requestId }
//   usage {}                                     ->  { ok: true, requests, tokens, requestCap, tokenCap, month }
//   failures: { ok: false, code: 'unauthorized' | 'quota' | 'rate_limited' | 'timeout' | 'provider_error' | 'bad_request', message }
import { COMMON_RULES, featureOf, type FeatureDef, type Locale } from './features.ts';
import { MAX_REQUEST_ID_CHARS, RATE_PER_MINUTE, RATE_WINDOW_MS, REQUEST_TIMEOUT_MS, checkQuota, dayStartUtc, effectiveCaps, monthKey, monthStartUtc } from './limits.ts';
import { estimateCostUsd } from './pricing.ts';
import type { AiPrincipal } from './authn.ts';
import { ProviderError, type Provider, type ProviderRequest } from './provider.ts';

type ProviderAttachment = NonNullable<ProviderRequest['attachment']>;
import type { AiStore, UsageStatus } from './store.ts';

export type AiCode = 'unauthorized' | 'quota' | 'rate_limited' | 'timeout' | 'provider_error' | 'bad_request' | 'daily_limit' | 'invalid_output';

export interface AiRequest {
  action: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

export interface AiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface AiDeps {
  authenticate: (authorization: string | null) => Promise<AiPrincipal | null>;
  store: AiStore;
  provider: Provider | null;
  models: { fast: string | null; smart: string | null };
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  features?: Readonly<Record<string, FeatureDef>>;
  // estimated USD per month that stops the capture features (only counts calls whose price is known)
  costCapUsd?: number;
}

const MESSAGES: Record<AiCode, string> = {
  unauthorized: 'Sign in again or ask for AI to be enabled for this account.',
  quota: 'The monthly AI limit was reached.',
  rate_limited: 'Too many AI requests, try again in a minute.',
  timeout: 'The AI service took too long.',
  provider_error: 'The AI service is not available right now.',
  bad_request: 'The request is not valid.',
  daily_limit: 'The daily limit of captures was reached.',
  invalid_output: 'The document could not be read in the expected shape.',
};

const STATUS: Record<AiCode, number> = { unauthorized: 401, quota: 429, rate_limited: 429, timeout: 504, provider_error: 502, bad_request: 400, daily_limit: 429, invalid_output: 502 };

const fail = (code: AiCode, status = STATUS[code]): AiResponse => ({ status, body: { ok: false, code, message: MESSAGES[code] } });

export function createAi(deps: AiDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function attempt(provider: Provider, req: { model: string; system: string; user: string; maxTokens: number; attachment?: ProviderAttachment }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await provider.complete({ ...req, signal: controller.signal });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(controller.signal.aborted ? 'timeout' : 'provider_error');
    } finally {
      clearTimeout(timer);
    }
  }

  async function usage(principal: AiPrincipal): Promise<AiResponse> {
    const now = deps.now();
    const used = await deps.store.usageSince(principal.accountId, monthStartUtc(now));
    const caps = effectiveCaps(principal);
    return { status: 200, body: { ok: true, requests: used.requests, tokens: used.tokens, requestCap: caps.requests, tokenCap: caps.tokens, month: monthKey(now) } };
  }

  async function run(principal: AiPrincipal, body: Record<string, unknown>): Promise<AiResponse> {
    const feature = featureOf(body['feature'], deps.features);
    const locale = body['locale'];
    const requestId = body['requestId'];
    if (!feature || (locale !== 'es' && locale !== 'en') || typeof requestId !== 'string' || !requestId || requestId.length > MAX_REQUEST_ID_CHARS) return fail('bad_request');
    const input = body['input'];
    if (JSON.stringify(input ?? null).length > feature.maxInputChars || feature.checkInput(input) !== null) return fail('bad_request');

    const now = deps.now();
    if ((await deps.store.hit(`ai:${principal.accountId}`, now, RATE_WINDOW_MS)).count > RATE_PER_MINUTE) return fail('rate_limited');
    const used = await deps.store.usageSince(principal.accountId, monthStartUtc(now));
    if (checkQuota(used, effectiveCaps(principal))) return fail('quota');

    if (feature.dailyCap && (await deps.store.featureCountSince(principal.accountId, feature.id, dayStartUtc(now))) >= feature.dailyCap) return fail('daily_limit');
    // the cost cap only counts calls whose price is known (see pricing.ts): with no prices it never trips
    const costCap = deps.costCapUsd ?? feature.monthlyCostCapUsd;
    if (feature.monthlyCostCapUsd && costCap && (await deps.store.costSince(principal.accountId, monthStartUtc(now))) >= costCap) return fail('quota');

    const model = feature.tier === 'fast' ? deps.models.fast : deps.models.smart;
    if (!deps.provider || !model) return fail('provider_error', 500); // secrets missing: an operator problem, not the user's

    const system = `${feature.instructions(locale as Locale)}

${COMMON_RULES[locale as Locale]}`;
    const request = { model, system, user: feature.toPrompt(input), maxTokens: feature.maxOutputTokens, attachment: feature.toAttachment?.(input) ?? undefined };
    const started = deps.now();
    let failure: ProviderError | null = null;
    let answer: { text: string; inputTokens: number; outputTokens: number } | null = null;
    let badShape = false;
    let inputTokens = 0;
    let outputTokens = 0;
    for (let tries = 0; tries < 2 && !answer; tries++) {
      try {
        const got = await attempt(deps.provider, request);
        inputTokens += got.inputTokens;
        outputTokens += got.outputTokens;
        const text = feature.finalize ? feature.finalize(got.text) : got.text;
        if (text === null) {
          badShape = true; // one retry for a format mistake, never a blind loop
          failure = null;
          continue;
        }
        badShape = false;
        answer = { ...got, text };
      } catch (error) {
        failure = error as ProviderError;
        badShape = false;
        if (!failure.retryable || tries === 1) break;
        await sleep(200 + Math.floor(random() * 400)); // one retry, with random delay, only for 429 / 5xx
      }
    }
    const latencyMs = Math.max(0, deps.now() - started);
    const status: UsageStatus = answer ? 'ok' : failure?.kind === 'timeout' ? 'timeout' : failure?.kind === 'rate_limited' ? 'rate_limited' : 'provider_error';
    // the log keeps counts and tokens only: never what was asked or answered, never the document
    await deps.store.record({ accountId: principal.accountId, feature: feature.id, model, inputTokens, outputTokens, estCostUsd: estimateCostUsd(model, inputTokens, outputTokens), status, latencyMs }, deps.now());

    if (answer) return { status: 200, body: { ok: true, output: answer.text.trim(), usage: { inputTokens, outputTokens }, model, requestId } };
    if (badShape) return fail('invalid_output');
    return fail(failure?.kind === 'timeout' ? 'timeout' : failure?.kind === 'rate_limited' ? 'rate_limited' : 'provider_error');
  }

  return {
    async handle(req: AiRequest): Promise<AiResponse> {
      const principal = await deps.authenticate(req.authorization);
      if (!principal || !principal.aiEnabled) return fail('unauthorized', principal ? 403 : 401);
      if (req.action === 'usage') return usage(principal);
      if (req.action === 'run') return run(principal, req.body);
      return { status: 404, body: { ok: false, code: 'bad_request', message: MESSAGES.bad_request } };
    },
  };
}
