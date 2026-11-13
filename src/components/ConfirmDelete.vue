<script setup lang="ts">
// "Delete …?" in a small Nuxt UI modal, with what deleting does. Also for
// other steps that can't be undone, with their own label.
import { ref } from "vue"

withDefaults(defineProps<{ title: string; pending?: boolean; confirmLabel?: string; destructive?: boolean }>(), { pending: false, confirmLabel: undefined, destructive: true })
const emit = defineEmits<{ confirm: [] }>()
const open = ref(false)

defineExpose({ open: () => (open.value = true), close: () => (open.value = false) })
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: 'max-w-md', footer: 'justify-end' }">
    <template #body>
      <p class="text-sm text-muted"><slot /></p>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
      <UButton :color="destructive ? 'error' : 'primary'" :loading="pending" :label="confirmLabel ?? 'Delete'" @click="emit('confirm')" />
    </template>
  </UModal>
</template>
