// Codex round-3 P1 — optimize body validation schema.
//
// Lives outside route.ts because Next 14 Route Handlers only accept
// canonical export symbols. The schema bounds both the FMP and Anthropic
// blast radius:
//   - symbols.length ≤ MAX_SYMBOLS (each entry triggers a /stable
//     historical-prices call)
//   - riskAversion ∈ [0.1, 10] (anything outside produces a nonsense
//     Black-Litterman result anyway)
//   - .strict() rejects unknown fields

import { z } from 'zod';
import { validateEquitySymbol } from '@/lib/sanitize';

export const MAX_SYMBOLS = 20;

export const optimizeRequestSchema = z
  .object({
    symbols: z
      .array(
        z
          .string()
          .min(1)
          .max(8)
          .transform(s => validateEquitySymbol(s) ?? '')
          .refine(s => s.length > 0, 'invalid equity symbol'),
      )
      .max(MAX_SYMBOLS, `symbols cannot exceed ${MAX_SYMBOLS}`)
      .optional(),
    useAIViews: z.boolean().optional(),
    riskAversion: z
      .number()
      .finite()
      .min(0.1, 'riskAversion must be ≥0.1')
      .max(10, 'riskAversion must be ≤10')
      .optional(),
  })
  .strict();

export type OptimizeRequestBody = z.infer<typeof optimizeRequestSchema>;
