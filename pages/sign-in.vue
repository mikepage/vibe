<script setup lang="ts">
// Email and password, for local development. Deployed, Cloudflare Access
// signs people in and this page never shows.
import { Link } from "@void/vue"
import { auth } from "void/client"
import { reactive, ref } from "vue"
import type { Props } from "./sign-in.server.ts"

const props = defineProps<Props>()
const data = reactive({ email: "", password: "" })
const pending = ref(false)
const error = ref("")

// Better Auth's client posts JSON to /api/auth. A full page load afterwards, so the middleware sees the session.
async function submit() {
  pending.value = true
  error.value = ""
  const { error: failed } = await auth.signIn.email(data)
  pending.value = false
  if (failed) error.value = failed.message ?? "Couldn't sign in."
  else location.assign(props.next)
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header><h1 class="text-lg font-semibold text-highlighted">Sign in to Vibe</h1></template>
    <form method="post" class="flex flex-col gap-4" @submit.prevent="submit">
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <UFormField label="Email" name="email" required>
        <UInput v-model="data.email" type="email" name="email" autocomplete="email" class="w-full" required />
      </UFormField>
      <UFormField label="Password" name="password" required>
        <UInput v-model="data.password" type="password" name="password" autocomplete="current-password" class="w-full" required />
      </UFormField>
      <UButton type="submit" :loading="pending" block label="Sign in" />
    </form>
    <template #footer>
      <p class="text-sm text-muted">No account? <Link :href="next === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`" class="font-medium text-primary">Sign up</Link></p>
    </template>
  </UCard>
</template>
