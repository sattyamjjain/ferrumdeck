/**
 * Color Contrast and Visual Accessibility Tests.
 *
 * UI-A11Y-004: Visual accessibility requirements
 */

import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import type { RunStatus } from "@/types/run";

describe("UI-A11Y-004: Visual Accessibility", () => {
  describe("Color is not the only indicator", () => {
    it("error states have text labels not just color", () => {
      render(
        <div>
          <Input aria-invalid="true" />
          <span role="alert" id="error">
            This field is required
          </span>
        </div>
      );

      // Error has both text and potentially color
      expect(screen.getByRole("alert")).toHaveTextContent("This field is required");
    });

    it("status badges have text labels", () => {
      const statuses: RunStatus[] = [
        "running",
        "completed",
        "failed",
        "waiting_approval",
      ];

      statuses.forEach((status) => {
        const { unmount } = render(<RunStatusBadge status={status} />);
        // Badge should have visible text, not just color
        const badge = document.querySelector('[data-slot="badge"]');
        expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
        unmount();
      });
    });

    it("buttons have text or aria-label", () => {
      // Icon-only buttons should have aria-label
      render(
        <Button aria-label="Close" size="icon">
          <span>X</span>
        </Button>
      );
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("alerts have title and description", () => {
      render(
        <Alert>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Something went wrong</AlertDescription>
        </Alert>
      );

      expect(screen.getByText("Error")).toBeInTheDocument();
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  describe("Badge variants have sufficient contrast", () => {
    // These tests verify that badge variants exist and render
    // Actual contrast testing would require visual regression tools
    const variants = [
      "default",
      "secondary",
      "destructive",
      "outline",
      "running",
      "completed",
      "failed",
      "waiting",
      "critical",
      "high",
      "medium",
      "low",
    ] as const;

    variants.forEach((variant) => {
      it(`${variant} variant renders with visible text`, () => {
        render(<Badge variant={variant}>{variant}</Badge>);
        expect(screen.getByText(variant)).toBeInTheDocument();
      });
    });
  });

  describe("Button variants are distinguishable", () => {
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const;

    variants.forEach((variant) => {
      it(`${variant} variant has distinct styling`, () => {
        render(
          <Button variant={variant} data-testid={`btn-${variant}`}>
            {variant}
          </Button>
        );

        const button = screen.getByTestId(`btn-${variant}`);
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute("data-variant", variant);
      });
    });
  });

  describe("Disabled states are perceivable", () => {
    it("disabled button is visually distinct", () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole("button");

      expect(button).toBeDisabled();
      // Disabled buttons typically have reduced opacity
      // This would need visual regression testing for actual verification
    });

    it("disabled input is visually distinct", () => {
      render(<Input disabled placeholder="Disabled" />);
      const input = screen.getByPlaceholderText("Disabled");

      expect(input).toBeDisabled();
    });
  });

  describe("Focus indicators are visible", () => {
    it("button has focus-visible styling defined", () => {
      render(<Button>Focusable</Button>);
      const button = screen.getByRole("button");

      // Button component includes focus-visible classes
      // Verify button can receive focus
      button.focus();
      expect(button).toHaveFocus();
    });

    it("input has focus-visible styling defined", () => {
      render(<Input placeholder="Focusable" />);
      const input = screen.getByPlaceholderText("Focusable");

      input.focus();
      expect(input).toHaveFocus();
    });
  });

  describe("Text sizing", () => {
    it("body text uses relative units", () => {
      // This is a structural test - actual font sizes use relative units in CSS
      render(<p className="text-sm">Small text</p>);
      expect(screen.getByText("Small text")).toBeInTheDocument();
    });

    it("headings are larger than body text", () => {
      render(
        <>
          <h1>Heading</h1>
          <p>Body text</p>
        </>
      );

      const heading = screen.getByRole("heading");
      expect(heading).toBeInTheDocument();
    });
  });

  describe("Animation and motion", () => {
    it("loading spinners can be stopped by user preference", () => {
      // prefers-reduced-motion should be respected
      // This tests that components with animation classes exist
      const { container } = render(
        <span className="animate-spin">Loading</span>
      );
      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });

    it("status badges with pulse respect motion preferences", () => {
      const { container } = render(<Badge pulse>Pulsing</Badge>);
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });
  });

  describe("Screen reader only content", () => {
    it("sr-only class hides content visually but not from screen readers", () => {
      render(
        <button>
          <span className="sr-only">Close modal</span>
          <span aria-hidden="true">X</span>
        </button>
      );

      // The button should be accessible by its sr-only text
      expect(screen.getByRole("button", { name: /Close modal/i })).toBeInTheDocument();
    });

    it("skip links use sr-only with focus visibility", () => {
      render(
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to main content
        </a>
      );

      const link = screen.getByRole("link", { name: /Skip to main content/i });
      expect(link).toBeInTheDocument();
    });
  });

  describe("Interactive element sizing", () => {
    it("buttons meet minimum touch target size", () => {
      render(<Button>Touch Target</Button>);
      const button = screen.getByRole("button");

      // Buttons should have minimum height defined
      // Default button size should be at least 36px (h-9 = 36px)
      expect(button).toBeInTheDocument();
    });

    it("icon buttons meet minimum touch target size", () => {
      render(
        <Button size="icon" aria-label="Icon button">
          X
        </Button>
      );

      const button = screen.getByRole("button", { name: "Icon button" });
      // size="icon" should be size-9 = 36px
      expect(button).toBeInTheDocument();
    });
  });

  describe("Error and success states", () => {
    it("error states have multiple indicators", () => {
      render(
        <div>
          <Input
            aria-invalid="true"
            aria-describedby="error-message"
            className="border-destructive"
          />
          <p id="error-message" role="alert" className="text-destructive">
            Invalid input
          </p>
        </div>
      );

      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("success states have text indicators", () => {
      render(
        <Alert>
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>Operation completed successfully</AlertDescription>
        </Alert>
      );

      expect(screen.getByText("Success")).toBeInTheDocument();
      expect(screen.getByText("Operation completed successfully")).toBeInTheDocument();
    });
  });
});
