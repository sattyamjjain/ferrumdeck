import { Compass, Home, ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-60" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-accent-purple/10 via-accent-primary/5 to-transparent blur-3xl" />

      {/* Floating decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-accent-primary/30 animate-float" />
      <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 rounded-full bg-accent-purple/40 animate-float" style={{ animationDelay: '1s' }} />
      <div className="absolute bottom-1/3 left-1/3 w-1 h-1 rounded-full bg-accent-cyan/50 animate-float" style={{ animationDelay: '2s' }} />

      <div className="relative flex flex-col items-center gap-8 max-w-md text-center reveal-up">
        {/* 404 Display */}
        <div className="relative">
          {/* Outer glow */}
          <div className="absolute inset-0 text-[140px] font-black text-accent-purple/10 blur-xl font-display">
            404
          </div>
          {/* Main text with gradient */}
          <div className="relative text-[120px] font-black tracking-tighter font-display bg-gradient-to-br from-accent-purple via-accent-primary to-accent-cyan bg-clip-text text-transparent leading-none">
            404
          </div>
          {/* Sparkle decoration */}
          <Sparkles className="absolute -top-2 -right-4 h-6 w-6 text-accent-primary/60 animate-pulse" />
        </div>

        {/* Icon */}
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-purple/30 to-accent-primary/20 blur-xl opacity-60" />
          <div className="relative flex items-center justify-center h-20 w-20 rounded-2xl bg-gradient-to-br from-accent-purple/15 to-accent-primary/10 border border-accent-purple/20 backdrop-blur-sm">
            <Compass className="h-10 w-10 text-accent-purple animate-spin-slow" />
          </div>
        </div>

        {/* Text content */}
        <div className="space-y-3 reveal-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-2xl font-bold text-foreground font-display tracking-tight">
            Lost in the void
          </h2>
          <p className="text-foreground-muted leading-relaxed">
            The page you&apos;re looking for seems to have drifted into deep space.
            Let&apos;s get you back on course.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4 reveal-up" style={{ animationDelay: '200ms' }}>
          <Button
            variant="outline"
            size="lg"
            asChild
            className="magnetic-hover bg-background-secondary/50 backdrop-blur-sm border-border/50 hover:border-accent-purple/30 hover:bg-background-secondary gap-2"
          >
            <Link href="javascript:history.back()">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Link>
          </Button>
          <Button
            size="lg"
            asChild
            className="magnetic-hover bg-gradient-to-r from-accent-purple to-accent-primary text-white hover:opacity-90 gap-2 shadow-lg shadow-accent-purple/20"
          >
            <Link href="/overview">
              <Home className="h-4 w-4" />
              Return Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
