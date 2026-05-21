-- Migration: One-time backfill of is_cancelled / cancelled_on for Marg
-- rows that were staged BEFORE the cancellation columns were introduced.
--
-- The prior schema migration (20260520120000_add_marg_cancellation_columns)
-- added is_cancelled / cancelled_on with DEFAULT FALSE / NULL. Already-
-- staged rows therefore look "live" even when their underlying AddField
-- carries `CANCELLED : 1`. New syncs will fix this for any row Marg
-- re-emits (parseMargCancellation runs at staging time), but rows that
-- Marg does NOT re-emit (e.g. cancelled historic vouchers Marg has since
-- archived) would stay misclassified as live forever.
--
-- This migration parses the AddField token in SQL once and overwrites the
-- two columns wherever it sees the cancellation marker. Performed only on
-- rows whose is_cancelled is currently the default FALSE so we don't
-- accidentally re-process rows that the new staging pipeline has already
-- correctly marked.
--
-- Date format note: Marg emits `CANCELLEDON : dd-MM-yyyy HH:mm:ss`. We
-- parse it as Postgres `TIMESTAMP WITHOUT TIME ZONE` using to_timestamp
-- with the DD-MM-YYYY HH24:MI:SS pattern. If the timestamp is malformed
-- or missing we leave cancelled_on NULL — the boolean flag is the
-- load-bearing signal anyway.
--
-- These are idempotent UPDATEs: re-running the migration is a no-op
-- because rows with `is_cancelled = TRUE` are excluded from the WHERE.

-- ===== marg_vouchers =====
UPDATE "marg_vouchers"
SET
  "is_cancelled" = TRUE,
  "cancelled_on" = (
    -- regexp_match returns NULL if no match, in which case to_timestamp
    -- never executes and cancelled_on stays NULL. The pattern accepts
    -- optional spaces around the colon (Marg's emitted shape varies).
    SELECT to_timestamp(m[1], 'DD-MM-YYYY HH24:MI:SS')
    FROM regexp_match(
      "add_field",
      'CANCELLEDON\s*:\s*(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})'
    ) AS m
    WHERE m IS NOT NULL
  )
WHERE
  "is_cancelled" = FALSE
  AND "add_field" ~ 'CANCELLED\s*:\s*1';

-- ===== marg_transactions =====
UPDATE "marg_transactions"
SET
  "is_cancelled" = TRUE,
  "cancelled_on" = (
    SELECT to_timestamp(m[1], 'DD-MM-YYYY HH24:MI:SS')
    FROM regexp_match(
      "add_field",
      'CANCELLEDON\s*:\s*(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})'
    ) AS m
    WHERE m IS NOT NULL
  )
WHERE
  "is_cancelled" = FALSE
  AND "add_field" ~ 'CANCELLED\s*:\s*1';
