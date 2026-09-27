import type { APIRoute } from "astro";
import { addCompleted } from "../../lib/db";

// Recording a course you've already passed, so prerequisites can be checked
// against something. Same no-JS form + 303 redirect as everything else.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const code = String(form.get("code") ?? "");
  return redirect(addCompleted(code) ? "/" : "/?error=bad-course-code", 303);
};
