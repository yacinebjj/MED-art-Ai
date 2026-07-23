import {
  BookOpenText,
  ScrollText,
  AlertTriangle,
  Lightbulb,
  Stethoscope,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

export type DemoSectionId =
  | "explication"
  | "resume"
  | "pieges"
  | "astuces"
  | "cas_clinique"
  | "qcm";

export interface DemoSection {
  id: DemoSectionId;
  label: string;
  icon: LucideIcon;
  content: string;
}

export function buildDemoAskPrompt(selectedText: string): string {
  return `L'étudiant demande une explication détaillée sur ce passage précis de son cours de médecine : "${selectedText}". Explique-le comme un professeur de manière simple et précise.`;
}

export function buildDemoTranslatePrompt(selectedText: string): string {
  return `Traduis ce terme ou passage médical en arabe et en français courant : "${selectedText}".`;
}

const DEMO_DISCLAIMER =
  "*(Réponse de démonstration statique — l'intégration IA (OpenRouter) est actuellement en pause.)*";

export function buildDemoAskReply(selectedText: string): string {
  return `**Excellente question, Yacine !**\n\nRevenons sur : *"${selectedText}"*\n\nEn clinique, c'est exactement le genre de détail qui fait la différence entre "je connais le cours" et "je comprends le mécanisme". Imagine ça comme une pièce d'engrenage : si tu la retires du reste de l'explication, tout le mécanisme s'arrête de tourner.\n\n> 💡 **Retiens ceci :** reformule toujours ce passage avec tes propres mots avant de passer à la suite — c'est la meilleure façon de vérifier que tu l'as vraiment compris.\n\n${DEMO_DISCLAIMER}`;
}

export function buildDemoTranslateReply(selectedText: string): string {
  return `**Traduction de :** *"${selectedText}"*\n\n🇫🇷 **Français courant :** une reformulation simple de ce terme médical, sans jargon.\n\n🇸🇦 **العربية :** الترجمة الطبية المبسطة لهذا المصطلح.\n\n${DEMO_DISCLAIMER}`;
}

export const DEMO_SECTIONS: DemoSection[] = [
  {
    id: "explication",
    label: "Explication Ultra-Détaillée",
    icon: BookOpenText,
    content: `# L'Appendicite Aiguë : La Bombe à Retardement de l'Abdomen 💣

## De l'Obstruction Luminale à la Péritonite : Physiopathologie Moléculaire et Prise en Charge Chirurgicale d'Urgence

*Spécialement développé pour Yacine Drouche (Faculté de Médecine de Blida)*

## SOMMAIRE DÉTAILLÉ

- Avant-propos : La Vocation de Clinicien
- Chapitre I : Anatomie et Histologie de l'Appendice Vermiforme
- Chapitre II : Redéfinition Clinique et Pièges du Diagnostic Différentiel
- Chapitre III : Le Grand Mécanisme Physiopathologique — De l'Obstruction à la Perforation
- Chapitre IV : Les Formes Cliniques Trompeuses selon le Terrain
- Chapitre V : Stratification du Risque et Signes de Gravité
- Chapitre VI : Arsenal Diagnostique — Biologie, Scores Cliniques et Imagerie
- Chapitre VII : Stratégie Thérapeutique Fondamentale
- Chapitre VIII : Guide Pratique Contre l'Iatrogénie
- Chapitre IX : Travaux Dirigés (TD) — Cas Cliniques Décortiqués Pas à Pas
- Récapitulatif des Formes Évolutives

## AVANT-PROPOS — La Vocation de Clinicien

Installe-toi confortablement, Yacine. Prends de quoi noter, car ce que nous allons faire aujourd'hui dépasse largement le simple cadre d'une lecture passive de polycopié de faculté. Nous allons transformer ce petit organe vermiforme, souvent méprisé comme un vestige inutile de l'évolution, en la star absolue de ta garde de chirurgie. Au CHU de Blida, ou dans n'importe quel service d'urgences chirurgicales, l'appendicite aiguë est probablement l'urgence abdominale que tu rencontreras le plus souvent de toute ta carrière. Et pourtant, c'est aussi l'une des plus grandes pourvoyeuses d'erreurs diagnostiques, précisément parce qu'elle sait si bien se déguiser.

Ton rôle de médecin n'est pas de réciter "douleur en fosse iliaque droite = appendicite". Ton rôle est de comprendre pourquoi une simple obstruction millimétrique peut, en quelques heures, transformer un organe silencieux en une bombe prête à exploser dans la cavité abdominale. Nous allons analyser le "Comment" et le "Pourquoi" de chaque étape, du premier stercolithe jusqu'au bloc opératoire. Bienvenue dans ton traité personnalisé sur l'appendicite.

## CHAPITRE I : ANATOMIE ET HISTOLOGIE DE L'APPENDICE VERMIFORME

Avant de comprendre comment cet organe s'enflamme, il faut savoir exactement où il se trouve et de quoi il est fait — car sa position anatomique explique à elle seule la moitié des pièges cliniques de ce chapitre.

### 1. Une Implantation Fixe, une Position Variable

L'appendice vermiforme s'implante toujours au même endroit : à la convergence des trois bandelettes musculaires longitudinales du côlon (les ténias coliques), à la face postéro-interne du cæcum, environ 2 à 3 cm sous la valvule iléo-cæcale. Ce point d'implantation ne bouge JAMAIS — c'est un repère chirurgical absolu.

En revanche, la position de son extrémité libre, elle, est extraordinairement variable d'un individu à l'autre :
* **Position rétrocæcale (60 à 65% des cas) :** l'appendice se love derrière le cæcum, parfois même remontant vers le flanc droit. C'est la position la plus trompeuse cliniquement, car la défense abdominale antérieure peut être quasi absente (l'appendice enflammé est "protégé" par le cæcum lui-même).
* **Position pelvienne (30% des cas) :** l'appendice plonge dans le petit bassin, au contact direct de la vessie, du rectum ou des annexes chez la femme — source de confusion diagnostique fréquente avec une pathologie gynécologique ou urinaire.
* **Position sous-hépatique :** rare, mais responsable de tableaux mimant une cholécystite aiguë, en particulier chez la femme enceinte dont l'utérus refoule le cæcum vers le haut.
* **Position mésocœliaque :** l'appendice se love au milieu des anses grêles, provoquant volontiers un iléus réflexe précoce (occlusion fonctionnelle).

> 💡 **L'Astuce du Prof :** Au bloc opératoire, si tu ne retrouves pas l'appendice au premier coup d'œil, ne panique jamais. Suis les trois ténias coliques du doigt : elles convergent TOUJOURS, comme des rails de chemin de fer, vers la base de l'appendice. C'est la technique infaillible de repérage chirurgical.

### 2. Une Histologie qui Explique Tout

Sur le plan histologique, l'appendice est une véritable "amygdale abdominale". Sa sous-muqueuse est extrêmement riche en follicules lymphoïdes, un tissu qui atteint son maximum de développement entre 10 et 20 ans — ce qui explique pourquoi l'appendicite est si fréquente chez l'adolescent et l'adulte jeune. Sa lumière est étroite, tubulaire, et se draine par un orifice minuscule dans le cæcum — un détail anatomique qui, tu vas le voir, est la clé de voûte de toute la physiopathologie.

📌 مصطلح مهم : الزائدة الدودية (l'appendice vermiforme) — تذكر أن موقعها ثابت لكن اتجاهها متغير

## CHAPITRE II : REDÉFINITION CLINIQUE ET PIÈGES DU DIAGNOSTIC DIFFÉRENTIEL

### 1. Le Syndrome Appendiculaire Typique

Cliniquement, on parle de syndrome appendiculaire devant l'association d'une douleur de la fosse iliaque droite (FID), d'une fébricule modérée (38 à 38,5°C — une fièvre élevée doit au contraire t'inquiéter d'une complication), de nausées, et d'une défense pariétale localisée à la palpation. Mais attention, Yacine : ce tableau "de manuel" n'est présent que dans une minorité des cas réels !

### 2. Le Spectre des Diagnostics Différentiels à Éliminer Systématiquement

Toute douleur de la fosse iliaque droite n'est pas une appendicite, et une bonne partie de ton examen clinique doit consister à éliminer activement les pièges suivants :
* **Chez la femme jeune :** la Grossesse Extra-Utérine (GEU) et la torsion d'annexe sont les deux diagnostics à éliminer avant tout — d'où l'obligation absolue d'un dosage des bêta-HCG chez TOUTE femme en âge de procréer présentant une douleur de FID.
* **Chez l'enfant :** l'adénite mésentérique (souvent liée à une infection à Yersinia ou virale) peut donner une fièvre élevée et une douleur de FID quasi identique — le piège classique de la "fausse appendicite".
* **Chez l'adulte jeune :** l'iléite terminale (maladie de Crohn en poussée inaugurale) peut mimer trait pour trait le tableau.
* **Chez tous :** la colique néphrétique droite, la pyélonéphrite droite, et le diverticule de Meckel enflammé (qui reproduit une physiopathologie quasi identique à l'appendicite, sur un organe différent).

> 💡 **L'Astuce du Prof :** Devant toute douleur de FID chez une femme en âge de procréer, le réflexe "bêta-HCG" doit être aussi automatique que de prendre la tension artérielle. Opérer une GEU en pensant traiter une appendicite est une des erreurs les plus graves — et les plus évitables — de la chirurgie d'urgence.

📌 التشخيص التفريقي : احذر الحمل خارج الرحم عند كل امرأة في سن الإنجاب

## CHAPITRE III : LE GRAND MÉCANISME PHYSIOPATHOLOGIQUE — DE L'OBSTRUCTION À LA PERFORATION

Voici le cœur battant de ce cours, Yacine. Comprends bien cette cascade en cinq actes, et tu comprendras absolument tout le reste : la clinique, l'urgence, et le traitement.

### Acte 1 : L'Obstruction Luminale

Tout commence par l'obstruction de cette lumière appendiculaire étroite dont on a parlé au Chapitre I. Chez l'adulte, le coupable le plus fréquent est le stercolithe (un petit amas de matières fécales durcies et calcifiées). Chez l'enfant et l'adulte jeune, c'est le plus souvent une hyperplasie réactionnelle des follicules lymphoïdes de la sous-muqueuse — ces mêmes follicules qui font de l'appendice une "amygdale abdominale" gonflent en réaction à une infection virale banale (une simple angine ou une gastro-entérite peut suffire) et viennent comprimer la lumière de l'intérieur.

### Acte 2 : La Distension et la Prolifération Bactérienne

Imagine un ballon de baudruche que l'on gonfle à l'intérieur d'une pièce aux murs rigides et non extensibles. Une fois la lumière obstruée, la muqueuse continue de sécréter du mucus en amont du bouchon. Ce mucus s'accumule, ne peut plus s'évacuer, et la flore bactérienne normalement présente dans la lumière (E. coli, Bacteroides fragilis) se met à proliférer de façon exponentielle dans ce milieu confiné et stagnant.

### Acte 3 : La Phase Congestive (ou Catarrhale)

La pression intraluminale continue de monter. Elle finit par dépasser la pression de perfusion veineuse et lymphatique de la paroi appendiculaire (qui est une pression basse, facilement dépassée). Résultat : un œdème pariétal s'installe, la paroi s'épaissit et devient congestive. C'est le stade le plus précoce et le plus discret — la douleur est encore vague, souvent péri-ombilicale ou épigastrique, car l'innervation viscérale de l'appendice remonte au même niveau médullaire que celle de l'intestin moyen embryonnaire.

### Acte 4 : La Phase Suppurée puis Gangreneuse

La pression continue d'augmenter et finit, cette fois, par dépasser la pression de perfusion artériolaire (bien plus élevée). C'est le point de bascule : l'ischémie pariétale s'installe. Les bactéries, profitant de cette brèche dans les défenses tissulaires, envahissent massivement la paroi appendiculaire : c'est la phase suppurée ou phlegmoneuse. Si rien n'est fait, l'ischémie devient totale et la paroi se nécrose complètement : c'est la phase gangreneuse.

> 💡 **L'Astuce du Prof :** Retiens cette règle absolue : "D'abord la veine se bouche, puis l'artère se bouche." C'est exactement à ce moment de bascule veino-artérielle que la douleur "migre" du nombril vers la fosse iliaque droite — car l'inflammation atteint enfin le péritoine pariétal (richement innervé et parfaitement localisé), alors qu'avant elle ne touchait que le péritoine viscéral (mal localisé).

### Acte 5 : La Perforation

Une paroi nécrosée finit toujours par céder. La perforation peut prendre deux visages radicalement différents selon la rapidité de constitution du processus :
* **Perforation "contenue" :** si l'évolution est assez lente, l'épiploon (le "tablier" graisseux de l'abdomen) et les anses intestinales voisines ont le temps de venir "coller" autour de l'appendice enflammé pour circonscrire l'infection. On parle alors de plastron appendiculaire (masse inflammatoire palpable) ou d'abcès appendiculaire (collection purulente organisée).
* **Perforation libre :** si l'évolution est brutale (typiquement chez l'enfant, dont l'épiploon est peu développé, ou chez la personne âgée, dont le diagnostic est souvent retardé), le contenu septique se déverse directement dans la grande cavité péritonéale : c'est la péritonite généralisée, une urgence vitale absolue.

📌 المرحلة الأخطر : عندما ينتقل الألم من السرة إلى الحفرة الحرقفية اليمنى، فهذا يعني أن الالتهاب وصل إلى الغشاء البريتوني

## CHAPITRE IV : LES FORMES CLINIQUES TROMPEUSES SELON LE TERRAIN

### 1. Chez l'Enfant : La Vitesse de l'Évolution

Chez le jeune enfant, l'épiploon est encore court et peu développé — il ne parvient pas efficacement à circonscrire l'infection. Résultat : l'évolution vers la perforation libre et la péritonite généralisée est nettement plus rapide et plus fréquente que chez l'adulte. Ne sous-estime JAMAIS une douleur abdominale fébrile chez un enfant.

### 2. Chez la Personne Âgée : Le Piège de la Discrétion

Chez le sujet âgé, la réponse inflammatoire est souvent atténuée : moins de fièvre, moins de défense pariétale, douleur parfois diffuse et peu franche. À cela s'ajoute une athérosclérose mésentérique fréquente qui aggrave l'ischémie pariétale dès le début du processus. Conséquence dramatique : le diagnostic est très souvent posé tardivement, au stade de perforation ou de péritonite — la mortalité de l'appendicite chez le sujet âgé est ainsi bien supérieure à celle de l'adulte jeune.

### 3. Chez la Femme Enceinte : L'Organe qui Se Déplace

À mesure que la grossesse progresse, l'utérus gravide repousse progressivement le cæcum et l'appendice vers le haut et l'extérieur. Au troisième trimestre, la douleur appendiculaire peut ainsi se projeter au niveau de l'hypochondre droit, mimant trait pour trait une cholécystite aiguë — un piège diagnostique classique des examens.

> 💡 **L'Astuce du Prof :** Retiens cette phrase pour l'examen : "Plus la grossesse avance, plus l'appendice monte." Une douleur "de cholécystite" chez une femme enceinte au troisième trimestre doit systématiquement faire évoquer l'appendicite avant de conclure trop vite.

📌 عند المرأة الحامل : الزائدة الدودية ترتفع مع تقدم الحمل، مما يغيّر مكان الألم

## CHAPITRE V : STRATIFICATION DU RISQUE ET SIGNES DE GRAVITÉ

Face à toute suspicion d'appendicite, ton second réflexe (après le diagnostic positif) est de rechercher activement les signes annonçant une complication, car ils changent radicalement la prise en charge.

Les signes devant t'alarmer immédiatement :
* **La contracture abdominale généralisée** ("ventre de bois") : signe pathognomonique d'une péritonite généralisée déjà installée — c'est une urgence chirurgicale absolue, sans délai.
* **Une fièvre élevée supérieure à 39°C avec frissons :** évoque une bactériémie ou un abcès profond.
* **Un arrêt des matières et des gaz :** traduit un iléus réflexe, témoin d'une irritation péritonéale importante.
* **Une masse palpable en fosse iliaque droite avec fièvre oscillante :** oriente vers un plastron ou un abcès appendiculaire déjà constitué.
* **Des signes de choc septique débutant** (tachycardie, hypotension, marbrures) : traduit une diffusion septique généralisée, pronostic vital engagé.

Pour t'aider à structurer ton raisonnement diagnostique dès l'examen initial, retiens le principe du score de Alvarado (souvent résumé par le mnémotechnique MANTRELS : Migration de la douleur, Anorexie, Nausées/vomissements, Tenderness (douleur) en FID, Rebond douloureux, Élévation thermique, Leucocytose, Shift à gauche des neutrophiles) — plus le score est élevé, plus la probabilité d'appendicite est forte.

📌 علامة الخطر الكبرى : "بطن خشبي" (ventre de bois) يعني التهاب الغشاء البريتوني الشامل

## CHAPITRE VI : ARSENAL DIAGNOSTIQUE — BIOLOGIE, SCORES CLINIQUES ET IMAGERIE

### 1. La Biologie

La NFS retrouve typiquement une hyperleucocytose à prédominance de polynucléaires neutrophiles, et la CRP est souvent élevée. Mais attention : ces deux marqueurs peuvent rester strictement normaux en tout début d'évolution — une biologie normale n'élimine JAMAIS le diagnostic si la clinique est franche. Le dosage des bêta-HCG est, on l'a vu, systématique chez toute femme en âge de procréer.

### 2. L'Échographie Abdominale

Examen de première intention chez l'enfant et la femme jeune (absence d'irradiation), l'échographie recherche un appendice augmenté de diamètre (supérieur à 6 mm), une paroi épaissie, un stercolithe échogène avec cône d'ombre, et un épanchement péri-appendiculaire. Sa limite majeure : sa sensibilité chute fortement en cas de position rétrocæcale ou de morphotype obèse.

### 3. Le Scanner Abdomino-Pelvien Injecté

C'est l'examen de référence chez l'adulte en cas de doute diagnostique : sa sensibilité et sa spécificité dépassent 95%. Il permet également, en cas de retard diagnostique, de caractériser précisément une complication (abcès, plastron, péritonite localisée) et d'orienter la stratégie thérapeutique.

> 💡 **L'Astuce du Prof :** Ne te laisse jamais rassurer aveuglément par une échographie normale si ta clinique est franche et évocatrice — l'appendice rétrocæcal est un véritable maître du camouflage échographique. Dans le doute, le scanner ou la surveillance clinique rapprochée s'imposent.

📌 فحص أساسي عند كل امرأة في سن الإنجاب : تحليل الحمل قبل أي قرار جراحي

## CHAPITRE VII : STRATÉGIE THÉRAPEUTIQUE FONDAMENTALE

### 1. L'Appendicectomie : Le Traitement de Référence

Devant une appendicite aiguë confirmée, le traitement de référence reste chirurgical : l'appendicectomie. La voie cœlioscopique est aujourd'hui privilégiée en première intention dans la grande majorité des cas — elle permet une exploration complète de la cavité abdominale (précieuse en cas de doute diagnostique), des suites opératoires plus simples, et un risque moindre d'infection pariétale. La voie ouverte (incision de McBurney) garde ses indications dans les formes très évoluées, compliquées, ou en cas de contre-indication à la cœlioscopie.

### 2. L'Antibiothérapie Périopératoire

Dans les formes non compliquées, une antibioprophylaxie courte en péri-opératoire suffit. En revanche, en cas de péritonite ou d'abcès constitué, une véritable antibiothérapie curative, prolongée, à large spectre couvrant les germes digestifs (aérobies et anaérobies), doit être instaurée.

### 3. Le Cas Particulier du Plastron Appendiculaire

Devant un plastron déjà constitué (masse inflammatoire dense), opérer immédiatement expose à un risque élevé de plaie digestive, tant les tissus sont inflammatoires et friables. La stratégie recommandée est donc, dans un premier temps, un traitement médical (antibiothérapie ± drainage radiologique d'un éventuel abcès), suivi d'une appendicectomie "à froid", programmée 6 à 8 semaines plus tard, une fois l'inflammation apaisée.

> 💡 **L'Astuce du Prof :** Face à un plastron, la précipitation chirurgicale est ton pire ennemi. "Refroidir avant d'opérer" — retiens cette formule, elle est régulièrement demandée aux examens.

📌 مبدأ ذهبي : لا تُجرِ عملية جراحية على كتلة التهابية ساخنة، انتظر حتى "تبرد"

## CHAPITRE VIII : GUIDE PRATIQUE CONTRE L'IATROGÉNIE — POURQUOI UN LAXATIF PEUT TUER

S'il y a une notion que tu dois retenir de ce chapitre, Yacine, c'est celle-ci : IL EST FORMELLEMENT INTERDIT DE PRESCRIRE UN LAXATIF OU DE RÉALISER UN LAVEMENT DEVANT UNE DOULEUR ABDOMINALE FÉBRILE NON ÉTIQUETÉE, a fortiori si une appendicite n'a pas été formellement éliminée.

### Visualise la Scène Cellulaire

Imagine une paroi appendiculaire déjà fragilisée par l'ischémie du Chapitre III, amincie, prête à céder au moindre stress mécanique supplémentaire. Un patient se présente avec une douleur abdominale encore mal étiquetée. Par excès de prudence ou par réflexe (croyant à une simple constipation), on lui prescrit un laxatif stimulant ou on réalise un lavement évacuateur.

### La Catastrophe Mécanique

Le laxatif ou le lavement va provoquer une hyperpéristaltisme colique brutal et augmenter la pression intraluminale dans tout le cadre colique, y compris au niveau du cæcum et de la base appendiculaire déjà obstruée et fragilisée. Cette surpression mécanique, appliquée sur une paroi déjà nécrosée ou sur le point de l'être, peut précipiter en quelques minutes une perforation qui aurait peut-être mis encore plusieurs heures à survenir spontanément — transformant une appendicite localisée en péritonite généralisée foudroyante.

**La règle d'or à retenir :** devant toute douleur abdominale non formellement expliquée, l'abstention de tout laxatif et de tout lavement est une règle de sécurité absolue, jusqu'à élimination formelle d'une urgence chirurgicale.

📌 قاعدة ذهبية : لا تُعطِ مليّناً أبداً أمام ألم بطني غير مشخّص

## CHAPITRE IX : TRAVAUX DIRIGÉS (TD) — CAS CLINIQUES DÉCORTIQUÉS PAS À PAS

### CAS CLINIQUE N°1 : L'Enfant qui Ne Se Plaint Pas Assez

Un garçon de 6 ans est amené par ses parents pour une douleur abdominale évoluant depuis 18 heures, initialement péri-ombilicale, désormais localisée en fosse iliaque droite. Il présente une fièvre à 38,7°C, un refus de s'alimenter, et une démarche voûtée en se tenant le ventre. L'examen retrouve une défense franche en FID et des vomissements à deux reprises.

**Questions de Réflexion :**
1. Quel est le syndrome clinique en cause, et quel risque évolutif spécifique dois-tu redouter chez cet enfant ?
2. Quelle est ta conduite à tenir immédiate ?

**Décorticage pas à pas du Professeur :**
* **Analyse du Syndrome :** Le tableau est un syndrome appendiculaire typique — douleur migratrice, fièvre modérée, défense localisée. Chez l'enfant de cet âge, la cause la plus probable est une hyperplasie lymphoïde obstructive (Chapitre III).
* **Analyse de la Gravité :** Comme vu au Chapitre IV, l'épiploon peu développé chez l'enfant expose à un risque accru et rapide de perforation libre et de péritonite généralisée. Le délai de 18 heures impose une prise en charge sans délai supplémentaire.
* **Action Médicale :** Bilan biologique standard (NFS, CRP), échographie abdominale en première intention (pas d'irradiation chez l'enfant), et indication opératoire posée sans attendre une aggravation, idéalement par voie cœlioscopique.

### CAS CLINIQUE N°2 : La Personne Âgée au Tableau Trompeusement Calme

Une patiente de 78 ans consulte pour une gêne abdominale diffuse évoluant depuis 3 jours, sans fièvre notable (37,3°C), avec un transit ralenti. L'examen retrouve une sensibilité modérée en FID, sans véritable défense franche. La NFS montre une hyperleucocytose importante à 18 000/mm³.

**Questions de Réflexion :**
1. Pourquoi ce tableau clinique "rassurant en apparence" est-il en réalité extrêmement préoccupant ?
2. Quelle imagerie demandes-tu en urgence, et pourquoi ?

**Décorticage pas à pas du Professeur :**
* **Analyse du Piège :** Comme vu au Chapitre IV, la personne âgée présente classiquement une clinique atténuée et trompeuse, malgré une évolution biologique et anatomique souvent déjà avancée — la discordance entre une clinique modérée et une hyperleucocytose franche à 18 000/mm³ est un signal d'alarme majeur, pas un motif de réassurance.
* **Analyse de la Gravité :** Le délai d'évolution de 3 jours associé à ce contexte fait fortement craindre une forme déjà compliquée (plastron, abcès, voire perforation contenue).
* **Action Médicale :** Un scanner abdomino-pelvien injecté s'impose en urgence (examen de référence chez l'adulte, Chapitre VI) pour caractériser précisément le stade évolutif et guider la décision thérapeutique — chirurgie immédiate versus traitement médical premier en cas de plastron constitué (Chapitre VII).

### CAS CLINIQUE N°3 : La Jeune Femme et le Piège Gynécologique

Une femme de 24 ans, sans antécédents, consulte pour une douleur de la fosse iliaque droite évoluant depuis 24 heures, avec une fébricule à 38,1°C. Ses dernières règles remontent à 7 semaines.

**Questions de Réflexion :**
1. Quel est le premier réflexe diagnostique absolu à avoir chez cette patiente, avant toute autre considération ?
2. Si ce premier examen est négatif, quelle est ta démarche diagnostique ensuite ?

**Décorticage pas à pas du Professeur :**
* **Analyse du Piège :** Comme vu au Chapitre II, toute femme en âge de procréer présentant une douleur de FID impose, avant tout raisonnement chirurgical, l'élimination formelle d'une grossesse extra-utérine par un dosage des bêta-HCG — le retard de règles à 7 semaines rend ce réflexe encore plus impératif ici.
* **Analyse de la Gravité :** Confondre une GEU rompue avec une appendicite est l'une des erreurs les plus graves de la médecine d'urgence, avec un risque hémorragique vital immédiat en cas de GEU méconnue.
* **Action Médicale :** Dosage des bêta-HCG en urgence absolue. Si négatif, on complète par une échographie pelvienne (élimination d'une torsion d'annexe) puis, si le doute persiste, un scanner ou une exploration cœlioscopique diagnostique et thérapeutique en un temps.

## RÉCAPITULATIF DES FORMES ÉVOLUTIVES

| Paramètre | Phase Catarrhale | Phase Suppurée | Phase Gangreneuse | Phase Perforée |
|---|---|---|---|---|
| Mécanisme | Œdème pariétal, stase veineuse | Invasion bactérienne transmurale | Nécrose pariétale complète | Rupture de la paroi |
| Douleur | Péri-ombilicale, vague | FID, franche, localisée | FID, intense, permanente | Généralisée, contracture |
| Fièvre | Absente à discrète | Modérée (38-38,5°C) | Élevée | Élevée avec frissons |
| Risque | Faible si traité vite | Modéré | Élevé | Vital, péritonite |
| Conduite à Tenir | Appendicectomie programmée | Appendicectomie en urgence | Appendicectomie en urgence absolue | Chirurgie immédiate + réanimation |

Voilà, Yacine ! Te voilà désormais armé d'une compréhension complète et exhaustive de l'appendicite aiguë, de la première molécule bloquée dans la lumière appendiculaire jusqu'au bloc opératoire. Mémorise cette cascade physiopathologique en cinq actes, garde toujours en tête les pièges du terrain, et surtout : ne sous-estime jamais une douleur abdominale qui migre vers la fosse iliaque droite. Bon courage pour tes gardes de chirurgie, et à très vite pour la suite de ton programme !`,
  },
  {
    id: "resume",
    label: "Résumé",
    icon: ScrollText,
    content: `## Résumé Express : Appendicite Aiguë

*   **Définition :** Inflammation de l'appendice, cul-de-sac accroché au cæcum.
*   **Cause :** Obstruction de la lumière appendiculaire (hyperplasie lymphoïde chez le jeune, stercolithe chez l'adulte).
*   **Clinique :** Douleur péri-ombilicale migrant vers la Fosse Iliaque Droite (point de McBurney), fièvre modérée, nausées.
*   **Signes associés :** Défense abdominale en FID, signe de Blumberg (douleur à la décompression).
*   **Diagnostic :** Clinique + biologie (hyperleucocytose) + échographie/scanner si doute.
*   **Traitement :** Appendicectomie, en urgence.

> 💡 **Note du prof :** Si tu ne dois retenir qu'une phrase : douleur qui migre du nombril vers la FID = appendicite jusqu'à preuve du contraire.`,
  },
  {
    id: "pieges",
    label: "Les Pièges",
    icon: AlertTriangle,
    content: `## Les Pièges Classiques à l'examen ⚠️

> 💡 **Piège n°1 :** Ne confonds pas la douleur péri-ombilicale initiale avec une gastro-entérite — l'examinateur adore ce piège chez les étudiants pressés.

*   **Chez la femme jeune :** Élimine toujours une grossesse extra-utérine ou une torsion d'annexe avant de conclure trop vite à une appendicite.
*   **Chez la personne âgée :** La présentation est souvent atypique (peu de fièvre, douleur diffuse) — le risque de perforation est plus élevé car le diagnostic est retardé.
*   **Chez l'enfant :** Ne néglige jamais une douleur abdominale fébrile — l'évolution vers la perforation est plus rapide.
*   **Erreur fréquente :** Attendre une hyperleucocytose franche avant d'opérer — une NFS normale n'élimine PAS le diagnostic.`,
  },
  {
    id: "astuces",
    label: "Astuces Mnémotechniques",
    icon: Lightbulb,
    content: `## Astuces Mnémotechniques 🧠

> 💡 **Pour la migration de la douleur :** "Du nombril au point Mc, en passant par la crampe" — retiens le trajet en trois temps : ombilic → diffuse → Fosse Iliaque Droite.

*   **Point de McBurney :** situé au tiers externe de la ligne reliant l'ombilic à l'épine iliaque antéro-supérieure droite — pense à "2/3 - 1/3".
*   **Signe de Blumberg :** la décompression fait plus mal que la compression — "ça fait mal quand on relâche, pas quand on appuie".
*   **Triade clinique :** Douleur FID + Défense + Fièvre = pense appendicite avant tout.`,
  },
  {
    id: "cas_clinique",
    label: "Cas Clinique",
    icon: Stethoscope,
    content: `## Cas Clinique : À toi de jouer, Yacine 🩺

Amine, 19 ans, se présente aux urgences pour une douleur abdominale débutée la veille au soir autour du nombril, de type crampe, puis migrant ce matin vers la fosse iliaque droite. Il présente une fièvre à 38.2°C, des nausées sans vomissement, et une défense à la palpation de la FID.

**Questions :**
1. Quel est ton diagnostic le plus probable, et pourquoi ?
2. Quel signe clinique iras-tu rechercher pour le confirmer ?
3. Quel examen complémentaire demanderais-tu en première intention ?

> 💡 **Indice du prof :** Relis bien la section "Clinique" de l'explication détaillée — la chronologie de la douleur est la clé de ce cas.`,
  },
  {
    id: "qcm",
    label: "Examen QCMs",
    icon: ListChecks,
    content: `## QCM : Teste-toi sur l'Appendicite

**1. Quelle est la cause la plus fréquente d'obstruction appendiculaire chez l'adulte ?**
A. Hyperplasie lymphoïde
B. Stercolithe
C. Tumeur carcinoïde
D. Corps étranger

**2. Le point de McBurney se situe :**
A. Au tiers interne de la ligne ombilic - épine iliaque antéro-supérieure
B. Au tiers externe de cette même ligne
C. Sur la ligne médiane sous-ombilicale
D. Au niveau du flanc gauche

**3. Le signe de Blumberg correspond à :**
A. Une douleur à la palpation profonde
B. Une douleur à la décompression brutale
C. Une douleur uniquement nocturne
D. Une contracture généralisée

> 💡 **Réponses :** 1-B, 2-B, 3-B. Si tu as tout bon, tu es prêt(e) pour la garde de chirurgie !`,
  },
];
