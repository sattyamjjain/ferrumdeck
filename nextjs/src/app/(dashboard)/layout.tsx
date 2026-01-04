import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SkipLink } from "@/components/layout/skip-link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* Skip navigation link for keyboard accessibility */}
      <SkipLink />
      <AppSidebar />
      <SidebarInset>
        <main id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
