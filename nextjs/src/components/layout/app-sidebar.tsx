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
  Zap,
  GitBranch,
  Shield,
  LayoutDashboard,
  FlaskConical,
  Terminal,
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
  { title: "Overview", href: "/overview", icon: LayoutDashboard },
  { title: "Runs", href: "/runs", icon: Play },
  { title: "Approvals", href: "/approvals", icon: CheckCircle, badge: true },
];

const registryNavItems = [
  { title: "Agents", href: "/agents", icon: Bot },
  { title: "Tools", href: "/tools", icon: Wrench },
  { title: "Workflows", href: "/workflows", icon: GitBranch },
];

const governanceNavItems = [
  { title: "Policies", href: "/policies", icon: Shield },
];

const insightsNavItems = [
  { title: "Analytics", href: "/analytics", icon: BarChart3 },
  { title: "Evals", href: "/evals", icon: FlaskConical },
  { title: "Audit Logs", href: "/audit", icon: ScrollText },
  { title: "Container Logs", href: "/logs", icon: Terminal },
];

export function AppSidebar() {
  const pathname = usePathname();

  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: 3000,
  });

  const pendingCount = approvals?.filter((a) => a.status === "pending").length || 0;

  const NavItem = ({ item, badge }: { item: typeof mainNavItems[0]; badge?: boolean }) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          className={cn(
            "relative h-8 rounded-md transition-all duration-200",
            isActive
              ? "bg-accent/60 border border-border-active/30"
              : "hover:bg-accent/30"
          )}
        >
          <Link href={item.href} className="flex items-center gap-2.5">
            {isActive && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-accent-primary" />
            )}
            <item.icon
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                isActive ? "text-accent-primary" : "text-foreground-muted"
              )}
            />
            <span className={cn(
              "font-medium text-[13px]",
              isActive ? "text-foreground" : "text-foreground-secondary"
            )}>
              {item.title}
            </span>
            {badge && pendingCount > 0 && (
              <Badge className="ml-auto h-4 min-w-4 px-1 text-[9px] font-semibold bg-accent-red/15 text-accent-red border-accent-red/30">
                {pendingCount}
              </Badge>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="border-r border-border/30 bg-sidebar">
      {/* Compact Header */}
      <SidebarHeader className="border-b border-border/30 px-3 py-3">
        <Link href="/overview" className="flex items-center gap-2.5 group">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-orange-500/30 to-red-600/30 blur-md opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600 shadow-md transition-all duration-300 group-hover:scale-105">
              <Zap className="h-4 w-4 text-white" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              FerrumDeck
            </span>
            <span className="text-[9px] uppercase tracking-[0.15em] text-foreground-muted font-medium">
              Control Plane
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2 overflow-hidden">
        {/* Operations */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[9px] uppercase tracking-[0.12em] text-foreground-dim font-semibold mb-1">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {mainNavItems.map((item) => (
                <NavItem key={item.href} item={item} badge={item.badge} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Registry */}
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel className="px-2 text-[9px] uppercase tracking-[0.12em] text-foreground-dim font-semibold mb-1">
            Registry
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {registryNavItems.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Governance */}
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel className="px-2 text-[9px] uppercase tracking-[0.12em] text-foreground-dim font-semibold mb-1">
            Governance
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {governanceNavItems.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Insights */}
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel className="px-2 text-[9px] uppercase tracking-[0.12em] text-foreground-dim font-semibold mb-1">
            Insights
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {insightsNavItems.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Compact Footer */}
      <SidebarFooter className="border-t border-border/30 px-2 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/settings" || pathname.startsWith("/settings/")}
              className={cn(
                "h-8 rounded-md transition-all duration-200",
                pathname === "/settings" || pathname.startsWith("/settings/")
                  ? "bg-accent/60 border border-border-active/30"
                  : "hover:bg-accent/30"
              )}
            >
              <Link href="/settings" className="flex items-center gap-2.5">
                <Settings
                  className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    pathname === "/settings" || pathname.startsWith("/settings/")
                      ? "text-accent-primary"
                      : "text-foreground-muted"
                  )}
                />
                <span className={cn(
                  "font-medium text-[13px]",
                  pathname === "/settings" || pathname.startsWith("/settings/")
                    ? "text-foreground"
                    : "text-foreground-secondary"
                )}>
                  Settings
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Version */}
        <div className="mt-2 px-2 py-1.5 rounded-md bg-background/50 border border-border/30">
          <div className="flex items-center justify-between text-[9px]">
            <span className="text-foreground-dim uppercase tracking-wider">Version</span>
            <span className="font-mono text-foreground-muted">v1.0.0</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
