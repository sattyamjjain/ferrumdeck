/**
 * Dialog Interaction Tests.
 *
 * UI-INT-003: Dialog open/close interactions
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";

// Test component with controlled dialog
function ControlledDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog Title</DialogTitle>
          <DialogDescription>Dialog description text.</DialogDescription>
        </DialogHeader>
        <div>Dialog content goes here</div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Test component with alert dialog
function TestAlertDialog() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <>
      {confirmed && <span data-testid="confirmed">Confirmed!</span>}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete Item</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setConfirmed(true)}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

describe("UI-INT-003: Dialog Interactions", () => {
  describe("Dialog component", () => {
    it("opens when trigger is clicked", async () => {
      render(<ControlledDialog />);

      // Dialog should not be visible initially
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Click trigger
      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));

      // Dialog should be visible
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      expect(screen.getByText("Dialog Title")).toBeInTheDocument();
    });

    it("closes when close button is clicked", async () => {
      render(<ControlledDialog />);

      // Open dialog
      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Click cancel button
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("closes when pressing Escape", async () => {
      render(<ControlledDialog />);

      // Open dialog
      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Press Escape
      await userEvent.keyboard("{Escape}");

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("traps focus within dialog", async () => {
      render(<ControlledDialog />);

      // Open dialog
      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Tab through focusable elements
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      const saveButton = screen.getByRole("button", { name: "Save" });

      // Focus should stay within dialog
      cancelButton.focus();
      expect(cancelButton).toHaveFocus();

      await userEvent.tab();
      expect(saveButton).toHaveFocus();
    });

    it("renders dialog content correctly", async () => {
      render(<ControlledDialog />);

      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      expect(screen.getByText("Dialog Title")).toBeInTheDocument();
      expect(screen.getByText("Dialog description text.")).toBeInTheDocument();
      expect(screen.getByText("Dialog content goes here")).toBeInTheDocument();
    });
  });

  describe("AlertDialog component", () => {
    it("opens when trigger is clicked", async () => {
      render(<TestAlertDialog />);

      // Dialog should not be visible initially
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

      // Click trigger
      await userEvent.click(
        screen.getByRole("button", { name: "Delete Item" })
      );

      // Dialog should be visible
      await waitFor(() => {
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });
    });

    it("closes when cancel is clicked", async () => {
      render(<TestAlertDialog />);

      // Open dialog
      await userEvent.click(
        screen.getByRole("button", { name: "Delete Item" })
      );
      await waitFor(() => {
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });

      // Click cancel
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
    });

    it("triggers action and closes when action button is clicked", async () => {
      render(<TestAlertDialog />);

      // Initially not confirmed
      expect(screen.queryByTestId("confirmed")).not.toBeInTheDocument();

      // Open dialog
      await userEvent.click(
        screen.getByRole("button", { name: "Delete Item" })
      );
      await waitFor(() => {
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });

      // Click continue
      await userEvent.click(screen.getByRole("button", { name: "Continue" }));

      // Action should be triggered
      await waitFor(() => {
        expect(screen.getByTestId("confirmed")).toBeInTheDocument();
      });

      // Dialog should be closed
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("has correct accessibility attributes", async () => {
      render(<TestAlertDialog />);

      await userEvent.click(
        screen.getByRole("button", { name: "Delete Item" })
      );
      await waitFor(() => {
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });

      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveAttribute("aria-labelledby");
      expect(dialog).toHaveAttribute("aria-describedby");
    });
  });

  describe("Dialog accessibility", () => {
    it("moves focus to dialog when opened", async () => {
      render(<ControlledDialog />);

      await userEvent.click(screen.getByRole("button", { name: "Open Dialog" }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Focus should be within the dialog
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("returns focus to trigger when closed", async () => {
      render(<ControlledDialog />);

      const trigger = screen.getByRole("button", { name: "Open Dialog" });

      // Open dialog
      await userEvent.click(trigger);
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Close dialog with Escape
      await userEvent.keyboard("{Escape}");

      // Focus should return to trigger
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });
  });
});
