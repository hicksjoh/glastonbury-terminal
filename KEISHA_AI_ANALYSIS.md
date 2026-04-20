# Keisha AI Codebase Analysis
**Date:** April 6, 2026  
**Purpose:** Complete technical understanding of the Keisha AI architecture for Claude Code prompt generation

---

## Executive Summary

Keisha AI is a **multi-persona wealth strategist chatbot** built on Next.js + React with Anthropic Claude backend. It features 6 specialized domains (general, CFO, tax, quant, wealth, strategy) with intelligent context pruning, portfolio integration, and advanced trading capabilities. The architecture is modular, extensible, and designed for real-time market data integration.

**Key Stats:**
- **Main Page**: 1,771 lines (TypeScript + React)
- **Context Module**: 995 lines (comprehensive portfolio context builder)
- **Tools Module**: 1,267 lines (native tool definitions + trade detection)
- **Components**: 8 card-based visualization components
- **Domains**: 6 distinct personas with custom prompts/colors

---

## Architecture Overview

### Core Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5
- **UI**: React 18 + Tailwind CSS
- **API Client**: Anthropic SDK v0.24.0
- **State**: React hooks (useState, useCallback, useRef, useMemo)
- **Database**: Supabase (PostgreSQL)
- **Brokerage**: Alpaca Markets API
- **Market Data**: Yahoo Finance, Financial Modeling Prep, Alpaca
- **Features**: Voice I/O, TTS, Image upload, Slash commands, Trade modals

### File Structure
```
src/
├── app/
│   ├── keisha/
│   │   └── page.tsx          [1,771 lines] Main chat interface
│   ├── api/
│   │   ├── keisha/           Chat/conversation APIs
│   │   ├── sentiment          Stock sentiment
│   │   ├── insider            Insider trading signals
│   │   ├── gex                Gamma Exposure analysis
│   │   ├── macro              Macro regime detection
│   │   ├── drift              Drift regime scanner
│   │   ├── options/positions  Options portfolio
│   │   ├── trade-guard        Risk validation
│   │   ├── agent-crew         Multi-agent consensus
│   │   └── autopilot          Trade execution
│   └── layout.tsx, providers.tsx
├── lib/
│   ├── keisha-context.ts     [995 lines] Context builder + data fetchers
│   ├── keisha-tools.ts       [1,267 lines] Tool definitions + trade detection
│   ├── gex-engine.ts         GEX analysis
│   ├── trade-guard-engine.ts Risk validation logic
│   ├── claude.ts             Anthropic SDK wrapper
│   ├── alpaca.ts             Brokerage API
│   ├── supabase.ts           Database client
│   ├── market-intel.ts       Market context builder
│   └── ...other engines
├── components/
│   ├── keisha/
│   │   ├── ExplainButton.tsx
│   │   ├── GlossaryTerm.tsx
│   │   ├── TradeCard.tsx
│   │   ├── PortfolioSnapshotCard.tsx
│   │   ├── OptionsCard.tsx
│   │   ├── GuardCard.tsx
│   │   ├── GEXCard.tsx
│   │   ├── InsiderCard.tsx
│   │   ├── ToolLoadingSkeleton.tsx
│   │   └── index.ts [barrel export]
│   └── layout/, dashboard/
├── types/
│   ├── index.ts
│   └── keisha.ts             [Card types, context types]
└── middleware.ts
```

---

## 1. Keisha-Tools Module (`keisha-tools.ts`)

### Purpose
Defines the 40+ native tools Keisha can execute, plus trade detection and logging.

### Tool Categories

#### Market Data Tools
```typescript
KEISHA_TOOLS: Tool[] = [
  lookup_price          // Real-time stock quote
  get_position          // Alpaca position details
  portfolio_summary     // Account overview
  get_options_position  // Options P&L + Greeks
  get_watchlist         // Saved symbols
  scan_watchlist        // Multi-symbol analysis
  // ... etc
]
```

#### Trade Action Tools
- **place_order**: Submit buy/sell to Alpaca
- **cancel_order**: Cancel pending order
- **set_alert**: Price/technical alerts
- **add_watchlist**: Save symbol for tracking
- **remove_watchlist**: Delete from watchlist

#### Intelligence Tools
- **get_insider_trades**: Recent insider activity
- **get_options_flow**: Unusual options activity
- **check_earnings**: Next earnings dates
- **scan_confluence**: Multi-signal scanner
- **analyze_sector**: Sector momentum
- **get_news**: Recent news for symbol

#### Portfolio Tools
- **get_portfolio_metrics**: Risk metrics (Sharpe, VaR, beta)
- **calculate_allocation**: Optimal weights
- **estimate_tax_impact**: Tax harvesting analysis
- **get_portfolio_Greeks**: Net delta/theta/gamma/vega

#### Wealth/CR3 Tools
- **get_cr3_valuation**: Territory portfolio value
- **get_territories_status**: Per-territory health
- **estimate_passive_income**: CR3 projected revenue
- **check_rsu_vesting**: RSU schedule + tax impact

#### Macro Tools
- **get_fed_calendar**: FOMC dates + expectations
- **get_economic_calendar**: Macro events
- **get_yield_curve**: Treasury yields
- **detect_market_regime**: Trending/mean-revert/crisis

### Trade Detection System
```typescript
detectTradeIntent(response: string): Promise<string>
```
- Scans Keisha's response for trade language: "buy", "sell", "short", "cover", etc.
- Auto-detects symbol (e.g., "buy NVDA")
- Calls `/api/agent-crew` for consensus validation
- Calls `/api/trade-guard` for risk check
- Returns **TRADE DETECTED** card with Crew Verdict + Guard Check

### Action Tags (XML-style)
Keisha can include inline action tags in responses:
```xml
<action type="place_order" symbol="AAPL" side="buy" qty="10" orderType="market" />
<action type="add_watchlist" symbol="NVDA" />
<action type="set_alert" symbol="TSLA" condition="price_below" value="200" />
```

### Logging System
Two background logging functions:
- **logRecommendation()**: Extracts buy/sell/hold signals from response, stores in `keisha_recommendations` table with price, conviction, reasoning, and eventual outcome tracking
- **logConversation()**: Stores full user message + response in `keisha_conversations` table with symbols, sentiment, topics for future context retrieval

---

## 2. Keisha-Context Module (`keisha-context.ts`)

### Purpose
Intelligently builds the system prompt context by:
1. Detecting what data Wes actually needs (smart pruning)
2. Fetching live Alpaca/Supabase data in parallel
3. Building enriched narrative context with market intelligence
4. Auto-loading memory pins and past conversation summaries

### Smart Context Pruning
```typescript
pruneContext(userMessage: string, domain: string): ContextNeeds
```

**Decision Tree:**
- **Simple greetings** ("hi", "hey", "sup") → Only personality mode
- **Trade intent** ("buy", "sell", "enter", "exit") → ALL context (full arsenal)
- **Emotional words** ("scared", "panicking", "bleeding") → Behavioral alerts + personality
- **Stock symbols** (e.g., "NVDA") → Market intel + contrarian radar + memory
- **Portfolio questions** → Alpaca + Supabase data
- **Tax questions** → Alpaca + Supabase for position history
- **Risk questions** → GEX + Macro + Market intel
- **Strategy/roadmap** → Track record + calibration + Supabase
- **Wealth/50M** → Alpaca + Supabase (CR3 + RSU data)
- **Default** (no keywords matched) → All core data + personality + market intel

**Domain Overrides:**
- `domain === 'quant'` → Force GEX, Macro, Drift
- `domain === 'cfo'` → Force Alpaca + Supabase
- `domain === 'tax'` → Force Supabase access

### Data Fetchers (Parallel)

#### getAlpacaContext()
Fetches from Alpaca API:
- Account equity, cash, buying power, pattern day trader status
- All positions (qty, price, cost basis, unrealized P&L)
- Last 10 orders (symbol, side, qty, type, status, filled price)
- Options positions with Greeks (delta, theta, gamma, vega, net theta/month)
- Expiring options warning (≤7 DTE)
- Returns formatted string: Account info + Positions + Options Greeks + Orders

#### getSupabaseContext()
Fetches from Supabase tables:
- **Strategies**: Active strategies with returns, trade count, status
- **Watchlist**: 15 symbols with prices, fair values, moat ratings
- **Roadmap entries**: Progress toward $50M (by year, actual vs projected)
- **Portfolio snapshots**: Last 5 historical snapshots (date, equity, cash, P&L)
- **Recent trades**: Last 10 logged trades (symbol, side, qty, status)
- **Audit log**: System activity (agents + actions)

#### Specialized Fetchers

**getTrackRecord()**
- Last 90 days of `keisha_recommendations` from Supabase
- Calculates: hit rate %, avg win %, avg loss %, best/worst calls
- Detects trend: improving/declining/stable (30d vs older comparison)
- Returns formatted: Total recs, resolved, win rate, best call, worst call, trending

**getBehavioralAlerts()**
- Checks today's trade count and loss count
- Detects patterns: REVENGE_TRADING (3+ trades within 1 hour of a loss)
- Detects: OVERTRADING (>5 trades today)
- Detects: POSSIBLE_FEAR_SELLING (selling during negative GEX regime)
- Returns warning text if patterns detected

**getCalibrationContext()**
- Fetches `signal_calibration` table (Wes's actual signal performance)
- Shows precision % and recommended weight for each signal source
- Identifies best vs worst performer
- Returns guidance: "Weight your best signal 80%, avoid your worst signal"

**getConversationMemory()**
- Finds past conversations about mentioned symbols (overlaps with symbols_mentioned array)
- Returns last 5 past discussions with dates, sentiments, snippets
- Enables: "Last time we talked about NVDA, you were worried about..."

**getPersonalityMode()**
- Calculates today's P&L and P&L %
- Detects market hours: open/premarket/closed
- Counts trades today
- Returns personality mode: `celebrating` (up >3%), `steady` (down >3%), `strategic` (pre-market), `reflective` (closed), `watchful` (many trades)

**getContrarianContext()**
- Fetches sentiment score for mentioned symbols
- Triggers alerts for extreme sentiment (>85% bullish or <15% bullish)
- Returns: "Extreme optimism often precedes corrections" or "Maximum pessimism = buying opportunity"

#### Memory Pins Auto-Load
```typescript
// Queries keisha_memory_pins table for:
1. Pins matching mentioned symbols
2. Pins matching current domain (persona)
3. Most recent general pins
// Deduplicates and returns top 10
```

#### Full Context Assembly
```typescript
buildFullPortfolioContext(opts: {
  userMessage: string;
  domain: string;
  conversationId?: string;
  messages?: ChatMessage[];
}): Promise<{
  portfolioContext: string;
  gexRegime: string | null;
  mentionedSymbols: string[];
  supabase: ServiceClient;
}>
```

**Flow:**
1. Prune context (what does Wes need?)
2. Extract symbols from message
3. Fetch needed data in parallel (Alpaca, Supabase, market intel, GEX, macro, drift)
4. Fetch behavioral alerts + personality mode + track record + signal calibration
5. Build contrarian radar for symbols
6. Assemble into single narrative string with sections:
   - ALPACA BROKERAGE (live account)
   - MARKET INTELLIGENCE (sector trends, correlations)
   - GEX/MACRO/DRIFT intelligence (if needed)
   - GLASTONBURY TERMINAL DATABASE (strategies, watchlist, roadmap, snapshots)
   - STATIC HOLDINGS (CR3, RSUs, property)
   - TRACK RECORD (last 90 days)
   - SIGNAL CALIBRATION (weighted by Wes's actual performance)
   - CONTRARIAN RADAR (extreme sentiment alerts)
   - BEHAVIORAL ALERTS (revenge trading, overtrading, fear selling)
   - PERSONALITY MODE (current state + market hours)
   - MEMORY PINS (Wes's saved notes)

---

## 3. Main Chat Page (`app/keisha/page.tsx`)

### Component Structure
```typescript
export default function KeishaPage()
```

**State Variables (50+):**
- `messages`: ChatMessage[] — conversation history
- `input`: string — user input buffer
- `loading`: boolean — API call in progress
- `domain`: Domain ('general' | 'cfo' | 'tax' | 'quant' | 'wealth' | 'strategy')
- `conversations`: ConversationSummary[] — sidebar history for current persona
- `activeConvoId`: string | null — current conversation ID
- `tradeModal`: Trade confirmation modal state
- `suggestions`: string[] — follow-up suggestions
- `speaking`: string | null — TTS message ID (null = not speaking)
- `pendingOrder`: Order confirmation state
- `explanationLevel`: 'technical' | 'balanced' | 'plain_talk' (localStorage persisted)
- `sidebarOpen`: boolean — sidebar visibility
- `sparklineData`: Record<string, number[]> — chart data
- `messageCards`: Record<string, RenderCard[]> — rendered card data
- `toolsLoadingMsg`: string | null — "Tools loading..." message
- `pendingImage`: {base64, mediaType, preview} — image upload state

### Domain Configuration
```typescript
DOMAIN_CONFIG: Record<Domain, { label: string; color: string; prompts: string[] }> = {
  general: { label: 'General', color: '#8a5cf6', prompts: [...] },
  cfo: { label: 'CFO', color: '#4ade80', prompts: [...] },
  tax: { label: 'Tax', color: '#f87171', prompts: [...] },
  quant: { label: 'Quant', color: '#22d3ee', prompts: [...] },
  wealth: { label: 'Wealth', color: '#f0c674', prompts: [...] },
  strategy: { label: 'Strategy', color: '#c084fc', prompts: [...] },
}
```

Each domain has 4 sample prompts (quick-start buttons).

### Conversation Persistence
- **Load conversations**: When domain changes, fetch all conversations for that persona from `/api/keisha/conversations?persona={domain}`
- **Save messages**: After each message, auto-save to active conversation via `/api/keisha/conversations/{convoId}` (PUT)
- **Create new**: Click "New Conversation" → POST to `/api/keisha/conversations` → returns convoId
- **Load existing**: Click conversation in sidebar → fetch from `/api/keisha/conversations/{convoId}`
- **Delete**: Trash icon → DELETE `/api/keisha/conversations/{convoId}`
- **Clear all**: Clear button → DELETE `/api/keisha/conversations?persona={domain}` (all for persona)
- **Search**: Type in search → fetch from `/api/keisha/conversations/search?q={query}&persona={domain}`

### Voice I/O
- **Input (STT)**: Web Speech API (`SpeechRecognition`) — click mic button → transcribes → appends to input
- **Output (TTS)**: `speechSynthesis.speak()` — reads Keisha response aloud (prefers female voices: Samantha/Karen/Zira)
- Togglable per message (click volume icon to stop/restart)

### Message Rendering
```typescript
renderMessageContent(content: string, msgId: string)
```
- Renders Markdown with glossary term links (unless `explanationLevel === 'technical'`)
- Detects trade action markers: `[Confirm & Execute]`
- Splits trade cards and renders with Crew Verdict + Guard Check buttons
- Shows "Copy", "Speak", "Regenerate", "Delete" action buttons on each message

### Trade Modal
```typescript
<TradeModal action={action} symbol={symbol} crewVerdict={verdict} guardCheck={check} ... />
```
- Gold-themed modal (#f0c674) with Crew + Guard status
- Shares input field (default 10)
- Buttons: "Place Order" (green), "Modify" (purple), "Cancel" (gray)
- On confirm: POST to `/api/autopilot` with symbol/shares/side
- Feedback: Success/failure message appended to chat

### Slash Commands
Recognized in input:
- `/help` — Show all available commands inline
- `/export` — Download conversation as markdown
- `/brief` — Generate morning briefing from `/api/keisha/briefing`
- Tool-based: `/lookup AAPL`, `/position NVDA`, etc. (hit `/api/keisha/slash` with tool + params)
- Autocomplete: Type "/" → shows matching commands with descriptions

### Message Sending Flow
```typescript
const sendMessage = useCallback(async (content: string) => {
  // 1. Fetch signal context (sentiment + insider trades for mentioned symbols)
  const signalContext = await fetchSignalContext(content);
  
  // 2. Create user message with [DOMAIN MODE] prefix + signal context
  const userMsg = { ...message, content: `[${domain.toUpperCase()} MODE] ${content}${signalContext}` };
  
  // 3. Add to display (show user's actual text, not the system-enriched version)
  setMessages(prev => [...prev, { ...userMsg, content }]);
  
  // 4. Check for slash commands
  const parsed = parseSlashCommand(content);
  if (parsed) {
    // Handle slash command (help, export, brief, or tool-based)
    // POST to /api/keisha/slash for tool commands
    // Return early
  }
  
  // 5. Stream Claude response
  const abortCtl = new AbortController();
  const response = await fetch('/api/keisha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: activeConvoId,
      message: userMsg,
      domain,
      explanationLevel,
      messages: messages, // Full history for context
    }),
    signal: abortCtl.signal,
  });
  
  // 6. Parse streaming response (text + suggestions + actions + cards)
  // Extract action buttons, sparkline data, card data
  
  // 7. Add assistant message to chat
  // 8. Auto-save to conversation
  // 9. Check for trade intent → show modal
  // 10. Set suggestions for follow-up prompts
});
```

### Image Upload
- Click image icon → hidden file input → convert to base64 → include in message payload
- Message displays: "[Image uploaded: {filename}]"
- Sent to Claude for analysis (vision capability)

### Explanation Level Toggle
```typescript
const explanationLevel: ExplanationLevel = 'balanced' // or 'technical' | 'plain_talk'
// Persisted to localStorage
// Affects rendering: if 'technical', don't show glossary term links
```

---

## 4. Type Definitions (`types/keisha.ts`)

### Card Types
Keisha can render rich visualizations as cards:
```typescript
type RenderCard = 
  | TradeCardData
  | PortfolioCardData
  | OptionsCardData
  | GuardCardData
  | GEXCardData
  | InsiderCardData;

interface TradeCardData {
  type: 'trade';
  symbol: string;
  action: 'buy' | 'sell' | 'short' | 'cover';
  target: number;
  conviction: number;
  reasoning: string;
  // ... more fields
}

interface PortfolioCardData {
  type: 'portfolio';
  equity: number;
  cash: number;
  pnl: number;
  positions: Array<{ symbol: string; value: number; pnl: number; }>;
}

interface OptionsCardData {
  type: 'options';
  underlying: string;
  netDelta: number;
  netTheta: number;
  netGamma: number;
  netVega: number;
  positions: Array<{ ... }>;
}

// ... etc for GuardCard, GEXCard, InsiderCard
```

### Other Types
- **ExplanationLevel**: 'technical' | 'balanced' | 'plain_talk'
- **ChatMessage**: { id, role, content, timestamp, cards?, actions? }
- **ContextNeeds**: Boolean flags for what data to fetch

---

## 5. Components (`components/keisha/`)

All are React functional components that render rich UI:
- **ExplainButton.tsx**: Toggle explanation level (click to switch modal)
- **GlossaryTerm.tsx**: Inline glossary popup on hover
- **TradeCard.tsx**: Displays trade recommendation with conviction meter
- **PortfolioSnapshotCard.tsx**: Portfolio summary with P&L chart
- **OptionsCard.tsx**: Options Greeks visualization
- **GuardCard.tsx**: Risk check results + warnings
- **GEXCard.tsx**: Gamma exposure analysis + gamma flip alerts
- **InsiderCard.tsx**: Insider trading activity table
- **ToolLoadingSkeleton.tsx**: Animated loader while tools fetch

All exported via `index.ts` barrel file.

---

## 6. How It All Connects

### Message Flow
```
User types "buy NVDA"
    ↓
[DOMAIN MODE PREFIX + SIGNAL CONTEXT] added automatically
    ↓
POST to /api/keisha with full context (from keisha-context.ts)
    ↓
Claude reads system prompt with:
  - Portfolio state (Alpaca account + positions)
  - Watchlist (Supabase)
  - Track record (win rate, best calls)
  - Behavioral alerts (revenge trading? fear selling?)
  - Signal calibration (weight your strongest signals)
  - Market intel (GEX regime, macro, drift)
  - Memory pins (Wes's notes)
    ↓
Claude calls tools from keisha-tools.ts array:
  - lookup_price NVDA
  - get_options_position (if relevant)
  - detect_insider_trades
  - etc.
    ↓
Claude generates response + optional action tags
    ↓
Response parsed for:
  - Trade intent detection (buy/sell language)
  - Action tags (place_order, add_watchlist, etc.)
  - Card render data (trade confidence, portfolio snap, etc.)
  - Suggestions (3 follow-up prompts)
    ↓
Modal shown if trade detected + crew/guard checks passed
    ↓
Message saved to conversation in Supabase
    ↓
Recommendation logged (if applicable)
    ↓
Chat displayed with cards, suggestions, action buttons
```

---

## 7. Key Patterns for Claude Code Prompt

### Pattern 1: Tax Domain Context Override
When `domain === 'tax'`:
1. Auto-enable Supabase fetching (need position history)
2. Inject tax-specific context:
   - Last realized gains/losses (from trades table)
   - Wash sale windows (30 days before/after)
   - Estimated capital gains (unrealized from positions)
   - RSU vesting schedule + tax basis
   - Estimated quarterly payment due
3. Sample tax prompts:
   - "Estimated Q2 tax bill?"
   - "Optimal RSU sell schedule"
   - "Harvest without triggering wash sale"
   - "QBI deduction breakdown"

### Pattern 2: Trade Detection Flow
1. Keisha says "I'd buy NVDA at $800 with 8/10 conviction"
2. Response parsed: extracts "buy", "NVDA", conviction level
3. NLP triggers: `detectTradeIntent()` in keisha-tools.ts
4. Auto-calls: `/api/agent-crew` (consensus), `/api/trade-guard` (risk check)
5. Response transformed: "**TRADE DETECTED: BUY NVDA**\nCrew Verdict: go\nGuard Check: pass"
6. UI renders modal with "Confirm & Execute", "Modify", "Cancel"
7. On confirm: POST to `/api/autopilot` → actual order placed

### Pattern 3: Smart Context Pruning
```typescript
if (domain === 'tax' && /\b(tax|harvest|wash sale)\b/i.test(message)) {
  // Enable: Alpaca (position history), Supabase (trades, realized gains)
  // Inject: Tax worksheet context
} else if (domain === 'quant' && /\b(regime|confluence|size)\b/i.test(message)) {
  // Enable: GEX, Macro, Drift
  // Inject: Signal calibration, contrarian radar
}
```

### Pattern 4: Conversation Memory
```typescript
// When symbols mentioned:
const pastConvos = await supabase
  .from('keisha_conversations')
  .select('*')
  .overlaps('symbols_mentioned', ['NVDA', 'AAPL'])
  .limit(5);
// Inject: "Last time we talked about NVDA on 2026-04-01, you were concerned about..."
```

### Pattern 5: Memory Pins
```typescript
// Auto-load from Supabase:
const pins = await supabase.from('keisha_memory_pins')
  .select('*')
  .eq('active', true)
  .in('symbol', mentionedSymbols)
  .limit(10);
// Append to context: "MEMORY PINS (Wes's saved notes): ..."
```

---

## 8. API Routes (Not Provided But Inferred)

Based on the page code, these routes are expected:

### Keisha Chat API
- `POST /api/keisha` — Main chat endpoint
  - Input: { conversationId, message, domain, explanationLevel, messages }
  - Output: Streaming response with text + suggestions + actions + cards

### Conversation Management
- `GET /api/keisha/conversations?persona={domain}` — List conversations for persona
- `POST /api/keisha/conversations` — Create new conversation
- `GET /api/keisha/conversations/{convoId}` — Load specific conversation
- `PUT /api/keisha/conversations/{convoId}` — Save/update conversation
- `DELETE /api/keisha/conversations/{convoId}` — Delete conversation
- `DELETE /api/keisha/conversations?persona={domain}` — Delete all for persona
- `GET /api/keisha/conversations/search?q={query}&persona={domain}` — Search conversations

### Tool/Command APIs
- `POST /api/keisha/slash` — Execute slash commands (tool-based)
- `GET /api/keisha/briefing` — Morning briefing generation
- `POST /api/keisha/actions` — Execute action tags (add_watchlist, set_alert, etc.)

### Market Data APIs
- `GET /api/sentiment?symbol={sym}` — Sentiment score
- `GET /api/insider?symbol={sym}&days={days}` — Insider trades
- `GET /api/gex?symbol={sym}` — Gamma exposure
- `GET /api/macro` — Macro regime
- `GET /api/drift` — Drift regimes
- `GET /api/options/positions` — Options portfolio
- `POST /api/trade-guard` — Risk validation
- `POST /api/agent-crew` — Multi-agent consensus
- `POST /api/autopilot` — Trade execution

---

## 9. Database Schema (Inferred from Code)

### Supabase Tables

**strategies**
```
id, name, type, status, total_return, total_return_pct, trades_executed, created_at, updated_at
```

**watchlist**
```
id, symbol, company_name, current_price, fair_value, moat, stars, created_at
```

**roadmap_entries**
```
id, year, projected, actual, category, created_at
```

**portfolio_snapshots**
```
id, date, total_equity, cash, pnl, cr3_value, rsu_value, created_at
```

**trades**
```
id, symbol, side, qty, order_type, status, filled_avg_price, pnl, submitted_at
```

**audit_log**
```
id, agent, action, details, status, timestamp
```

**keisha_recommendations**
```
id, symbol, recommendation, conviction, reasoning, price_at_recommendation, outcome, return_pct, created_at
```

**keisha_conversations**
```
id, persona, title, preview, messages_json, symbols_mentioned, sentiment, topics, created_at, updated_at
```

**keisha_chat_sessions**
```
id, persona, messages_json, updated_at
```

**keisha_memory_pins**
```
id, symbol, category, content, active, created_at
```

**signal_calibration**
```
id, source, actual_precision, sample_size, recommended_weight
```

---

## 10. Tax Domain Implementation Guide

### For a Claude Code Prompt

**Context to inject when `domain === 'tax'`:**

1. **Tax Profile Section**
   ```
   TAX PROFILE (2026):
   - Filing status: Single
   - Expected tax bracket: 24%
   - State of residence: California (9.3% state tax)
   - Estimated federal tax: ${estimatedFederal}
   - Estimated state tax: ${estimatedState}
   - Total estimated: ${estimatedFederal + estimatedState}
   - Q1 estimated payment: ${q1Amount}
   - Q2 estimated payment: ${q2Amount}
   - Q3 estimated payment: ${q3Amount}
   - Q4 estimated payment: ${q4Amount}
   ```

2. **RSU Tax Impact**
   ```
   RSU VESTING SCHEDULE:
   - Current shares: 5,749
   - Grant date FMV: $259.14
   - Current price: ${currentPrice}
   - Vesting per quarter: ~1,437 shares
   - Next vesting date: April 15, 2026
   - Tax on next vesting: ~$374K (at 24%)
   - Recommendation: Diversify quarterly into tax-efficient vehicles
   ```

3. **Wash Sale Detector**
   ```
   WASH SALE MONITORING:
   - Last loss harvest: 2026-03-15 (AAPL -$2,400)
   - Wash sale window: 2026-03-15 to 2026-04-15
   - Can repurchase AAPL: 2026-04-16
   - Current position: None (eligible for re-entry)
   ```

4. **Capital Gains Tracker**
   ```
   REALIZED GAINS/LOSSES (YTD 2026):
   - Short-term gains: +$18,500
   - Short-term losses: -$3,200
   - Long-term gains: +$42,000
   - Long-term losses: -$8,100
   - Net STCG: $15,300 (taxed as ordinary income @ 24% = $3,672)
   - Net LTCG: $33,900 (taxed @ 15% = $5,085)
   - Remaining loss carryforward: $0 (fully used)
   ```

5. **QBI Deduction Analysis**
   ```
   QBI DEDUCTION (Qualified Business Income):
   - 2026 taxable income: ${taxableIncome}
   - QBI eligible: CR3 franchise income + passive S-corp/partnership
   - QBI amount: ${qbiAmount}
   - QBI deduction (20%): ${qbiDeduction}
   - Limitation: Lesser of 20% QBI or 20% taxable income
   - Net tax savings: ${qbiDeduction * 0.24}
   ```

6. **Tax-Loss Harvesting Recommendations**
   ```
   HARVEST OPPORTUNITIES:
   - TSLA position: Down 8%, unrealized loss $4,200
   → Can harvest, reinvest in XLK (same sector, different position)
   - MSFT position: Down 3%, unrealized loss $1,800
   → Can harvest, reinvest in SPY (broad diversification)
   - Estimated tax savings: ~$1,500
   - No wash sale risk if using alternative position
   ```

### Sample Tax-Domain Prompts
```
1. "Estimated Q2 tax bill?" 
   → Calculate: realized gains + estimated Q2 vesting + ordinary income
   
2. "Optimal RSU sell schedule?"
   → Analyze: Vesting dates + tax impact + diversification + market outlook
   
3. "Harvest without triggering wash sale?"
   → Scan: Losers, calculate window, suggest alternatives
   
4. "QBI deduction breakdown?"
   → Show: Eligible income, deduction, savings, limitations
   
5. "Should I exercise stock options?"
   → Evaluate: Tax impact + market risk + diversification benefit
```

---

## Summary

This codebase is **production-grade wealth AI** with:
- ✅ Real-time market data integration
- ✅ Multi-persona context switching
- ✅ Intelligent prompt engineering (context pruning)
- ✅ Trade execution + risk validation
- ✅ Conversation memory + track record tracking
- ✅ Behavioral alerts (prevents emotional trading)
- ✅ Voice I/O + image upload
- ✅ Portfolio persistence across sessions

For the **Tax domain enhancement**, inject domain-specific context (tax profile, RSU schedule, wash sale windows, capital gains tracker, QBI analysis) and add sample prompts to the DOMAIN_CONFIG.

