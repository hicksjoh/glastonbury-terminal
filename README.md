# Glastonbury Terminal

Private wealth command center for The Glastonbury Group — built on Next.js 14.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.local.example .env.local
# Edit .env.local with your actual keys

# 3. Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Default access code: `glastonbury2026`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Keisha AI |
| `ALPACA_API_KEY` | Optional | Alpaca paper trading API key |
| `ALPACA_SECRET_KEY` | Optional | Alpaca paper trading secret key |
| `ALPACA_BASE_URL` | Optional | Defaults to paper trading URL |
| `APP_PASSWORD` | Optional | Login password (default: glastonbury2026) |
| `NEXT_PUBLIC_APP_URL` | Optional | Public URL for the app |

## Pages

- `/` — Dashboard: net worth, AI briefing, income chart, roadmap
- `/strategies` — Automated strategies with kill switch
- `/monte-carlo` — Interactive $50M probability modeler
- `/keisha` — AI wealth strategist chat
- `/trading` — Paper trading interface with order form

## Deploy to Vercel

1. Push this repo to GitHub
2. Import to [vercel.com](https://vercel.com)
3. Add all environment variables in the Vercel dashboard
4. Deploy — Vercel auto-detects Next.js

## Database Setup

Run `supabase/schema.sql` in your Supabase SQL editor to create all tables and seed roadmap data.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Recharts
- Supabase
- Anthropic SDK (Claude Sonnet)
- Alpaca Paper Trading API
- date-fns, lucide-react
