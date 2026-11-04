// Estimated cost per model, in USD per million tokens. Verify every figure against the official
// pricing page of the provider before filling the table: NO price is invented here. A model that
// is not in the table costs `null` (the usage log then keeps only the tokens).
export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
}

// Keys are the model identifiers of the secrets XMONEY_MODEL_FAST / XMONEY_MODEL_SMART.
export const PRICES: Readonly<Record<string, Price>> = {};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, prices: Readonly<Record<string, Price>> = PRICES): number | null {
  const p = prices[model];
  if (!p || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  const usd = (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
