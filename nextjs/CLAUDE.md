# FerrumDeck Dashboard

<!-- AUTO-MANAGED: module-description -->
## Purpose

Next.js 16+ admin dashboard for the FerrumDeck AgentOps Control Plane. Provides a professional UI for monitoring runs, managing approvals, configuring agents/tools, and viewing analytics.

**Key Features**:
- Real-time run monitoring with step timeline visualization
- Approval queue with approve/reject actions
- Agent and tool registry management
- Analytics dashboard with charts
- Container logs and workflow detail pages
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
│   │   │   ├── workflows/      # Workflow detail pages
│   │   │   ├── containers/     # Container logs
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
- nuqs for URL state management

### Styling
- Tailwind CSS 4 with custom theme variables
- shadcn/ui components for consistency
- Dark theme only (no light mode toggle)
- tw-animate-css for animations

### API Calls
- BFF pattern: `/api/v1/*` routes proxy to gateway
- All API calls go through `fetchAPI` client
- Polling intervals: 2s for runs, 3s for approvals
- SSE for real-time updates

### TypeScript
- Strict mode enabled
- Prefer interfaces over types
- Export types from `/types/*` directory

### Commands
```bash
cd nextjs
npm install              # Install dependencies
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run lint             # ESLint check
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| next (16.1) | App Router, API routes, standalone output |
| react (19.2) | React with concurrent features |
| @tanstack/react-query | Server state, polling, mutations |
| @tanstack/react-table | Data tables |
| @tanstack/react-virtual | Virtualized lists |
| tailwindcss (4) | Utility-first styling |
| @radix-ui/* | Accessible component primitives |
| recharts | Analytics charts |
| lucide-react | Icon library |
| sonner | Toast notifications |
| nuqs | URL state management |
| cmdk | Command palette |
| date-fns | Date formatting |
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

## Data Fetching Patterns

### Creating a New Hook
```typescript
// hooks/use-my-data.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAPI } from "@/lib/api";

export function useMyData(id: string) {
  return useQuery({
    queryKey: ["my-data", id],
    queryFn: () => fetchAPI(`/api/v1/my-data/${id}`),
    refetchInterval: 2000,  // Poll every 2s
  });
}

export function useUpdateMyData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: MyData) =>
      fetchAPI("/api/v1/my-data", { method: "POST", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-data"] });
    },
  });
}
```

### Polling Configuration
```typescript
// Standard intervals
const POLL_INTERVALS = {
  runs: 2000,        // Active runs (fast)
  approvals: 3000,   // Approval queue
  agents: 30000,     // Agent list (slow)
};

// Conditional polling (stop when complete)
useQuery({
  queryKey: ["run", id],
  queryFn: () => fetchAPI(`/api/v1/runs/${id}`),
  refetchInterval: (query) =>
    query.state.data?.status === "completed" ? false : 2000,
});
```

### Error Handling
```typescript
// In hooks
const { data, error, isLoading } = useQuery({...});

// In components
if (error) {
  toast.error("Failed to load data");
  return <ErrorState message={error.message} />;
}
```

## Component Patterns

### Creating a New Page
```typescript
// app/(dashboard)/my-page/page.tsx
import { Suspense } from "react";
import { MyContent } from "@/components/my-page/content";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Page" description="Description here" />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <MyContent />
      </Suspense>
    </div>
  );
}
```

### Modal/Dialog Usage
```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function MyDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Open</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Title</DialogTitle>
        </DialogHeader>
        {/* Content */}
      </DialogContent>
    </Dialog>
  );
}
```

### Table with TanStack
```typescript
import { useReactTable, getCoreRowModel, flexRender } from "@tanstack/react-table";

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
});

// Render in component
<Table>
  <TableHeader>
    {table.getHeaderGroups().map(...)}
  </TableHeader>
  <TableBody>
    {table.getRowModel().rows.map(...)}
  </TableBody>
</Table>
```

## Styling Guide

### Theme Variables
```css
/* All colors use CSS variables from globals.css */
.text-foreground      /* Primary text */
.text-muted-foreground /* Secondary text */
.bg-background        /* Page background */
.bg-background-secondary /* Card background */
.border-border        /* Standard borders */
```

### Dark Theme Only
- No light mode toggle - dark theme is the only theme
- Use semantic color names, not raw values
- Status colors: `text-green-400`, `text-red-400`, `text-yellow-400`

### Animation
```typescript
import { cn } from "@/lib/utils";

// Use tw-animate-css classes
<div className={cn(
  "transition-all duration-200",
  isActive && "animate-pulse"
)} />
```

## Debugging

### Browser DevTools
```typescript
// Log query state
console.log(queryClient.getQueryData(["runs"]));

// Inspect React Query devtools (built-in)
// Press Ctrl/Cmd + Shift + D
```

### Common Issues

**Hydration Mismatch**
```typescript
// Use "use client" for interactive components
"use client";

// Or use dynamic import with ssr: false
import dynamic from "next/dynamic";
const Chart = dynamic(() => import("./chart"), { ssr: false });
```

**API Proxy Errors**
```bash
# Check gateway is running
curl http://localhost:8080/health

# Check BFF route is correct
# Routes are in app/api/v1/[...path]/route.ts
```

**Build Errors**
```bash
# Clean and rebuild
rm -rf .next
npm run build

# Check for TypeScript errors
npm run type-check
```

### Performance Optimization

**Already Enabled**
- `optimizePackageImports` for lucide-react and recharts
- Standalone output for Docker
- Server Components by default

**Virtualization for Long Lists**
```typescript
import { useVirtualizer } from "@tanstack/react-virtual";

// For lists with 100+ items
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
});
```

<!-- END MANUAL -->
