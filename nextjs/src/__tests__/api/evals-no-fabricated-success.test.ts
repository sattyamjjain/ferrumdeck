/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Guards the CLASS of bug, not one instance. A BFF route that returns a 2xx with
 * a hardcoded empty payload is a fabricated success: on the dashboard "0 suites"
 * and "we never looked" render identically, and only one is true. This class has
 * appeared repeatedly (the SSE mock generator, the eval-run POST fabricating a
 * 201, the empty-200 eval GETs), so this test discovers EVERY handler under the
 * eval BFF surface (including any route added later).
 *
 * As routes get implemented (#7), the rule shifts from "no route returns 2xx" to
 * an allowlist: a route named in IMPLEMENTED may return 2xx but MUST return real,
 * non-empty data (guarded below); every other discovered route must still be
 * non-2xx (501, naming #7). The discover-every-route mechanic is kept — that
 * mechanic is why the fabrication class was caught three times, and losing it to
 * add one endpoint would be a bad trade.
 */
const NEXTJS_ROOT = process.cwd();
const EVALS_DIR = path.join(NEXTJS_ROOT, "src/app/api/v1/evals");
const DECLARATIONS = path.join(NEXTJS_ROOT, "..", ".route-backing.yml");

/**
 * The issue number `.route-backing.yml` declares for a stubbed route.
 *
 * Parsed with a small regex rather than a YAML dependency: the file's stub
 * entries are a flat `- route: ...` / `issue: N` pair, and adding js-yaml to the
 * dashboard's test deps to read two fields is not worth it.
 */
function declaredStubIssue(routeRelativeToApi: string): number {
    const yaml = fs.readFileSync(DECLARATIONS, "utf8");
    const route = routeRelativeToApi.replace("src/app/api/", "");
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = yaml.match(
        new RegExp(`- route:\\s*${escaped}[\\s\\S]*?issue:\\s*(\\d+)`),
    );
    if (!match) {
        throw new Error(
            `${route} returns 501 but is not declared in .route-backing.yml. ` +
                "An untracked stub is a permanent one.",
        );
    }
    return Number(match[1]);
}
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Routes that are implemented and may return 2xx. Keyed by the route file's path
 * relative to the nextjs root, valued by the methods that serve real data. Every
 * entry here is enforced to return real (non-empty) data, not a 2xx empty payload.
 */
const IMPLEMENTED: Record<string, readonly string[]> = {
    "src/app/api/v1/evals/suites/route.ts": ["GET"],
    // Backed as of 0.8.13: joins the on-disk suite definition with the
    // gateway's measured run history. Its 2xx body is a single suite, not a
    // list, so the generic list-shaped assertion below does not apply to it and
    // it gets a dedicated test instead.
    "src/app/api/v1/evals/suites/[suiteId]/route.ts": ["GET"],
};

/**
 * Routes whose 2xx body is a single object rather than `{ suites: [...] }`.
 * They are still held to "real data, never a fabricated empty success" — just
 * by the dedicated tests further down, which know their shape.
 */
const NON_LIST_BODY = new Set([
    "src/app/api/v1/evals/suites/[suiteId]/route.ts",
]);

function findRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...findRouteFiles(full));
        } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
            out.push(full);
        }
    }
    return out;
}

const is2xx = (status: number) => status >= 200 && status < 300;

async function invoke(mod: Record<string, unknown>, method: string) {
    const req = new NextRequest(
        "http://localhost/api/v1/evals/probe?period_days=7",
        {
            method,
        },
    );
    const handler = mod[method] as (
        req: NextRequest,
        ctx: { params: Promise<Record<string, string>> },
    ) => Promise<Response>;
    return handler(req, {
        params: Promise.resolve({ suiteId: "probe", evalRunId: "probe" }),
    });
}

const routeFiles = findRouteFiles(EVALS_DIR);

describe("eval BFF routes: implemented routes serve real data, the rest never fabricate 2xx (#7)", () => {
    it("discovers the eval route surface (fails if the dir is empty/moved)", () => {
        // suites, suites/[suiteId], runs, regression-report → at least 4.
        expect(routeFiles.length).toBeGreaterThanOrEqual(4);
    });

    it.each(routeFiles.map((f) => [path.relative(NEXTJS_ROOT, f), f]))(
        "%s: implemented methods serve real data; every other method is non-2xx (501)",
        async (rel, file) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(file) as Record<string, unknown>;
            const handlers = METHODS.filter(
                (m) => typeof mod[m] === "function",
            );
            expect(handlers.length).toBeGreaterThan(0);

            const implementedMethods = IMPLEMENTED[rel] ?? [];

            for (const method of handlers) {
                const res = await invoke(mod, method);

                if (implementedMethods.includes(method)) {
                    if (NON_LIST_BODY.has(rel)) {
                        // Probed with a suiteId that exists in neither source and
                        // with no gateway running. The one thing that must NEVER
                        // happen is a 2xx: "we could not look" and "this suite is
                        // empty" must not render identically.
                        expect(is2xx(res.status)).toBe(false);
                        expect([404, 503]).toContain(res.status);
                        continue;
                    }
                    // Implemented: may be 2xx, but must carry real (non-empty) data — an
                    // implemented route that 2xx'd an empty payload would be the exact
                    // fabrication this test exists to catch.
                    expect(is2xx(res.status)).toBe(true);
                    const body = (await res.json()) as { suites?: unknown[] };
                    expect(Array.isArray(body.suites)).toBe(true);
                    expect((body.suites ?? []).length).toBeGreaterThan(0);
                } else {
                    // Not implemented: never a fabricated success, and it must
                    // cite the issue that tracks finishing it.
                    expect(is2xx(res.status)).toBe(false);
                    expect(res.status).toBe(501);
                    const body = (await res.json()) as {
                        error?: string;
                        issue?: string;
                    };
                    expect(body.error).toBe("not_implemented");
                    // The issue number is NOT hardcoded. It used to be `/issues/7`,
                    // and closing #7 broke this test -- not because a stub started
                    // fabricating, but because the tracking issue moved. What
                    // matters is that the route cites the SAME issue
                    // .route-backing.yml declares for it, so the two cannot drift.
                    const declared = declaredStubIssue(rel);
                    expect(body.issue).toContain(`/issues/${declared}`);
                }
            }
        },
    );

    it("GET /api/v1/evals/suites returns the real on-disk suites, not an empty success", async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(path.join(EVALS_DIR, "suites/route.ts")) as Record<
            string,
            unknown
        >;
        const res = await invoke(mod, "GET");
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
            suites: {
                id: string;
                name: string;
                task_count: number;
                scorer_names: string[];
            }[];
        };
        // The repo ships evals/suites/{smoke,regression}.yaml — real definitions.
        const names = body.suites.map((s) => s.name).sort();
        expect(names).toEqual(["regression", "smoke"]);

        const smoke = body.suites.find((s) => s.id === "smoke")!;
        const regression = body.suites.find((s) => s.id === "regression")!;
        // Real task counts from datasets/safe-pr-agent/tasks.jsonl (20 total; 3 are
        // category=documentation, which the smoke suite filters to).
        expect(smoke.task_count).toBe(3);
        expect(regression.task_count).toBe(20);
        // Real scorer names straight from the YAML. `schema_valid` was removed
        // from both suites: no task in the dataset declares an `output_schema`,
        // so the scorer skipped on every task of every run while still
        // contributing a full score. See docs/eval-health.md.
        expect(smoke.scorer_names).toEqual([
            "no_policy_violations",
            "expected_output_match",
        ]);
        expect(regression.scorer_names).toContain("expected_output_match");
        expect(smoke.scorer_names).not.toContain("schema_valid");
        expect(regression.scorer_names).not.toContain("schema_valid");
    });

    /** Invoke a route with a specific suiteId rather than the generic probe. */
    async function getSuite(suiteId: string) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(
            path.join(EVALS_DIR, "suites/[suiteId]/route.ts"),
        ) as Record<string, unknown>;
        const handler = mod.GET as (
            req: Request,
            ctx: { params: Promise<{ suiteId: string }> },
        ) => Promise<Response>;
        return handler(
            new NextRequest(`http://localhost/api/v1/evals/suites/${suiteId}`),
            { params: Promise.resolve({ suiteId }) },
        );
    }

    it("GET /api/v1/evals/suites/{id} serves the real on-disk definition, matching the list route", async () => {
        // Comparison, not "it returned 200": the detail view must agree with the
        // list view field for field. Two readers of one YAML that disagree is
        // the drift this repo keeps finding, so it is asserted rather than
        // assumed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const listMod = require(
            path.join(EVALS_DIR, "suites/route.ts"),
        ) as Record<string, unknown>;
        const listBody = (await (await invoke(listMod, "GET")).json()) as {
            suites: { id: string; task_count: number; scorer_names: string[] }[];
        };
        const fromList = listBody.suites.find((s) => s.id === "smoke")!;

        const res = await getSuite("smoke");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            suite_id: string;
            definition: {
                id: string;
                task_count: number;
                scorer_names: string[];
            } | null;
            history_available: boolean;
            runs: unknown[];
        };

        expect(body.suite_id).toBe("smoke");
        expect(body.definition).not.toBeNull();
        expect(body.definition!.task_count).toBe(fromList.task_count);
        expect(body.definition!.scorer_names).toEqual(fromList.scorer_names);
    });

    it("distinguishes 'no gateway to ask' from 'this suite has never run'", async () => {
        // No gateway is running under jest. The measured-history half must say
        // it could not look — `history_available: false` plus a stated reason —
        // rather than returning `runs: []`, which on the dashboard reads as "we
        // checked and this suite has never been run". That confusion is the
        // whole fabrication class this file guards.
        const res = await getSuite("smoke");
        const body = (await res.json()) as {
            history_available: boolean;
            history_error?: string;
            runs: unknown[];
            latest_measured_at: unknown;
        };
        expect(body.history_available).toBe(false);
        expect(typeof body.history_error).toBe("string");
        expect(body.history_error).toContain("not a claim");
        expect(body.runs).toEqual([]);
        // And no fabricated measurement time to go with the absent numbers.
        expect(body.latest_measured_at).toBeNull();
    });
});
