/**
 * Badge Component Rendering Tests.
 *
 * UI-RND-002: Badge renders with all variants
 */

import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("UI-RND-002: Badge Component Rendering", () => {
  describe("renders with all variants", () => {
    it("renders default variant", () => {
      render(<Badge>Default</Badge>);
      expect(screen.getByText("Default")).toBeInTheDocument();
    });

    it("renders secondary variant", () => {
      render(<Badge variant="secondary">Secondary</Badge>);
      expect(screen.getByText("Secondary")).toBeInTheDocument();
    });

    it("renders destructive variant", () => {
      render(<Badge variant="destructive">Destructive</Badge>);
      expect(screen.getByText("Destructive")).toBeInTheDocument();
    });

    it("renders outline variant", () => {
      render(<Badge variant="outline">Outline</Badge>);
      expect(screen.getByText("Outline")).toBeInTheDocument();
    });
  });

  describe("renders status variants", () => {
    const statusVariants = [
      "running",
      "completed",
      "failed",
      "waiting",
      "queued",
      "timeout",
      "budgetkilled",
      "cancelled",
    ] as const;

    statusVariants.forEach((variant) => {
      it(`renders ${variant} status variant`, () => {
        render(<Badge variant={variant}>{variant}</Badge>);
        expect(screen.getByText(variant)).toBeInTheDocument();
      });
    });
  });

  describe("renders risk level variants", () => {
    const riskVariants = ["critical", "high", "medium", "low"] as const;

    riskVariants.forEach((variant) => {
      it(`renders ${variant} risk level variant`, () => {
        render(<Badge variant={variant}>{variant}</Badge>);
        expect(screen.getByText(variant)).toBeInTheDocument();
      });
    });
  });

  describe("renders action variants", () => {
    it("renders blocked variant", () => {
      render(<Badge variant="blocked">Blocked</Badge>);
      expect(screen.getByText("Blocked")).toBeInTheDocument();
    });

    it("renders logged variant", () => {
      render(<Badge variant="logged">Logged</Badge>);
      expect(screen.getByText("Logged")).toBeInTheDocument();
    });
  });

  describe("renders type indicator variants", () => {
    it("renders llm variant", () => {
      render(<Badge variant="llm">LLM</Badge>);
      expect(screen.getByText("LLM")).toBeInTheDocument();
    });

    it("renders tool variant", () => {
      render(<Badge variant="tool">Tool</Badge>);
      expect(screen.getByText("Tool")).toBeInTheDocument();
    });

    it("renders approval variant", () => {
      render(<Badge variant="approval">Approval</Badge>);
      expect(screen.getByText("Approval")).toBeInTheDocument();
    });
  });

  describe("renders with pulse animation", () => {
    it("applies pulse class when pulse prop is true", () => {
      const { container } = render(<Badge pulse>Pulsing</Badge>);
      expect(container.firstChild).toHaveClass("animate-pulse");
    });

    it("does not apply pulse class when pulse prop is false", () => {
      const { container } = render(<Badge pulse={false}>Not Pulsing</Badge>);
      expect(container.firstChild).not.toHaveClass("animate-pulse");
    });
  });

  describe("renders with custom className", () => {
    it("applies custom className", () => {
      const { container } = render(
        <Badge className="custom-class">Custom</Badge>
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("renders asChild correctly", () => {
    it("renders as anchor when asChild is true", () => {
      render(
        <Badge asChild>
          <a href="/test">Link Badge</a>
        </Badge>
      );
      const link = screen.getByRole("link", { name: "Link Badge" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/test");
    });
  });
});
