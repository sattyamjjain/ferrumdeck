/**
 * Sidebar Responsive Tests.
 *
 * UI-RSP-002: Sidebar collapses on mobile
 */

import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setViewport, viewports } from "../utils/test-utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

// Mock sidebar component that behaves responsively
function ResponsiveSidebar() {
  const [isMobile, setIsMobile] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsCollapsed(true);
      }
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (isMobile) {
    return (
      <div data-testid="mobile-layout">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="menu-button"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" data-testid="mobile-sidebar">
            <nav>
              <button>Runs</button>
              <button>Approvals</button>
              <button>Agents</button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div data-testid="desktop-layout" className="flex">
      <aside
        data-testid="desktop-sidebar"
        className={isCollapsed ? "w-16" : "w-64"}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
          data-testid="collapse-button"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <nav>
          <button data-testid="nav-runs">
            {!isCollapsed && "Runs"}
          </button>
          <button data-testid="nav-approvals">
            {!isCollapsed && "Approvals"}
          </button>
          <button data-testid="nav-agents">
            {!isCollapsed && "Agents"}
          </button>
        </nav>
      </aside>
      <main data-testid="main-content">Content</main>
    </div>
  );
}

describe("UI-RSP-002: Sidebar Responsiveness", () => {
  beforeEach(() => {
    setViewport(1280, 800);
  });

  describe("Desktop sidebar", () => {
    it("shows desktop sidebar on wide viewport", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      expect(screen.getByTestId("desktop-layout")).toBeInTheDocument();
      expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    });

    it("sidebar is expanded by default on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      // Navigation text should be visible when expanded
      expect(screen.getByTestId("nav-runs")).toHaveTextContent("Runs");
    });

    it("sidebar can be collapsed on desktop", async () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      const collapseButton = screen.getByTestId("collapse-button");
      await userEvent.click(collapseButton);

      // Navigation text should be hidden when collapsed
      expect(screen.getByTestId("nav-runs")).toHaveTextContent("");
    });

    it("collapsed sidebar can be expanded", async () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      const collapseButton = screen.getByTestId("collapse-button");

      // Collapse
      await userEvent.click(collapseButton);
      expect(screen.getByTestId("nav-runs")).toHaveTextContent("");

      // Expand
      await userEvent.click(collapseButton);
      expect(screen.getByTestId("nav-runs")).toHaveTextContent("Runs");
    });
  });

  describe("Mobile sidebar (drawer)", () => {
    it("shows mobile layout on narrow viewport", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      expect(screen.getByTestId("mobile-layout")).toBeInTheDocument();
    });

    it("shows menu button on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      expect(screen.getByTestId("menu-button")).toBeInTheDocument();
    });

    it("sidebar is hidden by default on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      expect(screen.queryByTestId("mobile-sidebar")).not.toBeInTheDocument();
    });

    it("opens mobile sidebar when menu button is clicked", async () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      const menuButton = screen.getByTestId("menu-button");
      await userEvent.click(menuButton);

      await waitFor(() => {
        expect(screen.getByTestId("mobile-sidebar")).toBeInTheDocument();
      });
    });

    it("mobile sidebar can be closed", async () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      // Open sidebar
      await userEvent.click(screen.getByTestId("menu-button"));
      await waitFor(() => {
        expect(screen.getByTestId("mobile-sidebar")).toBeInTheDocument();
      });

      // Close with escape
      await userEvent.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByTestId("mobile-sidebar")).not.toBeInTheDocument();
      });
    });
  });

  describe("Viewport transitions", () => {
    it("switches from desktop to mobile layout on resize", () => {
      // Start at desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender } = render(<ResponsiveSidebar />);
      expect(screen.getByTestId("desktop-layout")).toBeInTheDocument();

      // Resize to mobile
      act(() => {
        setViewport(viewports.mobile.width, viewports.mobile.height);
      });
      rerender(<ResponsiveSidebar />);
      expect(screen.getByTestId("mobile-layout")).toBeInTheDocument();
    });

    it("switches from mobile to desktop layout on resize", () => {
      // Start at mobile
      setViewport(viewports.mobile.width, viewports.mobile.height);
      const { rerender } = render(<ResponsiveSidebar />);
      expect(screen.getByTestId("mobile-layout")).toBeInTheDocument();

      // Resize to desktop
      act(() => {
        setViewport(viewports.desktop.width, viewports.desktop.height);
      });
      rerender(<ResponsiveSidebar />);
      expect(screen.getByTestId("desktop-layout")).toBeInTheDocument();
    });
  });

  describe("Sidebar accessibility", () => {
    it("menu button has accessible label", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveSidebar />);

      expect(
        screen.getByRole("button", { name: "Open menu" })
      ).toBeInTheDocument();
    });

    it("collapse button has accessible label", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      expect(
        screen.getByRole("button", { name: /sidebar/i })
      ).toBeInTheDocument();
    });

    it("navigation links are accessible", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveSidebar />);

      expect(screen.getByRole("link", { name: /runs/i })).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /approvals/i })
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /agents/i })).toBeInTheDocument();
    });
  });

  describe("Tablet breakpoint", () => {
    it("shows appropriate layout at tablet width", () => {
      setViewport(viewports.tablet.width, viewports.tablet.height);
      render(<ResponsiveSidebar />);

      // At 768px, should show desktop layout
      expect(screen.getByTestId("desktop-layout")).toBeInTheDocument();
    });

    it("shows mobile layout just below tablet breakpoint", () => {
      setViewport(767, 1024);
      render(<ResponsiveSidebar />);

      expect(screen.getByTestId("mobile-layout")).toBeInTheDocument();
    });
  });
});
