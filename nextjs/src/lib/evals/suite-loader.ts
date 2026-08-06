import fs from "fs";
import path from "path";
import { load as loadYaml } from "js-yaml";
import type { EvalSuiteSummary } from "@/types/eval";

/**
 * Loads eval **suite definitions** from `evals/suites/*.yaml` on disk — the real
 * artifacts that exist today (issue #7). Runs have never been executed, so no run
 * data is invented: `last_run_*` is left undefined, `task_count` is the real count
 * of dataset entries the suite would run, and `scorer_names` / `gate_threshold`
 * come straight from the YAML.
 *
 * This is deliberately NOT a fabricated empty success. If the evals directory
 * cannot be located, the caller returns 501 (see the route) rather than an empty
 * `200 { suites: [] }`, which would read as "no suites exist" — the same
 * fabrication class the SSE mock and the eval-run POST already had.
 */

export type LoadSuitesResult =
    | { kind: "ok"; suites: EvalSuiteSummary[]; source: string }
    | { kind: "not_found"; searched: string[] };

interface RawDataset {
    path?: string;
    filter?: { categories?: string[] };
}
interface RawScorer {
    type?: string;
}
interface RawSuite {
    name?: string;
    description?: string;
    datasets?: RawDataset[];
    scorers?: RawScorer[];
    gates?: { pass_rate_threshold?: number };
}

/** Candidate `evals/` roots, most specific first. Dev/jest run with cwd=nextjs/. */
function evalsRootCandidates(): string[] {
    const out: string[] = [];
    if (process.env.FD_EVALS_DIR) out.push(process.env.FD_EVALS_DIR);
    out.push(path.resolve(process.cwd(), "..", "evals")); // nextjs/ -> repo/evals
    out.push(path.resolve(process.cwd(), "evals")); // repo-root cwd
    return out;
}

function resolveEvalsRoot(): { root: string; searched: string[] } | null {
    const searched = evalsRootCandidates();
    for (const root of searched) {
        const suitesDir = path.join(root, "suites");
        try {
            if (fs.statSync(suitesDir).isDirectory()) return { root, searched };
        } catch {
            // not here; try the next candidate
        }
    }
    return null;
}

/** Real count of dataset entries a suite would run, honouring a category filter. */
function countTasks(
    evalsRoot: string,
    datasets: RawDataset[] | undefined,
): number {
    if (!datasets?.length) return 0;
    let total = 0;
    for (const ds of datasets) {
        if (!ds.path) continue;
        const jsonl = path.join(evalsRoot, ds.path, "tasks.jsonl");
        let contents: string;
        try {
            contents = fs.readFileSync(jsonl, "utf8");
        } catch {
            continue; // dataset without a tasks.jsonl contributes 0, honestly
        }
        const lines = contents.split("\n").filter((l) => l.trim().length > 0);
        const cats = ds.filter?.categories;
        if (!cats?.length) {
            total += lines.length;
            continue;
        }
        for (const line of lines) {
            try {
                const cat = (JSON.parse(line) as { category?: string })
                    .category;
                if (cat && cats.includes(cat)) total += 1;
            } catch {
                // malformed line contributes 0
            }
        }
    }
    return total;
}

export function loadEvalSuites(): LoadSuitesResult {
    const resolved = resolveEvalsRoot();
    if (!resolved) {
        return {
            kind: "not_found",
            searched: evalsRootCandidates().map((r) => path.join(r, "suites")),
        };
    }
    const { root } = resolved;
    const suitesDir = path.join(root, "suites");

    const files = fs
        .readdirSync(suitesDir)
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .sort();

    const suites: EvalSuiteSummary[] = [];
    for (const file of files) {
        let raw: RawSuite;
        try {
            raw =
                (loadYaml(
                    fs.readFileSync(path.join(suitesDir, file), "utf8"),
                ) as RawSuite) ?? {};
        } catch {
            continue; // an unparseable suite file is skipped, not faked
        }
        const id = file.replace(/\.ya?ml$/, "");
        suites.push({
            id,
            name: raw.name ?? id,
            description: raw.description,
            task_count: countTasks(root, raw.datasets),
            scorer_names: (raw.scorers ?? [])
                .map((s) => s.type)
                .filter((t): t is string => Boolean(t)),
            // No `gates` block (e.g. the smoke suite) means no pass-rate gate: 0.
            gate_threshold: raw.gates?.pass_rate_threshold ?? 0,
            // Deliberately no last_run_* — these suites have never been run.
        });
    }

    return { kind: "ok", suites, source: suitesDir };
}
