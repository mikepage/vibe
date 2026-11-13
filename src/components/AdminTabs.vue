<script setup lang="ts">
// The admin view's sections, as a row of links under its title, drawn like
// Nuxt UI's pill Tabs. Void's Link, so switching doesn't reload.
import { Link, useShared } from "@void/vue"

const shared = useShared()
const tabs = [
  { href: "/admin", label: "Apps" },
  { href: "/admin/teams", label: "Teams" },
  { href: "/admin/users", label: "Users" },
]
const current = (href: string) => (href === "/admin" ? shared.path === "/admin" || shared.path.startsWith("/admin/apps") : shared.path.startsWith(href))
</script>

<template>
  <nav class="flex w-fit gap-1 rounded-lg bg-elevated p-1" aria-label="Admin">
    <Link
      v-for="t in tabs"
      :key="t.href"
      :href="t.href"
      :class="['rounded-md px-3 py-1.5 text-sm font-medium transition-colors', current(t.href) ? 'bg-primary text-inverted' : 'text-muted hover:text-highlighted']"
      :aria-current="current(t.href) ? 'page' : undefined"
    >{{ t.label }}</Link>
  </nav>
</template>
