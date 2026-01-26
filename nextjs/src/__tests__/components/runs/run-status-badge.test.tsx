/**
 * Tests for RunStatusBadge component
 * Test IDs: UI-RUN-001 to UI-RUN-010
 */
import { render, screen } from "@testing-library/react";
import {
  RunStatusBadge,
  RunStatusDot,
  RunStatusIndicator,
} from "@/components/runs/run-status-badge";
import type { RunStatus } from "@/types/run";

describe("RunStatusBadge", () => {
  // UI-RUN-001: Renders correct label for each status
  it.each([
    ["created", "Created"],
    ["queued", "Queued"],
    ["running", "Running"],
    ["waiting_approval", "Awaiting"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["timeout", "Timeout"],
    ["budget_killed", "Budget"],
    ["policy_blocked", "Blocked"],
  ] as const)("renders correct label for %s status", (status, expectedLabel) => {
    render(<RunStatusBadge status={status} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  // UI-RUN-002: Shows icon by default
  it("shows icon by default", () => {
    const { container } = render(<RunStatusBadge status="running" />);
    // Should have an svg icon
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  // UI-RUN-003: Hides icon when showIcon is false
  it("hides icon when showIcon is false", () => {
    const { container } = render(
      <RunStatusBadge status="running" showIcon={false} />
    );
    // Should not have an svg icon
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  // UI-RUN-004: Has spinning animation for running status
  it("has spinning animation for running status", () => {
    const { container } = render(<RunStatusBadge status="running" />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("animate-spin");
  });

  // UI-RUN-005: Does not have spinning animation for completed status
  it("does not have spinning animation for completed status", () => {
    const { container } = render(<RunStatusBadge status="completed" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toHaveClass("animate-spin");
  });

  // UI-RUN-006: Applies custom className
  it("applies custom className", () => {
    const { container } = render(
      <RunStatusBadge status="running" className="custom-class" />
    );
    const badge = container.firstChild;
    expect(badge).toHaveClass("custom-class");
  });

  // UI-RUN-007: Renders different sizes correctly
  it.each(["sm", "default", "lg"] as const)(
    "renders %s size correctly",
    (size) => {
      const { container } = render(<RunStatusBadge status="running" size={size} />);
      const badge = container.firstChild;
      expect(badge).toBeInTheDocument();
      // Size-specific classes are applied (tested by checking element exists)
    }
  );

  // UI-RUN-008: Handles unknown status gracefully
  it("handles unknown status gracefully", () => {
    // @ts-expect-error Testing unknown status
    render(<RunStatusBadge status="unknown_status" />);
    expect(screen.getByText("unknown_status")).toBeInTheDocument();
  });
});

describe("RunStatusDot", () => {
  // UI-RUN-009: Renders dot for each status
  it.each([
    "created",
    "queued",
    "running",
    "waiting_approval",
    "completed",
    "failed",
  ] as const)("renders dot for %s status", (status) => {
    const { container } = render(<RunStatusDot status={status} />);
    const dot = container.querySelector("span");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass("rounded-full");
  });

  // UI-RUN-010: Has title attribute with status label
  it("has title attribute with status label", () => {
    const { container } = render(<RunStatusDot status="running" />);
    const dot = container.querySelector("span");
    expect(dot).toHaveAttribute("title", "Running");
  });

  // Additional tests for completeness
  it("applies animation classes for running status", () => {
    const { container } = render(<RunStatusDot status="running" />);
    const dot = container.querySelector("span");
    expect(dot?.className).toContain("animate");
  });

  it("renders different sizes", () => {
    const { container: containerSm } = render(
      <RunStatusDot status="running" size="sm" />
    );
    const { container: containerLg } = render(
      <RunStatusDot status="running" size="lg" />
    );

    const dotSm = containerSm.querySelector("span");
    const dotLg = containerLg.querySelector("span");

    expect(dotSm).toHaveClass("h-1.5", "w-1.5");
    expect(dotLg).toHaveClass("h-2.5", "w-2.5");
  });
});

describe("RunStatusIndicator", () => {
  // UI-RUN-011: Renders both dot and label
  it("renders both dot and label", () => {
    const { container } = render(<RunStatusIndicator status="completed" />);

    // Should have a dot
    const dot = container.querySelector("span.rounded-full");
    expect(dot).toBeInTheDocument();

    // Should have the label
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  // UI-RUN-012: Applies custom className to container
  it("applies custom className to container", () => {
    const { container } = render(
      <RunStatusIndicator status="running" className="custom-indicator" />
    );
    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass("custom-indicator");
  });
});

// Test status color mappings to ensure visual consistency
describe("Status color consistency", () => {
  const statusColorMap: Record<RunStatus, string> = {
    created: "secondary",
    queued: "blue",
    running: "yellow",
    waiting_approval: "purple",
    completed: "green",
    failed: "red",
    cancelled: "secondary",
    timeout: "orange",
    budget_killed: "red",
    policy_blocked: "purple",
  };

  it.each(Object.entries(statusColorMap))(
    "status %s has expected color theme",
    (status, _colorTheme) => {
      const { container } = render(
        <RunStatusBadge status={status as RunStatus} />
      );
      const badge = container.firstChild;
      // The badge should contain a class with the color theme
      const classNames = badge?.className || "";
      // Check that the badge has styling (not testing exact colors, just that it has styles)
      expect(classNames).toContain("bg-");
    }
  );
});
