/**
 * Tests for JsonViewer component
 * Test IDs: UI-JSON-001 to UI-JSON-015
 *
 * Note: JsonViewer uses virtualization, so we test the component structure
 * and toolbar functionality rather than trying to access virtualized content.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonViewer } from "@/components/shared/json-viewer";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

describe("JsonViewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // UI-JSON-001: Renders without crashing
  it("renders without crashing", () => {
    const { container } = render(<JsonViewer data={{ test: "value" }} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-002: Shows line count in footer
  it("shows line count in footer", () => {
    render(<JsonViewer data={{ a: 1, b: 2, c: 3 }} />);
    expect(screen.getByText(/lines/)).toBeInTheDocument();
  });

  // UI-JSON-003: Renders toolbar buttons
  it("renders toolbar buttons", () => {
    render(<JsonViewer data={{ a: 1 }} />);
    // Should have expand, collapse, and copy buttons
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  // UI-JSON-004: Shows search input when searchable
  it("shows search input when searchable prop is true", () => {
    render(<JsonViewer data={{ a: 1 }} searchable />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  // UI-JSON-005: Does not show search when searchable is false
  it("does not show search input when searchable is false", () => {
    render(<JsonViewer data={{ a: 1 }} searchable={false} />);
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  // UI-JSON-006: Applies custom className
  it("applies custom className", () => {
    const { container } = render(
      <JsonViewer data={{ a: 1 }} className="custom-json-class" />
    );
    expect(container.firstChild).toHaveClass("custom-json-class");
  });

  // UI-JSON-007: Copy button exists and is clickable
  it("copy button exists and is clickable", async () => {
    const user = userEvent.setup();
    const data = { test: "data" };
    render(<JsonViewer data={data} />);

    // Find all buttons in toolbar
    const buttons = screen.getAllByRole("button");
    // The toolbar should have at least 3 buttons (expand, collapse, copy)
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    // Copy button should be clickable without errors
    const copyButton = buttons[buttons.length - 1];
    await user.click(copyButton);
    // Component should still be rendered after click
    expect(screen.getByText(/lines/)).toBeInTheDocument();
  });

  // UI-JSON-008: Search shows match count when query matches
  it("search shows match count when query matches", async () => {
    const user = userEvent.setup();
    const data = { firstName: "John", lastName: "Doe" };
    render(<JsonViewer data={data} searchable />);

    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "John");

    await waitFor(() => {
      // Should show match count
      expect(screen.getByText(/match/)).toBeInTheDocument();
    });
  });

  // UI-JSON-009: Clear search button appears when searching
  it("clear search button appears when searching", async () => {
    const user = userEvent.setup();
    render(<JsonViewer data={{ a: 1 }} searchable />);

    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");

    // Clear button should appear (X button)
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      // More buttons now with clear button
      expect(buttons.length).toBeGreaterThan(3);
    });
  });

  // UI-JSON-010: Has scroll container with max height
  it("has scroll container with max height", () => {
    const { container } = render(<JsonViewer data={{ a: 1 }} maxHeight={300} />);
    const scrollContainer = container.querySelector('[style*="max-height: 300px"]');
    expect(scrollContainer).toBeInTheDocument();
  });

  // UI-JSON-011: Default max height is 400px
  it("default max height is 400px", () => {
    const { container } = render(<JsonViewer data={{ a: 1 }} />);
    const scrollContainer = container.querySelector('[style*="max-height: 400px"]');
    expect(scrollContainer).toBeInTheDocument();
  });

  // UI-JSON-012: Shows redacted count when redactedPaths provided
  it("shows redacted count when redactedPaths provided", () => {
    const data = { password: "secret", name: "test" };
    render(<JsonViewer data={data} redactedPaths={["$.password"]} />);
    // Footer shows redacted count
    expect(screen.getByText(/redacted/)).toBeInTheDocument();
  });

  // UI-JSON-013: Has border styling
  it("has border styling", () => {
    const { container } = render(<JsonViewer data={{ a: 1 }} />);
    expect(container.firstChild).toHaveClass("border");
    expect(container.firstChild).toHaveClass("rounded-lg");
  });

  // UI-JSON-014: Has background styling
  it("has background styling", () => {
    const { container } = render(<JsonViewer data={{ a: 1 }} />);
    expect(container.firstChild).toHaveClass("bg-background-secondary");
  });

  // UI-JSON-015: Handles null data
  it("handles null data without crashing", () => {
    const { container } = render(<JsonViewer data={null} />);
    expect(container.firstChild).toBeInTheDocument();
    expect(screen.getByText(/lines/)).toBeInTheDocument();
  });
});

describe("JsonViewer with different data types", () => {
  // UI-JSON-016: Handles string data
  it("handles string data", () => {
    const { container } = render(<JsonViewer data="hello world" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-017: Handles number data
  it("handles number data", () => {
    const { container } = render(<JsonViewer data={42} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-018: Handles boolean data
  it("handles boolean data", () => {
    const { container } = render(<JsonViewer data={true} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-019: Handles array data
  it("handles array data", () => {
    const { container } = render(<JsonViewer data={[1, 2, 3]} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-020: Handles nested object data
  it("handles nested object data", () => {
    const data = {
      level1: {
        level2: {
          value: "deep",
        },
      },
    };
    const { container } = render(<JsonViewer data={data} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-021: Handles empty object
  it("handles empty object", () => {
    const { container } = render(<JsonViewer data={{}} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-022: Handles empty array
  it("handles empty array", () => {
    const { container } = render(<JsonViewer data={[]} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe("JsonViewer collapsed prop", () => {
  // UI-JSON-023: Works with collapsed=true
  it("works with collapsed=true", () => {
    const { container } = render(
      <JsonViewer data={{ a: { b: 1 } }} collapsed />
    );
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-024: Works with collapsed=number (depth)
  it("works with collapsed=number (depth)", () => {
    const { container } = render(
      <JsonViewer data={{ a: { b: 1 } }} collapsed={1} />
    );
    expect(container.firstChild).toBeInTheDocument();
  });

  // UI-JSON-025: Works with collapsed=false
  it("works with collapsed=false", () => {
    const { container } = render(
      <JsonViewer data={{ a: { b: 1 } }} collapsed={false} />
    );
    expect(container.firstChild).toBeInTheDocument();
  });
});
