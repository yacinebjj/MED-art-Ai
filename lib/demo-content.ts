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
    },
    content: `# L'Appendicite Aiguë en Milieu Tropical

## Comprendre, du plus petit détail de la cellule jusqu'au geste qui sauve

Bienvenue. Aujourd'hui, on va parler de l'appendicite. Mais attention : pas d'une manière ennuyeuse. On va faire simple, clair, avec des images de tous les jours. Mon but est que tu comprennes TOUT, même si le français n'est pas ta langue préférée. Tu vas voir : une fois que tu as le bon dessin dans la tête, tout devient facile.

Ne saute aucune ligne, même si c'est long. Chaque petite idée en prépare une plus grande. À la fin, tu ne réciteras pas ce cours : tu le comprendras, et ça, personne ne pourra te l'enlever.

![Un microscope en gros plan : c'est avec cet outil qu'on observe les cellules dont on va parler](https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1000&q=80)

## Sommaire

- Avant-propos : pourquoi ce cours est important pour toi
- Chapitre I : L'appendice, c'est quoi au juste ?
- Chapitre II : Un petit sac plein de soldats
- Chapitre III : Les faux amis (ce qui ressemble à l'appendicite)
- Chapitre IV : Comment le tuyau se bouche et finit par exploser
- Chapitre V : Le ver qui bouche le tuyau
- Chapitre VI : L'alarme incendie de la cellule
- Chapitre VII : Qui doit partir à l'hôpital tout de suite ?
- Chapitre VIII : Les outils du médecin sur le terrain
- Chapitre IX : Comment on soigne
- Chapitre X : L'erreur qui peut tuer : attendre trop longtemps
- Récapitulatif : le tableau à retenir

## AVANT-PROPOS : Pourquoi ce cours est important pour toi

Installe-toi bien. L'appendicite, c'est l'une des urgences du ventre les plus fréquentes au monde. Tu la verras très souvent. Le problème, c'est qu'elle est maligne : elle sait se déguiser. Parfois elle ressemble à une simple douleur au ventre, et pourtant elle peut tuer en quelques heures.

Ton travail de médecin n'est pas d'apprendre une phrase par cœur. Ton travail, c'est de COMPRENDRE. Comprendre pourquoi un tout petit bouchon peut transformer un organe tranquille en une vraie bombe. Et surtout, comprendre quoi faire quand l'hôpital est loin, très loin, comme dans beaucoup de régions tropicales.

Une question pour commencer. Attends, réponds-moi : d'après toi, qu'est-ce qui change vraiment quand le bloc opératoire est à quatre heures de route au lieu de quatre minutes ? Réfléchis une seconde avant de lire la suite. La réponse est simple : tu ne peux plus attendre d'être sûr à 100 pour cent. Tu dois décider plus tôt, et parfois envoyer le patient à l'hôpital juste sur un doute sérieux. On y reviendra souvent, car c'est le fil rouge de tout ce cours.

## CHAPITRE I : L'appendice, c'est quoi au juste ?

Imagine ton gros intestin comme un grand tuyau. Au tout début de ce tuyau, il y a une petite poche : le cæcum. Et sur cette poche est accroché un petit doigt creux, fin et fermé au bout, comme un petit gant à un seul doigt. C'est ça, l'appendice.

Le point où il est attaché ne bouge jamais. C'est un repère fixe pour le chirurgien. Par contre, la pointe de l'appendice, elle, peut se cacher un peu partout autour :

➔ **Derrière le cæcum** (le cas le plus fréquent) : là, il est caché. Quand on appuie sur le ventre, on ne sent presque rien. C'est le plus traître.
➔ **Vers le bas, dans le petit bassin** : là, il touche la vessie ou, chez la femme, les organes féminins. On confond alors facilement avec un problème urinaire ou gynécologique.
➔ **Vers le haut, sous le foie** : rare, mais la douleur monte et ressemble à une crise de vésicule biliaire.

Il faut bien comprendre une chose sur sa forme. L'appendice est un cul-de-sac : un tuyau fermé au bout, avec une seule petite porte d'entrée. Pense à une impasse dans une ville, une petite rue sans issue. Tout ce qui rentre doit ressortir par le même endroit. Si on bloque l'entrée de l'impasse, tout ce qui est à l'intérieur reste coincé. Retiens bien cette image du cul-de-sac : c'est la clé de toute la maladie.

> **L'Astuce du Prof :** au bloc, si tu ne trouves pas l'appendice, ne panique pas. Le gros intestin a trois bandes de muscle sur sa surface, comme trois rails. Suis ces rails avec le doigt : ils se rejoignent TOUJOURS pile à la base de l'appendice. C'est le truc infaillible.

![Vue anatomique du ventre : repérer où se cache l'appendice est la première étape du raisonnement](https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=1000&q=80)

## CHAPITRE II : Un petit sac plein de soldats

Voici une chose que beaucoup d'étudiants ignorent. L'appendice n'est pas un déchet inutile. À l'intérieur de sa paroi, il y a énormément de cellules de défense, les cellules du système immunitaire. On peut le voir comme une petite caserne de soldats, toujours prête à se battre contre les microbes.

Cette caserne est la plus remplie entre 10 et 20 ans. Et devine quoi : c'est exactement l'âge où l'appendicite est la plus fréquente. Ce n'est pas un hasard, tu vas comprendre pourquoi.

Quand tu attrapes un simple rhume ou une petite gastro, tout ton corps met ses soldats en alerte. Les soldats de l'appendice se multiplient alors très vite et gonflent. Et là, problème : le tuyau de l'appendice est déjà tout fin. Si les soldats gonflent trop, ils bouchent le passage de l'intérieur, comme une éponge qui gonfle dans un tuyau étroit.

Tu es avec moi ? Ne décroche pas, c'est le point de départ de toute la maladie : **un tuyau fin qui se bouche facilement.**

### Le tapis roulant de mucus

Il y a une deuxième chose à connaître. La paroi de l'appendice fabrique du mucus, une sorte de gel glissant. Ce gel agit comme un tapis roulant : il attrape les microbes et les pousse doucement vers la sortie, vers le gros intestin. Tant que le tuyau est ouvert, ce tapis roulant nettoie tout seul, sans qu'on y pense.

Mais réfléchis deux secondes : que se passe-t-il si la sortie est bouchée ? Le tapis roulant continue de tourner, le mucus continue d'être fabriqué, mais il ne peut plus sortir. Il s'accumule. Et un endroit chaud, humide et fermé, plein de mucus, c'est le paradis des microbes. Voilà comment un simple bouchon transforme un organe propre en nid à microbes.

> ملخص بالعربية : الزائدة الدودية ليست عضواً عديم الفائدة، بل هي مليئة بخلايا المناعة التي تنتفخ عند أي عدوى بسيطة، فتسد الأنبوب الضيق.

## CHAPITRE III : Les faux amis (ce qui ressemble à l'appendicite)

Attention ici, car c'est le chapitre le plus dangereux. Toute douleur en bas à droite du ventre n'est PAS une appendicite. En zone tropicale, plusieurs maladies portent le même masque. Si tu te trompes, ça peut coûter une vie.

> **Attention, danger :** chez toute femme en âge d'avoir des enfants qui a mal en bas à droite, tu dois TOUJOURS éliminer une grossesse dans la trompe (grossesse extra-utérine) avant de penser appendicite. Ne l'oublie JAMAIS. C'est une erreur mortelle très classique.

Voici les principaux faux amis à connaître, surtout sous les tropiques :

| Maladie | Où et pour qui | Ce qui doit t'alerter | L'examen qui tranche |
|---|---|---|---|
| Vraie appendicite | Tout le monde, surtout 10-30 ans | Douleur qui part du nombril puis descend à droite | Échographie ou surveillance clinique |
| Fièvre typhoïde | Eau sale, hygiène difficile | Fièvre longue en plateau, gros ventre, patient abattu | Prise de sang (hémoculture) |
| Paludisme grave | Zone de moustiques, pas de protection | Fièvre + fatigue extrême, parfois jaunisse | Goutte de sang au microscope, en urgence |
| Amibiase du côlon | Eau ou aliments souillés | Diarrhée avec du sang et des glaires | Examen des selles |

### Le piège de la gastro chez l'enfant

Un dernier faux ami, très fréquent chez l'enfant : la gastro-entérite. L'enfant a mal au ventre, vomit, a un peu de fièvre. Les parents pensent à une simple gastro et attendent. Mais parfois, sous cette gastro se cache une vraie appendicite qui commence. La règle simple à retenir : si la douleur ne passe pas et se fixe de plus en plus en bas à droite, ce n'est plus une gastro. Réexamine toujours l'enfant quelques heures plus tard, c'est le meilleur détecteur de pièges.

> **L'Astuce du Prof :** retiens une règle d'or de la médecine tropicale. Fièvre + douleur au ventre au retour d'une zone à paludisme = paludisme jusqu'à preuve du contraire. On demande la goutte de sang AVANT tout le reste.

> ملخص بالعربية : ليس كل ألم أسفل يمين البطن التهاب زائدة. في المناطق الحارة، فكّر دائماً في الملاريا والتيفوئيد أولاً.

## CHAPITRE IV : Comment le tuyau se bouche et finit par exploser

Voici le cœur du cours. Je vais te raconter l'histoire en cinq étapes, comme un film. Si tu comprends ce film, tu comprends tout le reste : les signes, l'urgence, le traitement.

### Étape 1 : le bouchon

Tout commence par un bouchon dans le petit tuyau. Chez l'adulte, c'est souvent une petite bille de matières dures (on l'appelle un stercolithe, mais retiens juste : un petit caillou de "caca" séché). Chez le jeune, c'est la caserne de soldats qui gonfle, comme on l'a vu au chapitre précédent. Dans tous les cas, la petite porte d'entrée du cul-de-sac se ferme.

### Étape 2 : ça se remplit

Une fois le tuyau bouché, l'appendice continue de fabriquer du liquide en amont. Mais ce liquide ne peut plus sortir. Imagine un évier bouché où le robinet coule quand même : l'eau monte, monte, monte. En plus, les microbes qui vivent normalement là-dedans se retrouvent enfermés et se mettent à se multiplier très vite dans ce liquide stagnant. En quelques heures, ils sont des millions.

### Étape 3 : ça gonfle et ça serre les veines

La pression monte dans l'appendice fermé. Et voici un point clé. Dans la paroi, il y a deux types de tuyaux de sang : les veines (petite pression, molles) et les artères (grosse pression, solides). Quand la pression interne monte, elle écrase D'ABORD les veines, parce qu'elles sont molles.

Dis-moi, d'après toi, pourquoi les veines cèdent avant les artères ? Réfléchis une seconde... Voilà : c'est comme deux tuyaux d'arrosage, un presque vide (la veine) et un gonflé à fond (l'artère). Si tu marches dessus, le tuyau presque vide s'aplatit tout de suite, l'autre résiste. Résultat : le sang entre encore par les artères mais ne ressort plus par les veines. La paroi gonfle d'eau, comme une éponge trempée.

### Étape 4 : la paroi meurt

La pression continue de monter et finit par écraser aussi les artères. Là, plus de sang du tout n'arrive. Sans sang, la paroi n'a plus d'oxygène. Elle s'étouffe et commence à mourir. Les microbes en profitent pour envahir tout le mur de l'appendice, de l'intérieur vers l'extérieur.

> **L'Astuce du Prof :** retiens cette petite phrase : "la veine se bouche avant l'artère". C'est PILE à ce moment-là que la douleur se déplace du nombril vers le bas à droite. Pourquoi ? Parce que l'inflammation touche enfin la fine peau qui tapisse le ventre (le péritoine), et cette peau, elle, sait dire exactement où ça fait mal.

![Observation au microscope : la paroi de l'appendice qui souffre et meurt, cellule par cellule](https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=1000&q=80)

### Étape 5 : l'explosion

Un mur mort finit toujours par se déchirer. C'est la perforation. Deux scénarios :

➔ **Explosion "contenue"** : si ça va lentement, les organes voisins et la graisse du ventre viennent coller autour, comme des pompiers qui font un mur autour d'un feu. Ça forme une grosse boule (un plastron) ou une poche de pus (un abcès).
➔ **Explosion "libre"** : si ça va très vite, le pus se répand partout dans le ventre. C'est la péritonite généralisée. Là, c'est une urgence vitale, chaque minute compte.

Retiens bien l'ordre de ce film : bouchon, remplissage, gonflement, mort de la paroi, explosion. Chaque étape prépare la suivante. Et plus le temps passe, plus on avance dans le film sans pouvoir revenir en arrière. C'est pour ça qu'on dit que l'appendicite est une course contre la montre.

> ملخص بالعربية : القصة في خمس مراحل: انسداد، امتلاء، انتفاخ يضغط الأوردة، موت الجدار، ثم الانفجار. الألم ينتقل إلى أسفل اليمين عندما يصل الالتهاب إلى غشاء البطن.

## CHAPITRE V : Le ver qui bouche le tuyau

Voici une cause qu'on oublie souvent, mais très fréquente dans les régions chaudes : les vers intestinaux, en particulier un ver rond assez long qu'on appelle l'ascaris.

Attends, une question : comment un ver peut-il donner une appendicite ? C'est logique quand tu y penses. Ce ver vit dans l'intestin. Parfois, il se faufile dans l'entrée de l'appendice, s'enroule sur lui-même, et bouche le tuyau exactement comme un caillou le ferait. Le même film que le chapitre IV recommence, mais avec un ver comme bouchon.

En plus, le corps déteste ce ver et envoie contre lui un type spécial de cellules de défense (les éosinophiles). Ça ajoute encore de l'inflammation. Voilà pourquoi, en zone tropicale, on regarde toujours la prise de sang : beaucoup d'éosinophiles, c'est un indice qui doit faire penser au ver.

> **L'Astuce du Prof :** quand tu retires un appendice sous les tropiques, examine bien l'intérieur. Si tu trouves un ver, il faut traiter toute la famille contre les vers, sinon ça recommencera chez les frères et sœurs.

![Vue anatomique du tube digestif : c'est là que le ver peut migrer et venir boucher l'appendice](https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=1000&q=80)

> ملخص بالعربية : الديدان مثل الإسكارس قد تسد الزائدة الدودية تماماً كالحصاة، وهي سبب متكرر في المناطق الحارة.

## CHAPITRE VI : L'alarme incendie de la cellule

On va descendre tout petit maintenant, au niveau des molécules. Mais reste tranquille : je vais tout expliquer avec des images simples. Tu vas voir, c'est comme un système d'alarme dans une maison.

### La sonnette d'alarme

Sur la surface des cellules, il y a des petits capteurs. Le plus important s'appelle le TLR4. Pense à une sonnette sur la porte. Quand un microbe (surtout sa "peau", une molécule appelée LPS) vient toucher cette sonnette, elle sonne : "Alerte, un ennemi est entré !".

### L'interrupteur central

Cette sonnette envoie un message à l'intérieur de la cellule jusqu'à un grand interrupteur, qu'on appelle NF-kB. Tant qu'il est éteint, rien ne se passe. Mais quand l'alarme sonne, l'interrupteur s'allume. Et cet interrupteur, lui, ouvre les "usines" qui fabriquent les signaux d'urgence.

Tu es toujours là ? C'est le passage le plus technique, mais garde l'image : sonnette, puis fil électrique, puis interrupteur, puis usines qui démarrent. Rien de plus.

### Les messagers d'urgence

Les usines fabriquent alors des petits messagers chimiques (on les appelle les cytokines : par exemple l'interleukine 1, le TNF-alpha). Ces messagers partent dans le sang et font trois choses :

✔ Ils montent la température du corps : c'est la fièvre.
✔ Ils appellent les soldats du sang (les globules blancs) à venir se battre sur place.
✔ Ils rendent les nerfs du coin très sensibles : c'est la douleur.

Voilà pourquoi un malade avec une appendicite a de la fièvre, une prise de sang avec beaucoup de globules blancs, et mal au ventre. Ce ne sont pas trois hasards : c'est le même système d'alarme qui tourne à fond.

### Les pompiers arrivent

Quand les messagers d'urgence sonnent, les globules blancs du sang arrivent en courant. Mais comment sortent-ils du sang pour aller sur le lieu du combat ? Les parois des petits vaisseaux deviennent collantes, comme du velcro. Les globules blancs s'y accrochent, ralentissent, puis se faufilent entre les cellules du vaisseau pour rejoindre le tissu malade. C'est pour ça qu'à la prise de sang on voit beaucoup de globules blancs : une partie a quitté le sang pour aller combattre dans l'appendice.

> **L'Astuce du Prof :** chaque signe que tu vois chez le patient a une explication au niveau des molécules. La fièvre, c'est les messagers qui parlent au cerveau. La douleur, c'est les nerfs rendus hypersensibles. Quand tu comprends ça, tu ne récites plus : tu raisonnes.

![Image au microscope de cellules : c'est à cette échelle minuscule que se joue toute l'inflammation](https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1000&q=80)

> ملخص بالعربية : الالتهاب مثل نظام إنذار: جرس على الخلية ينبّه مفتاحاً مركزياً، فيطلق رسائل كيميائية تسبب الحمى والألم واستدعاء خلايا الدفاع.

## CHAPITRE VII : Qui doit partir à l'hôpital tout de suite ?

Une fois que tu penses à une appendicite, ton deuxième réflexe est de chercher les signes de gravité. Ce sont eux qui décident si tu dois envoyer le patient EN URGENCE, surtout quand l'hôpital est loin.

| Signe d'alarme | Ce qu'on voit | Ce que ça veut dire | Ce que tu fais |
|---|---|---|---|
| Ventre dur comme du bois | Le ventre ne se laisse plus toucher | L'explosion a déjà eu lieu (péritonite) | Transfert immédiat, sans attendre |
| Fièvre très haute avec frissons | Plus de 39 degrés, le patient tremble | Les microbes passent dans le sang | Antibiotiques tout de suite, puis transfert |
| Le patient ne peut plus uriner ou boire | Bouche sèche, très fatigué | Manque d'eau grave | Perfusion avant et pendant le voyage |
| Très jeune enfant | Moins de 5 ans | La maladie va beaucoup plus vite chez lui | Priorité absolue, on ne perd pas de temps |
| Hôpital à plusieurs heures | Longue route de piste | Le patient peut s'aggraver en chemin | Décider le transfert dès le doute sérieux |

Pose-toi toujours la même question devant un mal de ventre : "Est-ce que ce patient peut attendre, oui ou non ?" Si tu hésites, considère que la réponse est non. Il vaut mille fois mieux envoyer à l'hôpital un patient qui, finalement, n'avait rien de grave, que de garder au village un patient dont l'appendice va exploser cette nuit.

> **Attention, danger :** ne te laisse jamais rassurer par un patient qui a l'air calme si les signes de gravité sont là. Chez l'enfant et la personne âgée, le ventre peut sembler souple alors que tout est déjà grave à l'intérieur.

> ملخص بالعربية : كلما بعُد المستشفى، وجب اتخاذ قرار التحويل بسرعة أكبر ودون انتظار اليقين الكامل.

## CHAPITRE VIII : Les outils du médecin sur le terrain

Dans une grande ville, on a le scanner et l'échographie. Mais sur le terrain, en zone rurale, tu as souvent très peu d'outils. Apprends à faire avec ce que tu as.

➔ **La prise de sang :** elle montre souvent beaucoup de globules blancs. Mais attention : au tout début, elle peut être normale. Une prise de sang normale n'élimine JAMAIS une appendicite si le ventre parle.
➔ **L'échographie :** très utile quand elle existe, surtout chez l'enfant et la femme (pas de rayons). On y cherche un appendice trop gros et une paroi épaissie. Son défaut : ça dépend beaucoup de la personne qui tient la sonde.
➔ **Le scanner :** c'est le meilleur examen, mais dans beaucoup d'hôpitaux de campagne, il n'existe tout simplement pas.

> **L'Astuce du Prof :** ne reste jamais bloqué à attendre un examen que tu n'as pas. Ton meilleur outil, c'est de réexaminer le ventre du patient toutes les quelques heures. Si la douleur grandit et se fixe en bas à droite, la réponse est en train de s'écrire sous tes yeux.

![Un examen au microscope en laboratoire : sur le terrain, la prise de sang et l'observation attentive restent des outils précieux](https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=1000&q=80)

## CHAPITRE IX : Comment on soigne

Le traitement de base de l'appendicite, c'est l'opération : on enlève l'appendice. Voyons comment on adapte ça sur le terrain.

➔ **L'opération :** dans les grandes villes, on passe par de tout petits trous (cœlioscopie). En campagne, on ouvre le ventre par une petite coupure classique. Ça marche très bien aussi, entre de bonnes mains.
➔ **Les antibiotiques :** ils accompagnent l'opération. En cas de péritonite ou d'abcès, il en faut une vraie cure, plus longue et plus forte.
➔ **Le cas de la grosse boule (plastron) :** quand la maladie a déjà formé une boule dure, opérer tout de suite est dangereux (les tissus sont trop fragiles). On donne alors d'abord des antibiotiques, on laisse le calme revenir, et on opère plus tard "à froid", environ 6 à 8 semaines après.

### Les soins autour de l'opération

Avant d'opérer, on prépare le patient. On le met à jeun : il ne mange plus, car endormir quelqu'un qui a l'estomac plein est dangereux (le contenu de l'estomac pourrait remonter et passer dans les poumons). On pose une perfusion pour lui donner de l'eau et du sucre directement dans la veine. On calme la douleur et on commence les antibiotiques. Après l'opération, on surveille trois choses simples : la température, le ventre, et la cicatrice. Quand tout a été fait à temps, le patient se remet en général très vite, et c'est ça, la plus belle récompense.

> **L'Astuce du Prof :** face à une grosse boule inflammatoire, ton pire ennemi c'est la précipitation. Retiens la formule : "on refroidit avant d'opérer".

> ملخص بالعربية : العلاج الأساسي هو استئصال الزائدة. أمام الكتلة الالتهابية، نعطي المضادات الحيوية أولاً ثم نعمل الجراحة لاحقاً بهدوء.

## CHAPITRE X : L'erreur qui peut tuer : attendre trop longtemps

S'il y a une seule chose à retenir de tout ce cours, c'est celle-ci. Loin de l'hôpital, ce qui tue le plus souvent, ce n'est pas une mauvaise opération. C'est le temps perdu avant de décider d'envoyer le patient.

Imagine la scène. Un malade a mal au ventre dans un village loin de tout. On se dit : "attendons demain, ça va peut-être passer". Mais pendant qu'on attend, le film du chapitre IV continue tout seul, heure après heure : la paroi meurt, puis elle explose.

Souviens-toi d'une image simple. L'appendicite, c'est comme un petit incendie qui commence dans une pièce fermée. Au début, un seau d'eau suffit pour l'éteindre. Mais si tu attends, le feu prend toute la maison, et là, même les pompiers ont du mal. Ton rôle de médecin, c'est d'agir quand il ne faut encore qu'un seau d'eau.

> **Attention, danger :** chaque heure d'attente augmente le risque d'explosion. Devant un ventre qui inquiète, on décide d'envoyer le patient DÈS le doute sérieux. On n'attend pas d'être sûr, et on n'attend surtout pas que ça empire.

> ملخص بالعربية : كل ساعة تأخير في التحويل تزيد خطر الانفجار والتهاب الصفاق. القرار المبكر ينقذ الحياة.

## RÉCAPITULATIF : le tableau à retenir

| Étape | Ce qui se passe | Le signe chez le patient | Le danger |
|---|---|---|---|
| Bouchon | Le tuyau se ferme | Encore peu de signes | Faible si on agit vite |
| Ça gonfle | Les veines sont écrasées | Douleur vague autour du nombril | Modéré |
| La paroi meurt | Plus de sang, plus d'oxygène | Douleur forte fixée en bas à droite, fièvre | Élevé |
| Explosion contenue | Boule ou poche de pus | Masse dure, fièvre qui va et vient | Élevé si on ne voit pas |
| Explosion libre | Le pus se répand partout | Ventre dur comme du bois, patient en danger | Vital, chaque minute compte |

Voilà. Tu connais maintenant l'appendicite du tout petit détail de la cellule jusqu'au geste qui sauve. Retiens surtout trois images : le tuyau fin qui se bouche, la douleur qui se déplace vers le bas à droite, et le temps perdu qui est ton pire ennemi. Garde ces trois images dans la tête, et tu seras un bon médecin, même loin de tout.`,
  },
  {
    id: "resume",
    label: "Résumé",
    icon: ScrollText,
    accent: {
      active: "border-emerald-300 bg-emerald-50 text-emerald-800",
      chip: "bg-emerald-100 text-emerald-600",
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
