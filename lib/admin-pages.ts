// Loaders behind /admin: the 404 everyone but a super admin gets, so the view isn't there for them.
import type { Context } from "hono"
import { isAdmin } from "./admin.ts"

export const adminOnly = (c: Context) => (isAdmin() ? null : c.text("Not found.", 404))
