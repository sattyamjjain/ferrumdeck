import { render, screen } from "@testing-library/react";
import { NotImplementedState } from "@/components/shared/not-implemented-state";

/**
 * Encodes the accessibility contract for the "not implemented (501)" notice
 * (reviewed against WCAG 2.1 AA): it must be announced (role="status"), sit at a
 * clean heading level (h2, no h1→h3 skip), link out descriptively with a
 * new-tab warning, and never rely on the icon alone.
 */
describe("NotImplementedState accessibility", () => {
    const props = {
        title: "Evaluations backend not implemented",
        description:
            "The dashboard has no gateway eval backend yet. Tracked in issue #7.",
        issueUrl: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        issueLabel: "Track eval backend support on GitHub",
    };

    it("announces itself via role=status containing the notice text", () => {
        render(<NotImplementedState {...props} />);
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("Evaluations backend not implemented");
    });

    it("titles the notice as an h2 (no h1→h3 skip)", () => {
        render(<NotImplementedState {...props} />);
        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading).toHaveTextContent(
            "Evaluations backend not implemented",
        );
        // And it must NOT be an h3 (the EmptyState pitfall this component avoids).
        expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    });

    it("links to the issue with descriptive text, a new-tab warning, and safe rel", () => {
        render(<NotImplementedState {...props} />);
        const link = screen.getByRole("link", {
            name: /Track eval backend support on GitHub/i,
        });
        expect(link).toHaveAttribute("href", props.issueUrl);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link.getAttribute("rel") ?? "").toContain("noopener");
        // Screen-reader-only new-tab warning is present.
        expect(link).toHaveTextContent("(opens in new tab)");
    });

    it("hides the decorative icon from the accessibility tree", () => {
        const { container } = render(<NotImplementedState {...props} />);
        const hiddenIcons = container.querySelectorAll(
            'svg[aria-hidden="true"]',
        );
        // The warning icon + the external-link icon are both decorative.
        expect(hiddenIcons.length).toBeGreaterThanOrEqual(1);
        // No svg should carry an accessible name that would double-announce.
        container.querySelectorAll("svg").forEach((svg) => {
            expect(svg.getAttribute("aria-label")).toBeNull();
        });
    });
});
