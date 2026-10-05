import { NextResponse } from "next/server";
import type { PaywallReason } from "@/lib/subscription";

/** Header read by components/billing/PaywallProvider to open the paywall / limit screen. */
export const PAYWALL_HEADER = "x-medart-paywall";

/**
 * Uniform response for a blocked quota gate: 403, `{ success: false, error,
 * paywall }`, plus the PAYWALL_HEADER so the client can react whatever
 * feature made the call.
 */
export function quotaBlockedResponse(gate: { reason: string; paywall?: PaywallReason }, status = 403): NextResponse {
  return NextResponse.json(
    { success: false, error: gate.reason, ...(gate.paywall ? { paywall: gate.paywall } : {}) },
    { status, headers: gate.paywall ? { [PAYWALL_HEADER]: gate.paywall } : undefined }
  );
}
