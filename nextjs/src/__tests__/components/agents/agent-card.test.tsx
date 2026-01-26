/**
 * Tests for AgentCard component
 * Test IDs: UI-AGT-001 to UI-AGT-020
 */
import { render, screen } from "@testing-library/react";
import { AgentCard } from "@/components/agents/agent-card";
import { mockAgent, mockAgentDraft, mockAgentDeprecated } from "@/__tests__/utils/fixtures";

describe("AgentCard", () => {
  // UI-AGT-001: Renders agent name
  it("renders agent name", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("PR Review Agent")).toBeInTheDocument();
  });

  // UI-AGT-002: Renders agent slug
  it("renders agent slug", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("pr-review-agent")).toBeInTheDocument();
  });

  // UI-AGT-003: Renders agent description
  it("renders agent description", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText(/Reviews pull requests/)).toBeInTheDocument();
  });

  // UI-AGT-004: Shows Active status badge
  it("shows Active status badge", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  // UI-AGT-005: Shows Draft status badge
  it("shows Draft status badge", () => {
    render(<AgentCard agent={mockAgentDraft} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  // UI-AGT-006: Shows Deprecated status badge
  it("shows Deprecated status badge", () => {
    render(<AgentCard agent={mockAgentDeprecated} />);
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
  });

  // UI-AGT-007: Shows version number
  it("shows version number", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  // UI-AGT-008: Shows model badge
  it("shows model badge", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("claude-3-opus")).toBeInTheDocument();
  });

  // UI-AGT-009: Links to agent detail page
  it("links to agent detail page", () => {
    render(<AgentCard agent={mockAgent} />);
    const link = screen.getByRole("link", { name: /PR Review Agent/i });
    expect(link).toHaveAttribute("href", `/agents/${mockAgent.id}`);
  });

  // UI-AGT-010: Shows tool badges
  it("shows tool badges", () => {
    render(<AgentCard agent={mockAgent} />);
    // Should show some tools from allowed_tools
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  // UI-AGT-011: Shows remaining tools count
  it("shows remaining tools count when more than 3 tools", () => {
    render(<AgentCard agent={mockAgent} />);
    // Agent has read_file, list_directory, search_code (allowed) + write_file, create_pr (approval)
    // That's 5 tools, shows 3, so +2 more
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  // UI-AGT-012: Shows action buttons
  it("shows action buttons", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByText("Versions")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });

  // UI-AGT-013: Links to versions tab
  it("links to versions tab", () => {
    render(<AgentCard agent={mockAgent} />);
    const versionsLink = screen.getByRole("link", { name: /Versions/i });
    expect(versionsLink).toHaveAttribute("href", `/agents/${mockAgent.id}?tab=versions`);
  });

  // UI-AGT-014: Links to tools tab
  it("links to tools tab", () => {
    render(<AgentCard agent={mockAgent} />);
    const toolsLink = screen.getByRole("link", { name: /Tools/i });
    expect(toolsLink).toHaveAttribute("href", `/agents/${mockAgent.id}?tab=tools`);
  });

  // UI-AGT-015: Shows success rate stat
  it("shows success rate stat", () => {
    render(<AgentCard agent={mockAgent} />);
    // Shows percentage with %
    expect(screen.getByText(/%$/)).toBeInTheDocument();
  });

  // UI-AGT-016: Shows runs count
  it("shows runs count", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText(/runs$/)).toBeInTheDocument();
  });

  // UI-AGT-017: Shows last activity time
  it("shows last activity time", () => {
    render(<AgentCard agent={mockAgent} />);
    // formatTimeAgo will produce something like "15 days ago"
    const timeElement = screen.getByText(/ago/);
    expect(timeElement).toBeInTheDocument();
  });

  // UI-AGT-018: Handles agent without version
  it("handles agent without version gracefully", () => {
    const agentNoVersion = { ...mockAgent, latest_version: undefined };
    render(<AgentCard agent={agentNoVersion} />);
    // Should still render name
    expect(screen.getByText("PR Review Agent")).toBeInTheDocument();
    // Should not crash
    expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
  });

  // UI-AGT-019: Handles agent without description
  it("handles agent without description", () => {
    const agentNoDesc = { ...mockAgent, description: undefined };
    render(<AgentCard agent={agentNoDesc} />);
    expect(screen.getByText("PR Review Agent")).toBeInTheDocument();
  });

  // UI-AGT-020: Has bot icon
  it("has bot icon", () => {
    const { container } = render(<AgentCard agent={mockAgent} />);
    const icon = container.querySelector("svg");
    expect(icon).toBeInTheDocument();
  });
});

describe("AgentCard status dot colors", () => {
  // UI-AGT-021: Active agent has green dot
  it("active agent has green status dot", () => {
    const { container } = render(<AgentCard agent={mockAgent} />);
    const statusDot = container.querySelector(".bg-accent-green");
    expect(statusDot).toBeInTheDocument();
  });

  // UI-AGT-022: Draft agent has yellow dot
  it("draft agent has yellow status dot", () => {
    const { container } = render(<AgentCard agent={mockAgentDraft} />);
    const statusDot = container.querySelector(".bg-accent-yellow");
    expect(statusDot).toBeInTheDocument();
  });

  // UI-AGT-023: Deprecated agent has orange dot
  it("deprecated agent has orange status dot", () => {
    const { container } = render(<AgentCard agent={mockAgentDeprecated} />);
    const statusDot = container.querySelector(".bg-accent-orange");
    expect(statusDot).toBeInTheDocument();
  });
});
