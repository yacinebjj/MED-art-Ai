import type { ChargilyCheckout } from "@/lib/chargily";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, formatDZD, isPlanId } from "@/lib/pricing";
import { isEmailConfigured, sendEmail } from "./resend";
import { firstNameOf, paymentThankYouEmail, welcomeEmail, type PaymentKind } from "./templates";

/**
 * The app's automatic emails. Both entry points NEVER throw and never take
 * longer than NOTIFY_TIMEOUT_MS, so the sign-up redirect or the payment
 * webhook they run in can't be broken or held up by email.
 */

/**
 * Welcome emails go to accounts created from this date on, never to students
 * who signed up before the feature existed (one confirming an email change
 * through /auth/callback, say).
 */
const WELCOME_EMAILS_SINCE = Date.parse("2026-10-26T00:00:00.000Z");
/** app_metadata flag (writable by the server only) recording that the welcome email went out. */
const WELCOME_SENT_FLAG = "welcome_email_sent_at";
const NOTIFY_TIMEOUT_MS = 8000;

async function bounded(task: () => Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[email] ${label}: gave up after ${NOTIFY_TIMEOUT_MS} ms`);
          resolve();
        }, NOTIFY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error(`[email] ${label} failed:`, error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
  }
}

/** Absolute base for links in emails: APP_URL when set, else the origin of the request that triggered the email. */
function appUrl(origin: string): string {
  return (process.env.APP_URL || origin).replace(/\/+$/, "");
}

/**
 * Sends the welcome email once per new account: skipped when the account
 * predates the feature or the flag says it was already sent; Resend's
 * idempotency key covers two triggers racing (the sign-up form and
 * /auth/callback). The flag is only set after Resend accepted the email.
 */
export async function sendWelcomeEmailOnce(userId: string, origin: string): Promise<void> {
  if (!userId || !isEmailConfigured() || !isSupabaseConfigured()) return;
  await bounded(async () => {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      console.error(`[email] welcome: could not load user ${userId}:`, error?.message ?? "not found");
      return;
    }
    const user = data.user;
    const appMetadata: Record<string, unknown> = { ...(user.app_metadata ?? {}) };
    if (appMetadata[WELCOME_SENT_FLAG]) return;
    if (!user.email || !(Date.parse(user.created_at) >= WELCOME_EMAILS_SINCE)) return;

    const email = welcomeEmail({ firstName: firstNameOf(user.user_metadata?.full_name), appUrl: appUrl(origin) });
    const result = await sendEmail({ to: user.email, ...email, idempotencyKey: `welcome-${userId}`, tag: "welcome" });
    if (!result.ok) return;

    const { error: flagError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...appMetadata, [WELCOME_SENT_FLAG]: new Date().toISOString() },
    });
    if (flagError) console.error(`[email] welcome sent to ${userId} but the flag was not saved:`, flagError.message);
    else console.log(`[email] welcome sent to ${userId}`);
  }, `welcome ${userId}`);
}

/**
 * Thanks the payer once their payment is settled. Call it only AFTER a
 * successful claim + fulfilment (the once-only claim in
 * lib/chargily-settlement.ts is what makes it once per payment), and outside
 * the settlement's own try/catch: an email problem must never release a claim.
 */
export async function sendPaymentThankYouEmail(checkout: ChargilyCheckout, origin: string): Promise<void> {
  if (!isEmailConfigured()) return;
  await bounded(async () => {
    const metadata = checkout.metadata;
    if (!metadata?.userId || !isPlanId(metadata.plan)) return;

    // The account's current address and name; the checkout's own copy of the address is the fallback.
    let to = (metadata.email ?? "").trim();
    let firstName: string | null = null;
    if (isSupabaseConfigured()) {
      const { data } = await getSupabaseAdmin().auth.admin.getUserById(metadata.userId);
      if (data?.user) {
        to = data.user.email || to;
        firstName = firstNameOf(data.user.user_metadata?.full_name);
      }
    }
    if (!to) {
      console.warn(`[email] payment ${checkout.id}: no address to thank`);
      return;
    }

    const kind: PaymentKind = metadata.kind === "group_leader" || metadata.kind === "pool_member" ? metadata.kind : "individual";
    const currency = (checkout.currency || "dzd").toLowerCase();
    const amountLabel = currency === "dzd" ? formatDZD(checkout.amount) : `${checkout.amount} ${currency.toUpperCase()}`;
    const email = paymentThankYouEmail({
      firstName,
      planLabel: PLANS[metadata.plan].label,
      amountLabel,
      kind,
      reference: checkout.id,
      appUrl: appUrl(origin),
    });
    const result = await sendEmail({ to, ...email, idempotencyKey: `payment-${checkout.id}`, tag: "payment_thanks" });
    if (result.ok) console.log(`[email] payment thank-you sent for ${checkout.id}`);
  }, `payment thank-you ${checkout.id}`);
}
