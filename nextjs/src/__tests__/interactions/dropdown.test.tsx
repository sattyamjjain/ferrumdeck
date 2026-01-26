/**
 * Dropdown Menu Interaction Tests.
 *
 * UI-INT-004: Dropdown menu interactions
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState } from "react";

// Basic dropdown menu
function BasicDropdown() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      {selected && <span data-testid="selected">{selected}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSelected("edit")}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSelected("duplicate")}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setSelected("delete")}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Dropdown with checkbox items
function CheckboxDropdown() {
  const [showStatus, setShowStatus] = useState(true);
  const [showTime, setShowTime] = useState(false);

  return (
    <>
      <span data-testid="status">{showStatus.toString()}</span>
      <span data-testid="time">{showTime.toString()}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>View Options</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={showStatus}
            onCheckedChange={setShowStatus}
          >
            Show Status
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showTime}
            onCheckedChange={setShowTime}
          >
            Show Time
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Dropdown with radio items
function RadioDropdown() {
  const [position, setPosition] = useState("top");

  return (
    <>
      <span data-testid="position">{position}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Position: {position}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={position} onValueChange={setPosition}>
            <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Dropdown with submenu
function NestedDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>More Options</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Item 1</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Sub Item 1</DropdownMenuItem>
            <DropdownMenuItem>Sub Item 2</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Item 2</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("UI-INT-004: Dropdown Menu Interactions", () => {
  describe("Basic dropdown menu", () => {
    it("opens when trigger is clicked", async () => {
      render(<BasicDropdown />);

      // Menu should not be visible initially
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      // Click trigger
      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));

      // Menu should be visible
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });
    });

    it("shows all menu items", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      expect(screen.getByText("Actions")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Duplicate" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Delete" })
      ).toBeInTheDocument();
    });

    it("triggers action when item is clicked", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      await waitFor(() => {
        expect(screen.getByTestId("selected")).toHaveTextContent("edit");
      });
    });

    it("closes when item is selected", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    });

    it("closes when pressing Escape", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      await userEvent.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    });
  });

  describe("Checkbox dropdown items", () => {
    it("toggles checkbox items", async () => {
      render(<CheckboxDropdown />);

      expect(screen.getByTestId("status")).toHaveTextContent("true");
      expect(screen.getByTestId("time")).toHaveTextContent("false");

      await userEvent.click(
        screen.getByRole("button", { name: "View Options" })
      );
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      // Toggle Show Status off
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Show Status" })
      );
      await waitFor(() => {
        expect(screen.getByTestId("status")).toHaveTextContent("false");
      });

      // Reopen menu
      await userEvent.click(
        screen.getByRole("button", { name: "View Options" })
      );
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      // Toggle Show Time on
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Show Time" })
      );
      await waitFor(() => {
        expect(screen.getByTestId("time")).toHaveTextContent("true");
      });
    });
  });

  describe("Radio dropdown items", () => {
    it("selects radio items", async () => {
      render(<RadioDropdown />);

      expect(screen.getByTestId("position")).toHaveTextContent("top");

      await userEvent.click(
        screen.getByRole("button", { name: /Position: top/i })
      );
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      await userEvent.click(
        screen.getByRole("menuitemradio", { name: "Bottom" })
      );

      await waitFor(() => {
        expect(screen.getByTestId("position")).toHaveTextContent("bottom");
      });
    });

    it("shows checked state for selected radio item", async () => {
      render(<RadioDropdown />);

      await userEvent.click(
        screen.getByRole("button", { name: /Position: top/i })
      );
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      const topItem = screen.getByRole("menuitemradio", { name: "Top" });
      expect(topItem).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("Keyboard navigation", () => {
    it("navigates with arrow keys", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      // Navigate with arrow keys
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowDown}");

      // Second item should be highlighted
      const duplicateItem = screen.getByRole("menuitem", { name: "Duplicate" });
      expect(duplicateItem).toHaveAttribute("data-highlighted");
    });

    it("selects item with Enter", async () => {
      render(<BasicDropdown />);

      await userEvent.click(screen.getByRole("button", { name: "Open Menu" }));
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      // Navigate to Edit and press Enter
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByTestId("selected")).toHaveTextContent("edit");
      });
    });
  });

  describe("Nested dropdown (submenu)", () => {
    it("opens submenu on hover/click", async () => {
      render(<NestedDropdown />);

      await userEvent.click(
        screen.getByRole("button", { name: "More Options" })
      );
      await waitFor(() => {
        expect(screen.getByRole("menu")).toBeInTheDocument();
      });

      // Hover or click submenu trigger
      const subTrigger = screen.getByText("More");
      await userEvent.click(subTrigger);

      // Submenu items should be visible
      await waitFor(() => {
        expect(screen.getByText("Sub Item 1")).toBeInTheDocument();
        expect(screen.getByText("Sub Item 2")).toBeInTheDocument();
      });
    });
  });
});
