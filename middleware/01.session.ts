// Everything but the sign-in pages needs a signed-in user: page views without
// one go to /sign-in, the API answers 401. Behind Access there is always one
// (auth.ts). Every page gets the user and where signing out goes as shared
// data (useShared() in pages/layout.vue).
import { defineMiddleware } from "void"
import { getSession } from "void/auth"
import { signOutPath, viaAccess } from "../lib/cloudflare-access.ts"
import { isAdmin } from "../lib/admin.ts"
import { appProps } from "../lib/props.ts"

declare module "void" {
  interface CloudContextVariables {
    shared: {
      user: { name: string; email: string } | null
      /** The page's path, for the sidebar's current item and the breadcrumb. */
      path: string
      /** A record page's title for the breadcrumb, set by its loader (lib/pages.ts, crumb). */
      crumb: string | null
      /** Where the sign-out button goes afterwards: Access's logout behind Access. */
      signOut: string
      /** Whether Access signs people in: then there are no sign-in pages or passwords. */
      viaAccess: boolean
      /** A super admin (lib/admin.ts): the sidebar shows Admin. */
      isAdmin: boolean
    }
  }
}

const open = ["/sign-in", "/sign-up"]

// Before the first paint: the theme (src/theme.ts) and the expanded sidebar
// (src/sidebar.ts) on <html>, so dark pages don't flash light nor the sidebar
// jump open.
const head = `try{var t=localStorage.getItem("app:theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;if(d)h.classList.add("dark");h.style.colorScheme=d?"dark":"light";if(localStorage.getItem("app:sidebar")==="expanded")h.dataset.sidebar="expanded"}catch(e){}`

// Not c.redirect(): Void appends the request's query string to its location.
const to = (location: string) => new Response(null, { status: 302, headers: { location } })

export default defineMiddleware(async (c, next) => {
  const path = c.req.path
  // Auth and Void's own endpoints answer for themselves, the client build
  // (/assets/) is static, and app calls carry props.
  // Behind Access all of them still need its token (00.cloudflare-access.ts).
  if (appProps(c) || path.startsWith("/api/auth/") || path.startsWith("/__") || path.startsWith("/assets/")) return next()

  const session = getSession()
  if (!session) {
    if (path.startsWith("/api/")) return Response.json({ error: "Sign in first." }, { status: 401 })
    if (!open.includes(path)) {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("Sign in first.", 401)
      const back = path + new URL(c.req.url).search
      return to(path === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(back)}`)
    }
  } else if (open.includes(path)) return to("/")

  c.set("shared", {
    user: session ? { name: session.user.name, email: session.user.email.toLowerCase() } : null,
    path,
    crumb: null,
    signOut: signOutPath(),
    viaAccess: viaAccess(),
    isAdmin: isAdmin(),
  })
  c.set("headDefaults", { htmlAttrs: { lang: "en" }, script: [{ innerHTML: head }] })
  await next()
})
