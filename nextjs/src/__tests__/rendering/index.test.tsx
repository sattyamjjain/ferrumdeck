/**
 * Component Rendering Tests Index.
 *
 * UI-RND-005: Card and table components render correctly
 */

import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";

describe("UI-RND-005: Card and Table Component Rendering", () => {
  describe("Card component", () => {
    it("renders Card with all subcomponents", () => {
      render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card Description</CardDescription>
          </CardHeader>
          <CardContent>Card Content</CardContent>
          <CardFooter>Card Footer</CardFooter>
        </Card>
      );

      expect(screen.getByTestId("card")).toBeInTheDocument();
      expect(screen.getByText("Card Title")).toBeInTheDocument();
      expect(screen.getByText("Card Description")).toBeInTheDocument();
      expect(screen.getByText("Card Content")).toBeInTheDocument();
      expect(screen.getByText("Card Footer")).toBeInTheDocument();
    });

    it("renders Card with custom className", () => {
      render(<Card className="custom-class" data-testid="card">Content</Card>);
      expect(screen.getByTestId("card")).toHaveClass("custom-class");
    });

    it("renders Card without optional subcomponents", () => {
      render(
        <Card data-testid="card">
          <CardContent>Only Content</CardContent>
        </Card>
      );
      expect(screen.getByTestId("card")).toBeInTheDocument();
      expect(screen.getByText("Only Content")).toBeInTheDocument();
    });
  });

  describe("Table component", () => {
    it("renders Table with all subcomponents", () => {
      render(
        <Table>
          <TableCaption>Table Caption</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Header 1</TableHead>
              <TableHead>Header 2</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Cell 1</TableCell>
              <TableCell>Cell 2</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Footer 1</TableCell>
              <TableCell>Footer 2</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      );

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByText("Table Caption")).toBeInTheDocument();
      expect(screen.getByText("Header 1")).toBeInTheDocument();
      expect(screen.getByText("Header 2")).toBeInTheDocument();
      expect(screen.getByText("Cell 1")).toBeInTheDocument();
      expect(screen.getByText("Cell 2")).toBeInTheDocument();
      expect(screen.getByText("Footer 1")).toBeInTheDocument();
      expect(screen.getByText("Footer 2")).toBeInTheDocument();
    });

    it("renders Table with correct semantic elements", () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Header</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("rowgroup")).toHaveLength(2); // thead and tbody
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(screen.getByRole("columnheader")).toBeInTheDocument();
      expect(screen.getByRole("cell")).toBeInTheDocument();
    });

    it("renders Table with multiple rows", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Row 1</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Row 2</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Row 3</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      expect(screen.getAllByRole("row")).toHaveLength(3);
    });

    it("renders TableHead with colSpan", () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead colSpan={2}>Merged Header</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      );

      const header = screen.getByRole("columnheader");
      expect(header).toHaveAttribute("colspan", "2");
    });

    it("renders TableCell with colSpan", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell colSpan={3}>Merged Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      const cell = screen.getByRole("cell");
      expect(cell).toHaveAttribute("colspan", "3");
    });
  });

  describe("Component composition", () => {
    it("renders Card containing Table", () => {
      render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Data Table</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>Data</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      );

      expect(screen.getByTestId("card")).toBeInTheDocument();
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByText("Data Table")).toBeInTheDocument();
      expect(screen.getByText("Data")).toBeInTheDocument();
    });
  });
});
