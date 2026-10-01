/**
 * Consumo de tokens y costo estimado de las llamadas a la API de Anthropic.
 *
 * Precios en US$ por millón de tokens, tomados de la tabla oficial
 * (https://platform.claude.com/docs/en/about-claude/pricing, consultada el 2026-09-25).
 * Son una ESTIMACIÓN: el valor facturado es el de la consola de Anthropic. Si cambian los
 * precios, se actualiza esta tabla o se pisan con variables de entorno (ver resolvePricing).
 */
export const PRICING_USD_PER_MTOK = {
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
};
export const PRICING_SOURCE_DATE = '2026-09-25';

export function emptyUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

/** Normaliza el campo `usage` de una respuesta de messages.create (puede faltar). */
export function usageFromResponse(response) {
  const u = response?.usage ?? {};
  return {
    calls: 1,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0
  };
}

export function addUsage(a, b) {
  const base = a ?? emptyUsage();
  const extra = b ?? emptyUsage();
  return {
    calls: base.calls + extra.calls,
    inputTokens: base.inputTokens + extra.inputTokens,
    outputTokens: base.outputTokens + extra.outputTokens,
    cacheWriteTokens: base.cacheWriteTokens + extra.cacheWriteTokens,
    cacheReadTokens: base.cacheReadTokens + extra.cacheReadTokens
  };
}

export function totalTokens(usage) {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
}

/**
 * Precio del modelo. Acepta ids con sufijo de fecha (claude-sonnet-5-20260101) y permite
 * pisarlo con AI_PRICE_INPUT / AI_PRICE_OUTPUT / AI_PRICE_CACHE_WRITE / AI_PRICE_CACHE_READ.
 */
export function resolvePricing(model, env = {}) {
  const key = Object.keys(PRICING_USD_PER_MTOK)
    .sort((x, y) => y.length - x.length)
    .find((k) => String(model ?? '').startsWith(k));
  const base = key ? PRICING_USD_PER_MTOK[key] : null;
  const override = (name, fallback) => (env[name] !== undefined && env[name] !== '' ? Number(env[name]) : fallback);
  if (!base && env.AI_PRICE_INPUT === undefined) return null;
  return {
    input: override('AI_PRICE_INPUT', base?.input ?? 0),
    output: override('AI_PRICE_OUTPUT', base?.output ?? 0),
    cacheWrite: override('AI_PRICE_CACHE_WRITE', base?.cacheWrite ?? 0),
    cacheRead: override('AI_PRICE_CACHE_READ', base?.cacheRead ?? 0)
  };
}

/** Costo estimado en US$ (null si no hay precio conocido para el modelo). */
export function estimateCostUsd(usage, pricing) {
  if (!pricing) return null;
  return (
    usage.inputTokens * pricing.input +
    usage.outputTokens * pricing.output +
    usage.cacheWriteTokens * pricing.cacheWrite +
    usage.cacheReadTokens * pricing.cacheRead
  ) / 1_000_000;
}
