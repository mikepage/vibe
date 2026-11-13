// The pages call the JSON API (routes/api) with fetch: the same endpoints
// scripts use. The CSRF middleware only lets JSON through.

export type Step = { step: string; attempt: number; ms?: number; message?: string }
export type Answer<T = Record<string, any>> = { ok: boolean; status: number; data: T & { error?: string; steps?: Step[] } }

export async function api<T = Record<string, any>>(method: string, url: string, body?: unknown): Promise<Answer<T>> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Answer<T>["data"]
  return { ok: res.ok, status: res.status, data }
}

/** A build's steps as lines: "attempt 1 · build 520 ms · 56 KB". */
export const stepLines = (steps: Step[] = []) =>
  steps.map((s) => `attempt ${s.attempt} · ${s.step}${s.ms != null ? ` ${s.ms} ms` : ""}${s.message ? ` · ${s.message}` : ""}`).join("\n")

/** Counts seconds while something runs, for "Writing and building… 12 s". */
export function stopwatch(onTick: (seconds: number) => void) {
  const started = Date.now()
  const timer = setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000)
  return () => clearInterval(timer)
}

/**
 * POSTs JSON to a route that answers with Server-Sent Events (EventSource can't POST), and calls
 * `onEvent` for each. Resolves when the stream ends. An error answer comes back as JSON, as
 * from `api()`.
 */
export async function streamEvents(url: string, body: unknown, onEvent: (event: string, data: any) => void): Promise<Answer> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok || !res.body || !res.headers.get("content-type")?.startsWith("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as Answer["data"]
    return { ok: false, status: res.status, data }
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  const frame = (raw: string) => {
    let event = "message"
    const data: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
    }
    if (!data.length) return
    try {
      onEvent(event, JSON.parse(data.join("\n")))
    } catch {
      onEvent(event, data.join("\n"))
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    let end: number
    while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
      frame(buffer.slice(0, end))
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "")
    }
  }
  if (buffer.trim()) frame(buffer)
  return { ok: true, status: res.status, data: {} }
}
