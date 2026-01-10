/**
 * Admin authorization hook.
 *
 * This hook determines if the current user has admin privileges.
 * In production, this should be connected to your auth system.
 *
 * Configuration options (in order of precedence):
 * 1. NEXT_PUBLIC_ADMIN_ENABLED environment variable
 * 2. Future: API call to check user permissions
 * 3. Default: true in development, false in production
 */
export function useAdmin(): boolean {
  // Check environment variable first
  const envAdminEnabled = process.env.NEXT_PUBLIC_ADMIN_ENABLED;

  if (envAdminEnabled !== undefined) {
    return envAdminEnabled === "true" || envAdminEnabled === "1";
  }

  // Default behavior: enabled in development, disabled in production
  // This ensures production deployments are secure by default
  const isDevelopment = process.env.NODE_ENV === "development";

  return isDevelopment;
}
