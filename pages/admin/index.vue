<script setup lang="ts">
// Admin: every app. Its name opens its data; the app page is where a super admin changes,
// shares, transfers or deletes it, as its owner would.
import type { TableColumn } from "@nuxt/ui"
import { Link } from "@void/vue"
import AdminTabs from "../../src/components/AdminTabs.vue"
import type { Props } from "./index.server.ts"

defineProps<Props>()
type Row = Props["apps"][number]
const VISIBILITY = { private: "Only owner", teams: "Teams", everyone: "Everyone" } as const
const NETWORK = { disabled: "Off", allowlist: "Allow list", all: "All" } as const
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ")
const columns: TableColumn<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "visibility", header: "Shared with" },
  { accessorKey: "outbound", header: "Network" },
  { accessorKey: "version", header: "Version" },
  { accessorKey: "updatedAt", header: "Changed" },
  { id: "actions", header: "", meta: { class: { td: "text-end" } } },
]
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-semibold text-highlighted">Admin</h1>
    <AdminTabs />
    <UEmpty v-if="!apps.length" icon="i-lucide-boxes" title="No apps yet" variant="naked" />
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="apps" :columns="columns" caption="All apps">
        <template #name-cell="{ row }"><Link :href="`/admin/apps/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</Link></template>
        <template #visibility-cell="{ row }"><UBadge :color="row.original.visibility === 'private' ? 'neutral' : 'info'" variant="subtle">{{ VISIBILITY[row.original.visibility] }}</UBadge></template>
        <template #outbound-cell="{ row }"><UBadge :color="row.original.outbound === 'disabled' ? 'neutral' : 'warning'" variant="subtle">{{ NETWORK[row.original.outbound] }}</UBadge></template>
        <template #version-cell="{ row }"><span v-if="row.original.version">v{{ row.original.version }} <span class="text-muted">of {{ row.original.versions }}</span></span><UBadge v-else color="warning" variant="subtle">No version</UBadge></template>
        <template #updatedAt-cell="{ row }">{{ when(row.original.updatedAt) }}</template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-2">
            <UButton :href="`/admin/apps/${row.original.id}`" color="neutral" variant="ghost" size="sm" label="Data" />
            <UButton :href="`/build/${row.original.id}`" color="neutral" variant="outline" size="sm" label="Manage" />
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
