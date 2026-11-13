// Light, dark or the system's theme: the browser's choice, kept in
// localStorage and set as Nuxt UI's `.dark` on <html>. The middleware's head script applies it before the first paint; this
// changes it and follows the system while "system" is chosen.
import { onMounted, onUnmounted, ref } from "vue"

export type Theme = "light" | "dark" | "system"

/** Also in middleware/01.session.ts's head script. */
export const THEME_KEY = "app:theme"
const media = () => matchMedia("(prefers-color-scheme: dark)")

const read = (): Theme => {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === "light" || t === "dark" ? t : "system"
  } catch {
    return "system"
  }
}

const apply = (t: Theme) => {
  const dark = t === "dark" || (t === "system" && media().matches)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

/** The chosen theme, and a setter. "system" until mounted, so SSR and hydration agree. */
export const useTheme = () => {
  const theme = ref<Theme>("system")
  const follow = () => theme.value === "system" && apply("system")
  onMounted(() => {
    theme.value = read()
    media().addEventListener("change", follow)
  })
  onUnmounted(() => media().removeEventListener("change", follow))
  const set = (t: Theme) => {
    theme.value = t
    try {
      if (t === "system") localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, t)
    } catch {
      // Storage blocked (a private window): the theme holds for this page only.
    }
    apply(t)
  }
  return { theme, set }
}
