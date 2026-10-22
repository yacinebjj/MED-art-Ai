/**
 * Student-facing wording for payment-gateway trouble, shared by the server
 * (app/api/chargily/checkout) and the billing page (which also shows it on its
 * own timeouts and network errors) so both always say the same thing.
 */

/** Chargily (or the Algérie Poste / CIB network behind it) is down or overloaded: no payment page was opened. */
export const PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE =
  "La passerelle de paiement (Chargily / Algérie Poste) est momentanément surchargée ou indisponible. Rien n'a été débité : réessaie dans quelques minutes.";

/** The student came back without Chargily's own redirect (a 504 page, the back button, a closed tab). */
export const PAYMENT_INTERRUPTED_MESSAGE =
  "Ta page de paiement ne s'est pas terminée normalement — la passerelle Chargily / Algérie Poste connaît parfois des coupures (erreur 504). Si ton paiement a bien été débité, ton abonnement s'active automatiquement dès sa confirmation, sans rien faire de ton côté. Sinon, rien n'a été débité : réessaie dans quelques minutes.";
