import type { APIRoute } from "astro";
import { enrol } from "../../lib/db";
import { bus } from "../../lib/events";

// A plain HTML form POSTs here; the 303 redirect makes it work with no
// client-side JavaScript at all — the submitting tab re-renders from the
// database, and every *other* open tab hears about it over the SSE stream.
// Capacity and the credit cap are real constraints (see src/lib/db.ts), not
// validation for its own sake, so a rejection redirects with a reason the
// page can show rather than silently doing nothing.
//
// The catalogue is ~6000 courses, so the redirect has to put the student
// back on the search they were reading. Those terms are rebuilt field by
// field rather than echoed from a caller-supplied URL, which would be an
// open redirect.
function backTo(form: FormData, note?: { error: string } | { used: string }): string {
  const params = new URLSearchParams();
  for (const field of ["q", "career", "year", "session"]) {
    const value = String(form.get(field) ?? "").trim();
    if (value) params.set(field, value);
  }
  if (note && "error" in note) params.set("error", note.error);
  if (note && "used" in note) params.set("used", note.used);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const unitId = Number(form.get("unitId"));
  if (!Number.isInteger(unitId)) return redirect(backTo(form), 303);

  // which offering of the course to enrol in — enrol() checks it is one the
  // catalogue actually lists
  const session = String(form.get("enrolSession") ?? "").trim();
  // optional: a convener's permission code lifting one specific rule
  const permissionCode = String(form.get("permissionCode") ?? "").trim();

  const result = enrol(unitId, session, permissionCode || undefined);
  if (!result.ok) {
    if (result.reason === "not-found") return redirect(backTo(form), 303);
    return redirect(backTo(form, { error: result.reason }), 303);
  }

  bus.emit("enrolment", { type: "enrol" });
  // codes are single-use, so say when one was actually spent
  return redirect(backTo(form, result.usedCode ? { used: result.usedCode } : undefined), 303);
};
