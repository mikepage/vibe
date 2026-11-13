// The sidebar's items. Add a page here when you add one to pages/.
export interface NavItem {
  href: string
  label: string
  /** A Lucide icon, as Nuxt UI names it. */
  icon: string
}

export const nav: NavItem[] = [
  { href: "/", label: "Apps", icon: "i-lucide-boxes" },
  { href: "/teams", label: "Teams", icon: "i-lucide-users" },
  { href: "/admin", label: "Admin", icon: "i-lucide-shield" },
]

/** The items a user sees: Admin only for super admins. */
export const navFor = (isAdmin: boolean) => nav.filter((n) => isAdmin || n.href !== "/admin")

/** The nav item a path is under: an app's page (/build/…) is under Apps. */
export const navItemOf = (path: string) =>
  path.startsWith("/build/") ? nav[0] : nav.find((n) => path === n.href || (n.href !== "/" && path.startsWith(`${n.href}/`)))
