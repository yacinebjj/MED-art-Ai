import { DEMO_SECTIONS } from "@/lib/demo-content";
import type { QcmItem, QrocItem } from "@/lib/types";

// "ulcere" was removed: it was a dead legacy entry pointing at
// /dashboard/demo/ulcere, a URL nothing in the UI links to anymore. The
// real, complete Ulcère course lives in Supabase at the DIFFERENT slug
// "ulcere-gastrique" (auto-generated at upload time from its title) — that
// one already renders correctly through the generic Supabase pipeline, so
// there was never anything to migrate for it, just a stale pointer to delete.
//
// "rectocolite" was removed the same way it was fixed: migrated into a real
// Supabase row (slug "la-rectocolite-hemorragique-rch-1785846798448",
// auto-generated from its title) via the normal authenticated upload flow —
// it now renders through the generic Supabase pipeline like any other
// course, so this hardcoded fallback is no longer needed.
export type CourseSlug = "appendicite" | "gastrite";

export interface CourseSlugSource {
  fileName: string;
  size: string;
}

export interface CourseSlugContent {
  title: string;
  content: string;
  source: CourseSlugSource;
  /**
   * Optional per-tab content for the other Studio tabs (Résumé, Cas Clinique,
   * QCM). When present for a slug, the workspace page renders these as
   * markdown instead of the fixed appendicite-specific interactive components
   * (ResumeStudio, CasCliniqueStudio, ExamQcmStudio).
   */
  resume?: string;
  casClinique?: string;
  qcm?: string;
}

/* ----------------------------------------------------------------------- */
/* Supabase-backed "courses" table row shapes — one slug (e.g. "gastrite")  */
/* fetched via GET /api/courses/slug/[slug]. Field names mirror the JSON    */
/* stored in Supabase exactly (no renaming at the fetch boundary), so the   */
/* Gastrite*Studio components' `data` props match the DB row 1:1. Only     */
/* `icon` strings need resolving to a Lucide component — see               */
/* lib/lucide-icon-lookup.ts.                                              */
/* ----------------------------------------------------------------------- */

export interface GastriteResumeCard {
  titre: string;
  type?: string;
  tone?: string;
  content?: string;
  items: string[];
}

export interface GastriteResumeTable {
  headers: string[];
  rows: string[][];
}

export interface GastriteResumeSection {
  numero: number;
  titre: string;
  intro: string;
  outro: string;
  cards: GastriteResumeCard[];
  table: GastriteResumeTable;
  rows: Record<string, string>[];
  items: string[];
}

export interface GastriteResumeHero {
  tags: string[];
  badge: string;
  titre: string;
  intro: string;
  sous_titre: string;
}

export interface GastriteDdxTable extends GastriteResumeTable {
  titre: string;
  intro: string;
}

export interface GastritePiegeItem {
  numero: number;
  text: string;
}

export interface GastritePiegeCategory {
  nom: string;
  items: GastritePiegeItem[];
}

export interface GastritePieges {
  titre: string;
  intro: string;
  categories: GastritePiegeCategory[];
}

export interface GastriteGuidelineStep {
  numero: number;
  titre: string;
  content: string;
}

export interface GastriteQuote {
  text: string;
  contexte: string;
}

export interface GastritePerle {
  type: "perle" | "astuce";
  text: string;
}

export interface GastriteAstuceItem {
  numero: number;
  titre: string;
  acronyme: string;
  chiffres: string;
  image: string;
  citation: string;
  content: string;
  details: string[];
}

export interface GastriteResumeMode {
  id: "smart" | "exam" | "cheatsheet" | "guideline" | "professor" | "astuces";
  label: string;
  hero: GastriteResumeHero;
  sections: GastriteResumeSection[];
  ddx_table: GastriteDdxTable;
  pieges: GastritePieges;
  cards: GastriteResumeCard[];
  steps: GastriteGuidelineStep[];
  quotes: GastriteQuote[];
  perles: GastritePerle[];
  items: GastriteAstuceItem[];
}

export interface GastriteResumeData {
  slug: string;
  section: string;
  tombabilite: number;
  modes: GastriteResumeMode[];
}

export interface GastriteCaseVital {
  label: string;
  value: string;
  alert: boolean;
}

export interface GastriteCaseDialogueLine {
  speaker: "patient" | "medecin" | "autre";
  name: string;
  tone: string;
  text: string;
  pourquoi: string;
}

export interface GastriteCaseExamStep {
  action: string;
  pourquoi: string;
}

export interface GastriteCaseParaclinicalItem {
  label: string;
  result: string;
  pourquoi: string;
}

export interface GastriteCaseDdxItem {
  maladie: string;
  raisonnement: string;
  pourquoi: string;
}

export interface GastriteCaseRxItem {
  ligne: string;
  pourquoi: string;
}

/** Raw shape of one `cases[]` entry exactly as stored in Supabase — icon as a string, verbose acteN_xxx field names. */
export interface GastriteRawCase {
  id: string;
  numero: number;
  archetype: string;
  icon: string;
  color: string;
  titre: string;
  scene: string;
  vitals: GastriteCaseVital[];
  acte1_interrogatoire: GastriteCaseDialogueLine[];
  acte2_examen_physique: GastriteCaseExamStep[];
  acte3_examens_complementaires: GastriteCaseParaclinicalItem[];
  acte4_raisonnement: { items: GastriteCaseDdxItem[]; conclusion: string };
  acte5_prise_en_charge: { items: GastriteCaseRxItem[]; surveillance: string };
}

export interface GastriteCasCliniqueData {
  slug: string;
  section: string;
  titre_section: string;
  cases: GastriteRawCase[];
}

/**
 * Matches QCMS_SYSTEM_PROMPT's schema exactly (lib/prompts/public-course-sections.ts)
 * — this is the raw value stored in `courses.qcms`, nothing more. It never
 * contains a course slug (a prior version of this type incorrectly declared
 * one, which silently meant `data.slug` was always `undefined` wherever this
 * type was consumed — see GastriteQcmsStudio.tsx's `courseSlug` prop for the
 * fix: the real course slug is passed down separately by the page that
 * already has it in scope, not read off this data blob.
 */
export interface GastriteQcmsData {
  titre_section: string;
  qcms: QcmItem[];
  qrocs: QrocItem[];
}

/** One node of the AI Mind Map graph — shape matches MIND_MAP_SYSTEM_PROMPT's schema exactly (lib/prompts/public-course-sections.ts). */
export interface MindMapNode {
  id: string;
  label: string;
  type: "symptome" | "mecanisme" | "diagnostic" | "examen" | "traitement";
}

export interface MindMapLink {
  source: string;
  target: string;
  label: string;
}

/** No `slug`/`section` wrapper here (unlike the Gastrite*Data types above) — the AI's raw JSON output for this section is exactly `{ nodes, links }`, nothing more. */
export interface MindMapData {
  nodes: MindMapNode[];
  links: MindMapLink[];
}

/**
 * The full `courses` table row for one slug, as returned by GET
 * /api/courses/slug/[slug] — any slug, not just gastrite.
 *
 * Lazy-loading architecture: a freshly-uploaded course only has `slug`,
 * `title` and (server-side only) its source text filled in — every content
 * column below starts `null` and is generated on demand, the first time the
 * student clicks "Générer ..." on its Studio tab (see the 5 routes under
 * app/api/generate/*).
 */
export interface CourseSlugSupabaseData {
  slug: string;
  title: string;
  explication: string | null;
  resume: GastriteResumeData | null;
  cas_clinique: GastriteCasCliniqueData | null;
  qcms: GastriteQcmsData | null;
  mind_map: MindMapData | null;
  /** Markdown, like `explication` — Darija (Arabic script) mixed with French medical terms. See lib/prompts/public-course-sections.ts's EXEMPLES_ANALOGIES_SYSTEM_PROMPT. */
  exemples_analogies: string | null;
}

const APPENDICITE_CONTENT = DEMO_SECTIONS.find((s) => s.id === "explication")!.content;

const GASTRITE_CONTENT = `# La Gastrite : Comprendre l'inflammation de l'estomac

## Un cours complet, expliqué avec des mots très simples

Bonjour. On va apprendre la gastrite ensemble. Je vais parler avec des mots faciles. Des phrases courtes. Beaucoup d'exemples de la vie de tous les jours. Mon but est simple : tu dois tout comprendre, même si certains mécanismes sont fins.

Ne va pas trop vite. Lis chaque ligne. Chaque petite idée aide à comprendre la suivante. À la fin, tu vas connaître la gastrite très bien. Et tu vas la comprendre, pas juste la réciter.

Ce cours est très long. C'est fait exprès. Un vrai médecin ne connaît pas juste le nom de la maladie. Il connaît chaque petit détail. Il sait pourquoi chaque chose arrive. Alors prends ton temps. On a tout notre temps.

> Ce cours est long. C'est normal. Un bon médecin prend son temps pour comprendre. Va à ton rythme, fais des pauses, et reviens quand tu veux.

## Sommaire

- ● Avant-propos : pourquoi ce cours est important
- ● Chapitre I : L'estomac, c'est quoi ?
- ■ Chapitre II : Un mur protégé par un bouclier
- ▲ Chapitre III : Le duel entre l'acide et le mucus
- ● Chapitre IV : Les faux amis
- ■ Chapitre V : Les cinq degrés de la gastrite
- ▲ Chapitre VI : Pourquoi la douleur change selon la cause
- ● Chapitre VII : H. pylori, le petit voisin qui abîme tout
- ■ Chapitre VIII : Les AINS, l'alarme chimique de la cellule
- ▲ Chapitre IX : Les pompiers du corps
- ● Chapitre X : Pourquoi le ventre brûle
- ■ Chapitre XI : Qui a besoin d'un examen tout de suite ?
- ▲ Chapitre XII : Les outils du médecin
- ● Chapitre XIII : Comment on soigne
- ■ Chapitre XIV : Avant, pendant et après la trithérapie
- ▲ Chapitre XV : L'erreur qui peut coûter cher
- ● Récapitulatif

## AVANT-PROPOS : Pourquoi ce cours est important

La gastrite est une maladie très fréquente. Tu vas la voir souvent dans ta vie de médecin. Très souvent. C'est peut-être le trouble digestif que tu vas rencontrer le plus dans toute ta carrière.

Le problème, c'est qu'elle sait se cacher. Parfois elle a l'air d'un simple mal de ventre. Un petit truc de rien du tout. Et pourtant, elle peut évoluer, avec le temps, vers un ulcère, puis vers un saignement. C'est ça, le piège. Une maladie qui a l'air simple mais qui peut devenir sérieuse.

Dans une grande ville, c'est plus facile. Il y a l'hôpital juste à côté. Il y a des machines pour voir dans le ventre. Il y a des gastro-entérologues prêts à faire une endoscopie rapidement. Si tu as un doute, tu demandes un examen, et tu as la réponse en quelques jours.

Mais dans beaucoup de régions, ce n'est pas comme ça. L'endoscopie est loin. Très loin. Parfois à plusieurs heures de route. Il n'y a pas toujours de machine pour voir dans l'estomac. Là, tout change. Ton raisonnement change. Tes décisions changent.

Attends, réponds-moi : qu'est-ce qui change quand l'endoscopie est à quatre heures de route ? Réfléchis avant de lire la suite.

>> La réponse : tu ne peux plus attendre d'être sûr à 100 pour cent. Tu dois parfois traiter la cause la plus probable en premier, sans attendre la confirmation par l'image. Mieux vaut traiter une cause probable que laisser une gastrite s'aggraver en silence.

C'est le fil rouge de tout ce cours. On va y revenir souvent. Retiens-le dès maintenant : loin de l'endoscopie, le raisonnement clinique est ton meilleur allié.

Dans ce cours, on va faire un long voyage. On va commencer tout petit, par l'anatomie. On va voir où se trouve la paroi et comment elle se protège. Puis on va descendre encore plus petit, jusqu'aux cellules et aux molécules. Ensuite on va remonter vers le malade, vers les signes, vers les décisions. Et à la fin, tu sauras quoi faire, étape par étape.

## CHAPITRE I : L'estomac, c'est quoi ?

Avant de comprendre la maladie, il faut connaître l'organe. C'est logique. On ne peut pas réparer une chose qu'on ne connaît pas.

### Où se trouve l'estomac ?

Imagine un grand sac musclé, juste sous les côtes, un peu à gauche. C'est l'estomac. Il reçoit la nourriture qui arrive de l'œsophage, et il la mélange, la broie, et commence à la digérer avant de l'envoyer vers l'intestin.

Sur toute sa surface intérieure, il y a une fine paroi, la muqueuse. C'est elle qui fabrique l'acide. C'est elle aussi qui fabrique le mucus qui la protège. Retiens bien ce mot : muqueuse. C'est le personnage principal de tout ce cours.

Pense à un sac qui fabrique en permanence un liquide capable de dissoudre un morceau de viande, mais qui ne se dissout jamais lui-même. Garde bien cette image du sac qui se protège de son propre contenu.

### Un organe qui vit dangereusement

Le point où l'estomac reçoit la nourriture, le cardia, et le point où il la libère, le pylore, ne changent jamais de place, chez tout le monde. Ce sont des repères sûrs pour le médecin et pour l'endoscopiste.

Mais la muqueuse, elle, peut s'enflammer n'importe où sur sa surface. C'est comme une grande carte qui peut rougir à différents endroits selon la cause. Voici les zones les plus concernées :

➔ **Le fundus et le corps de l'estomac** : c'est la zone la plus riche en glandes qui fabriquent l'acide. Souvent touchée dans la gastrite auto-immune.

➔ **L'antre**, vers la sortie de l'estomac : c'est la zone préférée de H. pylori, qui aime s'y installer en priorité.

➔ **Toute la muqueuse à la fois** : c'est souvent le cas dans les gastrites aiguës liées aux AINS ou à l'alcool, qui n'épargnent aucune zone.

■ Retiens une image forte : l'estomac est un **sac fermé qui digère sans se digérer**. Une seule entrée, une seule sortie, et une paroi qui doit se protéger sans arrêt entre les deux. Cette idée du sac auto-protégé, c'est la clé de toute la maladie. On va la répéter souvent.

### Pourquoi cette organisation est fragile

Réfléchis une seconde. Un organe qui fabrique un poison pour lui-même doit avoir un système de protection parfait, sans la moindre faille. S'il y a la moindre fissure dans ce système, le poison touche directement les tissus vivants.

Alors si la protection faiblit ne serait-ce qu'à un seul endroit, l'acide attaque directement les cellules à cet endroit précis. C'est comme une combinaison de plongée avec un tout petit trou : l'eau froide s'infiltre exactement par ce trou, même si le reste de la combinaison est intact. Cette fragilité simple explique presque tout ce qui va suivre.

> **L'Astuce du Prof :** en endoscopie, si tu ne sais pas dans quelle zone tu te trouves, regarde les plis de la muqueuse. Dans le corps de l'estomac, ils sont épais et parallèles. Vers l'antre, ils s'aplatissent. C'est un repère simple qui aide à se situer.

> ملخص بالعربية : المعدة كيس عضلي يفرز حمضاً قوياً لهضم الطعام، وتحمي نفسها بواسطة الغشاء المخاطي. أي ضعف بسيط في هذا الغشاء يعرضه مباشرة لهجوم الحمض.

## CHAPITRE II : Un mur protégé par un bouclier

Beaucoup d'étudiants pensent que la muqueuse est une simple peau passive. C'est faux. Complètement faux. Cette paroi travaille sans arrêt. Et ce travail explique pourquoi elle tombe malade.

### Une caserne de cellules bien organisée

Dans la paroi de l'estomac, il y a plusieurs types de cellules, rangées dans de minuscules glandes creusées dans la muqueuse. Certaines fabriquent l'acide chlorhydrique. D'autres fabriquent le mucus protecteur. D'autres encore fabriquent des enzymes digestives ou des hormones locales.

On peut voir cette paroi comme une petite usine à plusieurs postes de travail, toujours en activité. Une base logistique cachée dans le ventre, prête à digérer, mais aussi prête à se défendre.

### Le bouclier de mucus et de bicarbonate

Pourquoi cet acide puissant ne détruit-il pas l'estomac lui-même ? Réfléchis une seconde avant de lire la suite.

⮞ La réponse : la paroi fabrique aussi, en continu, un épais tapis de mucus, un gel visqueux qui recouvre toute la surface intérieure. Ce mucus retient du bicarbonate, une substance qui neutralise l'acide juste au contact de la paroi. En plus, la paroi reste bien irriguée par le sang, ce qui lui permet de se réparer très vite en cas de petite lésion.

C'est comme un mur recouvert d'une peinture spéciale qui résiste au feu : le feu, c'est-à-dire l'acide, brûle juste devant, tout autour, mais jamais le mur lui-même, tant que la peinture reste intacte.

■ Retiens cette image forte : l'estomac vit en équilibre permanent entre une force qui attaque, l'acide et la pepsine, et une force qui protège, le mucus, le bicarbonate et la bonne circulation sanguine. Tant que cet équilibre est respecté, la paroi reste saine. La gastrite commence toujours au moment précis où cet équilibre se casse.

### Pourquoi cette organisation est vulnérable

Cette caserne de cellules n'est pas toujours dans le même état. Elle peut être renforcée ou affaiblie selon l'âge, les habitudes de vie, les médicaments pris, ou une infection installée depuis longtemps.

Et devine quoi ? C'est justement quand cette caserne est affaiblie que la moindre agression suffit à faire pencher la balance. Plus le bouclier est mince, plus une petite attaque peut créer une grande inflammation. Tu vas comprendre.

> ملخص بالعربية : جدار المعدة يصنع الحمض لكنه يحمي نفسه بطبقة من المخاط والبيكربونات وتدفق دموي جيد. أي ضعف في هذا الدرع يجعل الجدار عرضة للالتهاب.

## CHAPITRE III : Le duel entre l'acide et le mucus

Il y a une deuxième chose importante à comprendre. Ce duel entre l'acide et le mucus n'est jamais figé. Il bouge, il évolue, minute après minute.

### Comment l'équilibre bascule

Dis-moi, d'après toi : de combien de façons peut-on casser un équilibre entre deux forces ? Réfléchis avant de lire la suite.

⮞ Il n'y a que deux façons, en réalité. Soit on augmente la force qui attaque, plus d'acide, ou une agression directe de la paroi. Soit on diminue la force qui protège, moins de mucus, moins de bicarbonate, moins de sang qui arrive. Souvent, c'est un mélange des deux qui se produit en même temps.

Tant que le bouclier est intact, ce duel tourne à l'avantage de la protection. Personne n'y pense. Tout va bien. La muqueuse reste rose et saine.

### Ce qui se passe quand le bouclier s'amincit

Mais réfléchis deux secondes. Que se passe-t-il si le bouclier s'amincit à un endroit précis ? L'acide, qui continue d'être fabriqué comme toujours, touche alors directement les cellules à cet endroit.

⮞ Ces cellules irritées libèrent des substances qui appellent les cellules de défense du corps sur place.

⮞ Ces cellules de défense arrivent en nombre et provoquent une vraie inflammation locale : la paroi rougit, gonfle, devient sensible au contact.

⮞ Et pendant ce temps, l'acide continue d'arriver, sans interruption, sur une paroi déjà fragilisée.

Voilà comment un simple amincissement du bouclier change tout. Avant, la paroi était protégée, nettoyée en permanence par son propre mucus. Maintenant, c'est une zone enflammée, rouge, qui s'irrite un peu plus à chaque contact avec l'acide.

>> Point clé à retenir : la gastrite n'est pas un trou, ce n'est pas une perte de substance profonde. C'est une muqueuse irritée, rouge, enflammée, mais globalement encore intacte en surface, un peu comme une peau qui rougit après un coup de soleil. Le jour où un vrai cratère apparaît, qui s'enfonce plus profondément dans la paroi, on ne parle plus de gastrite mais d'ulcère. Garde cette différence bien en tête : gastrite = irritation de surface, ulcère = perte de substance en profondeur.

> ملخص بالعربية : عندما يضعف الدرع الواقي في منطقة معينة، يهاجم الحمض الخلايا مباشرة فتلتهب، وهذا هو بداية التهاب المعدة.

## CHAPITRE IV : Les faux amis

Attention. Ce chapitre est important. Écoute bien. Concentre-toi.

Toute douleur en haut du ventre n'est PAS une gastrite. Je répète, car c'est important : toute douleur épigastrique n'est pas une gastrite. Plusieurs maladies portent le même masque. Elles ressemblent à la gastrite, mais ce sont autre chose. Si tu te trompes, tu peux passer à côté d'un vrai problème.

### Le piège numéro un : l'ulcère et le reflux

>>> Danger : chez tout malade avec une douleur épigastrique qui dure, il faut toujours éliminer un ulcère déjà constitué, ou un reflux gastro-œsophagien important. Ces deux maladies partagent beaucoup de symptômes avec la gastrite, mais leur prise en charge peut différer, surtout si des signes d'alarme apparaissent.

Comment faire la différence au début ? Ce n'est pas toujours possible sans examen. C'est justement pour ça que l'endoscopie reste si précieuse quand le doute persiste.

### Les autres faux amis à connaître

Il y a d'autres maladies qui donnent une douleur ressemblante. Il faut les connaître. Voici un tableau simple pour les comparer :

| Maladie | Chez qui | Ce qui doit t'alerter | L'examen qui aide |
|---|---|---|---|
| Vraie gastrite | Tout âge, souvent AINS ou H. pylori | Brûlure épigastrique, sans signe d'alarme | Endoscopie si doute |
| Colique hépatique | Terrain de calculs biliaires | Douleur de l'hypocondre droit, après un repas gras | Échographie abdominale |
| Pancréatite aiguë | Alcool, calculs biliaires | Douleur intense, transfixiante, vomissements | Prise de sang (lipase), scanner |
| Infarctus du myocarde | Facteurs de risque cardiovasculaires | Douleur qui irradie, sueurs, malaise | Électrocardiogramme |

Regarde bien ce tableau. Apprends-le. Chaque maladie a un petit indice qui la trahit. La douleur de l'hypocondre droit après un repas gras, c'est la colique hépatique. La douleur transfixiante avec vomissements, c'est la pancréatite. La douleur qui irradie avec des sueurs, c'est le cœur qu'il faut éliminer en premier.

### Le piège de l'automédication

⮞ Un dernier faux ami, très fréquent : le malade qui se soigne seul avec des anti-acides depuis des semaines, sans jamais consulter. Les symptômes s'atténuent un peu, mais la cause profonde continue son travail en silence.

La règle simple : si la douleur persiste malgré un traitement simple pris seul, ou si elle revient dès qu'on l'arrête, ce n'est plus un cas à traiter à la légère. Il faut consulter et rechercher une vraie cause.

> **L'Astuce du Prof :** devant une douleur épigastrique qui dure, pense toujours à éliminer une cause cardiaque chez un patient à risque, avant même de conclure à une gastrite. Le cœur tue plus vite qu'un estomac irrité.

> ملخص بالعربية : ليس كل ألم في أعلى البطن هو التهاب معدة. يجب استبعاد القرحة، وأمراض المرارة، والبنكرياس، وأحياناً القلب، قبل الاستقرار على هذا التشخيص.

## CHAPITRE V : Les cinq degrés de la gastrite

Voici le cœur du cours. Je vais te raconter, en cinq degrés de gravité, comment la gastrite progresse quand rien n'est fait. Si tu comprends cette progression, tu comprends tout : les signes, l'urgence relative, le traitement. Alors lis-la doucement, deux fois s'il le faut.

### Degré 1 : le bouclier s'amincit

Tout commence par un affaiblissement localisé du mucus protecteur, à cause de H. pylori, d'un AINS, ou de l'alcool. À ce stade, la muqueuse est encore presque normale. Le malade ne ressent souvent rien du tout.

### Degré 2 : la muqueuse rougit

L'acide touche directement les cellules affaiblies. La paroi devient rouge, un peu gonflée. C'est le tout début de l'inflammation visible à l'endoscopie. Le malade commence parfois à ressentir une gêne discrète.

### Degré 3 : l'inflammation s'installe

Les cellules de défense arrivent en nombre. La paroi devient plus sensible, plus fragile. De petites érosions superficielles peuvent apparaître, surtout si la cause est un AINS pris à forte dose. C'est le stade où les symptômes deviennent souvent nets : brûlure, nausées, gêne après les repas.

### Degré 4 : les érosions s'approfondissent

Si rien n'est fait, certaines érosions peuvent s'approfondir localement. On s'approche alors de la frontière avec l'ulcère, sans l'avoir encore franchie complètement.

### Degré 5 : le vrai trou, l'ulcère

Si l'agression continue encore, une véritable perte de substance peut se former : un trou, qui traverse plus profondément la paroi. Ce n'est alors plus une gastrite, mais un ulcère constitué, avec son propre risque de saignement.

>>> Alerte : plus le temps passe sans traiter la cause, plus on avance dans cette progression. Une gastrite négligée pendant des années, surtout à H. pylori, peut franchir chacune de ces étapes en silence, jusqu'au jour où elle se révèle par un saignement.

> ملخص بالعربية : التهاب المعدة يتطور تدريجياً من ضعف بسيط في الحاجز الواقي إلى احمرار والتهاب، ثم تآكلات سطحية، وقد يصل في النهاية إلى قرحة حقيقية إذا لم يُعالج السبب.

## CHAPITRE VI : Pourquoi la douleur change selon la cause

C'est une question que les examinateurs adorent poser. Écoute bien, car la réponse est très utile en pratique.

Pourquoi la douleur d'une gastrite liée aux AINS ne ressemble pas toujours à celle d'une gastrite à H. pylori ? Pourquoi elle change de rythme ?

### La douleur liée aux AINS : souvent constante

Un anti-inflammatoire agit vite, en quelques jours, en affaiblissant directement le bouclier protecteur, peu importe les repas. C'est pour ça que la douleur liée aux AINS est souvent présente indépendamment des repas, parfois même aggravée juste après avoir mangé, si la paroi est très irritée.

### La douleur liée à H. pylori : souvent plus discrète

H. pylori agit lentement, sur des années. L'inflammation qu'elle entretient est souvent plus douce, plus chronique. Les nerfs de la paroi s'habituent presque à cette irritation de fond. C'est pour ça que la gêne est souvent plus vague, plus discrète, parfois calmée un moment par les repas avant de revenir à distance.

⮞ Donc quand tu vois une douleur constante, sans lien avec les repas, chez quelqu'un qui prend des anti-inflammatoires, pense d'abord aux AINS. Quand tu vois une gêne chronique, discrète, qui traîne depuis des mois, pense plutôt à H. pylori.

>> À retenir : le rythme de la douleur par rapport aux repas et aux médicaments pris est un indice précieux pour orienter la cause, avant même d'avoir les résultats de l'endoscopie.

> ملخص بالعربية : الألم المرتبط بمضادات الالتهاب غالباً مستمر بغض النظر عن الوجبات، بينما الألم المرتبط بجرثومة الملوية البوابية غالباً أكثر خفوتاً وإزمانا.

## CHAPITRE VII : H. pylori, le petit voisin qui abîme tout

Voici une cause qu'on ne peut jamais oublier. Elle est fréquente. Très fréquente, partout dans le monde. C'est une bactérie très particulière, capable de survivre dans l'acide de l'estomac, ce qui est presque impossible pour la plupart des microbes.

### Comment une simple bactérie donne une gastrite

Attends, une question : comment un simple microbe peut-il survivre dans un environnement aussi acide ? C'est logique quand tu y penses.

Cette bactérie fabrique une enzyme, l'uréase, qui transforme l'urée présente autour d'elle en ammoniac. Cet ammoniac forme une sorte de petit nuage protecteur qui neutralise l'acide juste à son contact. C'est comme si elle portait sa propre bulle de protection au milieu du feu.

C'est le même schéma qui recommence à chaque fois : elle se love dans le mucus, elle l'abîme localement, elle réveille l'inflammation. La seule différence avec les autres causes, c'est la lenteur : ici, tout se joue sur des années, pas sur des jours.

### La trace qu'elle laisse dans le corps

En plus, le corps déteste ce microbe. Il le voit comme un ennemi installé durablement. Il envoie contre lui des cellules de défense en continu, ce qui entretient l'inflammation locale indéfiniment tant que la bactérie reste présente.

■ C'est pour ça qu'on cherche systématiquement H. pylori devant toute gastrite chronique. Si on la trouve, ça explique presque toujours l'inflammation, et ça donne une cible claire pour le traitement.

### Pourquoi c'est important pour l'entourage

> **L'Astuce du Prof :** H. pylori se transmet le plus souvent pendant l'enfance, par la salive ou par une eau mal traitée, et reste souvent présente dans plusieurs membres d'une même famille. Quand tu la retrouves chez un malade, pense à en parler avec lui pour son entourage proche, surtout en cas d'antécédents familiaux d'ulcère.

> ملخص بالعربية : جرثومة الملوية البوابية تنجو من حمض المعدة بفضل إفرازها لإنزيم اليورياز، وتستوطن المخاط لسنوات طويلة مسببة التهاباً مزمناً في جدار المعدة.

## CHAPITRE VIII : Les AINS, l'alarme chimique de la cellule

Maintenant, on regarde la deuxième grande cause, d'un point de vue plus moléculaire. C'est la partie que les étudiants trouvent parfois difficile. Mais reste tranquille. Je vais tout expliquer simplement.

### Une enzyme protectrice qu'on bloque

Sur la paroi de l'estomac, une enzyme travaille en permanence pour fabriquer certaines substances protectrices, notamment celles qui stimulent la production de mucus et de bicarbonate. Cette enzyme s'appelle la cyclo-oxygénase. Ne t'inquiète pas du nom, pense juste à un petit ouvrier qui fabrique sans arrêt de la peinture protectrice pour le mur.

### Le médicament qui coupe le courant

Les anti-inflammatoires non stéroïdiens, les AINS, comme l'ibuprofène ou l'aspirine à forte dose, bloquent directement cet ouvrier. Plus de peinture protectrice fabriquée, ou beaucoup moins.

Tu es toujours là ? C'est un passage important. Garde l'image simple dans la tête : un ouvrier qui peint le mur, un médicament qui l'empêche de travailler, et un mur qui se retrouve à nu face au feu.

### Ce qui se passe ensuite

Sans cette production protectrice, le mucus s'amincit, le bicarbonate diminue, et la paroi se retrouve exposée à l'acide, parfois en seulement quelques jours si le médicament est pris à forte dose, à jeun, ou pendant longtemps.

⮞ Voilà pourquoi un patient qui prend des AINS régulièrement peut développer une gastrite bien plus vite qu'avec H. pylori seule, sans avoir besoin d'aucune bactérie pour expliquer les dégâts.

> **L'Astuce du Prof :** chez tout patient qui doit prendre des AINS sur une longue durée, en particulier une personne âgée, pense systématiquement à associer un protecteur d'estomac dès le début du traitement, plutôt que d'attendre l'apparition des symptômes.

> ملخص بالعربية : مضادات الالتهاب غير الستيروئيدية تثبط الإنزيم المسؤول عن إنتاج المخاط والبيكربونات الحاميين، مما يعرض جدار المعدة للحمض مباشرة، أحياناً في أيام قليلة فقط.

## CHAPITRE IX : Les pompiers du corps

On a dit que l'inflammation appelle des cellules de défense. Mais comment ces cellules arrivent-elles exactement sur place, dans la paroi de l'estomac ? C'est une belle histoire, simple à comprendre.

### Le voyage des cellules de défense

Ces cellules voyagent dans le sang, portées par le courant, dans les petits vaisseaux qui irriguent la paroi. Normalement, elles passent sans s'arrêter.

Mais quand l'inflammation commence, la paroi des petits vaisseaux locaux change. Elle devient collante. Et voici ce qui se passe, étape par étape :

❖ Étape 1 : les cellules de défense roulent doucement le long de la paroi collante du vaisseau, ralentissant peu à peu.

❖ Étape 2 : elles finissent par s'arrêter complètement, bien collées à la paroi du vaisseau.

❖ Étape 3 : elles se faufilent entre les cellules de la paroi du vaisseau, passant de l'autre côté.

❖ Étape 4 : elles arrivent enfin dans la muqueuse enflammée, où elles participent au nettoyage local et à la réaction inflammatoire.

### Ce que ça veut dire pour toi

C'est pour ça que la biopsie d'une muqueuse enflammée montre souvent un afflux de cellules inflammatoires bien visible au microscope. C'est ce constat, au niveau cellulaire, qui confirme définitivement le diagnostic de gastrite.

>> À retenir : la présence de nombreuses cellules de défense dans la biopsie, c'est le signe que le corps a envoyé ses pompiers sur place. C'est ce qui confirme, au microscope, ce que l'endoscopie avait déjà laissé penser à l'œil nu.

## CHAPITRE X : Pourquoi le ventre brûle

Parlons de la brûlure épigastrique. C'est le signe qu'on voit le plus souvent. Mais peu de gens savent vraiment pourquoi ça brûle. Toi, tu vas savoir.

### Des nerfs devenus trop sensibles

Les messagers chimiques libérés pendant l'inflammation, au chapitre précédent, ne font pas qu'appeler les cellules de défense. Ils rendent aussi les nerfs locaux de la paroi beaucoup plus sensibles qu'à l'habitude.

Alors un contact qui, normalement, ne ferait rien du tout, comme le passage de l'acide ou d'un aliment un peu épicé, devient soudain douloureux, ressenti comme une vraie brûlure.

⮞ Pourquoi le corps fait ça ? Pour t'obliger à faire attention. La douleur est un signal d'alarme utile, qui pousse le malade à consulter, à changer ses habitudes, ou à arrêter le médicament en cause.

> Note simple : la brûlure n'est pas l'ennemi. C'est un signal du corps. Mais une brûlure qui s'aggrave, qui ne répond plus à rien, ou qui s'associe à d'autres signes d'alarme, doit toujours faire chercher plus loin qu'une simple gastrite.

> ملخص بالعربية : الالتهاب يجعل الأعصاب الموضعية أكثر حساسية، فيتحول أي تماس بسيط مع الحمض إلى إحساس بالحرقة، وهي إشارة تنبيه من الجسم.

## CHAPITRE XI : Qui a besoin d'un examen tout de suite ?

Tu penses à une gastrite. Très bien. Maintenant, ton deuxième travail, c'est de chercher les signes qui doivent t'inquiéter davantage. Ce sont eux qui décident : est-ce qu'on peut traiter simplement, ou est-ce qu'il faut une endoscopie rapide ?

### Les signes qui doivent te faire peur

Voici le tableau à connaître par cœur. Vraiment par cœur. Ces signes veulent dire « ne traite pas à l'aveugle, cherche plus loin » :

| Signe d'alarme | Ce qu'on voit | Ce que ça veut dire | Ce que tu fais |
|---|---|---|---|
| Vomissements de sang | Hématémèse | Saignement digestif actif | Prise en charge urgente |
| Selles noires et malodorantes | Méléna | Saignement digestif, souvent haut | Prise en charge urgente |
| Amaigrissement inexpliqué | Perte de poids sans raison | Possible cause plus grave | Endoscopie rapide |
| Difficulté à avaler | Dysphagie progressive | Atteinte possible de l'œsophage | Endoscopie rapide |
| Âge avancé, symptômes nouveaux | Plainte récente après 50 ans | Risque de diagnostic différentiel plus grave | Endoscopie, pas de traitement à l'aveugle |

### La question à te poser toujours

Pose-toi toujours la même question devant une douleur épigastrique : « Est-ce que ce malade peut être traité simplement, ou est-ce que quelque chose ne colle pas ? » Si tu hésites, si un seul signe d'alarme est présent, la réponse est non. On ne traite pas à l'aveugle.

>> Vérité simple : il vaut mille fois mieux demander une endoscopie qui, finalement, ne montre rien de grave, que de traiter à l'aveugle un malade dont le vrai problème est ailleurs.

> ملخص بالعربية : وجود أي علامة إنذار مثل النزيف أو فقدان الوزن أو صعوبة البلع يستوجب دائماً تنظيراً سريعاً، دون الاكتفاء بعلاج تجريبي.

## CHAPITRE XII : Les outils du médecin

Dans une grande ville, on a plein d'outils : l'endoscopie, les biopsies, des tests rapides pour H. pylori. Mais parfois, sur le terrain, on a très peu de choses. Il faut apprendre à faire avec ce qu'on a.

### L'endoscopie, l'examen qui montre tout

● L'endoscopie digestive haute reste l'examen de référence. On glisse un tube fin muni d'une caméra par la bouche, jusque dans l'estomac. On voit directement la paroi, on peut voir si elle est rouge et enflammée, et on peut prélever une biopsie pour l'analyser.

● On y cherche des zones rouges, œdématiées, parfois de petites érosions. Et surtout, on prélève des biopsies pour confirmer le diagnostic et rechercher H. pylori.

### La recherche de la bactérie

● On peut rechercher H. pylori de plusieurs façons : par la biopsie, par un test respiratoire, ou par la recherche d'antigènes dans les selles. Le test respiratoire est simple, rapide, non invasif et très fiable.

● Retiens bien : une prise de sang normale n'élimine jamais une gastrite. Si le ventre parle, si l'histoire est claire, tu ne dois pas te laisser rassurer par une biologie normale.

> **L'Astuce du Prof :** avant un test respiratoire ou une recherche dans les selles, arrête certains médicaments qui bloquent l'acide pendant quelques semaines, sinon le résultat peut être faussement négatif.

## CHAPITRE XIII : Comment on soigne

Le traitement de base de la gastrite, c'est simple dans son principe : traiter la cause, et calmer l'acide le temps que la paroi guérisse.

### Enlever la cause

➔ Si la cause est un anti-inflammatoire, on l'arrête, ou on le remplace par une solution moins agressive pour l'estomac.

➔ Si la cause est l'alcool, on explique clairement au malade pourquoi il doit réduire, voire arrêter, sa consommation.

➔ Si la cause est H. pylori, on prévoit une trithérapie d'éradication, qu'on détaille dans le chapitre suivant.

### Calmer l'acide en attendant

➔ On donne presque toujours un inhibiteur de la pompe à protons, un IPP, qui bloque fortement la fabrication d'acide, le temps que la paroi cicatrise tranquillement, comme un pansement posé sur une plaie pendant qu'elle guérit.

> **L'Astuce du Prof :** devant une gastrite sévère avec plusieurs érosions, ton pire ennemi c'est d'arrêter le traitement trop tôt dès que la douleur disparaît. Retiens la formule : « la douleur part vite, la muqueuse guérit plus lentement. »

## CHAPITRE XIV : Avant, pendant et après la trithérapie

Quand H. pylori est retrouvée, il y a des étapes importantes à respecter. Ce ne sont pas des détails. Ils font partie du traitement.

### Avant de commencer

■ On vérifie qu'aucun signe d'alarme n'a été oublié. Traiter une bactérie ne sert à rien si on est passé à côté d'un vrai saignement.

■ On explique bien au malade pourquoi il doit prendre les deux antibiotiques et l'IPP ensemble, sans en oublier un seul, pendant toute la durée prescrite.

### Pendant la trithérapie

■ Le traitement associe deux antibiotiques différents à un IPP, pris ensemble pendant environ dix à quatorze jours. Cette combinaison permet d'éliminer la bactérie dans la grande majorité des cas.

### Après le traitement

Après la fin de la trithérapie, on surveille le malade. On regarde deux choses simples, encore et encore :

▲ Les symptômes. S'ils disparaissent complètement, c'est bon signe. S'ils persistent, il faut réévaluer, parfois avec un contrôle de l'éradication.

▲ La cicatrisation, confirmée si besoin par une nouvelle endoscopie en cas de gastrite sévère ou d'érosions importantes au départ.

>> À retenir : une gastrite prise tôt, c'est un traitement simple et une guérison rapide, en quelques semaines. Une gastrite négligée pendant des années, c'est un risque d'ulcère, puis de complication. La seule différence entre les deux, c'est le temps. Toujours le temps.

> ملخص بالعربية : علاج التهاب المعدة يعتمد أولاً على إزالة السبب، ثم تهدئة الحمض بمثبط لمضخة البروتون، مع علاج ثلاثي للقضاء على جرثومة الملوية البوابية عند وجودها.

## CHAPITRE XV : L'erreur qui peut coûter cher

S'il y a une seule chose à retenir de tout ce long cours, c'est celle-ci. Écoute-moi bien.

Ce qui coûte le plus cher, dans la gastrite, ce n'est pas une mauvaise ordonnance. Ce n'est pas un mauvais médecin. C'est le temps perdu avant de rechercher, puis de traiter, la vraie cause.

### L'histoire qu'il ne faut pas vivre

Imagine la scène. Un malade a des brûlures d'estomac depuis des mois. Il se soigne seul avec des anti-acides achetés sans ordonnance. « Ça passe un peu, puis ça revient », se dit-il. Il ne consulte jamais.

Mais pendant qu'on attend, la progression du chapitre V continue tout seul, doucement. Elle ne s'arrête pas parce qu'on ferme les yeux. Mois après mois, la muqueuse s'irrite un peu plus. Un jour, ce n'est plus une simple gastrite. C'est un ulcère constitué, qui peut saigner à tout moment.

### L'image du feu qui couve

Souviens-toi d'une image simple. La gastrite non traitée, c'est comme un petit feu qui couve doucement sous la cendre. Au tout début, il suffit de retirer la cause pour l'éteindre. C'est facile, rapide, sans danger.

Mais si tu laisses la cause en place, le feu continue de couver, doucement, sans flamme visible, jusqu'au jour où il se réveille brutalement. Et là, même un traitement bien conduit a plus de mal à tout réparer d'un coup.

⮞ Ton rôle de médecin, c'est de rechercher et de traiter la cause quand il ne faut encore qu'un simple geste. Pas d'attendre que le feu se réveille.

>>> Alerte finale : chaque année d'attente augmente le risque d'évolution vers l'ulcère et ses complications. Devant une brûlure d'estomac qui dure, on cherche la cause, on la traite, et on ne se contente jamais d'un traitement symptomatique éternel.

> ملخص بالعربية : كل تأخير في البحث عن سبب التهاب المعدة وعلاجه يزيد خطر التطور نحو القرحة ومضاعفاتها. القرار المبكر بالعلاج السببي هو ما ينقذ المريض أكثر من أي شيء آخر.

## RÉCAPITULATIF

On arrive à la fin de ce long voyage. Voici le grand tableau de tout le cours. Garde-le en tête. Si tu ne retiens qu'une seule image, que ce soit celle-là :

| Étape | Ce qui se passe | Le signe chez le malade | Le danger |
|---|---|---|---|
| Bouclier affaibli | Le mucus s'amincit | Presque rien au début | Faible si on agit vite |
| Muqueuse rouge | L'acide touche la paroi à nu | Brûlure épigastrique | Moyen |
| Inflammation installée | Cellules de défense recrutées | Douleur, nausées, ballonnements | Élevé si la cause persiste |
| Érosions superficielles | La paroi s'abîme localement | Douleur plus marquée | Élevé, proche de l'ulcère |
| Ulcère constitué | Vrai trou dans la paroi | Douleur rythmée, risque de saignement | Vital si hémorragie |

Voilà. Tu connais maintenant la gastrite. Du tout petit détail de la cellule jusqu'au geste qui soigne. Tu as fait un long chemin. Sois fier de toi.

Garde trois images simples dans la tête, pour toujours :

✦ Le bouclier de mucus qui protège un sac rempli d'acide.

✦ Le duel permanent entre ce qui attaque et ce qui protège, cassé par H. pylori ou par les AINS.

✦ Le temps perdu, qui est ton pire ennemi face à une cause non traitée.

Garde ces trois images, et tu seras un bon médecin. Même loin de tout. Même sans machine. Avec juste ta tête, tes mains et ton cœur. Bon courage pour la suite. Tu vas y arriver.`;

const GASTRITE_RESUME_CONTENT = `## Résumé Express : La Gastrite

- **Définition** : Inflammation de la muqueuse gastrique, sans perte de substance profonde (contrairement à l'ulcère), résultant d'un déséquilibre entre l'acide qui attaque et la barrière protectrice (mucus, bicarbonate, vascularisation) qui protège.

- **Causes Principales (AINS, H. Pylori)** : Deux grandes causes expliquent la quasi-totalité des gastrites.
  - Les AINS (anti-inflammatoires non stéroïdiens) bloquent la cyclo-oxygénase, ce qui diminue la production de mucus et de bicarbonate protecteurs ; action pouvant être rapide, en quelques jours.
  - Helicobacter pylori, une bactérie qui survit dans l'acide grâce à son uréase, colonise le mucus et entretient une inflammation chronique, souvent sur plusieurs années.
  - Causes plus rares à connaître : alcool, stress majeur (réanimation, brûlure grave), reflux biliaire, maladie auto-immune.

- **Signes Cliniques (Syndrome dyspeptique)** : Douleur ou brûlure épigastrique, nausées, satiété précoce, ballonnements et renvois post-prandiaux — ce tableau clinique porte le nom de syndrome dyspeptique.
  - Peut être totalement asymptomatique, découverte parfois fortuite à l'endoscopie.
  - Signes d'alarme à rechercher systématiquement : hématémèse, méléna, amaigrissement, dysphagie, anémie — leur présence impose une exploration rapide, sans traitement empirique prolongé.

- **Diagnostic de certitude (FOGD + Biopsies)** : La fibroscopie œso-gastro-duodénale (FOGD), c'est-à-dire l'endoscopie digestive haute, est l'examen de référence.
  - Elle visualise directement l'aspect de la muqueuse (rouge et œdématiée en aigu, pâle et atrophique en chronique, érosive sous AINS).
  - Les biopsies faites pendant l'examen confirment le diagnostic histologique et permettent la recherche de H. pylori.
  - Recherche complémentaire de H. pylori possible par test respiratoire à l'urée ou recherche d'antigènes fécaux, non invasifs et fiables.

- **Traitement (IPP, Éradication)** : Repose sur deux piliers menés en parallèle.
  - Un inhibiteur de la pompe à protons (IPP) pour calmer l'acide et laisser la muqueuse cicatriser.
  - Une trithérapie d'éradication (deux antibiotiques + IPP, environ 10-14 jours) si H. pylori est positive, associée à l'arrêt de la cause (AINS, alcool) chaque fois que possible.

> **Note du prof :** Si tu ne dois retenir qu'une phrase : syndrome dyspeptique + prise d'AINS ou H. pylori connue = gastrite jusqu'à preuve du contraire, confirmée par FOGD et biopsies.`;

const GASTRITE_CAS_CLINIQUE_CONTENT = `## Cas Clinique : À toi de jouer, Yacine

Karim, 45 ans, se présente en consultation pour des brûlures épigastriques débutées il y a 3 semaines, sans irradiation, calmées transitoirement par les repas. Il est suivi pour une arthrose du genou et prend de l'ibuprofène presque quotidiennement depuis un mois, sans protection gastrique associée. Il présente des nausées sans vomissement, et une sensibilité épigastrique modérée à la palpation, sans défense ni contracture.

**Questions :**
1. Quel est ton diagnostic le plus probable, et pourquoi ?
2. Quels signes iras-tu rechercher pour éliminer une cause plus grave ?
3. Quel examen complémentaire demanderais-tu en première intention ?

> **Indice du prof :** Relis bien la section « Chapitre VIII » de l'explication détaillée — le lien avec la prise chronique d'AINS est la clé de ce cas.`;

const GASTRITE_QCM_CONTENT = `## QCM : Teste-toi sur la Gastrite

**1. Quelle est la cause la plus fréquente de gastrite chronique dans le monde ?**
A. La prise d'anti-inflammatoires non stéroïdiens
B. L'infection à Helicobacter pylori
C. La consommation excessive d'alcool
D. Une maladie auto-immune

**2. Comment les AINS provoquent-ils une gastrite ?**
A. En perforant directement la paroi
B. En bloquant la cyclo-oxygénase, ce qui diminue le mucus protecteur
C. En augmentant la vascularisation de la paroi
D. En neutralisant l'acide gastrique

**3. Quel est l'examen de référence pour diagnostiquer une gastrite ?**
A. L'échographie abdominale
B. L'endoscopie digestive haute avec biopsies
C. La radiographie de l'abdomen sans préparation
D. Le scanner abdominal

> **Réponses :** 1-B, 2-B, 3-B. Si tu as tout bon, tu es prêt(e) pour reconnaître une gastrite en consultation !`;

export const COURSE_SLUG_CONTENT: Record<CourseSlug, CourseSlugContent> = {
  appendicite: {
    title: "L'Appendicite Aiguë en Milieu Tropical",
    content: APPENDICITE_CONTENT,
    source: { fileName: "Appendicite_Cours.pdf", size: "1.2 Mo" },
  },
  gastrite: {
    title: "La Gastrite : Comprendre l'inflammation de l'estomac",
    content: GASTRITE_CONTENT,
    source: { fileName: "Gastrite_Notes.txt", size: "45 KB" },
    resume: GASTRITE_RESUME_CONTENT,
    casClinique: GASTRITE_CAS_CLINIQUE_CONTENT,
    qcm: GASTRITE_QCM_CONTENT,
  },
};

export function isCourseSlug(slug: string): slug is CourseSlug {
  return Object.prototype.hasOwnProperty.call(COURSE_SLUG_CONTENT, slug);
}
