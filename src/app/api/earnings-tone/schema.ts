// Codex round-3 P1 — earnings-tone query validation schema.
//
// Lives in its own file (rather than at the top of route.ts) because
// Next 14's App Router validates that Route Handler modules export ONLY
// the canonical handler symbols (GET, POST, runtime, dynamic, etc.).
// Exporting a Zod schema from route.ts breaks the build.

import { z } from 'zod';
import { validateEquitySymbol } from '@/lib/sanitize';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Quarter: 1-4 (FMP only publishes 4 per year; out-of-range is a 404).
 * Year:    1990 → current+1 (transcripts older than ~30 years don't exist
 *          on FMP; "current+1" lets you query a freshly-reported Q1 in
 *          advance of FMP's metadata index catching up).
 * Symbol:  validateEquitySymbol — strict shape, no path-traversal/inject
 *          attempts survive.
 *
 * `coerce` lets the query-string parser send strings; Zod normalises them.
 */
export const earningsToneQuerySchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(8)
    .transform(s => validateEquitySymbol(s) ?? '')
    .refine(s => s.length > 0, 'invalid equity symbol'),
  quarter: z.coerce.number().int().min(1).max(4),
  year: z.coerce.number().int().min(1990).max(CURRENT_YEAR + 1),
});

export type EarningsToneQuery = z.infer<typeof earningsToneQuerySchema>;
