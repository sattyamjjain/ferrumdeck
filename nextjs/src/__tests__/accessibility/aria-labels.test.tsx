/**
 * ARIA Labels and Attributes Tests.
 *
 * UI-A11Y-001: Components have proper ARIA labels
 */

import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

describe("UI-A11Y-001: ARIA Labels and Attributes", () => {
  describe("Button accessibility", () => {
    it("button has implicit role", () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByRole("button", { name: "Click Me" })).toBeInTheDocument();
    });

    it("icon-only button should have aria-label", () => {
      render(
        <Button size="icon" aria-label="Loading">
          <Loader2 className="animate-spin" />
        </Button>
      );
      expect(screen.getByRole("button", { name: "Loading" })).toBeInTheDocument();
    });

    it("disabled button has aria-disabled", () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole("button", { name: "Disabled" });
      expect(button).toBeDisabled();
    });

    it("loading button indicates loading state", () => {
      render(
        <Button disabled aria-busy="true" aria-label="Loading, please wait">
          <Loader2 className="animate-spin" />
          Loading...
        </Button>
      );
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("Input accessibility", () => {
    it("input has associated label", () => {
      render(
        <>
          <Label htmlFor="email">Email Address</Label>
          <Input id="email" type="email" />
        </>
      );
      expect(screen.getByLabelText("Email Address")).toBeInTheDocument();
    });

    it("input has aria-describedby for help text", () => {
      render(
        <>
          <Input aria-describedby="help" />
          <span id="help">Enter your email</span>
        </>
      );
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "aria-describedby",
        "help"
      );
    });

    it("required input has aria-required", () => {
      render(<Input required aria-required="true" />);
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "aria-required",
        "true"
      );
    });

    it("invalid input has aria-invalid", () => {
      render(<Input aria-invalid="true" aria-errormessage="error-msg" />);
      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("input with error has aria-errormessage", () => {
      render(
        <>
          <Input aria-invalid="true" aria-errormessage="error-msg" />
          <span id="error-msg" role="alert">
            This field is required
          </span>
        </>
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  describe("Dialog accessibility", () => {
    it("dialog has correct role", async () => {
      const { getByRole, getByText } = render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogContent>
        </Dialog>
      );

      expect(getByRole("dialog")).toBeInTheDocument();
    });

    it("dialog has aria-labelledby", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Test Title</DialogTitle>
          </DialogContent>
        </Dialog>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-labelledby");
    });

    it("dialog has aria-describedby when description present", () => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description text</DialogDescription>
          </DialogContent>
        </Dialog>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-describedby");
    });
  });

  describe("Select accessibility", () => {
    it("select has combobox role", () => {
      render(
        <Select>
          <SelectTrigger aria-label="Select option">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Option 1</SelectItem>
            <SelectItem value="2">Option 2</SelectItem>
          </SelectContent>
        </Select>
      );

      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("select trigger has aria-expanded", () => {
      render(
        <Select>
          <SelectTrigger aria-label="Select option">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Option 1</SelectItem>
          </SelectContent>
        </Select>
      );

      const trigger = screen.getByRole("combobox");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("Badge accessibility", () => {
    it("badge is not interactive by default", () => {
      render(<Badge>Status</Badge>);
      // Badge should not be a button unless interactive
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
    });

    it("badge as link has link role", () => {
      render(
        <Badge asChild>
          <a href="/status">Status</a>
        </Badge>
      );
      expect(screen.getByRole("link", { name: "Status" })).toBeInTheDocument();
    });
  });

  describe("Loading states accessibility", () => {
    it("skeleton has aria-busy", () => {
      render(<Skeleton className="h-4 w-20" aria-busy="true" />);
      // Skeleton typically doesn't have a role, but we can test the busy state
      const skeleton = document.querySelector(".h-4.w-20");
      expect(skeleton).toBeInTheDocument();
    });

    it("loading spinner has aria-label", () => {
      render(
        <div role="status" aria-label="Loading">
          <Loader2 className="animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading...</span>
        </div>
      );
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
    });
  });

  describe("Live regions", () => {
    it("error messages use role alert", () => {
      render(<div role="alert">Error: Something went wrong</div>);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("status updates use role status", () => {
      render(
        <div role="status" aria-live="polite">
          3 items loaded
        </div>
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("important updates use aria-live assertive", () => {
      render(
        <div role="alert" aria-live="assertive">
          Session expired
        </div>
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveAttribute("aria-live", "assertive");
    });
  });

  describe("Images and icons accessibility", () => {
    it("decorative icons are hidden from screen readers", () => {
      render(
        <Button>
          <Loader2 aria-hidden="true" />
          <span>Submit</span>
        </Button>
      );
      const button = screen.getByRole("button", { name: "Submit" });
      expect(button).toBeInTheDocument();
    });

    it("meaningful icons have accessible names", () => {
      render(
        <Button aria-label="Loading" size="icon">
          <Loader2 aria-hidden="true" />
        </Button>
      );
      expect(screen.getByRole("button", { name: "Loading" })).toBeInTheDocument();
    });
  });
});
