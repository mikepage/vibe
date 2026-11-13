<script setup lang="ts">
// The sidebar's navigation: an icon per item, the current page highlighted, as
// Nuxt UI's vertical NavigationMenu draws it. Void's Link, so going to another
// page doesn't reload. In the collapsed sidebar only the icons show; the label
// stays the link's name and shows as a tooltip (src/app.css). `labels` always
// shows them (the slideover below 64rem).
import { Link } from "@void/vue"
import { navItemOf, type NavItem } from "../nav.ts"

const props = defineProps<{ items: NavItem[]; path: string; labels?: boolean }>()
const current = (href: string) => navItemOf(props.path)?.href === href
</script>

<template>
  <nav aria-label="Main">
    <ul class="grid gap-1">
      <li v-for="item in items" :key="item.href">
        <Link
          :href="item.href"
          :class="[
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary',
            labels ? '' : 'nav-item',
            current(item.href) ? 'bg-elevated text-primary' : 'text-muted hover:bg-elevated/50 hover:text-highlighted',
          ]"
          :aria-current="current(item.href) ? 'page' : undefined"
        >
          <UIcon :name="item.icon" class="size-5 shrink-0" />
          <span :class="labels ? '' : 'nav-label'">{{ item.label }}</span>
        </Link>
      </li>
    </ul>
  </nav>
</template>
