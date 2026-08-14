# FerrumDeck Dashboard

<!-- AUTO-MANAGED: module-description -->
## Purpose

Admin UI for the control plane: runs and steps, agents and tools, policies and promotions, approvals, audit trail,
security/threat views, evals, and workflows. Runs as a BFF — the browser never talks to the gateway directly;
Next.js route handlers proxy to it server-side so the API key stays on the server.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
nextjs/src/
├── app/
│   ├── (dashboard)/          # Route group — overview, runs, agents, tools, policies,
│   │                         #   approvals, audit, logs, evals, workflows, threats,
│   │                         #   analytics, settings
│   ├── api/
│   │   ├── v1/               # BFF proxy — explicit per-resource route.ts files:
│   │   │                     #   runs/[runId]/{steps,cancel,training-signal}, approvals,
│   │   │                     #   policies, budgets, audit, api-keys, workflows,
│   │   │                     #   workflow-runs, promotions, harness-suggestions,
│   │   │                     #   evals/{suites,runs,regression-report}, security/*, docker/*
│   │   ├── sse/[channel]/    # Server-sent events
│   │   └── health/
│   ├── layout.tsx · page.tsx · globals.css
├── components/               # One dir per domain: runs, agents, approvals, policies,
│                             #   audit, logs, evals, workflows, security, tools, overview,
│                             #   charts, layout, providers, shared, accessibility, ui (shadcn)
├── hooks/                    # use-<resource>.ts TanStack Query hooks + use-is-mounted, use-mobile
├── lib/
│   ├── api/                  # Typed gateway clients (client.ts + per-resource modules)
│   ├── realtime/             # channels, subscription-manager, use-subscription, mock-events
│   ├── config/query-config.ts · evals/suite-loader.ts
│   └── query-client.ts · type-guards.ts · utils.ts
└── types/                    # One file per domain entity, re-exported from index.ts
```

Ports: dev server on **3001** (`next dev --port 3001`); the container maps `3001:3000`.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

- Next.js 16 App Router + React 19. Server Components by default; add `"use client"` only where interactivity
  or hooks require it.
- **BFF boundary is a trust boundary.** Add a new gateway resource as an explicit `route.ts` under
  `src/app/api/v1/`, not a catch-all. `GATEWAY_URL` and `FD_API_KEY` are server-only — never expose them to the client.
- **Never fabricate data.** Mock/SSE generators (`lib/realtime/mock-events.ts`) stay opt-in and off by default;
  a governance event shown in the UI must have come from the gateway.
- Server state via TanStack Query — one `use-<resource>.ts` hook per domain, intervals centralized in
  `lib/config/query-config.ts`. URL state via `nuqs`. Toasts via `sonner`.
- Types live in `src/types/<entity>.ts` and are re-exported through `types/index.ts`; validate unknown payloads
  with helpers in `lib/type-guards.ts` rather than casting.
- TypeScript strict; avoid `any`. Tailwind 4 via `@tailwindcss/postcss`, tokens as CSS variables in `globals.css`;
  compose class names with `cn()`. UI primitives are shadcn/ui on Radix under `components/ui/`.
- Long lists use `@tanstack/react-virtual`; tables use `@tanstack/react-table`; charts use `recharts`.
- Verify with `npm run lint`, `npm test`, and `npx tsc --noEmit`. Jest coverage thresholds are intentionally not enforced.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Area | Package |
|---|---|
| Framework | `next` 16.1, `react` / `react-dom` 19.2 |
| Server state | `@tanstack/react-query` |
| Tables / virtualization | `@tanstack/react-table`, `@tanstack/react-virtual` |
| UI primitives | `@radix-ui/*` (dialog, dropdown-menu, select, tabs, tooltip, popover, switch, checkbox, avatar, scroll-area, separator, label, slot, alert-dialog) |
| Styling | `tailwindcss` 4, `@tailwindcss/postcss`, `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge` |
| Icons / charts | `lucide-react`, `recharts` |
| UX | `sonner` (toasts), `cmdk` (command palette), `nuqs` (URL state), `next-themes` |
| Data | `date-fns`, `js-yaml` |
| Tooling | `eslint` 9 + `eslint-config-next`, `jest` 29 + `@testing-library/*`, `ts-jest`, `jest-junit`, `typescript` 5 |

Environment: `GATEWAY_URL` (default `http://localhost:8080`) and `FD_API_KEY`, both server-side only.

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
# Each resource has its own file: src/app/api/v1/<resource>/route.ts
# (no [...path] catch-all — a missing route means you need to add one)
```

**Build Errors**
```bash
# Clean and rebuild
rm -rf .next
npm run build

# Check for TypeScript errors (no type-check script defined)
npx tsc --noEmit
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
