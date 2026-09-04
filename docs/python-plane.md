# The Python data plane

**Status: install from source only. Not on PyPI, and not planned for PyPI.**

The Python half of this repository is six packages under `python/packages/`. They
appear in the tree, they carry version numbers, and `pip install fd-worker` will
never work. This page exists so that reads as a decision rather than as
abandoned work.

## What it is

FerrumDeck splits into two planes that deliberately do not trust each other:

| | Control plane (Rust) | Data plane (Python) |
| --- | --- | --- |
| Decides | whether a call may happen | nothing |
| Executes | nothing an agent asked for | the agent's LLM and tool calls |
| Ships as | crates on crates.io, a gateway binary | source in this repo |

The data plane is the side that actually runs the agent. A worker pulls a step
off the Redis stream, executes it — an LLM completion through `litellm`, a tool
call routed through MCP — and reports the result back. Every gating decision on
that path is a round trip to the Rust gateway: the worker asks, enforces the
answer it gets, and has no local override. That asymmetry is the product. A
plane that both runs the agent and decides what the agent may do is not an
enforcement boundary.

The packages:

| Package | What it is |
| --- | --- |
| `fd-runtime` | Workflow/run/step models, the control-plane HTTP client, OTel GenAI tracing, attestation helpers |
| `fd-worker` | The queue consumer. Step executor, LLM path, agentic loop, and the LLM02 output check that runs *before* any tool dispatch |
| `fd-mcp-router` | Deny-by-default MCP tool routing |
| `fd-mcp-tools` | MCP servers this repo ships (git, test runner) |
| `fd-evals` | The evaluation and benchmark framework — the deterministic, offline suites that gate PRs |
| `fd-cli` | The `fd` command, a thin client over the gateway API |

## Why it is Python at all

Two reasons, both practical. The LLM and MCP ecosystem is Python — `litellm`,
the MCP SDK, and every provider client live there, and reimplementing that
surface in Rust would be a maintenance burden with no governance payoff. And
the evaluation framework benefits from being in the same language as the
workloads it scores.

Neither reason applies to the enforcement path, which is why the enforcement
path is not here.

## Why it is not published

Not because the names are taken. All six, and `ferrumdeck`, are free on PyPI
today. The reasons are about what a stranger would actually receive:

- **These are not libraries.** `fd-worker` is a daemon that needs a Redis stream
  and a reachable gateway. `fd-mcp-tools` are servers. `fd-cli` needs a gateway
  URL and an API key. Installed on their own, none of them do anything — they
  are the runtime halves of a deployed system, not components you compose into
  your own.
- **The version numbers are not a release line.** `scripts/bump_version.py`
  moves the workspace root and all six packages in lockstep with the Rust
  workspace. `0.8.17` says which commit of *this repository* the package came
  from. It carries no independent compatibility promise, and publishing it to
  an index that reads version numbers as promises would create one by accident.
- **`fd-runtime` is coupled to the gateway's HTTP contract**, which this repo
  versions as a whole. A caller who pinned `fd-runtime==0.8.17` against a
  later gateway would get a contract mismatch that the pin made look safe.
- **A published name is close to permanent.** This project already learned the
  cost of a generic name on a public index from the other direction: `fd-core`
  on crates.io belongs to an unrelated project, so `cargo add fd-core` hands you
  someone else's code. Claiming six generic `fd-*` names on PyPI to distribute
  things that cannot run standalone would be the same mistake, pointed outward.

## What to use instead

**If you want the enforcement engine as a dependency** — the deny-by-default
tool policy, budgets, Airlock, the reversibility ladder — it is published, in
Rust:

```bash
cargo add ferrumdeck              # engine
cargo add ferrumdeck --features audit   # + hash-chained audit trail
```

Published crates: `ferrumdeck`, `ferrumdeck-core`, `ferrumdeck-policy`,
`ferrumdeck-audit`, `ferrumdeck-otel`. Note the `ferrumdeck-` prefix: the
directories are `rust/crates/fd-*` and the import paths are `fd_*`, but the
package names are not.

**If you want to drive the control plane from your own Python**, call the HTTP
API directly rather than depending on `fd-runtime`. The contract is committed:

- `contracts/openapi/control-plane.openapi.yaml`
- `contracts/jsonschema/{run,policy,tool,tool-version,workflow}.schema.json`
- Swagger UI on a running gateway at `/swagger-ui`

Generate a client from that spec. It is the interface this project actually
maintains, and it does not go stale against a pinned package version.

**If you want to run the whole stack**, clone it:

```bash
git clone https://github.com/sattyamjjain/ferrumdeck && cd ferrumdeck
uv sync            # the Python plane, via uv workspace
make quickstart    # infra + gateway + worker + dashboard
```

Deployment manifests live in `deploy/` (Docker Compose, Helm, k8s), and
pre-built gateway and worker images are on GHCR.

**If you want to run the evals**, they are deterministic and offline — no LLM,
no network, seeded — so they work from a clone with nothing else running:

```bash
make eval-injection-defense
make eval-asb
make eval-coherence-fp
```

## If this changes

Publishing would mean committing to an independent version line, a stable
`fd-runtime` surface, and a support answer for someone who installed the worker
without a control plane. None of that is true today. If it becomes true, this
page changes and `docs/feature-status.yml` records it — that file, not this
paragraph, is what CI checks claims against.
