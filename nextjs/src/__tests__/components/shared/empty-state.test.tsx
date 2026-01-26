/**
 * Tests for EmptyState components
 * Test IDs: UI-EMPTY-001 to UI-EMPTY-012
 */
import { render, screen, fireEvent } from "@testing-library/react";
import {
  EmptyState,
  EmptyRow,
  NoResultsState,
  ConnectingState,
  SyncingState,
} from "@/components/shared/empty-state";
import { Search, FileText, AlertCircle } from "lucide-react";

describe("EmptyState", () => {
  // UI-EMPTY-001: Renders title correctly
  it("renders title correctly", () => {
    render(<EmptyState icon={Search} title="No results found" />);
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  // UI-EMPTY-002: Renders description when provided
  it("renders description when provided", () => {
    render(
      <EmptyState
        icon={Search}
        title="No results"
        description="Try adjusting your search criteria"
      />
    );
    expect(
      screen.getByText("Try adjusting your search criteria")
    ).toBeInTheDocument();
  });

  // UI-EMPTY-003: Does not render description when not provided
  it("does not render description when not provided", () => {
    const { container } = render(<EmptyState icon={Search} title="No results" />);
    // Check that there's no description paragraph
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(0);
  });

  // UI-EMPTY-004: Renders icon
  it("renders icon", () => {
    const { container } = render(<EmptyState icon={Search} title="Test" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  // UI-EMPTY-005: Renders action button when actionLabel and onAction provided
  it("renders action button when actionLabel and onAction provided", () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        icon={Search}
        title="No results"
        actionLabel="Clear filters"
        onAction={onAction}
      />
    );
    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  // UI-EMPTY-006: Calls onAction when action button clicked
  it("calls onAction when action button clicked", () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        icon={Search}
        title="No results"
        actionLabel="Clear filters"
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  // UI-EMPTY-007: Renders custom action when provided
  it("renders custom action when provided", () => {
    render(
      <EmptyState
        icon={Search}
        title="No results"
        action={<button data-testid="custom-action">Custom Button</button>}
      />
    );
    expect(screen.getByTestId("custom-action")).toBeInTheDocument();
  });

  // UI-EMPTY-008: Applies custom className
  it("applies custom className", () => {
    const { container } = render(
      <EmptyState icon={Search} title="Test" className="custom-empty" />
    );
    expect(container.firstChild).toHaveClass("custom-empty");
  });

  // UI-EMPTY-009: Renders correct variant styles
  it.each(["default", "compact", "card", "hero"] as const)(
    "renders %s variant correctly",
    (variant) => {
      const { container } = render(
        <EmptyState icon={Search} title="Test" variant={variant} />
      );
      expect(container.firstChild).toBeInTheDocument();
      // Compact has less padding
      if (variant === "compact") {
        expect(container.firstChild).toHaveClass("py-8");
      }
      // Hero has more padding
      if (variant === "hero") {
        expect(container.firstChild).toHaveClass("py-24");
      }
    }
  );

  // UI-EMPTY-010: Renders correct accent color
  it.each(["cyan", "purple", "green", "yellow", "red"] as const)(
    "renders %s accent color correctly",
    (accentColor) => {
      const { container } = render(
        <EmptyState icon={Search} title="Test" accentColor={accentColor} />
      );
      // The component should render without errors
      expect(container.firstChild).toBeInTheDocument();
    }
  );
});

describe("EmptyRow", () => {
  // UI-EMPTY-011: Renders message in table cell
  it("renders message in table cell", () => {
    render(
      <table>
        <tbody>
          <EmptyRow message="No items" />
        </tbody>
      </table>
    );
    expect(screen.getByText("No items")).toBeInTheDocument();
  });

  // UI-EMPTY-012: Uses default message when not provided
  it("uses default message when not provided", () => {
    render(
      <table>
        <tbody>
          <EmptyRow />
        </tbody>
      </table>
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  // UI-EMPTY-013: Sets colspan when provided
  it("sets colspan when provided", () => {
    const { container } = render(
      <table>
        <tbody>
          <EmptyRow colSpan={5} />
        </tbody>
      </table>
    );
    const td = container.querySelector("td");
    expect(td).toHaveAttribute("colspan", "5");
  });

  // UI-EMPTY-014: Renders custom icon
  it("renders custom icon", () => {
    const { container } = render(
      <table>
        <tbody>
          <EmptyRow icon={AlertCircle} />
        </tbody>
      </table>
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("NoResultsState", () => {
  // UI-EMPTY-015: Renders no results title
  it("renders no results title", () => {
    render(<NoResultsState />);
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  // UI-EMPTY-016: Shows search term in description
  it("shows search term in description", () => {
    render(<NoResultsState searchTerm="test query" />);
    expect(screen.getByText(/No matches for "test query"/)).toBeInTheDocument();
  });

  // UI-EMPTY-017: Renders clear filters button when onClear provided
  it("renders clear filters button when onClear provided", () => {
    const onClear = jest.fn();
    render(<NoResultsState onClear={onClear} />);
    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  // UI-EMPTY-018: Calls onClear when clear button clicked
  it("calls onClear when clear button clicked", () => {
    const onClear = jest.fn();
    render(<NoResultsState onClear={onClear} />);
    fireEvent.click(screen.getByText("Clear filters"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  // UI-EMPTY-019: Does not render clear button when onClear not provided
  it("does not render clear button when onClear not provided", () => {
    render(<NoResultsState />);
    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();
  });
});

describe("ConnectingState", () => {
  // UI-EMPTY-020: Renders connecting message
  it("renders connecting message", () => {
    render(<ConnectingState />);
    expect(screen.getByText("Connecting to system...")).toBeInTheDocument();
  });

  // UI-EMPTY-021: Has animated elements
  it("has animated elements", () => {
    const { container } = render(<ConnectingState />);
    // Should have ping animation
    const animatedElements = container.querySelectorAll(".animate-ping");
    expect(animatedElements.length).toBeGreaterThan(0);
  });
});

describe("SyncingState", () => {
  // UI-EMPTY-022: Renders default syncing message
  it("renders default syncing message", () => {
    render(<SyncingState />);
    expect(screen.getByText("Syncing data...")).toBeInTheDocument();
  });

  // UI-EMPTY-023: Renders custom message
  it("renders custom message", () => {
    render(<SyncingState message="Loading configuration..." />);
    expect(screen.getByText("Loading configuration...")).toBeInTheDocument();
  });

  // UI-EMPTY-024: Applies custom className
  it("applies custom className", () => {
    const { container } = render(<SyncingState className="custom-sync" />);
    expect(container.firstChild).toHaveClass("custom-sync");
  });
});
