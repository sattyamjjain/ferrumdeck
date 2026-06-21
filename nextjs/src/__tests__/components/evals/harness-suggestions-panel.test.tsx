/**
 * Tests for HarnessSuggestionsPanel (HarnessX trace->delta).
 *
 * Covers the null-for-legacy contract (no agent id / no suggestions), rendering
 * a proposed suggestion, the human-in-the-loop approve/reject wiring, and that
 * resolved suggestions disable the action buttons.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HarnessSuggestionsPanel } from "@/components/evals/harness-suggestions-panel";
import { renderWithProviders } from "@/__tests__/utils/test-utils";
import type { HarnessSuggestion } from "@/types/harness-suggestion";

const mockUseHarnessSuggestions = jest.fn();
const mockResolveMutate = jest.fn();

jest.mock("@/hooks/use-harness-suggestions", () => ({
  useHarnessSuggestions: (...args: unknown[]) =>
    mockUseHarnessSuggestions(...args),
  useResolveHarnessSuggestion: () => ({
    mutate: mockResolveMutate,
    isPending: false,
  }),
}));

function suggestion(overrides: Partial<HarnessSuggestion> = {}): HarnessSuggestion {
  return {
    id: "hns_1",
    agent_id: "agt_demo",
    source_eval_run_id: "eval_1",
    kind: "budget",
    current: { per_run_cap_cents: 100 },
    proposed: { per_run_cap_cents: 80 },
    reason: "run cost exceeded the cap on 7/10 runs",
    evidence: [
      { code: "budget_breach_rate", detail: "7/10 over cap", observed: 0.7 },
    ],
    confidence: 0.7,
    status: "proposed",
    content_hash: "abc",
    created_at: new Date().toISOString(),
    anchor: "harnessx-trace-to-delta",
    ...overrides,
  };
}

function withSuggestions(suggestions: HarnessSuggestion[]) {
  mockUseHarnessSuggestions.mockReturnValue({
    data: { agent_id: "agt_demo", suggestions, anchor: "harnessx-trace-to-delta" },
    isLoading: false,
  });
}

describe("HarnessSuggestionsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withSuggestions([suggestion()]);
  });

  it("renders nothing when no agent id is provided", () => {
    const { container } = renderWithProviders(<HarnessSuggestionsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no suggestions", () => {
    withSuggestions([]);
    const { container } = renderWithProviders(
      <HarnessSuggestionsPanel agentId="agt_demo" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a proposed suggestion with the not-auto-applied notice", () => {
    renderWithProviders(<HarnessSuggestionsPanel agentId="agt_demo" />);
    expect(screen.getByText("Harness suggestions")).toBeInTheDocument();
    expect(
      screen.getByText(/run cost exceeded the cap on 7\/10 runs/)
    ).toBeInTheDocument();
    expect(screen.getByText(/not auto-applied/)).toBeInTheDocument();
  });

  it("approves a proposed suggestion through the resolve mutation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<HarnessSuggestionsPanel agentId="agt_demo" />);
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(mockResolveMutate).toHaveBeenCalledWith({
      suggestionId: "hns_1",
      approve: true,
    });
  });

  it("disables actions on an already-resolved suggestion", () => {
    withSuggestions([suggestion({ status: "approved" })]);
    renderWithProviders(<HarnessSuggestionsPanel agentId="agt_demo" />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });
});
