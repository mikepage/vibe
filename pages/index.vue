<script setup lang="ts">
// The apps: the title with New app, your apps, then the ones shared with you.
// New app asks for a name and a prompt in a dialog, then its page opens and
// Claude's first draft streams in there.
import type { TableColumn } from "@nuxt/ui"
import { Link } from "@void/vue"
import { reactive, ref } from "vue"
import FormDialog from "../src/components/FormDialog.vue"
import { api } from "../src/api.ts"
import type { Props } from "./index.server.ts"

defineProps<Props>()
type Row = Props["own"][number]
const VISIBILITY = { private: "Only me", teams: "Teams", everyone: "Everyone" } as const
const ownColumns: TableColumn<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "visibility", header: "Shared with" },
  { accessorKey: "version", header: "Version" },
  { id: "open", header: "", meta: { class: { td: "text-end" } } },
]
const sharedColumns: TableColumn<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "version", header: "Version" },
  { id: "open", header: "", meta: { class: { td: "text-end" } } },
]
const dialog = ref<InstanceType<typeof FormDialog>>()
const form = reactive({ name: "", prompt: "", pending: false, error: "" })

function openNew() {
  Object.assign(form, { name: "", prompt: "", error: "" })
  dialog.value?.open()
}

async function build() {
  if (!form.name.trim() || !form.prompt.trim()) return (form.error = "Give it a name and say what it should do.")
  Object.assign(form, { pending: true, error: "" })
  const res = await api<{ app?: { id: string } }>("POST", "/api/apps", { name: form.name })
  if (!res.ok || !res.data.app) return Object.assign(form, { pending: false, error: res.data.error ?? `${res.status}` })
  // The app's page starts the draft with this prompt (pages/build/[id].vue).
  try {
    sessionStorage.setItem(`vibe:prompt:${res.data.app.id}`, form.prompt)
  } catch {
    // No storage: the page opens with an empty prompt box.
  }
  location.assign(`/build/${res.data.app.id}`)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">Apps</h1>
        <p class="mt-1 text-sm text-muted">Describe a small tool. Claude writes it, the platform builds and runs it.</p>
      </div>
      <UButton icon="i-lucide-plus" label="New app" @click="openNew" />
    </div>

    <UEmpty v-if="!own.length" icon="i-lucide-boxes" title="No apps yet" description="Describe one and Claude builds it." variant="naked" :actions="[{ label: 'New app', icon: 'i-lucide-plus', onClick: openNew }]" />
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="own" :columns="ownColumns" caption="Your apps">
        <template #name-cell="{ row }"><Link :href="`/build/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</Link></template>
        <template #visibility-cell="{ row }"><UBadge :color="row.original.visibility === 'private' ? 'neutral' : 'info'" variant="subtle">{{ VISIBILITY[row.original.visibility] }}</UBadge></template>
        <template #version-cell="{ row }"><span v-if="row.original.version">v{{ row.original.version }}</span><UBadge v-else color="warning" variant="subtle">No version</UBadge></template>
        <template #open-cell="{ row }"><UButton v-if="row.original.version" :href="`/apps/${row.original.id}/`" color="neutral" variant="outline" size="sm" label="Open" /></template>
      </UTable>
    </UCard>

    <h2 class="text-lg font-semibold text-highlighted">Shared with you</h2>
    <p v-if="!shared.length" class="text-sm text-muted">Nothing shared with you yet.</p>
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="shared" :columns="sharedColumns" caption="Shared with you">
        <template #name-cell="{ row }"><Link :href="`/build/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</Link></template>
        <template #version-cell="{ row }">v{{ row.original.version }}</template>
        <template #open-cell="{ row }"><UButton :href="`/apps/${row.original.id}/`" color="neutral" variant="outline" size="sm" label="Open" /></template>
      </UTable>
    </UCard>
  </div>

  <FormDialog ref="dialog" title="New app" submit-label="Build it" :pending="form.pending" :error="form.error" @submit="build">
    <UFormField label="Name" name="name" required>
      <UInput v-model="form.name" name="name" placeholder="Expense tracker" class="w-full" required />
    </UFormField>
    <UFormField label="What should it do?" name="prompt" help="Who uses it, what they enter, what they see. It stores data per user and can't reach the internet." required>
      <UTextarea v-model="form.prompt" name="prompt" :rows="5" class="w-full" placeholder="Track my expenses with a date, amount and category, with a total per month." required />
    </UFormField>
  </FormDialog>
</template>
