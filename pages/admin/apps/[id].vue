<script setup lang="ts">
// Admin: one app's data. Every space (each user's private data, and the shared data) with
// its documents and collections; Browse shows the documents, and a super admin deletes one
// document or a whole space. Private data includes what users entered for themselves.
import type { TableColumn } from "@nuxt/ui"
import { useRouter } from "@void/vue"
import { reactive, ref } from "vue"
import AdminTabs from "../../../src/components/AdminTabs.vue"
import ConfirmDelete from "../../../src/components/ConfirmDelete.vue"
import { api } from "../../../src/api.ts"
import type { Props } from "./[id].server.ts"

const props = defineProps<Props>()
const router = useRouter()
const when = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "")
const label = (user: string) => (user === props.shared ? "Shared data" : user)
const base = `/api/admin/apps/${props.app.id}/data`

type Space = Props["spaces"][number]
type Doc = { collection: string; id: string; createdAt: number; createdBy?: string } & Record<string, unknown>
const spaceColumns: TableColumn<Space>[] = [
  { accessorKey: "user", header: "Whose" },
  { accessorKey: "docs", header: "Documents" },
  { accessorKey: "collections", header: "Collections", meta: { class: { td: "whitespace-normal" } } },
  { accessorKey: "expiresAt", header: "Expires" },
  { id: "actions", header: "", meta: { class: { td: "text-end" } } },
]
const docColumns: TableColumn<Doc>[] = [
  { accessorKey: "collection", header: "Collection" },
  { id: "fields", header: "Fields", meta: { class: { td: "whitespace-normal" } } },
  { accessorKey: "createdAt", header: "Created" },
  { id: "actions", header: "", meta: { class: { td: "text-end" } } },
]
const open = reactive({ user: "", docs: [] as Doc[], loading: false })
const error = ref("")

async function browse(user: string) {
  Object.assign(open, { user, docs: [], loading: true })
  const res = await api<{ docs: Doc[] }>("GET", `${base}?user=${encodeURIComponent(user)}`)
  open.loading = false
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) open.docs = res.data.docs
}
const fields = (d: Doc) => {
  const { collection: _c, id: _i, createdAt: _ca, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...rest } = d
  return JSON.stringify(rest, null, 2)
}

async function removeDoc(d: Doc) {
  const res = await api("DELETE", base, { user: open.user, collection: d.collection, id: d.id })
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) {
    open.docs = open.docs.filter((x) => x !== d)
    router.refresh()
  }
}

const doomed = ref("")
const removing = ref(false)
const confirm = ref<InstanceType<typeof ConfirmDelete>>()
function askRemoveSpace(user: string) {
  doomed.value = user
  confirm.value?.open()
}
async function removeSpace() {
  removing.value = true
  const res = await api("DELETE", base, { user: doomed.value })
  removing.value = false
  confirm.value?.close()
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (open.user === doomed.value) Object.assign(open, { user: "", docs: [] })
  router.refresh()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm font-medium text-muted">Admin · app data</p>
        <h1 class="text-2xl font-semibold break-words text-highlighted">{{ app.name }}</h1>
        <p class="text-sm text-muted">Owner {{ app.owner }}</p>
      </div>
      <UButton :href="`/build/${app.id}`" color="neutral" variant="outline" size="sm" label="Manage app" />
    </div>
    <AdminTabs />
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

    <UEmpty v-if="!spaces.length" icon="i-lucide-database" title="No data" description="Nobody has stored anything in this app." variant="naked" />
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="spaces" :columns="spaceColumns" caption="Data per user">
        <template #user-cell="{ row }"><strong v-if="row.original.user === shared">Shared data</strong><span v-else>{{ row.original.user }}</span></template>
        <template #collections-cell="{ row }">{{ row.original.collections.join(", ") }}</template>
        <template #expiresAt-cell="{ row }">{{ row.original.user === shared ? "Never" : when(row.original.expiresAt) }}</template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" size="sm" label="Browse" @click="browse(row.original.user)" />
            <UButton color="error" variant="ghost" size="sm" label="Delete all" @click="askRemoveSpace(row.original.user)" />
          </div>
        </template>
      </UTable>
    </UCard>

    <UCard v-if="open.user" :ui="{ body: 'p-0 sm:p-0' }">
      <template #header><h2 class="font-semibold text-highlighted">{{ label(open.user) }}</h2></template>
      <p v-if="open.loading" class="p-4 text-sm text-muted">Loading…</p>
      <p v-else-if="!open.docs.length" class="p-4 text-sm text-muted">No documents.</p>
      <UTable v-else :data="open.docs" :columns="docColumns">
        <template #fields-cell="{ row }"><pre class="max-w-xl font-mono text-xs break-words whitespace-pre-wrap">{{ fields(row.original) }}</pre></template>
        <template #createdAt-cell="{ row }">{{ when(row.original.createdAt) }}<template v-if="row.original.createdBy"><br /><span class="text-muted">{{ row.original.createdBy }}</span></template></template>
        <template #actions-cell="{ row }"><UButton color="error" variant="ghost" size="sm" label="Delete" @click="removeDoc(row.original)" /></template>
      </UTable>
    </UCard>
  </div>

  <ConfirmDelete ref="confirm" title="Delete data" confirm-label="Delete all" :pending="removing" @confirm="removeSpace">
    Every document of {{ label(doomed) }} in {{ app.name }} goes. This can't be undone.
  </ConfirmDelete>
</template>
