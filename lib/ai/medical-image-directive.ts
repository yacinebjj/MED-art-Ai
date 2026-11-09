/**
 * PROACTIVE MEDICAL IMAGES — product orders 2026-11-09 ("Master Copilot
 * Surgery", then "Ultimate Copilot Visual Engine": several images for a
 * broad question, from several open repositories). Added to the FREE
 * models' system prompt of both Copilots (the Workspace route
 * app/api/courses/chat and the Dashboard route app/api/dashboard-assistant),
 * so that a medical answer comes illustrated without the student asking. A
 * paid fallback never gets it: the images stay at $0 in every respect (free
 * models, the repositories' free APIs and hosting).
 *
 * Left out where an image doesn't belong: a translation, QCM, flashcards, a
 * progressive clinical case (it would give the diagnosis away), "Synthèse
 * express", and a question about the student's own image.
 *
 * The model's link is never shown as written: every image is checked and
 * replaced by the best real picture across Wikimedia Commons, PubMed Central
 * Open Access and Wellcome Collection, or dropped (lib/medical-images.ts) —
 * hence the precise description, and "a descriptive English file name" when
 * the model doesn't know the exact one: those words find the real picture.
 */
export const MEDICAL_IMAGE_DIRECTIVE = `ILLUSTRATIONS MÉDICALES PROACTIVES (sans attendre que l'étudiant les demande) : dès qu'une notion se comprend mieux avec un visuel — anatomie, histologie, physiologie, physiopathologie, sémiologie, imagerie, ECG, mécanisme pharmacologique —, illustre ta réponse avec des images réelles, en Markdown standard, chacune seule sur sa ligne, juste après le paragraphe qu'elle illustre :
![Description médicale précise de ce que montre l'image, dans la langue de ta réponse](https://upload.wikimedia.org/wikipedia/commons/a/ab/Nom_exact_du_fichier.svg)
- Question large ou à plusieurs facettes : PLUSIEURS images (3 à 4), une par facette, chacune placée dans la partie qu'elle illustre — ex. pour « Qu'est-ce qu'un ECG ? » : le tracé normal légendé (onde P, complexe QRS, onde T), la position des électrodes et des dérivations, le tissu nodal qui conduit l'influx. Question ciblée : 1 ou 2 images. Jamais deux fois la même image.
- La description dit exactement ce que l'image doit montrer et sa nature (schéma légendé, tracé ECG, radiographie, scanner, IRM, échographie, coupe histologique, photo clinique) : le moteur d'images de MedArt s'en sert pour choisir la meilleure illustration réelle parmi plusieurs banques ouvertes (Wikimedia Commons, PubMed Central Open Access, Wellcome Collection) et n'affiche que des images vérifiées.
- Le lien : un fichier de Wikimedia Commons (upload.wikimedia.org/wikipedia/commons/…) avec son nom exact si tu le connais (planches et schémas de référence : Blausen, Gray's Anatomy, OpenStax, NIH…), sinon un nom de fichier anglais fait des mots-clés précis du sujet et du type d'image (ex. ECG_lead_placement_diagram.svg, Chest_xray_right_pneumothorax.jpg). Jamais une page web, jamais une image générée.
- Les images complètent l'explication, elles ne la remplacent jamais : le texte reste complet sans elles.
- Pas d'image pour une salutation, une question non médicale, une traduction, des QCM ou des flashcards, ni quand elle dévoilerait la réponse d'un exercice.`;
