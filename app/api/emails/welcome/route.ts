import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/supabase/session-server";
import { sendWelcomeEmailOnce } from "@/lib/email/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — called by the sign-up form right after an account is created with a
 * session (no email confirmation step). Sends the signed-in student their
 * welcome email; once per account, whatever the number of calls
 * (lib/email/notifications.ts). Always 204: the result is only in the logs.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (user) await sendWelcomeEmailOnce(user.id, request.nextUrl.origin);
  return new NextResponse(null, { status: 204 });
}
