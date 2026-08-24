/**
 * Behaviour of the live decision panel, asserted on what it SAYS (issue #5).
 *
 * The two failure modes worth a test here are both statements the panel could
 * make that are not true:
 *   * rendering an empty feed as "no policy decisions" when nothing was pushed;
 *   * collapsing a shadow-mode Deny and a shadow-mode Allow into one label,
 *     which are opposite facts about whether the call was stopped.
 */
import { render, screen } from "@testing-library/react";
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
            screen.getByText(/No decisions pushed on this channel yet/i),
        ).toBeInTheDocument();
        expect(screen.queryByText(/^No policy decisions$/i)).toBeNull();
    });

    it("when disconnected, says so and disclaims the absence explicitly", () => {
        mockStatus = "disconnected";
        render(<LivePolicyDecisions runId="run_1" />);
        expect(
            screen.getByText(/This is not a claim that no policy decisions were recorded/i),
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
