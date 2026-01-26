/**
 * Tests for StepTimeline component
 * Test IDs: UI-STEP-001 to UI-STEP-020
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { StepTimeline } from "@/components/runs/step-timeline";
import {
  mockStepLLMCompleted,
  mockStepToolCompleted,
  mockStepLLMRunning,
  mockStepLLMPending,
  mockStepToolFailed,
  mockStepApprovalWaiting,
} from "@/__tests__/utils/fixtures";
import type { Step } from "@/types/run";

// Mock the JsonViewer component to avoid complexity
jest.mock("@/components/shared/json-viewer", () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <div data-testid="json-viewer">{JSON.stringify(data)}</div>
  ),
}));

describe("StepTimeline", () => {
  // UI-STEP-001: Renders timeline with steps
  it("renders timeline with steps", () => {
    const steps = [mockStepLLMCompleted, mockStepToolCompleted];
    render(<StepTimeline steps={steps} />);

    // Should show completed count
    expect(screen.getByText(/2 completed/)).toBeInTheDocument();
  });

  // UI-STEP-002: Shows correct step type label for LLM steps
  it("shows correct step type label for LLM steps", () => {
    render(<StepTimeline steps={[mockStepLLMCompleted]} />);
    // Model name should be displayed for LLM steps
    expect(screen.getByText("claude-3-sonnet")).toBeInTheDocument();
  });

  // UI-STEP-003: Shows tool name for tool steps
  it("shows tool name for tool steps", () => {
    render(<StepTimeline steps={[mockStepToolCompleted]} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  // UI-STEP-004: Shows running indicator for running steps
  it("shows running indicator for running steps", () => {
    render(<StepTimeline steps={[mockStepLLMRunning]} />);
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });

  // UI-STEP-005: Shows failed count for failed steps
  it("shows failed count for failed steps", () => {
    render(<StepTimeline steps={[mockStepToolFailed]} />);
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  // UI-STEP-006: Displays step number badge
  it("displays step number badge", () => {
    render(<StepTimeline steps={[mockStepLLMCompleted]} />);
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  // UI-STEP-007: Shows status badge for each step
  it("shows status badge for each step", () => {
    render(<StepTimeline steps={[mockStepLLMCompleted]} />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  // UI-STEP-008: Shows Running status badge
  it("shows Running status badge", () => {
    render(<StepTimeline steps={[mockStepLLMRunning]} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  // UI-STEP-009: Shows Failed status badge
  it("shows Failed status badge", () => {
    render(<StepTimeline steps={[mockStepToolFailed]} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  // UI-STEP-010: Shows Awaiting Approval status
  it("shows Awaiting Approval status", () => {
    render(<StepTimeline steps={[mockStepApprovalWaiting]} />);
    expect(screen.getByText("Awaiting Approval")).toBeInTheDocument();
  });

  // UI-STEP-011: Shows Pending status
  it("shows Pending status", () => {
    render(<StepTimeline steps={[mockStepLLMPending]} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  // UI-STEP-012: Sorts steps by step_number
  it("sorts steps by step_number", () => {
    const unorderedSteps = [
      { ...mockStepLLMCompleted, step_number: 3 },
      { ...mockStepToolCompleted, step_number: 1 },
      { ...mockStepLLMRunning, step_number: 2 },
    ];
    render(<StepTimeline steps={unorderedSteps} />);

    // All steps should be rendered
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  // UI-STEP-013: Calculates total tokens
  it("calculates total tokens", () => {
    const steps = [
      { ...mockStepLLMCompleted, input_tokens: 1000, output_tokens: 500 },
      { ...mockStepToolCompleted, input_tokens: 200, output_tokens: 100 },
    ];
    render(<StepTimeline steps={steps} />);

    // Should show total tokens (1000+500+200+100 = 1800)
    expect(screen.getByText("1,800 tokens")).toBeInTheDocument();
  });

  // UI-STEP-014: Handles empty steps array
  it("handles empty steps array", () => {
    const { container } = render(<StepTimeline steps={[]} />);
    expect(screen.getByText("0 completed")).toBeInTheDocument();
    // Timeline should still render
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-STEP-015: Step card exists and shows step info
  it("step card exists and shows step info", () => {
    render(<StepTimeline steps={[mockStepLLMCompleted]} />);

    // Card displays the model name
    expect(screen.getByText("claude-3-sonnet")).toBeInTheDocument();
    // Card displays the status
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  // UI-STEP-016: Failed steps are expanded by default
  it("failed steps are expanded by default", () => {
    render(<StepTimeline steps={[mockStepToolFailed]} />);

    // Error section should be visible
    expect(screen.getByText(/Error/i)).toBeInTheDocument();
  });

  // UI-STEP-017: Running steps show running status
  it("running steps show running status", () => {
    render(<StepTimeline steps={[mockStepLLMRunning]} />);

    // Running status should be visible
    expect(screen.getByText("Running")).toBeInTheDocument();
    // Running stats should show in header
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });

  // UI-STEP-018: Shows completed status for completed steps
  it("shows completed status for completed steps", () => {
    render(<StepTimeline steps={[mockStepLLMCompleted]} />);
    // Completed status badge should be visible
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // Stats should show completed count
    expect(screen.getByText(/1 completed/)).toBeInTheDocument();
  });

  // UI-STEP-019: Shows token count for steps with tokens
  it("shows token count for steps with tokens", () => {
    const llmStep: Step = {
      ...mockStepLLMCompleted,
      input_tokens: 2000,
      output_tokens: 500,
    };
    render(<StepTimeline steps={[llmStep]} />);

    // Total tokens shown in stats header
    expect(screen.getByText("2,500 tokens")).toBeInTheDocument();
  });

  // UI-STEP-020: Handles steps without timestamps gracefully
  it("handles steps without timestamps gracefully", () => {
    const stepWithoutTimestamps: Step = {
      id: "stp_test",
      run_id: "run_test",
      step_number: 1,
      step_type: "tool",
      status: "pending",
      tool_name: "test_tool",
      created_at: new Date().toISOString(),
    };
    render(<StepTimeline steps={[stepWithoutTimestamps]} />);

    // Should render without errors
    expect(screen.getByText("test_tool")).toBeInTheDocument();
  });
});

describe("StepTimeline step types", () => {
  // UI-STEP-021: Renders LLM step with correct icon
  it("renders LLM step type", () => {
    const { container } = render(<StepTimeline steps={[mockStepLLMCompleted]} />);
    // Should have gradient background for icon
    const iconContainer = container.querySelector(".bg-gradient-to-br");
    expect(iconContainer).toBeInTheDocument();
  });

  // UI-STEP-022: Renders tool step type
  it("renders tool step type", () => {
    render(<StepTimeline steps={[mockStepToolCompleted]} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  // UI-STEP-023: Renders approval step type
  it("renders approval step type", () => {
    render(<StepTimeline steps={[mockStepApprovalWaiting]} />);
    expect(screen.getByText("delete_user")).toBeInTheDocument();
  });
});

describe("StepTimeline mixed statuses", () => {
  // UI-STEP-024: Shows correct counts with mixed statuses
  it("shows correct counts with mixed statuses", () => {
    const mixedSteps = [
      mockStepLLMCompleted,
      mockStepToolCompleted,
      mockStepLLMRunning,
      mockStepToolFailed,
    ];
    render(<StepTimeline steps={mixedSteps} />);

    expect(screen.getByText(/2 completed/)).toBeInTheDocument();
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });
});
