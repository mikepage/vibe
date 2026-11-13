<script setup lang="ts">
// One app, as a workspace: the conversation on the left (each version's prompt
// and what came of it, the draft's prompts, the change Claude is writing now
// and the ones queued after it, then the box to ask for the next), the app on
// the right in a frame (the draft, or the live version) with the build's logs
// under it. Details, sharing, network and files are in a slideover.
import type { DropdownMenuItem } from "@nuxt/ui"
import { Link, useRouter } from "@void/vue"
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue"
import ConfirmDelete from "../../src/components/ConfirmDelete.vue"
import FormDialog from "../../src/components/FormDialog.vue"
import { api, stepLines, stopwatch, streamEvents, type Step } from "../../src/api.ts"
import type { Props } from "./[id].server.ts"

const props = defineProps<Props>()
const router = useRouter()
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ")
const VISIBILITY = { private: "Only me", teams: "Teams", everyone: "Everyone" } as const
const NETWORK = { disabled: "Disabled", allowlist: "Allow list", all: "Allow all" } as const
const nextVersion = computed(() => (props.versions[0]?.version ?? 0) + 1)

// The conversation so far, oldest first, from what's stored: versions, then the draft.
const history = computed(() => [...props.versions].reverse())

// The change Claude is on, the ones queued after it, and how the last one that failed went.
// Claude's reply streams into `text`; each attempt starts it over.
type Run = { prompt: string; attempt: number; text: string; steps: Step[]; seconds: number; showText: boolean }
const run = ref<Run | null>(null)
const queue = ref<string[]>([])
const failed = ref<{ prompt: string; error: string } | null>(null)
const logs = ref<Step[]>([])
const composer = ref("")
const chat = ref<HTMLElement>()
const activity = ref<HTMLElement>()

const scrollChat = () => void nextTick(() => chat.value?.scrollTo({ top: chat.value.scrollHeight }))
onMounted(scrollChat)
watch(() => [props.versions.length, props.draft?.hash, queue.value.length, run.value?.attempt], scrollChat)

const writing = computed(() => [...(run.value?.text ?? "").matchAll(/^```(.*)$/gm)].at(-1)?.[1].trim() ?? "")
const phases = computed(() => {
  const r = run.value
  if (!r) return []
  const done = (step: string) => r.steps.some((s) => s.attempt === r.attempt && s.step === step)
  const state = (finished: boolean, started: boolean) => (finished ? "done" : started ? "active" : "todo")
  return [
    { label: writing.value ? `Writing ${writing.value}` : "Writing the app", state: state(done("generate"), true) },
    { label: "Building it", state: state(done("build"), done("generate")) },
    { label: "Trying it", state: state(done("smoke"), done("build")) },
  ]
})
const retries = computed(() => run.value?.steps.filter((s) => s.step === "error") ?? [])

function send() {
  const prompt = composer.value.trim()
  if (!prompt || !props.isOwner) return
  queue.value.push(prompt)
  composer.value = ""
  if (!run.value) void next()
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

// Runs the queued changes one by one into the draft, each on the one before.
async function next() {
  const prompt = queue.value.shift()
  if (!prompt) return
  failed.value = null
  const r = reactive<Run>({ prompt, attempt: 1, text: "", steps: [], seconds: 0, showText: false })
  run.value = r
  logs.value = r.steps
  const stop = stopwatch((s) => (r.seconds = s))
  let done = false
  let error = ""
  const res = await streamEvents(`/api/apps/${props.app.id}/draft`, { prompt }, (event, data) => {
    if (event === "attempt") Object.assign(r, { attempt: data.attempt, text: "" })
    else if (event === "text") {
      r.text += data.text
      if (r.showText) void nextTick(() => activity.value?.scrollTo({ top: activity.value.scrollHeight }))
    } else if (event === "step") r.steps.push(data.step)
    else if (event === "done") done = true
    else if (event === "failed") error = data.error
  }).catch((e: Error) => ({ ok: false, status: 0, data: { error: `The connection broke: ${e.message}. The draft may still finish; reload in a minute.` } }))
  stop()
  if (!res.ok) error = res.data.error ?? `${res.status}`
  else if (!done && !error) error = "The connection closed before the draft was ready. It may still finish; reload in a minute."
  if (!done) failed.value = { prompt, error }
  // The refreshed draft holds the prompt now, so the running card can go.
  if (done) await router.refresh()
  run.value = null
  void next()
}
const unqueue = (i: number) => queue.value.splice(i, 1)

// The home page's New app dialog hands its prompt over, so the first draft streams here.
onMounted(() => {
  let prompt: string | null = null
  try {
    prompt = sessionStorage.getItem(`vibe:prompt:${props.app.id}`)
    sessionStorage.removeItem(`vibe:prompt:${props.app.id}`)
  } catch {
    // No storage: nothing was handed over.
  }
  if (prompt && props.isOwner) {
    composer.value = prompt
    send()
  }
})

// The preview: the draft when there is one, else the live version.
const mode = ref<"draft" | "live">(props.draft ? "draft" : "live")
watch(
  () => props.draft?.hash,
  (hash, before) => {
    if (hash && hash !== before) mode.value = "draft"
    if (!hash) mode.value = "live"
  },
)
const previewSrc = computed(() => (mode.value === "draft" ? `/apps/${props.app.id}/~draft/` : `/apps/${props.app.id}/`))
const canPreview = computed(() => (mode.value === "draft" ? !!props.draft : !!props.app.version))
const frame = ref<HTMLIFrameElement>()
const framePath = ref("")
function onFrameLoad() {
  try {
    const loc = frame.value?.contentWindow?.location
    framePath.value = loc ? loc.pathname + loc.search : ""
  } catch {
    framePath.value = ""
  }
}
const reloadPreview = () => frame.value?.contentWindow?.location.reload()
const showLogs = ref(false)

const drafting = reactive({ pending: false, error: "" })
async function publish() {
  Object.assign(drafting, { pending: true, error: "" })
  const res = await api("POST", `/api/apps/${props.app.id}/draft/publish`, {})
  Object.assign(drafting, { pending: false, error: res.ok ? "" : (res.data.error ?? `${res.status}`) })
  if (res.ok) router.refresh()
}
const discardDialog = ref<InstanceType<typeof ConfirmDelete>>()
async function discard() {
  Object.assign(drafting, { pending: true, error: "" })
  const res = await api("DELETE", `/api/apps/${props.app.id}/draft`, {})
  Object.assign(drafting, { pending: false, error: res.ok ? "" : (res.data.error ?? `${res.status}`) })
  discardDialog.value?.close()
  if (res.ok) router.refresh()
}

const detailsOpen = ref(false)
const VISIBILITY_ITEMS = [
  { value: "private", label: "Only me" },
  { value: "teams", label: "Teams I pick" },
  { value: "everyone", label: "Everyone who can sign in" },
]
const NETWORK_ITEMS = [
  { value: "disabled", label: "Disabled" },
  { value: "allowlist", label: "Allow list" },
  { value: "all", label: "Allow all" },
]

const sharing = reactive({
  visibility: props.app.visibility as string,
  teams: Object.fromEntries(props.teams.map((t) => [t.id, props.sharedTeamIds.includes(t.id)])) as Record<string, boolean>,
  pending: false,
  error: "",
  saved: false,
})
async function share() {
  Object.assign(sharing, { pending: true, error: "", saved: false })
  const teamIds = Object.entries(sharing.teams).filter(([, on]) => on).map(([id]) => id)
  const res = await api("PUT", `/api/apps/${props.app.id}/sharing`, { visibility: sharing.visibility, teamIds })
  Object.assign(sharing, { pending: false, error: res.ok ? "" : (res.data.error ?? `${res.status}`), saved: res.ok })
  if (res.ok) router.refresh()
}

const network = reactive({
  mode: props.app.outbound.mode as string,
  hosts: props.app.outbound.hosts.join("\n"),
  pending: false,
  error: "",
  saved: false,
})
async function saveNetwork() {
  Object.assign(network, { pending: true, error: "", saved: false })
  const res = await api("PUT", `/api/apps/${props.app.id}/outbound`, { mode: network.mode, hosts: network.hosts })
  Object.assign(network, { pending: false, error: res.ok ? "" : (res.data.error ?? `${res.status}`), saved: res.ok })
  if (res.ok) router.refresh()
}

// The current files again, built with today's kit (kit fixes reach the app) through the
// same checks, build and smoke test as a hand-written deploy. No Claude.
const rebuild = reactive({ pending: false, error: "" })
async function rebuildNow() {
  Object.assign(rebuild, { pending: true, error: "" })
  const res = await api("POST", `/api/apps/${props.app.id}/deploy`, { files: Object.fromEntries(props.files.map((f) => [f.name, f.body])) })
  logs.value = res.data.steps ?? []
  Object.assign(rebuild, { pending: false, error: res.ok ? "" : (res.data.error ?? `${res.status}`) })
  if (!res.ok) showLogs.value = true
  else router.refresh()
}

// Handing the app to someone else. Afterwards this page is theirs to change; reload it as
// whatever the app's sharing leaves you, or go back to the list if that's nothing.
const transferDialog = ref<InstanceType<typeof FormDialog>>()
const transfer = reactive({ email: "", pending: false, error: "" })
function openTransfer() {
  Object.assign(transfer, { email: "", error: "" })
  transferDialog.value?.open()
}
async function sendTransfer() {
  transfer.pending = true
  const res = await api("PUT", `/api/apps/${props.app.id}/owner`, { email: transfer.email })
  transfer.pending = false
  if (!res.ok) return (transfer.error = res.data.error ?? `${res.status}`)
  location.assign(props.app.visibility === "private" ? "/" : `/build/${props.app.id}`)
}

const confirm = ref<InstanceType<typeof ConfirmDelete>>()
const actions = computed<DropdownMenuItem[][]>(() => [
  [
    ...(props.files.length ? [{ label: "Rebuild with the current kit", icon: "i-lucide-refresh-cw", disabled: rebuild.pending, onSelect: () => void rebuildNow() }] : []),
    { label: "Transfer ownership", icon: "i-lucide-user-round-pen", onSelect: openTransfer },
  ],
  [{ label: "Delete app", icon: "i-lucide-trash-2", color: "error" as const, onSelect: () => confirm.value?.open() }],
])
const removing = ref(false)
async function remove() {
  removing.value = true
  const res = await api("DELETE", `/api/apps/${props.app.id}`)
  if (res.ok) return location.assign("/")
  removing.value = false
}
</script>

<template>
  <div class="workspace grid min-h-0 flex-1 grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] max-lg:grid-cols-1">
    <section class="flex min-h-0 flex-col border-e border-default bg-elevated/30 max-lg:border-e-0 max-lg:border-b" aria-label="Conversation">
      <header class="flex items-center justify-between gap-3 border-b border-default px-5 py-4">
        <div class="flex min-w-0 items-center gap-2">
          <h1 class="truncate text-lg font-semibold text-highlighted">{{ app.name }}</h1>
          <UBadge v-if="app.version" color="success" variant="subtle">v{{ app.version }} live</UBadge>
          <UBadge v-else color="warning" variant="subtle">Not live yet</UBadge>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-info" color="neutral" variant="outline" size="sm" aria-label="Details" @click="detailsOpen = true" />
          <UDropdownMenu v-if="isOwner" :items="actions" :content="{ align: 'end' }">
            <UButton icon="i-lucide-ellipsis" color="neutral" variant="outline" size="sm" aria-label="Actions" />
          </UDropdownMenu>
        </div>
      </header>

      <div ref="chat" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5 max-lg:max-h-[60svh]">
        <UAlert v-if="asAdmin" color="warning" variant="subtle" :title="`You're changing ${app.owner}'s app as a super admin.`" />
        <UAlert v-if="!isOwner" color="info" variant="subtle" :title="`${app.owner} shared this app with you. Your data in it is yours alone.`" />
        <p v-if="!versions.length && !draft && !run && !queue.length && isOwner" class="my-auto text-center text-sm text-muted">Say what the app should do. Claude writes it, the platform builds and tries it, and you try the draft on the right before anyone else sees it.</p>

        <template v-for="v in history" :key="v.version">
          <p v-if="v.prompt" class="max-w-[85%] self-end rounded-lg border border-default bg-default px-3.5 py-2 text-sm break-words whitespace-pre-wrap">{{ v.prompt }}</p>
          <div class="flex flex-wrap items-center gap-2 text-[0.8125rem] text-toned">
            <UIcon name="i-lucide-check" class="size-4 text-success" />
            <span><strong>v{{ v.version }}</strong> {{ v.prompt ? "published" : "deployed from files" }} · {{ v.buildMs }} ms · {{ v.kb }} KB<template v-if="v.attempts > 1"> · {{ v.attempts }} tries</template></span>
            <UBadge v-if="v.version === app.version" color="success" variant="subtle" size="sm">Live</UBadge>
            <span class="ms-auto text-xs text-muted">{{ when(v.at) }}</span>
          </div>
        </template>

        <template v-if="draft">
          <p v-for="(p, i) in draft.prompts" :key="`d${i}`" class="max-w-[85%] self-end rounded-lg border border-default bg-default px-3.5 py-2 text-sm break-words whitespace-pre-wrap">{{ p }}</p>
          <UCard :ui="{ body: 'flex flex-col gap-3 p-4 sm:p-4 text-sm' }">
            <div class="flex items-center gap-2">
              <strong>Draft ready</strong>
              <UBadge color="warning" variant="subtle" size="sm">{{ draft.baseVersion ? `Changes v${draft.baseVersion}` : "Not published" }}</UBadge>
            </div>
            <p class="text-muted">{{ draft.buildMs }} ms · {{ draft.kb }} KB · {{ when(draft.at) }}. Try it on the right; it has its own data, which goes when you publish or discard it.</p>
            <UAlert v-if="drafting.error" color="error" variant="subtle" :title="drafting.error" />
            <div v-if="isOwner" class="flex flex-wrap gap-2">
              <UButton size="sm" :loading="drafting.pending" :disabled="!!run" :label="`Publish as v${nextVersion}`" @click="publish" />
              <UButton color="error" variant="outline" size="sm" :disabled="drafting.pending || !!run" label="Discard" @click="discardDialog?.open()" />
            </div>
          </UCard>
        </template>

        <template v-if="failed">
          <p class="max-w-[85%] self-end rounded-lg border border-default bg-default px-3.5 py-2 text-sm break-words whitespace-pre-wrap">{{ failed.prompt }}</p>
          <UAlert color="error" variant="subtle" icon="i-lucide-circle-alert" :description="failed.error" />
        </template>

        <template v-if="run">
          <p class="max-w-[85%] self-end rounded-lg border border-default bg-default px-3.5 py-2 text-sm break-words whitespace-pre-wrap">{{ run.prompt }}</p>
          <UCard :ui="{ body: 'flex flex-col gap-3 p-4 sm:p-4 text-sm' }" aria-live="polite">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
              <strong>{{ draft || app.version ? "Changing the app" : "Writing the app" }}</strong>
              <span class="ms-auto text-xs text-muted">{{ run.seconds }} s</span>
            </div>
            <ol class="flex flex-col gap-1">
              <li v-for="(ph, i) in phases" :key="i" :class="['flex items-center gap-2.5 rounded-md px-2.5 py-2', ph.state === 'active' ? 'bg-elevated font-medium text-highlighted' : ph.state === 'done' ? 'text-toned' : 'text-dimmed']">
                <span :class="['grid size-5.5 place-items-center rounded-full border text-[0.6875rem]', ph.state === 'done' ? 'border-transparent bg-inverted text-inverted' : 'border-current']">
                  <UIcon v-if="ph.state === 'done'" name="i-lucide-check" class="size-3" /><template v-else>{{ i + 1 }}</template>
                </span>{{ ph.label }}
              </li>
            </ol>
            <p v-for="(e, i) in retries" :key="i" class="text-[0.8125rem] text-muted">Attempt {{ e.attempt }} didn't work, so Claude is fixing it: {{ (e.message ?? "").split("\n")[0].slice(0, 140) }}</p>
            <div class="flex justify-end">
              <UButton color="neutral" variant="outline" size="sm" :label="run.showText ? 'Hide activity' : 'View activity'" @click="run.showText = !run.showText" />
            </div>
            <pre v-if="run.showText" ref="activity" class="max-h-64 overflow-y-auto rounded-md bg-elevated p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{{ run.text || "Waiting for Claude…" }}</pre>
          </UCard>
        </template>

        <div v-for="(q, i) in queue" :key="`q${i}`" class="flex max-w-[85%] items-center gap-2 self-end rounded-lg border border-dashed border-accented px-3.5 py-2 text-sm text-muted">
          <span class="text-xs font-semibold tracking-wide uppercase">Queued</span>
          <span class="break-words whitespace-pre-wrap">{{ q }}</span>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Remove from the queue" @click="unqueue(i)" />
        </div>
      </div>

      <form v-if="isOwner" class="m-4 mt-0 rounded-lg border border-default bg-default p-2" @submit.prevent="send">
        <UTextarea v-model="composer" aria-label="What should change?" name="prompt" :rows="2" autoresize :maxrows="8" variant="none" class="w-full"
          :placeholder="run ? 'Queue a change…' : app.version || draft ? 'Ask for a change…' : 'Describe the app…'" @keydown="onKey" />
        <div class="flex items-center justify-between gap-2 px-1 pt-1 text-xs text-muted">
          <span>Enter sends, Shift+Enter for a new line.</span>
          <UButton type="submit" icon="i-lucide-arrow-up" size="sm" :aria-label="run ? 'Queue' : 'Send'" :disabled="!composer.trim()" />
        </div>
      </form>
    </section>

    <section class="flex min-h-0 min-w-0 flex-col bg-default" aria-label="Preview">
      <div class="flex items-center gap-3 border-b border-default px-4 py-2.5">
        <UFieldGroup size="sm">
          <UButton color="neutral" :variant="mode === 'draft' ? 'solid' : 'outline'" :disabled="!draft" label="Draft" @click="mode = 'draft'" />
          <UButton color="neutral" :variant="mode === 'live' ? 'solid' : 'outline'" :disabled="!app.version" label="Live" @click="mode = 'live'" />
        </UFieldGroup>
        <div class="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-default py-0.5 ps-0.5 pe-3 text-muted">
          <UButton icon="i-lucide-rotate-cw" color="neutral" variant="ghost" size="xs" class="rounded-full" aria-label="Reload" :disabled="!canPreview" @click="reloadPreview" />
          <span class="truncate font-mono text-[0.8125rem]">{{ canPreview ? framePath || previewSrc : run ? "Preparing the preview…" : "No preview yet" }}</span>
        </div>
        <UButton v-if="canPreview" :href="previewSrc" target="_blank" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" aria-label="Open in a new tab" />
      </div>
      <div class="flex min-h-0 flex-1 p-3 max-lg:min-h-[32rem]">
        <iframe v-if="canPreview" :key="`${mode}-${draft?.hash ?? ''}-${app.version ?? ''}`" ref="frame" :src="previewSrc" :title="mode === 'draft' ? 'Draft preview' : 'Live app'" class="w-full flex-1 rounded-md border border-default bg-white" @load="onFrameLoad" />
        <div v-else class="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-default text-center text-sm">
          <UIcon v-if="run" name="i-lucide-loader-circle" class="mb-2 size-6 animate-spin text-primary" />
          <p class="font-semibold text-highlighted">{{ run ? "Preparing the app" : "Nothing to show yet" }}</p>
          <p class="text-muted">{{ run ? "The preview appears here when the draft answers." : "Ask for an app on the left; its draft shows here." }}</p>
        </div>
      </div>
      <div class="border-t border-default px-4">
        <button type="button" class="flex w-full items-center gap-2 py-2 text-[0.8125rem] text-toned" :aria-expanded="showLogs" @click="showLogs = !showLogs">
          <UIcon name="i-lucide-terminal" class="size-4" /><span>Logs</span><span v-if="rebuild.error" class="text-muted">· rebuild failed</span>
          <UIcon name="i-lucide-chevron-up" :class="['ms-auto size-4 transition-transform', showLogs && 'rotate-180']" />
        </button>
        <template v-if="showLogs">
          <UAlert v-if="rebuild.error" color="error" variant="subtle" class="mb-2" :description="rebuild.error" />
          <pre class="mb-3 max-h-48 overflow-y-auto rounded-md bg-elevated p-3 text-[0.8125rem] whitespace-pre-wrap">{{ logs.length ? stepLines(logs) : run ? "Claude is writing; steps show here as they finish." : "No build in this visit yet." }}</pre>
        </template>
      </div>
    </section>
  </div>

  <USlideover v-model:open="detailsOpen" title="Details" :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div class="flex flex-col gap-6">
        <dl class="grid gap-3 text-sm">
          <div class="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt class="font-medium text-muted">Address</dt><dd class="font-mono text-[0.8125rem] break-all"><a v-if="app.version" :href="`/apps/${app.id}/`" class="text-primary">/apps/{{ app.id }}/</a><template v-else>/apps/{{ app.id }}/</template></dd></div>
          <div class="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt class="font-medium text-muted">Owner</dt><dd>{{ app.owner }}</dd></div>
          <div class="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt class="font-medium text-muted">Shared with</dt><dd>{{ VISIBILITY[app.visibility] }}</dd></div>
          <div class="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt class="font-medium text-muted">Network</dt><dd>{{ NETWORK[app.outbound.mode] }}<template v-if="app.outbound.mode === 'allowlist'">: {{ app.outbound.hosts.join(", ") }}</template></dd></div>
          <div class="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4"><dt class="font-medium text-muted">Versions</dt><dd>{{ versions.length }}</dd></div>
        </dl>

        <form v-if="isOwner" class="flex flex-col gap-4" @submit.prevent="share">
          <h3 class="font-semibold text-highlighted">Sharing</h3>
          <URadioGroup v-model="sharing.visibility" name="visibility" :items="VISIBILITY_ITEMS" />
          <div v-if="sharing.visibility === 'teams'" class="flex flex-col gap-2">
            <UCheckbox v-for="t in teams" :key="t.id" v-model="sharing.teams[t.id]" :label="`${t.name} (${t.members})`" />
            <p v-if="!teams.length" class="text-sm text-muted">You're in no teams. <Link href="/teams" class="text-primary">Make one</Link>.</p>
          </div>
          <UAlert v-if="sharing.error" color="error" variant="subtle" :title="sharing.error" />
          <div class="flex items-center gap-3">
            <UButton type="submit" color="neutral" variant="outline" size="sm" :loading="sharing.pending" label="Save" />
            <span v-if="sharing.saved" class="text-sm text-muted">Saved.</span>
          </div>
        </form>

        <form v-if="isOwner" class="flex flex-col gap-4" @submit.prevent="saveNetwork">
          <div>
            <h3 class="font-semibold text-highlighted">Network</h3>
            <p class="text-sm text-muted">What the app's fetch() may reach. Apps hold their users' data, so allow only what it needs.</p>
          </div>
          <URadioGroup v-model="network.mode" name="network" :items="NETWORK_ITEMS" />
          <UFormField v-if="network.mode === 'allowlist'" label="Hosts" name="hosts" help="One per line. *.example.com allows its subdomains.">
            <UTextarea v-model="network.hosts" name="hosts" :rows="3" placeholder="api.github.com" class="w-full" />
          </UFormField>
          <UAlert v-if="network.error" color="error" variant="subtle" :title="network.error" />
          <div class="flex items-center gap-3">
            <UButton type="submit" color="neutral" variant="outline" size="sm" :loading="network.pending" label="Save" />
            <span v-if="network.saved" class="text-sm text-muted">Saved. Applies from the next request.</span>
          </div>
        </form>

        <div v-if="files.length" class="flex flex-col gap-3">
          <h3 class="font-semibold text-highlighted">Files of v{{ app.version }}</h3>
          <details v-for="f in files" :key="f.name" class="rounded-md border border-default">
            <summary class="cursor-pointer px-3 py-2 font-mono text-sm">{{ f.name }}</summary>
            <pre class="overflow-x-auto border-t border-default bg-elevated/50 p-3 text-xs leading-5">{{ f.body }}</pre>
          </details>
        </div>
      </div>
    </template>
  </USlideover>

  <FormDialog v-if="isOwner" ref="transferDialog" title="Transfer ownership" submit-label="Transfer" :pending="transfer.pending" :error="transfer.error" @submit="sendTransfer">
    <p class="text-sm text-muted">The new owner changes, shares and deletes {{ app.name }} from now on. You keep only what its sharing gives you<template v-if="app.visibility === 'private'">: nothing, as it's private</template>.</p>
    <UFormField label="New owner's email" name="email" help="They must have signed in to vibe once." required>
      <UInput v-model="transfer.email" type="email" placeholder="someone@example.com" class="w-full" required />
    </UFormField>
  </FormDialog>
  <ConfirmDelete v-if="isOwner && draft" ref="discardDialog" title="Discard the draft" confirm-label="Discard" :pending="drafting.pending" @confirm="discard">
    The draft and the data you tried it with go.<template v-if="app.version"> v{{ app.version }} stays as it is.</template>
  </ConfirmDelete>
  <ConfirmDelete v-if="isOwner" ref="confirm" title="Delete app" confirm-label="Delete app" :pending="removing" @confirm="remove">
    {{ app.name }} and all its versions go. Its users' data in it expires within 14 days.
  </ConfirmDelete>
</template>
