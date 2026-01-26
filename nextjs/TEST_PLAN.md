# FerrumDeck Dashboard - Complete Testing Plan

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Page Navigation Tests](#2-page-navigation-tests)
3. [Runs Management Tests](#3-runs-management-tests)
4. [Approvals Tests](#4-approvals-tests)
5. [Agents Registry Tests](#5-agents-registry-tests)
6. [Tools Registry Tests](#6-tools-registry-tests)
7. [Policies & Budgets Tests](#7-policies--budgets-tests)
8. [Security & Threats Tests](#8-security--threats-tests)
9. [Audit Logs Tests](#9-audit-logs-tests)
10. [API Keys Management Tests](#10-api-keys-management-tests)
11. [Settings Tests](#11-settings-tests)
12. [Analytics Tests](#12-analytics-tests)
13. [Evals Tests](#13-evals-tests)
14. [Workflows Tests](#14-workflows-tests)
15. [Overview Dashboard Tests](#15-overview-dashboard-tests)
16. [Component Unit Tests](#16-component-unit-tests)
17. [Form Validation Tests](#17-form-validation-tests)
18. [Error Handling Tests](#18-error-handling-tests)
19. [Loading States Tests](#19-loading-states-tests)
20. [Empty States Tests](#20-empty-states-tests)
21. [Real-time Updates Tests](#21-real-time-updates-tests)
22. [Accessibility Tests](#22-accessibility-tests)
23. [Responsive Design Tests](#23-responsive-design-tests)
24. [Performance Tests](#24-performance-tests)
25. [Security Tests](#25-security-tests)
26. [Cross-Browser Tests](#26-cross-browser-tests)
27. [Edge Cases & Boundary Tests](#27-edge-cases--boundary-tests)

---

## 1. Test Environment Setup

### 1.1 Prerequisites
| ID | Requirement | Status |
|----|-------------|--------|
| ENV-001 | Node.js 18+ installed | |
| ENV-002 | Playwright installed | |
| ENV-003 | Gateway running on localhost:8080 | |
| ENV-004 | PostgreSQL running on localhost:5433 | |
| ENV-005 | Redis running on localhost:6379 | |
| ENV-006 | Test data seeded (`make db-seed`) | |
| ENV-007 | Environment variables configured | |

### 1.2 Test Data Requirements
| ID | Data | Purpose |
|----|------|---------|
| DATA-001 | 5+ runs in various statuses | Run list testing |
| DATA-002 | 2+ pending approvals | Approval workflow |
| DATA-003 | 3+ agents (active, draft, deprecated) | Agent management |
| DATA-004 | 5+ tools with different risk levels | Tool filtering |
| DATA-005 | 2+ policies with rules | Policy management |
| DATA-006 | 3+ API keys (active, expired, revoked) | Key management |
| DATA-007 | 10+ audit events | Audit log testing |
| DATA-008 | 3+ security threats | Threat monitoring |

### 1.3 Test User Accounts
| ID | User | Scopes | Purpose |
|----|------|--------|---------|
| USER-001 | Admin | Full access | Complete functionality |
| USER-002 | Read-only | read_* scopes | Permission testing |
| USER-003 | Run executor | create_runs, read_runs | Limited access |

---

## 2. Page Navigation Tests

### 2.1 Sidebar Navigation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| NAV-001 | Navigate to Overview | Click "Overview" in sidebar | URL is `/overview`, Overview page loads |
| NAV-002 | Navigate to Runs | Click "Runs" in sidebar | URL is `/runs`, Runs page loads |
| NAV-003 | Navigate to Approvals | Click "Approvals" in sidebar | URL is `/approvals`, Approvals page loads |
| NAV-004 | Navigate to Agents | Click "Agents" in sidebar | URL is `/agents`, Agents page loads |
| NAV-005 | Navigate to Tools | Click "Tools" in sidebar | URL is `/tools`, Tools page loads |
| NAV-006 | Navigate to Policies | Click "Policies" in sidebar | URL is `/policies`, Policies page loads |
| NAV-007 | Navigate to Threats | Click "Threats" in sidebar | URL is `/threats`, Threats page loads |
| NAV-008 | Navigate to Audit | Click "Audit" in sidebar | URL is `/audit`, Audit page loads |
| NAV-009 | Navigate to Evals | Click "Evals" in sidebar | URL is `/evals`, Evals page loads |
| NAV-010 | Navigate to Workflows | Click "Workflows" in sidebar | URL is `/workflows`, Workflows page loads |
| NAV-011 | Navigate to Logs | Click "Logs" in sidebar | URL is `/logs`, Logs page loads |
| NAV-012 | Navigate to Settings | Click "Settings" in sidebar | URL is `/settings`, Settings page loads |
| NAV-013 | Navigate to Analytics | Click "Analytics" in sidebar | URL is `/analytics`, Analytics page loads |

### 2.2 Breadcrumb Navigation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| NAV-014 | Run detail breadcrumb | Go to `/runs/[id]`, click "Runs" | Returns to `/runs` |
| NAV-015 | Agent detail breadcrumb | Go to `/agents/[id]`, click "Agents" | Returns to `/agents` |
| NAV-016 | Tool detail breadcrumb | Go to `/tools/[id]`, click "Tools" | Returns to `/tools` |

### 2.3 Direct URL Access
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| NAV-017 | Direct to run detail | Navigate to `/runs/run_01ABC` | Run detail page loads |
| NAV-018 | Direct to agent detail | Navigate to `/agents/agt_01ABC` | Agent detail page loads |
| NAV-019 | Direct to tool detail | Navigate to `/tools/tool_01ABC` | Tool detail page loads |
| NAV-020 | Invalid run ID | Navigate to `/runs/invalid_id` | 404 or error state shown |
| NAV-021 | Root redirect | Navigate to `/` | Redirects to `/runs` |

### 2.4 Browser History
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| NAV-022 | Back button | Navigate A→B→C, click back | Returns to B |
| NAV-023 | Forward button | Navigate A→B, back, forward | Returns to B |
| NAV-024 | History state preservation | Apply filter, navigate away, back | Filter preserved |

---

## 3. Runs Management Tests

### 3.1 Runs List Page
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-001 | Load runs list | Navigate to `/runs` | Runs table displays with data |
| RUN-002 | Runs table columns | Check table headers | ID, Agent, Status, Duration, Cost, Created visible |
| RUN-003 | Status badge colors | Verify run statuses | Correct colors (green=completed, red=failed, etc.) |
| RUN-004 | Truncated run ID | Check ID column | ID truncated, hover shows full ID |
| RUN-005 | Copy run ID | Click copy button on row | ID copied, toast shown |
| RUN-006 | Click run row | Click any run row | Navigates to run detail |

### 3.2 Runs Filtering
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-007 | Filter by status | Select "Running" from dropdown | Only running runs shown |
| RUN-008 | Filter by multiple statuses | Select "Running" and "Failed" | Running and failed runs shown |
| RUN-009 | Filter by agent | Select agent from dropdown | Only runs for that agent shown |
| RUN-010 | Search by run ID | Enter "run_01" in search | Matching runs shown |
| RUN-011 | Date range filter | Set last 24 hours | Only recent runs shown |
| RUN-012 | Clear all filters | Click "Clear filters" | All runs shown |
| RUN-013 | Filter badge count | Apply filter | Badge shows count of active filters |
| RUN-014 | URL filter persistence | Apply filter, refresh page | Filter preserved in URL |

### 3.3 Saved Views
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-015 | All view | Click "All" saved view | All runs shown |
| RUN-016 | Running view | Click "Running" saved view | Only running runs |
| RUN-017 | Failed Today view | Click "Failed Today" | Failed runs from today |
| RUN-018 | Awaiting Approval view | Click "Awaiting Approval" | Runs waiting approval |

### 3.4 Runs Pagination
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-019 | Initial page load | Load runs page | First page of runs shown |
| RUN-020 | Load more | Scroll to bottom | More runs loaded automatically |
| RUN-021 | Page size | Check initial load | 20 runs per page |
| RUN-022 | Total count | Check header | Total run count displayed |

### 3.5 Run Creation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-023 | Open create dialog | Click "Create Run" button | Dialog opens |
| RUN-024 | Agent selection required | Try submit without agent | Validation error |
| RUN-025 | Valid JSON input | Enter valid JSON | No validation error |
| RUN-026 | Invalid JSON input | Enter "{ invalid }" | JSON validation error |
| RUN-027 | Create run success | Fill form, submit | Run created, dialog closes, list refreshes |
| RUN-028 | Create run error | Submit with invalid data | Error toast shown |
| RUN-029 | Cancel create | Click Cancel | Dialog closes, no run created |
| RUN-030 | Budget override | Enter budget value | Budget applied to run |

### 3.6 Run Detail Page
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-031 | Load run detail | Navigate to `/runs/[id]` | Run header and tabs load |
| RUN-032 | Run header info | Check header | ID, agent, status, duration, cost shown |
| RUN-033 | Steps tab | Click "Steps" tab | Step timeline displayed |
| RUN-034 | Input/Output tab | Click "Input/Output" tab | Run input and output shown |
| RUN-035 | Artifacts tab | Click "Artifacts" tab | File artifacts listed |
| RUN-036 | Audit tab | Click "Audit" tab | Audit events for run shown |

### 3.7 Step Timeline
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-037 | Steps display | View step timeline | All steps shown with status |
| RUN-038 | Step type icons | Check step icons | LLM, Tool, Approval icons correct |
| RUN-039 | Click step | Click on a step | Step detail panel opens |
| RUN-040 | Step detail content | View step detail | Input, output, duration shown |
| RUN-041 | LLM step details | View LLM step | Model, tokens, messages shown |
| RUN-042 | Tool step details | View tool step | Tool name, arguments, result shown |
| RUN-043 | Close step detail | Click X or outside | Panel closes |

### 3.8 Run Actions
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-044 | Cancel running run | Click Cancel on running run | Confirmation shown |
| RUN-045 | Confirm cancel | Click Confirm | Run cancelled, status updated |
| RUN-046 | Cancel completed run | Check Cancel button | Button disabled for completed runs |
| RUN-047 | Copy full ID | Click "Copy ID" in menu | Full ID copied |
| RUN-048 | Download output | Click "Download Output" | Output file downloaded |

### 3.9 Real-time Updates
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RUN-049 | Running run updates | View running run | Status updates every 2s |
| RUN-050 | Step progress | View running run steps | New steps appear as executed |
| RUN-051 | Completion update | Wait for run to complete | Status changes, polling stops |
| RUN-052 | List auto-refresh | View runs list with active run | List updates with new status |

---

## 4. Approvals Tests

### 4.1 Approvals List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| APR-001 | Load approvals | Navigate to `/approvals` | Approval cards displayed |
| APR-002 | Pending tab | Click "Pending" tab | Only pending approvals shown |
| APR-003 | Resolved Today tab | Click "Resolved Today" tab | Today's resolved approvals |
| APR-004 | All tab | Click "All" tab | All approvals shown |
| APR-005 | Tab counts | Check tab badges | Correct counts per tab |

### 4.2 Approval Card
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| APR-006 | Card content | View approval card | Tool, agent, risk level, policy shown |
| APR-007 | Status badge | Check status | Correct status (pending/approved/rejected) |
| APR-008 | Risk level indicator | Check risk badge | Correct color for risk level |
| APR-009 | Time display | Check timestamp | Relative time shown |

### 4.3 Approval Actions
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| APR-010 | Approve inline | Click "Approve" button | Approval processed, card updates |
| APR-011 | Reject inline | Click "Reject" button | Rejection processed, card updates |
| APR-012 | Open drawer | Click "View Details" | Approval drawer opens |
| APR-013 | Approve with note | Add note, click Approve | Approval saved with note |
| APR-014 | Reject with reason | Add reason, click Reject | Rejection saved with reason |
| APR-015 | Approve success toast | Complete approval | Success toast shown |
| APR-016 | Reject success toast | Complete rejection | Success toast shown |

### 4.4 Approval Drawer
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| APR-017 | Drawer content | Open drawer | Full approval details shown |
| APR-018 | Tool arguments | View arguments section | JSON arguments displayed |
| APR-019 | Policy details | View policy section | Policy name and rule shown |
| APR-020 | Similar approvals | View similar section | Related approvals listed |
| APR-021 | Close drawer | Click X or outside | Drawer closes |
| APR-022 | Link to run | Click run link | Navigates to run detail |

### 4.5 Approval Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| APR-023 | Expired approval | View expired approval | Status shows expired |
| APR-024 | No pending approvals | Delete all pending | Empty state shown |
| APR-025 | Rapid approve/reject | Click multiple times | Only one action processed |
| APR-026 | Concurrent approval | Two users approve same | One succeeds, other gets error |

---

## 5. Agents Registry Tests

### 5.1 Agents List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-001 | Load agents | Navigate to `/agents` | Agent cards displayed |
| AGT-002 | Agent card content | View agent card | Name, description, status, version count |
| AGT-003 | Status dot colors | Check status indicators | Green=active, yellow=draft, etc. |
| AGT-004 | Click agent | Click agent card | Navigate to agent detail |

### 5.2 Agents Filtering
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-005 | Filter by status | Click "Active" pill | Only active agents shown |
| AGT-006 | Filter by draft | Click "Draft" pill | Only draft agents shown |
| AGT-007 | Filter deprecated | Click "Deprecated" pill | Only deprecated agents |
| AGT-008 | Filter archived | Click "Archived" pill | Only archived agents |
| AGT-009 | Search by name | Enter agent name | Matching agents shown |
| AGT-010 | Search by slug | Enter agent slug | Matching agents shown |
| AGT-011 | Search by description | Enter keyword | Matching agents shown |
| AGT-012 | Clear search | Clear search input | All agents shown |
| AGT-013 | Combined filters | Status + search | Both filters applied |

### 5.3 Agent Detail
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-014 | Load agent detail | Navigate to `/agents/[id]` | Agent detail page loads |
| AGT-015 | Agent header | Check header | Name, status, version, description |
| AGT-016 | Stats display | View stats section | Runs, success rate, avg cost (24h) |
| AGT-017 | Versions tab | Click "Versions" tab | Version history shown |
| AGT-018 | Tools tab | Click "Tools" tab | Allowed tools listed |
| AGT-019 | Budget display | Check budget section | Budget limit and usage |

### 5.4 Agent Versions
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-020 | Version list | View versions tab | All versions listed |
| AGT-021 | Version details | Click version | Version details shown |
| AGT-022 | Create version | Click "Create Version" | Version dialog opens |
| AGT-023 | Version number validation | Enter invalid version | Validation error |
| AGT-024 | Create version success | Submit valid version | Version created |
| AGT-025 | Active version badge | Check active version | Badge indicates active |

### 5.5 Agent Promotion
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-026 | Open promote dialog | Click "Promote" button | Promote dialog opens |
| AGT-027 | Environment selection | Select "Production" | Environment selected |
| AGT-028 | Eval gate display | View eval gate section | Eval status shown |
| AGT-029 | Promote success | Click Promote | Agent promoted, dialog closes |
| AGT-030 | Promote without eval | Try promote with failing evals | Warning shown |

### 5.6 Agent Creation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AGT-031 | Open create dialog | Click "Create Agent" | Dialog opens |
| AGT-032 | Name required | Submit without name | Validation error |
| AGT-033 | Slug auto-generate | Enter name | Slug auto-generated |
| AGT-034 | System prompt | Enter system prompt | Prompt accepted |
| AGT-035 | Tool selection | Select allowed tools | Tools added |
| AGT-036 | Budget setting | Set budget limit | Budget saved |
| AGT-037 | Create success | Submit valid form | Agent created |
| AGT-038 | Duplicate slug | Use existing slug | Error message shown |

---

## 6. Tools Registry Tests

### 6.1 Tools List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-001 | Load tools | Navigate to `/tools` | Tools table displayed |
| TOOL-002 | Table columns | Check headers | Name, Server, Risk, Status, Health, Used By, Last Called |
| TOOL-003 | Risk level colors | Check risk badges | Low=green, Medium=yellow, High=orange, Critical=red |
| TOOL-004 | Health indicators | Check health status | OK=green, Slow=yellow, Error=red |
| TOOL-005 | Click tool row | Click any tool | Navigate to tool detail |

### 6.2 Tools Filtering
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-006 | Filter by risk level | Select "High" | Only high-risk tools |
| TOOL-007 | Filter by MCP server | Select server | Tools from that server |
| TOOL-008 | Filter by status | Select "Active" | Only active tools |
| TOOL-009 | Filter by health | Select "Error" | Only erroring tools |
| TOOL-010 | Search by name | Enter tool name | Matching tools shown |
| TOOL-011 | Multiple filters | Apply 3+ filters | All filters combined |
| TOOL-012 | Clear all filters | Click clear button | All tools shown |
| TOOL-013 | Filter count badge | Apply filters | Badge shows filter count |

### 6.3 Tool Detail
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-014 | Load tool detail | Navigate to `/tools/[id]` | Tool detail page loads |
| TOOL-015 | Overview tab | View overview | Name, server, description, risk shown |
| TOOL-016 | Schema tab | Click "Schema" tab | JSON schema displayed |
| TOOL-017 | Versions tab | Click "Versions" tab | Version history shown |
| TOOL-018 | Usage tab | Click "Usage" tab | Usage stats and charts |
| TOOL-019 | Policy tab | Click "Policy" tab | Policy configuration shown |

### 6.4 Tool Schema
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-020 | Schema display | View schema tab | JSON schema formatted |
| TOOL-021 | Schema expand/collapse | Toggle schema sections | Sections expand/collapse |
| TOOL-022 | Copy schema | Click copy button | Schema copied to clipboard |
| TOOL-023 | Required fields | Check schema | Required fields highlighted |
| TOOL-024 | Type annotations | View types | Type info displayed |

### 6.5 Tool Usage Statistics
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-025 | Usage chart | View usage tab | Calls by day chart shown |
| TOOL-026 | Top agents | View top agents section | Agents using tool listed |
| TOOL-027 | Recent calls | View call history | Recent tool calls shown |
| TOOL-028 | Call details | Click call | Call details expanded |
| TOOL-029 | Time range selector | Change time range | Chart updates |

### 6.6 Tool Policy
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-030 | View policy | Check policy tab | Current policy shown |
| TOOL-031 | Edit policy | Click "Edit Policy" | Policy editor opens |
| TOOL-032 | Approval required | Toggle approval required | Setting saved |
| TOOL-033 | Budget limit | Set budget limit | Limit saved |
| TOOL-034 | Rate limit | Set rate limit | Limit saved |
| TOOL-035 | Save policy | Click Save | Policy updated, toast shown |

### 6.7 Tool Registration
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TOOL-036 | Open register dialog | Click "Register Tool" | Dialog opens |
| TOOL-037 | MCP server selection | Select MCP server | Server selected |
| TOOL-038 | Name required | Submit without name | Validation error |
| TOOL-039 | Unique slug | Enter duplicate slug | Error message |
| TOOL-040 | Risk level selection | Select risk level | Level saved |
| TOOL-041 | Register success | Submit valid form | Tool registered |
| TOOL-042 | Auto-detect schema | Select from MCP | Schema auto-filled |

---

## 7. Policies & Budgets Tests

### 7.1 Policies Tab
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| POL-001 | Load policies | Navigate to `/policies` | Policies tab shown |
| POL-002 | Policy cards | View policy list | Policy cards displayed |
| POL-003 | Priority ordering | Check order | Sorted by priority |
| POL-004 | Policy details | View card content | Name, priority, rules shown |

### 7.2 Policy Actions
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| POL-005 | Duplicate policy | Click duplicate button | New policy created |
| POL-006 | Delete policy | Click delete button | Confirmation shown |
| POL-007 | Confirm delete | Click Confirm | Policy deleted |
| POL-008 | Cancel delete | Click Cancel | Policy retained |

### 7.3 Budgets Tab
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| POL-009 | Switch to budgets | Click "Budgets" tab | Budget table shown |
| POL-010 | Budget table content | View table | Name, Type, Limit, Usage shown |
| POL-011 | Usage percentage | Check usage column | Percentage displayed |
| POL-012 | Edit budget | Click edit button | Edit form opens |
| POL-013 | Delete budget | Click delete button | Budget removed |

### 7.4 Policy Simulator
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| POL-014 | Switch to simulator | Click "Simulator" tab | Simulator form shown |
| POL-015 | Enter agent ID | Fill agent ID field | Field accepts input |
| POL-016 | Select tool | Select tool dropdown | Tool selected |
| POL-017 | Enter parameters | Fill parameters JSON | Parameters accepted |
| POL-018 | Run simulation | Click "Simulate" | Decision displayed |
| POL-019 | Allow decision | Simulate allowed action | Green "Allow" shown |
| POL-020 | Deny decision | Simulate denied action | Red "Deny" with reason |
| POL-021 | Approval decision | Simulate approval needed | Purple "Requires Approval" |
| POL-022 | Invalid input | Submit invalid JSON | Error message shown |

---

## 8. Security & Threats Tests

### 8.1 Threats Dashboard
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-001 | Load threats | Navigate to `/threats` | Threats page loads |
| SEC-002 | Stats cards | View stats section | Total, Blocked, Logged, Critical counts |
| SEC-003 | Threats table | View table | Threat list displayed |
| SEC-004 | Table columns | Check headers | Tool, Risk, Type, Action, Run, Time |

### 8.2 Threats Filtering
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-005 | Filter by run ID | Enter run ID | Threats for that run |
| SEC-006 | Filter by risk level | Select risk level | Matching threats shown |
| SEC-007 | Filter blocked | Select "Blocked" | Only blocked threats |
| SEC-008 | Filter logged | Select "Logged" | Only logged threats |
| SEC-009 | Clear filters | Click clear | All threats shown |
| SEC-010 | Pagination | Navigate pages | Pages work correctly |

### 8.3 Threat Details
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-011 | Click threat row | Click any threat | Detail sheet opens |
| SEC-012 | Threat info | View detail sheet | Full threat details shown |
| SEC-013 | Risk level badge | Check badge | Correct color for level |
| SEC-014 | Violation type | View type | Type displayed |
| SEC-015 | Blocked content | View content | Blocked content shown |
| SEC-016 | Reasoning | View reasoning | Threat reasoning displayed |
| SEC-017 | Link to run | Click run link | Navigate to run |
| SEC-018 | Close sheet | Click X or outside | Sheet closes |

### 8.4 Threat Badges & Indicators
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-019 | Critical badge | View critical threat | Red badge |
| SEC-020 | High badge | View high threat | Orange badge |
| SEC-021 | Medium badge | View medium threat | Yellow badge |
| SEC-022 | Low badge | View low threat | Green badge |
| SEC-023 | Blocked action | View blocked threat | "Blocked" tag |
| SEC-024 | Logged action | View logged threat | "Logged" tag |

---

## 9. Audit Logs Tests

### 9.1 Audit Timeline
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-001 | Load audit | Navigate to `/audit` | Audit page loads |
| AUD-002 | Timeline display | View timeline | Events displayed chronologically |
| AUD-003 | Event cards | View event | Type, actor, target, time shown |
| AUD-004 | Event icons | Check icons | Correct icon per event type |
| AUD-005 | Infinite scroll | Scroll to bottom | More events loaded |

### 9.2 Audit Filtering
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-006 | Search events | Enter search term | Matching events shown |
| AUD-007 | Filter by event type | Select event types | Matching events shown |
| AUD-008 | Event type categories | Open type dropdown | Categories organized |
| AUD-009 | Filter by actor type | Select "User" | User events only |
| AUD-010 | Filter by time range | Select "Last 24h" | Recent events only |
| AUD-011 | Clear all filters | Click clear | All events shown |

### 9.3 Saved Views
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-012 | All events view | Click "All events" | All events shown |
| AUD-013 | Admin actions view | Click "Admin actions" | Admin events only |
| AUD-014 | Policy decisions view | Click "Policy decisions" | Policy events only |
| AUD-015 | Agent runs view | Click "Agent runs" | Run events only |
| AUD-016 | Error events view | Click "Error events" | Error events only |

### 9.4 Event Details
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-017 | Click event | Click event row | Detail drawer opens |
| AUD-018 | Full event info | View drawer | Complete event details |
| AUD-019 | Actor details | View actor section | Actor type and ID |
| AUD-020 | Target details | View target section | Target type and ID |
| AUD-021 | Event payload | View payload | JSON payload displayed |
| AUD-022 | Close drawer | Click X | Drawer closes |

### 9.5 Audit Export
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-023 | Export dropdown | Click export button | Format options shown |
| AUD-024 | Export CSV | Select CSV | CSV file downloaded |
| AUD-025 | Export JSON | Select JSON | JSON file downloaded |
| AUD-026 | Export with filters | Apply filters, export | Filtered events exported |
| AUD-027 | Large export | Export 1000+ events | Export completes |

### 9.6 Audit Stats
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| AUD-028 | Stats cards | View stats section | Total, Today, Errors counts |
| AUD-029 | Stats accuracy | Compare with list | Counts match |

---

## 10. API Keys Management Tests

### 10.1 API Keys List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-001 | Load keys page | Navigate to `/settings/api-keys` | API keys page loads |
| KEY-002 | Keys table | View table | Keys listed with details |
| KEY-003 | Table columns | Check headers | Name, Key, Scopes, Created, Last Used, Expires, Status |
| KEY-004 | Key masking | View key column | Key hidden by default |
| KEY-005 | Status badges | Check status | Active=green, Expired=red, Revoked=gray |

### 10.2 API Key Display
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-006 | Show key | Click show button | Key revealed |
| KEY-007 | Hide key | Click hide button | Key hidden again |
| KEY-008 | Copy key | Click copy button | Key copied, toast shown |
| KEY-009 | Key prefix | View partial key | Prefix visible (fd_...) |

### 10.3 API Key Creation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-010 | Open create dialog | Click "Create API Key" | Dialog opens |
| KEY-011 | Name required | Submit without name | Validation error |
| KEY-012 | Expiration options | Check dropdown | 30d, 90d, 1yr, Never options |
| KEY-013 | Read Only preset | Select Read Only | Read scopes selected |
| KEY-014 | Run Executor preset | Select Run Executor | Executor scopes selected |
| KEY-015 | Full Access preset | Select Full Access | All scopes selected |
| KEY-016 | Custom scopes | Select individual scopes | Scopes checked |
| KEY-017 | Create success | Submit valid form | Key created, shown once |
| KEY-018 | One-time display | View created key | Full key displayed once |
| KEY-019 | Copy new key | Click copy | Key copied |
| KEY-020 | Close dialog | Close after create | Key list refreshed |
| KEY-021 | Key warning | View warning text | "Won't show again" warning |

### 10.4 API Key Revocation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-022 | Revoke button | Find active key | Revoke button visible |
| KEY-023 | Click revoke | Click revoke button | Confirmation shown |
| KEY-024 | Confirm revoke | Click Confirm | Key revoked |
| KEY-025 | Cancel revoke | Click Cancel | Key retained |
| KEY-026 | Revoked status | View revoked key | Status shows "Revoked" |
| KEY-027 | No revoke expired | Find expired key | No revoke button |
| KEY-028 | No revoke revoked | Find revoked key | No revoke button |

### 10.5 Scopes Display
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-029 | Scope badges | View scopes column | Scope badges shown |
| KEY-030 | Truncated scopes | Key with 3+ scopes | Shows 2 + "+N more" |
| KEY-031 | Scope tooltip | Hover +N more | All scopes shown |

### 10.6 Best Practices Section
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| KEY-032 | Guidelines visible | View page | Best practices section |
| KEY-033 | Security tips | Read tips | Security guidance shown |

---

## 11. Settings Tests

### 11.1 General Settings
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SET-001 | Load settings | Navigate to `/settings` | Settings page loads |
| SET-002 | Settings sections | View page | All setting sections visible |

### 11.2 Airlock Configuration
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SET-003 | Airlock card | View Airlock section | Configuration card shown |
| SET-004 | Current mode | Check mode display | Shadow or Enforce shown |
| SET-005 | Change mode | Toggle mode | Mode changed |
| SET-006 | Anti-RCE toggle | Toggle setting | Setting updated |
| SET-007 | Circuit breaker toggle | Toggle setting | Setting updated |
| SET-008 | Exfil shield toggle | Toggle setting | Setting updated |
| SET-009 | Save settings | Click Save | Settings saved, toast shown |
| SET-010 | Velocity limit | Change limit | Value updated |
| SET-011 | Domain whitelist | Edit domains | List updated |

### 11.3 Settings Navigation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SET-012 | API Keys link | Click "API Keys" | Navigate to `/settings/api-keys` |
| SET-013 | Back to settings | Click "Settings" in breadcrumb | Return to `/settings` |

---

## 12. Analytics Tests

### 12.1 Analytics Dashboard
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ANA-001 | Load analytics | Navigate to `/analytics` | Analytics page loads |
| ANA-002 | KPI cards | View top section | Cost, Volume, Success Rate, Duration |
| ANA-003 | KPI values | Check card values | Correct values shown |

### 12.2 Charts
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ANA-004 | Cost chart | View cost section | Line chart displayed |
| ANA-005 | Cost chart data | Check data points | Data matches period |
| ANA-006 | Run volume chart | View volume section | Bar chart displayed |
| ANA-007 | Volume data | Check bars | Daily run counts |
| ANA-008 | Status distribution | View pie chart | Status breakdown |
| ANA-009 | Chart legends | Check legends | All statuses listed |
| ANA-010 | Chart tooltips | Hover data point | Tooltip with details |

### 12.3 Time Range
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ANA-011 | Time range selector | Find selector | Options available |
| ANA-012 | Last 7 days | Select 7 days | Charts update |
| ANA-013 | Last 30 days | Select 30 days | Charts update |
| ANA-014 | Last 90 days | Select 90 days | Charts update |

### 12.4 Agent Analytics
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ANA-015 | Most used agents | View section | Agent list with counts |
| ANA-016 | Agent stats | Check stats | Runs, cost per agent |

---

## 13. Evals Tests

### 13.1 Evals List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EVL-001 | Load evals | Navigate to `/evals` | Eval suites shown |
| EVL-002 | Suite cards | View cards | Name, status, metrics |
| EVL-003 | Suite status | Check status badge | Pass/Fail/Running |
| EVL-004 | Click suite | Click suite card | Navigate to suite detail |

### 13.2 Suite Detail
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EVL-005 | Load suite detail | Navigate to `/evals/suites/[id]` | Suite detail loads |
| EVL-006 | Suite header | View header | Name, description, status |
| EVL-007 | Runs list | View runs section | Suite runs listed |
| EVL-008 | Click run | Click run | Navigate to run results |

### 13.3 Eval Run Results
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EVL-009 | Load run results | Navigate to `/evals/runs/[id]` | Results page loads |
| EVL-010 | Test cases | View test list | All test cases shown |
| EVL-011 | Pass/fail status | Check test status | Green pass, red fail |
| EVL-012 | Score display | View scores | Scores per test |
| EVL-013 | Test details | Click test | Test details expand |
| EVL-014 | Regression diff | View diff section | Comparison shown |

---

## 14. Workflows Tests

### 14.1 Workflows List
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| WFL-001 | Load workflows | Navigate to `/workflows` | Workflows listed |
| WFL-002 | Workflow cards | View cards | Name, status, step count |
| WFL-003 | Click workflow | Click workflow | Navigate to detail |

### 14.2 Workflow Detail
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| WFL-004 | Load detail | Navigate to `/workflows/[id]` | Workflow detail loads |
| WFL-005 | DAG visualization | View DAG section | Graph displayed |
| WFL-006 | Step nodes | Check nodes | Steps shown as nodes |
| WFL-007 | Dependencies | Check edges | Dependencies as arrows |
| WFL-008 | Execution history | View history tab | Past executions listed |

---

## 15. Overview Dashboard Tests

### 15.1 Overview Content
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| OVR-001 | Load overview | Navigate to `/overview` | Overview loads |
| OVR-002 | Stats cards | View top section | Runs, Cost, Success Rate |
| OVR-003 | Recent runs | View runs widget | Latest runs shown |
| OVR-004 | Pending approvals | View approvals widget | Pending count and list |
| OVR-005 | Activity feed | View activity section | Recent activity |
| OVR-006 | Quick links | Check links | Navigate correctly |

### 15.2 Real-time Updates
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| OVR-007 | Run updates | Create new run | Overview updates |
| OVR-008 | Approval updates | New approval | Count updates |

---

## 16. Component Unit Tests

### 16.1 Status Badges
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CMP-001 | RunStatusBadge created | Render with "created" | Gray badge |
| CMP-002 | RunStatusBadge running | Render with "running" | Yellow pulse badge |
| CMP-003 | RunStatusBadge completed | Render with "completed" | Green badge |
| CMP-004 | RunStatusBadge failed | Render with "failed" | Red badge |
| CMP-005 | ApprovalStatusBadge | Test all statuses | Correct colors |
| CMP-006 | SecurityBadge risk levels | Test all levels | Correct colors |

### 16.2 Loading Components
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CMP-007 | LoadingSpinner sm | Render size sm | Small spinner |
| CMP-008 | LoadingSpinner md | Render size md | Medium spinner |
| CMP-009 | LoadingSpinner lg | Render size lg | Large spinner |
| CMP-010 | Skeleton | Render skeleton | Animated pulse |
| CMP-011 | SkeletonRow | Render row | Full row skeleton |

### 16.3 Empty States
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CMP-012 | EmptyState basic | Render with title | Title displayed |
| CMP-013 | EmptyState with action | Add action prop | Button shown |
| CMP-014 | EmptyState icon | Add icon prop | Icon displayed |

### 16.4 Data Display
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| CMP-015 | JSONViewer | Render JSON | Formatted display |
| CMP-016 | JSONViewer collapse | Collapse section | Section collapses |
| CMP-017 | AnimatedCounter | Animate value | Counter animates |
| CMP-018 | StatsCard | Render with data | Value and trend shown |

---

## 17. Form Validation Tests

### 17.1 Run Creation Form
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| FRM-001 | Empty agent | Submit without agent | "Agent required" error |
| FRM-002 | Invalid JSON | Enter "{ broken" | "Invalid JSON" error |
| FRM-003 | Valid JSON | Enter valid JSON | No error |
| FRM-004 | Negative budget | Enter -100 | "Must be positive" error |
| FRM-005 | Valid form | Fill all fields correctly | No errors |

### 17.2 Agent Form
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| FRM-006 | Empty name | Submit without name | "Name required" error |
| FRM-007 | Short name | Enter "ab" | "Min 3 characters" error |
| FRM-008 | Invalid slug | Enter "Invalid Slug!" | "Lowercase, hyphens only" |
| FRM-009 | Duplicate slug | Use existing slug | "Slug already exists" |
| FRM-010 | Valid version | Enter "1.0.0" | No error |
| FRM-011 | Invalid version | Enter "invalid" | "Invalid semver" error |

### 17.3 API Key Form
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| FRM-012 | Empty name | Submit without name | "Name required" error |
| FRM-013 | No scopes | Submit without scopes | "Select at least one" error |
| FRM-014 | Valid form | Fill name + scopes | Form submits |

### 17.4 Policy Simulator Form
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| FRM-015 | Empty agent | Submit without agent | Validation error |
| FRM-016 | Empty tool | Submit without tool | Validation error |
| FRM-017 | Invalid params | Enter broken JSON | "Invalid JSON" error |

---

## 18. Error Handling Tests

### 18.1 Network Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-001 | Network disconnect | Disable network | "Connection error" message |
| ERR-002 | 500 error | Mock 500 response | "Server error" message |
| ERR-003 | 401 error | Mock unauthorized | "Unauthorized" redirect |
| ERR-004 | 403 error | Mock forbidden | "Access denied" message |
| ERR-005 | 404 error | Navigate to invalid | "Not found" page |
| ERR-006 | Retry button | After error, click retry | Request retried |

### 18.2 API Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-007 | Create run error | Mock create failure | Error toast shown |
| ERR-008 | Approve error | Mock approve failure | Error toast shown |
| ERR-009 | Delete error | Mock delete failure | Error toast shown |
| ERR-010 | Error details | Check toast | Error message descriptive |

### 18.3 Validation Errors
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| ERR-011 | Form validation | Submit invalid | Inline errors shown |
| ERR-012 | Field highlight | Invalid field | Red border on field |
| ERR-013 | Error message | Invalid field | Message below field |
| ERR-014 | Clear on fix | Fix field | Error clears |

---

## 19. Loading States Tests

### 19.1 Page Loading
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| LDG-001 | Runs page loading | Navigate with slow network | Skeleton shown |
| LDG-002 | Agent detail loading | Navigate to agent | Skeleton shown |
| LDG-003 | Tool detail loading | Navigate to tool | Skeleton shown |
| LDG-004 | Loading spinner | Check spinner | Animated spinner |

### 19.2 Component Loading
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| LDG-005 | Table loading | Load table | Row skeletons |
| LDG-006 | Chart loading | Load analytics | Chart placeholder |
| LDG-007 | Card loading | Load cards | Card skeletons |
| LDG-008 | Button loading | Submit form | Button shows spinner |

### 19.3 Infinite Loading
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| LDG-009 | Runs infinite | Scroll runs list | Loading indicator at bottom |
| LDG-010 | Audit infinite | Scroll audit | Loading more events |
| LDG-011 | End of list | Scroll to end | No more loading |

---

## 20. Empty States Tests

### 20.1 Empty Lists
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EMP-001 | No runs | Clear all runs | "No runs yet" message |
| EMP-002 | No approvals | No pending approvals | "No pending approvals" |
| EMP-003 | No agents | Clear agents | "No agents" + create button |
| EMP-004 | No tools | Clear tools | "No tools registered" |
| EMP-005 | No policies | Clear policies | "No policies" |
| EMP-006 | No API keys | Clear keys | "No API keys" + create |
| EMP-007 | No threats | No threats | "No threats detected" |
| EMP-008 | No audit events | Clear events | "No events" message |

### 20.2 Filtered Empty
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EMP-009 | No matching runs | Filter with no results | "No matching runs" |
| EMP-010 | No matching agents | Search non-existent | "No agents found" |
| EMP-011 | Clear filters CTA | View empty filtered | "Clear filters" button |

### 20.3 Detail Empty
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EMP-012 | No steps | Run with no steps | "No steps yet" |
| EMP-013 | No artifacts | Run with no artifacts | "No artifacts" |
| EMP-014 | No versions | Agent with no versions | "No versions" |

---

## 21. Real-time Updates Tests

### 21.1 Polling Behavior
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RT-001 | Active run polling | View running run | Updates every 2s |
| RT-002 | Completed run polling | View completed run | Updates every 30s |
| RT-003 | Approval polling | View approvals | Updates every 3s |
| RT-004 | Background polling | View agents list | Updates every 60s |

### 21.2 Live Updates
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RT-005 | New run appears | Create run | Appears in list |
| RT-006 | Status change | Run completes | Status updates |
| RT-007 | New approval | Trigger approval | Appears in list |
| RT-008 | Approval resolved | Approve request | Moves to resolved |

### 21.3 Cache Invalidation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RT-009 | Mutation invalidation | Create run | List refetches |
| RT-010 | Cross-page update | Approve, go to runs | Run status updated |

---

## 22. Accessibility Tests

### 22.1 Keyboard Navigation
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| A11Y-001 | Tab navigation | Tab through page | All elements reachable |
| A11Y-002 | Enter activation | Tab to button, Enter | Button activates |
| A11Y-003 | Escape close | Open modal, Escape | Modal closes |
| A11Y-004 | Arrow keys | In dropdown, arrows | Options navigate |
| A11Y-005 | Focus visible | Tab through | Focus ring visible |

### 22.2 Screen Reader
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| A11Y-006 | Page titles | Navigate pages | Titles announced |
| A11Y-007 | Button labels | Focus buttons | Purpose announced |
| A11Y-008 | Form labels | Focus inputs | Labels announced |
| A11Y-009 | Error announcements | Trigger error | Error announced |
| A11Y-010 | Status updates | Status changes | Changes announced |

### 22.3 ARIA Attributes
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| A11Y-011 | aria-label | Check interactive elements | Labels present |
| A11Y-012 | aria-expanded | Check expandables | Correct state |
| A11Y-013 | aria-selected | Check selections | Correct state |
| A11Y-014 | role attributes | Check components | Correct roles |

### 22.4 Color Contrast
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| A11Y-015 | Text contrast | Check text elements | 4.5:1 minimum |
| A11Y-016 | Badge contrast | Check badges | Readable text |
| A11Y-017 | Button contrast | Check buttons | Meets WCAG |

---

## 23. Responsive Design Tests

### 23.1 Mobile View (< 768px)
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RES-001 | Sidebar collapse | View on mobile | Sidebar hidden/hamburger |
| RES-002 | Table horizontal scroll | View table | Horizontal scroll enabled |
| RES-003 | Card stack | View cards | Cards stack vertically |
| RES-004 | Touch targets | Check buttons | Minimum 44px |
| RES-005 | Dialog sizing | Open dialog | Full-screen on mobile |

### 23.2 Tablet View (768px - 1024px)
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RES-006 | Sidebar behavior | View tablet | Collapsible sidebar |
| RES-007 | Grid columns | View grids | Adjusted column count |
| RES-008 | Chart sizing | View charts | Readable charts |

### 23.3 Desktop View (> 1024px)
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| RES-009 | Full layout | View desktop | Full sidebar + content |
| RES-010 | Max width | Wide screen | Content max-width |
| RES-011 | Multi-column | View detail | Sidebar + main content |

---

## 24. Performance Tests

### 24.1 Page Load Performance
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| PRF-001 | Initial load | Load homepage | < 3s to interactive |
| PRF-002 | Runs list load | Load 100 runs | < 2s to render |
| PRF-003 | Detail page load | Load run detail | < 1.5s to render |
| PRF-004 | Lazy loading | Check network | Components lazy loaded |

### 24.2 Interaction Performance
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| PRF-005 | Filter response | Apply filter | < 200ms UI update |
| PRF-006 | Search response | Type search | < 300ms results |
| PRF-007 | Modal open | Open dialog | < 100ms visible |
| PRF-008 | Tab switch | Switch tabs | < 200ms content |

### 24.3 Memory & Resources
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| PRF-009 | Memory usage | Use for 10 min | No memory leak |
| PRF-010 | Long list | Scroll 1000 items | Smooth scrolling |
| PRF-011 | Multiple tabs | Open 5 tabs | No degradation |

---

## 25. Security Tests

### 25.1 Authentication
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-T001 | No API key | Remove API key | Unauthorized error |
| SEC-T002 | Invalid API key | Use wrong key | 401 response |
| SEC-T003 | Expired key | Use expired key | 401 response |
| SEC-T004 | Revoked key | Use revoked key | 401 response |

### 25.2 Authorization
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-T005 | Read-only scope | Try to create | 403 forbidden |
| SEC-T006 | Missing scope | Action without scope | 403 forbidden |
| SEC-T007 | Admin only | Non-admin access | Restricted |

### 25.3 Input Sanitization
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-T008 | XSS in search | Enter `<script>` | Escaped/blocked |
| SEC-T009 | XSS in form | Enter HTML in name | Escaped |
| SEC-T010 | SQL injection | Enter `'; DROP TABLE` | Escaped |

### 25.4 HTTPS & Headers
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| SEC-T011 | HTTPS redirect | Access HTTP | Redirected to HTTPS |
| SEC-T012 | CSP headers | Check headers | CSP present |
| SEC-T013 | CORS | Check CORS | Properly configured |

---

## 26. Cross-Browser Tests

### 26.1 Chrome
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| BRW-001 | Chrome latest | Test all features | All working |
| BRW-002 | Chrome -1 | Previous version | All working |

### 26.2 Firefox
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| BRW-003 | Firefox latest | Test all features | All working |
| BRW-004 | Firefox -1 | Previous version | All working |

### 26.3 Safari
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| BRW-005 | Safari latest | Test all features | All working |
| BRW-006 | Safari iOS | Mobile Safari | All working |

### 26.4 Edge
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| BRW-007 | Edge latest | Test all features | All working |

---

## 27. Edge Cases & Boundary Tests

### 27.1 Data Boundaries
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EDG-001 | Very long name | Enter 500 char name | Truncated/handled |
| EDG-002 | Special characters | Enter emoji, unicode | Displayed correctly |
| EDG-003 | Large JSON | 1MB JSON payload | Handled gracefully |
| EDG-004 | Zero budget | Set budget to 0 | Validation or accept |
| EDG-005 | Max integer | Enter max int | Handled |
| EDG-006 | Negative values | Enter -1 | Validation error |

### 27.2 Timing Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EDG-007 | Rapid clicks | Click button 10x fast | Single action |
| EDG-008 | Double submit | Submit form twice | Single submission |
| EDG-009 | Timeout | Wait for timeout | Appropriate message |
| EDG-010 | Stale data | Edit stale record | Conflict handling |

### 27.3 State Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EDG-011 | Back after delete | Delete, back button | Handled gracefully |
| EDG-012 | Refresh during edit | Refresh in dialog | State preserved or warned |
| EDG-013 | Concurrent edit | Two users edit same | Conflict resolution |
| EDG-014 | Session expired | Session times out | Re-auth prompt |

### 27.4 Network Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EDG-015 | Slow network | Throttle to 2G | Graceful loading |
| EDG-016 | Intermittent | Flaky connection | Retry behavior |
| EDG-017 | Offline mode | Go offline | Offline message |
| EDG-018 | Recovery | Come back online | Auto-reconnect |

### 27.5 UI Edge Cases
| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| EDG-019 | Zoom 200% | Zoom browser | Layout intact |
| EDG-020 | Font scaling | Increase font size | Text readable |
| EDG-021 | Dark mode only | No light mode | Consistent theme |
| EDG-022 | Print view | Print page | Printable layout |

---

## Test Execution Summary

### Total Test Cases: 400+

| Category | Test Count |
|----------|------------|
| Navigation | 24 |
| Runs | 52 |
| Approvals | 26 |
| Agents | 38 |
| Tools | 42 |
| Policies | 22 |
| Security/Threats | 24 |
| Audit | 29 |
| API Keys | 33 |
| Settings | 13 |
| Analytics | 15 |
| Evals | 14 |
| Workflows | 8 |
| Overview | 8 |
| Components | 18 |
| Forms | 17 |
| Errors | 14 |
| Loading | 11 |
| Empty States | 14 |
| Real-time | 10 |
| Accessibility | 17 |
| Responsive | 11 |
| Performance | 11 |
| Security | 13 |
| Cross-browser | 7 |
| Edge Cases | 22 |

### Priority Levels

**P0 - Critical** (Block release):
- Authentication/authorization
- Run creation and viewing
- Approval workflow
- Data integrity

**P1 - High** (Should fix before release):
- All CRUD operations
- Filtering and search
- Error handling
- Loading states

**P2 - Medium** (Fix in next iteration):
- Analytics charts
- Export functionality
- Performance optimization
- Accessibility

**P3 - Low** (Nice to have):
- Animation polish
- Edge cases
- Cross-browser minor issues

---

## Playwright Test Structure

```
nextjs/tests/e2e/
├── navigation.spec.ts
├── runs/
│   ├── list.spec.ts
│   ├── detail.spec.ts
│   ├── create.spec.ts
│   └── actions.spec.ts
├── approvals/
│   ├── list.spec.ts
│   └── actions.spec.ts
├── agents/
│   ├── list.spec.ts
│   ├── detail.spec.ts
│   └── create.spec.ts
├── tools/
│   ├── list.spec.ts
│   ├── detail.spec.ts
│   └── policy.spec.ts
├── policies/
│   ├── rules.spec.ts
│   ├── budgets.spec.ts
│   └── simulator.spec.ts
├── security/
│   └── threats.spec.ts
├── audit/
│   ├── timeline.spec.ts
│   └── export.spec.ts
├── api-keys/
│   ├── list.spec.ts
│   ├── create.spec.ts
│   └── revoke.spec.ts
├── settings/
│   └── airlock.spec.ts
├── analytics/
│   └── charts.spec.ts
├── accessibility/
│   └── a11y.spec.ts
└── fixtures/
    ├── test-data.ts
    └── mock-api.ts
```

---

## Next Steps

1. Review and approve this test plan
2. Set up Playwright MCP for test execution
3. Create test fixtures with mock data
4. Execute tests by priority (P0 first)
5. Document and track test results
6. Report bugs and create issues
