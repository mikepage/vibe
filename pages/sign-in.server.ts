import { defineHandler, type InferProps } from "void"
import { safeNext } from "../lib/pages.ts"

export type Props = InferProps<typeof loader>

// Local only: behind Access there are no passwords, and middleware/01.session.ts
// sends signed-in visitors (everyone, behind Access) on to the apps.
export const loader = defineHandler((c) => ({ next: safeNext(c.req.query("next")) }))
