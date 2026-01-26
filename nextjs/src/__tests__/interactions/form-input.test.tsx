/**
 * Form Input Interaction Tests.
 *
 * UI-INT-002: Form inputs handle user input correctly
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";

// Controlled input component
function ControlledInput() {
  const [value, setValue] = useState("");

  return (
    <div>
      <Label htmlFor="controlled">Controlled Input</Label>
      <Input
        id="controlled"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type here..."
      />
      <span data-testid="value">{value}</span>
    </div>
  );
}

// Form with validation
function ValidatedForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const handleBlur = () => {
    if (email && !email.includes("@")) {
      setError("Invalid email format");
    } else {
      setError("");
    }
  };

  return (
    <div>
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={handleBlur}
        aria-invalid={!!error}
        aria-describedby={error ? "email-error" : undefined}
      />
      {error && (
        <span id="email-error" role="alert" className="text-red-500">
          {error}
        </span>
      )}
    </div>
  );
}

describe("UI-INT-002: Form Input Interactions", () => {
  describe("Input component", () => {
    it("accepts text input", async () => {
      const handleChange = jest.fn();
      render(<Input onChange={handleChange} placeholder="Enter text" />);

      const input = screen.getByPlaceholderText("Enter text");
      await userEvent.type(input, "Hello");

      expect(handleChange).toHaveBeenCalled();
      expect(input).toHaveValue("Hello");
    });

    it("handles controlled input correctly", async () => {
      render(<ControlledInput />);

      const input = screen.getByLabelText("Controlled Input");
      await userEvent.type(input, "Test value");

      expect(input).toHaveValue("Test value");
      expect(screen.getByTestId("value")).toHaveTextContent("Test value");
    });

    it("clears input on clear button or Ctrl+A + Delete", async () => {
      render(<ControlledInput />);

      const input = screen.getByLabelText("Controlled Input");
      await userEvent.type(input, "Some text");
      expect(input).toHaveValue("Some text");

      await userEvent.clear(input);
      expect(input).toHaveValue("");
    });

    it("handles paste events", async () => {
      const handlePaste = jest.fn();
      render(<Input onPaste={handlePaste} />);

      const input = screen.getByRole("textbox");
      await userEvent.click(input);
      await userEvent.paste("Pasted text");

      expect(input).toHaveValue("Pasted text");
    });

    it("respects maxLength attribute", async () => {
      render(<Input maxLength={5} />);

      const input = screen.getByRole("textbox");
      await userEvent.type(input, "1234567890");

      expect(input).toHaveValue("12345");
    });

    it("handles disabled state", async () => {
      render(<Input disabled placeholder="Disabled" />);

      const input = screen.getByPlaceholderText("Disabled");
      expect(input).toBeDisabled();

      await userEvent.type(input, "Can't type");
      expect(input).toHaveValue("");
    });

    it("handles readonly state", () => {
      render(<Input readOnly value="Read only" />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("readonly");
      expect(input).toHaveValue("Read only");
    });
  });

  describe("Textarea component", () => {
    it("accepts multiline input", async () => {
      render(<Textarea placeholder="Enter description" />);

      const textarea = screen.getByPlaceholderText("Enter description");
      await userEvent.type(textarea, "Line 1\nLine 2\nLine 3");

      expect(textarea).toHaveValue("Line 1\nLine 2\nLine 3");
    });

    it("respects rows attribute", () => {
      render(<Textarea rows={5} />);

      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveAttribute("rows", "5");
    });
  });

  describe("Form validation", () => {
    it("shows error on invalid input", async () => {
      render(<ValidatedForm />);

      const input = screen.getByLabelText("Email");
      await userEvent.type(input, "invalid-email");
      await userEvent.tab(); // Trigger blur

      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email format");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("clears error on valid input", async () => {
      render(<ValidatedForm />);

      const input = screen.getByLabelText("Email");

      // First enter invalid
      await userEvent.type(input, "invalid");
      await userEvent.tab();
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Then correct it
      await userEvent.clear(input);
      await userEvent.type(input, "valid@email.com");
      await userEvent.tab();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("Focus management", () => {
    it("moves focus on Tab", async () => {
      render(
        <>
          <Input placeholder="First" />
          <Input placeholder="Second" />
          <Input placeholder="Third" />
        </>
      );

      const first = screen.getByPlaceholderText("First");
      const second = screen.getByPlaceholderText("Second");

      first.focus();
      expect(first).toHaveFocus();

      await userEvent.tab();
      expect(second).toHaveFocus();
    });

    it("moves focus backwards on Shift+Tab", async () => {
      render(
        <>
          <Input placeholder="First" />
          <Input placeholder="Second" />
        </>
      );

      const first = screen.getByPlaceholderText("First");
      const second = screen.getByPlaceholderText("Second");

      second.focus();
      expect(second).toHaveFocus();

      await userEvent.tab({ shift: true });
      expect(first).toHaveFocus();
    });
  });

  describe("Input types", () => {
    it("handles password input", async () => {
      render(<Input type="password" placeholder="Password" />);

      const input = screen.getByPlaceholderText("Password");
      expect(input).toHaveAttribute("type", "password");

      await userEvent.type(input, "secret123");
      expect(input).toHaveValue("secret123");
    });

    it("handles number input", async () => {
      render(<Input type="number" placeholder="Number" />);

      const input = screen.getByPlaceholderText("Number");
      await userEvent.type(input, "42");

      expect(input).toHaveValue(42);
    });

    it("handles email input", async () => {
      render(<Input type="email" placeholder="Email" />);

      const input = screen.getByPlaceholderText("Email");
      expect(input).toHaveAttribute("type", "email");
    });
  });

  describe("Accessibility", () => {
    it("associates label with input", () => {
      render(
        <>
          <Label htmlFor="test-input">Test Label</Label>
          <Input id="test-input" />
        </>
      );

      expect(screen.getByLabelText("Test Label")).toBeInTheDocument();
    });

    it("supports aria-describedby for help text", () => {
      render(
        <>
          <Input aria-describedby="help-text" />
          <span id="help-text">Enter your name</span>
        </>
      );

      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("aria-describedby", "help-text");
    });
  });
});
