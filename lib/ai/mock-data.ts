/**
 * Fixture data returned instead of a real OpenRouter call when mock mode is
 * active (see lib/ai/openrouter.ts). Every payload below is a single
 * realistic case — méningite bactérienne aiguë (Infectiologie) — shaped
 * EXACTLY like the JSON schemas in lib/prompts/public-course-sections.ts, so
 * the Studio components render them with zero special-casing versus a real
 * AI response.
 *
 * Detection is by system-prompt content, not by an explicit `section`
 * parameter — callOpenRouter/streamOpenRouter only ever see a `messages`
 * array, never which Section enum value the caller is generating. Each
 * marker string below is a substring that exists in exactly one of the
 * prompts in public-course-sections.ts (or the chat route's system prompt)
 * and nowhere else — see detectMockPayload() in openrouter.ts.
 */

export const MOCK_EXPLICATION = `# Méningite bactérienne aiguë : l'urgence qui ne pardonne pas les heures perdues
*Un cours complet, expliqué avec des mots très simples*

Bonjour. On va apprendre la méningite bactérienne aiguë ensemble.

Ce cours va être long, volontairement long. Un vrai médecin ne connaît pas juste le nom de la maladie, il connaît chaque petit détail : pourquoi les bactéries arrivent là, pourquoi la fièvre monte si vite, pourquoi certains signes cliniques sont des alarmes qu'on ne rate jamais. Prends ton temps. Fais des pauses si tu en as besoin, relis un paragraphe deux fois s'il le faut — ce n'est pas grave, c'est même conseillé.

## Sommaire

● Avant-propos : pourquoi ce cours est important
■ Chapitre I : Comment la bactérie arrive dans le cerveau
▲ Chapitre II : Pourquoi la fièvre et les céphalées apparaissent si vite
● Chapitre III : Le signe qu'on ne rate jamais — le syndrome méningé
■ Chapitre IV : La ponction lombaire, l'examen qui tranche
▲ Récapitulatif

## Avant-propos : pourquoi ce cours est important

La méningite bactérienne est rare, mais elle fait partie des quelques diagnostics en médecine où une heure de retard peut coûter une vie. C'est le piège principal : au début, ça ressemble à une grosse grippe. Fièvre, mal de tête, fatigue. Rien qui crie "urgence" au premier regard.

Imagine deux situations. Un étudiant arrive aux urgences d'un grand CHU à 3h du matin avec de la fièvre et des céphalées violentes : en vingt minutes, il a une prise de sang, une ponction lombaire, un scanner si besoin. Maintenant imagine le même étudiant dans un petit dispensaire isolé, à trois heures de route du laboratoire le plus proche. Le même retard de diagnostic n'a pas le même poids dans les deux cas — et c'est exactement pour ça qu'il faut connaître les signes cliniques par cœur, sans dépendre des examens.

Dis-moi, d'après toi : qu'est-ce qui différencie une "grosse migraine avec fièvre" d'une vraie méningite ?

> 🟢 La réponse : la raideur de nuque et l'intolérance à la lumière (photophobie). Une migraine ne donne (presque) jamais une nuque raide comme une planche.

Le fil rouge de ce cours : à chaque étape, on va se demander "qu'est-ce qui, cliniquement, doit me faire penser MÉNINGITE et non pas autre chose ?" — parce que c'est cette question, posée au bon moment, qui sauve des vies.

## Chapitre I : Comment la bactérie arrive dans le cerveau

**D'où viennent ces bactéries ?**

➔ Le rhino-pharynx (nez, gorge)
➔ Le sang, lors d'une bactériémie
➔ Un foyer ORL négligé (sinusite, otite)

Réfléchis avant de lire la suite : comment une bactérie qui vit tranquillement dans ton nez peut-elle finir dans ton cerveau ?

⮞ Elle colonise d'abord la muqueuse du rhino-pharynx sans donner aucun symptôme.
⮞ Chez certaines personnes (immunité affaiblie, brèche anatomique), elle traverse la muqueuse et passe dans le sang.
⮞ Une fois dans le sang, elle peut franchir la barrière hémato-encéphalique — une frontière censée protéger le cerveau des microbes.
⮞ Elle se multiplie alors librement dans le liquide céphalo-rachidien (LCR), un liquide presque sans défenses immunitaires.

■ Image forte à retenir : la barrière hémato-encéphalique, c'est comme un mur de château fort. Une fois qu'un ennemi passe par une brèche, il n'y a presque plus personne à l'intérieur pour lui résister — c'est pour ça que l'infection explose aussi vite une fois installée.

❖ Étape 1 : colonisation du rhino-pharynx.
❖ Étape 2 : passage dans le sang (bactériémie).
❖ Étape 3 : franchissement de la barrière hémato-encéphalique.
❖ Étape 4 : multiplication libre dans le LCR et réaction inflammatoire méningée.

> 🔴 Danger : chez le nourrisson et la personne âgée, cette barrière est plus perméable — ce qui explique pourquoi ces deux populations sont les plus touchées et les plus à risque de forme grave.

> **L'Astuce du Prof** : retiens les 3 germes les plus fréquents selon l'âge — *Streptococcus pneumoniae* et *Neisseria meningitidis* chez l'adulte jeune, *Streptococcus agalactiae* et *E. coli* chez le nouveau-né. Une question d'examen sur "le germe le plus probable selon le terrain" tombe presque à chaque session.

*ملخص بالعربية : تصل البكتيريا إلى الدماغ عبر الدم بعد استعمار البلعوم الأنفي، ثم تخترق الحاجز الدموي الدماغي.*

## Chapitre II : Pourquoi la fièvre et les céphalées apparaissent si vite

Une fois les bactéries installées dans le LCR, le système immunitaire réagit — et c'est cette réaction, pas la bactérie elle-même directement, qui cause la plupart des symptômes.

**Pourquoi une fièvre aussi haute, aussi vite ?**

⮞ Les bactéries libèrent des toxines qui activent des cellules immunitaires.
⮞ Ces cellules libèrent des cytokines pro-inflammatoires (IL-1, TNF-α).
⮞ Ces cytokines agissent sur l'hypothalamus, le "thermostat" du corps, et le règlent plus haut.
⮞ Résultat : une fièvre brutale, souvent supérieure à 39°C en quelques heures.

**Et les céphalées ?**

L'inflammation des méninges (les membranes qui enveloppent le cerveau) et l'augmentation de la pression à l'intérieur du crâne étirent des structures richement innervées et très sensibles à la douleur. ■ Image forte à retenir : c'est comme gonfler un ballon à l'intérieur d'une boîte rigide — la boîte ne peut pas s'agrandir, alors chaque millimètre de pression en plus fait mal.

| Signe | Mécanisme principal | Délai d'apparition typique |
|---|---|---|
| Fièvre élevée | Cytokines pro-inflammatoires sur l'hypothalamus | Quelques heures |
| Céphalées | Inflammation méningée + hypertension intracrânienne | Quelques heures à 1 jour |
| Vomissements | Hypertension intracrânienne | 12 à 24h |
| Photophobie | Irritation méningée directe | 12 à 24h |

*ملخص بالعربية : الحمى والصداع سببهما رد الفعل الالتهابي للجسم، وليس البكتيريا نفسها مباشرة.*

## Chapitre III : Le signe qu'on ne rate jamais — le syndrome méningé

C'est le cœur clinique de ce cours. Le syndrome méningé associe classiquement trois éléments :

➔ Fièvre
➔ Céphalées intenses, souvent en casque, aggravées par la lumière (photophobie) et le bruit (phonophobie)
➔ Raideur de nuque (le patient ne peut pas fléchir le menton vers la poitrine)

Attends, réponds-moi : si un patient a de la fièvre et un mal de tête, mais PAS de raideur de nuque, peut-on éliminer une méningite ?

⮞ Non. Chez le nourrisson et la personne très âgée, la raideur de nuque peut être absente ou discrète — c'est un piège classique.

> 🟡 Précaution : chez le nourrisson, cherche plutôt un bombement de la fontanelle, des cris incessants ("cri méningé"), un refus de boire.

> 🔴 Danger : un purpura fulminans (taches violacées qui ne s'effacent pas à la vitropression) associé à une fièvre impose une antibiothérapie IMMÉDIATE, avant même la ponction lombaire — c'est une des rares situations où on ne doit pas attendre la confirmation.

*ملخص بالعربية : المتلازمة السحائية تجمع الحمى والصداع الشديد وتيبس الرقبة، لكنها قد تكون غائبة عند الرضع.*

## Chapitre IV : La ponction lombaire, l'examen qui tranche

La ponction lombaire (PL) prélève le LCR pour l'analyser. C'est l'examen de référence pour confirmer une méningite bactérienne.

❖ Étape 1 : position assise ou en décubitus latéral, dos courbé.
❖ Étape 2 : ponction entre L4-L5, sous les niveaux où finit la moelle épinière.
❖ Étape 3 : analyse du LCR — aspect, cytologie, biochimie (protéines, glycorachie), culture bactériologique.

| Paramètre | LCR normal | Méningite bactérienne |
|---|---|---|
| Aspect | Clair, "eau de roche" | Trouble, purulent |
| Cellules | < 5/mm³ | > 1000/mm³, à prédominance neutrophiles |
| Protéinorachie | 0,2-0,4 g/L | Élevée (> 1 g/L) |
| Glycorachie | ≈ 2/3 de la glycémie | Effondrée |

> **L'Astuce du Prof** : la contre-indication majeure à la PL en urgence, c'est un signe d'engagement cérébral (trouble de conscience sévère, signes de localisation) — dans ce cas, on fait d'abord une imagerie cérébrale, mais on ne retarde JAMAIS l'antibiothérapie pour autant.

*ملخص بالعربية : البزل القطني يحلل السائل النخاعي وهو الفحص المرجعي لتأكيد التهاب السحايا الجرثومي.*

## Récapitulatif

| Étape clinique | Point clé à retenir |
|---|---|
| Terrain | Nourrisson et personne âgée = plus à risque, présentation parfois atypique |
| Symptômes | Fièvre + céphalées + raideur de nuque = syndrome méningé |
| Signe d'alarme absolu | Purpura fulminans → antibiothérapie immédiate |
| Examen clé | Ponction lombaire, sauf contre-indication (signes d'engagement) |
| Priorité absolue | Ne jamais retarder l'antibiothérapie pour "attendre" un examen |

✦ Le mur du château fort : la barrière hémato-encéphalique, franchie une fois, laisse le champ libre à l'infection.
✦ Le ballon dans la boîte rigide : la douleur vient de la pression, pas juste de l'infection elle-même.
✦ Les taches qui ne s'effacent pas : le purpura fulminans est le seul signe qui doit te faire agir avant même de confirmer le diagnostic.

Tu as fait le tour de l'essentiel. Relis ce cours une deuxième fois dans quelques jours — la mémoire clinique se construit par répétition, pas par une seule lecture parfaite. Bon courage pour la suite !`;

export const MOCK_RESUME = {
  tombabilite: 85,
  modes: [
    {
      id: "smart",
      label: "Smart Summary",
      hero: {
        tags: ["Infectiologie", "Urgences"],
        badge: "Haute Tombabilité",
        titre: "MASTERCLASS : Méningite bactérienne aiguë",
        intro: "Tout ce qu'il faut savoir pour reconnaître, confirmer et traiter une méningite bactérienne sans perdre une minute.",
        sous_titre: "",
      },
      sections: [
        {
          numero: 1,
          titre: "L'Essentiel",
          intro: "",
          outro: "",
          cards: [
            { titre: "Définition", type: "text", content: "Inflammation aiguë des méninges d'origine bactérienne, urgence médicale absolue.", items: [] },
            { titre: "Signes d'Alarme", type: "list", content: "", items: ["Purpura fulminans", "Trouble de conscience", "Signes de localisation neurologique"] },
          ],
          table: { headers: [], rows: [] },
          rows: [],
          items: [],
        },
        {
          numero: 2,
          titre: "Germes selon le terrain",
          intro: "Le germe le plus probable dépend fortement de l'âge et du contexte.",
          outro: "Ces associations sont un grand classique des examens.",
          cards: [],
          table: {
            headers: ["Terrain", "Germe le plus fréquent", "Particularité"],
            rows: [
              ["Adulte jeune", "Neisseria meningitidis", "Risque de purpura fulminans"],
              ["Adulte > 50 ans", "Streptococcus pneumoniae", "Rechercher une porte d'entrée ORL"],
              ["Nouveau-né", "Streptococcus agalactiae, E. coli", "Présentation souvent atypique"],
            ],
          },
          rows: [],
          items: [],
        },
        {
          numero: 3,
          titre: "Analyse du LCR",
          intro: "La ponction lombaire confirme le diagnostic et oriente vers l'origine bactérienne.",
          outro: "",
          cards: [],
          table: {
            headers: ["Paramètre", "Méningite bactérienne"],
            rows: [
              ["Aspect", "Trouble, purulent"],
              ["Cellularité", "> 1000/mm³, neutrophiles"],
              ["Glycorachie", "Effondrée"],
            ],
          },
          rows: [],
          items: [],
        },
        {
          numero: 4,
          titre: "Piège Clinique",
          intro: "Chez le nourrisson et la personne âgée, la raideur de nuque peut manquer.",
          outro: "",
          cards: [
            { titre: "Nourrisson", type: "text", content: "Rechercher un bombement de la fontanelle et des cris incessants plutôt qu'une raideur franche.", items: [] },
          ],
          table: { headers: [], rows: [] },
          rows: [],
          items: [],
        },
        {
          numero: 5,
          titre: "Arsenal Diagnostique",
          intro: "",
          outro: "",
          cards: [
            { titre: "Bilan de première intention", type: "text", content: "Ponction lombaire, hémocultures, NFS, CRP, glycémie (pour comparer à la glycorachie).", items: [] },
          ],
          table: { headers: [], rows: [] },
          rows: [],
          items: [],
        },
        {
          numero: 6,
          titre: "Contre-indications à la PL immédiate",
          intro: "",
          outro: "",
          cards: [],
          table: { headers: [], rows: [] },
          rows: [
            { label: "Signes de localisation neurologique", badge: "Imagerie d'abord" },
            { label: "Trouble de conscience sévère", badge: "Imagerie d'abord" },
          ],
          items: [],
        },
        {
          numero: 7,
          titre: "Règles Thérapeutiques",
          intro: "",
          outro: "",
          cards: [],
          table: { headers: [], rows: [] },
          rows: [],
          items: [
            "Antibiothérapie probabiliste dans l'heure, sans attendre la PL en cas de purpura fulminans",
            "Adaptation secondaire selon l'antibiogramme",
            "Corticothérapie associée dans certaines formes (à discuter selon le germe)",
            "Surveillance neurologique rapprochée les premières 48h",
          ],
        },
      ],
      ddx_table: { titre: "", intro: "", headers: [], rows: [] },
      pieges: { titre: "", intro: "", categories: [] },
      cards: [],
      steps: [],
      quotes: [],
      perles: [],
      items: [],
    },
    {
      id: "exam",
      label: "Exam Summary",
      hero: { tags: [], badge: "Points Clés", titre: "Exam Summary", intro: "Les diagnostics différentiels et pièges classiques d'examen.", sous_titre: "" },
      sections: [],
      ddx_table: {
        titre: "Diagnostics Différentiels",
        intro: "Devant un syndrome méningé fébrile, ces diagnostics doivent être évoqués.",
        headers: ["Diagnostic", "Signe Clé", "Ce Qui Distingue"],
        rows: [
          ["Méningite virale", "Évolution moins brutale", "LCR clair, lymphocytaire, glycorachie normale"],
          ["Méningo-encéphalite herpétique", "Troubles du comportement, convulsions", "IRM et PCR HSV du LCR"],
          ["Hémorragie méningée", "Céphalée en coup de tonnerre", "Scanner cérébral avant tout"],
        ],
      },
      pieges: {
        titre: "Pièges à l'Examen",
        intro: "Les erreurs les plus fréquentes chez l'étudiant.",
        categories: [
          {
            nom: "Pièges Cliniques",
            items: [
              { numero: 1, text: "Éliminer une méningite parce que la nuque n'est pas raide chez un nourrisson." },
              { numero: 2, text: "Attendre le résultat de la PL avant de traiter un purpura fulminans." },
            ],
          },
        ],
      },
      cards: [],
      steps: [],
      quotes: [],
      perles: [],
      items: [],
    },
    {
      id: "cheatsheet",
      label: "Cheat Sheet",
      hero: { tags: [], badge: "", titre: "Cheat Sheet", intro: "", sous_titre: "Tout sur une seule page" },
      sections: [],
      ddx_table: { titre: "", intro: "", headers: [], rows: [] },
      pieges: { titre: "", intro: "", categories: [] },
      cards: [
        { titre: "Symptômes", tone: "teal", items: ["Fièvre brutale", "Céphalées en casque", "Photophobie", "Raideur de nuque", "Vomissements", "🧠 Mnémo : Fièvre-Céphalées-Raideur = triade méningée"] },
        { titre: "Causes", tone: "indigo", items: ["Neisseria meningitidis", "Streptococcus pneumoniae", "Streptococcus agalactiae (nouveau-né)", "E. coli (nouveau-né)", "Listeria (immunodéprimé)", "🧠 Mnémo : le terrain oriente le germe"] },
        { titre: "Diagnostic", tone: "purple", items: ["Ponction lombaire", "Hémocultures", "NFS, CRP", "Glycémie comparative", "Imagerie si signes de localisation", "🧠 Mnémo : PL sauf engagement"] },
        { titre: "Traitement", tone: "emerald", items: ["Antibiothérapie probabiliste urgente", "Adaptation à l'antibiogramme", "Corticothérapie selon le contexte", "Surveillance neurologique", "Isolement gouttelettes si méningocoque", "🧠 Mnémo : traiter avant de confirmer si purpura"] },
      ],
      steps: [],
      quotes: [],
      perles: [],
      items: [],
    },
    {
      id: "guideline",
      label: "Guideline Summary",
      hero: { tags: [], badge: "Parcours Clinique", titre: "Guideline Summary", intro: "La prise en charge étape par étape.", sous_titre: "" },
      sections: [],
      ddx_table: { titre: "", intro: "", headers: [], rows: [] },
      pieges: { titre: "", intro: "", categories: [] },
      cards: [],
      steps: [
        { numero: 1, titre: "Suspicion clinique", content: "Fièvre + céphalées + raideur de nuque, ou tout signe atypique chez un terrain fragile." },
        { numero: 2, titre: "Recherche de signes de gravité", content: "Purpura fulminans, trouble de conscience, signes de localisation." },
        { numero: 3, titre: "Bilan et confirmation", content: "Ponction lombaire (sauf contre-indication), hémocultures, imagerie si besoin." },
        { numero: 4, titre: "Traitement immédiat", content: "Antibiothérapie probabiliste sans délai, surtout en cas de purpura fulminans." },
      ],
      quotes: [],
      perles: [],
      items: [],
    },
    {
      id: "professor",
      label: "Professor Notes",
      hero: { tags: [], badge: "Notes de Stage", titre: "Professor Notes", intro: "", sous_titre: "" },
      sections: [],
      ddx_table: { titre: "", intro: "", headers: [], rows: [] },
      pieges: { titre: "", intro: "", categories: [] },
      cards: [],
      steps: [],
      quotes: [
        { text: "Un purpura fulminans se traite avant de se confirmer.", contexte: "Rappel donné en garde aux urgences." },
        { text: "La nuque raide manque souvent chez le nourrisson — cherche la fontanelle.", contexte: "Piège classique en pédiatrie." },
        { text: "La glycorachie basse est votre meilleur indice biochimique.", contexte: "Interprétation du LCR." },
      ],
      perles: [
        { type: "perle", text: "Une PL normale chez un patient déjà sous antibiotiques n'élimine pas le diagnostic." },
        { type: "astuce", text: "Compare toujours la glycorachie à la glycémie capillaire du même moment." },
        { type: "perle", text: "Le méningocoque impose un isolement gouttelettes et une prophylaxie de l'entourage." },
      ],
      items: [],
    },
    {
      id: "astuces",
      label: "Astuces",
      hero: { tags: [], badge: "Mémorisation Éclair", titre: "Astuces Mnémotechniques", intro: "Les images qui font gagner du temps le jour de l'examen.", sous_titre: "" },
      sections: [],
      ddx_table: { titre: "", intro: "", headers: [], rows: [] },
      pieges: { titre: "", intro: "", categories: [] },
      cards: [],
      steps: [],
      quotes: [],
      perles: [],
      items: [
        { numero: 1, titre: "La triade méningée", acronyme: "FCR : Fièvre, Céphalées, Raideur", chiffres: "", image: "", citation: "", content: "Les trois signes cardinaux à chercher systématiquement.", details: [] },
        { numero: 2, titre: "Le mur du château fort", acronyme: "", chiffres: "", image: "", citation: "", content: "La barrière hémato-encéphalique protège, mais une fois franchie, l'infection explose.", details: [] },
        { numero: 3, titre: "Le ballon dans la boîte rigide", acronyme: "", chiffres: "", image: "Un ballon qui gonfle à l'intérieur d'une boîte qui ne s'agrandit pas", citation: "", content: "L'hypertension intracrânienne explique la douleur et les vomissements.", details: [] },
        { numero: 4, titre: "Les taches qui ne s'effacent pas", acronyme: "", chiffres: "", image: "", citation: "Si ça ne s'efface pas au verre, ça n'attend pas la confirmation.", content: "Le purpura fulminans impose un traitement immédiat.", details: [] },
      ],
    },
  ],
};

export const MOCK_CAS_CLINIQUE = {
  titre_section: "Récit Clinique Immersif",
  cases: [
    {
      id: "cas-1",
      numero: 1,
      archetype: "Adulte jeune, syndrome méningé fébrile brutal",
      icon: "stethoscope",
      color: "indigo",
      titre: "Une nuit aux urgences pour Karim, 22 ans",
      scene: "23h, service des urgences. Karim, étudiant, est amené par un ami : fièvre depuis 6 heures, céphalées violentes, vomissements en jet il y a une heure.",
      vitals: [
        { label: "TA", value: "108/68 mmHg", alert: false },
        { label: "FC", value: "112 bpm", alert: true },
        { label: "Température", value: "39.6°C", alert: true },
        { label: "Hémoglobine", value: "14.2 g/dL", alert: false },
      ],
      acte1_interrogatoire: [
        { speaker: "medecin", name: "Dr. Amrani", tone: "calme", text: "Depuis quand as-tu mal à la tête ?", pourquoi: "" },
        { speaker: "patient", name: "Karim", tone: "souffrant", text: "Depuis ce matin, mais là c'est devenu insupportable, surtout avec la lumière.", pourquoi: "" },
        { speaker: "medecin", name: "Dr. Amrani", tone: "attentif", text: "Est-ce que tu arrives à toucher ta poitrine avec ton menton ?", pourquoi: "Recherche directe d'une raideur de nuque, signe cardinal du syndrome méningé." },
        { speaker: "patient", name: "Karim", tone: "gêné", text: "Non, ça tire trop fort, je n'y arrive pas.", pourquoi: "" },
      ],
      acte2_examen_physique: [
        { action: "Recherche d'une raideur de nuque", pourquoi: "Confirmer cliniquement le syndrome méningé avant tout examen complémentaire." },
        { action: "Inspection cutanée complète à la recherche de purpura", pourquoi: "Un purpura fulminans changerait immédiatement la prise en charge — antibiothérapie avant tout." },
      ],
      acte3_examens_complementaires: [
        { label: "Ponction lombaire", result: "LCR trouble, 2400 éléments/mm³ à prédominance neutrophiles, glycorachie effondrée", pourquoi: "Confirme une méningite d'origine bactérienne probable." },
        { label: "Hémocultures", result: "En attente, prélevées avant la première dose d'antibiotique", pourquoi: "Identifier le germe en cause pour adapter le traitement." },
      ],
      acte4_raisonnement: {
        items: [
          { maladie: "Méningite bactérienne aiguë", raisonnement: "Fièvre brutale + syndrome méningé franc + LCR purulent et hypoglycorachique.", pourquoi: "C'est le diagnostic le plus probable et le plus urgent à traiter." },
          { maladie: "Méningite virale", raisonnement: "Écartée par le LCR à prédominance neutrophiles et la glycorachie très basse.", pourquoi: "Une origine virale donne classiquement un LCR clair et lymphocytaire." },
        ],
        conclusion: "Méningite bactérienne aiguë, probablement à méningocoque compte tenu de l'âge et de la rapidité d'évolution.",
      },
      acte5_prise_en_charge: {
        items: [
          { ligne: "Antibiothérapie probabiliste IV débutée dans l'heure suivant l'admission", pourquoi: "Chaque heure de retard augmente le risque de séquelles neurologiques et de décès." },
          { ligne: "Isolement gouttelettes et signalement pour prophylaxie de l'entourage proche", pourquoi: "Le méningocoque se transmet par voie respiratoire et impose une prophylaxie des contacts." },
        ],
        surveillance: "Surveillance neurologique rapprochée (conscience, signes de localisation) durant les 48 premières heures.",
      },
    },
  ],
};

export const MOCK_QCMS = {
  titre_section: "L'Épreuve Ultime",
  qcms: [
    {
      id: 1,
      question: "Quel est le signe clinique le plus spécifique orientant vers une origine bactérienne d'une méningite ?",
      options: [
        { label: "A", text: "Fièvre isolée" },
        { label: "B", text: "Glycorachie effondrée au LCR" },
        { label: "C", text: "Céphalées frontales" },
        { label: "D", text: "Fatigue générale" },
        { label: "E", text: "Toux sèche" },
      ],
      reponsesCorrectes: ["B"],
      explication: {
        globale: "La glycorachie effondrée, comparée à la glycémie du même moment, est le paramètre le plus discriminant pour une origine bactérienne.",
        A: "Non spécifique, présente dans toutes les méningites.",
        B: "Correct — reflète la consommation de glucose par les bactéries et les leucocytes.",
        C: "Non spécifique de l'étiologie.",
        D: "Symptôme trop général.",
        E: "Ne fait pas partie du tableau méningé.",
      },
    },
    {
      id: 2,
      question: "Devant un purpura fulminans fébrile, quelle est la priorité absolue ?",
      options: [
        { label: "A", text: "Réaliser la ponction lombaire avant tout traitement" },
        { label: "B", text: "Attendre les hémocultures" },
        { label: "C", text: "Administrer une antibiothérapie immédiate" },
        { label: "D", text: "Programmer une IRM cérébrale en urgence" },
        { label: "E", text: "Surveiller sans traiter" },
      ],
      reponsesCorrectes: ["C"],
      explication: {
        globale: "Le purpura fulminans est une urgence vitale : l'antibiothérapie doit être débutée immédiatement, sans attendre aucun examen.",
        A: "Retarderait un traitement vital.",
        B: "Les hémocultures sont prélevées mais ne doivent jamais retarder le traitement.",
        C: "Correct — c'est la seule priorité absolue dans ce contexte.",
        D: "Non prioritaire dans l'immédiat.",
        E: "Mettrait le patient en danger.",
      },
    },
    {
      id: 3,
      question: "Chez le nourrisson, quel signe remplace souvent la raideur de nuque, parfois absente ?",
      options: [
        { label: "A", text: "Bombement de la fontanelle" },
        { label: "B", text: "Toux productive" },
        { label: "C", text: "Éruption vésiculeuse" },
        { label: "D", text: "Diarrhée aiguë" },
        { label: "E", text: "Ictère cutané" },
      ],
      reponsesCorrectes: ["A"],
      explication: {
        globale: "Chez le nourrisson, la présentation clinique est souvent atypique ; le bombement de la fontanelle est un signe clé à rechercher.",
        A: "Correct — reflète l'hypertension intracrânienne chez un crâne encore non ossifié.",
        B: "Non spécifique.",
        C: "Évoque une autre pathologie.",
        D: "Non spécifique d'une méningite.",
        E: "Non lié à ce tableau.",
      },
    },
    {
      id: 4,
      question: "Quelle contre-indication impose de réaliser une imagerie cérébrale avant la ponction lombaire ?",
      options: [
        { label: "A", text: "Fièvre supérieure à 39°C" },
        { label: "B", text: "Signes de localisation neurologique" },
        { label: "C", text: "Céphalées intenses" },
        { label: "D", text: "Vomissements" },
        { label: "E", text: "Photophobie" },
      ],
      reponsesCorrectes: ["B"],
      explication: {
        globale: "Des signes de localisation neurologique ou un trouble de conscience sévère font craindre un engagement cérébral, contre-indiquant la PL immédiate.",
        A: "Ne contre-indique pas la PL.",
        B: "Correct — risque d'engagement lors de la ponction.",
        C: "Fait partie du tableau habituel, pas une contre-indication.",
        D: "Idem, symptôme fréquent non contre-indicatif à lui seul.",
        E: "Signe habituel du syndrome méningé.",
      },
    },
    {
      id: 5,
      question: "Quel germe est le plus fréquemment en cause chez le nouveau-né ?",
      options: [
        { label: "A", text: "Neisseria meningitidis" },
        { label: "B", text: "Streptococcus agalactiae" },
        { label: "C", text: "Mycobacterium tuberculosis" },
        { label: "D", text: "Haemophilus influenzae type b" },
        { label: "E", text: "Cryptococcus neoformans" },
      ],
      reponsesCorrectes: ["B"],
      explication: {
        globale: "Streptococcus agalactiae (streptocoque du groupe B) est le germe le plus fréquent chez le nouveau-né, transmis lors de l'accouchement.",
        A: "Plus typique de l'adulte jeune.",
        B: "Correct.",
        C: "Cause rare et d'évolution différente.",
        D: "Devenu rare depuis la vaccination généralisée.",
        E: "Surtout chez l'immunodéprimé sévère.",
      },
    },
  ],
  qrocs: [
    { id: 1, question: "Citez les trois éléments classiques du syndrome méningé.", reponseOfficielle: "Fièvre, céphalées intenses, raideur de nuque." },
    { id: 2, question: "Quel signe cutané impose une antibiothérapie avant toute confirmation biologique ?", reponseOfficielle: "Le purpura fulminans." },
    { id: 3, question: "Quel paramètre du LCR compare-t-on systématiquement à la glycémie du moment ?", reponseOfficielle: "La glycorachie." },
  ],
};

export const MOCK_MIND_MAP = {
  nodes: [
    { id: "n1", label: "Fièvre brutale", type: "symptome" },
    { id: "n2", label: "Céphalées en casque", type: "symptome" },
    { id: "n3", label: "Raideur de nuque", type: "symptome" },
    { id: "n4", label: "Purpura fulminans", type: "symptome" },
    { id: "n5", label: "Franchissement de la barrière hémato-encéphalique", type: "mecanisme" },
    { id: "n6", label: "Libération de cytokines pro-inflammatoires", type: "mecanisme" },
    { id: "n7", label: "Hypertension intracrânienne", type: "mecanisme" },
    { id: "n8", label: "Ponction lombaire", type: "examen" },
    { id: "n9", label: "Hémocultures", type: "examen" },
    { id: "n10", label: "Méningite bactérienne aiguë", type: "diagnostic" },
    { id: "n11", label: "Antibiothérapie probabiliste urgente", type: "traitement" },
    { id: "n12", label: "Isolement et prophylaxie de l'entourage", type: "traitement" },
  ],
  links: [
    { source: "n5", target: "n6", label: "déclenche" },
    { source: "n6", target: "n1", label: "cause" },
    { source: "n6", target: "n7", label: "provoque" },
    { source: "n7", target: "n2", label: "explique" },
    { source: "n1", target: "n10", label: "évoque" },
    { source: "n2", target: "n10", label: "évoque" },
    { source: "n3", target: "n10", label: "confirme" },
    { source: "n4", target: "n11", label: "impose en urgence" },
    { source: "n8", target: "n10", label: "confirme" },
    { source: "n9", target: "n10", label: "identifie le germe" },
    { source: "n10", target: "n11", label: "traite" },
    { source: "n11", target: "n12", label: "complète" },
  ],
};

export const MOCK_CHAT_REPLY = `Bonne question ! Reprenons ça calmement.

La **méningite bactérienne aiguë** est une urgence parce que le délai avant l'antibiothérapie conditionne directement le pronostic neurologique. Concrètement : chaque heure de retard augmente le risque de séquelles (surdité, épilepsie séquellaire) et le risque de décès.

Le point le plus important à retenir pour ta pratique : si tu vois un **purpura fulminans** (des taches violacées qui ne s'effacent pas quand tu appuies dessus avec un verre), tu traites **avant** d'avoir la moindre confirmation biologique. Ce n'est pas une négligence de "sauter" la ponction lombaire dans ce cas précis — c'est la bonne pratique.

Est-ce que tu veux qu'on détaille la conduite à tenir devant une suspicion sans signe de gravité, ou plutôt les critères qui feraient différer la ponction lombaire ?`;

interface DetectedMock {
  section: string;
  value: unknown;
}

/**
 * Maps a marker substring — unique to exactly one system prompt in
 * lib/prompts/public-course-sections.ts — to the JSON key that prompt's
 * caller expects back. Order matters: more specific markers first, so e.g.
 * "QCMs" (only in QCMS_SYSTEM_PROMPT) is checked before any broader match
 * could exist.
 */
const MOCK_MARKERS: Array<{ marker: string; section: string }> = [
  { marker: "carte mentale (mind map)", section: "mind_map" },
  { marker: 'l\'onglet "QCMs"', section: "qcms" },
  { marker: 'l\'onglet "Cas Clinique"', section: "cas_clinique" },
  { marker: "Smart Summary, Exam Summary, Cheat Sheet", section: "resume" },
  { marker: "explication ULTRA-DÉTAILLÉE", section: "explication" },
];

/** Fixtures that stay static regardless of which course they're generated for. */
const STATIC_MOCK_VALUES: Record<string, unknown> = {
  mind_map: MOCK_MIND_MAP,
  qcms: MOCK_QCMS,
  cas_clinique: MOCK_CAS_CLINIQUE,
  resume: MOCK_RESUME,
  explication: MOCK_EXPLICATION,
};

/**
 * Returns the fixture matching this system prompt's section, or null if this
 * text doesn't match any known generation prompt (e.g. the chat route,
 * handled separately).
 */
export function detectMockPayload(systemText: string): DetectedMock | null {
  for (const { marker, section } of MOCK_MARKERS) {
    if (!systemText.includes(marker)) continue;
    return { section, value: STATIC_MOCK_VALUES[section] };
  }
  return null;
}

/** True when the system prompt is the MedArt Assistant chat persona (app/api/courses/chat/route.ts). */
export function isChatSystemPrompt(systemText: string): boolean {
  return systemText.includes("MedArt Assistant");
}
