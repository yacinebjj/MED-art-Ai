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
  /** Per-tab color identity for the Studio sidebar (literal Tailwind classes). */
  accent: {
    /** Applied to the whole button when the tab is active. */
    active: string;
    /** Colored icon "badge" chip, shown in every state. */
    chip: string;
    /** Premium hover state (colored glow + lift) when the tab is idle. */
    hover: string;
  };
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
  return `**Excellente question, Yacine !**\n\nRevenons sur : *"${selectedText}"*\n\nEn clinique, c'est exactement le genre de détail qui fait la différence entre "je connais le cours" et "je comprends le mécanisme". Imagine ça comme une pièce d'engrenage : si tu la retires du reste de l'explication, tout le mécanisme s'arrête de tourner.\n\n> **Retiens ceci :** reformule toujours ce passage avec tes propres mots avant de passer à la suite — c'est la meilleure façon de vérifier que tu l'as vraiment compris.\n\n${DEMO_DISCLAIMER}`;
}

export function buildDemoTranslateReply(selectedText: string): string {
  return `**Traduction de :** *"${selectedText}"*\n\n**Français courant :** une reformulation simple de ce terme médical, sans jargon.\n\n**العربية :** الترجمة الطبية المبسطة لهذا المصطلح.\n\n${DEMO_DISCLAIMER}`;
}

export const DEMO_SECTIONS: DemoSection[] = [
  {
    id: "explication",
    label: "Explication Ultra-Détaillée",
    icon: BookOpenText,
    accent: {
      active: "border-blue-300 bg-blue-50 text-blue-800",
      chip: "bg-blue-100 text-blue-600",
      hover: "hover:-translate-y-1 hover:bg-blue-50 hover:text-blue-600 hover:shadow-md",
    },
    content: `# L'Appendicite Aiguë en Milieu Tropical

## Un cours complet, expliqué avec des mots très simples

Bonjour. On va apprendre l'appendicite ensemble. Je vais parler avec des mots faciles. Des phrases courtes. Beaucoup d'exemples de la vie de tous les jours. Mon but est simple : tu dois tout comprendre, même si le français est dur pour toi.

Ne va pas trop vite. Lis chaque ligne. Chaque petite idée aide à comprendre la suivante. À la fin, tu vas connaître l'appendicite très bien. Et tu vas la comprendre, pas juste la réciter.

> Ce cours est long. C'est normal. Un bon médecin prend son temps pour comprendre. Va à ton rythme, fais des pauses, et reviens quand tu veux.

## Sommaire

● Avant-propos : pourquoi ce cours est important
● Chapitre I : L'appendice, c'est quoi ?
● Chapitre II : Un petit sac plein de soldats
● Chapitre III : Le tapis roulant de mucus
● Chapitre IV : Les faux amis
● Chapitre V : Le film en cinq étapes
● Chapitre VI : Pourquoi la douleur bouge
● Chapitre VII : Le ver qui bouche le tuyau
● Chapitre VIII : L'alarme de la cellule
● Chapitre IX : Les pompiers du corps
● Chapitre X : Pourquoi le corps chauffe
● Chapitre XI : Qui part à l'hôpital tout de suite ?
● Chapitre XII : Les outils du médecin
● Chapitre XIII : Comment on soigne
● Chapitre XIV : Autour de l'opération
● Chapitre XV : L'erreur qui peut tuer
● Récapitulatif

## AVANT-PROPOS : Pourquoi ce cours est important

L'appendicite est une maladie très fréquente. Tu vas la voir souvent dans ta vie de médecin. Le problème, c'est qu'elle sait se cacher. Parfois elle a l'air d'un simple mal de ventre. Mais elle peut tuer en quelques heures.

Dans une grande ville, c'est plus facile. Il y a l'hôpital juste à côté. Il y a des machines pour voir dans le ventre. Mais dans beaucoup de régions chaudes, l'hôpital est loin. Très loin. Parfois à plusieurs heures de route. Là, tout change.

Attends, réponds-moi : qu'est-ce qui change quand l'hôpital est à quatre heures de route ? Réfléchis avant de lire la suite.

>> La réponse : tu ne peux plus attendre d'être sûr à 100 pour cent. Tu dois décider vite. Parfois, tu envoies le malade à l'hôpital juste sur un doute. Mieux vaut un doute qu'un mort.

C'est le fil rouge de tout ce cours. On va y revenir souvent.

## CHAPITRE I : L'appendice, c'est quoi ?

Imagine ton gros intestin. C'est un grand tuyau. Au début de ce tuyau, il y a une petite poche. On l'appelle le cæcum. Et sur cette poche, il y a un petit doigt creux. Fin. Fermé au bout. C'est ça, l'appendice.

Pense à un petit gant, mais avec un seul doigt. Ce doigt est vide à l'intérieur. Il a une seule petite porte pour entrer et sortir. C'est très important. Garde bien cette image.

Le point où l'appendice est accroché ne bouge jamais. C'est toujours le même endroit. Mais la pointe, elle, peut se cacher partout :

➔ **Derrière le cæcum** : c'est le cas le plus fréquent. Là, l'appendice est caché. Quand on appuie sur le ventre, on ne sent presque rien. C'est le plus traître.
➔ **Vers le bas** : l'appendice descend près de la vessie. Ou près des organes de la femme. On confond alors avec un problème urinaire ou de femme.
➔ **Vers le haut** : rare. La douleur monte et ressemble à un problème de foie.

■ Retiens une image forte : l'appendice est un **cul-de-sac**. Une rue sans issue. Une seule entrée. Tout ce qui rentre doit ressortir par le même trou. Si on bloque l'entrée, tout reste coincé dedans.

> **L'Astuce du Prof :** au bloc opératoire, si tu ne trouves pas l'appendice, ne panique pas. Le gros intestin a trois bandes de muscle sur sa surface. Comme trois rails de train. Suis ces rails avec le doigt. Ils se rejoignent toujours pile à la base de l'appendice. C'est le truc qui marche à tous les coups.

> ملخص بالعربية : الزائدة الدودية هي أنبوب صغير مسدود من طرف واحد، له باب واحد فقط. إذا انسد هذا الباب، يبقى كل شيء محبوساً بالداخل.

## CHAPITRE II : Un petit sac plein de soldats

Beaucoup d'étudiants pensent que l'appendice ne sert à rien. C'est faux. Dans sa paroi, il y a beaucoup de cellules de défense. Ce sont les soldats du corps. Ils se battent contre les microbes.

On peut voir l'appendice comme une petite caserne de soldats. Une base militaire dans le ventre. Toujours prête à combattre.

Cette caserne est la plus remplie entre 10 et 20 ans. Et devine quoi ? C'est justement l'âge où l'appendicite arrive le plus souvent. Ce n'est pas un hasard. Tu vas comprendre pourquoi.

Quand tu attrapes un rhume ou une petite gastro, tout ton corps se met en alerte. Les soldats se réveillent partout. Même ceux de l'appendice. Ils se multiplient vite. Et ils gonflent.

▲ Et voilà le problème : le tuyau de l'appendice est déjà tout fin. Si les soldats gonflent trop, ils bouchent le passage de l'intérieur. Comme une éponge sèche qu'on mouille : elle gonfle et remplit tout le tuyau.

Tu es avec moi ? Ne décroche pas. C'est le point de départ de la maladie : **un tuyau fin qui se bouche facilement.**

>> Point clé à retenir : une infection banale, loin du ventre, peut réveiller les soldats de l'appendice, les faire gonfler, et boucher le tuyau. Une petite cause pour un gros problème.

## CHAPITRE III : Le tapis roulant de mucus

Il y a une deuxième chose à comprendre. La paroi de l'appendice fabrique du mucus. Le mucus, c'est un gel qui glisse. Un peu comme du blanc d'œuf.

Ce gel a un rôle : il attrape les microbes et les pousse doucement vers la sortie. Vers le gros intestin. C'est comme un tapis roulant dans un aéroport. Il avance tout seul et emmène les bagages. Ici, il emmène les microbes dehors.

Tant que le tuyau est ouvert, ce tapis roulant nettoie tout seul. Personne n'y pense. Tout va bien.

Mais réfléchis deux secondes : que se passe-t-il si la sortie est bouchée ?

⮞ Le tapis roulant tourne encore. Le mucus continue d'être fabriqué. Mais il ne peut plus sortir. Alors il s'accumule. De plus en plus.

⮞ Et un endroit chaud, humide, fermé, plein de mucus, c'est le paradis des microbes. Ils adorent. Ils se multiplient à toute vitesse.

Voilà comment un simple bouchon change tout. L'appendice était propre. Maintenant, c'est un nid à microbes.

> Note simple : le mucus n'est pas mauvais. Au contraire, il protège. Le problème, ce n'est pas le mucus. Le problème, c'est le bouchon qui l'empêche de sortir.

> ملخص بالعربية : المخاط ينظّف الأنبوب مثل السير المتحرك. لكن إذا انسدت المخارج، يتجمّع المخاط ويصبح بيئة مثالية لتكاثر الجراثيم.

## CHAPITRE IV : Les faux amis

Attention. Ce chapitre est le plus dangereux. Écoute bien.

Tout mal de ventre en bas à droite n'est PAS une appendicite. Dans les régions chaudes, plusieurs maladies portent le même masque. Elles ressemblent à l'appendicite mais ce sont autre chose. Si tu te trompes, ça peut coûter une vie.

>>> Danger : chez toute femme qui peut avoir des enfants et qui a mal en bas à droite, il faut TOUJOURS penser à une grossesse dans la trompe. On appelle ça une grossesse extra-utérine. Il faut l'éliminer avant de dire appendicite. Ne l'oublie JAMAIS. C'est une erreur qui tue.

Voici les principaux faux amis à connaître dans les zones tropicales :

| Maladie | Chez qui | Ce qui doit t'alerter | L'examen qui aide |
|---|---|---|---|
| Vraie appendicite | Surtout 10-30 ans | Douleur qui part du nombril et descend à droite | Échographie ou surveillance |
| Fièvre typhoïde | Eau sale, mauvaise hygiène | Fièvre longue, patient très fatigué | Prise de sang |
| Paludisme | Zone de moustiques | Fièvre + grande fatigue, parfois jaunisse | Goutte de sang au microscope |
| Amibiase | Eau ou nourriture sale | Diarrhée avec du sang | Examen des selles |

⮞ Un dernier faux ami, très fréquent chez l'enfant : la gastro. L'enfant a mal au ventre, vomit, a un peu de fièvre. Les parents pensent à une simple gastro. Ils attendent. Mais parfois, une vraie appendicite se cache dessous.

La règle simple : si la douleur ne passe pas, et si elle se fixe de plus en plus en bas à droite, ce n'est plus une gastro. Réexamine l'enfant quelques heures plus tard. Toujours.

> **L'Astuce du Prof :** dans les régions chaudes, retiens cette règle d'or. Fièvre plus mal de ventre au retour d'une zone à moustiques, on pense paludisme d'abord. On demande la goutte de sang avant tout le reste. Le paludisme tue vite.

> ملخص بالعربية : ليس كل ألم أسفل يمين البطن هو التهاب زائدة. في المناطق الحارة، فكّر أولاً في الملاريا والتيفوئيد، وعند المرأة فكّر في الحمل خارج الرحم.

## CHAPITRE V : Le film en cinq étapes

Voici le cœur du cours. Je vais te raconter une histoire. Comme un film en cinq scènes. Si tu comprends ce film, tu comprends tout : les signes, l'urgence, le traitement.

### Scène 1 : le bouchon

Tout commence par un bouchon dans le petit tuyau. Chez l'adulte, c'est souvent une petite bille dure de matières. Chez le jeune, c'est la caserne de soldats qui gonfle. Dans les deux cas, la petite porte se ferme.

### Scène 2 : ça se remplit

Le tuyau est bouché. Mais l'appendice fabrique encore du liquide. Ce liquide ne peut plus sortir. Imagine un évier bouché avec le robinet ouvert. L'eau monte, monte, monte. Et les microbes enfermés dedans se multiplient très vite.

### Scène 3 : ça gonfle et ça serre les veines

La pression monte dans l'appendice fermé. Écoute bien ce point clé. Dans la paroi, il y a deux types de petits tuyaux de sang. Les veines, molles, avec peu de pression. Les artères, dures, avec beaucoup de pression.

Quand la pression monte à l'intérieur, elle écrase d'abord les veines. Pourquoi les veines et pas les artères ?

Dis-moi, d'après toi, pourquoi ? Réfléchis une seconde.

⮞ Voilà : imagine deux tuyaux d'arrosage. Un presque vide (la veine). Un gonflé à fond (l'artère). Si tu marches dessus, le tuyau presque vide s'écrase tout de suite. L'autre résiste. C'est pareil dans la paroi.

Résultat : le sang entre encore par les artères. Mais il ne sort plus par les veines. La paroi se gonfle d'eau. Comme une éponge trempée.

### Scène 4 : la paroi meurt

La pression monte encore. Elle finit par écraser aussi les artères. Là, plus de sang du tout. Sans sang, pas d'oxygène. La paroi étouffe. Elle commence à mourir. Les microbes en profitent et envahissent tout le mur.

> **L'Astuce du Prof :** retiens une phrase simple. "La veine se bouche avant l'artère." C'est exactement à ce moment que la douleur change de place. Elle part du nombril et va en bas à droite. On explique pourquoi au chapitre suivant.

### Scène 5 : l'explosion

Un mur mort finit toujours par se déchirer. C'est la perforation. Deux cas possibles :

➔ **Explosion contenue** : si ça va lentement, les organes voisins et la graisse du ventre viennent coller autour. Comme des pompiers qui font un mur autour du feu. Ça forme une grosse boule ou une poche de pus.
➔ **Explosion libre** : si ça va très vite, le pus se répand partout dans le ventre. C'est très grave. On appelle ça une péritonite. Chaque minute compte.

>>> Alerte : plus le temps passe, plus on avance dans le film. Et on ne peut pas revenir en arrière. L'appendicite est une course contre la montre.

> ملخص بالعربية : القصة في خمس مراحل: انسداد، ثم امتلاء، ثم انتفاخ يضغط الأوردة، ثم موت الجدار، ثم الانفجار.

## CHAPITRE VI : Pourquoi la douleur bouge

C'est une question que les examinateurs adorent. Pourquoi la douleur de l'appendicite commence autour du nombril, puis descend en bas à droite ?

Au début, l'appendice est juste gonflé à l'intérieur. Les nerfs qui sentent ça sont des nerfs anciens, un peu bêtes. Ils ne savent pas dire où ça fait mal exactement. Ils disent juste : "ça fait mal quelque part au milieu du ventre." C'est pour ça que la douleur de départ est vague, autour du nombril.

Plus tard, l'inflammation grandit. Elle touche la fine peau qui tapisse tout le ventre. Cette peau s'appelle le péritoine. Et elle, elle est très précise. Elle sait dire exactement où ça fait mal.

⮞ Donc quand la douleur "descend" et se fixe en bas à droite, ça veut dire une chose importante : l'inflammation touche maintenant le péritoine. La maladie a avancé.

>> À retenir : douleur qui commence au nombril et qui descend à droite, c'est le signe le plus typique de l'appendicite. Si tu vois ça, pense appendicite tout de suite.

> ملخص بالعربية : الألم يبدأ غامضاً حول السرة، ثم ينتقل بوضوح إلى أسفل اليمين عندما يصل الالتهاب إلى غشاء البطن الحساس.

## CHAPITRE VII : Le ver qui bouche le tuyau

Voici une cause qu'on oublie souvent. Mais elle est fréquente dans les pays chauds. Ce sont les vers dans l'intestin. Surtout un ver rond assez long. On l'appelle l'ascaris.

Attends, une question : comment un ver peut donner une appendicite ? C'est logique quand tu y penses.

Ce ver vit dans l'intestin. Parfois, il se faufile dans l'entrée de l'appendice. Il s'enroule sur lui-même. Et il bouche le tuyau. Exactement comme une bille dure le ferait. Le même film du chapitre V recommence. Mais cette fois, le bouchon est un ver.

En plus, le corps déteste ce ver. Il envoie contre lui un type spécial de soldats. On les appelle les éosinophiles. Ça ajoute encore de l'inflammation.

■ C'est pour ça qu'on regarde toujours la prise de sang dans les zones tropicales. Beaucoup d'éosinophiles, c'est un indice. Ça fait penser au ver.

> **L'Astuce du Prof :** quand tu retires un appendice dans une zone à vers, regarde bien l'intérieur. Si tu trouves un ver, il faut traiter toute la famille contre les vers. Sinon, ça va recommencer chez les frères et les sœurs.

> ملخص بالعربية : ديدان الإسكارس قد تسدّ الزائدة الدودية تماماً مثل الحصاة، وهي سبب متكرر في المناطق الحارة.

## CHAPITRE VIII : L'alarme de la cellule

Maintenant, on descend tout petit. Au niveau des molécules. Mais reste tranquille. Je vais tout expliquer comme un système d'alarme dans une maison. Tu vas voir, c'est facile.

### La sonnette

Sur la surface des cellules, il y a des petits capteurs. Le plus important s'appelle le TLR4. Pense à une sonnette sur la porte d'entrée. Quand un microbe vient toucher cette sonnette, elle sonne. Elle dit : "Alerte ! Un ennemi est entré !"

### L'interrupteur

La sonnette envoie un message à l'intérieur de la cellule. Le message va jusqu'à un grand interrupteur. On l'appelle NF-kB. Tant qu'il est éteint, rien ne bouge. Mais quand l'alarme sonne, l'interrupteur s'allume.

Et cet interrupteur allume les "usines" de la cellule. Les usines qui fabriquent les signaux d'urgence.

Tu es toujours là ? C'est le passage le plus technique. Mais garde l'image simple : sonnette, puis fil électrique, puis interrupteur, puis usines qui démarrent. Rien de plus.

### Les messagers

Les usines fabriquent des petits messagers chimiques. On les appelle les cytokines. Par exemple l'interleukine 1. Ou le TNF. Ces messagers partent dans le sang et font trois choses :

✦ Ils montent la température du corps. C'est la fièvre.
✦ Ils appellent les soldats du sang à venir se battre. Ce sont les globules blancs.
✦ Ils rendent les nerfs du coin très sensibles. C'est la douleur.

⮞ Voilà pourquoi un malade avec une appendicite a trois choses en même temps : de la fièvre, beaucoup de globules blancs dans le sang, et mal au ventre. Ce ne sont pas trois hasards. C'est la même alarme qui tourne à fond.

> **L'Astuce du Prof :** chaque signe que tu vois chez le malade a une cause au niveau des molécules. La fièvre, c'est les messagers qui parlent au cerveau. La douleur, c'est les nerfs devenus hypersensibles. Quand tu comprends ça, tu ne récites plus. Tu raisonnes.

> ملخص بالعربية : الالتهاب مثل جهاز إنذار: جرس على الخلية ينبّه مفتاحاً مركزياً، فيطلق رسائل كيميائية تسبب الحمى والألم واستدعاء خلايا الدفاع.

## CHAPITRE IX : Les pompiers du corps

On a dit que les messagers appellent les globules blancs. Mais comment ces globules blancs sortent du sang pour aller au combat ? C'est une belle histoire. Simple à comprendre.

Les globules blancs voyagent dans le sang, dans les petits tuyaux. Quand l'alarme sonne, la paroi de ces petits tuyaux devient collante. Comme du velcro.

❖ Étape 1 : les globules blancs roulent doucement et s'accrochent au velcro. Ils ralentissent.
❖ Étape 2 : ils s'arrêtent, bien collés à la paroi.
❖ Étape 3 : ils se faufilent entre les cellules du tuyau. Ils passent de l'autre côté. Ils arrivent sur le lieu du combat.

C'est pour ça qu'à la prise de sang, on voit beaucoup de globules blancs. Une partie a quitté le sang pour aller se battre dans l'appendice. Les pompiers sont partis au feu.

>> À retenir : beaucoup de globules blancs dans le sang, c'est le signe que le corps a envoyé ses pompiers. C'est un signe d'infection ou d'inflammation forte.

## CHAPITRE X : Pourquoi le corps chauffe

Parlons de la fièvre. Pourquoi le corps chauffe quand on a une appendicite ?

Les messagers chimiques du chapitre VIII voyagent dans le sang. Ils arrivent jusqu'au cerveau. Dans le cerveau, il y a une petite zone qui règle la température. Comme le thermostat d'une maison.

Quand les messagers arrivent, ils poussent le thermostat vers le haut. Le cerveau dit alors au corps : "Il faut chauffer." Le corps frissonne, se réchauffe, et la fièvre monte.

⮞ Pourquoi le corps fait ça ? Parce que beaucoup de microbes n'aiment pas la chaleur. La fièvre est une arme. C'est le corps qui essaie de brûler les ennemis.

> Note simple : la fièvre n'est pas l'ennemi. C'est une défense. Mais une fièvre très haute avec des frissons forts est un signe que l'infection est sérieuse. Il faut faire attention.

> ملخص بالعربية : الحمى تحدث لأن الرسائل الكيميائية ترفع "منظّم الحرارة" في الدماغ. الحمى سلاح دفاعي ضد الجراثيم.

## CHAPITRE XI : Qui part à l'hôpital tout de suite ?

Tu penses à une appendicite. Bien. Maintenant, ton deuxième travail est de chercher les signes de gravité. Ce sont eux qui décident : est-ce qu'on envoie le malade en urgence ?

Voici le tableau à connaître par cœur :

| Signe d'alarme | Ce qu'on voit | Ce que ça veut dire | Ce que tu fais |
|---|---|---|---|
| Ventre dur comme du bois | Le ventre ne se laisse plus toucher | L'explosion a déjà eu lieu | Transfert tout de suite |
| Fièvre très haute avec frissons | Plus de 39 degrés, le malade tremble | Les microbes passent dans le sang | Antibiotiques puis transfert |
| Ne peut plus boire ni uriner | Bouche sèche, très fatigué | Manque d'eau grave | Perfusion avant et pendant la route |
| Très jeune enfant | Moins de 5 ans | La maladie va plus vite chez lui | Priorité, on ne perd pas de temps |
| Hôpital très loin | Longue route de piste | Le malade peut s'aggraver en chemin | Décider le transfert dès le doute |

Pose-toi toujours la même question devant un mal de ventre : "Est-ce que ce malade peut attendre, oui ou non ?" Si tu hésites, la réponse est non.

>> Vérité simple : il vaut mille fois mieux envoyer à l'hôpital un malade qui n'avait rien de grave, que de garder au village un malade dont l'appendice va exploser cette nuit.

>>> Alerte : ne te laisse jamais tromper par un malade qui a l'air calme. Chez l'enfant et chez la personne âgée, le ventre peut sembler souple. Mais à l'intérieur, tout est déjà grave.

> ملخص بالعربية : كلما كان المستشفى أبعد، وجب اتخاذ قرار التحويل بسرعة أكبر ودون انتظار اليقين الكامل.

## CHAPITRE XII : Les outils du médecin

Dans une grande ville, on a des machines : l'échographie, le scanner. Mais sur le terrain, souvent, tu as très peu de choses. Apprends à faire avec ce que tu as.

● **La prise de sang** : elle montre souvent beaucoup de globules blancs. Mais attention. Au tout début, elle peut être normale. Une prise de sang normale n'élimine jamais l'appendicite si le ventre parle.

● **L'échographie** : très utile quand elle existe. Surtout chez l'enfant et la femme, car il n'y a pas de rayons. On cherche un appendice trop gros et une paroi épaisse. Son défaut : ça dépend beaucoup de la personne qui tient la sonde.

● **Le scanner** : c'est le meilleur examen. Mais dans beaucoup d'hôpitaux de campagne, il n'existe pas.

> **L'Astuce du Prof :** ne reste jamais bloqué à attendre une machine que tu n'as pas. Ton meilleur outil, c'est de réexaminer le ventre du malade toutes les quelques heures. Si la douleur grandit et se fixe en bas à droite, la réponse s'écrit sous tes yeux.

## CHAPITRE XIII : Comment on soigne

Le traitement de base de l'appendicite, c'est l'opération. On enlève l'appendice. Voyons comment on adapte ça sur le terrain.

➔ **L'opération** : dans les grandes villes, on passe par de tout petits trous. On appelle ça la cœlioscopie. En campagne, on ouvre le ventre par une petite coupure classique. Ça marche très bien aussi, entre de bonnes mains.

➔ **Les antibiotiques** : ils aident autour de l'opération. En cas de péritonite ou de poche de pus, il en faut une vraie cure, plus longue et plus forte.

➔ **La grosse boule** : parfois, la maladie a déjà formé une grosse boule dure. Opérer tout de suite est dangereux, car les tissus sont trop fragiles. On donne alors d'abord des antibiotiques. On laisse le calme revenir. Et on opère plus tard, à froid, quelques semaines après.

> **L'Astuce du Prof :** devant une grosse boule inflammatoire, ton pire ennemi c'est la précipitation. Retiens la formule : "on refroidit avant d'opérer."

> ملخص بالعربية : العلاج الأساسي هو استئصال الزائدة. أمام الكتلة الالتهابية الكبيرة، نعطي المضادات الحيوية أولاً ثم نجري الجراحة لاحقاً بهدوء.

## CHAPITRE XIV : Autour de l'opération

Avant d'opérer, on prépare le malade. C'est simple mais important.

■ On le met à jeun. Il ne mange plus. Pourquoi ? Parce qu'endormir quelqu'un avec l'estomac plein est dangereux. Le contenu de l'estomac pourrait remonter et passer dans les poumons.

■ On pose une perfusion. On donne de l'eau et du sucre directement dans la veine.

■ On calme la douleur. Et on commence les antibiotiques si besoin.

Après l'opération, on surveille trois choses simples : la température, le ventre, et la cicatrice. Si tout a été fait à temps, le malade guérit vite. Et ça, c'est la plus belle récompense pour un médecin.

>> À retenir : une appendicite prise tôt, c'est une petite opération et une guérison rapide. Une appendicite prise trop tard, c'est une grande bataille. La différence, c'est le temps.

## CHAPITRE XV : L'erreur qui peut tuer

S'il y a une seule chose à retenir de tout ce cours, c'est celle-ci. Loin de l'hôpital, ce qui tue le plus, ce n'est pas une mauvaise opération. C'est le temps perdu avant de décider d'envoyer le malade.

Imagine la scène. Un malade a mal au ventre dans un village loin de tout. On se dit : "attendons demain, ça va peut-être passer." Mais pendant qu'on attend, le film du chapitre V continue tout seul. Heure après heure. La paroi meurt. Puis elle explose.

Souviens-toi d'une image simple. L'appendicite, c'est comme un petit feu dans une pièce fermée. Au début, un seau d'eau suffit pour l'éteindre. Mais si tu attends, le feu prend toute la maison. Et là, même les pompiers ont du mal.

⮞ Ton rôle de médecin, c'est d'agir quand il ne faut encore qu'un seau d'eau.

>>> Alerte finale : chaque heure d'attente augmente le risque d'explosion. Devant un ventre qui inquiète, on décide d'envoyer le malade dès le doute sérieux. On n'attend pas d'être sûr. Et on n'attend surtout pas que ça empire.

> ملخص بالعربية : كل ساعة تأخير في التحويل تزيد خطر الانفجار والتهاب الصفاق. القرار المبكر ينقذ الحياة.

## RÉCAPITULATIF

Voici le grand tableau de tout le film. Garde-le en tête.

| Étape | Ce qui se passe | Le signe chez le malade | Le danger |
|---|---|---|---|
| Bouchon | Le tuyau se ferme | Presque rien au début | Faible si on agit vite |
| Ça gonfle | Les veines sont écrasées | Douleur vague au nombril | Moyen |
| La paroi meurt | Plus de sang, plus d'oxygène | Douleur forte en bas à droite, fièvre | Élevé |
| Explosion contenue | Boule ou poche de pus | Masse dure, fièvre qui va et vient | Élevé si on ne voit pas |
| Explosion libre | Le pus se répand partout | Ventre dur comme du bois | Vital, chaque minute compte |

Voilà. Tu connais maintenant l'appendicite. Du tout petit détail de la cellule jusqu'au geste qui sauve.

Garde trois images simples dans la tête :

✦ Le tuyau fin qui se bouche.
✦ La douleur qui descend vers le bas à droite.
✦ Le temps perdu, qui est ton pire ennemi.

Garde ces trois images, et tu seras un bon médecin. Même loin de tout. Bon courage.`,
  },
  {
    id: "resume",
    label: "Résumé",
    icon: ScrollText,
    accent: {
      active: "border-emerald-300 bg-emerald-50 text-emerald-800",
      chip: "bg-emerald-100 text-emerald-600",
      hover: "hover:-translate-y-1 hover:bg-emerald-50 hover:text-emerald-600 hover:shadow-md",
    },
    content: `## Résumé Express : Appendicite Aiguë

*   **Définition :** Inflammation de l'appendice, cul-de-sac accroché au cæcum.
*   **Cause :** Obstruction de la lumière appendiculaire (hyperplasie lymphoïde chez le jeune, stercolithe chez l'adulte).
*   **Clinique :** Douleur péri-ombilicale migrant vers la Fosse Iliaque Droite (point de McBurney), fièvre modérée, nausées.
*   **Signes associés :** Défense abdominale en FID, signe de Blumberg (douleur à la décompression).
*   **Diagnostic :** Clinique + biologie (hyperleucocytose) + échographie/scanner si doute.
*   **Traitement :** Appendicectomie, en urgence.

> **Note du prof :** Si tu ne dois retenir qu'une phrase : douleur qui migre du nombril vers la FID = appendicite jusqu'à preuve du contraire.`,
  },
  {
    id: "pieges",
    label: "Les Pièges",
    icon: AlertTriangle,
    accent: {
      active: "border-rose-300 bg-rose-50 text-rose-800",
      chip: "bg-rose-100 text-rose-600",
      hover: "hover:-translate-y-1 hover:bg-rose-50 hover:text-rose-600 hover:shadow-md",
    },
    content: `## Les Pièges Classiques à l'examen

> **Piège n°1 :** Ne confonds pas la douleur péri-ombilicale initiale avec une gastro-entérite — l'examinateur adore ce piège chez les étudiants pressés.

*   **Chez la femme jeune :** Élimine toujours une grossesse extra-utérine ou une torsion d'annexe avant de conclure trop vite à une appendicite.
*   **Chez la personne âgée :** La présentation est souvent atypique (peu de fièvre, douleur diffuse) — le risque de perforation est plus élevé car le diagnostic est retardé.
*   **Chez l'enfant :** Ne néglige jamais une douleur abdominale fébrile — l'évolution vers la perforation est plus rapide.
*   **Erreur fréquente :** Attendre une hyperleucocytose franche avant d'opérer — une NFS normale n'élimine PAS le diagnostic.`,
  },
  {
    id: "astuces",
    label: "Astuces Mnémotechniques",
    icon: Lightbulb,
    accent: {
      active: "border-amber-300 bg-amber-50 text-amber-800",
      chip: "bg-amber-100 text-amber-600",
      hover: "hover:-translate-y-1 hover:bg-amber-50 hover:text-amber-600 hover:shadow-md",
    },
    content: `## Astuces Mnémotechniques

> **Pour la migration de la douleur :** "Du nombril au point Mc, en passant par la crampe" — retiens le trajet en trois temps : ombilic vers diffuse vers Fosse Iliaque Droite.

*   **Point de McBurney :** situé au tiers externe de la ligne reliant l'ombilic à l'épine iliaque antéro-supérieure droite — pense à "2/3 - 1/3".
*   **Signe de Blumberg :** la décompression fait plus mal que la compression — "ça fait mal quand on relâche, pas quand on appuie".
*   **Triade clinique :** Douleur FID + Défense + Fièvre = pense appendicite avant tout.`,
  },
  {
    id: "cas_clinique",
    label: "Cas Clinique",
    icon: Stethoscope,
    accent: {
      active: "border-purple-300 bg-purple-50 text-purple-800",
      chip: "bg-purple-100 text-purple-600",
      hover: "hover:-translate-y-1 hover:bg-purple-50 hover:text-purple-600 hover:shadow-md",
    },
    content: `## Cas Clinique : À toi de jouer, Yacine

Amine, 19 ans, se présente aux urgences pour une douleur abdominale débutée la veille au soir autour du nombril, de type crampe, puis migrant ce matin vers la fosse iliaque droite. Il présente une fièvre à 38.2°C, des nausées sans vomissement, et une défense à la palpation de la FID.

**Questions :**
1. Quel est ton diagnostic le plus probable, et pourquoi ?
2. Quel signe clinique iras-tu rechercher pour le confirmer ?
3. Quel examen complémentaire demanderais-tu en première intention ?

> **Indice du prof :** Relis bien la section "Clinique" de l'explication détaillée — la chronologie de la douleur est la clé de ce cas.`,
  },
  {
    id: "qcm",
    label: "Examen QCMs",
    icon: ListChecks,
    accent: {
      active: "border-indigo-300 bg-indigo-50 text-indigo-800",
      chip: "bg-indigo-100 text-indigo-600",
      hover: "hover:-translate-y-1 hover:bg-indigo-50 hover:text-indigo-600 hover:shadow-md",
    },
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

> **Réponses :** 1-B, 2-B, 3-B. Si tu as tout bon, tu es prêt(e) pour la garde de chirurgie !`,
  },
];
