/**
 * Run Status Badge Component Rendering Tests.
 *
 * UI-RND-004: Run status badge renders for all statuses
 */

import { render, screen } from "@testing-library/react";
import { RunStatusBadge, RunStatusDot, RunStatusIndicator } from "@/components/runs/run-status-badge";
import type { RunStatus } from "@/types/run";

describe("UI-RND-004: Run Status Badge Component Rendering", () => {
  const allStatuses: RunStatus[] = [
    "created",
    "queued",
    "running",
    "waiting_approval",
    "completed",
    "failed",
    "cancelled",
    "timeout",
    "budget_killed",
    "policy_blocked",
  ];

  describe("RunStatusBadge renders for all statuses", () => {
    allStatuses.forEach((status) => {
      it(`renders ${status} status correctly`, () => {
        const { container } = render(<RunStatusBadge status={status} />);
        // Badge should be in the document with content
        const badge = container.querySelector('[data-slot="badge"]');
        expect(badge).toBeInTheDocument();
        expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe("RunStatusBadge status labels", () => {
    const statusLabels: Record<RunStatus, string> = {
      created: "Created",
      queued: "Queued",
      running: "Running",
      waiting_approval: "Awaiting",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      timeout: "Timeout",
      budget_killed: "Budget",
      policy_blocked: "Blocked",
    };

    Object.entries(statusLabels).forEach(([status, label]) => {
      it(`displays correct label for ${status}`, () => {
        render(<RunStatusBadge status={status as RunStatus} />);
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    });
  });

  describe("RunStatusBadge sizes", () => {
    const sizes = ["sm", "default", "lg"] as const;

    sizes.forEach((size) => {
      it(`renders ${size} size correctly`, () => {
        render(<RunStatusBadge status="running" size={size} />);
        expect(screen.getByText("Running")).toBeInTheDocument();
      });
    });
  });

  describe("RunStatusBadge icon visibility", () => {
    it("shows icon by default", () => {
      const { container } = render(<RunStatusBadge status="running" />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("hides icon when showIcon is false", () => {
      const { container } = render(
        <RunStatusBadge status="running" showIcon={false} />
      );
      expect(container.querySelector("svg")).not.toBeInTheDocument();
    });
  });

  describe("RunStatusBadge animations", () => {
    it("has spin animation for running status", () => {
      const { container } = render(<RunStatusBadge status="running" />);
      const icon = container.querySelector("svg");
      expect(icon).toHaveClass("animate-spin");
    });

    it("does not have spin animation for completed status", () => {
      const { container } = render(<RunStatusBadge status="completed" />);
      const icon = container.querySelector("svg");
      expect(icon).not.toHaveClass("animate-spin");
    });
  });

  describe("RunStatusDot component", () => {
    allStatuses.forEach((status) => {
      it(`renders ${status} status dot correctly`, () => {
        const { container } = render(<RunStatusDot status={status} />);
        const dot = container.firstChild;
        expect(dot).toBeInTheDocument();
        expect(dot).toHaveClass("rounded-full");
      });
    });

    it("renders with title attribute", () => {
      const { container } = render(<RunStatusDot status="running" />);
      const dot = container.firstChild as HTMLElement;
      expect(dot).toHaveAttribute("title", "Running");
    });

    const dotSizes = ["sm", "default", "lg"] as const;

    dotSizes.forEach((size) => {
      it(`renders ${size} size correctly`, () => {
        const { container } = render(<RunStatusDot status="running" size={size} />);
        expect(container.firstChild).toBeInTheDocument();
      });
    });
  });

  describe("RunStatusIndicator component", () => {
    allStatuses.forEach((status) => {
      it(`renders ${status} status indicator correctly`, () => {
        const { container } = render(<RunStatusIndicator status={status} />);
        expect(container.firstChild).toBeInTheDocument();
      });
    });

    it("renders with dot and label", () => {
      render(<RunStatusIndicator status="running" />);
      expect(screen.getByText("Running")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(
        <RunStatusIndicator status="running" className="custom-class" />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("RunStatusBadge custom className", () => {
    it("applies custom className", () => {
      const { container } = render(
        <RunStatusBadge status="running" className="custom-class" />
      );
      const badge = container.querySelector('[data-slot="badge"]');
      expect(badge).toHaveClass("custom-class");
    });
  });

  describe("RunStatusBadge fallback for unknown status", () => {
    it("handles unknown status gracefully", () => {
      // TypeScript would normally prevent this, but testing runtime behavior
      render(<RunStatusBadge status={"unknown" as RunStatus} />);
      expect(screen.getByText("unknown")).toBeInTheDocument();
    });
  });
});
