/**
 * Table Responsive Tests.
 *
 * UI-RSP-003: Tables handle responsive layouts
 */

import { render, screen, act } from "@testing-library/react";
import { setViewport, viewports } from "../utils/test-utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect } from "react";

// Mock data
const mockData = [
  { id: "1", name: "Run 1", status: "completed", duration: "2m 34s", cost: "$0.05" },
  { id: "2", name: "Run 2", status: "running", duration: "1m 12s", cost: "$0.02" },
  { id: "3", name: "Run 3", status: "failed", duration: "45s", cost: "$0.01" },
];

// Responsive table that becomes cards on mobile
function ResponsiveDataDisplay() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (isMobile) {
    return (
      <div data-testid="card-view" className="space-y-4">
        {mockData.map((item) => (
          <Card key={item.id} data-testid={`card-${item.id}`}>
            <CardHeader>
              <CardTitle>{item.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2">
                <dt>Status</dt>
                <dd data-testid={`status-${item.id}`}>{item.status}</dd>
                <dt>Duration</dt>
                <dd data-testid={`duration-${item.id}`}>{item.duration}</dd>
                <dt>Cost</dt>
                <dd data-testid={`cost-${item.id}`}>{item.cost}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="table-view" className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockData.map((item) => (
            <TableRow key={item.id} data-testid={`row-${item.id}`}>
              <TableCell data-testid={`name-${item.id}`}>{item.name}</TableCell>
              <TableCell data-testid={`status-${item.id}`}>{item.status}</TableCell>
              <TableCell data-testid={`duration-${item.id}`}>{item.duration}</TableCell>
              <TableCell data-testid={`cost-${item.id}`}>{item.cost}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Horizontally scrollable table
function ScrollableTable() {
  return (
    <div
      data-testid="scrollable-container"
      className="overflow-x-auto max-w-full"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[150px]">Column 1</TableHead>
            <TableHead className="min-w-[150px]">Column 2</TableHead>
            <TableHead className="min-w-[150px]">Column 3</TableHead>
            <TableHead className="min-w-[150px]">Column 4</TableHead>
            <TableHead className="min-w-[150px]">Column 5</TableHead>
            <TableHead className="min-w-[150px]">Column 6</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Data 1</TableCell>
            <TableCell>Data 2</TableCell>
            <TableCell>Data 3</TableCell>
            <TableCell>Data 4</TableCell>
            <TableCell>Data 5</TableCell>
            <TableCell>Data 6</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

describe("UI-RSP-003: Table Responsiveness", () => {
  beforeEach(() => {
    setViewport(1280, 800);
  });

  describe("Responsive data display", () => {
    it("shows table view on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveDataDisplay />);

      expect(screen.getByTestId("table-view")).toBeInTheDocument();
      expect(screen.queryByTestId("card-view")).not.toBeInTheDocument();
    });

    it("shows card view on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveDataDisplay />);

      expect(screen.getByTestId("card-view")).toBeInTheDocument();
      expect(screen.queryByTestId("table-view")).not.toBeInTheDocument();
    });

    it("displays all data in table view", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveDataDisplay />);

      mockData.forEach((item) => {
        expect(screen.getByTestId(`row-${item.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`name-${item.id}`)).toHaveTextContent(item.name);
        expect(screen.getByTestId(`status-${item.id}`)).toHaveTextContent(item.status);
      });
    });

    it("displays all data in card view", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveDataDisplay />);

      mockData.forEach((item) => {
        expect(screen.getByTestId(`card-${item.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`status-${item.id}`)).toHaveTextContent(item.status);
        expect(screen.getByTestId(`duration-${item.id}`)).toHaveTextContent(item.duration);
      });
    });
  });

  describe("Layout transitions", () => {
    it("switches from table to cards on resize to mobile", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender } = render(<ResponsiveDataDisplay />);
      expect(screen.getByTestId("table-view")).toBeInTheDocument();

      act(() => {
        setViewport(viewports.mobile.width, viewports.mobile.height);
      });
      rerender(<ResponsiveDataDisplay />);
      expect(screen.getByTestId("card-view")).toBeInTheDocument();
    });

    it("switches from cards to table on resize to desktop", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      const { rerender } = render(<ResponsiveDataDisplay />);
      expect(screen.getByTestId("card-view")).toBeInTheDocument();

      act(() => {
        setViewport(viewports.desktop.width, viewports.desktop.height);
      });
      rerender(<ResponsiveDataDisplay />);
      expect(screen.getByTestId("table-view")).toBeInTheDocument();
    });
  });

  describe("Scrollable table", () => {
    it("renders scrollable container", () => {
      render(<ScrollableTable />);

      const container = screen.getByTestId("scrollable-container");
      expect(container).toBeInTheDocument();
      expect(container).toHaveClass("overflow-x-auto");
    });

    it("table has all columns", () => {
      render(<ScrollableTable />);

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    });

    it("works at mobile viewport", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ScrollableTable />);

      // Table should still be present, just scrollable
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByTestId("scrollable-container")).toBeInTheDocument();
    });
  });

  describe("Table accessibility at different viewports", () => {
    it("table has proper structure on desktop", () => {
      setViewport(viewports.desktop.width, viewports.desktop.height);
      render(<ResponsiveDataDisplay />);

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(4); // 1 header + 3 data
      expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    });

    it("cards are accessible on mobile", () => {
      setViewport(viewports.mobile.width, viewports.mobile.height);
      render(<ResponsiveDataDisplay />);

      // Cards should be present - verify each card is rendered
      mockData.forEach((item) => {
        expect(screen.getByTestId(`card-${item.id}`)).toBeInTheDocument();
      });
    });
  });

  describe("Data integrity across views", () => {
    it("same data is shown in both views", () => {
      // Check desktop
      setViewport(viewports.desktop.width, viewports.desktop.height);
      const { rerender, unmount } = render(<ResponsiveDataDisplay />);

      const desktopStatuses = mockData.map((item) =>
        screen.getByTestId(`status-${item.id}`).textContent
      );

      // Switch to mobile
      act(() => {
        setViewport(viewports.mobile.width, viewports.mobile.height);
      });
      rerender(<ResponsiveDataDisplay />);

      const mobileStatuses = mockData.map((item) =>
        screen.getByTestId(`status-${item.id}`).textContent
      );

      // Data should match
      expect(desktopStatuses).toEqual(mobileStatuses);
    });
  });

  describe("Tablet breakpoint", () => {
    it("shows table view at tablet width", () => {
      setViewport(viewports.tablet.width, viewports.tablet.height);
      render(<ResponsiveDataDisplay />);

      expect(screen.getByTestId("table-view")).toBeInTheDocument();
    });

    it("shows card view just below tablet breakpoint", () => {
      setViewport(767, 1024);
      render(<ResponsiveDataDisplay />);

      expect(screen.getByTestId("card-view")).toBeInTheDocument();
    });
  });
});
