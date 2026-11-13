<script setup lang="ts">
// A local account, for development: sign up as a second person to share an
// app with a team and open it as them. Deployed, Access signs people in.
import { Link } from "@void/vue"
import { auth } from "void/client"
import { reactive, ref } from "vue"
import type { Props } from "./sign-up.server.ts"

const props = defineProps<Props>()
const data = reactive({ name: "", email: "", password: "" })
const pending = ref(false)
const error = ref("")

async function submit() {
  pending.value = true
  error.value = ""
  const { error: failed } = await auth.signUp.email({ ...data, name: data.name || data.email.split("@")[0]! })
  pending.value = false
  if (failed) error.value = failed.message ?? "Couldn't sign up."
  else location.assign(props.next)
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header><h1 class="text-lg font-semibold text-highlighted">Sign up for Vibe</h1></template>
    <form method="post" class="flex flex-col gap-4" @submit.prevent="submit">
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <UFormField label="Name" name="name">
        <UInput v-model="data.name" name="name" autocomplete="name" class="w-full" />
      </UFormField>
      <UFormField label="Email" name="email" required>
        <UInput v-model="data.email" type="email" name="email" autocomplete="email" class="w-full" required />
      </UFormField>
      <UFormField label="Password" name="password" help="At least 10 characters." required>
        <UInput v-model="data.password" type="password" name="password" autocomplete="new-password" class="w-full" required />
      </UFormField>
      <UButton type="submit" :loading="pending" block label="Sign up" />
    </form>
    <template #footer>
      <p class="text-sm text-muted">Have an account? <Link :href="`/sign-in?next=${encodeURIComponent(next)}`" class="font-medium text-primary">Sign in</Link></p>
    </template>
  </UCard>
</template>
