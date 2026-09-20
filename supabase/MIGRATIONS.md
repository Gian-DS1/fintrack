# Migrations — order and production notes

These migrations are run **by hand** in the Supabase SQL editor. They are all
**idempotent** (`if not exists`, `drop policy if exists`, `not exists` copies),
so re-running them against a database with data is safe.

## To ship the redesign (UI branch) onto a database with existing data

Run them **in this order** before (or together with) deploying the new code:

1. **`add_savings_contributions.sql`** — adds `currency` and `monthly_contribution`
   to `savings`, and creates the `savings_contributions` table.
2. **`add_savings_horizon.sql`** — adds `horizon` to `savings` and copies the rows
   from `plans` into `savings` (Plan→Savings merge).

⚠️ **Order matters.** `add_savings_horizon.sql` writes the
`currency`/`monthly_contribution` columns created by migration #1. Running them in
reverse fails with `column "currency" of relation "savings" does not exist`.

> The `plans` table is NOT dropped (it is left orphaned after the merge). Drop it
> by hand only once you have verified that the goals migrated correctly.

### What happens if you deploy the code BEFORE running these migrations?
- **Reads:** safe. The Savings screen loads; missing columns fall back to their
  defaults and contributions degrade to an empty list.
- **Writes:** creating/editing/restoring a savings goal **fails with a clear toast**
  ("…a database migration may be missing") instead of failing silently. It does not
  corrupt data. Logging a contribution also warns with a toast.
- The rest of the app (transactions, debts, cards, budget, categories) is **not
  affected** by these migrations: its legacy data reads and writes unchanged.

Bottom line: ideally run both migrations (in order) and then deploy. If the code
ships first, the app does not break; only creating/editing savings goals is
temporarily disabled with a notice, until the migrations are run.

## Guided tutorial (product tour)

**`add_tutorial_seen.sql`** — adds the `tutorial_seen boolean` column to
`profiles`. It controls that the guided tutorial only starts the **first time**.

### What happens if you deploy the code BEFORE running this migration?
- **Reads:** safe. `fetchPrefs` ignores the missing column and `tutorialSeen`
  stays at its default (`false`).
- **Temporary effect:** because "already seen" cannot be persisted to Supabase, the
  tour auto-start could reappear on every device/reload until the column exists (the
  local cache mitigates this within the same browser). The rest of the app is not
  affected. Running the migration resolves the auto-start.

## Card opening balance (prior debt)

**`add_card_opening_balance.sql`** — adds `opening_balance numeric` to
`credit_cards`. It lets the user record the debt they ALREADY had on the card when
they started using the app, without creating transactions or affecting the budget.

### What happens if you deploy the code BEFORE running this migration?
- **Reads:** safe. The missing column falls back to `0` (the code uses `|| 0`), so
  the balance behaves as it does today.
- **Writes:** saving a card with an opening balance would fail to persist that
  column until the migration is run. The rest (statement/payment/cashback) is not
  affected. Running the migration enables the field.

## globalize_single_currency.sql (2026-06-11)
Globalization: adds `profiles.currency` (default DOP), creates missing profiles,
and converts EVERYTHING stored in USD to DOP using the rate edited in the script
(the original amount is noted in `notes` on `transactions`). Run BEFORE deploying
the single-currency code. Irreversible.

## Financial model — liquid cash + waterfall (2026-06-15)

To enable liquid cash and the cash→savings waterfall on real accounts. Run
**before** deploying the phase-2 code:

1. **`add_initial_cash_balance.sql`** — adds `profiles.initial_cash_balance`
   (numeric, default 0): the cash the user declares at the start. Existing users
   start at 0 and declare it later in Settings (the dashboard shows them the
   "Declare your current cash" notice).
2. **`add_debt_payment_savings_used.sql`** — adds `debt_payments.savings_used`
   (jsonb, default `[]`): which goal the waterfall drew from when paying, so the
   exact payment can be reverted. (Cards store this in their existing `payments`
   jsonb column; no migration needed.)

Both are idempotent and additive. The order between them does not matter (they are
independent).

### What happens if you deploy the code BEFORE running these migrations?
- **`initial_cash_balance`:** `fetchPrefs` reads the column; if it does not exist,
  Supabase returns an error and falls back to the "new user" flow without breaking,
  but the initial cash is not loaded until the migration is run.
- **`savings_used`:** saving a debt payment with a waterfall would fail to persist
  that column until the migration is run. Other payments (without a waterfall) are
  not affected.

## Budget groups (2026-07-02)

**`add_budget_groups.sql`** — creates the `budget_groups` table (with RLS and
grants). It lets the user group several budget categories to see their combined
total in Budget (e.g. Bravo + Grupo CCN + Supermercado = "Supermercados").
Idempotent and additive.

### What happens if you deploy the code BEFORE running this migration?
- **Reads:** safe. The groups section loads empty (the fetch degrades to an empty
  list without breaking the Budget tab).
- **Writes:** creating/editing/deleting a group fails with a clear toast ("…a
  database migration may be missing"). It does not corrupt data. Running the
  migration enables the feature.

## Card payment reminders by email (2026-09-19)

**`add_card_reminders.sql`** — adds two preference columns to `profiles`
(`reminders_enabled`, `reminder_days_before`) and creates the `reminder_log`
table (with RLS and grants) used to deduplicate sent reminders. Idempotent and
additive.

Powers the daily cron `/api/cron/card-reminders`, which emails the user before a
credit card's due date. `reminder_log`'s composite primary key
(`user_id, card_id, due_date, offset_key, channel`) is what guarantees a given
notice is sent only once; the cron writes the row **after** a successful send, so
a mail failure is simply retried the next day.

`offset_key` is the day offset relative to the due date: `5`/`1` for the
configurable advance notices, `0` for "due today", and `-1..-3` for overdue.

### What happens if you deploy the code BEFORE running this migration?
- **Reads:** safe. `fetchPrefs` falls back to the defaults (reminders on, 5 and 1
  days before), and the cron endpoint logs a warning and returns
  `200 { sent: 0, skipped: 'migration' }` instead of failing.
- **Writes:** the reminders toggle in Settings fails and rolls back optimistically.
  No data is corrupted. Running the migration enables the feature.
- **Emails:** none are sent until the migration runs and the Vercel env vars
  (`RESEND_API_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, …) are set — see
  `.env.example`.

## Previous migrations (already applied in historical production)

`schema.sql` is the canonical source of truth (idempotent; it already includes the
new columns and tables with `if not exists`). The other `add_*.sql`/`*.sql` files
(`add_profiles_table`, `add_card_payments_column`, `add_vehiculo_categories`,
`advisor_fixes`, `cleanup_duplicate_categories`) are earlier one-off migrations;
they are not required by the UI redesign.
