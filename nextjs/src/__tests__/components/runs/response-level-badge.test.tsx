/**
 * Tests for ResponseLevelBadge — the reversibility-aware graduated response
 * (DeepMind R1-R3 ladder) badge on the run header.
 */
import { render, screen } from "@testing-library/react";
import { ResponseLevelBadge } from "@/components/runs/response-level-badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ResponseLevel } from "@/types/run";

function renderBadge(level?: ResponseLevel) {
  return render(
    <TooltipProvider>
      <ResponseLevelBadge responseLevel={level} />
    </TooltipProvider>
  );
}

describe("ResponseLevelBadge", () => {
  it("renders nothing for a legacy run with no response level", () => {
    const { container } = renderBadge(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["allow_and_log", "R1", "Allow + log"],
    ["allow_under_budget", "R2", "Allow under budget"],
    ["require_approval", "R3", "Require approval"],
  ] as const)("renders %s as %s", (level, rung, label) => {
    renderBadge(level);
    expect(
      screen.getByText((text) => text.includes(rung) && text.includes(label))
    ).toBeInTheDocument();
  });
});
