// Small helpers for the pages' loaders.

/** A same-origin path to go back to after signing in. */
export const safeNext = (value: string | undefined) => (value?.startsWith("/") && !value.startsWith("//") ? value : "/")

/**
 * The record's title as the breadcrumb's last item. The layout renders before
 * the page and only sees the shared data, so a loader adds it there. Void
 * takes the shared object before the loader runs, so this changes that
 * object rather than setting a new one.
 */
export const crumb = (c: { get(key: "shared"): { crumb: string | null } | undefined }, title: string) => {
  const shared = c.get("shared")
  if (shared) shared.crumb = title
}
