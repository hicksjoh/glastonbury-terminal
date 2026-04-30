// P0-4 (hardening/p0-codex-fixes): zod schemas for every order route.
//
// Before: order routes parsed untrusted JSON manually. `parseInt(qty)` would
// silently produce NaN for bad input; symbols weren't sanitized; Alpaca
// rejection bodies leaked verbatim back to the browser.
//
// All three routes (alpaca/orders, options/order, options/order/multi-leg)
// now reject with HTTP 400 + `{ code: 'VALIDATION_ERROR', issues }` when
// input fails any of these schemas.

import { z } from 'zod';

const TIME_IN_FORCE = ['day', 'gtc', 'ioc', 'fok'] as const;
const ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit'] as const;
const SIDES = ['buy', 'sell'] as const;

/**
 * Equity symbol — Alpaca accepts class A/B share notation like BRK.B as well
 * as plain `[A-Z]{1,5}`. Reject anything else (lowercase, digits, slashes).
 */
export const equitySymbolSchema = z
  .string()
  .min(1)
  .max(8)
  .regex(/^[A-Z]+(\.[A-Z])?$/, 'Invalid equity symbol — expected [A-Z]{1,5}(.[A-Z])?');

/**
 * OCC option symbol (21-character format used by Alpaca for legs):
 *   `<root 1-6>` + `<YYMMDD>` + `<C|P>` + `<strike × 1000, 8 digits>`
 * Example: `AAPL  240119C00190000`
 */
export const occSymbolSchema = z
  .string()
  .regex(
    /^[A-Z]{1,6}\d{6}[CP]\d{8}$/,
    'Invalid OCC option symbol — expected ROOT(1-6)YYMMDD[CP]STRIKE(8d)',
  );

/**
 * Either equity or OCC. Used by single-order routes that don't care which.
 */
export const symbolSchema = z.union([equitySymbolSchema, occSymbolSchema]);

const positiveIntQty = z
  .number()
  .int('qty must be an integer')
  .positive('qty must be positive')
  .max(1_000_000, 'qty exceeds 1M cap');

// Coerce string-numeric inputs (the dashboard sends qty as a string from
// <input type="number">) but reject NaN.
const qtySchema = z.preprocess(
  v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  positiveIntQty,
);

const positivePrice = z
  .number()
  .positive('price must be positive')
  .max(1_000_000, 'price exceeds 1M cap');

const priceSchema = z.preprocess(
  v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  positivePrice,
);

/**
 * Equity order schema — used by /api/alpaca/orders and /api/options/order
 * for single-leg submissions.
 *
 * superRefine enforces conditional pricing:
 *   - limit / stop_limit need limit_price
 *   - stop / stop_limit need stop_price
 */
const baseEquityOrderShape = z
  .object({
    symbol: equitySymbolSchema,
    qty: qtySchema,
    side: z.enum(SIDES),
    type: z.enum(ORDER_TYPES),
    time_in_force: z.enum(TIME_IN_FORCE).optional().default('day'),
    limit_price: priceSchema.optional(),
    stop_price: priceSchema.optional(),
  })
  .strict();

export const equityOrderSchema = baseEquityOrderShape.superRefine((order, ctx) => {
  if ((order.type === 'limit' || order.type === 'stop_limit') && order.limit_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['limit_price'],
      message: `limit_price is required for type=${order.type}`,
    });
  }
  if ((order.type === 'stop' || order.type === 'stop_limit') && order.stop_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stop_price'],
      message: `stop_price is required for type=${order.type}`,
    });
  }
});

/**
 * /api/alpaca/orders accepts a couple extra fields used by the pre-trade
 * guard pipeline (`mode: 'preview'` to dry-run guards, `force: true` to
 * override a `block` verdict). The schema must allow them — `.strict()`
 * elsewhere rejects everything else.
 */
export const alpacaOrderRequestSchema = baseEquityOrderShape
  .extend({
    mode: z.enum(['preview', 'live']).optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if ((order.type === 'limit' || order.type === 'stop_limit') && order.limit_price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limit_price'],
        message: `limit_price is required for type=${order.type}`,
      });
    }
    if ((order.type === 'stop' || order.type === 'stop_limit') && order.stop_price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stop_price'],
        message: `stop_price is required for type=${order.type}`,
      });
    }
  });

/**
 * Single-leg options order — same as equity but the symbol is OCC.
 */
const baseOptionsOrderShape = z
  .object({
    symbol: occSymbolSchema,
    qty: qtySchema,
    side: z.enum(SIDES),
    type: z.enum(ORDER_TYPES),
    time_in_force: z.enum(TIME_IN_FORCE).optional().default('day'),
    limit_price: priceSchema.optional(),
    stop_price: priceSchema.optional(),
  })
  .strict();

export const optionsOrderSchema = baseOptionsOrderShape.superRefine((order, ctx) => {
  if ((order.type === 'limit' || order.type === 'stop_limit') && order.limit_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['limit_price'],
      message: `limit_price is required for type=${order.type}`,
    });
  }
  if ((order.type === 'stop' || order.type === 'stop_limit') && order.stop_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stop_price'],
      message: `stop_price is required for type=${order.type}`,
    });
  }
});

/**
 * Some callers may submit either an equity or an option through the
 * /api/options/order route (legacy behavior). Accept both symbol shapes.
 */
export const singleOrderSchema = z.union([equityOrderSchema, optionsOrderSchema]);

/**
 * Option leg for multi-leg orders. position_intent matches Alpaca's
 * `buy_to_open / sell_to_close / etc.` enum.
 */
export const optionLegSchema = z
  .object({
    symbol: occSymbolSchema,
    side: z.enum(SIDES),
    ratio_qty: qtySchema,
    position_intent: z
      .enum(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close'])
      .optional(),
  })
  .strict();

/**
 * Multi-leg order — bounded leg count (Alpaca caps at 4 anyway), bounded
 * total ratio_qty so a malformed payload can't queue 100M-contract legs.
 */
export const multiLegOrderSchema = z
  .object({
    legs: z
      .array(optionLegSchema)
      .min(2, 'multi-leg orders require ≥2 legs')
      .max(4, 'multi-leg orders are capped at 4 legs (Alpaca limit)'),
    type: z.enum(['market', 'limit']).optional().default('limit'),
    time_in_force: z.enum(TIME_IN_FORCE).optional().default('day'),
    limit_price: priceSchema.optional(),
  })
  .strict()
  .superRefine((order, ctx) => {
    if (order.type === 'limit' && order.limit_price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limit_price'],
        message: 'limit_price is required for type=limit',
      });
    }
    const totalQty = order.legs.reduce((sum, l) => sum + l.ratio_qty, 0);
    if (totalQty > 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['legs'],
        message: `total ratio_qty=${totalQty} exceeds 10K cap`,
      });
    }
  });

export type EquityOrder = z.infer<typeof equityOrderSchema>;
export type AlpacaOrderRequest = z.infer<typeof alpacaOrderRequestSchema>;
export type OptionsOrder = z.infer<typeof optionsOrderSchema>;
export type SingleOrder = z.infer<typeof singleOrderSchema>;
export type OptionLeg = z.infer<typeof optionLegSchema>;
export type MultiLegOrder = z.infer<typeof multiLegOrderSchema>;
