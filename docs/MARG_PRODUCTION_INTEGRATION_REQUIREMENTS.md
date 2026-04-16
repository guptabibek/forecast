# Marg Production Integration Requirements

This document lists what is required from Marg, or from an adjacent ERP/QMS feed, to make the current pharma/manufacturing reporting integration production-grade.

It is split into three groups:

1. Data Marg already exposes but we must sync into core operational tables
2. Data missing from the current Marg API contract that we need for full production reporting
3. Data we should keep as internal master data instead of depending on Marg

## 1. Already In Current Marg Payload, But Must Be Synced Properly

These fields already exist in current staged Marg payloads and should be consumed end-to-end instead of remaining in staging only.

### Batch and expiry fields from Marg stock

- `batch` -> core batch number
- `batDate` -> manufacturing date
- `expiry` -> expiry date
- `stock` -> on-hand quantity
- `brkStock` -> broken or damaged stock bucket
- `mrp` -> list price / MRP for value-at-risk reports
- `rateA`, `rateB`, `rateC` -> pricing tiers where needed

Why needed:

- Batch-wise inventory
- Near-expiry report
- Expired stock report
- Stock ageing report
- FEFO queue and FEFO compliance
- Inventory value-at-risk

### Supplier references already present on stock rows

- `supCode` -> supplier reference
- `supInvo` -> supplier invoice or receipt reference
- `supDate` -> supplier receipt date

Why needed:

- Supplier traceability at batch level
- GRN / receipt audit trail
- Procurement and receipt ageing analysis

### Transaction-level fields already present in Marg details

- `voucher`
- `type`
- `date`
- `cid`
- `pid`
- `batch`
- `qty`
- `free`
- `rate`
- `discount`
- `amount`
- `gst`
- `gstAmount`

Why needed:

- Real stock movement report
- Batch-level movement traceability
- Promotional free quantity reporting
- Discount and net sales analysis
- Tax-aware reporting

### Product and party enrichment already available in Marg staging

- Product `pack`
- Party `phone3`, `phone4`, `sCode`
- Party address text, route, area, PIN, GSTN

Why needed:

- Pack/UOM conversion support
- Better customer/channel segmentation
- Better route and territory analysis

## 2. Missing From Current Marg API Contract

These are the main gaps we still need from Marg, or from another system, to make the integration fully production-grade.

### A. Supplier master and procurement entities

Required:

- Supplier master with stable `supplier_id`
- Supplier name
- Supplier GST / tax identity
- Supplier address and location
- Supplier contact details
- Supplier payment terms
- Supplier lead time days
- Supplier status / active flag
- Supplier-product mapping

Also required:

- Purchase order header and line feeds
- Purchase order number
- Purchase order date
- Expected receipt date
- Ordered quantity and received quantity per line
- Goods receipt number
- Goods receipt date
- Rejected / short / damaged receipt quantities
- Supplier invoice reference

Why needed:

- Suggested reorder / purchase reports
- Supplier-wise purchase analysis
- Supplier scorecards
- Lead-time based planning
- Fill-rate and OTIF measurement
- Procurement ageing and open PO tracking

### B. Quality and blocked stock status

Required:

- QC status per batch or receipt
- Released / blocked / quarantined flag
- Hold reason
- Rejection reason
- Recall or withdrawal flag
- Cold-chain or storage-condition compliance markers where applicable

Why needed:

- Production-grade expired and blocked stock reporting
- Usable vs non-usable stock separation
- FEFO that ignores quarantined inventory
- Pharma compliance reporting

### C. True movement semantics and inter-location transfers

Required:

- Canonical movement type from Marg, not just a short code
- Receipt / issue / transfer / return / adjustment / scrap / production movement distinction
- Signed quantity semantics
- `from_location_id`
- `to_location_id`
- Inter-branch transfer reference number
- Transfer dispatch vs transfer receipt events

Why needed:

- Production-grade stock movement report
- XYZ analysis
- Inventory turnover based on real issues/receipts
- Inter-warehouse visibility
- Stock-out reconstruction and audit

### D. Product pharma attributes

Required:

- Manufacturer name
- Brand name
- Generic name / molecule
- Strength
- Formulation / dosage form
- Shelf life days at master level
- Storage condition
- Cold-chain flag
- Any regulated classification required by the business

Why needed:

- Pharma-grade grouping and reporting
- Shelf-life policy logic
- Expiry risk normalization
- Brand/manufacturer analysis

### E. Structured branch and location metadata

Required:

- City
- State
- Full address
- Warehouse / store / branch type
- If available: zone / rack / bin / storage area

Why needed:

- City-wise and state-wise stock reports
- Warehouse heatmaps
- Better branch normalization
- Physical picking / FEFO at sub-location level

### F. Customer / channel segmentation

Required:

- Customer type
- Channel classification
- Structured city and state
- Better route or territory code normalization

Why needed:

- Pharmacy vs hospital vs distributor analysis
- Sales channel reporting
- Regional demand and service reporting

### G. Stock-out and lost-sales events

Required:

- Explicit stock-out event stream, or
- Historical inventory snapshots plus demand linkage, or
- Lost-sales / unfulfilled-demand events

Why needed:

- Stock-out history report
- Service-level analysis
- Exception management and root-cause reporting

## 3. Data We Should Keep As Internal Master Data

These should not block Marg integration because they are better owned in our system.

- Reorder policy
- Safety stock rules
- Min/max levels
- Reorder point
- Target service level
- Internal planning policy per item-location
- Internal FEFO allocation rules
- Internal alert thresholds

Reason:

These are planning decisions, not source-of-truth transactional facts. Depending on Marg for them would weaken our planning model.

## 4. Minimum Production Contract We Should Ask Marg For

If we want the shortest practical list to request from Marg, ask for these first:

### Priority 1

- Supplier master
- Purchase orders
- Goods receipts
- Quality / blocked stock status
- Canonical movement types
- Transfer origin and destination

### Priority 2

- Product pharma attributes
- Structured location metadata
- Customer channel classification
- Lost-sales / stock-out events

### Priority 3

- Sub-location storage hierarchy
- Additional compliance fields beyond batch/expiry/QC

## 5. What Becomes Fully Production-Grade Once We Have This

- Batch-wise inventory
- Near-expiry and expired stock reporting
- Stock ageing
- FEFO compliance
- Supplier-wise purchase analysis
- Suggested reorder / purchase reporting
- Supplier scorecards
- Inventory turnover from real movement data
- XYZ analysis
- Stock-out history
- Inventory health dashboard with reliable KPIs

## 6. Current Practical Recommendation

Keep using current Phase 1 data for:

- Batch-wise stock
- Near-expiry
- Expired stock
- Ageing
- FEFO starter queue
- Basic movement reporting

Do not mark these as production-grade until we receive the missing Marg procurement, supplier, quality, and transfer data.