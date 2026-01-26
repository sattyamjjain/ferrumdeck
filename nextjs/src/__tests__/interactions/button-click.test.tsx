/**
 * Button Click Interaction Tests.
 *
 * UI-INT-001: Button click events work correctly
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import { useState } from "react";

// Test component with state
function ClickCounter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <span data-testid="count">{count}</span>
      <Button onClick={() => setCount((c) => c + 1)}>Increment</Button>
    </div>
  );
}

// Test component with async handler
function AsyncButton() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    setLoading(false);
    setDone(true);
  };

  return (
    <Button onClick={handleClick} disabled={loading}>
      {loading ? "Loading..." : done ? "Done" : "Click Me"}
    </Button>
  );
}

describe("UI-INT-001: Button Click Interactions", () => {
  describe("basic click handling", () => {
    it("fires onClick when clicked", async () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);

      await userEvent.click(screen.getByRole("button", { name: "Click Me" }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("fires onClick multiple times on multiple clicks", async () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);

      const button = screen.getByRole("button", { name: "Click Me" });
      await userEvent.click(button);
      await userEvent.click(button);
      await userEvent.click(button);

      expect(handleClick).toHaveBeenCalledTimes(3);
    });

    it("passes event object to onClick handler", async () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);

      await userEvent.click(screen.getByRole("button", { name: "Click Me" }));
      expect(handleClick).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "click",
        })
      );
    });
  });

  describe("disabled button behavior", () => {
    it("does not fire onClick when disabled", async () => {
      const handleClick = jest.fn();
      render(
        <Button onClick={handleClick} disabled>
          Disabled
        </Button>
      );

      const button = screen.getByRole("button", { name: "Disabled" });
      expect(button).toBeDisabled();

      // userEvent respects disabled state
      await userEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it("shows disabled visual state", () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole("button", { name: "Disabled" });
      expect(button).toHaveAttribute("disabled");
    });
  });

  describe("state updates on click", () => {
    it("updates counter on click", async () => {
      render(<ClickCounter />);

      expect(screen.getByTestId("count")).toHaveTextContent("0");

      await userEvent.click(screen.getByRole("button", { name: "Increment" }));
      expect(screen.getByTestId("count")).toHaveTextContent("1");

      await userEvent.click(screen.getByRole("button", { name: "Increment" }));
      expect(screen.getByTestId("count")).toHaveTextContent("2");
    });
  });

  describe("async click handling", () => {
    it("handles async click handlers", async () => {
      render(<AsyncButton />);

      const button = screen.getByRole("button", { name: "Click Me" });
      await userEvent.click(button);

      // Should show loading state
      expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();

      // Wait for async operation to complete
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      });
    });
  });

  describe("keyboard activation", () => {
    it("can be activated with Enter key", async () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Press Enter</Button>);

      const button = screen.getByRole("button", { name: "Press Enter" });
      button.focus();
      await userEvent.keyboard("{Enter}");

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("can be activated with Space key", async () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Press Space</Button>);

      const button = screen.getByRole("button", { name: "Press Space" });
      button.focus();
      await userEvent.keyboard(" ");

      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("button variants click behavior", () => {
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const;

    variants.forEach((variant) => {
      it(`${variant} variant responds to clicks`, async () => {
        const handleClick = jest.fn();
        render(
          <Button variant={variant} onClick={handleClick}>
            {variant}
          </Button>
        );

        await userEvent.click(screen.getByRole("button", { name: variant }));
        expect(handleClick).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("double click behavior", () => {
    it("handles double click events", async () => {
      const handleDoubleClick = jest.fn();
      render(
        <Button onDoubleClick={handleDoubleClick}>Double Click</Button>
      );

      await userEvent.dblClick(
        screen.getByRole("button", { name: "Double Click" })
      );
      expect(handleDoubleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("focus management", () => {
    it("receives focus when clicked", async () => {
      render(<Button>Focusable</Button>);

      const button = screen.getByRole("button", { name: "Focusable" });
      await userEvent.click(button);

      expect(button).toHaveFocus();
    });

    it("can be focused programmatically", () => {
      render(<Button>Focusable</Button>);

      const button = screen.getByRole("button", { name: "Focusable" });
      button.focus();

      expect(button).toHaveFocus();
    });
  });
});
