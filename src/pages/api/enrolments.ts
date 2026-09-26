import type { APIRoute } from "astro";
import { enrol } from "../../lib/db";
import { bus } from "../../lib/events";

// A plain HTML form POSTs here; the 303 redirect makes it work with no
// client-side JavaScript at all — the submitting tab re-renders from the
// database, and every *other* open tab hears about it over the SSE stream.
// Capacity and the 18cp cap are real constraints (see src/lib/db.ts), not
// validation for its own sake, so a rejection redirects with a reason the
// page can show rather than silently doing nothing.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const unitId = Number(form.get("unitId"));
  if (!Number.isInteger(unitId)) return redirect("/", 303);

  const result = enrol(unitId);
  if (!result.ok) {
    if (result.reason === "not-found") return redirect("/", 303);
    return redirect(`/?error=${result.reason}`, 303);
  }

  bus.emit("enrolment", { type: "enrol" });
  return redirect("/", 303);
};
