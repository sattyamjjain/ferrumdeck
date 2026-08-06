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
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Routes that are implemented and may return 2xx. Keyed by the route file's path
 * relative to the nextjs root, valued by the methods that serve real data. Every
 * entry here is enforced to return real (non-empty) data, not a 2xx empty payload.
 */
const IMPLEMENTED: Record<string, readonly string[]> = {
    "src/app/api/v1/evals/suites/route.ts": ["GET"],
};

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
                    // Implemented: may be 2xx, but must carry real (non-empty) data — an
                    // implemented route that 2xx'd an empty payload would be the exact
                    // fabrication this test exists to catch.
                    expect(is2xx(res.status)).toBe(true);
                    const body = (await res.json()) as { suites?: unknown[] };
                    expect(Array.isArray(body.suites)).toBe(true);
                    expect((body.suites ?? []).length).toBeGreaterThan(0);
                } else {
                    // Not implemented: never a fabricated success; 501 naming #7.
                    expect(is2xx(res.status)).toBe(false);
                    expect(res.status).toBe(501);
                    const body = (await res.json()) as {
                        error?: string;
                        issue?: string;
                    };
                    expect(body.error).toBe("not_implemented");
                    expect(body.issue).toContain("/issues/7");
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
        // Real scorer names straight from the YAML.
        expect(smoke.scorer_names).toEqual([
            "schema_valid",
            "no_policy_violations",
        ]);
        expect(regression.scorer_names).toContain("expected_output_match");
    });
});
