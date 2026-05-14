# Marg eDE Sync Assessment And Redesign

Date: 2026-04-21

## Payload Analysis

### 1. Actual payload shapes observed

Two sample files were inspected:

- `type1`: `C:/Users/Bibek Gupta/marg_corporate_data_11093_20260421_type1.json`
- `type2`: `C:/Users/Bibek Gupta/marg_corporate_data_11093_20260421_type2.json`

Observed result:

- `type2` is the operational payload.
- `type1` is a superset of `type2` and additionally contains accounting entities.
- Both payloads use a `Details` object containing entity collections and cursor metadata.
- Sample cursor values are string timestamps, not timezone-qualified ISO instants.
- Sample cursor status uses vendor strings: `Status=Sucess`, `DataStatus=Completed`, `Index=2000`.

### 2. Entity inventory from the sample

| Entity | Type1 count | Type2 count | Notes |
|---|---:|---:|---|
| `Masters` | 1 | 1 | Branch / company master object |
| `Product` | 1,902 | 1,902 | Product master |
| `Party` | 5,218 | 5,218 | Customer plus accounting subledger-like codes |
| `SaleType` | 1,428 | 1,428 | Sales classification |
| `MDis` | 2,362 | 2,362 | Voucher header |
| `Dis` | 35,269 | 35,269 | Voucher line / movement line |
| `Stock` | 3,468 | 3,468 | Stock / batch snapshot |
| `ACGroup` | 77 | 0 | Accounting group master |
| `Account` | 13,471 | 0 | Accounting posting lines |
| `AcBal` | 77 | 0 | Accounting group balances |
| `PBal` | 5,218 | 0 | Party balances |
| `Outstanding` | 3,839 | 0 | Outstanding receivables / open items |
| `Voucher` | 0 | 0 | Empty collection in sample |
| `Status` | scalar | scalar | Envelope status |
| `DataStatus` / `Datastatus` | scalar | scalar | Envelope completion marker |
| `DateTime` | scalar | scalar | Source cursor watermark |
| `Index` | scalar | scalar | Source cursor page/index |

### 3. Relationship quality observed from the sample

| Relationship candidate | Result | Conclusion |
|---|---:|---|
| `Dis.PID -> Product.PID` | 35,269 / 35,269 matched | Strong FK candidate |
| `Dis.CID -> Party.CID` | 35,269 / 35,269 matched for nonblank CIDs | Strong FK candidate |
| `Stock.PID -> Product.PID` | 3,468 / 3,468 matched | Strong FK candidate |
| `MDis.CID -> Party.CID` | 2,362 / 2,362 matched for nonblank CIDs | Strong FK candidate |
| `Outstanding.ORD -> Party.CID` | 3,839 / 3,839 matched | Strong FK candidate |
| `Outstanding.Group -> Party.SCode` | 3,839 / 3,839 matched | Strong classification FK candidate |
| `AcBal.AID -> ACGroup.AID` | 77 / 77 matched | Strong FK candidate |
| `PBal.CID -> Party.CID` | 5,218 / 5,218 matched after `upper(trim(cid))` normalization | Must normalize key |
| `Account.GCode -> ACGroup.AID` | 13,470 / 13,471 matched | Strong FK candidate |
| `Account.Voucher -> MDis.Voucher` | 10,119 / 13,471 matched | Soft link only |
| `Account.Remark -> MDis.VCN` | 9,691 / 13,471 matched | Soft link only |
| `Outstanding.Voucher -> MDis.Voucher` | 1,875 / 3,839 matched | Not a hard FK |
| `Outstanding.VCN -> MDis.VCN` | 1,797 / 3,839 matched | Not a hard FK |

### 4. Duplicate and data-quality signals from the sample

| Check | Result | Implication |
|---|---:|---|
| `Product` duplicate `(CompanyID, PID)` | 0 | Good natural key |
| `Party` duplicate `(CompanyID, CID)` | 2 | Deduplicate exact duplicates |
| `PBal` duplicate normalized `(CompanyID, upper(trim(CID)))` | 2 | Case normalization required |
| `Dis` duplicate `ID` | 0 | Strong source row key |
| `Stock` duplicate `(CompanyID, PID, trim(Batch))` | 0 | Good natural key |
| `ACGroup` duplicate `(CompanyID, AID)` | 0 | Good natural key |
| `AcBal` duplicate `(CompanyID, AID)` | 0 | Good natural key |
| `Account` duplicate `ID` | 0 | Strong source row key |
| `Account` voucher/date groups not balancing to zero | 16 / 3,566 groups | Need exception handling / source QA |
| `MDis.Final` vs `Dis.Amount + GSTAmount` | 2,095 / 2,279 matched by `VCN` within 1 INR | Header is a financial total, but not universally perfect |

### 5. Field-level mapping requirement

Every source field must either be:

- stored in an explicit typed column, or
- stored in `raw_payload jsonb`, or
- explicitly marked unused.

The only field that should remain `raw_payload`-only for now is the top-level `Voucher` collection because the sample contains zero rows and there is no observed semantics to normalize yet.

| Source entity | Source fields | Required database mapping |
|---|---|---|
| Envelope | `Status`, `DataStatus`, `Datastatus`, `DateTime`, `Index` | `marg_sync_pages.status_text`, `data_status_raw`, `data_status_code`, `cursor_datetime_raw`, `cursor_datetime_utc`, `cursor_index`, plus full page `payload_json` |
| `Masters` | `ID`, `CompanyID`, `Code`, `Name`, `StoreID`, `Licence`, `Branch` | `marg_branches.source_row_id`, `company_id`, `code`, `name`, `store_id`, `licence`, `branch_name`, `raw_payload` |
| `Product` | `ID`, `CompanyID`, `PID`, `Code`, `Name`, `Unit`, `Pack`, `GCode`, `GCode3`, `GCode5`, `GCode6`, `GST`, `MargCode`, `AddField` | `marg_products.source_row_id`, `company_id`, `pid_raw`, `pid_normalized`, `code`, `name`, `unit`, `pack`, `g_code`, `g_code3`, `g_code5`, `g_code6`, `gst_rate`, `marg_code`, `add_field_text`, `row_hash`, `raw_payload` |
| `Party` | `ID`, `CompanyID`, `GSTNo`, `Rout`, `Area`, `MR`, `SCode`, `CID`, `ParNam`, `PARADD`, `ParAdd1`, `ParAdd2`, `Rate`, `Phone1`, `Phone2`, `Phone3`, `Phone4`, `Credit`, `CRDays`, `CRBills`, `CRStatus`, `MargCode`, `AddField`, `DlNo`, `Pin`, `Lat`, `Lng`, `Is_Deleted` | `marg_parties.source_row_id`, `company_id`, `cid_raw`, `cid_normalized`, `gst_no`, `route_code`, `area_code`, `mr_code`, `s_code`, `name`, `address_0`, `address_1`, `address_2`, `rate_code`, `phone1..4`, `credit_limit`, `credit_days`, `credit_bills`, `credit_status`, `marg_code`, `add_field_text`, `dl_no`, `pin`, `lat`, `lng`, `is_deleted`, `row_hash`, `raw_payload` |
| `SaleType` | `ID`, `CompanyID`, `SGCode`, `SCode`, `Name`, `Main`, `MargCode`, `AddField` | `marg_sale_types.source_row_id`, `company_id`, `sg_code`, `s_code`, `name`, `main_code`, `marg_code`, `add_field_text`, `row_hash`, `raw_payload` |
| `MDis` | `ID`, `CompanyID`, `Voucher`, `Type`, `VCN`, `Date`, `CID`, `Final`, `Cash`, `Others`, `Salun`, `MR`, `Rout`, `Area`, `ORN`, `AddField`, `ODate` | `marg_vouchers.source_row_id`, `company_id`, `voucher_no_raw`, `voucher_no_normalized`, `voucher_type`, `document_no`, `voucher_date`, `cid_raw`, `cid_normalized`, `final_amount`, `cash_amount`, `other_amount`, `salesman_code`, `mr_code`, `route_code`, `area_code`, `order_ref_no`, `add_field_text`, `order_date`, `row_hash`, `raw_payload` |
| `Dis` | `ID`, `CompanyID`, `Voucher`, `Type`, `VCN`, `Date`, `CID`, `PID`, `GCode`, `Batch`, `BatDet`, `Qty`, `Free`, `MRP`, `Rate`, `Discount`, `Amount`, `GST`, `GSTAmount`, `AddField` | `marg_transactions.source_row_id`, `company_id`, `voucher_no_raw`, `voucher_no_normalized`, `voucher_type`, `document_no`, `line_date`, `cid_raw`, `cid_normalized`, `pid_raw`, `pid_normalized`, `g_code`, `batch_raw`, `batch_normalized`, `batch_detail`, `qty`, `free_qty`, `mrp`, `rate`, `discount_amount`, `line_amount`, `gst_rate`, `gst_amount`, `add_field_text`, `row_hash`, `raw_payload` |
| `Stock` | `ID`, `CompanyID`, `PID`, `GCode`, `Batch`, `BatDate`, `BatDet`, `Expiry`, `SupInvo`, `SupDate`, `SupCode`, `Opening`, `Stock`, `BrkStock`, `LPRate`, `PRate`, `MRP`, `RateA`, `RateB`, `RateC`, `AddField` | `marg_stocks.source_row_id`, `company_id`, `pid_raw`, `pid_normalized`, `g_code`, `batch_raw`, `batch_normalized`, `batch_date`, `batch_detail`, `expiry_date`, `supplier_invoice_no`, `supplier_invoice_date`, `supplier_code`, `opening_qty`, `stock_qty`, `broken_qty`, `landing_price_rate`, `purchase_rate`, `mrp`, `rate_a`, `rate_b`, `rate_c`, `add_field_text`, `row_hash`, `last_seen_run_id`, `source_deleted`, `raw_payload` |
| `ACGroup` | `ID`, `CompanyID`, `AID`, `Name`, `Under`, `AddField` | `marg_account_groups.source_row_id`, `company_id`, `aid_raw`, `aid_normalized`, `name`, `parent_aid_raw`, `parent_aid_normalized`, `add_field_text`, `row_hash`, `raw_payload` |
| `Account` | `ID`, `CompanyID`, `Voucher`, `Date`, `Code`, `Amount`, `Book`, `Code1`, `GCode`, `Remark`, `AddField` | `marg_account_postings.source_row_id`, `company_id`, `voucher_no_raw`, `voucher_no_normalized`, `posting_date`, `party_code_raw`, `party_code_normalized`, `amount_signed`, `book_code`, `counterparty_code_raw`, `counterparty_code_normalized`, `group_aid_raw`, `group_aid_normalized`, `remark_text`, `add_field_text`, optional soft link columns to `marg_vouchers`, `marg_parties`, `marg_account_groups`, plus `row_hash`, `raw_payload` |
| `AcBal` | `ID`, `CompanyID`, `AID`, `Opening`, `Balance` | `marg_account_group_balances.source_row_id`, `company_id`, `aid_raw`, `aid_normalized`, `opening_amount`, `balance_amount`, `row_hash`, `raw_payload` |
| `PBal` | `ID`, `CompanyID`, `CID`, `Opening`, `Balance` | `marg_party_balances.source_row_id`, `company_id`, `cid_raw`, `cid_normalized`, `opening_amount`, `balance_amount`, `row_hash`, `raw_payload` |
| `Outstanding` | `ID`, `CompanyID`, `ORD`, `Date`, `VCN`, `Days`, `Final`, `Balance`, `PdLess`, `Group`, `Voucher`, `SVoucher`, `AddField` | `marg_outstandings.source_row_id`, `company_id`, `ord_party_cid_raw`, `ord_party_cid_normalized`, `outstanding_date`, `document_no`, `days_outstanding`, `final_amount`, `balance_amount`, `pd_less_amount`, `party_group_scode_raw`, `party_group_scode_normalized`, `voucher_no_raw`, `voucher_no_normalized`, `settlement_voucher_no_raw`, `settlement_voucher_no_normalized`, `add_field_text`, `row_hash`, `raw_payload` |
| Top-level `Voucher` collection | Empty in sample | Retain in `marg_sync_pages.payload_json`; do not create dedicated normalized table until non-empty sample is observed |

## Entity And Relationship Mapping

### 1. Inventory / operational side

- `Masters.CompanyID` is the branch / location anchor.
- `Product.PID` is the item key within `CompanyID`.
- `Party.CID` is the party key within `CompanyID`.
- `SaleType.(SGCode, SCode)` is a classification dimension.
- `MDis` is a voucher header.
- `Dis` is a line-level transactional fact.
- `Stock` is a product+batch snapshot fact.

Operational relationships:

- `Dis.PID -> Product.PID`
- `Dis.CID -> Party.CID`
- `Dis.Voucher` and `Dis.VCN` soft-link to `MDis`
- `Stock.PID -> Product.PID`
- `MDis.CID -> Party.CID`
- `Outstanding.ORD -> Party.CID`

### 2. Accounting side

- `ACGroup.AID` is the accounting group key.
- `AcBal.AID -> ACGroup.AID` is a group balance fact.
- `PBal.CID -> Party.CID` is a party balance fact after normalized `CID`.
- `Account.ID` is the only safe posting-row primary key.
- `Account.GCode -> ACGroup.AID` is the most reliable hard accounting relationship.
- `Account.Code` and `Account.Code1` are party-like posting codes and both resolve against `Party.CID` in the sample, but they are not redundant.
- `Outstanding.Group -> Party.SCode` fully resolves in the sample.
- `Outstanding.Voucher` and `Outstanding.VCN` are only soft links.

Design rule:

- `Voucher`-based joins are optional analytical joins, not referential constraints.
- `ORD`, `CID`, `PID`, `AID`, `SCode`, `GCode` must be normalized with `upper(trim(value))` before key comparison.

## Database Schema

### 1. Control and observability tables

#### `marg_pipeline_states`

One row per `config_id + pipeline_type`.

Columns:

- `id uuid pk`
- `config_id uuid not null`
- `tenant_id uuid not null`
- `pipeline_type text not null check in ('inventory','accounting')`
- `is_active boolean not null default true`
- `last_successful_run_id uuid null`
- `last_successful_cursor_datetime_raw text null`
- `last_successful_cursor_datetime_utc timestamptz null`
- `last_successful_cursor_index integer null`
- `last_successful_business_date date null`
- `last_heartbeat_at timestamptz null`
- `last_status text not null`
- `updated_at timestamptz not null`

Indexes:

- unique `(config_id, pipeline_type)`
- index `(tenant_id, pipeline_type, last_status)`
- index `(tenant_id, last_heartbeat_at)`

#### `marg_sync_runs`

One row per execution.

Columns:

- `id uuid pk`
- `pipeline_state_id uuid not null`
- `tenant_id uuid not null`
- `pipeline_type text not null`
- `triggered_by text null`
- `requested_start_date date null`
- `requested_end_date date null`
- `effective_cursor_datetime_raw text null`
- `effective_cursor_index integer null`
- `status text not null`
- `started_at timestamptz not null`
- `completed_at timestamptz null`
- `pages_fetched integer not null default 0`
- `rows_staged integer not null default 0`
- `rows_projected integer not null default 0`
- `rows_failed integer not null default 0`
- `error_summary jsonb not null default '[]'`

Indexes:

- index `(tenant_id, pipeline_type, started_at desc)`
- index `(pipeline_state_id, started_at desc)`

#### `marg_sync_pages`

Persist one row per source page/snapshot.

Columns:

- `id uuid pk`
- `run_id uuid not null`
- `tenant_id uuid not null`
- `pipeline_type text not null`
- `api_type text not null check in ('1','2')`
- `cursor_index integer null`
- `cursor_datetime_raw text null`
- `cursor_datetime_utc timestamptz null`
- `status_text text null`
- `data_status_raw text null`
- `data_status_code integer null`
- `payload_hash char(64) not null`
- `payload_json jsonb not null`
- `received_at timestamptz not null default now()`

Indexes:

- unique `(run_id, payload_hash)`
- index `(tenant_id, pipeline_type, received_at desc)`

#### `marg_failed_records`

Per-row failure tracking.

Columns:

- `id uuid pk`
- `run_id uuid not null`
- `tenant_id uuid not null`
- `pipeline_type text not null`
- `entity_name text not null`
- `source_key text not null`
- `stage_table text not null`
- `error_code text null`
- `error_message text not null`
- `payload_fragment jsonb not null`
- `retry_count integer not null default 0`
- `resolved_at timestamptz null`

Indexes:

- index `(run_id, entity_name)`
- index `(tenant_id, resolved_at)`

### 2. Staging tables to keep and alter

Keep existing stage tables but alter them as follows:

- change all `marg_id` / `source_row_id` columns to `bigint`
- add `row_hash char(64) not null`
- add `last_seen_run_id uuid not null`
- add `source_deleted boolean not null default false` for snapshot entities
- add normalized key columns for padded string identifiers
- keep `raw_payload jsonb not null`

Tables to alter:

- `marg_branches`
- `marg_products`
- `marg_parties`
- `marg_sale_types`
- `marg_vouchers`
- `marg_transactions`
- `marg_stocks`

### 3. New accounting stage tables

#### `marg_account_groups`

Columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `source_row_id bigint not null`
- `aid_raw varchar(20) not null`
- `aid_normalized varchar(20) not null`
- `name varchar(255) not null`
- `parent_aid_raw varchar(20) null`
- `parent_aid_normalized varchar(20) null`
- `add_field_text text null`
- `row_hash char(64) not null`
- `last_seen_run_id uuid not null`
- `raw_payload jsonb not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- unique `(tenant_id, company_id, aid_normalized)`
- index `(tenant_id, company_id, parent_aid_normalized)`

#### `marg_account_postings`

Columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `source_row_id bigint not null`
- `voucher_no_raw varchar(50) null`
- `voucher_no_normalized varchar(50) null`
- `posting_date date not null`
- `book_code varchar(10) not null`
- `party_code_raw varchar(20) null`
- `party_code_normalized varchar(20) null`
- `counterparty_code_raw varchar(20) null`
- `counterparty_code_normalized varchar(20) null`
- `group_aid_raw varchar(20) null`
- `group_aid_normalized varchar(20) null`
- `amount_signed numeric(18,4) not null`
- `remark_text varchar(255) null`
- `add_field_text text null`
- `voucher_stage_id uuid null`
- `party_stage_id uuid null`
- `counterparty_stage_id uuid null`
- `group_stage_id uuid null`
- `row_hash char(64) not null`
- `last_seen_run_id uuid not null`
- `raw_payload jsonb not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- unique `(tenant_id, company_id, source_row_id)`
- index `(tenant_id, company_id, voucher_no_normalized)`
- index `(tenant_id, company_id, posting_date)`
- index `(tenant_id, company_id, group_aid_normalized)`

#### `marg_account_group_balances`

Columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `source_row_id bigint not null`
- `aid_raw varchar(20) not null`
- `aid_normalized varchar(20) not null`
- `opening_amount numeric(18,4) not null`
- `balance_amount numeric(18,4) not null`
- `group_stage_id uuid null`
- `row_hash char(64) not null`
- `last_seen_run_id uuid not null`
- `raw_payload jsonb not null`

Indexes:

- unique `(tenant_id, company_id, aid_normalized)`

#### `marg_party_balances`

Columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `source_row_id bigint not null`
- `cid_raw varchar(20) not null`
- `cid_normalized varchar(20) not null`
- `opening_amount numeric(18,4) not null`
- `balance_amount numeric(18,4) not null`
- `party_stage_id uuid null`
- `row_hash char(64) not null`
- `last_seen_run_id uuid not null`
- `raw_payload jsonb not null`

Indexes:

- unique `(tenant_id, company_id, cid_normalized)`

#### `marg_outstandings`

Columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `source_row_id bigint not null`
- `ord_party_cid_raw varchar(20) not null`
- `ord_party_cid_normalized varchar(20) not null`
- `outstanding_date date not null`
- `document_no varchar(50) null`
- `days_outstanding integer not null`
- `final_amount numeric(18,4) not null`
- `balance_amount numeric(18,4) not null`
- `pd_less_amount numeric(18,4) not null`
- `party_group_scode_raw varchar(20) null`
- `party_group_scode_normalized varchar(20) null`
- `voucher_no_raw varchar(50) null`
- `voucher_no_normalized varchar(50) null`
- `settlement_voucher_no_raw varchar(50) null`
- `settlement_voucher_no_normalized varchar(50) null`
- `party_stage_id uuid null`
- `voucher_stage_id uuid null`
- `settlement_voucher_stage_id uuid null`
- `row_hash char(64) not null`
- `last_seen_run_id uuid not null`
- `raw_payload jsonb not null`

Indexes:

- unique `(tenant_id, company_id, source_row_id)`
- index `(tenant_id, company_id, ord_party_cid_normalized)`
- index `(tenant_id, company_id, voucher_no_normalized)`
- index `(tenant_id, company_id, document_no)`

### 4. Projection and reporting tables

#### Inventory projections

Continue projecting into core tables, but with stricter rules:

- `locations`
- `products`
- `inventory_levels`
- `batches`
- `inventory_transactions`
- `inventory_ledger`

Required changes:

- inventory snapshot entities must be `seen_in_run` and tombstoned when absent from a completed source snapshot
- `inventory_transactions` and `inventory_ledger` must be written through idempotent bulk upserts, not row-by-row existence checks
- `inventory_ledger.running_balance` must be computed, not left null

#### Accounting projections

To support trial balance and P&L correctly, add:

- `marg_gl_mapping_rules`
- `marg_projection_state`

`marg_gl_mapping_rules` columns:

- `id uuid pk`
- `tenant_id uuid not null`
- `company_id integer not null`
- `book_code varchar(10) null`
- `group_aid_normalized varchar(20) null`
- `party_code_normalized varchar(20) null`
- `counterparty_code_normalized varchar(20) null`
- `gl_account_id uuid not null`
- `priority integer not null default 0`
- `is_active boolean not null default true`

Indexes:

- index `(tenant_id, company_id, priority)`
- index `(tenant_id, gl_account_id)`

Projection target:

- `gl_accounts` are the internal chart of accounts
- `journal_entries` are grouped by `(tenant_id, company_id, voucher_no_normalized, book_code, posting_date)` when voucher-linked, otherwise by `(source_row_id)` fallback
- `journal_entry_lines` are generated from `marg_account_postings`
- optional `accounts` dimension can be populated from `marg_account_groups` for planning actuals by account dimension

## Sync Architecture Design

### 1. Split the pipelines

Run two independent pipelines per Marg configuration:

- Inventory pipeline:
  - API types consumed: `2`
  - Entities: `Masters`, `Product`, `Party`, `SaleType`, `MDis`, `Dis`, `Stock`
  - Outputs: products, locations, customers, inventory snapshot, batches, inventory movement, sales/purchase actuals

- Accounting pipeline:
  - API types consumed: `1`
  - Entities: all inventory entities above plus `ACGroup`, `Account`, `AcBal`, `PBal`, `Outstanding`
  - Outputs: Marg-native accounting mart, GL journals, trial balance, P&L, AR aging / outstanding analysis

Do not share cursors between these pipelines.

### 2. Pipeline stages

1. Acquire pipeline lock on `marg_pipeline_states`
2. Create `marg_sync_runs` row
3. Fetch source pages
4. Persist every page in `marg_sync_pages`
5. Stage entity rows with bulk upserts
6. Reconcile stage counts and FK quality
7. Project staged rows to core tables in deterministic batches
8. Run financial and inventory validations
9. Commit pipeline state cursor only after stage + projection + validation succeed

### 3. Failure and restart behavior

- A failed inventory run does not block accounting.
- A failed accounting run does not block inventory.
- Re-running a run with the same cursor is safe because stage tables and projection targets use stable natural keys and row hashes.
- Failed rows go to `marg_failed_records`; they do not disappear in logs.

## Incremental Sync Strategy

### 1. Current approach is not reliable enough

The current design stores one `lastSyncDatetime` and `lastSyncIndex` on the configuration and reuses it for all data.

That is not sufficient because:

- inventory and accounting have different payload types and potentially different completion points
- `DateTime` is a vendor cursor string (`2026-04-21 16:36:51`), not a timezone-safe ISO instant
- the source rows do not contain `updated_at`, so late corrections cannot be proven from business dates alone
- the source can behave as a snapshot for stock and an incremental feed for transactions

### 2. Recommended cursor design

Per pipeline store:

- `cursor_datetime_raw`
- `cursor_datetime_utc`
- `cursor_index`
- `last_success_business_date`
- `last_heartbeat_at`

Rules:

- treat vendor `DateTime` as an opaque cursor for extraction
- parse it into UTC only for observability using configured source timezone `Asia/Kolkata`
- use business `Date` values for projection windows and reconciliation, not as the source cursor

### 3. Overlap / backscan window

Because there is no row-level `updated_at`, automatic incremental must include an overlap window.

Recommendation:

- inventory overlap: 2 days
- accounting overlap: 7 days

Process:

- start from the last successful cursor
- additionally re-stage and re-project rows whose business date is within the overlap window
- compare `row_hash`; skip unchanged rows
- apply deterministic upserts so replay does not duplicate data

### 4. Manual backfill support

Expose:

- `start_date`
- `end_date`

Behavior:

- `start_date` seeds the source extraction cursor where supported
- `end_date` constrains downstream projection and validation by business date
- if the source API cannot natively stop at `end_date`, continue staging pages but only promote rows where business date is in `[start_date, end_date]`
- backfill runs must not advance the normal incremental cursor unless explicitly requested with `commit_cursor=true`

### 5. Idempotent cursor commit

Commit the pipeline cursor only after:

- all pages are persisted
- all stage upserts succeed
- all projections succeed
- validations pass or are explicitly waived

## Performance Optimization Plan

### 1. Current bottlenecks

The current implementation is slow because it performs:

- row-by-row `upsert` for every staged entity
- row-by-row `findFirst` lookups in transforms
- row-by-row `create` for `Actual`, `InventoryTransaction`, and `InventoryLedger`
- repeated full-table scans of stage tables for inventory projections

### 2. Required redesign

#### Staging

- fetch one page
- normalize all rows in memory
- bulk load using `INSERT ... ON CONFLICT DO UPDATE` by natural key
- update only when `row_hash` changes

#### Projection

- pre-load dimension maps per batch: product, party, branch, sale type, account group
- bulk create / upsert projection rows in batches of 500 to 2,000
- write `Actual`, `InventoryTransaction`, `InventoryLedger`, `JournalEntryLine` via batched SQL, not one ORM call per row

#### Parallelism

Safe parallel units:

- inventory pipeline and accounting pipeline can run in parallel
- within a pipeline, stage independent entities in parallel after page persistence
- projection order must remain deterministic where there are dependencies:
  - branches before stock
  - products before transactions and stock
  - parties before vouchers and accounting projections

### 3. Hash-based update suppression

For every staged row, calculate `row_hash = sha256(canonical_json(source_row))`.

If the natural key exists and `row_hash` is unchanged:

- do not issue update
- only refresh `last_seen_run_id`

This removes most unnecessary writes during overlapping replays.

### 4. Snapshot handling for stock

`Stock` is a snapshot entity.

At the end of a successful inventory run:

- mark all stock rows seen in the run as active
- mark previously active rows not seen in the run as `source_deleted = true`
- zero out or close projected inventory/batch rows derived only from `source_deleted` stock rows

Without this, stale stock remains forever.

## Data Validation Strategy

### 1. Structural validations

Run on every sync:

- source page count vs staged row count by entity
- duplicate natural key count by entity
- orphan FK count by entity
- row-hash change count
- source-deleted count for snapshot entities

### 2. Referential validations

Minimum checks:

- `Dis -> Product`
- `Dis -> Party` for nonblank `CID`
- `Stock -> Product`
- `MDis -> Party` for nonblank `CID`
- `Outstanding -> Party` via `ORD`
- `Outstanding -> Party.SCode` via `Group`
- `Account -> ACGroup` via `GCode`
- `PBal -> Party` via normalized `CID`

### 3. Inventory report validations

- stock summary by product and location from `marg_stocks` must equal projected `inventory_levels`
- batch quantities by product/location must equal projected `batches`
- movement totals from `Dis` by `Type` must equal projected `inventory_transactions`
- negative stock count, expired stock count, and near-expiry exposure must reconcile between stage and reporting tables

### 4. Accounting report validations

- `sum(journal_entry_lines.debit) = sum(journal_entry_lines.credit)` per journal entry
- trial balance net debits/credits must reconcile to summed staged `Account.amount_signed`
- AR aging from `marg_outstandings` must reconcile to projected outstanding report
- party balance report from `marg_party_balances` must reconcile to account postings by party code

### 5. Sales and purchase validations

- `Dis` line totals by `VCN` should reconcile to `MDis.Final` within configurable tolerance when expected formula is `Amount + GSTAmount`
- exceptions must be logged, not silently ignored

## Identified Issues In Current System

1. Only `APIType='2'` is fetched. The accounting-only entities from `type1` are completely ignored.
2. The system has one sync cursor per config instead of one cursor per pipeline.
3. The stale-run reset logic used `lastSyncAt`, which tracks the last successful sync instead of current activity. This can mark a live run as failed. This was patched in this pass.
4. `MargSyncLog` stored the previous cursor rather than the effective starting cursor for manual backfills. This was patched in this pass.
5. There is no `end_date` backfill support.
6. `DateTime` is stored as raw text without timezone-safe semantics.
7. `parseMargDate` mixes UTC date parsing and local-time `new Date(string)` parsing.
8. Staging is row-by-row ORM upsert. This will not scale.
9. Projections are row-by-row and contain heavy N+1 lookups.
10. `marg_transactions` dedupe key is `sourceKey`, but `sourceKey` includes mutable fields (`Voucher`, `Date`, `PID`, `Batch`, `Type`). A corrected source row with the same source `ID` can generate a new key and duplicate downstream facts.
11. `Actual` has no unique idempotency constraint on `sourceReference`, so a crash between `actual.create()` and `margTransaction.actualId` update can duplicate actuals.
12. `InventoryTransaction` and `InventoryLedger` rely on application-side `findFirst` checks against `referenceNumber` and have no unique constraint. They are not crash-safe.
13. `transformTransactionsToInventoryLedger` writes absolute quantities and leaves `runningBalance` null, so the append-only ledger is not a true reconstructable stock ledger.
14. The sync writes directly to core tables instead of using a dedicated projector state machine.
15. `Stock` is treated as upsert-only. Missing source rows are never tombstoned, so stale stock and stale batches can remain forever.
16. `Batch` uniqueness is only `(tenantId, batchNumber)`. If the same batch number can exist for different products or locations, collisions will occur.
17. `Masters` in the main payload is an object, not an array. The current `fetchData()` parser would ignore it if branch fetch had to rely on POST payload content.
18. `Outstanding.Voucher` is not a reliable foreign key to `MDis.Voucher`.
19. `Account.Voucher` is not a reliable foreign key to `MDis.Voucher`.
20. `Account.GCode` is the real accounting group key, but there is no stage table for `ACGroup` or `Account` today.
21. All `Party` rows are projected into `Customer`, but the sample contains at least 143 obvious tax / surcharge / TDS / TCS pseudo-parties. This pollutes the customer master and downstream reports.
22. Duplicate and constraint exceptions are silently swallowed in some transforms instead of being written to a failure table.
23. `MargSyncLog` only stores aggregate counts and JSON errors, not page-level lineage or failed-record details.
24. There is no automated trial balance, stock summary, or AR reconciliation step after sync.

## Recommended Fixes (Step-by-step)

### P0: Immediate safety fixes

1. Keep the stale-run detection patch using `updatedAt` / heartbeat, not `lastSyncAt`.
2. Keep the sync-log cursor patch so manual backfills are traceable.
3. Stop projecting every `Party` row into `Customer`. Add classification logic or a mapping table first.
4. Add a migration plan to replace `marg_transactions` uniqueness from `sourceKey` to `(tenant_id, company_id, source_row_id)`.
5. Add database uniqueness for projection idempotency:
   - `actuals(tenant_id, source_system, source_reference)`
   - `inventory_transactions(tenant_id, reference_type, reference_number)`
   - `inventory_ledger(tenant_id, reference_type, reference_number, product_id, location_id)` or a dedicated `idempotency_key`

### P1: Schema completion

6. Add `marg_pipeline_states`, `marg_sync_runs`, `marg_sync_pages`, `marg_failed_records`.
7. Add the missing accounting stage tables:
   - `marg_account_groups`
   - `marg_account_postings`
   - `marg_account_group_balances`
   - `marg_party_balances`
   - `marg_outstandings`
8. Alter existing stage tables to add normalized keys, `row_hash`, `last_seen_run_id`, and `source_deleted` where needed.

### P1: Pipeline split

9. Split the existing `runSync()` into:
   - `runInventorySync()` using `APIType=2`
   - `runAccountingSync()` using `APIType=1`
10. Give each pipeline its own cursor state and run log.

### P1: Performance redesign

11. Replace row-by-row stage upserts with batched `INSERT ... ON CONFLICT DO UPDATE`.
12. Preload lookup maps for products, parties, branches, account groups, and vouchers before projection.
13. Replace row-by-row `create` calls for actuals, inventory transactions, inventory ledger, and journal lines with batched writes.

### P1: Snapshot correctness

14. For `Stock`, mark stage rows not seen in a completed run as `source_deleted=true`.
15. Project deleted stock rows to zeroed inventory levels and closed / consumed batches.

### P2: Accounting projection

16. Add `marg_gl_mapping_rules` to map Marg books and account groups to internal `gl_accounts`.
17. Generate `journal_entries` and `journal_entry_lines` from `marg_account_postings`.
18. Populate planning `accounts` only from approved mapped groups, not directly from raw party codes.

### P2: Validation and observability

19. Add post-run validation jobs for stock summary, batch balances, trial balance, AR aging, and voucher reconciliation.
20. Write per-row failures to `marg_failed_records` and expose them in API/UI.
21. Add per-page payload hashes and per-entity row counts to `marg_sync_pages`.

## Bottom line

The current Marg sync can support some operational reporting from the `type2` payload, but it is not production-safe for full inventory correctness and it does not support accounting reporting at all.

It cannot reliably produce:

- accurate trial balance
- correct P&L
- dependable AR / outstanding reporting
- crash-safe idempotent re-runs
- snapshot-correct stock and batch state over time

To reach production-grade reliability, the system must be split into inventory and accounting pipelines, complete the accounting staging model, enforce database-level idempotency, add snapshot tombstoning for stock, and validate reports after every sync.