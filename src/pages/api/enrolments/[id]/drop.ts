import type { APIRoute } from "astro";
import { dropEnrolment } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// Forms only send GET/POST, so dropping an enrolment is a POST to its own
// path rather than a DELETE — same no-JS-required pattern as enrolling.
export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  if (Number.isInteger(id) && dropEnrolment(id)) {
    bus.emit("enrolment", { type: "drop" });
  }
  return redirect("/", 303);
};
