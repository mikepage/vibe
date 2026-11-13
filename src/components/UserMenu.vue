<script setup lang="ts">
// Who is signed in, the theme and signing out.
import type { DropdownMenuItem } from "@nuxt/ui"
import { useShared } from "@void/vue"
import { auth } from "void/client"
import { computed } from "vue"
import { useTheme, type Theme } from "../theme.ts"

const props = defineProps<{ user: { name: string; email: string } }>()
const shared = useShared()
const { theme, set } = useTheme()

const themes: { id: Theme; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "i-lucide-sun" },
  { id: "dark", label: "Dark", icon: "i-lucide-moon" },
  { id: "system", label: "System", icon: "i-lucide-monitor" },
]

async function signOut() {
  // Better Auth's client POSTs this; it needs JavaScript.
  await auth.signOut()
  // Behind Access, its logout; otherwise its next request signs you straight back in.
  location.assign(shared.signOut)
}

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: "label", label: props.user.name, description: props.user.email }],
  [
    { type: "label", label: "Theme" },
    ...themes.map((t) => ({ label: t.label, icon: t.icon, type: "checkbox" as const, checked: theme.value === t.id, onSelect: (e: Event) => (e.preventDefault(), set(t.id)) })),
  ],
  [{ label: "Sign out", icon: "i-lucide-log-out", color: "error" as const, onSelect: () => void signOut() }],
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }" :ui="{ content: 'w-60' }">
    <UButton color="neutral" variant="ghost" :aria-label="`Account: ${user.email}`">
      <UAvatar :alt="user.name" size="xs" />
      <span class="max-w-56 truncate max-sm:hidden">{{ user.email }}</span>
    </UButton>
  </UDropdownMenu>
</template>
