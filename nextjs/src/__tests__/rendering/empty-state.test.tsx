/**
 * Empty State Component Rendering Tests.
 *
 * UI-RND-003: Empty state renders with variants
 */

import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { EmptyState, NoResultsState, ConnectingState, SyncingState } from "@/components/shared/empty-state";

describe("UI-RND-003: Empty State Component Rendering", () => {
  describe("EmptyState base component", () => {
    it("renders with required props", () => {
      render(<EmptyState icon={Inbox} title="No items" />);
      expect(screen.getByText("No items")).toBeInTheDocument();
    });

    it("renders with description", () => {
      render(
        <EmptyState
          icon={Inbox}
          title="No items"
          description="There are no items to display"
        />
      );
      expect(screen.getByText("There are no items to display")).toBeInTheDocument();
    });

    it("renders with action button", () => {
      const handleAction = jest.fn();
      render(
        <EmptyState
          icon={Inbox}
          title="No items"
          actionLabel="Add item"
          onAction={handleAction}
        />
      );
      expect(screen.getByRole("button", { name: /Add item/i })).toBeInTheDocument();
    });

    it("renders with custom action element", () => {
      render(
        <EmptyState
          icon={Inbox}
          title="No items"
          action={<button>Custom Action</button>}
        />
      );
      expect(screen.getByRole("button", { name: "Custom Action" })).toBeInTheDocument();
    });
  });

  describe("EmptyState variants", () => {
    it("renders default variant", () => {
      const { container } = render(
        <EmptyState icon={Inbox} title="Default" variant="default" />
      );
      expect(container.firstChild).toHaveClass("py-16");
    });

    it("renders compact variant", () => {
      const { container } = render(
        <EmptyState icon={Inbox} title="Compact" variant="compact" />
      );
      expect(container.firstChild).toHaveClass("py-8");
    });

    it("renders card variant", () => {
      const { container } = render(
        <EmptyState icon={Inbox} title="Card" variant="card" />
      );
      expect(container.firstChild).toHaveClass("rounded-xl");
    });

    it("renders hero variant", () => {
      const { container } = render(
        <EmptyState icon={Inbox} title="Hero" variant="hero" />
      );
      expect(container.firstChild).toHaveClass("py-24");
    });
  });

  describe("EmptyState accent colors", () => {
    const accentColors = ["cyan", "purple", "green", "yellow", "red"] as const;

    accentColors.forEach((color) => {
      it(`renders with ${color} accent color`, () => {
        render(
          <EmptyState
            icon={Inbox}
            title={`${color} accent`}
            accentColor={color}
          />
        );
        expect(screen.getByText(`${color} accent`)).toBeInTheDocument();
      });
    });
  });

  describe("NoResultsState component", () => {
    it("renders with search term", () => {
      render(<NoResultsState searchTerm="test query" />);
      expect(screen.getByText("No results found")).toBeInTheDocument();
      expect(screen.getByText(/test query/)).toBeInTheDocument();
    });

    it("renders without search term", () => {
      render(<NoResultsState />);
      expect(screen.getByText("No results found")).toBeInTheDocument();
    });

    it("renders with clear action", () => {
      const handleClear = jest.fn();
      render(<NoResultsState onClear={handleClear} />);
      expect(screen.getByRole("button", { name: /Clear filters/i })).toBeInTheDocument();
    });
  });

  describe("ConnectingState component", () => {
    it("renders connecting message", () => {
      render(<ConnectingState />);
      expect(screen.getByText("Connecting to system...")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(<ConnectingState className="custom-class" />);
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });

  describe("SyncingState component", () => {
    it("renders default message", () => {
      render(<SyncingState />);
      expect(screen.getByText("Syncing data...")).toBeInTheDocument();
    });

    it("renders custom message", () => {
      render(<SyncingState message="Loading workflows..." />);
      expect(screen.getByText("Loading workflows...")).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(<SyncingState className="custom-class" />);
      expect(container.firstChild).toHaveClass("custom-class");
    });
  });
});
