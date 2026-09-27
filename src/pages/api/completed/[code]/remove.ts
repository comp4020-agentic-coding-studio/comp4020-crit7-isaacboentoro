import type { APIRoute } from "astro";
import { removeCompleted } from "../../../../lib/db";

// Forms only send GET/POST, so removing is a POST to its own path — the
// same shape as dropping an enrolment.
export const POST: APIRoute = async ({ params, redirect }) => {
  if (params.code) removeCompleted(params.code);
  return redirect("/", 303);
};
