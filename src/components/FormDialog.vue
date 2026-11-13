<script setup lang="ts">
// A form in a Nuxt UI modal: the fields (the default slot), the form's error,
// Cancel and the submit button. The parent submits and closes it when that
// succeeds.
import { ref, useId } from "vue"

withDefaults(defineProps<{ title: string; submitLabel: string; pending?: boolean; error?: string | null }>(), { pending: false, error: null })
const emit = defineEmits<{ submit: [] }>()

const open = ref(false)
const formId = `form-${useId()}`

defineExpose({ open: () => (open.value = true), close: () => (open.value = false) })
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ footer: 'justify-end' }">
    <template #body>
      <form :id="formId" class="flex flex-col gap-4" novalidate @submit.prevent="emit('submit')">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
        <slot />
      </form>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
      <UButton type="submit" :form="formId" :loading="pending" :label="submitLabel" />
    </template>
  </UModal>
</template>
