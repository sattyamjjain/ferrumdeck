"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CheckCircle,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  type LucideIcon,
  Play,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { fetchApprovals } from "@/lib/api/approvals";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// =============================================================================
// Navigation Configuration
// =============================================================================

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Overview", href: "/overview", icon: LayoutDashboard },
      { title: "Runs", href: "/runs", icon: Play },
      { title: "Approvals", href: "/approvals", icon: CheckCircle, badge: true },
    ],
  },
  {
    label: "Registry",
    items: [
      { title: "Agents", href: "/agents", icon: Bot },
      { title: "Tools", href: "/tools", icon: Wrench },
      { title: "Workflows", href: "/workflows", icon: GitBranch },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Policies", href: "/policies", icon: Shield },
      { title: "Threats", href: "/threats", icon: ShieldAlert },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Analytics", href: "/analytics", icon: BarChart3 },
      { title: "Evals", href: "/evals", icon: FlaskConical },
      { title: "Audit Logs", href: "/audit", icon: ScrollText },
      { title: "Container Logs", href: "/logs", icon: Terminal },
    ],
  },
];

/** Polling interval for approvals badge count */
const APPROVALS_POLL_INTERVAL_MS = 3000;

// =============================================================================
// Helper Functions
// =============================================================================

/** Check if the current path matches a nav item */
function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// =============================================================================
// Sub-Components
// =============================================================================

interface NavItemProps {
  item: NavItem;
  pathname: string;
  pendingCount: number;
}

function NavItemComponent({ item, pathname, pendingCount }: NavItemProps) {
  const isActive = isNavItemActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className={cn(
          "relative h-9 rounded-lg transition-all duration-300 group/nav",
          isActive
            ? "bg-gradient-to-r from-accent-primary/15 to-transparent border border-accent-primary/20 shadow-[0_0_20px_rgba(0,212,255,0.1)]"
            : "hover:bg-accent/40 hover:border-border/50 border border-transparent"
        )}
      >
        <Link href={item.href} className="flex items-center gap-2.5">
          {/* Active indicator with glow */}
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent-primary shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
          )}
          {/* Icon with hover animation */}
          <Icon
            className={cn(
              "h-4 w-4 transition-all duration-300",
              isActive
                ? "text-accent-primary drop-shadow-[0_0_4px_rgba(0,212,255,0.5)]"
                : "text-foreground-muted group-hover/nav:text-foreground group-hover/nav:scale-110"
            )}
          />
          <span
            className={cn(
              "font-medium text-[13px] transition-colors duration-200",
              isActive ? "text-foreground" : "text-foreground-secondary group-hover/nav:text-foreground"
            )}
          >
            {item.title}
          </span>
          {/* Badge with pulse effect when active */}
          {item.badge && pendingCount > 0 && (
            <Badge
              className={cn(
                "ml-auto h-5 min-w-5 px-1.5 text-[10px] font-bold",
                "bg-accent-red/20 text-accent-red border-accent-red/40",
                "transition-all duration-300",
                isActive && "animate-pulse shadow-[0_0_8px_rgba(255,61,61,0.4)]"
              )}
            >
              {pendingCount}
            </Badge>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface NavGroupSectionProps {
  group: NavGroup;
  pathname: string;
  pendingCount: number;
  isFirst?: boolean;
}

function NavGroupSection({ group, pathname, pendingCount, isFirst }: NavGroupSectionProps) {
  return (
    <SidebarGroup className={isFirst ? undefined : "mt-3"}>
      <SidebarGroupLabel className="px-2 text-[9px] uppercase tracking-[0.12em] text-foreground-dim font-semibold mb-1">
        {group.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="space-y-0.5">
          {group.items.map((item) => (
            <NavItemComponent
              key={item.href}
              item={item}
              pathname={pathname}
              pendingCount={pendingCount}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function AppSidebar() {
  const pathname = usePathname();

  const { data: approvals } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: APPROVALS_POLL_INTERVAL_MS,
  });

  const pendingCount = approvals?.filter((a) => a.status === "pending").length ?? 0;
  const isSettingsActive = isNavItemActive(pathname, "/settings");

  return (
    <Sidebar className="border-r border-border/30 bg-sidebar">
      {/* Enhanced Header with gradient mesh */}
      <SidebarHeader className="border-b border-border/30 px-3 py-4 bg-gradient-mesh-subtle relative overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-grid opacity-30" />
        <Link href="/overview" className="flex items-center gap-3 group relative">
          <div className="relative">
            {/* Outer glow ring */}
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-orange-500/40 to-red-600/40 blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500" />
            {/* Logo container */}
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/20 transition-all duration-300 group-hover:scale-105 group-hover:shadow-orange-500/40">
              <Zap className="h-5 w-5 text-white transition-transform duration-300 group-hover:scale-110" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-foreground font-display">
              FerrumDeck
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-foreground-muted font-medium">
              Control Plane
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2 overflow-hidden">
        {NAV_GROUPS.map((group, index) => (
          <NavGroupSection
            key={group.label}
            group={group}
            pathname={pathname}
            pendingCount={pendingCount}
            isFirst={index === 0}
          />
        ))}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border/30 px-2 py-3 space-y-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isSettingsActive}
              className={cn(
                "h-9 rounded-lg transition-all duration-300 group/settings",
                isSettingsActive
                  ? "bg-gradient-to-r from-accent-primary/15 to-transparent border border-accent-primary/20"
                  : "hover:bg-accent/40 border border-transparent hover:border-border/50"
              )}
            >
              <Link href="/settings" className="flex items-center gap-2.5">
                <Settings
                  className={cn(
                    "h-4 w-4 transition-all duration-300",
                    isSettingsActive
                      ? "text-accent-primary"
                      : "text-foreground-muted group-hover/settings:text-foreground group-hover/settings:rotate-90"
                  )}
                />
                <span
                  className={cn(
                    "font-medium text-[13px] transition-colors",
                    isSettingsActive
                      ? "text-foreground"
                      : "text-foreground-secondary group-hover/settings:text-foreground"
                  )}
                >
                  Settings
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Version with gradient border */}
        <div className="px-3 py-2 rounded-lg bg-background/40 border border-border/30 backdrop-blur-sm">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              <span className="text-foreground-dim uppercase tracking-wider font-medium">System</span>
            </div>
            <span className="font-mono text-foreground-muted font-medium">v1.0.0</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
