<script setup lang="ts">
// The signed-in frame: the sidebar navigation on the left, collapsed to icons
// until its toggle expands it (src/sidebar.ts); a top bar with where the page
// is (a breadcrumb) and the user menu (theme, sign out); the page below.
// Below 64rem the sidebar moves into a slideover behind a menu button.
// Signed out, only the page.
//
// The stylesheet (Tailwind and Nuxt UI) is imported here, so Void lists it in
// the SSR <head> and every page is styled before hydration. UApp provides
// what Nuxt UI's overlays and tooltips need.
import "../src/app.css"

import icons from "@nuxt/ui/runtime/vue/plugins/icons.js"
import { Link, useShared } from "@void/vue"
import { computed, ref, watch } from "vue"
import SidebarNav from "../src/components/SidebarNav.vue"
import UserMenu from "../src/components/UserMenu.vue"
import { navFor, navItemOf } from "../src/nav.ts"
import { useSidebar } from "../src/sidebar.ts"

// Registers the Lucide icons the Vite plugin bundled, so UIcon draws them on
// the server too, with no requests to Iconify. (Nuxt UI's Vue plugin does this
// with app.use(); Void creates the app itself.)
icons.install()

const shared = useShared()
const { expanded, toggle: toggleSidebar } = useSidebar()
const menuOpen = ref(false)
const nav = computed(() => navFor(shared.isAdmin))

/** The list a page is under, then the page: "Apps › Reading list". */
const crumbs = computed(() => {
  const item = navItemOf(shared.path)
  if (!item) return shared.crumb ? [{ label: shared.crumb }] : []
  if (shared.path === item.href) return [{ label: item.label }]
  return [{ label: item.label, href: item.href }, ...(shared.crumb ? [{ label: shared.crumb }] : [])]
})

// Going to another page closes the menu.
watch(
  () => shared.path,
  () => (menuOpen.value = false),
)
</script>

<template>
  <UApp>
    <div v-if="shared.user" class="flex min-h-svh bg-default text-default">
      <aside class="sidebar sticky top-0 flex h-svh shrink-0 flex-col border-e border-default bg-elevated/40 px-3 py-3 max-lg:hidden">
        <Link href="/" class="flex items-center gap-2 rounded-md px-2.5 py-2 font-semibold text-highlighted">
          <UIcon name="i-lucide-sparkles" class="size-5 shrink-0 text-primary" />
          <span class="brand-name">Vibe</span>
        </Link>
        <SidebarNav :items="nav" :path="shared.path" class="mt-4 flex-1" />
        <button type="button" class="nav-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-elevated hover:text-highlighted" :aria-expanded="expanded" @click="toggleSidebar()">
          <UIcon name="i-lucide-chevrons-right" class="sidebar-toggle-icon size-5 shrink-0" />
          <span class="nav-label">{{ expanded ? "Collapse" : "Expand" }}</span>
        </button>
      </aside>
      <div class="panel flex min-w-0 flex-1 flex-col">
        <header class="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-default bg-default/90 px-6 py-2 backdrop-blur max-sm:px-4">
          <USlideover v-model:open="menuOpen" side="left" title="Vibe" :ui="{ content: 'max-w-72 sm:max-w-72' }">
            <UButton icon="i-lucide-menu" color="neutral" variant="ghost" aria-label="Menu" class="lg:hidden" />
            <template #body>
              <SidebarNav :items="nav" :path="shared.path" labels />
            </template>
          </USlideover>
          <nav aria-label="Breadcrumb" class="min-w-0 flex-1">
            <ol class="flex min-w-0 items-center gap-1.5 text-sm">
              <li class="flex">
                <Link href="/" class="flex text-muted hover:text-default"><UIcon name="i-lucide-house" class="size-4" /><span class="sr-only">Apps</span></Link>
              </li>
              <li v-for="(item, i) in crumbs" :key="i" class="flex min-w-0 items-center gap-1.5">
                <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
                <Link v-if="item.href" :href="item.href" class="truncate font-medium text-muted hover:text-default">{{ item.label }}</Link>
                <span v-else class="truncate font-medium text-highlighted" aria-current="page">{{ item.label }}</span>
              </li>
            </ol>
          </nav>
          <UserMenu :user="shared.user" />
        </header>
        <main class="flex flex-1 flex-col gap-6 px-6 pt-10 pb-6 max-sm:px-4 has-[>.workspace]:min-h-0 has-[>.workspace]:p-0"><slot /></main>
      </div>
    </div>
    <main v-else class="grid min-h-svh place-items-center bg-default p-4 text-default"><slot /></main>
  </UApp>
</template>
