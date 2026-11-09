/**
 * PROACTIVE MEDICAL IMAGES — product orders 2026-11-09 ("Master Copilot
 * Surgery", "Ultimate Copilot Visual Engine", then "images not rendering":
 * the model wrote "Figure 2 : Diagramme…" captions instead of images).
 * Added to the FREE models' system prompt of both Copilots (the Workspace
 * route app/api/courses/chat and the Dashboard route
 * app/api/dashboard-assistant), so that a medical answer comes illustrated
 * without the student asking. A paid fallback never gets it: the images stay
 * at $0 in every respect (free models, the repositories' free APIs and
 * hosting).
 *
 * The format is spelled out with what NOT to write: only `![caption](link)`
 * becomes a picture. The link is presented for what it is — a search request
 * the engine verifies (lib/medical-images.ts) — so a model trained not to
 * invent URLs still writes one. What a model gets slightly wrong anyway is
 * repaired before display (lib/image-markdown-repair.ts).
 *
 * Left out where an image doesn't belong: a translation, QCM, flashcards, a
 * progressive clinical case (it would give the diagnosis away), "Synthèse
 * express", and a question about the student's own image.
 */
export const MEDICAL_IMAGE_DIRECTIVE = `ILLUSTRATIONS MÉDICALES PROACTIVES (sans attendre que l'étudiant les demande) : dès qu'une notion se comprend mieux avec un visuel — anatomie, histologie, physiologie, physiopathologie, sémiologie, imagerie, ECG, mécanisme pharmacologique —, insère des images dans ta réponse.

FORMAT OBLIGATOIRE — chaque image est UNE ligne seule, en Markdown image standard, exactement sous cette forme :
![Tracé ECG normal légendé : onde P, complexe QRS, onde T](https://upload.wikimedia.org/wikipedia/commons/a/ab/Normal_ECG_waveform_labeled.svg)
- Le « ! », la légende entre crochets [ ] et le lien entre parenthèses ( ) sont obligatoires, collés : ![légende](lien). C'est la seule écriture qui affiche une image ; la légende entre crochets s'affiche sous l'image.
- INTERDIT (rien ne s'afficherait) : une légende seule sans image (« Figure 2 : Diagramme… », « *Schéma : …* »), une numérotation « Figure 1, 2… », un lien sans « ! » ([texte](lien)), une URL nue, du HTML <img>, une image dans un bloc de code.
- Le lien est une demande d'image, pas une source à citer : le moteur d'images de MedArt vérifie chaque lien et affiche à sa place la meilleure illustration réelle trouvée dans plusieurs banques ouvertes (Wikimedia Commons, PubMed Central Open Access, Wellcome Collection). Écris donc toujours un lien, même sans connaître le fichier exact : https://upload.wikimedia.org/wikipedia/commons/a/ab/ suivi du nom exact du fichier si tu le connais (planches et schémas de référence : Blausen, Gray's Anatomy, OpenStax, NIH…), sinon d'un nom de fichier ANGLAIS fait des mots-clés précis du sujet et du type d'image (ex. ECG_lead_placement_diagram.svg, Chest_xray_right_pneumothorax.jpg, Liver_histology_lobule.jpg).
- La légende dit exactement ce que montre l'image et sa nature (schéma légendé, tracé ECG, radiographie, scanner, IRM, échographie, coupe histologique, photo clinique), dans la langue de ta réponse.
- Nombre : question large ou à plusieurs facettes → 3 à 4 images, une par facette, chacune juste après le paragraphe qu'elle illustre (ex. pour « Qu'est-ce qu'un ECG ? » : le tracé normal légendé, la position des électrodes et des dérivations, le tissu nodal). Question ciblée → 1 ou 2. Jamais deux fois la même image.
- Les images complètent l'explication, elles ne la remplacent jamais : le texte reste complet sans elles.
- Pas d'image pour une salutation, une question non médicale, une traduction, des QCM ou des flashcards, ni quand elle dévoilerait la réponse d'un exercice.`;
