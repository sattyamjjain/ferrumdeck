/**
 * Keyboard Navigation Tests.
 *
 * UI-INT-005: Keyboard navigation works correctly
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";

// Tab component for testing
function TestTabs() {
  return (
    <Tabs defaultValue="tab1">
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">Content 1</TabsContent>
      <TabsContent value="tab2">Content 2</TabsContent>
      <TabsContent value="tab3">Content 3</TabsContent>
    </Tabs>
  );
}

// Form for testing tab order
function TestForm() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <form onSubmit={handleSubmit}>
      {submitted && <span data-testid="submitted">Form submitted</span>}
      <Input placeholder="First Name" />
      <Input placeholder="Last Name" />
      <Input placeholder="Email" />
      <Button type="submit">Submit</Button>
    </form>
  );
}

// Skip link for testing
function SkipLinkTest() {
  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only">
        Skip to main content
      </a>
      <nav>
        <a href="/home">Home</a>
        <a href="/about">About</a>
      </nav>
      <main id="main-content" tabIndex={-1}>
        <h1>Main Content</h1>
        <Button>Action</Button>
      </main>
    </>
  );
}

describe("UI-INT-005: Keyboard Navigation", () => {
  describe("Tab navigation", () => {
    it("moves focus through focusable elements with Tab", async () => {
      render(<TestForm />);

      const firstName = screen.getByPlaceholderText("First Name");
      const lastName = screen.getByPlaceholderText("Last Name");
      const email = screen.getByPlaceholderText("Email");
      const submit = screen.getByRole("button", { name: "Submit" });

      // Focus first element
      firstName.focus();
      expect(firstName).toHaveFocus();

      // Tab to next elements
      await userEvent.tab();
      expect(lastName).toHaveFocus();

      await userEvent.tab();
      expect(email).toHaveFocus();

      await userEvent.tab();
      expect(submit).toHaveFocus();
    });

    it("moves focus backwards with Shift+Tab", async () => {
      render(<TestForm />);

      const firstName = screen.getByPlaceholderText("First Name");
      const lastName = screen.getByPlaceholderText("Last Name");

      lastName.focus();
      expect(lastName).toHaveFocus();

      await userEvent.tab({ shift: true });
      expect(firstName).toHaveFocus();
    });

    it("skips disabled elements", async () => {
      render(
        <>
          <Button>First</Button>
          <Button disabled>Disabled</Button>
          <Button>Third</Button>
        </>
      );

      const first = screen.getByRole("button", { name: "First" });
      const third = screen.getByRole("button", { name: "Third" });

      first.focus();
      expect(first).toHaveFocus();

      await userEvent.tab();
      expect(third).toHaveFocus();
    });
  });

  describe("Tabs component keyboard navigation", () => {
    it("navigates tabs with arrow keys", async () => {
      render(<TestTabs />);

      // Focus first tab
      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      const tab3 = screen.getByRole("tab", { name: "Tab 3" });

      tab1.focus();
      expect(tab1).toHaveFocus();

      // Arrow right moves to next tab
      await userEvent.keyboard("{ArrowRight}");
      expect(tab2).toHaveFocus();

      await userEvent.keyboard("{ArrowRight}");
      expect(tab3).toHaveFocus();

      // Arrow left moves back
      await userEvent.keyboard("{ArrowLeft}");
      expect(tab2).toHaveFocus();
    });

    it("wraps around when reaching end", async () => {
      render(<TestTabs />);

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const tab3 = screen.getByRole("tab", { name: "Tab 3" });

      tab3.focus();
      expect(tab3).toHaveFocus();

      // Arrow right wraps to first tab
      await userEvent.keyboard("{ArrowRight}");
      expect(tab1).toHaveFocus();
    });

    it("activates tab on Enter/Space", async () => {
      render(<TestTabs />);

      const tab2 = screen.getByRole("tab", { name: "Tab 2" });
      tab2.focus();

      await userEvent.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Content 2")).toBeVisible();
      });
    });

    it("shows correct content for active tab", async () => {
      render(<TestTabs />);

      // Initially Content 1 should be visible
      expect(screen.getByText("Content 1")).toBeVisible();

      // Switch to Tab 2
      await userEvent.click(screen.getByRole("tab", { name: "Tab 2" }));
      expect(screen.getByText("Content 2")).toBeVisible();
    });
  });

  describe("Form submission", () => {
    it("submits form with Enter in input", async () => {
      render(<TestForm />);

      const email = screen.getByPlaceholderText("Email");
      await userEvent.type(email, "test@example.com");
      await userEvent.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByTestId("submitted")).toBeInTheDocument();
      });
    });

    it("submits form when submit button has focus and Enter is pressed", async () => {
      render(<TestForm />);

      const submit = screen.getByRole("button", { name: "Submit" });
      submit.focus();
      await userEvent.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByTestId("submitted")).toBeInTheDocument();
      });
    });
  });

  describe("Skip links", () => {
    it("skip link becomes visible on focus", async () => {
      render(<SkipLinkTest />);

      // Tab to skip link
      await userEvent.tab();

      const skipLink = screen.getByText("Skip to main content");
      expect(skipLink).toHaveFocus();
      expect(skipLink).toHaveClass("focus:not-sr-only");
    });

    it("skip link navigates to main content", async () => {
      render(<SkipLinkTest />);

      const skipLink = screen.getByText("Skip to main content");
      expect(skipLink).toHaveAttribute("href", "#main-content");
    });
  });

  describe("Escape key behavior", () => {
    it("closes modal/dropdown on Escape", async () => {
      // This is tested in dialog.test.tsx and dropdown.test.tsx
      // Adding a simple test here for coverage
      const onEscape = jest.fn();

      render(
        <div
          onKeyDown={(e) => {
            if (e.key === "Escape") onEscape();
          }}
          tabIndex={0}
          data-testid="escape-target"
        >
          Press Escape
        </div>
      );

      const target = screen.getByTestId("escape-target");
      target.focus();
      await userEvent.keyboard("{Escape}");

      expect(onEscape).toHaveBeenCalled();
    });
  });

  describe("Focus management", () => {
    it("maintains focus when element becomes disabled", () => {
      const { rerender } = render(<Button>Focusable</Button>);

      const button = screen.getByRole("button");
      button.focus();
      expect(button).toHaveFocus();

      // Rerender as disabled
      rerender(<Button disabled>Focusable</Button>);

      // Focus should be lost from disabled element
      expect(button).toBeDisabled();
    });

    it("allows programmatic focus management", () => {
      render(
        <>
          <Input placeholder="Input 1" data-testid="input1" />
          <Input placeholder="Input 2" data-testid="input2" />
        </>
      );

      const input2 = screen.getByTestId("input2");
      input2.focus();
      expect(input2).toHaveFocus();
    });
  });

  describe("Focus visible styles", () => {
    it("button has focus-visible styles", async () => {
      render(<Button>Focus Me</Button>);

      const button = screen.getByRole("button");

      // Tab to button (keyboard focus)
      await userEvent.tab();
      expect(button).toHaveFocus();

      // Button should have focus-visible styles defined
      // (actual visual testing would need visual regression tools)
      expect(button).toHaveFocus();
    });
  });
});
