/**
 * PROACTIVE MEDICAL IMAGES — product order 2026-11-09 ("Master Copilot
 * Surgery"). Added to the FREE models' system prompt of both Copilots (the
 * Workspace route app/api/courses/chat and the Dashboard route
 * app/api/dashboard-assistant), so that a medical answer comes illustrated
 * without the student asking. A paid fallback never gets it: the images stay
 * at $0 in every respect (free models, Wikimedia's free API and hosting).
 *
 * Left out where an image doesn't belong: a translation, QCM, flashcards, a
 * progressive clinical case (it would give the diagnosis away), "Synthèse
 * express", and a question about the student's own image.
 *
 * The model's link is never shown as written: every image is checked against
 * Wikimedia Commons and replaced by the real file, or dropped
 * (lib/medical-images.ts) — hence "a descriptive English file name" when it
 * doesn't know the exact one: those words find the real file.
 */
export const MEDICAL_IMAGE_DIRECTIVE = `ILLUSTRATION MÉDICALE PROACTIVE (sans attendre que l'étudiant la demande) : dès que la notion se comprend mieux avec un visuel — anatomie, histologie, physiologie, physiopathologie, sémiologie, imagerie, ECG, mécanisme pharmacologique —, intègre UNE image (deux au maximum) de Wikimedia Commons, en Markdown standard, seule sur sa ligne, juste après le paragraphe où la notion est expliquée :
![Description médicale précise de ce que montre l'image, dans la langue de ta réponse](https://upload.wikimedia.org/wikipedia/commons/a/ab/Nom_exact_du_fichier.svg)
- Uniquement Wikimedia Commons (upload.wikimedia.org/wikipedia/commons/…) : un lien direct vers le fichier image (.svg, .png ou .jpg) — jamais une page web, jamais un autre site, jamais une image générée.
- Le nom exact du fichier tel qu'il existe sur Commons (planches et schémas de référence : Blausen, Gray's Anatomy, OpenStax, NIH…). Si tu n'en es pas certain, un nom de fichier anglais fait des mots-clés précis du sujet (ex. Nephron_diagram.svg) : chaque lien est vérifié automatiquement et seule une image réelle de Commons est affichée.
- L'image complète l'explication, elle ne la remplace jamais : le texte reste complet sans elle.
- Pas d'image pour une salutation, une question non médicale, une traduction, des QCM ou des flashcards, ni quand elle dévoilerait la réponse d'un exercice.`;
