/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

/**
 * Guards the CLASS of bug, not one instance. A BFF route that returns a 2xx
 * with a hardcoded empty payload is a fabricated success: on the dashboard
 * "0 regressions found" and "we never looked" render identically, and only one
 * is true. This class has now appeared three times in this repo — the SSE mock
 * generator, the eval-run POST fabricating a 201, and the empty-200 eval GETs —
 * so this test discovers EVERY handler under the eval BFF surface (including any
 * route added later) and asserts none of them returns a 2xx. Until a real
 * gateway eval backend lands (#7), every eval route must return 501.
 *
 * When the backend is implemented, this test is meant to fail loudly on the
 * routes that legitimately start returning data — that failure is the signal to
 * update it, not a reason to weaken it.
 */
const EVALS_DIR = path.join(process.cwd(), "src/app/api/v1/evals");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

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
        { method },
    );
    // Dynamic route handlers receive (req, ctx); static ones ignore ctx.
    const handler = mod[method] as (
        req: NextRequest,
        ctx: { params: Promise<Record<string, string>> },
    ) => Promise<Response>;
    return handler(req, {
        params: Promise.resolve({ suiteId: "probe", evalRunId: "probe" }),
    });
}

const routeFiles = findRouteFiles(EVALS_DIR);

describe("eval BFF routes never fabricate a 2xx empty success (#7)", () => {
    it("discovers the eval route surface (fails if the dir is empty/moved)", () => {
        // suites, suites/[suiteId], runs, regression-report → at least 4.
        expect(routeFiles.length).toBeGreaterThanOrEqual(4);
    });

    it.each(routeFiles.map((f) => [path.relative(process.cwd(), f), f]))(
        "%s: every HTTP method returns 501, never a 2xx",
        async (_rel, file) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(file) as Record<string, unknown>;
            const handlers = METHODS.filter(
                (m) => typeof mod[m] === "function",
            );
            expect(handlers.length).toBeGreaterThan(0);

            for (const method of handlers) {
                const res = await invoke(mod, method);

                // The class guard: no fabricated success.
                expect(is2xx(res.status)).toBe(false);

                // The honest state: 501 with a body that names the tracking issue.
                expect(res.status).toBe(501);
                const body = (await res.json()) as {
                    error?: string;
                    issue?: string;
                };
                expect(body.error).toBe("not_implemented");
                expect(body.issue).toContain("/issues/7");
            }
        },
    );
});
