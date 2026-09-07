# ARCHITECTURE VERROUILLÉE — Golden Standard (Studio)

**Statut : VERROUILLÉ.** Ce document fait foi. Ne pas modifier la structure décrite ci-dessous sans un ordre direct et explicite de l'utilisateur dans une session future.

## Règle fondamentale

Le Studio (`app/dashboard/module/[id]/page.tsx` + `app/api/studio/*`) a atteint un état stable validé par l'utilisateur le 2026-08-10. Le comportement officiel est :

> L'étudiant entre son cours → le système utilise EXACTEMENT l'UI actuelle ("la carcasse") pour afficher le contenu. Seul le fond (le texte généré par l'IA) change en fonction du cours source. La structure visuelle ne change JAMAIS d'un cours à l'autre.

## Ce qui est STRICTEMENT VERROUILLÉ (ne pas toucher sans ordre direct)

Pour les 6 onglets — Explication, Résumé, Cas Clinique, QCM/Examen, Mind Map, Exemples et Analogies :

1. **Les composants React** de rendu (`GastriteResumeStudio`, `GastriteCasCliniqueStudio`, `GastriteQcmsStudio`, `DynamicMindMapStudio`, et tout composant Studio équivalent pour Explication/Exemples & Analogies) — structure JSX, layout, styles, zones, grilles.
2. **`components/course/workspace/DynamicMindMapStudio.tsx`** — v8, "Poster Infographique Vectoriel" (SVG + `foreignObject`, fond parchemin, bandeaux Kalam, zones Notions Fondamentales / Illustration / Cascade / Protocole / Signes de Gravité, zoom/pan). Géométrie vérifiée sans chevauchement ni dépassement (voir historique de session).
3. **Les system prompts** dans `lib/ai/studio-prompts.ts` (`STUDIO_RESUME_SYSTEM_PROMPT`, `STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT`, `STUDIO_MIND_MAP_SYSTEM_PROMPT`, etc.) — les instructions de profondeur narrative, physiopathologie, icônes par nœud, `ideogram_prompt` sans texte.
4. **Les schémas zod** dans `lib/ai/studio-schemas.ts` — la forme des données attendues de l'IA.
5. **Le pipeline Auto-Save + Multi-Course** : `app/api/studio/courses/route.ts`, `app/api/studio/courses/[id]/route.ts`, la table Supabase `studio_courses`, et la logique de `page.tsx` (état `courses`/`activeCourse`, `key={activeCourse.id}` sur chaque composant Studio pour forcer le remount et éviter le state-bleed entre cours).
6. **L'intégration Ideogram** (`lib/ai/ideogram.ts`) — image d'accent SANS TEXTE, échec ouvert (fail-open, ne bloque jamais le reste de la tuile).

## Ce qui reste AUTORISÉ sans ordre spécial

- Corrections de bugs qui cassent le comportement décrit ci-dessus (ex. : une régression qui fait planter le rendu, une vraie faille de sécurité, une régression d'auth).
- Ajout de nouvelles fonctionnalités **hors** de ces 6 onglets, si demandé explicitement.
- Tout changement explicitement commandé par l'utilisateur dans une session future — cette règle protège contre les modifications *non demandées*, pas contre une nouvelle demande claire.

## Historique de stabilisation (contexte, ne pas ré-ouvrir sans raison)

- Prompts Résumé/Cas Clinique enrichis pour profondeur narrative et physiopathologique.
- Mind Map : 3 architectures tentées (v3/v4 pills HTML, v6 image IA avec texte intégré — **a échoué en vrai test, texte garbled**), verrouillé sur v8 (poster SVG vectoriel + accent Ideogram sans texte).
- v8 vérifié géométriquement (bounding boxes des `foreignObject`) sur un vrai run de génération : aucun chevauchement, aucun dépassement, aucune troncature de texte. Bug de chevauchement des compteurs "+N autres" corrigé (fondus dans les bandeaux de zone au lieu de captions flottantes) ; `FUNDAMENTALS_CAP` réduit de 9 à 6 pour éviter un débordement de la grille au-delà du cadre de zone.
- Course de race d'authentification (401 "Invalid Refresh Token") résolue par singleton client + coalescing des requêtes par empreinte de cookie — jamais par suppression du contrôle d'auth.
- Auto-Save + Multi-Course : isolation stricte par cours via `key={activeCourse.id}`, persistance Supabase (`studio_courses`), plus aucune régénération inutile au retour sur un cours déjà généré.

**Dernière validation utilisateur : 2026-08-10 — "état stable", verrouillage demandé explicitement.**
