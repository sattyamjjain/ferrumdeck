"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  CheckCircle,
  Bot,
  Wrench,
  BarChart3,
  ScrollText,
  Settings,
  Key,
  Zap,
  GitBranch,
  Shield,
  LayoutDashboard,
  FlaskConical,
  Activity,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { fetchApprovals } from "@/lib/api/approvals";
import { cn } from "@/lib/utils";

const mainNavItems = [
  {
    title: "Overview",
    href: "/overview",
    icon: LayoutDashboard,
    description: "System dashboard",
  },
  {
    title: "Runs",
    href: "/runs",
    icon: Play,
    description: "Active executions",
  },
  {
    title: "Approvals",
    href: "/approvals",
    icon: CheckCircle,
    badge: true,
    description: "Pending actions",
  },
];

const registryNavItems = [
  {
    title: "Agents",
    href: "/agents",
    icon: Bot,
    description: "AI configurations",
  },
  {
    title: "Tools",
    href: "/tools",
    icon: Wrench,
    description: "Available tools",
  },
  {
    title: "Workflows",
    href: "/workflows",
    icon: GitBranch,
    description: "Orchestration",
  },
];

const governanceNavItems = [
  {
    title: "Policies",
    href: "/policies",
    icon: Shield,
    description: "Rules & budgets",
  },
];

const analyticsNavItems = [
  {
    title: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    description: "Usage metrics",
  },
  {
    title: "Evals",
    href: "/evals",
    icon: FlaskConical,
    description: "Test suites",
  },
  {
    title: "Audit Logs",
    href: "/audit",
    icon: ScrollText,
    description: "Activity trail",
  },
];

const settingsNavItems = [
  {
    title: "API Keys",
    href: "/settings/api-keys",
    icon: Key,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: 3000,
  });

  const pendingCount = approvals?.filter((a) => a.status === "pending").length || 0;

  return (
    <Sidebar className="border-r border-border/30 bg-sidebar">
      {/* Header with Logo */}
      <SidebarHeader className="border-b border-border/30 px-4 py-5">
        <Link href="/overview" className="flex items-center gap-3.5 group">
          {/* Logo container with glow effect */}
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-orange-500/30 to-red-600/30 blur-lg opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-lg transition-all duration-300 group-hover:scale-105 group-hover:shadow-orange-500/25">
              <Zap className="h-5 w-5 text-white" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold tracking-tight text-foreground">
              FerrumDeck
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-foreground-muted font-medium">
              Control Plane
            </span>
          </div>
        </Link>

        {/* System Status Indicator */}
        <div className="mt-4 flex items-center gap-2 px-1">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-accent-green" />
            <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
              System Online
            </span>
          </div>
          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-green shadow-[0_0_8px_rgba(0,255,136,0.5)]" />
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        {/* Operations Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.15em] text-foreground-dim font-semibold mb-2">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-accent/60 border border-border-active/30"
                          : "hover:bg-accent/30"
                      )}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        {/* Active indicator bar */}
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_rgba(0,212,255,0.5)]" />
                        )}
                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-accent-primary" : "text-foreground-muted"
                          )}
                        />
                        <span className={cn(
                          "font-medium text-sm",
                          isActive ? "text-foreground" : "text-foreground-secondary"
                        )}>
                          {item.title}
                        </span>
                        {item.badge && pendingCount > 0 && (
                          <Badge
                            className="ml-auto h-5 min-w-5 px-1.5 text-[10px] font-semibold bg-accent-red/15 text-accent-red border-accent-red/30 shadow-[0_0_8px_rgba(255,61,61,0.2)]"
                          >
                            {pendingCount}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Registry Section */}
        <SidebarGroup className="mt-5">
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.15em] text-foreground-dim font-semibold mb-2">
            Registry
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {registryNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-accent/60 border border-border-active/30"
                          : "hover:bg-accent/30"
                      )}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_rgba(0,212,255,0.5)]" />
                        )}
                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-accent-primary" : "text-foreground-muted"
                          )}
                        />
                        <span className={cn(
                          "font-medium text-sm",
                          isActive ? "text-foreground" : "text-foreground-secondary"
                        )}>
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Governance Section */}
        <SidebarGroup className="mt-5">
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.15em] text-foreground-dim font-semibold mb-2">
            Governance
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {governanceNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-accent/60 border border-border-active/30"
                          : "hover:bg-accent/30"
                      )}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_rgba(0,212,255,0.5)]" />
                        )}
                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-accent-primary" : "text-foreground-muted"
                          )}
                        />
                        <span className={cn(
                          "font-medium text-sm",
                          isActive ? "text-foreground" : "text-foreground-secondary"
                        )}>
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Insights Section */}
        <SidebarGroup className="mt-5">
          <SidebarGroupLabel className="px-2 text-[10px] uppercase tracking-[0.15em] text-foreground-dim font-semibold mb-2">
            Insights
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analyticsNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "relative h-10 rounded-lg transition-all duration-200",
                        isActive
                          ? "bg-accent/60 border border-border-active/30"
                          : "hover:bg-accent/30"
                      )}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_rgba(0,212,255,0.5)]" />
                        )}
                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-accent-primary" : "text-foreground-muted"
                          )}
                        />
                        <span className={cn(
                          "font-medium text-sm",
                          isActive ? "text-foreground" : "text-foreground-secondary"
                        )}>
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border/30 px-2 py-3">
        <SidebarMenu>
          {settingsNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className={cn(
                    "h-9 rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-accent/60 border border-border-active/30"
                      : "hover:bg-accent/30"
                  )}
                >
                  <Link href={item.href} className="flex items-center gap-3">
                    <item.icon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive ? "text-accent-primary" : "text-foreground-muted"
                      )}
                    />
                    <span className={cn(
                      "font-medium text-sm",
                      isActive ? "text-foreground" : "text-foreground-secondary"
                    )}>
                      {item.title}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>

        {/* Version indicator */}
        <div className="mt-3 px-3 py-2 rounded-lg bg-background/50 border border-border/30">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-foreground-dim uppercase tracking-wider">Version</span>
            <span className="font-mono text-foreground-muted">v1.0.0</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
