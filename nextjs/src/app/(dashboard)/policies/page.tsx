"use client";

import { useState } from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { Shield, Plus, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PolicyCard } from "@/components/policies/policy-card";
import { BudgetTable } from "@/components/policies/budget-table";
import { PolicySimulator } from "@/components/policies/policy-simulator";
import { usePolicies, useBudgets, useDeletePolicy, useDuplicatePolicy, useDeleteBudget } from "@/hooks/use-policies";
import { useAdmin } from "@/hooks/use-admin";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import type { Policy, Budget } from "@/types/policy";
import { toast } from "sonner";

function PoliciesTab() {
  const { data: policies, isLoading, refetch, isRefetching } = usePolicies();
  const deletePolicy = useDeletePolicy();
  const duplicatePolicy = useDuplicatePolicy();
  const isAdmin = useAdmin();

  const handleEdit = (policy: Policy) => {
    // TODO: Open edit dialog
    toast.info(`Edit policy: ${policy.name}`);
  };

  const handleDuplicate = async (policy: Policy) => {
    await duplicatePolicy.mutateAsync(policy.id);
  };

  const handleDelete = async (policy: Policy) => {
    if (confirm(`Are you sure you want to delete "${policy.name}"?`)) {
      await deletePolicy.mutateAsync(policy.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!policies || policies.length === 0) {
    return (
      <EmptyState
        icon={Shield}
        title="No policies configured"
        description="Create a policy to define access rules for your agents and tools"
        actionLabel="Create Policy"
        onAction={() => toast.info("Create policy dialog coming soon")}
      />
    );
  }

  // Sort by priority (highest first)
  const sortedPolicies = [...policies].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {policies.length} polic{policies.length !== 1 ? "ies" : "y"} configured.
          Policies are evaluated in priority order (highest first).
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {sortedPolicies.map((policy) => (
          <PolicyCard
            key={policy.id}
            policy={policy}
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </div>
  );
}

function BudgetsTab() {
  const { data: budgets, isLoading, refetch, isRefetching } = useBudgets();
  const deleteBudget = useDeleteBudget();
  const isAdmin = useAdmin();

  const handleEdit = (budget: Budget) => {
    // TODO: Open edit dialog
    toast.info(`Edit budget: ${budget.name}`);
  };

  const handleDelete = async (budget: Budget) => {
    if (confirm(`Are you sure you want to delete "${budget.name}"?`)) {
      await deleteBudget.mutateAsync(budget.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {budgets?.length || 0} budget{budgets?.length !== 1 ? "s" : ""} configured.
          Budgets enforce spending and usage limits.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <BudgetTable
        budgets={budgets || []}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function SimulatorTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Test your policy configuration by simulating policy decisions with different parameters.
      </p>
      <PolicySimulator />
    </div>
  );
}

export default function PoliciesPage() {
  // Hydration fix - ensure client-only rendering for Radix components
  const mounted = useIsMounted();

  const [activeTab, setActiveTab] = useState("rules");

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <Shield className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Policies & Budgets</h1>
              <p className="text-sm text-muted-foreground">
                Define access rules and resource limits for agent governance
              </p>
            </div>
          </div>
          <Button onClick={() => toast.info("Create dialog coming soon")}>
            <Plus className="h-4 w-4 mr-2" />
            Create
          </Button>
        </div>
      </div>

      {/* Tabs */}
      {mounted && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="budgets">Budgets</TabsTrigger>
            <TabsTrigger value="simulator">Simulator</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-6">
            <PoliciesTab />
          </TabsContent>

          <TabsContent value="budgets" className="mt-6">
            <BudgetsTab />
          </TabsContent>

          <TabsContent value="simulator" className="mt-6">
            <SimulatorTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
