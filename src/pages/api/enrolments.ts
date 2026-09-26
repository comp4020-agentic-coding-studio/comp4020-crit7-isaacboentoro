import type { APIRoute } from "astro";
import { enrol } from "../../lib/db";
import { bus } from "../../lib/events";

// A plain HTML form POSTs here; the 303 redirect makes it work with no
// client-side JavaScript at all — the submitting tab re-renders from the
// database, and every *other* open tab hears about it over the SSE stream.
// Capacity and the 18cp cap are real constraints (see src/lib/db.ts), not
// validation for its own sake, so a rejection redirects with a reason the
// page can show rather than silently doing nothing.
//
// The catalogue is ~6000 courses, so the redirect has to put the student
// back on the search they were reading. Those terms are rebuilt field by
// field rather than echoed from a caller-supplied URL, which would be an
// open redirect.
function backTo(form: FormData, error?: string): string {
  const params = new URLSearchParams();
  for (const field of ["q", "career", "year"]) {
    const value = String(form.get(field) ?? "").trim();
    if (value) params.set(field, value);
  }
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const unitId = Number(form.get("unitId"));
  if (!Number.isInteger(unitId)) return redirect(backTo(form), 303);

  const result = enrol(unitId);
  if (!result.ok) {
    if (result.reason === "not-found") return redirect(backTo(form), 303);
    return redirect(backTo(form, result.reason), 303);
  }

  bus.emit("enrolment", { type: "enrol" });
  return redirect(backTo(form), 303);
};
