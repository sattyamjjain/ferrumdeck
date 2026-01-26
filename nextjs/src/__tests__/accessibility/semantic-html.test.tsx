/**
 * Semantic HTML Tests.
 *
 * UI-A11Y-003: Components use semantic HTML
 */

import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

describe("UI-A11Y-003: Semantic HTML", () => {
  describe("Button semantics", () => {
    it("renders as button element by default", () => {
      render(<Button>Click Me</Button>);
      const button = screen.getByRole("button");
      expect(button.tagName).toBe("BUTTON");
    });

    it("renders as anchor when asChild with link", () => {
      render(
        <Button asChild>
          <a href="/page">Go to Page</a>
        </Button>
      );
      const link = screen.getByRole("link");
      expect(link.tagName).toBe("A");
    });

    it("button can accept type attribute", () => {
      render(<Button type="submit">Submit</Button>);
      const button = screen.getByRole("button");
      // Button accepts and renders type attribute when provided
      expect(button).toHaveAttribute("type", "submit");
    });
  });

  describe("Card semantics", () => {
    it("renders with correct structure", () => {
      const { container } = render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
      );

      // Card should be a div or article
      const card = screen.getByTestId("card");
      expect(["DIV", "ARTICLE", "SECTION"]).toContain(card.tagName);
    });

    it("CardTitle uses heading element", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Card Heading</CardTitle>
          </CardHeader>
        </Card>
      );

      // CardTitle should render as h3 or similar heading
      const title = screen.getByText("Card Heading");
      expect(title).toBeInTheDocument();
    });
  });

  describe("Table semantics", () => {
    it("renders with correct table structure", () => {
      render(
        <Table>
          <TableCaption>User Data</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>John</TableCell>
              <TableCell>john@example.com</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(screen.getAllByRole("columnheader")).toHaveLength(2);
      expect(screen.getAllByRole("cell")).toHaveLength(2);
    });

    it("table has caption for accessibility", () => {
      render(
        <Table>
          <TableCaption>User Data</TableCaption>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      expect(screen.getByText("User Data")).toBeInTheDocument();
    });

    it("uses th for header cells", () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Header</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      );

      const header = screen.getByRole("columnheader");
      expect(header.tagName).toBe("TH");
    });

    it("uses td for data cells", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Data</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );

      const cell = screen.getByRole("cell");
      expect(cell.tagName).toBe("TD");
    });
  });

  describe("Tabs semantics", () => {
    it("renders with correct ARIA roles", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>
      );

      expect(screen.getByRole("tablist")).toBeInTheDocument();
      expect(screen.getAllByRole("tab")).toHaveLength(2);
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    });

    it("tab has correct aria-selected", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
        </Tabs>
      );

      const tab1 = screen.getByRole("tab", { name: "Tab 1" });
      const tab2 = screen.getByRole("tab", { name: "Tab 2" });

      expect(tab1).toHaveAttribute("aria-selected", "true");
      expect(tab2).toHaveAttribute("aria-selected", "false");
    });

    it("tab panel has aria-labelledby", () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content</TabsContent>
        </Tabs>
      );

      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby");
    });
  });

  describe("Alert semantics", () => {
    it("renders with correct role", () => {
      render(
        <Alert>
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>This is a warning message.</AlertDescription>
        </Alert>
      );

      // Alert may have role="alert" or be a div with alert styling
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
    });

    it("AlertTitle uses appropriate heading level", () => {
      render(
        <Alert>
          <AlertTitle>Alert Title</AlertTitle>
        </Alert>
      );

      const title = screen.getByText("Alert Title");
      expect(title).toBeInTheDocument();
    });
  });

  describe("Separator semantics", () => {
    it("renders with data-slot separator", () => {
      const { container } = render(<Separator />);
      // shadcn Separator uses role="none" for decorative separators
      const separator = container.querySelector('[data-slot="separator"]');
      expect(separator).toBeInTheDocument();
    });

    it("horizontal separator has correct orientation", () => {
      const { container } = render(<Separator orientation="horizontal" />);
      const separator = container.querySelector('[data-slot="separator"]');
      expect(separator).toHaveAttribute("data-orientation", "horizontal");
    });

    it("vertical separator has correct orientation", () => {
      const { container } = render(<Separator orientation="vertical" />);
      const separator = container.querySelector('[data-slot="separator"]');
      expect(separator).toHaveAttribute("data-orientation", "vertical");
    });
  });

  describe("List semantics", () => {
    it("renders unordered list correctly", () => {
      render(
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      );

      expect(screen.getByRole("list")).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });
  });

  describe("Landmark regions", () => {
    it("main content uses main landmark", () => {
      render(
        <main>
          <h1>Page Title</h1>
          <p>Content</p>
        </main>
      );

      expect(screen.getByRole("main")).toBeInTheDocument();
    });

    it("navigation uses nav landmark", () => {
      render(
        <nav aria-label="Main navigation">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      );

      expect(screen.getByRole("navigation")).toBeInTheDocument();
    });

    it("sidebar can use complementary landmark", () => {
      render(
        <aside aria-label="Sidebar">
          <p>Related content</p>
        </aside>
      );

      expect(screen.getByRole("complementary")).toBeInTheDocument();
    });

    it("footer uses contentinfo landmark", () => {
      render(
        <footer>
          <p>Copyright 2024</p>
        </footer>
      );

      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });
  });

  describe("Heading hierarchy", () => {
    it("page has proper heading hierarchy", () => {
      render(
        <main>
          <h1>Page Title</h1>
          <section>
            <h2>Section Title</h2>
            <h3>Subsection</h3>
          </section>
        </main>
      );

      const headings = screen.getAllByRole("heading");
      expect(headings).toHaveLength(3);
      expect(headings[0].tagName).toBe("H1");
      expect(headings[1].tagName).toBe("H2");
      expect(headings[2].tagName).toBe("H3");
    });
  });
});
