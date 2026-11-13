<script setup lang="ts">
// Admin: every team. A super admin adds and removes members and deletes teams without
// being in them; deleting a team ends the apps' sharing with it.
import { useRouter } from "@void/vue"
import { reactive, ref } from "vue"
import AdminTabs from "../../src/components/AdminTabs.vue"
import ConfirmDelete from "../../src/components/ConfirmDelete.vue"
import { api } from "../../src/api.ts"
import type { Props } from "./teams.server.ts"

defineProps<Props>()
const router = useRouter()
const error = ref("")
const adding = reactive<Record<string, string>>({})
const done = (res: { ok: boolean; status: number; data: { error?: string } }) => {
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) router.refresh()
  return res.ok
}
async function add(teamId: string) {
  if (done(await api("POST", `/api/teams/${teamId}/members`, { email: adding[teamId] ?? "" }))) adding[teamId] = ""
}
const removeMember = async (teamId: string, email: string) => done(await api("DELETE", `/api/teams/${teamId}/members`, { email }))

const doomed = ref<{ id: string; name: string } | null>(null)
const removing = ref(false)
const confirm = ref<InstanceType<typeof ConfirmDelete>>()
function askDelete(t: { id: string; name: string }) {
  doomed.value = t
  confirm.value?.open()
}
async function deleteTeam() {
  removing.value = true
  done(await api("DELETE", `/api/admin/teams/${doomed.value?.id}`, {}))
  removing.value = false
  confirm.value?.close()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-semibold text-highlighted">Admin</h1>
    <AdminTabs />
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <UEmpty v-if="!teams.length" icon="i-lucide-users" title="No teams yet" variant="naked" />
    <div v-else class="grid max-w-2xl gap-4">
      <UCard v-for="t in teams" :key="t.id">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold text-highlighted">{{ t.name }}</h2>
              <p class="text-sm text-muted">Made by {{ t.createdBy }}</p>
            </div>
            <UButton color="error" variant="ghost" size="sm" label="Delete team" @click="askDelete(t)" />
          </div>
        </template>
        <ul class="grid gap-1 text-sm">
          <li v-for="m in t.members" :key="m" class="flex items-center justify-between gap-3">
            <span class="truncate">{{ m }}</span>
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

  <ConfirmDelete ref="confirm" title="Delete team" confirm-label="Delete team" :pending="removing" @confirm="deleteTeam">
    {{ doomed?.name }} goes, with its members list. Apps shared only with it are then visible to their owner alone.
  </ConfirmDelete>
</template>
