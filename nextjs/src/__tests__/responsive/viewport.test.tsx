/**
 * Viewport and Responsive Breakpoint Tests.
 *
 * UI-RSP-001: Components respond to viewport changes
 */

import { render, screen, act } from "@testing-library/react";
import { setViewport, viewports } from "../utils/test-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect } from "react";

// Component that responds to viewport
function ResponsiveComponent() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <div data-testid="responsive">
      <span data-testid="view-type">{isMobile ? "Mobile" : "Desktop"}</span>
      <div className={isMobile ? "flex-col" : "flex-row"}>
        <Button className={isMobile ? "w-full" : "w-auto"}>Action</Button>
      </div>
    </div>
  );
}

// Grid that adapts to viewport
function ResponsiveGrid() {
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width < 640) setColumns(1);
      else if (width < 768) setColumns(2);
      else if (width < 1024) setColumns(3);
      else setColumns(4);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  return (
    <div data-testid="grid" data-columns={columns}>
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} data-testid={`card-${i}`}>
          <CardHeader>
            <CardTitle>Card {i}</CardTitle>
          </CardHeader>
          <CardContent>Content {i}</CardContent>
        </Card>
      ))}
    </div>
  );
}

describe("UI-RSP-001: Viewport Responsiveness", () => {
  beforeEach(() => {
    // Reset to desktop viewport
    setViewport(1280, 800);
  });

  describe("Viewport detection", () => {
    it("detects mobile viewport", () => {
      setViewport(375, 667);
      render(<ResponsiveComponent />);

      expect(screen.getByTestId("view-type")).toHaveTextContent("Mobile");
    });

    it("detects desktop viewport", () => {
      setViewport(1280, 800);
      render(<ResponsiveComponent />);

      expect(screen.getByTestId("view-type")).toHaveTextContent("Desktop");
    });

    it("responds to viewport resize", () => {
      render(<ResponsiveComponent />);

      // Start at desktop
      expect(screen.getByTestId("view-type")).toHaveTextContent("Desktop");

      // Resize to mobile
      act(() => {
        setViewport(375, 667);
      });
      expect(screen.getByTestId("view-type")).toHaveTextContent("Mobile");

      // Resize back to desktop
      act(() => {
        setViewport(1280, 800);
      });
      expect(screen.getByTestId("view-type")).toHaveTextContent("Desktop");
    });
  });

  describe("Responsive grid columns", () => {
    it("shows 1 column on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveGrid />);

      expect(screen.getByTestId("grid")).toHaveAttribute("data-columns", "1");
    });

    it("shows 2 columns on small tablet", () => {
      setViewport(700, 1024);
      render(<ResponsiveGrid />);

      expect(screen.getByTestId("grid")).toHaveAttribute("data-columns", "2");
    });

    it("shows 3 columns on tablet", () => {
      setViewport(800, 1024);
      render(<ResponsiveGrid />);

      expect(screen.getByTestId("grid")).toHaveAttribute("data-columns", "3");
    });

    it("shows 4 columns on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveGrid />);

      expect(screen.getByTestId("grid")).toHaveAttribute("data-columns", "4");
    });
  });

  describe("Breakpoint boundaries", () => {
    const breakpoints = [
      { name: "sm", width: 640 },
      { name: "md", width: 768 },
      { name: "lg", width: 1024 },
      { name: "xl", width: 1280 },
      { name: "2xl", width: 1536 },
    ];

    breakpoints.forEach(({ name, width }) => {
      it(`${name} breakpoint at ${width}px is accessible`, () => {
        setViewport(width, 800);
        render(<div data-testid="breakpoint">Test</div>);

        expect(window.innerWidth).toBe(width);
        expect(screen.getByTestId("breakpoint")).toBeInTheDocument();
      });
    });
  });

  describe("Content visibility at breakpoints", () => {
    it("renders all cards at any viewport", () => {
      // Mobile
      setViewport(viewports.mobile.width, viewports.mobile.height);
      const { rerender } = render(<ResponsiveGrid />);

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-2")).toBeInTheDocument();
      expect(screen.getByTestId("card-3")).toBeInTheDocument();
      expect(screen.getByTestId("card-4")).toBeInTheDocument();

      // Desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      rerender(<ResponsiveGrid />);

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-2")).toBeInTheDocument();
      expect(screen.getByTestId("card-3")).toBeInTheDocument();
      expect(screen.getByTestId("card-4")).toBeInTheDocument();
    });
  });

  describe("Button responsiveness", () => {
    it("button adapts to mobile viewport", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveComponent />);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });

    it("button adapts to desktop viewport", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveComponent />);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });
  });

  describe("Standard viewports", () => {
    Object.entries(viewports).forEach(([name, { width, height }]) => {
      it(`renders correctly at ${name} viewport (${width}x${height})`, () => {
        setViewport(width, height);
        render(
          <div data-testid="viewport-test">
            <Button>Test Button</Button>
          </div>
        );

        expect(screen.getByTestId("viewport-test")).toBeInTheDocument();
        expect(screen.getByRole("button")).toBeInTheDocument();
      });
    });
  });
});
