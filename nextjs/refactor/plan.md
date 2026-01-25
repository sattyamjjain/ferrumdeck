# Refactor Plan - 2026-01-26

## Session ID: refactor_2026_01_26_mounted_hook

## Initial State Analysis

### Current Architecture
The codebase uses a repeated pattern for handling SSR/hydration issues with Radix UI components:

```typescript
const [mounted, setMounted] = useState(false);
// eslint-disable-next-line react-hooks/set-state-in-effect
useEffect(() => setMounted(true), []);
```

This pattern appears in **10 files** and requires eslint-disable comments in each location.

### Problem Areas
1. **Code Duplication**: Same 3-line pattern repeated across 10 files
2. **ESLint Overrides**: 10+ `react-hooks/set-state-in-effect` suppressions
3. **Inconsistency**: Some use `queueMicrotask`, others don't
4. **Maintainability**: Changes to the pattern require updating all files

### Files Affected
1. `src/components/runs/runs-console.tsx:119-123`
2. `src/components/tools/tool-filters.tsx:47-49`
3. `src/components/tools/create-tool-dialog.tsx:70-74`
4. `src/components/agents/create-agent-dialog.tsx:44-46`
5. `src/components/runs/create-run-dialog.tsx:31-34`
6. `src/app/(dashboard)/policies/page.tsx:160-162`
7. `src/app/(dashboard)/audit/page.tsx:397-399`
8. `src/app/(dashboard)/threats/page.tsx:90-92`
9. `src/app/(dashboard)/settings/api-keys/page.tsx:104-106`
10. `src/app/(dashboard)/evals/page.tsx:96-99`

### Test Coverage
- No direct tests for mounted state pattern
- Components use mounted state for conditional rendering only

## Refactoring Tasks

### Task 1: Create `useIsMounted` Hook [LOW RISK]
- **Action**: Create new hook in `src/hooks/use-is-mounted.ts`
- **Pattern**: Returns boolean indicating client-side mount status
- **Risk**: Low - additive change, no existing code modified

### Task 2: Update `runs-console.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 3: Update `tool-filters.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 4: Update `create-tool-dialog.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 5: Update `create-agent-dialog.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 6: Update `create-run-dialog.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 7: Update `policies/page.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 8: Update `audit/page.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 9: Update `threats/page.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 10: Update `api-keys/page.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 11: Update `evals/page.tsx` [LOW RISK]
- **Action**: Replace inline pattern with `useIsMounted()` hook
- **Risk**: Low - simple replacement

### Task 12: Final Validation [VALIDATION]
- **Action**: Run build and lint to verify no regressions
- **Risk**: None - validation only

## Validation Checklist
- [x] New hook created with proper documentation
- [x] All 10 files updated to use new hook
- [x] All eslint-disable comments removed (10 removed)
- [x] Build passes
- [x] Lint passes (0 errors)
- [x] No orphaned code

## De-Para Mapping

| Before | After | Status |
|--------|-------|--------|
| `const [mounted, setMounted] = useState(false)` | `const mounted = useIsMounted()` | **Complete** |
| `// eslint-disable-next-line react-hooks/set-state-in-effect` | (removed) | **Complete** |
| `useEffect(() => setMounted(true), [])` | (removed) | **Complete** |

## Expected Outcomes
- **Lines removed**: ~30 (3 lines x 10 files)
- **Lines added**: ~25 (20-line hook + 1 line per file)
- **ESLint overrides removed**: 10
- **Maintainability**: Centralized logic for future updates
