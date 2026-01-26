/**
 * Layout Responsive Tests.
 *
 * UI-RSP-004: Overall page layout adapts to viewport
 */

import { render, screen, act } from "@testing-library/react";
import { setViewport, viewports } from "../utils/test-utils";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

// Responsive page layout component
function ResponsivePageLayout() {
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
    <div data-testid="page-layout" className="min-h-screen">
      {/* Header */}
      <header
        data-testid="header"
        className={isMobile ? "px-4 py-2" : "px-8 py-4"}
      >
        <div className={isMobile ? "flex-col gap-2" : "flex items-center justify-between"}>
          <h1 data-testid="logo">FerrumDeck</h1>
          {!isMobile && (
            <nav data-testid="desktop-nav">
              <button>Runs</button>
              <button>Approvals</button>
              <button>Settings</button>
            </nav>
          )}
          {isMobile && (
            <Button variant="ghost" data-testid="mobile-menu">
              Menu
            </Button>
          )}
        </div>
      </header>

      {/* Main content area */}
      <div
        data-testid="content-wrapper"
        className={isMobile ? "flex-col" : "flex"}
      >
        {/* Sidebar (desktop only) */}
        {!isMobile && (
          <aside data-testid="sidebar" className="w-64 shrink-0">
            <nav>
              <button>Runs</button>
              <button>Approvals</button>
            </nav>
          </aside>
        )}

        {/* Main content */}
        <main
          data-testid="main-content"
          className={isMobile ? "px-4 py-4" : "flex-1 px-8 py-6"}
        >
          <div
            data-testid="content-grid"
            className={isMobile ? "grid-cols-1" : "grid grid-cols-3 gap-6"}
          >
            <div data-testid="card-1">Card 1</div>
            <div data-testid="card-2">Card 2</div>
            <div data-testid="card-3">Card 3</div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer
        data-testid="footer"
        className={isMobile ? "px-4 py-2 text-center" : "px-8 py-4"}
      >
        <p>© 2024 FerrumDeck</p>
      </footer>
    </div>
  );
}

// Stack layout that changes direction
function ResponsiveStack() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <div
      data-testid="button-stack"
      className={isMobile ? "flex-col space-y-2" : "flex space-x-2"}
    >
      <Button data-testid="btn-1">Button 1</Button>
      <Button data-testid="btn-2">Button 2</Button>
      <Button data-testid="btn-3">Button 3</Button>
    </div>
  );
}

describe("UI-RSP-004: Layout Responsiveness", () => {
  beforeEach(() => {
    setViewport(1280, 800);
  });

  describe("Page layout structure", () => {
    it("renders all layout sections", () => {
      render(<ResponsivePageLayout />);

      expect(screen.getByTestId("header")).toBeInTheDocument();
      expect(screen.getByTestId("main-content")).toBeInTheDocument();
      expect(screen.getByTestId("footer")).toBeInTheDocument();
    });

    it("shows sidebar on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsivePageLayout />);

      expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    });

    it("hides sidebar on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    });
  });

  describe("Header responsiveness", () => {
    it("shows desktop navigation on wide viewport", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsivePageLayout />);

      expect(screen.getByTestId("desktop-nav")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
    });

    it("shows mobile menu button on narrow viewport", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      expect(screen.getByTestId("mobile-menu")).toBeInTheDocument();
      expect(screen.queryByTestId("desktop-nav")).not.toBeInTheDocument();
    });

    it("logo is visible at all viewports", () => {
      // Desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender } = render(<ResponsivePageLayout />);
      expect(screen.getByTestId("logo")).toBeInTheDocument();

      // Mobile
      setViewport(viewports.mobile.width, viewports.mobile.height);
      rerender(<ResponsivePageLayout />);
      expect(screen.getByTestId("logo")).toBeInTheDocument();
    });
  });

  describe("Content grid responsiveness", () => {
    it("shows multi-column grid on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsivePageLayout />);

      const grid = screen.getByTestId("content-grid");
      expect(grid).toHaveClass("grid-cols-3");
    });

    it("shows single-column grid on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      const grid = screen.getByTestId("content-grid");
      expect(grid).toHaveClass("grid-cols-1");
    });

    it("all cards are visible at all viewports", () => {
      // Desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender } = render(<ResponsivePageLayout />);

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-2")).toBeInTheDocument();
      expect(screen.getByTestId("card-3")).toBeInTheDocument();

      // Mobile
      setViewport(viewports.mobile.width, viewports.mobile.height);
      rerender(<ResponsivePageLayout />);

      expect(screen.getByTestId("card-1")).toBeInTheDocument();
      expect(screen.getByTestId("card-2")).toBeInTheDocument();
      expect(screen.getByTestId("card-3")).toBeInTheDocument();
    });
  });

  describe("Button stack responsiveness", () => {
    it("buttons are horizontal on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveStack />);

      const stack = screen.getByTestId("button-stack");
      expect(stack).toHaveClass("space-x-2");
    });

    it("buttons are vertical on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveStack />);

      const stack = screen.getByTestId("button-stack");
      expect(stack).toHaveClass("flex-col");
    });

    it("all buttons are visible at all viewports", () => {
      // Desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender } = render(<ResponsiveStack />);

      expect(screen.getByTestId("btn-1")).toBeInTheDocument();
      expect(screen.getByTestId("btn-2")).toBeInTheDocument();
      expect(screen.getByTestId("btn-3")).toBeInTheDocument();

      // Mobile
      setViewport(viewports.mobile.width, viewports.mobile.height);
      rerender(<ResponsiveStack />);

      expect(screen.getByTestId("btn-1")).toBeInTheDocument();
      expect(screen.getByTestId("btn-2")).toBeInTheDocument();
      expect(screen.getByTestId("btn-3")).toBeInTheDocument();
    });
  });

  describe("Layout transitions", () => {
    it("layout adapts smoothly on viewport resize", () => {
      const { rerender } = render(<ResponsivePageLayout />);

      // Start at widescreen
      act(() => {
        setViewport(viewports.widescreen.width, viewports.widescreen.height);
      });
      rerender(<ResponsivePageLayout />);
      expect(screen.getByTestId("sidebar")).toBeInTheDocument();

      // Resize to desktop
      act(() => {
        setViewport(viewports.desktop.width, viewports.desktop.height);
      });
      rerender(<ResponsivePageLayout />);
      expect(screen.getByTestId("sidebar")).toBeInTheDocument();

      // Resize to tablet
      act(() => {
        setViewport(viewports.tablet.width, viewports.tablet.height);
      });
      rerender(<ResponsivePageLayout />);
      expect(screen.getByTestId("sidebar")).toBeInTheDocument();

      // Resize to mobile
      act(() => {
        setViewport(viewports.mobile.width, viewports.mobile.height);
      });
      rerender(<ResponsivePageLayout />);
      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    });
  });

  describe("Padding and spacing", () => {
    it("has appropriate padding on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      const header = screen.getByTestId("header");
      expect(header).toHaveClass("px-4");
    });

    it("has larger padding on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsivePageLayout />);

      const header = screen.getByTestId("header");
      expect(header).toHaveClass("px-8");
    });
  });

  describe("Footer responsiveness", () => {
    it("footer is centered on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      const footer = screen.getByTestId("footer");
      expect(footer).toHaveClass("text-center");
    });

    it("footer is visible at all viewports", () => {
      Object.values(viewports).forEach((vp) => {
        setViewport(vp.width, vp.height);
        const { unmount } = render(<ResponsivePageLayout />);
        expect(screen.getByTestId("footer")).toBeInTheDocument();
        unmount();
      });
    });
  });

  describe("Content wrapper direction", () => {
    it("uses row direction on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsivePageLayout />);

      const wrapper = screen.getByTestId("content-wrapper");
      expect(wrapper).toHaveClass("flex");
    });

    it("uses column direction on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsivePageLayout />);

      const wrapper = screen.getByTestId("content-wrapper");
      expect(wrapper).toHaveClass("flex-col");
    });
  });
});
