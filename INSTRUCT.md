# CPF Mirror — Codebase Guide

## What This Is

CPF Mirror is a full-stack performance dashboard for CPF officers. It ingests Auditmate audit records, ESS (Email Satisfaction Survey) feedback, and OR (Officer Response) interaction logs from Excel uploads, stores them in MongoDB, and uses GPT-4o (via OpenRouter) to generate competency analysis, development summaries, and supporting evidence. A TL or Supervisor can view any officer's data and override competency levels.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, Recharts for charts |
| Backend | Express 5 (Node.js, ES Modules) |
| Database | MongoDB via Mongoose |
| AI | GPT-4o via OpenRouter API |
| Auth | JWT (8h expiry), bcrypt password hashing |
| Excel parsing | SheetJS (xlsx) |

---

## How to Run

```bash
cp .env.example .env
# Fill in MONGODB_URI and OPENROUTER_API_KEY
npm install
npm run dev          # starts Vite (port 5173) + Express (port 3001) concurrently
```

Seed scripts (run once):
```bash
npm run seed:competencies   # load competency framework into MongoDB
npm run seed:mockdata       # seed main CSO with Jan–Mar 2026 data
npm run seed:twoCSOs        # create cso.bad + cso.good with different performance trajectories
```

---

## Login Accounts

Stored in MongoDB (users collection). All passwords are bcrypt-hashed.

| Username | Password | Role | Data |
|---|---|---|---|
| `cso` | `1234` | CSO | Jan–Mar 2026 (Advanced trajectory) |
| `cso.bad` | `1234` | CSO | Jan–Mar 2026 (Bad→Mid trajectory) |
| `cso.good` | `1234` | CSO | Jan–Mar 2026 (Mid→Good trajectory) |
| `tl` | `1234` | TL | No personal data — views CSO officers |
| `supervisor` | `1234` | Supervisor | No personal data — views all + can override |

Auth flow: login → JWT stored in `localStorage` → sent as `Authorization: Bearer <token>` on every API call → `requireAuth` middleware validates it on every route.

---

## File Structure

```
server/
├── index.js                    # Express app entry — mounts all routes
├── middleware/
│   └── auth.js                 # requireAuth JWT middleware
├── models/
│   ├── User.js                 # username, password (hash), name, role
│   ├── AuditRecord.js          # raw Auditmate row + officerId + uploadDate
│   ├── EssRecord.js            # raw ESS row + officerId + uploadDate
│   ├── Interaction.js          # raw OR row + officerId + uploadDate
│   ├── ParsedUpload.js         # human-readable sentence array per upload/date/type
│   ├── AiCache.js              # cached AI responses (keyed by officerId+date+competencyIndex+type)
│   └── CompetencyOverride.js   # TL/Supervisor manual level overrides
├── routes/
│   ├── auth.js                 # POST /api/auth/login
│   ├── upload.js               # POST /api/upload
│   ├── dashboard.js            # GET  /api/dashboard
│   ├── flagsAlerts.js          # GET  /api/flags-alerts
│   ├── competencyBreakdown.js  # GET  /api/competency-breakdown
│   ├── radarData.js            # GET  /api/radar
│   ├── aiInsights.js           # POST /api/ai/development, /evidence, /correspondence-*
│   ├── competencies.js         # GET  /api/competencies
│   ├── teamOverview.js         # GET  /api/team-overview, /officer/:id, POST /override
│   └── users.js                # GET  /api/users/me
└── utils/
    ├── parsers.js              # parseInteractionRow / parseAuditRow / parseEssRow
    ├── fetchParsedContext.js   # fetches ParsedUpload sentences for AI context
    └── getCompetencyContext.js # buildCompetencySystemPrompt(role)

src/
├── App.jsx                     # Auth context + React Router routes
├── components/
│   ├── Login.jsx               # Login form → POST /api/auth/login
│   ├── Layout.jsx              # Shell: Sidebar + <Outlet />
│   ├── Sidebar.jsx             # Left nav + officer switcher (TL/Supervisor)
│   └── Topbar.jsx              # Page header
├── pages/
│   ├── DataUpload.jsx          # Upload Auditmate/ESS/OR files
│   ├── DashboardPage.jsx       # Overview: scores, trend chart, indicators
│   ├── ForecastPage.jsx        # 3-month Monte Carlo simulation
│   ├── CompetencyBreakdown.jsx # Per-competency level + AI dev summaries
│   ├── CompetencyRadar.jsx     # Radar chart: 6 indicators current vs predicted
│   ├── FlagsAlerts.jsx         # Red/amber/green performance alerts
│   └── TeamOverview.jsx        # TL/Supervisor: team list + officer drill-down
└── utils/
    └── auth.js                 # saveAuth / getToken / getUser / clearAuth (localStorage)

scripts/
├── seedCompetencies.js         # Seeds CompetencyFramework collection from JSON
├── seedMockData.js             # Seeds main CSO with Jan–Mar 2026 XLSX data
└── seedTwoCSOs.js              # Creates cso.bad + cso.good with separate XLSX datasets
```

---

## Page-by-Page: What It Shows & How It Gets the Data

### 1. Data Upload (`/data-upload`)

**What it shows:**
- Drop zones for Auditmate (CSV/XLSX), ESS (CSV/XLSX), and OR interactions (CSV/XLSX)
- One upload slot per day — each day's data is stored separately with its `uploadDate`
- After upload, shows a summary card: total score, ESS avg, record count for that day
- The summary card is persisted in the database so returning to this tab re-fetches it

**How it works:**
- File is parsed in the browser (CSV via custom parser, XLSX via SheetJS)
- Rows are `POST`ed to `/api/upload` as JSON
- Backend saves rows to `AuditRecord`, `EssRecord`, or `Interaction` collections
- Backend also runs `parseAuditRow` / `parseEssRow` / `parseInteractionRow` and saves human-readable sentences to `ParsedUpload` — these feed AI context later
- `uploadDate` is always today's date in `YYYY-MM-DD` format

---

### 2. Dashboard (`/dashboard`)

**What it shows:**
- 4 stat cards: Competency Score, ESS Avg, Records This Period, Level Distribution (Basic/Intermediate/Advanced indicator counts)
- 30-day trend area chart (daily average scores)
- 10 Auditmate indicator pass rates with level badges (Advanced ≥90%, Intermediate ≥70%, Basic <70%)

**How it gets data:**
- `GET /api/dashboard?officerId=<id>`
- Fetches **all** AuditRecords + ESS records from last 30 days from MongoDB
- Groups by `uploadDate`, computes daily averages
- For each of the 10 indicators, finds matching column by keyword (e.g. "courtesy", "comprehend") and averages pass/fail values across all records
- `competencyScore` = average of all total score fields in the 30-day window
- ESS average = mean of all ESS ratings (1–5 scale) in the 30-day window
- All tabs (Dashboard, Forecast, Radar, Flags, Competency Breakdown) use **the same rolling 30-day window**

---

### 3. 3-Month Forecast (`/forecast`)

**What it shows:**
- Predicted mean score at day 90
- Pass probability (% of simulations reaching ≥80%)
- Trajectory chart: mean line + 95% CI band + IQR band
- 4 adjustable sliders: interactions/day, complexity rate, learning rate, fatigue rate

**How it works:**
- Fetches `GET /api/dashboard` to get the officer's real current competency score as the simulation baseline
- Runs a **Monte Carlo simulation entirely in the browser** (200 iterations × 90 days)
- Each day: `score[d] = score[d-1] + gain - fatigue + noise`
  - `noise` = random ±4%
  - `gain` = `learningRate × (complexityRate/100) × (interactionsPerDay/25) × 100`
  - `fatigue` = `fatigueRate × random × 100`
- Statistics (mean, 95th/5th percentile, IQR) computed across all 200 runs per day
- Chart samples every 3 days (~31 points) for performance
- No backend call for the simulation — purely client-side computation

---

### 4. Competency Breakdown (`/competency-breakdown`)

**What it shows:**
Four tabs:
- **Correspondence Competencies** — 5 competencies mapped to Auditmate indicators, with live scores
- **Core Competencies** — 6 CPF core competencies with per-competency levels
- **Functional Competencies** — loaded from framework, shown as definition cards
- **Leadership Competencies** — Supervisor only

Each card (collapsed): competency name, level label, 3 level boxes (Basic/Intermediate/Advanced highlighted), status badge (Mastery/Advancing/Stagnant)

Each card (expanded):
- Core: score context bar, AI Development Summary (wellDone/toProgress bullets), Supporting Evidence button
- Correspondence: Contributing Indicators table (per-indicator pass rate), ESS signal (for Empathetic Writing + Customer Obsessed), AI Development Summary, Supporting Evidence button

**How it gets data:**
- `GET /api/competency-breakdown?officerId=<id>` — computes everything from last 30 days of AuditRecords + ESS
- Per-competency level = indicator pass rate averaged → `<60%=Basic, 60–79%=Intermediate, ≥80%=Advanced`
- Status per competency = `Mastery` if level 3, `Advancing` if upward slope over last 3 upload dates, else `Stagnant`
- Correspondence competencies each map to specific indicator keywords:
  - Empathetic Writing → courtesy + meaningful/conversation
  - Direct Reply → clear + complete + comply/sog
  - Active Listening → comprehend + complete
  - Customer Obsessed → courtesy + meaningful/conversation + correct
  - Problem Solving → comprehend + correct + complete + cultivate/digital
- `GET /api/competencies?role=<role>` — loads the framework (names, descriptions, bullet points) from MongoDB

**AI calls (on card expand):**
- Core: `POST /api/ai/development` → returns `{ wellDone, toProgress }` or `{ mastery }` bullets
- Core: `POST /api/ai/evidence` → returns `{ strengths, gaps, suggestions }` with quotes
- Correspondence: `POST /api/ai/correspondence-development` → same structure
- Correspondence: `POST /api/ai/correspondence-evidence` → same structure
- All AI responses are **cached in MongoDB** (`AiCache` collection) keyed by `officerId + uploadDate + competencyIndex + type` — so the same card won't call GPT-4o twice

---

### 5. Competency Radar (`/competency-radar`)

**What it shows:**
- Radar chart with 6 axes (one per Auditmate indicator group: Courtesy, Comprehend, Correct, Complete, Clear, Meaningful)
- Two overlapping polygons: Current (30-day avg) vs 3-Month Predicted
- Below the chart: indicator detail table with week-on-week and month-on-month % change, trend arrow
- AI insight sentence per indicator (one line describing what the trend means)

**How it gets data:**
- `GET /api/radar?officerId=<id>`
- Current = average pass rate per indicator over last 30 days
- Predicted = extrapolated 90 days forward using a trend projection:
  - Calculates daily rate of change from full history (first to last upload date)
  - Improvements dampened by 0.75× to avoid over-optimism
  - Flat indicators get a minimum drift of 0.025%/day (~2% over 90 days)
  - Hard ceiling of 88% — never predicts 100%
- Week/month change = diff between this week's avg and last week's avg (same for month)
- AI insights: one sentence per indicator generated by GPT-4o, cached by ISO week key

---

### 6. Flags & Alerts (`/flags-alerts`)

**What it shows:**
- 3 stat cards: count of Critical (red), Development (amber), Positive (green) flags
- Each flag as a coloured card with title + explanation message

**How it gets data:**
- `GET /api/flags-alerts?officerId=<id>`
- Looks at the **last 3 upload dates** of AuditRecords to check for trends
- Rule-based logic — no AI involved. Example rules:
  - **Critical (red)**: 3+ competencies with no level progression across last 3 uploads; consecutive declining total scores; ESS avg <3.0; critical indicator (Courtesy/Correct) failing >50% of the time
  - **Development (amber)**: score plateau (flat across last 3 uploads); ESS declining; high fail rate on any single indicator
  - **Positive (green)**: consistent score improvement; all indicators passing; ESS avg ≥4.5

---

### 7. Team Overview (`/team-overview`) — TL and Supervisor only

**What it shows:**
- **TL view**: list of CSO officers on the team — each card shows name, overall score, level badge, alert count. Click an officer to open a drill-down panel.
- **Supervisor view**: same list but includes TLs and all CSOs
- **Drill-down panel** (any officer): competency-by-competency level bars, overall score, active alerts. Supervisor can enter Override Mode to manually set any competency level.

**How it gets data:**
- `GET /api/team-overview` — returns list of officers the logged-in user can see
- `GET /api/team-overview/officer/:id` — returns one officer's competency levels, score, and alerts (pulls from same `/api/flags-alerts` and `/api/competency-breakdown` logic server-side)
- **Override**: `POST /api/team-overview/override` — saves a `CompetencyOverride` document. Overridden levels are shown with a pencil icon in the drill-down.

---

## Data Flow Summary

```
Excel upload → /api/upload
  → AuditRecord / EssRecord / Interaction (raw rows in MongoDB)
  → ParsedUpload (human-readable sentences for AI context)

/api/dashboard          → AuditRecord + EssRecord (30-day window)
/api/flags-alerts       → AuditRecord + EssRecord (last 3 upload dates)
/api/competency-breakdown → AuditRecord + EssRecord (30-day window) + CompetencyFramework
/api/radar              → AuditRecord (all history for trend, 30-day for current)
/api/ai/*               → ParsedUpload (context) → OpenRouter GPT-4o → AiCache
/api/team-overview      → User + CompetencyOverride + above routes
```

---

## Level & Status Thresholds

| Score | Level |
|---|---|
| ≥80% | Advanced (3) |
| 60–79% | Intermediate (2) |
| <60% | Basic (1) |

| Status | Condition |
|---|---|
| Mastery | Level 3 AND score ≥80% consistently |
| Advancing | Last 3 upload dates show upward slope |
| Stagnant | Everything else |

---

## AI Caching

All GPT-4o responses are cached in the `AiCache` collection. Cache key:
```
{ officerId, uploadDate, competencyIndex, type }
```
- Core development: `type = 'development'`, index 0–5
- Core evidence: `type = 'evidence'`, index 0–5
- Correspondence development: `type = 'corr-dev'`, index 100–104
- Correspondence evidence: `type = 'corr-ev'`, index 100–104
- Radar insights: `type = 'radar-insights'`, index 99, keyed by ISO week

Timeout on all AI fetch calls: **30 seconds** (`AbortSignal.timeout(30_000)`). On timeout or error, the UI shows nothing rather than crashing.

---

## Adding a New Officer

1. Create user in MongoDB (or add to `seedTwoCSOs.js`)
2. Upload XLSX data via the Data Upload page, or run a seed script
3. The officer appears automatically in Team Overview for TL/Supervisor
