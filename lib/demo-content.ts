import {
  BookOpenText,
  ScrollText,
  Stethoscope,
  ListChecks,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

export type DemoSectionId =
  | "explication"
  | "resume"
  | "cas_clinique"
  | "qcm"
  | "exemples_analogies";

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

/**
 * Builds the final chat message for the composer's citation flow ("Ask
 * MedArt" quotes a passage above the input, the student types their own
 * question and sends). If the student sends without typing anything — a
 * very common "just explain this" click — the message would otherwise be
 * nothing but the bare quoted passage, which reads to the model as content
 * to acknowledge rather than a question to answer, producing a generic,
 * unfocused reply. Falling back to an explicit instruction here is what
 * keeps "Ask MedArt" reliably answering ABOUT the selection instead of just
 * echoing it back.
 *
 * The caller is responsible for sending this with `excludeFromHistory: true`
 * (see hooks/useCourseChat.ts) — the quote (and the resulting reply, which
 * is just as capable of anchoring later messages back onto the old topic)
 * must inform only this ONE exchange, never resend in later requests'
 * history.
 */
export function buildQuotedChatMessage(quotedText: string | null, typedText: string): string {
  const text = typedText.trim();
  if (!quotedText) return text;
  const question = text || "Explique ce passage médical sélectionné, en te concentrant précisément dessus.";
  return `> ${quotedText}\n\n${question}`;
}

/** Whether `content` is a composer citation built by buildQuotedChatMessage above — used to recognize & re-exclude an "Ask MedArt" exchange loaded back from persisted history (course_chat_history has no separate flag column for this), since a fresh page load otherwise loses the live session's exclusion and reintroduces the same leak on the next message. */
export function isQuotedChatMessage(content: string): boolean {
  return content.startsWith("> ") && content.includes("\n\n");
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

Ce cours est très long. C'est fait exprès. Un vrai médecin ne connaît pas juste le nom de la maladie. Il connaît chaque petit détail. Il sait pourquoi chaque chose arrive. Alors prends ton temps. On a tout notre temps.

> Ce cours est long. C'est normal. Un bon médecin prend son temps pour comprendre. Va à ton rythme, fais des pauses, et reviens quand tu veux.

## Sommaire

- ● Avant-propos : pourquoi ce cours est important
- ● Chapitre I : L'appendice, c'est quoi ?
- ■ Chapitre II : Un petit sac plein de soldats
- ▲ Chapitre III : Le tapis roulant de mucus
- ● Chapitre IV : Les faux amis
- ■ Chapitre V : Le film en cinq étapes
- ▲ Chapitre VI : Pourquoi la douleur bouge
- ● Chapitre VII : Le ver qui bouche le tuyau
- ■ Chapitre VIII : L'alarme de la cellule
- ▲ Chapitre IX : Les pompiers du corps
- ● Chapitre X : Pourquoi le corps chauffe
- ■ Chapitre XI : Qui part à l'hôpital tout de suite ?
- ▲ Chapitre XII : Les outils du médecin
- ● Chapitre XIII : Comment on soigne
- ■ Chapitre XIV : Autour de l'opération
- ▲ Chapitre XV : L'erreur qui peut tuer
- ● Récapitulatif

## AVANT-PROPOS : Pourquoi ce cours est important

L'appendicite est une maladie très fréquente. Tu vas la voir souvent dans ta vie de médecin. Très souvent. C'est peut-être l'urgence du ventre que tu vas rencontrer le plus dans toute ta carrière.

Le problème, c'est qu'elle sait se cacher. Parfois elle a l'air d'un simple mal de ventre. Un petit truc de rien du tout. Et pourtant, elle peut tuer en quelques heures. C'est ça, le piège. Une maladie qui a l'air simple mais qui est dangereuse.

Dans une grande ville, c'est plus facile. Il y a l'hôpital juste à côté. Il y a des machines pour voir dans le ventre. Il y a des chirurgiens prêts à opérer jour et nuit. Si tu as un doute, tu demandes un examen, et tu as la réponse en quelques minutes.

Mais dans beaucoup de régions chaudes, ce n'est pas comme ça. L'hôpital est loin. Très loin. Parfois à plusieurs heures de route. Parfois sur une piste en mauvais état. Il n'y a pas toujours de machine pour voir dans le ventre. Là, tout change. Ton raisonnement change. Tes décisions changent.

Attends, réponds-moi : qu'est-ce qui change quand l'hôpital est à quatre heures de route ? Réfléchis avant de lire la suite.

>> La réponse : tu ne peux plus attendre d'être sûr à 100 pour cent. Tu dois décider vite. Parfois, tu envoies le malade à l'hôpital juste sur un doute. Mieux vaut un doute qu'un mort.

C'est le fil rouge de tout ce cours. On va y revenir souvent. Retiens-le dès maintenant : loin de l'hôpital, le temps est ton ennemi, et la décision rapide est ton amie.

Dans ce cours, on va faire un long voyage. On va commencer tout petit, par l'anatomie. On va voir où se trouve l'appendice. Puis on va descendre encore plus petit, jusqu'aux cellules et aux molécules. Ensuite on va remonter vers le malade, vers les signes, vers les décisions. Et à la fin, tu sauras quoi faire, étape par étape.

## CHAPITRE I : L'appendice, c'est quoi ?

Avant de comprendre la maladie, il faut connaître l'organe. C'est logique. On ne peut pas réparer une chose qu'on ne connaît pas.

### Où se trouve l'appendice ?

Imagine ton gros intestin. C'est un grand tuyau. Il fait le tour du ventre. Au début de ce tuyau, il y a une petite poche. On l'appelle le cæcum. Retiens ce mot : cæcum. C'est le début du gros intestin.

Et sur cette poche, il y a un petit doigt creux. Fin. Fermé au bout. C'est ça, l'appendice. Il mesure environ la taille d'un petit doigt. Parfois plus court, parfois plus long.

Pense à un petit gant, mais avec un seul doigt. Ce doigt est vide à l'intérieur. Il a une seule petite porte pour entrer et sortir. Cette porte donne dans le cæcum. C'est très important. Garde bien cette image du doigt de gant.

### Un point fixe, mais une pointe qui se cache

Le point où l'appendice est accroché ne bouge jamais. C'est toujours le même endroit, chez tout le monde. C'est un repère sûr pour le chirurgien.

Mais la pointe, elle, peut se cacher partout. C'est comme une queue qui peut pointer dans plusieurs directions. Voici les positions les plus fréquentes :

➔ **Derrière le cæcum** : c'est le cas le plus fréquent. Là, l'appendice est caché derrière la poche. Quand on appuie sur le ventre, on ne sent presque rien. La douleur est cachée. C'est le plus traître de tous, car il trompe le médecin.

➔ **Vers le bas, dans le bassin** : l'appendice descend près de la vessie. Ou près des organes de la femme. Là, on confond facilement avec un problème pour uriner, ou avec un problème de femme. Le malade a envie d'uriner souvent, ou a mal en bas.

➔ **Vers le haut, sous le foie** : c'est rare. Mais quand ça arrive, la douleur monte en haut à droite. Et ça ressemble à un problème de foie ou de vésicule. Encore un piège.

➔ **Au milieu, entre les intestins** : là, l'appendice se cache au milieu des autres tuyaux de l'intestin. Il peut donner des ballonnements et des gaz coincés.

■ Retiens une image forte : l'appendice est un **cul-de-sac**. Une rue sans issue. Une seule entrée, et pas de sortie au fond. Tout ce qui rentre doit ressortir par le même trou. Si on bloque l'entrée, tout reste coincé dedans. Cette idée du cul-de-sac, c'est la clé de toute la maladie. On va la répéter souvent.

### Pourquoi cette forme est dangereuse

Réfléchis une seconde. Un tuyau normal a deux bouts ouverts. Si quelque chose bloque un côté, ça peut sortir par l'autre. Mais l'appendice n'a qu'un seul bout ouvert. L'autre bout est fermé.

Alors si la seule porte se bouche, plus rien ne peut sortir. C'est comme une bouteille avec un bouchon. Tu peux secouer autant que tu veux, rien ne sort. Cette forme simple explique presque tout ce qui va suivre.

> **L'Astuce du Prof :** au bloc opératoire, si tu ne trouves pas l'appendice, ne panique pas. Le gros intestin a trois bandes de muscle sur sa surface. Comme trois rails de train. Suis ces rails avec le doigt. Ils se rejoignent toujours pile à la base de l'appendice. C'est le truc qui marche à tous les coups.

> ملخص بالعربية : الزائدة الدودية هي أنبوب صغير مسدود من طرف واحد، له باب واحد فقط. إذا انسد هذا الباب، يبقى كل شيء محبوساً بالداخل.

## CHAPITRE II : Un petit sac plein de soldats

Beaucoup d'étudiants pensent que l'appendice ne sert à rien. C'est faux. Complètement faux. Cet organe a un rôle. Et ce rôle explique pourquoi il tombe malade.

### Une caserne de soldats dans le ventre

Dans la paroi de l'appendice, il y a beaucoup de cellules de défense. Ce sont les soldats du corps. Leur travail est de se battre contre les microbes qui passent dans l'intestin.

On peut voir l'appendice comme une petite caserne de soldats. Une base militaire cachée dans le ventre. Toujours prête à combattre. Quand des microbes arrivent, les soldats sortent et attaquent.

Ces soldats sont regroupés en petits paquets, comme des petites boules. On appelle ces boules des follicules. Ce sont des petits camps de soldats bien rangés dans la paroi.

### Pourquoi l'âge compte

Cette caserne n'est pas toujours pareille. Elle change avec l'âge. Elle est petite chez le bébé. Elle grandit chez l'enfant. Elle est la plus grosse et la plus remplie entre 10 et 20 ans. Puis elle diminue chez l'adulte plus âgé.

Et devine quoi ? C'est justement entre 10 et 20 ans que l'appendicite arrive le plus souvent. Ce n'est pas un hasard. Plus il y a de soldats, plus ils peuvent gonfler et boucher le tuyau. Tu vas comprendre.

### Comment une petite infection réveille tout

Quand tu attrapes un rhume, une angine, ou une petite gastro, ton corps se met en alerte partout. Pas seulement à l'endroit malade. Partout. Les soldats se réveillent dans tout le corps. Même ceux de l'appendice, qui pourtant n'a rien à voir avec ton nez ou ta gorge.

Les soldats de l'appendice se multiplient alors très vite. Ils deviennent nombreux. Et quand ils sont nombreux, les petits camps gonflent. Ils prennent de la place.

▲ Et voilà le problème : le tuyau de l'appendice est déjà tout fin. Si les camps de soldats gonflent trop, ils poussent vers l'intérieur et bouchent le passage. Comme une éponge sèche qu'on mouille : elle gonfle et remplit tout le tuyau. Le passage se ferme de l'intérieur.

Tu es avec moi ? Ne décroche pas. C'est le point de départ de la maladie chez le jeune : **une petite infection ailleurs, qui réveille les soldats, qui gonflent et bouchent le tuyau.**

>> Point clé à retenir : une infection banale, loin du ventre, peut réveiller les soldats de l'appendice, les faire gonfler, et boucher le tuyau. Une petite cause pour un gros problème. C'est pour ça qu'un enfant qui a eu un rhume la semaine d'avant peut faire une appendicite après.

> ملخص بالعربية : الزائدة مليئة بخلايا المناعة. عند أي عدوى بسيطة في الجسم، تنتفخ هذه الخلايا وقد تسدّ الأنبوب من الداخل.

## CHAPITRE III : Le tapis roulant de mucus

Il y a une deuxième chose importante à comprendre. La paroi de l'appendice fabrique du mucus. Le mucus, c'est un gel qui glisse. Un peu comme du blanc d'œuf, ou comme le gel qu'on a dans le nez quand on est enrhumé.

### À quoi sert le mucus

Ce gel n'est pas là pour rien. Il a un travail. Il attrape les microbes et les pousse doucement vers la sortie. Vers le cæcum, puis vers le gros intestin.

C'est comme un tapis roulant dans un aéroport. Tu poses ta valise, et le tapis avance tout seul et emmène la valise plus loin. Ici, le mucus est le tapis, et les microbes sont les valises. Le tapis les emmène dehors, sans arrêt, jour et nuit.

Tant que le tuyau est ouvert, ce tapis roulant nettoie tout seul. Personne n'y pense. Tout va bien. L'appendice reste propre.

### Ce qui se passe quand la sortie se bouche

Mais réfléchis deux secondes. Que se passe-t-il si la sortie est bouchée ? Le tapis roulant ne peut plus déposer ses valises dehors.

⮞ Le tapis roulant tourne encore. La paroi continue de fabriquer du mucus. C'est son travail, elle ne s'arrête pas.

⮞ Mais le mucus ne peut plus sortir. La porte est fermée. Alors il reste dedans. Il s'accumule. De plus en plus. Le petit tuyau se remplit.

⮞ Et un endroit chaud, humide, fermé, plein de mucus, c'est le paradis des microbes. Ils adorent ça. Ils ont à manger, ils ont chaud, ils sont à l'abri. Alors ils se multiplient à toute vitesse. Ils doublent leur nombre en quelques minutes.

Voilà comment un simple bouchon change tout. Avant, l'appendice était propre, nettoyé par le tapis roulant. Maintenant, c'est un nid à microbes fermé, qui gonfle de plus en plus.

> Note simple : le mucus n'est pas mauvais. Au contraire, il protège, il nettoie. Le problème, ce n'est jamais le mucus. Le problème, c'est le bouchon qui l'empêche de sortir.

> ملخص بالعربية : المخاط ينظّف الأنبوب مثل السير المتحرك. لكن إذا انسدت المخارج، يتجمّع المخاط ويصبح بيئة مثالية لتكاثر الجراثيم.

## CHAPITRE IV : Les faux amis

Attention. Ce chapitre est le plus dangereux de tout le cours. Écoute bien. Concentre-toi.

Tout mal de ventre en bas à droite n'est PAS une appendicite. Je répète, car c'est important : tout mal de ventre en bas à droite n'est pas une appendicite. Dans les régions chaudes, plusieurs maladies portent le même masque. Elles ressemblent à l'appendicite, mais ce sont autre chose. Si tu te trompes, ça peut coûter une vie.

### Le piège numéro un : la femme enceinte

>>> Danger : chez toute femme qui peut avoir des enfants et qui a mal en bas à droite, il faut TOUJOURS penser à une grossesse dans la trompe. On appelle ça une grossesse extra-utérine. C'est quand le bébé commence à grandir au mauvais endroit, dans le petit tuyau au lieu du ventre de la mère. Ça peut saigner très fort à l'intérieur. Il faut l'éliminer avant de dire appendicite. Ne l'oublie JAMAIS. C'est une erreur qui tue.

Comment faire ? Simple. Chez toute femme qui a mal en bas à droite, on fait un test de grossesse. Toujours. C'est un réflexe. Aussi automatique que de prendre la tension.

### Les autres faux amis des pays chauds

Dans les régions tropicales, il y a des maladies qu'on voit moins ailleurs. Il faut les connaître. Voici un tableau simple pour les comparer :

| Maladie | Chez qui | Ce qui doit t'alerter | L'examen qui aide |
|---|---|---|---|
| Vraie appendicite | Surtout 10-30 ans | Douleur qui part du nombril et descend à droite | Échographie ou surveillance |
| Fièvre typhoïde | Eau sale, mauvaise hygiène | Fièvre longue, patient très fatigué | Prise de sang |
| Paludisme | Zone de moustiques | Fièvre + grande fatigue, parfois jaunisse | Goutte de sang au microscope |
| Amibiase | Eau ou nourriture sale | Diarrhée avec du sang | Examen des selles |
| Infection urinaire | Surtout la femme | Brûlures quand on urine, envie fréquente | Bandelette dans les urines |

Regarde bien ce tableau. Apprends-le. Chaque maladie a un petit indice qui la trahit. La fièvre longue, c'est la typhoïde. La goutte de sang, c'est le paludisme. Le sang dans les selles, c'est l'amibiase. Les brûlures pour uriner, c'est l'infection urinaire.

### Le piège de la gastro chez l'enfant

⮞ Un dernier faux ami, très fréquent chez l'enfant : la gastro. L'enfant a mal au ventre, il vomit, il a un peu de fièvre. Les parents pensent à une simple gastro. Ils attendent que ça passe. Mais parfois, une vraie appendicite se cache dessous.

La règle simple : si la douleur ne passe pas, et si elle se fixe de plus en plus en bas à droite, ce n'est plus une gastro. Réexamine l'enfant quelques heures plus tard. Toujours. Deux fois plutôt qu'une.

> **L'Astuce du Prof :** dans les régions chaudes, retiens cette règle d'or. Fièvre plus mal de ventre au retour d'une zone à moustiques, on pense paludisme d'abord. On demande la goutte de sang avant tout le reste. Le paludisme tue vite, et il se soigne bien si on le trouve tôt.

> ملخص بالعربية : ليس كل ألم أسفل يمين البطن هو التهاب زائدة. في المناطق الحارة، فكّر أولاً في الملاريا والتيفوئيد، وعند المرأة فكّر دائماً في الحمل خارج الرحم.

## CHAPITRE V : Le film en cinq étapes

Voici le cœur du cours. Le chapitre le plus important. Je vais te raconter une histoire. Comme un film en cinq scènes. Si tu comprends ce film, tu comprends tout : les signes, l'urgence, le traitement. Tout découle de ce film. Alors lis-le doucement, deux fois s'il le faut.

### Scène 1 : le bouchon

Tout commence par un bouchon dans le petit tuyau. On l'a déjà vu. Chez l'adulte, c'est souvent une petite bille dure de matières. On l'appelle un stercolithe. C'est comme un tout petit caillou fait de déchets séchés. Chez le jeune, c'est la caserne de soldats qui gonfle. Parfois, dans les pays chauds, c'est un ver, on le verra plus tard.

Dans tous les cas, le résultat est le même : la petite porte se ferme. Le cul-de-sac est maintenant complètement fermé. Rien ne peut plus entrer ni sortir.

### Scène 2 : ça se remplit

Le tuyau est bouché. Mais la paroi continue son travail. Elle fabrique encore du mucus. Ce mucus ne peut plus sortir.

Imagine un évier bouché avec le robinet ouvert. L'eau monte, monte, monte. Elle ne peut aller nulle part. C'est pareil ici. Le mucus monte et remplit l'appendice.

Et les microbes enfermés dedans font la fête. Ils ont tout ce qu'il faut. Ils se multiplient très vite. En quelques heures, ils sont des millions. Le petit tuyau se gonfle et devient tendu, comme un ballon qu'on gonfle trop.

### Scène 3 : ça gonfle et ça serre les veines

La pression monte dans l'appendice fermé. Écoute bien ce point clé, car beaucoup d'étudiants le ratent.

Dans la paroi de l'appendice, il y a deux types de petits tuyaux de sang. Les veines, qui sont molles, avec peu de pression dedans. Et les artères, qui sont dures, avec beaucoup de pression dedans.

Quand la pression monte à l'intérieur de l'appendice, elle écrase les tuyaux de la paroi. Mais elle n'écrase pas les deux en même temps. Elle écrase d'abord les veines. Pourquoi les veines et pas les artères ?

Dis-moi, d'après toi, pourquoi ? Réfléchis une seconde avant de lire la réponse.

⮞ Voilà : imagine deux tuyaux d'arrosage. Un presque vide, tout mou (c'est la veine). Un gonflé à fond, bien dur (c'est l'artère). Si tu marches dessus avec le pied, lequel s'écrase en premier ? Le tuyau mou, bien sûr. Le tuyau dur résiste plus longtemps. C'est exactement pareil dans la paroi de l'appendice.

Résultat : le sang entre encore par les artères, qui résistent. Mais il ne sort plus par les veines, qui sont écrasées. Le sang arrive mais ne repart pas. La paroi se gonfle d'eau et de sang. Elle devient comme une éponge trempée. On appelle ça l'œdème.

### Scène 4 : la paroi meurt

La pression continue de monter. Toujours plus. Elle finit par écraser aussi les artères, qui sont pourtant dures. Là, c'est le drame. Plus aucun sang n'arrive.

Sans sang, pas d'oxygène. Et sans oxygène, les cellules de la paroi étouffent. Elles commencent à mourir. La paroi devient grise, puis noire par endroits. Elle est en train de pourrir.

Les microbes en profitent. La paroi ne se défend plus. Ils envahissent tout le mur, de l'intérieur vers l'extérieur. C'est la gangrène de l'appendice.

> **L'Astuce du Prof :** retiens une phrase simple. "La veine se bouche avant l'artère." C'est exactement à ce moment que la douleur change de place. Elle part du nombril et va en bas à droite. On explique pourquoi juste après, au chapitre VI.

### Scène 5 : l'explosion

Un mur mort finit toujours par se déchirer. Toujours. C'est la perforation. Le trou. Deux choses peuvent alors arriver.

➔ **Explosion contenue** : si ça va lentement, le corps a le temps de se défendre. Les organes voisins et la graisse du ventre viennent coller autour de l'appendice malade. Comme des pompiers qui font un mur autour d'un feu pour l'empêcher de se répandre. Ça forme une grosse boule dure, ou une poche de pus bien fermée. C'est grave, mais c'est encore contenu.

➔ **Explosion libre** : si ça va très vite, le corps n'a pas le temps de faire son mur. Le pus et les microbes se répandent partout dans le ventre. Partout. On appelle ça une péritonite. C'est très, très grave. Le malade peut mourir. Chaque minute compte.

>>> Alerte : plus le temps passe, plus on avance dans le film. Et on ne peut jamais revenir en arrière. On ne peut pas "dégonfler" le film. L'appendicite est une course contre la montre. Chaque heure compte.

> ملخص بالعربية : القصة في خمس مراحل: انسداد، ثم امتلاء، ثم انتفاخ يضغط الأوردة، ثم موت الجدار، ثم الانفجار. لا يمكن العودة إلى الوراء.

## CHAPITRE VI : Pourquoi la douleur bouge

C'est une question que les examinateurs adorent poser. Écoute bien, car la réponse est belle et logique.

Pourquoi la douleur de l'appendicite commence autour du nombril, puis descend en bas à droite ? Pourquoi elle bouge ?

### La douleur du début : vague et au milieu

Au début, l'appendice est juste gonflé à l'intérieur. Il souffre, mais tout seul, à l'intérieur. Les nerfs qui sentent ça sont des nerfs anciens, un peu simples. On les appelle les nerfs viscéraux. Ils ne savent pas dire où ça fait mal exactement.

C'est comme quand tu as mal au ventre après avoir trop mangé. Tu ne peux pas montrer un point précis. Tu dis juste "j'ai mal au ventre, quelque part au milieu". Ces nerfs disent juste : "ça fait mal quelque part vers le milieu, vers le nombril."

C'est pour ça que la douleur de départ est vague, autour du nombril. Elle n'est pas précise. Le malade montre tout le milieu du ventre avec la main.

### La douleur d'après : précise et à droite

Plus tard, l'inflammation grandit. L'appendice ne souffre plus tout seul. Il touche maintenant la fine peau qui tapisse tout l'intérieur du ventre. Cette peau s'appelle le péritoine. Retiens ce mot : le péritoine.

Et cette peau, elle, est très intelligente. Elle a des nerfs précis. On les appelle les nerfs somatiques. Ils savent dire exactement où ça fait mal, au millimètre près.

⮞ Donc quand la douleur "descend" et se fixe en bas à droite, avec un point précis que le malade peut montrer avec un seul doigt, ça veut dire une chose importante : l'inflammation touche maintenant le péritoine. La maladie a avancé. On est passé de la scène 2 à la scène 3 ou 4 du film.

>> À retenir : douleur qui commence au nombril, vague, puis qui descend et se fixe précisément en bas à droite. C'est le signe le plus typique de l'appendicite. Si tu vois ce voyage de la douleur, pense appendicite tout de suite.

> ملخص بالعربية : الألم يبدأ غامضاً حول السرة، ثم ينتقل بوضوح إلى أسفل اليمين عندما يصل الالتهاب إلى غشاء البطن الحساس.

## CHAPITRE VII : Le ver qui bouche le tuyau

Voici une cause qu'on oublie souvent dans les livres occidentaux. Mais dans les pays chauds, elle est fréquente. Très fréquente. Ce sont les vers dans l'intestin. Surtout un ver rond assez long. On l'appelle l'ascaris.

### Comment un ver donne une appendicite

Attends, une question : comment un simple ver peut donner une appendicite ? C'est logique quand tu y penses.

Ce ver vit dans l'intestin. Il se promène. Parfois, il se faufile dans l'entrée de l'appendice. Il entre dans le petit tuyau. Il s'enroule sur lui-même, comme un serpent dans un trou. Et il bouche le passage.

C'est le même film que le chapitre V qui recommence. Exactement le même. Bouchon, remplissage, gonflement, mort, explosion. La seule différence, c'est le bouchon : cette fois, c'est un ver au lieu d'un caillou.

### La trace que le ver laisse dans le sang

En plus, le corps déteste ce ver. Il le voit comme un gros ennemi. Il envoie contre lui un type spécial de soldats. On les appelle les éosinophiles. Ce sont des soldats spécialisés dans la chasse aux vers et aux parasites.

■ C'est pour ça qu'on regarde toujours la prise de sang dans les zones tropicales. Si on voit beaucoup d'éosinophiles, c'est un indice. Ça veut dire qu'il y a peut-être un ver quelque part. Et ça fait penser à cette cause d'appendicite.

### Pourquoi c'est important pour la famille

> **L'Astuce du Prof :** quand tu retires un appendice dans une zone à vers, regarde bien à l'intérieur. Si tu trouves un ver, il faut traiter toute la famille contre les vers. Pas seulement le malade. Toute la famille. Sinon, les frères et les sœurs vont attraper les mêmes vers, et ça va recommencer chez eux.

> ملخص بالعربية : ديدان الإسكارس قد تسدّ الزائدة الدودية تماماً مثل الحصاة، وهي سبب متكرر في المناطق الحارة. عند وجود دودة، يجب علاج كل أفراد العائلة.

## CHAPITRE VIII : L'alarme de la cellule

Maintenant, on descend tout petit. Au niveau des molécules. C'est la partie que les étudiants trouvent difficile. Mais reste tranquille. Je vais tout expliquer comme un système d'alarme dans une maison. Tu vas voir, c'est facile.

### La sonnette sur la porte

Sur la surface des cellules, il y a des petits capteurs. Des petits détecteurs. Le plus important pour nous s'appelle le TLR4. Ne t'inquiète pas du nom. Pense juste à une sonnette sur la porte d'entrée d'une maison.

Quand un microbe s'approche, une partie de sa peau vient toucher cette sonnette. Et la sonnette sonne. Elle crie : "Alerte ! Un ennemi est entré dans la maison !"

C'est le tout début de l'inflammation. Un microbe, une sonnette, une alarme qui part.

### Le fil et l'interrupteur

La sonnette ne fait pas tout toute seule. Elle envoie un message à l'intérieur de la cellule. Le message voyage le long d'un fil, comme un fil électrique. Il va jusqu'à un grand interrupteur au centre de la cellule. Cet interrupteur s'appelle NF-kB. Encore une fois, oublie le nom, garde l'image de l'interrupteur.

Tant que l'interrupteur est éteint, rien ne bouge. La cellule est calme. Mais quand l'alarme arrive par le fil, l'interrupteur s'allume. Clic. Et tout démarre.

Tu es toujours là ? C'est le passage le plus technique de tout le cours. Mais garde l'image simple dans la tête : une sonnette, puis un fil, puis un interrupteur. Rien de plus compliqué que ça.

### Les usines et les messagers

Quand l'interrupteur s'allume, il démarre les "usines" de la cellule. Ces usines fabriquent des petits messagers chimiques. On les appelle les cytokines. Par exemple l'interleukine 1, ou le TNF. Encore des noms, encore une fois oublie-les, garde l'idée : ce sont des petits messagers d'urgence.

Ces messagers sortent de la cellule et partent dans le sang. Ils voyagent dans tout le corps. Et ils font trois choses très importantes :

✦ Ils montent la température du corps. C'est la fièvre.

✦ Ils appellent les soldats du sang à venir se battre sur place. Ce sont les globules blancs.

✦ Ils rendent les nerfs du coin très sensibles. C'est la douleur.

⮞ Voilà pourquoi un malade avec une appendicite a trois choses en même temps : de la fièvre, beaucoup de globules blancs dans le sang, et mal au ventre. Ce ne sont pas trois hasards séparés. C'est la même alarme qui tourne à fond, et qui déclenche les trois en même temps.

> **L'Astuce du Prof :** chaque signe que tu vois chez le malade a une cause au niveau des molécules. La fièvre, c'est les messagers qui parlent au cerveau. La douleur, c'est les nerfs devenus hypersensibles. Les globules blancs qui montent, c'est l'appel aux soldats. Quand tu comprends ça, tu ne récites plus. Tu raisonnes. Et un médecin qui raisonne ne se trompe presque jamais.

> ملخص بالعربية : الالتهاب مثل جهاز إنذار: جرس على الخلية ينبّه مفتاحاً مركزياً، فيطلق رسائل كيميائية تسبب الحمى والألم واستدعاء خلايا الدفاع.

## CHAPITRE IX : Les pompiers du corps

On a dit que les messagers appellent les globules blancs. Mais comment ces globules blancs sortent du sang pour aller au combat dans l'appendice ? C'est une belle histoire. Simple à comprendre. Suis bien les étapes.

### Le voyage des globules blancs

Les globules blancs voyagent dans le sang, dans les petits tuyaux de sang. Ils avancent vite, portés par le courant du sang. Normalement, ils passent sans s'arrêter.

Mais quand l'alarme sonne, la paroi des petits tuyaux change. Elle devient collante. Comme du velcro, ou comme du papier collant. Et voici ce qui se passe, étape par étape :

❖ Étape 1 : les globules blancs roulent doucement le long de la paroi collante. Ils s'accrochent un peu, se décrochent, se raccrochent. Ils ralentissent, comme une voiture qui freine.

❖ Étape 2 : ils finissent par s'arrêter complètement, bien collés à la paroi. Ils ne bougent plus. Ils attendent.

❖ Étape 3 : ils se faufilent entre les cellules de la paroi du tuyau. Ils se glissent dans les petits espaces, comme quelqu'un qui passe entre les barreaux d'une grille. Ils passent de l'autre côté.

❖ Étape 4 : ils arrivent enfin sur le lieu du combat, dans la paroi de l'appendice. Là, ils attaquent les microbes. Ils les mangent. Ils les détruisent.

### Ce que ça veut dire pour toi

C'est pour ça qu'à la prise de sang, on voit beaucoup de globules blancs. Une partie a quitté le sang pour aller se battre dans l'appendice. Les pompiers sont partis au feu, alors on en voit moins dans les tuyaux et plus sur le lieu du combat. Mais le corps en fabrique encore plus pour compenser, alors le nombre total monte.

>> À retenir : beaucoup de globules blancs dans le sang, c'est le signe que le corps a envoyé ses pompiers. C'est un signe d'infection ou d'inflammation forte. Mais attention : au tout début, ce chiffre peut être encore normal. Un chiffre normal n'élimine jamais la maladie.

## CHAPITRE X : Pourquoi le corps chauffe

Parlons de la fièvre. C'est un signe qu'on voit tout le temps. Mais peu de gens savent vraiment pourquoi le corps chauffe. Toi, tu vas savoir.

### Le thermostat du cerveau

Dans le cerveau, il y a une petite zone qui règle la température du corps. C'est comme le thermostat d'une maison. Le thermostat décide : "la bonne température, c'est 37 degrés." Et le corps obéit. Il reste à 37.

Les messagers chimiques du chapitre VIII voyagent dans le sang. Ils arrivent jusqu'à ce thermostat dans le cerveau. Et là, ils font quelque chose : ils poussent le thermostat vers le haut. Ils le règlent sur 39, par exemple.

### Comment le corps monte la température

Maintenant, le cerveau pense que la bonne température est 39. Mais le corps est encore à 37. Alors le cerveau dit : "il fait trop froid, il faut chauffer !"

Le corps se met alors à faire de la chaleur. Il frissonne. Les muscles tremblent pour produire de la chaleur, comme quand tu as froid. Le malade a des frissons, il claque des dents, il veut se couvrir. Et petit à petit, la température monte jusqu'à 39.

⮞ Pourquoi le corps fait ça ? Pourquoi il choisit d'avoir chaud ? Parce que beaucoup de microbes n'aiment pas la chaleur. Ils se multiplient moins bien quand il fait chaud. La fièvre est donc une arme. C'est le corps qui essaie de brûler ses ennemis, de rendre la vie difficile aux microbes.

> Note simple : la fièvre n'est pas l'ennemi. C'est une défense du corps. Mais une fièvre très haute, au-dessus de 39, avec des frissons forts, est un signe que l'infection est sérieuse. Il faut alors faire très attention et agir vite.

> ملخص بالعربية : الحمى تحدث لأن الرسائل الكيميائية ترفع "منظّم الحرارة" في الدماغ. الحمى سلاح دفاعي ضد الجراثيم، لكن الحمى العالية جداً علامة خطر.

## CHAPITRE XI : Qui part à l'hôpital tout de suite ?

Tu penses à une appendicite. Très bien. Maintenant, ton deuxième travail, c'est de chercher les signes de gravité. Ce sont eux qui décident : est-ce qu'on envoie le malade à l'hôpital en urgence, ou est-ce qu'on peut surveiller un peu ?

### Les signes qui doivent te faire peur

Voici le tableau à connaître par cœur. Vraiment par cœur. Ces signes veulent dire "danger, agis maintenant" :

| Signe d'alarme | Ce qu'on voit | Ce que ça veut dire | Ce que tu fais |
|---|---|---|---|
| Ventre dur comme du bois | Le ventre ne se laisse plus toucher | L'explosion a déjà eu lieu | Transfert tout de suite |
| Fièvre très haute avec frissons | Plus de 39 degrés, le malade tremble | Les microbes passent dans le sang | Antibiotiques puis transfert |
| Ne peut plus boire ni uriner | Bouche sèche, très fatigué | Manque d'eau grave | Perfusion avant et pendant la route |
| Très jeune enfant | Moins de 5 ans | La maladie va plus vite chez lui | Priorité, on ne perd pas de temps |
| Personne âgée | Grand-père, grand-mère | Les signes sont trompeurs, tout va vite | Prudence maximale, transfert facile |
| Hôpital très loin | Longue route de piste | Le malade peut s'aggraver en chemin | Décider le transfert dès le doute |

### La question à te poser toujours

Pose-toi toujours la même question devant un mal de ventre : "Est-ce que ce malade peut attendre, oui ou non ?" Si tu hésites, si tu n'es pas sûr, alors la réponse est non. On n'attend pas.

>> Vérité simple : il vaut mille fois mieux envoyer à l'hôpital un malade qui, finalement, n'avait rien de grave, que de garder au village un malade dont l'appendice va exploser cette nuit. Un transfert pour rien, ce n'est pas grave. Un mort qu'on aurait pu sauver, ça, c'est grave.

>>> Alerte : ne te laisse jamais tromper par un malade qui a l'air calme. Chez l'enfant et chez la personne âgée surtout, le ventre peut sembler souple et doux. Mais à l'intérieur, tout peut être déjà très grave. Fie-toi à l'ensemble : la fièvre, la fatigue, l'histoire, pas seulement au ventre.

> ملخص بالعربية : كلما كان المستشفى أبعد، وجب اتخاذ قرار التحويل بسرعة أكبر ودون انتظار اليقين الكامل. الطفل والمسنّ خطر خاص.

## CHAPITRE XII : Les outils du médecin

Dans une grande ville, on a plein de machines : l'échographie, le scanner, des prises de sang rapides. Mais sur le terrain, souvent, tu as très peu de choses. Il faut apprendre à faire avec ce que tu as. Et surtout, à ne jamais rester bloqué.

### La prise de sang

● La prise de sang montre souvent beaucoup de globules blancs, comme on l'a vu au chapitre IX. C'est un bon indice. Mais attention, très attention : au tout début de la maladie, ce chiffre peut être encore normal.

● Donc retiens bien : une prise de sang normale n'élimine jamais l'appendicite. Si le ventre parle, si l'histoire est claire, tu ne dois pas te laisser rassurer par une prise de sang normale. Le ventre a toujours le dernier mot.

### L'échographie

● L'échographie, c'est une machine qui regarde dans le ventre avec des sons, sans rayons dangereux. C'est très utile, surtout chez l'enfant et chez la femme, justement parce qu'il n'y a pas de rayons.

● On y cherche un appendice trop gros, avec une paroi épaisse. Parfois on voit même le petit caillou qui bouche. Mais l'échographie a un défaut : elle dépend beaucoup de la personne qui tient la sonde. Un médecin entraîné voit bien. Un débutant peut rater. Et si l'appendice est caché derrière le cæcum, c'est encore plus dur à voir.

### Le scanner

● Le scanner, c'est le meilleur examen pour voir l'appendice. Il voit presque tout. Mais dans beaucoup d'hôpitaux de campagne, il n'existe tout simplement pas. Il coûte cher, il faut de l'électricité stable, et un spécialiste pour le lire.

> **L'Astuce du Prof :** ne reste jamais bloqué à attendre une machine que tu n'as pas. Ton meilleur outil, c'est gratuit et tu l'as toujours avec toi : tes mains et tes yeux. Réexamine le ventre du malade toutes les quelques heures. Si la douleur grandit et se fixe en bas à droite, la réponse s'écrit sous tes yeux, sans aucune machine.

## CHAPITRE XIII : Comment on soigne

Le traitement de base de l'appendicite, c'est l'opération. On enlève l'appendice malade. C'est simple à dire. Voyons comment on adapte ça au terrain.

### L'opération

➔ Dans les grandes villes, on opère par de tout petits trous. On glisse une caméra et des instruments fins par ces trous. On appelle ça la cœlioscopie. Le malade guérit vite et la cicatrice est minuscule.

➔ En campagne, on n'a pas toujours ce matériel. Alors on ouvre le ventre par une petite coupure classique, juste en bas à droite. Ça marche très bien aussi, entre de bonnes mains. Ne crois jamais que l'ancienne méthode est mauvaise. Elle sauve des vies tous les jours.

### Les antibiotiques

➔ Les antibiotiques sont des médicaments qui tuent les microbes. Ils aident beaucoup autour de l'opération. Dans une appendicite simple, on en donne un peu, juste pour aider. Mais en cas de péritonite ou de poche de pus, il en faut une vraie cure, plus longue et plus forte, pour nettoyer toute l'infection.

### Le cas de la grosse boule

➔ Parfois, la maladie a déjà formé une grosse boule dure dans le ventre, ce fameux mur de pompiers dont on a parlé. Opérer tout de suite dans cette boule est dangereux, car les tissus sont collés, fragiles, et on peut abîmer les intestins autour.

➔ Alors on fait autrement. On donne d'abord des antibiotiques. On laisse le calme revenir. On attend que la boule fonde doucement. Et on opère plus tard, à froid, quelques semaines après, quand tout est redevenu propre et facile.

> **L'Astuce du Prof :** devant une grosse boule inflammatoire, ton pire ennemi c'est la précipitation, l'envie d'opérer tout de suite. Retiens la formule : "on refroidit avant d'opérer." Patience et prudence sauvent le malade.

> ملخص بالعربية : العلاج الأساسي هو استئصال الزائدة. أمام الكتلة الالتهابية الكبيرة، نعطي المضادات الحيوية أولاً ثم نجري الجراحة لاحقاً بهدوء.

## CHAPITRE XIV : Autour de l'opération

Avant et après l'opération, il y a des soins importants. Ce ne sont pas des détails. Ils font partie du traitement.

### Avant l'opération

■ On met le malade à jeun. Ça veut dire qu'il ne mange plus et ne boit plus. Pourquoi ? Parce qu'endormir quelqu'un avec l'estomac plein est dangereux. Le contenu de l'estomac pourrait remonter et passer dans les poumons pendant le sommeil. C'est très grave. Donc estomac vide, toujours, avant d'endormir.

■ On pose une perfusion. C'est un petit tuyau dans la veine du bras. On donne de l'eau, du sucre et des sels directement dans le sang. Ça garde le malade fort, surtout s'il a vomi ou s'il n'a pas bu depuis longtemps.

■ On calme la douleur avec des médicaments. Un malade qui souffre moins est un malade plus calme et plus facile à soigner.

### Après l'opération

Après avoir enlevé l'appendice, on surveille le malade. On regarde trois choses simples, encore et encore :

▲ La température. Si la fièvre revient, c'est peut-être une infection qui reste. Il faut chercher.

▲ Le ventre. On regarde s'il est souple et pas trop douloureux. Un ventre qui redevient dur est un signe d'alerte.

▲ La cicatrice. On regarde si elle est propre, sans rougeur ni pus. Une cicatrice rouge et chaude peut s'infecter.

Si tout va bien, le malade recommence à manger doucement, se lève, marche un peu, et rentre chez lui après quelques jours. La guérison est rapide quand la maladie a été prise à temps.

>> À retenir : une appendicite prise tôt, c'est une petite opération et une guérison rapide, en quelques jours. Une appendicite prise trop tard, c'est une grande bataille, une longue hospitalisation, parfois plusieurs opérations. La seule différence entre les deux, c'est le temps. Toujours le temps.

## CHAPITRE XV : L'erreur qui peut tuer

S'il y a une seule chose à retenir de tout ce long cours, c'est celle-ci. Écoute-moi bien.

Loin de l'hôpital, ce qui tue le plus, ce n'est pas une mauvaise opération. Ce n'est pas un mauvais médecin. C'est le temps perdu avant de décider d'envoyer le malade.

### L'histoire qu'il ne faut pas vivre

Imagine la scène. Un malade a mal au ventre dans un village loin de tout. La famille hésite. Le médecin du village se dit : "attendons demain, ça va peut-être passer tout seul." Tout le monde attend.

Mais pendant qu'on attend, le film du chapitre V continue tout seul. Il ne s'arrête pas parce qu'on ferme les yeux. Heure après heure, la paroi meurt. Puis elle explose. Le lendemain matin, ce n'est plus une petite appendicite. C'est une péritonite grave, difficile à soigner.

### L'image du feu

Souviens-toi d'une image simple. L'appendicite, c'est comme un petit feu qui commence dans une pièce fermée. Au tout début, un seul seau d'eau suffit pour l'éteindre. C'est facile, rapide, sans danger.

Mais si tu attends, le feu grandit. Il prend le rideau, puis le meuble, puis toute la pièce, puis toute la maison. Et là, même les pompiers avec leurs grands camions ont du mal. Parfois, ils n'arrivent plus à sauver la maison.

⮞ Ton rôle de médecin, c'est d'agir quand il ne faut encore qu'un seul seau d'eau. Pas d'attendre l'incendie.

>>> Alerte finale : chaque heure d'attente augmente le risque d'explosion. Devant un ventre qui inquiète, on décide d'envoyer le malade dès le doute sérieux. On n'attend pas d'être sûr. Et on n'attend surtout pas que ça empire. La décision rapide, c'est ça qui sauve, plus que tout le reste.

> ملخص بالعربية : كل ساعة تأخير في التحويل تزيد خطر الانفجار والتهاب الصفاق. القرار المبكر ينقذ الحياة أكثر من أي شيء آخر.

## RÉCAPITULATIF

On arrive à la fin de ce long voyage. Voici le grand tableau de tout le film. Garde-le en tête. Si tu ne retiens qu'une seule image, que ce soit celle-là :

| Étape | Ce qui se passe | Le signe chez le malade | Le danger |
|---|---|---|---|
| Bouchon | Le tuyau se ferme | Presque rien au début | Faible si on agit vite |
| Ça gonfle | Les veines sont écrasées | Douleur vague au nombril | Moyen |
| La paroi meurt | Plus de sang, plus d'oxygène | Douleur forte en bas à droite, fièvre | Élevé |
| Explosion contenue | Boule ou poche de pus | Masse dure, fièvre qui va et vient | Élevé si on ne voit pas |
| Explosion libre | Le pus se répand partout | Ventre dur comme du bois | Vital, chaque minute compte |

Voilà. Tu connais maintenant l'appendicite. Du tout petit détail de la cellule jusqu'au geste qui sauve. Tu as fait un long chemin. Sois fier de toi.

Garde trois images simples dans la tête, pour toujours :

✦ Le tuyau fin qui se bouche, le cul-de-sac fermé.

✦ La douleur qui commence au nombril et qui descend vers le bas à droite.

✦ Le temps perdu, qui est ton pire ennemi, loin de l'hôpital.

Garde ces trois images, et tu seras un bon médecin. Même loin de tout. Même sans machine. Avec juste ta tête, tes mains et ton cœur. Bon courage pour la suite. Tu vas y arriver.`,
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
  {
    id: "exemples_analogies",
    label: "Exemples & Analogies",
    icon: Lightbulb,
    accent: {
      active: "border-yellow-300 bg-yellow-50 text-yellow-800",
      chip: "bg-yellow-100 text-yellow-600",
      hover: "hover:-translate-y-1 hover:bg-yellow-50 hover:text-yellow-600 hover:shadow-md",
    },
    // Fallback for legacy-only courses with no Supabase row (e.g. appendicite)
    // — real content is AI-generated per course, in Darija + termes français,
    // via app/api/generate/exemples-analogies (see EXEMPLES_ANALOGIES_SYSTEM_PROMPT).
    content: `## Exemples & Analogies

Ce mode réexplique le cours avec des analogies de la vie de tous les jours (bouteilles, tuyaux, ballons...), pour comprendre le mécanisme de la maladie, déduire les signes de l'examen clinique, et repérer les pièges classiques de QCM.`,
  },
];
