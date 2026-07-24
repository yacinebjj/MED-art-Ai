import {
  Sparkles,
  ClipboardList,
  Star,
  FileText,
  ListChecks,
  Palette,
  GitBranch,
  Columns,
  Pill,
  Landmark,
  FlaskConical,
  HeartHandshake,
  GraduationCap,
  Zap,
  Wand2,
  Stethoscope,
  Gauge,
  Eye,
  ScanLine,
  Siren,
  ClipboardCheck,
  Scissors,
  FileCheck,
  Syringe,
  Snowflake,
  AlertTriangle,
  Ban,
  TrendingUp,
  Droplets,
  Activity,
  XCircle,
  ShieldAlert,
  AlertOctagon,
  CircleDot,
  Target,
  type LucideIcon,
} from "lucide-react";

export type ResumeModeId =
  | "smart"
  | "clinical"
  | "exam"
  | "onepage"
  | "cheatsheet"
  | "color"
  | "visual"
  | "ddx"
  | "drug"
  | "guideline"
  | "research"
  | "patient"
  | "professor"
  | "flash"
  | "aihighlight";

/** How ResumeStudio wraps a mode's rendered Markdown — each mode has its own visual identity. */
export type ResumeVariant =
  | "default"
  | "a4"
  | "highlight"
  | "patient"
  | "professor"
  | "cheatsheet"
  | "flash"
  | "visual";

export interface ResumeMode {
  id: ResumeModeId;
  label: string;
  icon: LucideIcon;
  variant: ResumeVariant;
  /** Markdown content. For "smart", this is unused — see `levels` instead. For "visual", see `flowcharts`. */
  content: string;
  /** Only present on the "smart" mode: three compression levels the student can toggle. */
  levels?: { 30: string; 50: string; 80: string };
  /** Only present on the "visual" mode: real Tailwind flowcharts, not ASCII art. */
  flowcharts?: FlowChartData[];
}

/** A semantic color family for a flowchart card — matches the app's callout palette. */
export type FlowNodeTone = "blue" | "amber" | "emerald" | "rose";

export interface FlowNode {
  label: string;
  sublabel?: string;
  tone: FlowNodeTone;
  icon: LucideIcon;
}

/** One row of the flowchart. More than one node means a fork/decision branch at that step. */
export interface FlowLevel {
  nodes: FlowNode[];
}

export interface FlowChartData {
  title: string;
  levels: FlowLevel[];
}

/** Same badge value across all 15 modes — it reflects the topic's exam relevance, not the mode. */
export const RESUME_TOMBABILITE = 95;

/** Real Tailwind/card flowcharts for the "Visual Summary" mode — no ASCII art. */
export const VISUAL_FLOWCHARTS: FlowChartData[] = [
  {
    title: "Algorithme diagnostique",
    levels: [
      { nodes: [{ label: "Douleur FID + fièvre", sublabel: "Suspicion clinique", tone: "blue", icon: Stethoscope }] },
      { nodes: [{ label: "Score de Alvarado", sublabel: "Stratification du risque", tone: "amber", icon: Gauge }] },
      {
        nodes: [
          { label: "Score faible (1-4)", sublabel: "Surveillance + réévaluation", tone: "emerald", icon: Eye },
          { label: "Score intermédiaire (5-6)", sublabel: "Imagerie : écho ou TDM", tone: "amber", icon: ScanLine },
          { label: "Score élevé (7-10)", sublabel: "Chirurgie directe possible", tone: "rose", icon: Siren },
        ],
      },
      { nodes: [{ label: "Confirmation diagnostique", sublabel: "Clinique et/ou imagerie positive", tone: "blue", icon: ClipboardCheck }] },
      { nodes: [{ label: "Appendicectomie", sublabel: "Traitement de référence", tone: "emerald", icon: Scissors }] },
    ],
  },
  {
    title: "Stratégie thérapeutique",
    levels: [
      { nodes: [{ label: "Appendicite confirmée", sublabel: "Décision thérapeutique", tone: "blue", icon: FileCheck }] },
      {
        nodes: [
          { label: "Non compliquée", sublabel: "Cœlioscopie + ATB courte", tone: "emerald", icon: Syringe },
          { label: "Plastron", sublabel: "ATB seul puis chirurgie à froid (6-8 sem)", tone: "amber", icon: Snowflake },
          { label: "Péritonite", sublabel: "Chirurgie immédiate + réanimation + ATB large spectre", tone: "rose", icon: AlertTriangle },
        ],
      },
    ],
  },
  {
    title: "Cascade physiopathologique",
    levels: [
      { nodes: [{ label: "Obstruction", sublabel: "Stercolithe, hyperplasie lymphoïde, ascaris", tone: "blue", icon: Ban }] },
      { nodes: [{ label: "Distension", sublabel: "Pullulation microbienne", tone: "amber", icon: TrendingUp }] },
      { nodes: [{ label: "Œdème", sublabel: "Pression > pression veineuse", tone: "amber", icon: Droplets }] },
      { nodes: [{ label: "Ischémie", sublabel: "Pression > pression artérielle", tone: "rose", icon: Activity }] },
      { nodes: [{ label: "Nécrose pariétale", sublabel: "Perte de viabilité tissulaire", tone: "rose", icon: XCircle }] },
      {
        nodes: [
          { label: "Perforation contenue", sublabel: "Plastron ou abcès", tone: "amber", icon: ShieldAlert },
          { label: "Perforation libre", sublabel: "Péritonite généralisée", tone: "rose", icon: AlertOctagon },
        ],
      },
    ],
  },
  {
    title: "Migration de la douleur",
    levels: [
      { nodes: [{ label: "Douleur péri-ombilicale", sublabel: "Innervation viscérale, vague", tone: "blue", icon: CircleDot }] },
      { nodes: [{ label: "Douleur en FID", sublabel: "Péritoine pariétal atteint, précise", tone: "rose", icon: Target }] },
    ],
  },
];

export const RESUME_MODES: ResumeMode[] = [
  // ────────────────────────────────────────────────────────────────────
  // 1. SMART SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "smart",
    label: "Smart Summary",
    icon: Sparkles,
    variant: "default",
    content: "",
    levels: {
      30: `**Appendicite aiguë** : inflammation de l'appendice vermiforme par **obstruction luminale** (stercolithe chez l'adulte, hyperplasie lymphoïde chez le sujet jeune). Clinique : douleur migrant vers la **fosse iliaque droite (FID)**, **défense pariétale**, fièvre modérée, **hyperleucocytose à PNN**. Diagnostic clinique ± échographie/TDM si doute. Traitement : **appendicectomie** en urgence, voie **cœlioscopique** de préférence.`,
      50: `**Appendicite aiguë** : c'est l'urgence chirurgicale abdominale la plus fréquente. Elle est causée par une **obstruction de la lumière appendiculaire** — un **stercolithe** chez l'adulte, une **hyperplasie lymphoïde** réactionnelle chez le sujet jeune. L'obstruction entraîne une stase, une pullulation microbienne, puis une **ischémie pariétale** qui peut évoluer vers la nécrose et la **perforation**.

La douleur est le signe cardinal : elle débute de façon **péri-ombilicale** (vague, viscérale) puis **migre et se fixe en FID** (précise, pariétale) — c'est le signe le plus spécifique. On y associe une **défense pariétale en FID**, un **signe de Blumberg** positif (douleur à la décompression), une fébricule à 38-38,5°C et des nausées.

Le **score de Alvarado** aide à stratifier le risque avant imagerie. La biologie retrouve une **hyperleucocytose à polynucléaires neutrophiles** et une **CRP élevée** — mais une biologie normale n'élimine jamais le diagnostic si la clinique est franche. L'échographie (référence chez l'enfant et la femme jeune) ou le **scanner abdomino-pelvien injecté** (référence chez l'adulte, sensibilité et spécificité > 95%) confirment le diagnostic en cas de doute, en cherchant un appendice de **diamètre > 6 mm**.

Le traitement de référence reste l'**appendicectomie**, idéalement par **cœlioscopie**. Une antibiothérapie seule peut être discutée dans des formes non compliquées sélectionnées, mais expose à un risque de récidive. Les formes compliquées (**perforation**, **abcès**, **plastron appendiculaire**) imposent une prise en charge adaptée : traitement médical premier puis chirurgie différée en cas de plastron.`,
      80: `**Appendicite aiguë** : inflammation aiguë de l'appendice vermiforme, urgence chirurgicale abdominale la plus fréquente, avec un pic d'incidence entre **10 et 30 ans**.

**Physiopathologie.** Tout part d'une **obstruction de la lumière appendiculaire** : chez l'adulte, le plus souvent un **stercolithe** (concrétion fécale calcifiée) ; chez l'enfant et l'adulte jeune, une **hyperplasie lymphoïde** réactionnelle de la sous-muqueuse (le tissu lymphoïde appendiculaire, riche en follicules, réagit à des infections systémiques banales). Une fois la lumière obstruée, la sécrétion muqueuse continue en amont, la pression intraluminale augmente, la flore commensale (**Escherichia coli**, **Bacteroides fragilis**) prolifère en milieu confiné. La pression finit par excéder la pression de perfusion **veineuse et lymphatique** (phase congestive/catarrhale), puis la pression de perfusion **artériolaire** (ischémie, phase phlegmoneuse puis gangreneuse). La nécrose pariétale aboutit à la **perforation**, contenue (plastron, abcès) ou libre (**péritonite généralisée**).

**Clinique.** La douleur migre classiquement de la région **péri-ombilicale** (innervation viscérale, mal systématisée) vers la **fosse iliaque droite** où elle se fixe (atteinte du péritoine pariétal, richement innervé, douleur précise). On recherche à l'examen : la **défense pariétale en FID**, le **signe de Blumberg** (douleur à la décompression brutale du point de McBurney), le **signe de Rovsing** (douleur en FID à la palpation de la fosse iliaque gauche), le **psoas sign** et l'**obturator sign** dans les formes rétrocæcale/pelvienne. Fébricule à 38-38,5°C ; une fièvre élevée avec frissons doit faire craindre une complication.

**Diagnostic.** Le **score de Alvarado** (10 points : migration de la douleur, anorexie, nausées/vomissements, douleur en FID, rebond, élévation thermique, hyperleucocytose, déviation gauche) oriente la probabilité pré-test. La biologie retrouve une **hyperleucocytose à polynucléaires neutrophiles** et une **CRP élevée**, mais peut être normale en tout début d'évolution. Le dosage des **bêta-HCG** est systématique chez toute femme en âge de procréer. L'imagerie : **échographie** en première intention chez l'enfant et la femme jeune (appendice **> 6 mm**, paroi épaissie, stercolithe échogène), **scanner abdomino-pelvien injecté** chez l'adulte en cas de doute (sensibilité/spécificité > 95%).

**Diagnostic différentiel** : GEU et torsion d'annexe chez la femme jeune, adénite mésentérique et gastro-entérite chez l'enfant, colique néphrétique droite, iléite terminale (Crohn), diverticule de Meckel.

**Traitement.** **Appendicectomie** de référence, par **cœlioscopie** en première intention (exploration complète, suites simples, moins d'infection pariétale) ou par **laparotomie** (McBurney) dans les formes évoluées. Antibioprophylaxie périopératoire courte dans les formes non compliquées ; antibiothérapie curative prolongée en cas de péritonite ou d'abcès. Devant un **plastron appendiculaire** constitué : traitement médical premier (antibiotiques ± drainage radiologique) puis appendicectomie à froid 6-8 semaines plus tard.

**Complications** : péritonite généralisée, abcès, plastron, pyléphlébite (rare), infection de paroi post-opératoire. Ne jamais prescrire de **laxatif ou de lavement** devant une douleur abdominale fébrile non étiquetée — risque de précipiter la perforation.`,
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // 2. CLINICAL SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "clinical",
    label: "Clinical Summary",
    icon: ClipboardList,
    variant: "default",
    content: `## Définition

L'**appendicite aiguë** est l'inflammation aiguë de l'appendice vermiforme, un organe lymphoïde vestigial implanté à la face postéro-interne du **cæcum**, à la convergence des trois **ténias coliques**. C'est l'urgence chirurgicale abdominale non traumatique la plus fréquente dans le monde.

---

## Épidémiologie

- Pic d'incidence entre **10 et 30 ans**, avec un maximum autour de 10-20 ans (corrélé au maximum de développement du tissu lymphoïde appendiculaire).
- Légère prédominance masculine.
- Risque cumulé sur la vie entière estimé entre 7 et 8 %.
- Incidence plus faible mais gravité plus élevée aux âges extrêmes (**nourrisson**, **sujet âgé**), du fait d'un retard diagnostique fréquent.

---

## Facteurs de risque

- **Hyperplasie lymphoïde** réactionnelle (infections virales/ORL banales) chez le sujet jeune.
- **Stercolithe** (concrétion fécale calcifiée) chez l'adulte.
- **Parasitose digestive** (Ascaris lumbricoides) en zone d'endémie — obstruction mécanique de la lumière par migration du ver.
- Antécédents familiaux d'appendicite (susceptibilité génétique discutée).
- Tumeur carcinoïde appendiculaire (cause rare d'obstruction chez l'adulte).

---

## Physiopathologie

1. **Obstruction luminale** (stercolithe, hyperplasie lymphoïde, corps étranger, parasite).
2. **Distension** par accumulation de mucus et **pullulation microbienne** en milieu confiné et stagnant.
3. **Phase congestive** : la pression intraluminale dépasse la pression de perfusion **veineuse et lymphatique** — œdème pariétal.
4. **Phase suppurée puis gangreneuse** : la pression dépasse la pression de perfusion **artériolaire** — **ischémie**, invasion bactérienne transmurale, nécrose.
5. **Perforation** : contenue (**plastron**, **abcès**) si évolution lente (contention par l'épiploon), ou libre (**péritonite généralisée**) si évolution rapide.

---

## Symptômes

- Douleur abdominale **migratrice** : péri-ombilicale puis fixée en **fosse iliaque droite (FID)** — signe le plus spécifique.
- **Anorexie**, nausées, parfois vomissements.
- **Fébricule** à 38-38,5 °C (une fièvre élevée avec frissons évoque une complication).
- Troubles du transit inconstants (constipation ou diarrhée).

---

## Diagnostic

- Examen clinique : **défense pariétale en FID**, **signe de Blumberg** (douleur au relâchement brutal), **signe de Rovsing**, psoas sign et obturator sign dans les formes atypiques.
- **Score de Alvarado** pour stratifier la probabilité clinique.
- Biologie : **hyperleucocytose à polynucléaires neutrophiles**, **CRP élevée** ; dosage systématique des **bêta-HCG** chez la femme en âge de procréer.
- Imagerie : **échographie** (référence chez l'enfant/femme jeune, appendice **> 6 mm**), **scanner abdomino-pelvien injecté** (référence chez l'adulte, Se/Sp > 95 %).

---

## Diagnostic différentiel

- **Grossesse extra-utérine**, **torsion d'annexe** (femme jeune — réflexe bêta-HCG obligatoire).
- **Adénite mésentérique**, gastro-entérite (enfant).
- **Colique néphrétique droite**, pyélonéphrite droite.
- **Iléite terminale** (maladie de Crohn inaugurale).
- **Diverticule de Meckel** enflammé.
- En zone tropicale : **fièvre typhoïde** compliquée, **paludisme**, **amibiase colique invasive**.

---

## Traitement

- **Appendicectomie** de référence : **cœlioscopie** en première intention, **laparotomie** (voie de McBurney) dans les formes évoluées ou en cas de contre-indication.
- **Antibioprophylaxie** périopératoire courte dans les formes non compliquées ; antibiothérapie curative prolongée si péritonite ou abcès.
- **Plastron appendiculaire** : traitement médical premier (antibiotiques ± drainage), appendicectomie **à froid** 6-8 semaines après.

---

## Complications

- **Péritonite généralisée** (urgence vitale).
- **Abcès** et **plastron appendiculaire**.
- Infection de la paroi abdominale post-opératoire.
- **Pyléphlébite** (thrombophlébite septique de la veine porte) — rare mais grave.
- Occlusion sur bride à distance de la chirurgie.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 3. EXAM SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "exam",
    label: "Exam Summary",
    icon: Star,
    variant: "highlight",
    content: `## ⭐ High Yield Facts (tombe quasi à 100%)

- La douleur **migre du nombril vers la fosse iliaque droite (FID)** — c'est LE signe le plus spécifique de l'appendicite.
- Le point de **McBurney** se situe au **tiers externe** de la ligne ombilic - épine iliaque antéro-supérieure droite.
- Le **signe de Blumberg** = douleur à la **décompression brutale**, pas à la palpation.
- La cause la plus fréquente d'obstruction chez l'**adulte** est le **stercolithe** ; chez l'**enfant/adulte jeune**, l'**hyperplasie lymphoïde**.
- Une **biologie normale n'élimine jamais** le diagnostic si la clinique est franche.
- Le diamètre appendiculaire pathologique en échographie/TDM est **> 6 mm**.

## ⭐⭐ Must Know (fondamental)

- Le **score de Alvarado** intègre migration de la douleur, anorexie, nausées/vomissements, douleur en FID, rebond, fièvre, hyperleucocytose et déviation gauche — 10 points au total.
- Toute femme en âge de procréer avec douleur en FID doit avoir un dosage des **bêta-HCG** avant toute décision chirurgicale, pour éliminer une **grossesse extra-utérine**.
- Le **plastron appendiculaire** se traite médicalement d'abord (antibiotiques), jamais par chirurgie immédiate — risque de plaie digestive sur tissus inflammatoires friables.
- La voie **cœlioscopique** est aujourd'hui privilégiée en première intention pour l'appendicectomie.
- Les complications majeures sont le **plastron**, l'**abcès** et la **péritonite généralisée**.

## ⭐⭐⭐ Very Important (nuances et populations particulières)

- Chez la **femme enceinte** (3ème trimestre), l'utérus gravide refoule l'appendice vers le haut : la douleur peut mimer une **cholécystite**.
- Chez le **sujet âgé**, la présentation est souvent atténuée (peu de fièvre, défense discrète) alors que la maladie est déjà évoluée — risque de retard diagnostique et de perforation.
- Chez l'**enfant**, l'épiploon peu développé favorise une évolution plus rapide vers la **perforation libre**.
- L'étude **CODA** (NEJM 2020) a montré la **non-infériorité** d'une stratégie antibiotique première par rapport à l'appendicectomie pour les formes **non compliquées** sélectionnées, au prix d'un risque de récidive nécessitant une chirurgie différée.
- **Ne jamais prescrire de laxatif ou de lavement** devant une douleur abdominale fébrile non étiquetée : risque de précipiter la perforation par hyperpéristaltisme.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 4. ONE PAGE SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "onepage",
    label: "One Page Summary",
    icon: FileText,
    variant: "a4",
    content: `## Appendicite Aiguë — L'essentiel sur une page

### Définition
Inflammation aiguë de l'**appendice vermiforme** par **obstruction luminale**.

### Cause
**Stercolithe** (adulte) ou **hyperplasie lymphoïde** (jeune) ; parfois **ascaris** en zone tropicale.

### Mécanisme
Obstruction ➔ distension ➔ ischémie **veineuse** puis **artérielle** ➔ nécrose ➔ **perforation**.

### Clinique
Douleur **péri-ombilicale migrant en FID**, **défense**, **Blumberg +**, fébricule 38-38,5°C, anorexie.

### Biologie
**Hyperleucocytose à PNN**, **CRP élevée** ; **bêta-HCG** systématique chez la femme.

### Imagerie
**Échographie** (enfant/femme jeune) ou **TDM injecté** (adulte) : appendice **> 6 mm**.

### Score
**Alvarado** (/10) : migration, anorexie, nausées, douleur FID, rebond, fièvre, GB élevés, déviation gauche.

### DDx principaux
**GEU**, torsion d'annexe, adénite mésentérique, colique néphrétique, iléite terminale.

### Traitement
**Appendicectomie** (cœlioscopie de préférence) + antibioprophylaxie ; plastron = ATB puis chirurgie **à froid**.

### Complications
**Péritonite**, **abcès**, **plastron**, infection pariétale.

### Piège à ne jamais faire
Jamais de **laxatif/lavement** sur douleur abdominale fébrile non étiquetée.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 5. CHEAT SHEET
  // ────────────────────────────────────────────────────────────────────
  {
    id: "cheatsheet",
    label: "Cheat Sheet",
    icon: ListChecks,
    variant: "cheatsheet",
    content: `## Mots-clés

- **Stercolithe**
- **Hyperplasie lymphoïde**
- **Défense pariétale en FID**
- **Signe de Blumberg**
- **Signe de Rovsing**
- **Point de McBurney**
- **Plastron appendiculaire**
- **Péritonite généralisée**
- **Cœlioscopie**

## Chiffres clés

- Score de **Alvarado** : sur **10 points**
- Diamètre appendiculaire pathologique : **> 6 mm**
- Fébricule typique : **38 - 38,5 °C**
- Fièvre élevée suspecte de complication : **> 39 °C**
- Sensibilité/spécificité du scanner : **> 95 %**
- Délai d'appendicectomie à froid après plastron : **6 à 8 semaines**
- Dose de remplissage pédiatrique en cas de choc : **20 mL/kg**

## Lois / Règles

- **La veine se bouche avant l'artère** — explique la migration de la douleur.
- **Bêta-HCG obligatoire** chez toute femme en âge de procréer avec douleur en FID.
- **On refroidit avant d'opérer** un plastron.
- **Une biologie normale n'élimine jamais** le diagnostic.
- **Fièvre + retour de zone impaludée = paludisme jusqu'à preuve du contraire.**

## Doses d'antibiotiques

- **Amoxicilline - acide clavulanique** : 1 g / 125 mg x 3/jour IV (forme non compliquée)
- **Céfoxitine** : 2 g x 3/jour IV
- **Ceftriaxone** : 1 à 2 g/jour IV + **Métronidazole** 500 mg x 3/jour IV (couverture anaérobie)
- **Piperacilline - tazobactam** : 4 g / 0,5 g x 3-4/jour IV (formes compliquées, péritonite)
- **Paracétamol** : 1 g x 4/jour (antalgique, ne masque pas la défense pariétale)

## Complications mortelles

- **Péritonite généralisée** et choc septique
- **Perforation libre** avec contamination péritonéale massive
- Retard diagnostique chez le **sujet âgé** et le **nourrisson**
- Perforation précipitée par la prise d'un **laxatif ou d'un lavement**
- **Pyléphlébite** (thrombophlébite septique portale) non traitée`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 6. COLOR SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "color",
    label: "Color Summary",
    icon: Palette,
    variant: "default",
    content: `## Résumé en couleurs

> 🔵 **Définition :** l'**appendicite aiguë** est l'inflammation de l'appendice vermiforme, causée par une **obstruction de sa lumière**, aboutissant à une distension, une ischémie pariétale puis un risque de perforation.

> 🟢 **Normal / Physiologique :** l'appendice sain contient un tissu lymphoïde actif (le **GALT**), jouant un rôle de réservoir immunitaire et de reconstitution du microbiote colique après une diarrhée sévère. Sa lumière est étroite mais parfaitement perméable.

> 🔴 **Important :** une **défense pariétale généralisée** ("ventre de bois") signe une **péritonite déjà installée** — c'est une urgence chirurgicale absolue, sans délai. Toute femme en âge de procréer avec douleur en FID doit avoir un dosage des **bêta-HCG** avant toute décision, pour éliminer une **grossesse extra-utérine**.

> 🟡 **Warning / Piège d'examen :** une **prise de sang normale n'élimine jamais** le diagnostic en tout début d'évolution — c'est un piège très classique. De même, chez le **sujet âgé**, la clinique peut être faussement rassurante alors que la maladie est déjà à un stade avancé.

> 🟢 **Normal / Physiologique :** la **fièvre modérée** (38-38,5 °C) et l'**hyperleucocytose modérée** sont des réponses normales et attendues de l'organisme face à l'inflammation — elles ne signent pas à elles seules une complication.

> 🔴 **Important :** ne jamais prescrire de **laxatif ou de lavement** devant une douleur abdominale fébrile non étiquetée — le risque est de précipiter la **perforation** par hyperpéristaltisme sur une paroi déjà fragilisée.

> 🟡 **Warning / Piège d'examen :** chez la **femme enceinte** au 3ème trimestre, l'appendice est refoulé vers le haut par l'utérus gravide — la douleur peut mimer une **cholécystite aiguë**, un piège diagnostique classique des examens.

> 🔵 **Définition :** le **plastron appendiculaire** est une masse inflammatoire palpable, formée par l'agglutination de l'épiploon et des anses intestinales autour d'un appendice perforé de façon contenue — à ne pas opérer en urgence.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 7. VISUAL SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "visual",
    label: "Visual Summary",
    icon: GitBranch,
    variant: "visual",
    content: "",
    flowcharts: VISUAL_FLOWCHARTS,
  },

  // ────────────────────────────────────────────────────────────────────
  // 8. DIFFERENTIAL DIAGNOSIS SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "ddx",
    label: "DDx Summary",
    icon: Columns,
    variant: "default",
    content: `## Diagnostic différentiel de l'appendicite aiguë

| Maladie | Symptômes | Diagnostic | Traitement |
|---|---|---|---|
| **Appendicite aiguë** | Douleur migrant du nombril vers la **FID**, **défense**, fébricule 38-38,5°C | Clinique + **Alvarado** + échographie/TDM si doute | **Appendicectomie** |
| **Gastro-entérite aiguë** | Diarrhée précédant la douleur, douleur **diffuse** et non fixée, vomissements au premier plan | Clinique, contexte épidémique, pas de défense localisée | Symptomatique : réhydratation, antiémétiques |
| **Colique néphrétique droite** | Douleur **lombaire irradiant vers les organes génitaux**, à type de colique, agitation du patient | **Bandelette urinaire** (hématurie), échographie/TDM des voies urinaires | Antalgiques (AINS), alpha-bloquants, drainage si obstacle |
| **Grossesse extra-utérine** | Douleur en FID chez une femme en âge de procréer, retard de règles, parfois métrorragies | **Bêta-HCG positif** + échographie pelvienne (absence de sac intra-utérin) | Méthotrexate ou cœlioscopie selon la gravité |
| **Torsion d'annexe (ovarienne)** | Douleur pelvienne **brutale et intense**, souvent chez la femme jeune, nausées associées | Échographie pelvienne avec Doppler (absence de flux ovarien) | Cœlioscopie en urgence pour détorsion |`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 9. DRUG SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "drug",
    label: "Drug Summary",
    icon: Pill,
    variant: "default",
    content: `## Pharmacologie de l'appendicite aiguë

| Médicament | Mécanisme | Dose adulte | Effets secondaires | Contre-indications |
|---|---|---|---|---|
| **Amoxicilline - acide clavulanique** | Bêta-lactamine + inhibiteur de bêta-lactamase, inhibe la synthèse de la paroi bactérienne | 1 g / 125 mg x 3/jour IV | Troubles digestifs, réaction allergique, cytolyse hépatique | Allergie aux bêta-lactamines |
| **Céfoxitine** | Céphalosporine de 2ème génération, spectre couvrant les anaérobies | 2 g x 3/jour IV | Diarrhée, allergie croisée avec les pénicillines | Allergie aux céphalosporines |
| **Ceftriaxone + Métronidazole** | Céphalosporine de 3ème génération + couverture anaérobie spécifique | Ceftriaxone 1-2 g/jour IV + Métronidazole 500 mg x 3/jour IV | Effet antabuse (métronidazole + alcool), neuropathie si usage prolongé | Allergie, grossesse (métronidazole au 1er trimestre à éviter) |
| **Piperacilline - tazobactam** | Spectre large incluant Pseudomonas et anaérobies | 4 g / 0,5 g x 3-4/jour IV | Troubles digestifs, néphrotoxicité rare, allergie | Allergie aux bêta-lactamines |
| **Paracétamol** | Antalgique/antipyrétique central, mécanisme central mal élucidé | 1 g x 4/jour PO/IV (max 4 g/jour) | Hépatotoxicité en cas de surdosage | Insuffisance hépatocellulaire sévère |
| **Métoclopramide** | Antiémétique, antagoniste dopaminergique central | 10 mg x 3/jour IV | Syndrome extrapyramidal, somnolence | Sujet jeune (< 18 ans), maladie de Parkinson |`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 10. GUIDELINE SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "guideline",
    label: "Guideline Summary",
    icon: Landmark,
    variant: "default",
    content: `## 🏛️ Recommandations officielles — WSES Jerusalem Guidelines

Résumé des recommandations de **grade 1A** (preuves fortes, recommandation forte) de la **World Society of Emergency Surgery (WSES)**, Jerusalem Guidelines sur la prise en charge de l'appendicite aiguë.

- **Grade 1A** : le diagnostic d'appendicite aiguë doit reposer sur une **évaluation clinique structurée** (score clinique type Alvarado), complétée par une **imagerie** (échographie ou TDM) en cas de probabilité intermédiaire ou de doute diagnostique.

- **Grade 1A** : l'**appendicectomie** reste le traitement de référence de l'appendicite aiguë, **compliquée ou non compliquée**.

- **Grade 1A** : la voie **cœlioscopique** est recommandée en première intention par rapport à la laparotomie chez l'adulte, en raison d'un moindre taux d'infection de paroi et d'une récupération post-opératoire plus rapide.

- **Grade 1A** : une **antibioprophylaxie** par voie intraveineuse doit être administrée avant l'incision chirurgicale dans tous les cas d'appendicectomie.

- **Grade 1A** : en cas d'appendicite **compliquée** (perforation, péritonite, abcès), une **antibiothérapie post-opératoire** à large spectre couvrant les germes aérobies et anaérobies doit être poursuivie, sa durée étant guidée par l'évolution clinique et biologique plutôt que par une durée fixe.

- **Grade 1A** : devant un **plastron appendiculaire** constitué, le traitement médical premier (antibiothérapie ± drainage radiologique d'un abcès associé) est recommandé, la chirurgie immédiate étant associée à un risque accru de complications.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 11. RESEARCH SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "research",
    label: "Research Summary",
    icon: FlaskConical,
    variant: "default",
    content: `## Abstract — L'étude CODA (Comparison of Outcomes of antibiotic Drugs and Appendectomy)

**Référence :** publiée dans le *New England Journal of Medicine* en 2020, essai randomisé multicentrique nord-américain.

### Objectif
Comparer une **stratégie antibiotique première** à l'**appendicectomie** dans la prise en charge de l'**appendicite aiguë non compliquée** chez l'adulte, en évaluant la non-infériorité de l'approche médicale sur la qualité de vie à 30 jours.

### Méthodes
Essai randomisé contrôlé, environ **1550 patients adultes** inclus dans une vingtaine de centres, avec un diagnostic d'appendicite aiguë confirmé par imagerie. Randomisation en deux bras : **antibiothérapie seule** (dix jours) versus **appendicectomie** (majoritairement cœlioscopique). Critère de jugement principal : score de qualité de vie à **30 jours**.

### Résultats
La stratégie antibiotique s'est révélée **non inférieure** à l'appendicectomie sur le critère de qualité de vie à 30 jours. Environ **3 patients sur 10** du groupe antibiotique ont finalement nécessité une **appendicectomie** dans l'année suivant l'inclusion, avec un risque de récidive plus élevé en présence d'un **stercolithe (appendicolithe)** visible à l'imagerie initiale. Le taux de complications graves était globalement comparable entre les deux groupes.

### Conclusion
Chez des patients adultes soigneusement sélectionnés présentant une appendicite aiguë **non compliquée** et **sans stercolithe**, une stratégie antibiotique première constitue une **alternative raisonnable** à la chirurgie, à condition d'informer le patient du risque de récidive nécessitant une appendicectomie différée.

### Impact clinique
Cette étude a nuancé le dogme du **"appendicite = chirurgie systématique"**. Elle ne remet pas en cause l'appendicectomie comme traitement de référence, mais ouvre une option de **traitement médical premier** dans des situations sélectionnées (patient informé, absence de stercolithe, absence de signe de gravité), en particulier utile lorsque l'accès immédiat au bloc opératoire est limité.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 12. PATIENT-FRIENDLY SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "patient",
    label: "Patient-Friendly Summary",
    icon: HeartHandshake,
    variant: "patient",
    content: `## Ce qu'on va vous expliquer, simplement

Vous avez mal au ventre, en bas à droite. On pense que c'est votre **appendice** qui est enflammé. C'est un tout petit organe, en forme de petit doigt, accroché au début de votre gros intestin.

Imaginez une petite impasse, une rue sans issue. Parfois, un petit bouchon vient fermer l'entrée de cette impasse. Tout ce qui est à l'intérieur reste coincé. Ça gonfle, ça s'infecte, et ça fait mal. C'est exactement ce qui se passe dans votre ventre en ce moment.

### Pourquoi il faut opérer

Cet organe ne sert presque à rien une fois adulte. Mais s'il reste enflammé trop longtemps, il peut se percer, un peu comme un ballon trop gonflé qui éclate. Si ça arrive, l'infection se répand dans tout le ventre, et c'est beaucoup plus grave à soigner. C'est pour ça qu'on préfère l'enlever maintenant, pendant que c'est encore simple.

### Comment ça va se passer au bloc opératoire

Vous allez d'abord être endormi complètement, vous ne sentirez et ne vous souviendrez de rien. Le chirurgien fera généralement de tout petits trous dans votre ventre, pas une grande cicatrice, pour passer une petite caméra et de fins instruments. Il retirera doucement le petit organe malade. L'opération dure en général moins d'une heure.

### Après l'opération

Vous aurez un peu mal les premiers jours, c'est normal, on vous donnera des médicaments pour cela. Vous pourrez recommencer à manger doucement, d'abord des liquides, puis normalement. La plupart des patients rentrent chez eux après **un à trois jours**, et reprennent une vie normale en **une à deux semaines**.

### Ce que vous devez surveiller après être rentré

Si vous avez à nouveau de la fièvre, si votre ventre redevient très douloureux, ou si votre cicatrice devient rouge et chaude, appelez votre médecin ou revenez à l'hôpital. Ce sont des signes qu'il faut vérifier rapidement, mais rassurez-vous, cela reste rare quand tout s'est bien passé.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 13. PROFESSOR NOTES
  // ────────────────────────────────────────────────────────────────────
  {
    id: "professor",
    label: "Professor Notes",
    icon: GraduationCap,
    variant: "professor",
    content: `## Les phrases que les profs répètent tout le temps

> Ne me dites jamais "douleur en fosse iliaque droite égale appendicite" sans avoir éliminé une **grossesse extra-utérine** chez toute femme en âge de procréer. C'est LA question piège de tous les examens de chirurgie.

> Une **biologie normale n'élimine jamais** un diagnostic clinique évident. Combien d'étudiants se font piéger en repoussant l'indication opératoire parce que la NFS est encore normale !

> Le **signe de Blumberg**, c'est la douleur au relâchement, PAS à la palpation. Beaucoup d'étudiants confondent encore les deux à l'examen pratique.

> Devant un **plastron**, votre pire ennemi est votre propre impatience. On ne se précipite jamais au bloc sur une masse inflammatoire constituée — on refroidit d'abord.

> Chez la **personne âgée**, méfiez-vous d'un ventre qui a l'air calme. Le tableau clinique est souvent trompeusement discret alors que la maladie est déjà à un stade avancé. C'est une des causes classiques de retard diagnostique aux examens de cas cliniques.

> Ne prescrivez **jamais un laxatif ou un lavement** devant une douleur abdominale fébrile non expliquée. C'est une des rares erreurs de prescription qui peut littéralement provoquer l'explosion que vous cherchiez à éviter.

> Retenez que la douleur **migre** : elle commence vague, autour du nombril, puis elle se fixe, précise, en bas à droite. Si un cas clinique d'examen décrit cette migration, pensez appendicite avant toute autre chose.

> Le retour d'une zone à paludisme avec de la fièvre et une douleur abdominale, c'est un **paludisme jusqu'à preuve du contraire** — je vous le répéterai à chaque garde, et je vous le redemanderai à l'examen.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 14. FLASH SUMMARY
  // ────────────────────────────────────────────────────────────────────
  {
    id: "flash",
    label: "Flash Summary",
    icon: Zap,
    variant: "flash",
    content: `1. **Obstruction** de la lumière appendiculaire = point de départ de tout.
2. Cause chez l'adulte : **stercolithe**. Cause chez le jeune : **hyperplasie lymphoïde**.
3. La douleur **migre** : nombril ➔ **fosse iliaque droite**.
4. Signe clé : **défense pariétale** + **Blumberg positif**.
5. Fébricule **38-38,5 °C** ; fièvre élevée = suspicion de complication.
6. **Bêta-HCG systématique** chez la femme en âge de procréer.
7. Imagerie : **échographie** (jeune) ou **TDM** (adulte), appendice **> 6 mm**.
8. Traitement : **appendicectomie**, cœlioscopie de préférence.
9. **Plastron** = antibiotiques d'abord, chirurgie **à froid** ensuite.
10. Jamais de **laxatif** sur une douleur abdominale fébrile non étiquetée.`,
  },

  // ────────────────────────────────────────────────────────────────────
  // 15. AI HIGHLIGHT
  // ────────────────────────────────────────────────────────────────────
  {
    id: "aihighlight",
    label: "AI Highlight",
    icon: Wand2,
    variant: "highlight",
    content: `## Concepts redoutables détectés par l'IA

⭐ **La biologie normale ne protège de rien.** Beaucoup d'étudiants pensent qu'une NFS normale élimine l'appendicite. C'est faux : en tout début d'évolution, l'**hyperleucocytose** n'a pas encore eu le temps de s'installer. Un piège vicieux et très fréquent en QCM.

⭐ **La douleur peut ne jamais migrer.** Le tableau "manuel" (nombril puis FID) n'est présent que dans une minorité des cas réels. Un cas clinique peut décrire une douleur d'emblée fixée en FID, sans migration — ne rejetez pas le diagnostic pour cette seule raison.

⭐ **Le ventre peut être souple alors que tout est déjà grave.** C'est contre-intuitif, mais chez l'enfant et le sujet âgé, l'absence de défense franche n'élimine pas une forme déjà avancée, voire perforée.

⭐ **La grossesse fait "monter" l'appendice.** Au 3ème trimestre, l'utérus gravide repousse le cæcum et l'appendice vers le haut — une douleur de l'hypochondre droit chez une femme enceinte peut donc être une appendicite déguisée en cholécystite, et non l'inverse.

⭐ **Un plastron qui "disparaît" cliniquement n'est pas une bonne nouvelle.** Si la douleur s'arrête brutalement chez un patient qui semblait s'améliorer, méfiez-vous d'un mégacôlon toxique ou d'une perforation libre masquée par la paralysie du péristaltisme — l'absence de douleur n'est pas toujours un signe de guérison.`,
  },
];
