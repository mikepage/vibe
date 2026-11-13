<script setup lang="ts">
// Teams: a name and member emails, to share apps with. Anyone in a team adds
// and removes its members, by email, also before they've signed in once.
import { useRouter, useShared } from "@void/vue"
import { reactive, ref } from "vue"
import FormDialog from "../src/components/FormDialog.vue"
import { api } from "../src/api.ts"
import type { Props } from "./teams.server.ts"

defineProps<Props>()
const router = useRouter()
const shared = useShared()
const error = ref("")
const adding = reactive<Record<string, string>>({})

const done = (res: { ok: boolean; status: number; data: { error?: string } }) => {
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) router.refresh()
  return res.ok
}

const dialog = ref<InstanceType<typeof FormDialog>>()
const team = reactive({ name: "", pending: false, error: "" })
function openNew() {
  Object.assign(team, { name: "", error: "" })
  dialog.value?.open()
}
async function create() {
  team.pending = true
  const res = await api("POST", "/api/teams", { name: team.name })
  team.pending = false
  team.error = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) {
    dialog.value?.close()
    router.refresh()
  }
}
async function add(teamId: string) {
  if (done(await api("POST", `/api/teams/${teamId}/members`, { email: adding[teamId] ?? "" }))) adding[teamId] = ""
}
const removeMember = async (teamId: string, email: string) => done(await api("DELETE", `/api/teams/${teamId}/members`, { email }))
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">Teams</h1>
        <p class="mt-1 text-sm text-muted">Share apps with a team. Members manage their team.</p>
      </div>
      <UButton icon="i-lucide-plus" label="New team" @click="openNew" />
    </div>
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <UEmpty v-if="!teams.length" icon="i-lucide-users" title="You're in no teams yet" description="Make one to share apps with others." variant="naked" :actions="[{ label: 'New team', icon: 'i-lucide-plus', onClick: openNew }]" />
    <div v-else class="grid max-w-2xl gap-4">
      <UCard v-for="t in teams" :key="t.id">
        <template #header><h2 class="font-semibold text-highlighted">{{ t.name }}</h2></template>
        <ul class="grid gap-1 text-sm">
          <li v-for="m in t.members" :key="m" class="flex items-center justify-between gap-3">
            <span class="truncate">{{ m }}<span v-if="m === shared.user?.email" class="text-muted"> (you)</span></span>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" :aria-label="`Remove ${m}`" @click="removeMember(t.id, m)" />
          </li>
        </ul>
        <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="add(t.id)">
          <UFormField label="Add someone" class="min-w-56 flex-1">
            <UInput v-model="adding[t.id]" type="email" placeholder="someone@example.com" class="w-full" />
          </UFormField>
          <UButton type="submit" color="neutral" variant="outline" label="Add" />
        </form>
      </UCard>
    </div>
  </div>

  <FormDialog ref="dialog" title="New team" submit-label="Create team" :pending="team.pending" :error="team.error" @submit="create">
    <UFormField label="Name" name="name" required>
      <UInput v-model="team.name" name="name" placeholder="Finance" class="w-full" required />
    </UFormField>
  </FormDialog>
</template>
