# Script de Soutenance — Justine LE BOURG

---

## Diapo 1 : Garde
**[0:00 - 0:30]**

Bonjour à tous.

Je suis Justine Le Bourg, étudiante en dernière année de Génie Mécanique à l'UTBM, en double-diplôme avec l'Université de Shanghai. Je vais vous présenter mon projet de fin d'études, réalisé au sein de l'Innovation Academy for Microsatellites de l'Académie des Sciences Chinoise, à Shanghai.

Ce stage de six mois, effectué sous la supervision du Dr. Farid Gamgami, s'intitule : "Intégrer la bibliothèque d'ingénierie satellite IDM dans le processus de conception du laboratoire".

Pour être plus concret, il s'agissait de construire un pont numérique entre les outils spécialisés du domaine spatial, afin de rendre les études préliminaires de satellites plus rapides, plus cohérentes et surtout, parfaitement traçables.

---

## Diapo 2 : Contexte & Entreprise
**[0:30 - 1:30]**

Mon stage s'inscrit dans une équipe de recherche qui vise à améliorer la conception de satellites. Leur ambition est double : introduire en Chine l'ingénierie concurrente — une méthode où tous les spécialistes collaborent dès les premières phases d'un projet —, et surtout, dépasser ses limites. Car cette approche a un talon d'Achille : en phase préliminaire, le nombre de scénarios qu'on peut explorer manuellement est trop restreint pour faire les meilleurs choix.

C'est là que le numérique et l'IA entrent en jeu : non pas remplacer l'expert, mais lui permettre d'explorer plus d'options, plus vite, avec des résultats chiffrés et traçables. C'est précisément ma contribution : construire un démonstrateur qui exécute des calculs spécialisés de façon fiable, tout en intégrant une IA pour faciliter l'interaction — et préparer le terrain d'une ingénierie concurrente augmentée.

---

<!-- TODO : section manquante [1:30 - 2:30] — "Le problème" (outils isolés, transferts manuels, erreurs de recopie, perte de traçabilité) -->

---

## Diapo : Méthodologie — L'Approche Itérative
**[2:30 - 4:30]**

Pour mener à bien ce projet, j'ai adopté une approche itérative. Mon maître de stage m'a laissé une grande liberté d'exploration, avec pour consigne de voir où mes recherches me mèneraient. Cette autonomie m'a permis de suivre un cheminement en quatre phases, où chaque étape a été un apprentissage et un pivot vers la suivante.

### Première phase : l'inventaire et la familiarisation

Mes premiers pas m'ont guidé vers la bibliothèque d'outils libres ou open-source développés par le CNES. Cette phase d'inventaire a été bien plus qu'un simple recensement : elle a été ma porte d'entrée dans le monde de l'ingénierie spatiale. J'ai dû me former sur des domaines variés comme la mécanique orbitale, les télécommunications, les systèmes de puissance, ou encore l'environnement spatial.

Mais surtout, cet inventaire m'a appris une chose essentielle : un satellite est un système profondément interconnecté. La masse influence l'orbite, l'orbite influence les éclipses, les éclipses influencent la puissance disponible. Tout est lié. J'ai donc dû garder en permanence un œil système sur tous ces entremêlements.

Parmi les 54 logiciels recensés, j'en ai retenu quatre jugés pertinents pour une chaîne d'analyse préliminaire :
- **Simu-CIC**, pour l'attitude, les éclipses et l'éclairement solaire.
- **OPALIS**, pour l'analyse du système électrique.
- **RF-COMLINK**, pour les télécommunications.
- **GMAT**, de la NASA, pour la propagation d'orbite.

### Deuxième phase : les preuves de concept techniques

Une fois les outils identifiés, il fallait prouver qu'ils pouvaient communiquer entre eux. J'ai donc développé des scripts Python pour faire dialoguer ces logiciels.

L'objectif était simple : vérifier qu'un fichier d'éphémérides produit par GMAT pouvait être converti, enrichi par Simu-CIC avec des données d'attitude et d'éclairement, puis réutilisé par OPALIS pour une analyse électrique. Et ça a fonctionné. J'ai prouvé que la continuité des données était techniquement possible.

Mais à ce stade, ces scripts étaient encore des "proofs of concept" techniques. Ils n'étaient pas assez robustes ou accessibles pour être utilisés par un ingénieur du laboratoire.

### Troisième phase : l'exploration de l'IA

Vint alors la phase la plus exploratoire : celle de l'intelligence artificielle. Les premières explorations m'ont surtout servi à apprendre comment intégrer l'IA dans un projet d'ingénierie. J'ai testé différentes approches : le tool calling, les systèmes de skills, et les capacités des IA à conseiller l'utilisateur.

Une des explorations a finalement été bien avancée : elle laissait un agent IA naviguer entre les différents logiciels pour répondre aux besoins de l'utilisateur. Mais très vite, une limite est apparue.

Faire appel à une IA entre chaque étape n'apportait finalement pas tant de plus-value. Pire, cela faisait perdre énormément de temps. L'agent devait interpréter, décider, puis exécuter, étape par étape. De plus, la construction du projet basé sur des skills a induit beaucoup d'erreurs techniques… des erreurs qui étaient parfois masquées ou "corrigées" par l'IA elle-même durant le calcul. Résultat : les problèmes devenaient très difficiles à identifier et à diagnostiquer.

### Quatrième phase : la construction du démonstrateur

La solution était donc de faire un pas de côté. Plutôt que de demander à l'IA de tout orchestrer, j'ai décidé de construire un outil déterministe robuste, qui pourrait ensuite être utilisé par un agent IA.

L'idée est simple : on donne à l'outil des inputs précis, on exécute des calculs reproductibles, et on produit des outputs traçables. Ensuite, une IA peut utiliser cet outil comme une brique fiable pour prendre des décisions ou conseiller l'utilisateur.

Cette phase a été marquée par un changement d'approche radical : la création d'un frontend. Jusqu'ici, je testais tout avec des scripts Python en ligne de commande. Le passage à une interface utilisateur m'a forcé à réfléchir autrement. Il a fallu concevoir des garde-fous, limiter les libertés pour garantir la vérité des données, et structurer clairement les sources d'information.

Un exemple de décision d'ingénierie système prise durant cette période : séparer formellement le satellite de la configuration de la mission.

Pourquoi ? Parce qu'une liberté totale sur les paramètres aurait mené à un manque de vérité scientifique. On doit pouvoir modifier une hypothèse de mission sans altérer la définition de référence du satellite. Cette séparation garantit la reproductibilité et la confiance dans les résultats.

---

### Transition
**[4:30]**

Ce démonstrateur, construit avec cette rigueur, est le cœur de mon travail. Je vais maintenant vous montrer comment il fonctionne concrètement et ce qu'il nous a appris sur un cas d'étude représentatif.

---

## Diapo 5 : Réalisations Techniques — Le Cœur
**[4:30 - 7:30]**

### Diapo 5a — Le démonstrateur : vue d'ensemble
**[0:45]**

Le démonstrateur que j'ai construit s'appelle Open Codex Web. C'est une application web full-stack qui orchestre les quatre outils en une seule chaîne déterministe.

Le principe est le suivant : l'ingénieur configure sa mission dans une interface guidée — il sélectionne un satellite depuis une bibliothèque, choisit son type de mission, et ajuste ses paramètres. La plateforme génère alors le script GMAT correspondant, l'exécute, récupère l'éphéméride de sortie, et déclenche automatiquement le pipeline aval : Simu-CIC, puis OPALIS et RF-COMLINK en parallèle. Chaque étape reporte son statut en temps réel dans l'interface.

Le résultat : un seul clic produit l'ensemble des analyses, dans un répertoire horodaté et entièrement traçable.

### Diapo 5b — La digital thread et le système de templates GMAT
**[1:15]**

Deux choix d'architecture méritent d'être détaillés.

**Premier choix : la séparation satellite / mission et la digital thread.** J'ai imposé une règle stricte : la définition du satellite — sa masse, son orbite, ses surfaces, ses paramètres électriques — est une donnée de référence, immuable. La configuration de la mission — l'altitude cible, le type de propulsion, les stations sol — est une donnée d'étude, volatile. Cette séparation garantit qu'on peut explorer dix scénarios différents sans jamais altérer la définition de référence.

Pour rendre ça concret : chaque valeur qui entre dans un calcul porte sa provenance. On sait si elle vient de la bibliothèque satellite, du draft de mission, ou d'un calcul précédent. C'est ce que j'appelle la digital thread — le fil numérique qui relie chaque décision à sa source.

**Deuxième choix : le système de templates GMAT.** GMAT utilise des scripts texte. J'ai développé un mécanisme qui lit le script de référence, extrait automatiquement toutes les valeurs modifiables — altitude, excentricité, inclinaison, masse, surfaces —, les valide contre des règles de sécurité anti-injection, et les substitue par offsets de caractères dans une copie du script. L'intérêt : on peut ajouter un nouveau type de mission en écrivant un seul script de référence, sans coder de logique spécifique.

### Diapo 5c — L'assistant IA d'analyse
**[1:00]**

Le dernier élément est l'assistant IA. Après chaque run, l'ingénieur peut poser des questions en langage naturel : « Est-ce que mon carburant est suffisant ? », « Pourquoi la marge RF est-elle négative ? »

Pour que l'IA réponde de façon fiable, je ne lui envoie pas les logs bruts. Le backend génère un contexte de preuve compact — un fichier JSON qui contient les métriques clés, les verdicts — blocker, warning, info —, et les fichiers source correspondants. L'IA reçoit ce contexte et un prompt discipliné qui lui impose trois règles : citer le fichier source pour chaque affirmation, distinguer les faits des interprétations, et signaler explicitement les preuves manquantes. Elle n'invente rien, elle n'exécute rien. Elle lit et elle explique.

C'est précisément l'équilibre que je cherchais : la rigueur du calcul déterministe, plus la capacité de l'IA à interpréter — sans jamais lui donner le contrôle du pipeline.

---

## Diapo 6 : Bilan & Apports
**[7:30 - 8:45]**

Sur le plan technique, ce projet m'a fait passer de la position de développeuse — celle qui implémente une feature — à celle d'architecte — celle qui conçoit un système avec ses contraintes de robustesse, de traçabilité et de maintenabilité.

J'ai développé une stack full-stack TypeScript complète : un backend Fastify avec gestion de processus externes — timeout, nettoyage, anti race-conditions —, et un frontend React avec interface temps réel. J'ai intégré quatre outils hétérogènes — un binaire NASA, un CLI, des scripts Scilab — en un pipeline cohérent. Et j'ai conçu une approche d'IA qui assume ses limites : l'IA assiste, elle ne décide pas.

Au-delà de la technique, ce stage m'a surtout appris à naviguer l'incertitude. Mon maître de stage m'a donné une liberté totale, et j'ai dû faire des choix d'architecture, les tester, parfois les remettre en cause. L'exemple le plus marquant : la phase d'exploration IA. J'ai investi plusieurs semaines dans un agent IA qui orchestrait tout. Et j'ai fini par l'abandonner, parce que j'ai compris que la fiabilité du système primaire devait primer sur l'automatisation. C'était un pivot difficile, mais le bon.

Sur le plan humain, ce stage en Chine m'a aussi confrontée à un environnement de travail différent, dans une langue étrangère, sur un domaine — l'ingénierie spatiale — que je découvrais. J'en ressors avec une vision système plus large et une confiance accrue dans ma capacité à apprendre vite.

---

## Diapo 7 : Conclusion & Perspectives
**[8:45 - 9:45]**

En conclusion, ce projet démontre qu'il est possible de construire un pont numérique fiable entre des outils d'analyse spatiale jusqu'ici isolés. Le démonstrateur fonctionne, il est testé — 96 fichiers de test backend, validation par hash des templates GMAT — et il répond au besoin initial : produire des résultats chiffrés et traçables pour des études préliminaires.

Les perspectives sont claires. À court terme, l'extension la plus prometteuse est l'analyse IA multi-runs : permettre à l'assistant de lire plusieurs runs simultanément pour comparer des scénarios et conseiller l'ingénieur sur les valeurs à ajuster. C'est la suite naturelle de ce travail. À moyen terme, le laboratoire vise à déployer cet outil comme brique de base de sa future salle d'ingénierie concurrente augmentée.

Mon stage aura été une première pierre : prouver que la rigueur du calcul et l'assistance IA peuvent coexister, au service de l'ingénieur.

---

## Diapo 8 : Remerciements
**[9:45 - 10:00]**

Je tiens à remercier chaleureusement le Dr. Farid Gamgami pour son encadrement, toute l'équipe du laboratoire pour leur accueil, ainsi que mes tuteurs académiques, Mme Costil de l'UTBM et M. He de l'Université de Shanghai, pour leur suivi.

Je vous remercie pour votre attention. Je suis maintenant prête à répondre à vos questions.
