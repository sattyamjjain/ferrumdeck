/**
 * Behaviour of the live decision panel, asserted on what it SAYS (issue #5).
 *
 * The two failure modes worth a test here are both statements the panel could
 * make that are not true:
 *   * rendering an empty feed as "no policy decisions" when nothing was pushed;
 *   * collapsing a shadow-mode Deny and a shadow-mode Allow into one label,
 *     which are opposite facts about whether the call was stopped.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LivePolicyDecisions } from "@/components/runs/live-policy-decisions";
import type { SSEEvent } from "@/lib/realtime/channels";

// Drive the panel by capturing the SSE callback rather than standing up a real
// EventSource: the assertions are about what the panel renders for a given
// event, not about transport.
let emit: ((e: SSEEvent) => void) | undefined;
let mockStatus = "connected";

jest.mock("@/lib/realtime/use-subscription", () => ({
    useSubscription: (
        _channel: unknown,
        onMessage: (e: SSEEvent) => void,
    ) => {
        emit = onMessage;
        return {
            status: mockStatus,
            reconnect: jest.fn(),
            disconnect: jest.fn(),
            isConnected: mockStatus === "connected",
            isStale: false,
        };
    },
}));

function decision(payload: Record<string, unknown>, id = "1"): SSEEvent {
    return {
        id,
        type: "policy.response.recorded",
        channel: "run:run_1",
        timestamp: "2026-08-24T00:00:00Z",
        payload: { run_id: "run_1", tool_name: "git_write", ...payload },
    } as unknown as SSEEvent;
}

beforeEach(() => {
    emit = undefined;
    mockStatus = "connected";
});

describe("empty state never claims there were no decisions", () => {
    it("says nothing has been PUSHED, not that nothing happened", () => {
        render(<LivePolicyDecisions runId="run_1" />);
        // The distinction the whole panel exists to preserve.
        expect(
            screen.getByText(/No policy verdicts pushed on this channel yet/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/^No policy decisions$/i)).toBeNull();
    });

    it("when disconnected, says so and disclaims the absence explicitly", () => {
        mockStatus = "disconnected";
        render(<LivePolicyDecisions runId="run_1" />);
        expect(
            screen.getByText(/This is not a claim that none were recorded/i),
        ).toBeInTheDocument();
    });
});

describe("shadow mode qualifies the verdict, never replaces it", () => {
    it("a shadow-mode DENY still reads as denied", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", shadow_mode: true, rule: "allowlist:denied" }));
        expect(await screen.findByText(/Denied/)).toBeInTheDocument();
        expect(
            screen.getByText(/shadow mode — the call was allowed/),
        ).toBeInTheDocument();
    });

    it("a shadow-mode ALLOW does not read as denied", async () => {
        // Before the fix both rendered "Recorded, not blocked" — opposite facts
        // wearing one label.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Allow", shadow_mode: true }));
        expect(await screen.findByText(/Allowed/)).toBeInTheDocument();
        expect(screen.queryByText(/Denied/)).toBeNull();
    });
});

describe("an unknown verdict is not reported as an unrecorded one", () => {
    it("says it does not recognise the value, and shows it", async () => {
        // "Decision not recorded" for a verdict that WAS recorded is a false
        // statement about the audit trail — the same defect class as an empty
        // 200 reading as "none found".
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "BudgetCap" }));
        expect(
            await screen.findByText(/not recognised by this dashboard/i),
        ).toBeInTheDocument();
        expect(screen.getByText("BudgetCap")).toBeInTheDocument();
    });

    it("reserves 'not recorded' for an event that carried no decision", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({}));
        expect(await screen.findByText(/Decision not recorded/i)).toBeInTheDocument();
    });
});

describe("a null rule means deny-by-default, not a missing field", () => {
    it("spells out that nothing matched", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", rule: null }));
        expect(
            await screen.findByText(/none matched \(deny-by-default\)/i),
        ).toBeInTheDocument();
    });
});

describe("stream gaps are surfaced, not swallowed", () => {
    const gap = (message: string, id: string): SSEEvent =>
        ({
            id,
            type: "stream.gap",
            channel: "run:run_1",
            timestamp: "2026-08-24T00:00:00Z",
            payload: { message },
        }) as unknown as SSEEvent;

    it("renders the gap notice as a status message", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(gap("This stream is NOT complete.", "g1"));
        const notice = await screen.findByText(/NOT complete/);
        // `status`, not `alert`: a degraded stream repeats its notice, and an
        // assertive repeat interrupts the operator with the same sentence
        // indefinitely. `role="status"` is not a name-from-content role, so
        // assert the role on the element rather than looking it up by name.
        expect(notice.closest('[role="status"]')).not.toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        // The visually-hidden prefix tells a screen-reader user what the
        // sentence is, since the icon conveys nothing.
        expect(screen.getByText(/Stream warning:/)).toBeInTheDocument();
    });

    it("does not repeat an identical notice", async () => {
        // A degraded stream emits the same sentence continuously, each with a
        // fresh id. Without dedupe the operator is interrupted indefinitely.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(gap("same message", "g1"));
        emit!(gap("same message", "g2"));
        expect(await screen.findAllByText(/same message/)).toHaveLength(1);
    });

    it("ignores the connect handshake, which is not a warning", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!({
            id: "c",
            type: "stream.connected",
            channel: "run:run_1",
            timestamp: "2026-08-24T00:00:00Z",
            payload: { message: "connected" },
        } as unknown as SSEEvent);
        expect(screen.queryByText(/Stream warning/i)).toBeNull();
    });
});

describe("the feed can be paused (WCAG 2.2.2)", () => {
    it("offers a pause control", () => {
        render(<LivePolicyDecisions runId="run_1" />);
        expect(screen.getByRole("button", { name: /Pause feed/i })).toBeInTheDocument();
    });
});

describe("structure", () => {
    it("exposes a real heading, not styled text", () => {
        // shadcn's CardTitle renders a plain div, so the panel was unreachable
        // by heading navigation.
        render(<LivePolicyDecisions runId="run_1" />);
        expect(
            screen.getByRole("heading", { name: /Policy decisions \(live\)/i }),
        ).toBeInTheDocument();
    });

    it("gives the decision list an accessible name without a raw run id", async () => {
        render(<LivePolicyDecisions runId="run_01JABCDEFGHJKMNPQRSTVWXYZ" />);
        const list = screen.getByRole("list", { name: /Policy decisions, newest first/i });
        expect(list).toBeInTheDocument();
        // A ULID in the accessible name is read character by character.
        expect(list.getAttribute("aria-label")).not.toMatch(/run_01/);
    });
});

describe("the precedence trace is joined to its decision by record_id (#47)", () => {
    const explained = (recordId: string, overrides: unknown[], matched = 1): SSEEvent =>
        ({
            id: `e-${recordId}`,
            type: "policy.decision.explained",
            channel: "run:run_1",
            timestamp: "2026-08-25T00:00:00Z",
            payload: {
                run_id: "run_1",
                tool_name: "git_write",
                decision_id: recordId,
                record_id: recordId,
                winning_kind: "deny",
                winning_source: "allowlist:denied",
                overrides,
                matched_count: matched,
                precedence: "deny > requires_approval > budget_cap > allow",
                at: "2026-08-25T00:00:00Z",
            },
        }) as unknown as SSEEvent;

    it("attaches the explanation when it arrives AFTER the verdict", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", record_id: "aud_1" }, "1"));
        emit!(
            explained("aud_1", [
                { kind: "allow", source: "allowlist:allowed", overridden_by: "deny", reason: "r" },
            ], 2),
        );
        expect(await screen.findByText(/Overrode allow \(allowlist:allowed\)/)).toBeInTheDocument();
    });

    it("attaches the explanation when it arrives BEFORE the verdict", async () => {
        // Two events from one committed row; arrival order is not guaranteed.
        // Pairing on order rather than record_id would silently drop this one.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(
            explained("aud_2", [
                { kind: "allow", source: "allowlist:allowed", overridden_by: "deny", reason: "r" },
            ], 2),
        );
        emit!(decision({ decision: "Deny", record_id: "aud_2" }, "2"));
        expect(await screen.findByText(/Overrode allow \(allowlist:allowed\)/)).toBeInTheDocument();
    });

    it("never attaches an explanation to a different decision", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", record_id: "aud_a" }, "1"));
        emit!(decision({ decision: "Allow", record_id: "aud_b" }, "2"));
        emit!(explained("aud_b", [], 1));
        // Exactly one explanation rendered, and it belongs to aud_b.
        const traces = await screen.findAllByText(/Sole matching verdict/);
        expect(traces).toHaveLength(1);
    });

    it("says deny-by-default applied when nothing matched", async () => {
        // matched_count 0 is a real answer, not a missing value.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", record_id: "aud_c" }, "1"));
        emit!(explained("aud_c", [], 0));
        expect(
            await screen.findByText(/No rule matched; deny-by-default applied/),
        ).toBeInTheDocument();
    });
});

describe("routing decisions render live (#47)", () => {
    const routing = (subtask: string, id = "r1"): SSEEvent =>
        ({
            id,
            type: "routing.decision.recorded",
            channel: "run:run_1",
            timestamp: "2026-08-25T00:00:00Z",
            payload: {
                run_id: "run_1",
                decision_id: `rtg_${subtask}`,
                record_id: `aud_${subtask}`,
                chain_seq: 1,
                subtask_id: subtask,
                candidates: [
                    { role: "planner", agent_id: "agt_a", model: "claude-opus-5", score: 0.9 },
                    { role: "planner", agent_id: "agt_b", model: "gpt-4o", score: 0.7 },
                ],
                chosen: { role: "planner", agent_id: "agt_a", model: "claude-opus-5" },
                reason: { code: "policy_match", detail: "d" },
                content_hash: "0".repeat(64),
                anchor: "arXiv:2605.27466",
                at: "2026-08-25T00:00:00Z",
            },
        }) as unknown as SSEEvent;

    it("shows the chosen binding and why", async () => {
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(routing("stp_1"));
        expect(await screen.findByText("stp_1")).toBeInTheDocument();
        expect(screen.getByText(/planner \/ claude-opus-5/)).toBeInTheDocument();
        expect(screen.getByText("policy_match")).toBeInTheDocument();
        expect(screen.getByText(/2 candidates/)).toBeInTheDocument();
    });

    it("scopes the empty state to verdicts rather than hiding it", async () => {
        // Routing present, zero verdicts. Two ways to get this wrong: say "no
        // decisions pushed" (false -- a routing decision IS a decision pushed
        // here), or say nothing at all (an unexplained empty list, which is the
        // same defect wearing silence).
        //
        // Asserted POSITIVELY on purpose. The previous version of this test
        // checked that the OLD sentence was absent, which would have gone green
        // the moment the wording changed while measuring nothing -- the vacuous
        // pass this repo keeps finding.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(routing("stp_1"));
        await screen.findByText("stp_1");
        expect(
            screen.getByText(/No policy verdicts pushed on this channel yet/),
        ).toBeInTheDocument();
    });
});

describe("accessibility guarantees that must not silently regress", () => {
    const routingEvt = (subtask: string, id = "r1"): SSEEvent =>
        ({
            id,
            type: "routing.decision.recorded",
            channel: "run:run_1",
            timestamp: "2026-08-25T00:00:00Z",
            payload: {
                run_id: "run_1",
                decision_id: `rtg_${subtask}`,
                record_id: `aud_${subtask}`,
                subtask_id: subtask,
                candidates: [{ role: "planner", model: "m" }],
                chosen: { role: "planner", model: "m" },
                reason: { code: "policy_match", detail: "d" },
                content_hash: "0".repeat(64),
                anchor: "a",
                at: "2026-08-25T00:00:00Z",
            },
        }) as unknown as SSEEvent;

    it("both scrollable lists are reachable by keyboard (WCAG 2.1.1)", async () => {
        // Each list clips with overflow-y-auto and has no focusable descendant,
        // so without a tab stop a keyboard-only user cannot scroll to the
        // entries below the fold. Chromium has implicit focusable scrollers;
        // Firefox and Safari do not.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", record_id: "aud_1" }, "1"));
        emit!(routingEvt("stp_1"));
        await screen.findByText("stp_1");

        for (const name of [/Policy decisions, newest first/, /Routing decisions, newest first/]) {
            const list = screen.getByRole("list", { name });
            expect(list).toHaveAttribute("tabindex", "0");
        }
    });

    it("does not promote the routing list to a landmark", () => {
        // A named <section> is role="region". A secondary list inside a card is
        // not a navigable destination, and it is conditionally mounted, so it
        // would materialise mid-read for a landmark user.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(routingEvt("stp_1"));
        expect(screen.queryByRole("region")).toBeNull();
    });

    it("pausing the feed pauses the ROUTING list too (WCAG 2.2.2)", async () => {
        // The control is labelled "Pause feed" and sits in the panel header, so
        // it claims the whole panel. A control that misreports what it stopped
        // is worse than no control: the reader believes the panel is stable.
        render(<LivePolicyDecisions runId="run_1" />);
        fireEvent.click(screen.getByRole("button", { name: /Pause feed/i }));

        emit!(routingEvt("stp_while_paused"));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: /1 buffered/i }),
            ).toBeInTheDocument(),
        );
        // Buffered, not rendered...
        expect(screen.queryByText("stp_while_paused")).toBeNull();

        // ...and not lost: resuming flushes it.
        fireEvent.click(screen.getByRole("button", { name: /Resume feed/i }));
        expect(await screen.findByText("stp_while_paused")).toBeInTheDocument();
    });

    it("distinguishes a pending precedence trace from an absent one", async () => {
        // Both previously rendered as nothing. A sighted reader sees the trace
        // pop in later; a screen-reader user would never learn it arrived.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!(decision({ decision: "Deny", record_id: "aud_x" }, "1"));
        expect(
            await screen.findByText(/Precedence trace not received yet/),
        ).toBeInTheDocument();
    });

    it("never reports a routing decision as having zero candidates", async () => {
        // The gateway serialises `chosen`/`candidates` with
        // unwrap_or(Value::Null), so absence is reachable. "0 candidates" would
        // assert that none were considered, which is a different and false fact.
        render(<LivePolicyDecisions runId="run_1" />);
        emit!({
            id: "r9",
            type: "routing.decision.recorded",
            channel: "run:run_1",
            timestamp: "2026-08-25T00:00:00Z",
            payload: {
                run_id: "run_1",
                decision_id: "rtg_x",
                record_id: "aud_x",
                subtask_id: "stp_null",
                candidates: null,
                chosen: null,
                reason: null,
                content_hash: "0".repeat(64),
                anchor: "a",
                at: "2026-08-25T00:00:00Z",
            },
        } as unknown as SSEEvent);

        await screen.findByText("stp_null");
        expect(screen.getByText(/candidates not recorded/)).toBeInTheDocument();
        expect(screen.queryByText(/0 candidates/)).toBeNull();
        // And no " / " binding built out of two undefineds.
        expect(screen.getAllByText(/not recorded/).length).toBeGreaterThanOrEqual(2);
    });
});


