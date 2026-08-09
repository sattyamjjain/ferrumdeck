//! Guards the root README's advertised current version against the workspace
//! version.
//!
//! The install section carries a machine-readable marker:
//!
//! ```text
//! **Current version: `v0.8.4`.** <!-- x-current-version: 0.8.4 -->
//! ```
//!
//! This test reads that marker and asserts it equals this crate's version, which
//! inherits the Rust workspace version (`version.workspace = true`), so
//! `env!("CARGO_PKG_VERSION")` is the single source of truth. It exists because the
//! install section spent a full release cycle telling people to run
//! `cargo add ferrumdeck --features audit` — a command that did not resolve until
//! 0.8.4 — and a stale "current version" line is the same class of drift: the README
//! advertising a state the workspace has moved past.

/// Extract the `X.Y.Z` that follows the `x-current-version:` marker.
fn stated_readme_version(readme: &str) -> Option<String> {
    const MARKER: &str = "x-current-version:";
    let start = readme.find(MARKER)? + MARKER.len();
    let v: String = readme[start..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[test]
fn readme_current_version_matches_workspace() {
    // repo root is three levels up from this crate (rust/crates/ferrumdeck).
    let readme_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../README.md");
    let readme = std::fs::read_to_string(&readme_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", readme_path.display()));

    let stated = stated_readme_version(&readme).expect(
        "root README must carry an `<!-- x-current-version: X.Y.Z -->` marker in the \
         install section",
    );
    let workspace_version = env!("CARGO_PKG_VERSION");

    assert_eq!(
        stated, workspace_version,
        "README `x-current-version` marker says {stated:?} but the workspace is at \
         {workspace_version:?} — update the README install section's current-version \
         marker (and the visible `v{workspace_version}` next to it) to match, or bump \
         the workspace to {stated}."
    );
}

#[test]
fn crate_readme_dep_example_matches_workspace_major_minor() {
    // The crates.io-facing crate README shows a `ferrumdeck = "X.Y"` dependency
    // example. It had drifted to "0.7" while the crate was already 0.8.x — a
    // constraint that would not resolve to the current engine. Assert its
    // major.minor tracks the workspace version.
    let readme_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("README.md");
    let readme = std::fs::read_to_string(&readme_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", readme_path.display()));

    let needle = "ferrumdeck = \"";
    let start = readme
        .find(needle)
        .expect("crate README must show a `ferrumdeck = \"X.Y\"` dependency example")
        + needle.len();
    let constraint: String = readme[start..].chars().take_while(|c| *c != '"').collect();

    let workspace = env!("CARGO_PKG_VERSION");
    let ws_major_minor: String = workspace.split('.').take(2).collect::<Vec<_>>().join(".");

    assert_eq!(
        constraint, ws_major_minor,
        "crate README pins `ferrumdeck = {constraint:?}` but the workspace is at \
         {workspace:?} (major.minor {ws_major_minor:?}) — a stale constraint won't \
         resolve to the current engine. Update rust/crates/ferrumdeck/README.md."
    );
}

#[test]
fn version_marker_is_parseable() {
    // Guards the extractor itself against a malformed marker.
    assert_eq!(
        stated_readme_version("blah <!-- x-current-version: 1.2.3 --> blah"),
        Some("1.2.3".to_string())
    );
    assert_eq!(stated_readme_version("no marker here"), None);
}
