//! Guards every internal cross-crate version pin against the workspace version.
//!
//! A sibling dependency is declared with both a path and a version:
//!
//! ```text
//! fd-policy = { path = "../fd-policy", version = "0.8.15", package = "ferrumdeck-policy" }
//! ```
//!
//! The `path` is what a workspace build uses; the `version` is what the
//! *published* crate carries to crates.io. Only the first is exercised locally,
//! so a stale `version` is invisible: `cargo build`, `cargo test` and `cargo
//! clippy` all pass, because a caret requirement like `^0.8.12` is satisfied by
//! 0.8.15. Nothing in the workspace can tell the difference.
//!
//! A downstream consumer can. `ferrumdeck 0.8.15` published with
//! `ferrumdeck-policy = "^0.8.12"` permits a resolver to select 0.8.12 — three
//! releases of enforcement behaviour behind the umbrella that pulled it in —
//! and still consider the constraint met. That is what this asserts against.
//! It is the same drift `crate_readme_dep_example_matches_workspace_major_minor`
//! caught in the crate README (`ferrumdeck = "0.7"` while the crate was 0.8.x),
//! found in prose but never checked in the manifests where it actually binds.
//!
//! `scripts/bump_version.py` rewrites these pins on every bump. This test is the
//! independent check that it did.

use std::path::{Path, PathBuf};

/// Every workspace member manifest that could carry an internal pin.
fn crate_manifests() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut out = Vec::new();
    for group in ["rust/crates", "rust/services"] {
        let dir = root.join(group);
        let entries =
            std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()));
        for entry in entries {
            let manifest = entry.expect("dir entry").path().join("Cargo.toml");
            if manifest.is_file() {
                out.push(manifest);
            }
        }
    }
    out.sort();
    assert!(
        out.len() >= 8,
        "expected to find the workspace member manifests, found {}",
        out.len()
    );
    out
}

/// The `X.Y.Z` inside the first `version = "..."` on this line, if any.
fn pinned_version(line: &str) -> Option<&str> {
    const KEY: &str = "version = \"";
    let start = line.find(KEY)? + KEY.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    let v = &rest[..end];
    // Workspace-inherited (`version.workspace = true`) and non-semver values
    // are not literal pins.
    v.split('.').count().eq(&3).then_some(v)
}

#[test]
fn internal_pins_track_workspace_version() {
    let workspace_version = env!("CARGO_PKG_VERSION");
    let mut checked = 0usize;
    let mut stale: Vec<String> = Vec::new();

    for manifest in crate_manifests() {
        let text = std::fs::read_to_string(&manifest)
            .unwrap_or_else(|e| panic!("read {}: {e}", manifest.display()));

        for (i, line) in text.lines().enumerate() {
            // The `package = "ferrumdeck-..."` rename is what distinguishes a
            // sibling crate from a registry dependency. External deps
            // (jsonschema, criterion) carry a version but no rename.
            if !line.contains("package = \"ferrumdeck-") {
                continue;
            }
            let Some(pinned) = pinned_version(line) else {
                // Path-only sibling deps (dev-deps stripped on publish, and the
                // unpublished crates) carry no version and cannot go stale.
                continue;
            };
            checked += 1;
            if pinned != workspace_version {
                stale.push(format!(
                    "  {}:{} pins {pinned}, workspace is {workspace_version}\n    {}",
                    manifest.file_name().and_then(|s| s.to_str()).unwrap_or("?"),
                    i + 1,
                    line.trim()
                ));
            }
        }
    }

    assert!(
        checked > 0,
        "found no internal version pins at all — the `package = \"ferrumdeck-...\"` \
         convention this test keys on has changed, and the guard is now inert"
    );

    assert!(
        stale.is_empty(),
        "{} internal cross-crate pin(s) do not track the workspace version:\n{}\n\n\
         These build green locally (a caret requirement is satisfied by any later \
         0.8.x) but ship a requirement to crates.io that lets a consumer resolve a \
         stale sibling. Run `python scripts/bump_version.py {workspace_version}` \
         rather than editing them by hand.",
        stale.len(),
        stale.join("\n")
    );
}
