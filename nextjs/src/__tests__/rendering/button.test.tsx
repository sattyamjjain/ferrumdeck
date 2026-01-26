/**
 * Button Component Rendering Tests.
 *
 * UI-RND-001: Button renders with all variants
 */

import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("UI-RND-001: Button Component Rendering", () => {
  describe("renders with all variants", () => {
    it("renders default variant", () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole("button", { name: "Default" })).toBeInTheDocument();
    });

    it("renders destructive variant", () => {
      render(<Button variant="destructive">Delete</Button>);
      const button = screen.getByRole("button", { name: "Delete" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-variant", "destructive");
    });

    it("renders outline variant", () => {
      render(<Button variant="outline">Outline</Button>);
      const button = screen.getByRole("button", { name: "Outline" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-variant", "outline");
    });

    it("renders secondary variant", () => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole("button", { name: "Secondary" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-variant", "secondary");
    });

    it("renders ghost variant", () => {
      render(<Button variant="ghost">Ghost</Button>);
      const button = screen.getByRole("button", { name: "Ghost" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-variant", "ghost");
    });

    it("renders link variant", () => {
      render(<Button variant="link">Link</Button>);
      const button = screen.getByRole("button", { name: "Link" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-variant", "link");
    });
  });

  describe("renders with all sizes", () => {
    it("renders default size", () => {
      render(<Button size="default">Default Size</Button>);
      const button = screen.getByRole("button", { name: "Default Size" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-size", "default");
    });

    it("renders sm size", () => {
      render(<Button size="sm">Small</Button>);
      const button = screen.getByRole("button", { name: "Small" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-size", "sm");
    });

    it("renders lg size", () => {
      render(<Button size="lg">Large</Button>);
      const button = screen.getByRole("button", { name: "Large" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-size", "lg");
    });

    it("renders icon size", () => {
      render(<Button size="icon">Icon</Button>);
      const button = screen.getByRole("button", { name: "Icon" });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-size", "icon");
    });
  });

  describe("renders with states", () => {
    it("renders disabled state", () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole("button", { name: "Disabled" });
      expect(button).toBeDisabled();
    });

    it("renders loading state with spinner", () => {
      render(
        <Button disabled>
          <span className="animate-spin">Loading...</span>
        </Button>
      );
      expect(screen.getByRole("button")).toBeDisabled();
    });
  });

  describe("renders asChild correctly", () => {
    it("renders as anchor when asChild is true", () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      const link = screen.getByRole("link", { name: "Link Button" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/test");
    });
  });
});
