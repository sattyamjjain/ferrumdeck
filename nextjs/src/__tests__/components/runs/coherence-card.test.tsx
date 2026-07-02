/**
 * Tests for the Coherence divergence metric card (Strained Coherence,
 * arXiv:2606.07889) on the run header's MetricsDashboard. Covers null-for-legacy,
 * the coherent (green) render, and the divergent (amber) flag render/label.
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
    created_at: "2026-07-01T00:00:00Z",
    started_at: "2026-07-01T00:00:01Z",
    completed_at: "2026-07-01T00:00:05Z",
    ...overrides,
  } as Run;
}

describe("Coherence metric card", () => {
  it("is absent for a legacy run with no coherence verdict", () => {
    renderWithProviders(<RunHeader run={mockRun()} stepCount={2} />);
    expect(screen.queryByText("Coherence")).not.toBeInTheDocument();
  });

  it("renders a green Coherent card when no divergence was detected", () => {
    renderWithProviders(
      <RunHeader
        run={mockRun({ coherence_divergence_flagged: false })}
        stepCount={2}
      />
    );
    expect(screen.getByText("Coherence")).toBeInTheDocument();
    expect(screen.getByText("Coherent")).toBeInTheDocument();
    expect(screen.getByText("per Strained Coherence")).toBeInTheDocument();
  });

  it("renders an amber Divergent card with the flag label when detected", () => {
    renderWithProviders(
      <RunHeader
        run={mockRun({ coherence_divergence_flagged: true })}
        stepCount={2}
      />
    );
    expect(screen.getByText("Divergent")).toBeInTheDocument();
    expect(screen.getByText("Divergence detected")).toBeInTheDocument();
  });
});
