/**
 * Tests for the Claim Grounding Rate metric card (VeriGraph 2606.16603) on the
 * run header's MetricsDashboard. Covers null-for-legacy, the percentage render,
 * and the below-threshold flag styling/label.
 */
import { screen } from "@testing-library/react";
import { RunHeader } from "@/components/runs/run-header";
import { renderWithProviders } from "@/__tests__/utils/test-utils";
import type { Run } from "@/types/run";

function mockRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_01JTEST",
    project_id: "prj_01",
    agent_version_id: "av_01",
    status: "completed",
    input: { task: "demo" },
    input_tokens: 100,
    output_tokens: 50,
    tool_calls: 2,
    cost_cents: 12,
    created_at: "2026-06-20T00:00:00Z",
    started_at: "2026-06-20T00:00:01Z",
    completed_at: "2026-06-20T00:00:05Z",
    ...overrides,
  } as Run;
}

describe("Claim Grounding metric card", () => {
  it("is absent for a legacy run with no grounding rate", () => {
    renderWithProviders(<RunHeader run={mockRun()} stepCount={2} />);
    expect(screen.queryByText("Grounding")).not.toBeInTheDocument();
  });

  it("renders the grounding percentage when present", () => {
    renderWithProviders(
      <RunHeader
        run={mockRun({ claim_grounding_rate: 0.667, claim_grounding_flagged: false })}
        stepCount={2}
      />
    );
    expect(screen.getByText("Grounding")).toBeInTheDocument();
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("per VeriGraph")).toBeInTheDocument();
  });

  it("shows the below-threshold label when flagged", () => {
    renderWithProviders(
      <RunHeader
        run={mockRun({ claim_grounding_rate: 0.3, claim_grounding_flagged: true })}
        stepCount={2}
      />
    );
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getByText("Below threshold")).toBeInTheDocument();
  });
});
