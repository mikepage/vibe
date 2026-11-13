import { apps } from "@schema";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { appFor, fail, json } from "../../../../lib/http.ts";
import { OUTBOUND_MODES, parseHosts, type OutboundMode } from "../../../../lib/outbound.ts";

// { mode: "disabled" | "allowlist" | "all", hosts?: string[] | string }: what the app's
// fetch() may reach (lib/outbound.ts). Only the owner changes it; it applies from the
// next request, in a new isolate.
export const PUT = defineHandler(async (c) => {
  const app = await appFor(c, "edit");
  if (app instanceof Response) return app;
  const body = await json<{ mode: string; hosts: string[] | string }>(c);
  const mode = body.mode as OutboundMode;
  if (!OUTBOUND_MODES.includes(mode)) return fail(c, 400, 'mode is "disabled", "allowlist" or "all".');
  const parsed = mode === "allowlist" ? parseHosts(body.hosts) : { hosts: [] };
  if ("error" in parsed) return fail(c, 400, parsed.error);
  if (mode === "allowlist" && parsed.hosts.length === 0) return fail(c, 400, "List at least one host.");
  await db.update(apps).set({ outbound: mode, outboundHosts: JSON.stringify(parsed.hosts), updatedAt: Date.now() }).where(eq(apps.id, app.id));
  return { id: app.id, mode, hosts: parsed.hosts };
});
