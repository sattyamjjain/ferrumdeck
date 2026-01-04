"use client";

/**
 * Skip-to-content link for keyboard accessibility.
 *
 * This component is visually hidden until focused, allowing keyboard users
 * to bypass navigation and jump directly to the main content.
 *
 * @see https://www.w3.org/WAI/WCAG21/Techniques/general/G1
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="
        sr-only
        focus:not-sr-only
        focus:fixed
        focus:top-4
        focus:left-4
        focus:z-[100]
        focus:px-4
        focus:py-2
        focus:bg-primary
        focus:text-primary-foreground
        focus:rounded-md
        focus:font-medium
        focus:shadow-lg
        focus:outline-none
        focus:ring-2
        focus:ring-primary-foreground
        focus:ring-offset-2
        focus:ring-offset-background
      "
      onClick={(e) => {
        // Ensure focus moves to main content after navigation
        const mainContent = document.getElementById("main-content");
        if (mainContent) {
          e.preventDefault();
          mainContent.focus();
          mainContent.scrollIntoView({ behavior: "smooth" });
        }
      }}
    >
      Skip to main content
    </a>
  );
}
