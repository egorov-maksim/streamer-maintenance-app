/**
 * Role-based page routing: where a signed-in user must go, if not the current page.
 * Returns the path to redirect to, or null to stay.
 */
export function redirectTarget(role, pathname) {
  if (role === "supervisor") {
    return pathname === "/overview" ? null : "/overview";
  }
  if (pathname === "/overview" && role !== "grandsuperuser") {
    return "/";
  }
  return null;
}
