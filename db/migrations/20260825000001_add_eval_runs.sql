-- FerrumDeck — one queryable home for eval runs (issue #46).
--
-- WHAT WAS WRONG
--   The eval store was `evals/reports/*.json`: read-only committed records, read
--   straight off disk by the gateway. That served the READ path (#7, closed) and
--   made the WRITE path impossible. A run dispatched at request time had nowhere
--   to persist, so `POST /api/v1/evals/runs` returned 501 with no invented id.
--
-- WHY A TABLE AND NOT MORE FILES
--   The obvious "keep it in one place" answer is to write dispatched runs into
--   `evals/reports/` alongside the committed ones. That is the wrong place:
--     * the directory is git-tracked, so a dispatched run either dirties the
--       working tree of every deployment or is lost on restart (the gateway
--       image bakes those reports in read-only);
--     * concurrent dispatches would race on the filesystem with no transaction —
--       the audit chain (migration 20260801000001) already taught this codebase
--       what an unserialized concurrent write costs;
--     * and it would merge reviewed evidence with unreviewed live output inside
--       the very store `docs/eval-health.md` is generated from.
--
--   So the files stop being a query surface and become an IMPORT SOURCE. This
--   table is the query surface. The committed reports are ingested into it, and
--   dispatched runs are inserted into it. One place, one schema, one ordering.
--
--   The alternative — keep both stores and union them at read time — is "two
--   homes for one number", which this repo has already paid for twice (the
--   executed-test floor lived in two files; the suite definitions had two
--   parsers). A union means two dedup rules and a reader who cannot tell which
--   store answered.
--
-- WHY THE PRIMARY KEY IS THE REPORT FILE STEM
--   `eval_smoke_20260824_030710` is already the id `GET /v1/evals/runs` serves
--   and the dashboard links by. Reusing it means ingest is idempotent for free
--   (ON CONFLICT DO UPDATE), a re-ingest cannot duplicate history, and no new
--   identifier had to be invented for records that already had one.
--
-- WHY `source` EXISTS
--   A committed report is reviewed evidence: it passed CI and lives in git. A
--   dispatched run is whatever someone clicked. A store that cannot tell them
--   apart lets an unreviewed run enter a published figure. `status` says whether
--   a run finished; `source` says whether anyone vouched for it.

CREATE TYPE eval_run_status AS ENUM (
    -- Dispatched and queued. No executor has claimed it.
    'pending',
    -- An executor claimed it and is running it.
    'running',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE eval_run_source AS ENUM (
    -- Ingested from a committed evals/reports/*.json file.
    'committed_report',
    -- Dispatched through POST /v1/evals/runs.
    'dispatched'
);

CREATE TABLE eval_runs (
    -- The report file stem for ingested runs; a generated `evr_<ulid>` for
    -- dispatched ones. See the note above on why this is not a fresh column.
    id TEXT PRIMARY KEY,

    suite TEXT NOT NULL,
    source eval_run_source NOT NULL,
    status eval_run_status NOT NULL DEFAULT 'pending',

    -- The dataset the run executed against. Two suites over different datasets
    -- are not comparable, and a reader cannot see that without this.
    dataset_name TEXT,
    -- The run id the eval harness assigned itself (`eval_ad440ecd64fd`),
    -- distinct from `id`. Lets a dashboard row be traced to the harness record.
    harness_run_id TEXT,

    -- WHEN the numbers below were measured, and how much of that is known.
    -- `precision` is 'second' or 'day': the offline benchmarks carry no clock
    -- time at all, and padding their date to midnight would assert a run that
    -- never happened. NULL for a dispatched run that has not executed — there is
    -- no measurement yet, and 'now' would be a lie.
    measured_at TIMESTAMPTZ,
    measured_at_precision TEXT,
    measured_at_source TEXT,

    -- Headline metric, normalized to a fraction in [0,1]. NULL when the suite's
    -- schema exposes none — never 0.0, which would read as "scored zero".
    primary_metric_name TEXT,
    primary_metric_rate DOUBLE PRECISION,

    -- Fraction of the run's scorer results that asserted anything. NULL for
    -- reports predating the field and for the offline benchmarks, which have no
    -- scorer layer. Never defaulted to 1.0: a suite reporting a perfect score
    -- while half its scorers asserted nothing is the thing this field exposes.
    assertion_coverage DOUBLE PRECISION,

    total_cases BIGINT,
    total_tasks BIGINT,
    passed_tasks BIGINT,
    failed_tasks BIGINT,
    error_tasks BIGINT,
    total_cost_cents DOUBLE PRECISION,
    total_tokens BIGINT,
    total_duration_ms BIGINT,

    anchor TEXT,

    -- The full report as ingested, so nothing is lost to the projection above.
    report JSONB,

    -- Dispatch bookkeeping. `queued_at` is set when a run is accepted;
    -- `started_at` only when an executor claims it. A run with `queued_at` and
    -- no `started_at` is queued and unclaimed — which is exactly what a
    -- dispatched run looks like until an executor exists, and saying so is the
    -- point.
    requested_by TEXT,
    queued_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT eval_runs_measured_precision
        CHECK (measured_at_precision IS NULL
               OR measured_at_precision IN ('second', 'day')),
    -- A rate outside [0,1] means the projection mis-normalized a percentage,
    -- which has happened once already (governed_block_pct is 0-100).
    CONSTRAINT eval_runs_metric_range
        CHECK (primary_metric_rate IS NULL
               OR (primary_metric_rate >= 0.0 AND primary_metric_rate <= 1.0)),
    CONSTRAINT eval_runs_coverage_range
        CHECK (assertion_coverage IS NULL
               OR (assertion_coverage >= 0.0 AND assertion_coverage <= 1.0))
);

COMMENT ON TABLE eval_runs IS
    'Every eval run, ingested from a committed report or dispatched at request time. The single queryable eval store; evals/reports/*.json is its import source, not a parallel surface.';

CREATE INDEX idx_eval_runs_suite_measured ON eval_runs(suite, measured_at DESC NULLS LAST);
CREATE INDEX idx_eval_runs_status ON eval_runs(status) WHERE status IN ('pending', 'running');
CREATE INDEX idx_eval_runs_created ON eval_runs(created_at DESC);

-- Ingest bookkeeping.
--
-- WHY THIS TABLE EXISTS AT ALL
--   `501 NO_EVAL_STORE` used to mean "no reports directory was reachable". Once
--   the store is Postgres — which the gateway cannot start without — the store
--   is ALWAYS reachable, and that honest 501 would vanish along with the
--   distinction it protects: an empty table and an unpopulated one would return
--   the same 200.
--
--   That is the exact defect this whole surface was hardened against ("we looked
--   and found none" vs "we never looked"). So ingest records itself, and the
--   rule survives: never ingested -> 501; ingested and empty -> a real 200 with
--   zero runs.
CREATE TABLE eval_ingests (
    id BIGSERIAL PRIMARY KEY,
    -- The directory that was read, so a reader can tell WHICH store was seen.
    source_dir TEXT NOT NULL,
    files_seen INTEGER NOT NULL,
    runs_upserted INTEGER NOT NULL,
    -- Files present but skipped (unparseable name, malformed JSON). Recorded
    -- rather than silently dropped: a report that stopped being ingested is
    -- indistinguishable from one that was never written, and the gateway used to
    -- skip both without a word.
    files_skipped INTEGER NOT NULL DEFAULT 0,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE eval_ingests IS
    'One row per ingest of evals/reports. Its existence is what lets an empty eval_runs table mean "we looked and found none" rather than "we never looked".';

CREATE INDEX idx_eval_ingests_at ON eval_ingests(ingested_at DESC);
