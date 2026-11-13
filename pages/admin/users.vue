<script setup lang="ts">
// Admin: everyone who has signed in. A super admin makes others super admins or takes it
// away again, except from themselves.
import type { TableColumn } from "@nuxt/ui"
import { useRouter } from "@void/vue"
import { ref } from "vue"
import AdminTabs from "../../src/components/AdminTabs.vue"
import { api } from "../../src/api.ts"
import type { Props } from "./users.server.ts"

defineProps<Props>()
type Row = Props["users"][number]
const router = useRouter()
const error = ref("")
const when = (v: number | string) => new Date(v).toISOString().slice(0, 10)
const columns: TableColumn<Row>[] = [
  { accessorKey: "email", header: "Email" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "admin", header: "Role" },
  { accessorKey: "apps", header: "Apps" },
  { accessorKey: "createdAt", header: "Since" },
  { id: "actions", header: "", meta: { class: { td: "text-end" } } },
]
async function setRole(id: string, role: "admin" | "user") {
  const res = await api("PUT", `/api/admin/users/${id}/role`, { role })
  error.value = res.ok ? "" : (res.data.error ?? `${res.status}`)
  if (res.ok) router.refresh()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-2xl font-semibold text-highlighted">Admin</h1>
    <AdminTabs />
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <p class="text-sm text-muted">A changed role applies within five minutes.</p>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="users" :columns="columns" caption="Users">
        <template #email-cell="{ row }">{{ row.original.email }}<span v-if="row.original.id === me" class="text-muted"> (you)</span></template>
        <template #admin-cell="{ row }"><UBadge :color="row.original.admin ? 'primary' : 'neutral'" variant="subtle">{{ row.original.admin ? "Super admin" : "User" }}</UBadge></template>
        <template #createdAt-cell="{ row }">{{ when(row.original.createdAt) }}</template>
        <template #actions-cell="{ row }">
          <UButton v-if="!row.original.admin" color="neutral" variant="outline" size="sm" label="Make super admin" @click="setRole(row.original.id, 'admin')" />
          <UButton v-else-if="row.original.id !== me" color="neutral" variant="ghost" size="sm" label="Remove super admin" @click="setRole(row.original.id, 'user')" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
