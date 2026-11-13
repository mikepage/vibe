// The sidebar collapsed to its icons, or expanded with the labels: the
// browser's choice, kept in localStorage and set on <html data-sidebar> (the
// shell's styles key on it). The middleware's head script applies it before
// the first paint, as it does the theme (src/theme.ts).
import { onMounted, ref } from "vue"

/** Also in middleware/01.session.ts's head script. */
export const SIDEBAR_KEY = "app:sidebar"

const apply = (expanded: boolean) => {
  if (expanded) document.documentElement.dataset["sidebar"] = "expanded"
  else delete document.documentElement.dataset["sidebar"]
}

/** Whether the sidebar is expanded, and a toggle. Collapsed until mounted, so SSR and hydration agree. */
export const useSidebar = () => {
  const expanded = ref(false)
  onMounted(() => (expanded.value = document.documentElement.dataset["sidebar"] === "expanded"))
  const toggle = () => {
    expanded.value = !expanded.value
    try {
      if (expanded.value) localStorage.setItem(SIDEBAR_KEY, "expanded")
      else localStorage.removeItem(SIDEBAR_KEY)
    } catch {
      // Storage blocked (a private window): the choice holds for this page only.
    }
    apply(expanded.value)
  }
  return { expanded, toggle }
}
