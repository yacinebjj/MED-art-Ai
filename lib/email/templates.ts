/**
 * Transactional email templates (French, the app's language). Table-based
 * HTML with inline styles — what email clients (Gmail, Outlook, Apple Mail)
 * actually render — plus a plain-text twin. Every dynamic value is escaped.
 * Signed "MedArt AI" only, never a person.
 */

const BRAND = "MedArt AI";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface EmailParts {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  note?: string;
  cta: { label: string; url: string };
  closing: string;
  footnote: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** "Amina Benali" → "Amina"; empty or odd values → null (the email then greets without a name). */
export function firstNameOf(fullName: unknown): string | null {
  if (typeof fullName !== "string") return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first && first.length <= 40 ? first : null;
}

function render(parts: EmailParts): RenderedEmail {
  const paragraphs = parts.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155;">${escapeHtml(p)}</p>`)
    .join("");
  const bullets = parts.bullets?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;">${parts.bullets
        .map(
          (b) =>
            `<tr><td valign="top" style="width:22px;padding:6px 0;font-size:15px;line-height:1.6;color:#0891b2;font-weight:700;">&#10003;</td><td style="padding:6px 0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(b)}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const note = parts.note
    ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(parts.note)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(parts.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(parts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;font-family:${FONT};">
<tr><td style="background-color:#0e7490;background-image:linear-gradient(135deg,#0891b2,#6d28d9);padding:26px 32px;">
<span style="font-size:20px;font-weight:800;letter-spacing:0.3px;color:#ffffff;">${BRAND}</span>
</td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:800;color:#0f172a;">${escapeHtml(parts.heading)}</h1>
${paragraphs}${bullets}${note}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 26px;"><tr>
<td style="border-radius:12px;background-color:#0891b2;">
<a href="${escapeHtml(parts.cta.url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(parts.cta.label)}</a>
</td></tr></table>
<p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#334155;">${escapeHtml(parts.closing)}<br><strong style="color:#0f172a;">${BRAND}</strong></p>
</td></tr>
<tr><td style="padding:18px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">${escapeHtml(parts.footnote)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    parts.heading,
    "",
    ...parts.paragraphs.flatMap((p) => [p, ""]),
    ...(parts.bullets?.length ? [...parts.bullets.map((b) => `• ${b}`), ""] : []),
    ...(parts.note ? [parts.note, ""] : []),
    `${parts.cta.label} : ${parts.cta.url}`,
    "",
    parts.closing,
    BRAND,
    "",
    "—",
    parts.footnote,
  ].join("\n");

  return { subject: parts.subject, html, text };
}

export function welcomeEmail({ firstName, appUrl }: { firstName: string | null; appUrl: string }): RenderedEmail {
  return render({
    subject: `Bienvenue sur ${BRAND}`,
    preheader: "Ton espace de révision intelligent est prêt.",
    heading: firstName ? `Bienvenue, ${firstName} !` : `Bienvenue sur ${BRAND} !`,
    paragraphs: [
      `Ton compte est prêt. Avec ${BRAND}, tes cours deviennent un véritable espace de révision, pensé pour les études de santé.`,
    ],
    bullets: [
      "Importe tes cours (PDF) : explications, résumés et QCM sont générés pour toi.",
      "Pose tes questions au Copilot, ton assistant d'étude disponible à tout moment.",
      "Révise avec les flashcards et des sessions de concentration Pomodoro.",
      "Planifie tes révisions et suis ta progression jusqu'au jour de l'examen.",
    ],
    cta: { label: "Accéder à mon espace", url: `${appUrl}/dashboard` },
    closing: "Bonnes révisions,",
    footnote: `Tu reçois cet e-mail parce qu'un compte ${BRAND} vient d'être créé avec cette adresse.`,
  });
}

export type PaymentKind = "individual" | "group_leader" | "pool_member";

export function paymentThankYouEmail({
  firstName,
  planLabel,
  amountLabel,
  kind,
  reference,
  appUrl,
}: {
  firstName: string | null;
  planLabel: string;
  amountLabel: string;
  kind: PaymentKind;
  reference: string;
  appUrl: string;
}): RenderedEmail {
  const next =
    kind === "pool_member"
      ? {
          line: "Ta part est bien enregistrée. L'accès s'active pour tout le groupe dès que toutes les places sont réglées.",
          cta: { label: "Suivre mon groupe", url: `${appUrl}/dashboard/billing` },
        }
      : kind === "group_leader"
        ? {
            line: "Tes places sont prêtes : invite tes camarades depuis ta page Abonnement.",
            cta: { label: "Inviter mes camarades", url: `${appUrl}/dashboard/billing` },
          }
        : {
            line: "Ton abonnement est maintenant actif : toutes les fonctionnalités de ta formule sont débloquées.",
            cta: { label: "Commencer à réviser", url: `${appUrl}/dashboard` },
          };

  return render({
    subject: `Merci pour ton paiement — ${BRAND}`,
    preheader: `Paiement de ${amountLabel} reçu pour la formule ${planLabel}.`,
    heading: firstName ? `Merci, ${firstName} !` : "Merci pour ton paiement !",
    paragraphs: [`Nous avons bien reçu ton paiement de ${amountLabel} pour la formule « ${planLabel} ».`, next.line],
    note: `Référence du paiement : ${reference}`,
    cta: next.cta,
    closing: "Merci de ta confiance,",
    footnote: "Paiement traité par Chargily Pay. Aucun renouvellement automatique : tu restes libre de choisir la suite.",
  });
}
