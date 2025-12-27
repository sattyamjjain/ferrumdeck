# FerrumDeck Dashboard

<!-- AUTO-MANAGED: module-description -->
## Purpose

Next.js 14+ admin dashboard for the FerrumDeck AgentOps Control Plane. Provides a professional UI for monitoring runs, managing approvals, configuring agents/tools, and viewing analytics.

**Key Features**:
- Real-time run monitoring with step timeline visualization
- Approval queue with approve/reject actions
- Agent and tool registry management
- Analytics dashboard with charts
- GitHub-like dark theme

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
nextjs/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (dashboard)/        # Dashboard layout group
│   │   │   ├── runs/           # Run list and detail pages
│   │   │   ├── approvals/      # Approval queue
│   │   │   ├── agents/         # Agent registry
│   │   │   ├── tools/          # Tool registry
│   │   │   ├── analytics/      # Usage charts
│   │   │   └── settings/       # Configuration
│   │   ├── api/v1/             # BFF API proxy routes
│   │   ├── layout.tsx          # Root layout with providers
│   │   └── page.tsx            # Redirect to /runs
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── layout/             # Sidebar, header
│   │   ├── runs/               # Run list, detail, timeline
│   │   ├── approvals/          # Approval cards
│   │   ├── agents/             # Agent cards
│   │   ├── tools/              # Tool cards
│   │   ├── charts/             # Analytics charts
│   │   └── shared/             # JSON viewer, loaders
│   │
│   ├── hooks/                  # Custom React hooks
│   │   ├── use-runs.ts         # useRuns, useRun, useSteps
│   │   ├── use-approvals.ts    # useApprovals, useApprove
│   │   ├── use-agents.ts       # useAgents, useAgent
│   │   └── use-tools.ts        # useTools
│   │
│   ├── lib/
│   │   ├── api/                # API client functions
│   │   └── utils.ts            # Formatting utilities
│   │
│   └── types/                  # TypeScript interfaces
│       ├── run.ts              # Run, Step, Budget
│       ├── approval.ts         # ApprovalRequest
│       ├── agent.ts            # Agent, AgentVersion
│       └── tool.ts             # Tool
│
├── Dockerfile                  # Multi-stage production build
├── next.config.ts              # Standalone output config
└── tailwind.config.ts          # Dark theme configuration
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Component Structure
- Use `"use client"` directive for interactive components
- Colocate hooks with components that use them
- Prefer composition over configuration

### State Management
- TanStack Query for server state with polling
- Local state for UI interactions (filters, dialogs)
- No global state store needed

### Styling
- Tailwind CSS with custom theme variables
- shadcn/ui components for consistency
- Dark theme only (no light mode toggle)

### API Calls
- BFF pattern: `/api/v1/*` routes proxy to gateway
- All API calls go through `fetchAPI` client
- Polling intervals: 2s for runs, 3s for approvals

### TypeScript
- Strict mode enabled
- Prefer interfaces over types
- Export types from `/types/*` directory

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| next | App Router, API routes, standalone output |
| @tanstack/react-query | Server state, polling, mutations |
| tailwindcss | Utility-first styling |
| @radix-ui/* | Accessible component primitives |
| recharts | Analytics charts |
| lucide-react | Icon library |
| sonner | Toast notifications |
| clsx + tailwind-merge | Class name utilities |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Development Notes

### Running Locally
```bash
cd nextjs
npm install
npm run dev
```

### Environment Variables
```env
GATEWAY_URL=http://localhost:8080
FD_API_KEY=fd_dev_key_abc123
```

### Building Docker Image
```bash
docker build -t ferrumdeck-dashboard .
docker run -p 3000:3000 -e GATEWAY_URL=http://gateway:8080 ferrumdeck-dashboard
```

<!-- END MANUAL -->
