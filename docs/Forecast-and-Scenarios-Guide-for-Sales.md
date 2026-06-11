# Forecasts & Planning Scenarios — A Guide for the Sales Team

*A plain-language walkthrough of the **Forecasts** screen and the **Scenarios** screen: what they do, how they work together, and how to talk about them with customers.*

---

## 1. The Big Picture

The product answers one question for the customer: **"What will my sales look like in the coming months, and what happens if conditions change?"**

Three building blocks work together:

| Building Block | What it is | Real-world analogy |
|---|---|---|
| **Plan** | A planning container for a fiscal year (e.g. "FY 2026 Annual Plan") | The yearly budget binder |
| **Scenario** | A version of that plan under different assumptions (Base, Optimistic, Pessimistic…) | "Best case / worst case" tabs inside the binder |
| **Forecast** | Numbers predicted by statistical models from the customer's own historical sales data | The actual projections written on each tab |

**The flow:** the customer's historical sales data (synced automatically from their billing system) → feeds forecasting models → produces forecast numbers → which get adjusted up or down depending on the scenario selected. All amounts are shown in **INR (₹)**.

---

## 2. The Scenarios Screen ("What-If Analysis")

**Where:** Scenarios page in the left menu.
**Purpose:** Create and manage different "what-if" versions of a plan before any forecasting is run.

### What the customer sees
A grid of scenario cards. Each card shows the scenario's name, type badge, description, which plan it belongs to, and when it was created. A **"Baseline"** badge marks the main scenario of each plan.

### Scenario types and what they actually do

This is the key thing to understand: **the scenario type automatically adjusts the forecast numbers.** When a forecast is generated under a scenario, the system applies a built-in multiplier:

| Scenario Type | Adjustment to Forecast | When a customer would use it |
|---|---|---|
| **Base Case** | No adjustment (the raw model output) | Their primary, most-likely plan |
| **Optimistic** | **+15%** uplift | Expecting good market conditions or a strong push |
| **Pessimistic** | **−15%** reduction | Stress-testing for a downturn |
| **Stretch** | **+25%** aggressive target | Ambitious growth goals set by leadership |
| **Conservative** | **−8%** cautious estimate | Risk-averse planning (e.g. for commitments to banks/investors) |
| **Custom** | No automatic adjustment | The customer defines their own assumptions manually |

Optimistic, Pessimistic and Stretch also widen the forecast's confidence range (more uncertainty), while Conservative tightens it. On top of these multipliers, customers can add their own **planning assumptions** (growth %, price changes, volume changes, promotions, product discontinuations) that apply to specific products or date windows.

### What customers can do on this screen
- **Create a scenario** — give it a name, pick the plan it belongs to, choose a type, add a description of the assumptions. Creating a "Base Case" scenario automatically makes it the plan's baseline.
- **Edit or delete** a scenario — with one safety rule: **the baseline scenario can never be deleted** (it's the reference point everything else is compared against). Locked scenarios are also protected.
- **Clone** an existing scenario to use as a starting point for a new variation.
- **Compare scenarios** — tick the checkboxes on 2 to 4 scenario cards and hit **Compare** to see them side by side, including how much each one deviates from the baseline in total forecast value.

### Demo talking point
> "You don't need a spreadsheet jockey to model best-case and worst-case. Create a scenario, pick 'Optimistic', and every forecast you run under it is automatically lifted 15% — consistently, across every product and region."

---

## 3. The Forecasts Screen (The Main Event)

**Where:** Forecasts page in the left menu.
**Purpose:** Generate, visualize and compare sales predictions from multiple statistical models — and decide which one to trust.

### The basic workflow (4 steps)

1. **Select a Plan** from the first dropdown.
2. **Select a Scenario** — the baseline is auto-selected for you. A small note under the dropdown reminds you what adjustment that scenario applies (e.g. "+15% uplift applied").
3. **Pick forecasting models** — click the colored model chips to select one or more (see the model list below).
4. **Click "Run Models"** — the system reads the customer's historical sales data and generates forecast numbers for the chosen horizon.

**Nice touch for demos:** if a plan + scenario has never been forecast before, the screen **auto-generates a forecast in the background** the first time you open it — so the customer never stares at an empty chart.

### The forecasting models

The system offers a portfolio of models — from simple and explainable to AI-driven:

- **Moving Average** — the average of recent months. Simple, works even with little data.
- **Weighted Average** — like Moving Average, but recent months count more.
- **Linear Regression** — fits a straight trend line through history.
- **Holt-Winters** — captures both trend *and* seasonality (needs about 24+ months of history).
- **Seasonal Naive** — "this month will look like the same month last year."
- **YoY Growth** — projects forward using year-over-year growth rates.
- **Trend Percent** — extends the recent percentage trend.
- **AI Hybrid** — an ensemble that blends several models; advanced users can even set the blend weights manually.
- **ARIMA / Prophet** — heavier statistical models for complex patterns.

Each selected model gets an info card explaining what it does, the minimum data it needs, and whether it handles seasonality. The **"Show Model Info"** panel goes deeper — methodology, best use cases, limitations, and an "interpretability" rating — great for customers who ask *"but how does it work?"*

### Generation controls

| Control | What it does |
|---|---|
| **Horizon** | How far ahead to forecast: 3, 6, 12, 18, 24 or 36 periods |
| **Period Type** | Daily / Weekly / Monthly / Quarterly / Yearly granularity |
| **History Window** | How many months of history the models learn from (or leave on Auto) |
| **Rolling** | Keeps the forecast continuously rolling forward |
| **Custom Start/End dates** | Restrict the date range used |
| **Advanced → Ensemble Weights** | Hand-tune how the AI Hybrid blends its component models |
| **Advanced → External Signals** | Tell the model about outside events — e.g. "festival season, ×1.2 demand from Oct–Nov" — and it bakes the effect into the forecast |

### Reading the main chart

The **Forecast Comparison** chart plots each model as a colored line over future periods, so the customer instantly sees where models agree (high confidence) and where they diverge (uncertainty). Toggles above the chart:

- **Show Actuals** — overlays real historical sales as a dashed green line, so you can eyeball how forecasts line up with reality.
- **Show Confidence Bands** — shades the "the number will likely land in this range" zone around each line.
- The model marked **★ (primary)** is drawn thicker — that's the customer's "official" forecast.

### How the customer knows which model to trust

This is the strongest part of the screen — the system *scores its own predictions*:

**Accuracy metric cards** (plain-English versions for your conversations):

| Metric | What to say to a customer |
|---|---|
| **MAPE** | "On average, how far off the forecast is, in %. Under 10% is excellent (green), under 20% is decent (amber), above that needs attention (red)." |
| **RMSE / MAE** | "The average size of the error in rupees." |
| **Bias** | "Does this model consistently over-predict (+) or under-predict (−)? Crucial for inventory decisions." |

**Per-Model Accuracy Breakdown table** — ranks every model on these metrics, flags the **★ Best** performer, and shows a written **recommendation** (e.g. "Holt-Winters is performing best for your data — consider making it primary"). The customer clicks the **star** to crown a model as **primary** — that becomes the number the rest of the business runs on.

**Backtest View** — the honesty test. The system hides the last 6 periods of real data, asks each model to "predict" them, then shows predicted-vs-actual on a chart with a scoreboard. *Demo line: "Don't take our word for it — watch the models compete on your own history."* (Needs ~6+ months of historical data to produce scores.)

**Accuracy Alerts** — automatic warning banners when a model's error drifts past a chosen threshold (10/15/25/50% MAPE), so degrading forecasts never go unnoticed.

### Keeping a paper trail

- **Snapshot** — freeze the current forecast with a label like "Q2 Board Review". Nothing overwrites it.
- **Versions** — list every forecast run and snapshot ever made; tick any two or more to see them charted against each other ("what did we predict in January vs. what we predict now?").

### Slicing and sharing

- **Dimensions breakdown** — splits the total forecast **by Product, Location, or Customer**, with each one's share of the total. Answers "which products drive next quarter's number?"
- **Export** — one click to download the forecast as **CSV** (for Excel) or **JSON** (for their IT systems).

---

## 4. How the Two Screens Work Together — the Story to Tell

1. **Scenarios screen:** The customer sets up "Base Case", "Optimistic" and "Pessimistic" scenarios for their FY 2026 plan. *(2 minutes of clicking.)*
2. **Forecasts screen:** They pick the plan, pick "Base Case", run 3–4 models, and see which model their own sales history votes for via the accuracy table and backtest.
3. They star the best model as **primary**, take a **snapshot** labelled "FY26 Baseline".
4. They flip the scenario dropdown to "Optimistic" — same models, same data, instantly +15% — and now they have a defensible best-case number for the board.
5. **Export to CSV**, done.

---

## 5. Quick FAQ for Customer Conversations

**Q: Where do the forecasts come from — do we have to upload data?**
A: No manual uploads needed for Marg users — historical sales sync automatically from their billing system. The models learn from that history.

**Q: How much history do we need?**
A: Simple models (Moving Average) work with just a few months. Seasonal models (Holt-Winters) want ~24 months. Accuracy scoring and backtesting need roughly 6+ months. The system tells you when there isn't enough data instead of showing misleading numbers.

**Q: Can we trust an "AI" number?**
A: Every model is scored against the customer's own past data (MAPE, backtest), the methodology of each model is explained in-app, and confidence bands show the realistic range — it's transparent, not a black box.

**Q: What if our assumptions are unique — a big promotion, a product launch?**
A: Use a **Custom scenario** plus **External Signals** (e.g. "promotion, ×1.3, March–April") and **planning assumptions** for price/volume changes or discontinued products.

**Q: Can two teams look at different versions of the future?**
A: Yes — scenarios are exactly that. Up to 4 can be compared side-by-side, and forecast snapshots preserve any version permanently for audits or reviews.

---

*Document prepared from the application source code (Forecasts and Scenarios screens, forecast generation service) — adjustment percentages and model behaviors above reflect the actual implemented logic, not marketing estimates.*
