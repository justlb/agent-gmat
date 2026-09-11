# Script de Soutenance — Justine LE BOURG

---

## Diapo 1 : Garde
**[0:00 - 0:30]**

Bonjour à tous.

Je suis Justine Le Bourg, étudiante en dernière année de Génie Mécanique à l'UTBM, en double-diplôme avec l'Université de Shanghai. Je vais vous présenter mon projet de fin d'études, réalisé au sein du Key Laboratory for Satellite Digitalisation Technology of the Innovation Academy for Microsatellites, Chinese Academy of Sciences, à Shanghai.

Ce stage de six mois, effectué sous la supervision du Dr. Farid Gamgami, s'intitule : "Integrate the IDM satellite engineering library into the laboratory design process".

Pour être plus concret, il s'agissait de construire un pont numérique entre les outils spécialisés du domaine spatial, afin de rendre les études préliminaires de satellites plus rapides, plus cohérentes et surtout, parfaitement traçables.

---

## Diapo 2 : Contexte & Entreprise
**[0:30 - 2:15]**

Mon stage s'est déroulé à l'Innovation Academy for Microsatellites de l'Académie des Sciences Chinoise — l'IAMCAS. C'est un institut de recherche majeur qui a déjà lancé 105 satellites, avec des missions emblématiques comme le satellite quantique QUESS, le détecteur de matière noire DAMPE, ou encore le programme d'étude de la magnétosphère SMILE, développé en collaboration avec l'ESA. Plus de 700 collaborateurs, dont 88% sont diplômés d'études supérieures et docteurs, répartis sur deux campus à Shanghai.

Mon équipe d'accueil est le Key Laboratory for Satellite Digitalisation Technology, qui développe des méthodes et des infrastructures numériques pour garder les données, les modèles et les simulations cohérents tout au long du cycle de vie d'un satellite.

Au sein de ce Key Lab, je travaille dans l'équipe APSL, qui vise à introduire en Chine l'ingénierie concurrente — une méthode où tous les spécialistes collaborent dès les premières phases d'un projet. L'équipe explore comment l'améliorer grace aux nouvelles technologies et l'intelligence artificiel.

Un des projet consiste a produire un digital thread numerique complet, boosté par intelligence artificiel. Cet outil permettrait durant les sessions d'ingenieurie concurrentes de tester rapidement la faisabilité de leurs idees, pour pousser la discussion plus loin avec les differents acteurs.

Mon projet a donc été defini dans ce context, et le but etait donc de creuser pour savoir comment nous pourrions avec l'IA permettre de construire ce digital thread. Au cours du stage, sous les indications de mon maitre de stage, le context/le but s'est affiné, et il a été question de creer un outil, capable de calculer l'influence de variations de certaines valeurs de maniere fiable et traçable. Cet outil sera ensuite utilisé mis put together avec le travail des autres personnes du labo, dans un agent IA qui sera l'orchestrateur de ce digital thread. CAD qu'il utilisera alors ces outils pour permettre d'aider les ingenieurs a comprendre les influences des varaitions lors de la conception, ou pour valider certaines configurations. (c'est pas clair faut reecrire)



(C'est là que mon projet intervient. Mon but, au final, a été de créer un outil capable de calculer tous les effets de l'influence des paramètres orbitaux sur les télécommunications et le système électrique. Concrètement : on fait varier l'orbite, et on constate l'impact produit sur les valeurs qui en dépendent — marges de liaison radio, puissance disponible, éclipses — pour un satellite donné.

La vision est plus large encore. À terme, cet outil doit être intégré dans un projet bien plus gros, où un agent IA sera capable de l'appeler — par tool calling — pour faire varier certains paramètres orbitaux afin de répondre aux exigences de mission, selon le satellite défini lors de la session d'ingénierie concurrente. Mon stage pose donc la brique calcul fiable ; l'agent IA qui l'orchèrera viendra ensuite.)

---

## Diapo : Méthodologie — L'Approche Itérative
**[2:15 - 4:30]**

Pour mener à bien ce projet, j'ai adopté une approche itérative. Mon maître de stage m'a laissé une grande liberté d'exploration, avec pour consigne de voir où mes recherches me mèneraient, tout en me guidant/ redirigeant vers le projet general. Cette autonomie m'a permis de suivre un cheminement en quatre phases, où chaque étape a été un apprentissage et un pivot vers la suivante.

### Première phase : l'inventaire et la familiarisation

Mes premiers pas m'ont guidé vers la bibliothèque d'outils libres ou open-source développés par le CNES. Cette phase d'inventaire a été bien plus qu'un simple recensement : elle a été ma porte d'entrée dans le monde de l'ingénierie spatiale. J'ai dû me former sur des domaines variés comme la mécanique orbitale, les télécommunications, les systèmes de puissance, ou encore l'environnement spatial.

Mais surtout, cet inventaire m'a appris une chose essentielle : un satellite est un système profondément interconnecté. La masse influence l'orbite, l'orbite influence les éclipses, les éclipses influencent la puissance disponible. Tout est lié. J'ai donc dû garder en permanence un œil système sur tous ces entremêlements.

Parmi les 54 logiciels recensés, j'en ai retenu quatre jugés pertinents pour une chaîne d'analyse préliminaire :
- **Simu-CIC**, pour l'attitude, les éclipses et l'éclairement solaire.
- **OPALIS**, pour l'analyse du système électrique.
- **RF-COMLINK**, pour les télécommunications.
- **GMAT**, de la NASA, pour la propagation d'orbite.

Ces logiciels dependaient tous des parametres orbitaux du satellite. Un petit digital thread est donc apparu ainsi : GMAT pourrait definir la trajectoire du satellite, en fonction de cette trajectoire SIMU-CIC pouvait ainsi calculer geometriquement le temps d'eclipse, necessaire pour analyser l'autonomie electrique du satellite, ainsi que le temps de contact avec les grounds stations, information necessaire pour RF-COMLINK. 


### Deuxième phase : les preuves de concept techniques

Une fois ce fil identifié, il fallait prouver que les logiciels pouvaient communiquer entre eux. J'ai donc développé des scripts Python pour faire dialoguer ces logiciels.

L'objectif était simple : vérifier qu'un fichier d'éphémérides produit par GMAT pouvait être converti, enrichi par Simu-CIC avec des données d'attitude et d'éclairement, puis réutilisé par OPALIS pour une analyse électrique, ou par RF_COMLINK pour la communication. Et ça a fonctionné. J'ai prouvé que la continuité des données était techniquement possible.

Mais à ce stade, ces scripts étaient encore des "proofs of concept" techniques, pas assez robustes pour être utilisés par un ingénieur lors de sessions d'ingénierie concurrente.

### Troisième phase : l'exploration du tool calling IA

Vint alors la phase la plus exploratoire. J'ai testé le tool calling : l'idée de laisser un agent IA utiliser les scripts precedamment generer pour appeler directement les logiciels pour répondre aux besoins de l'utilisateur. Mais très vite, une limite est apparue.

L'IA ne pouvait pas utiliser logiquement ces logiciels sans structure. Elle devait interpréter, décider, puis exécuter, étape par étape, sans cadre rigide. Résultat : beaucoup d'erreurs techniques, parfois masquées ou "corrigées" par l'IA elle-même durant le calcul. Les problèmes devenaient très difficiles à identifier et à diagnostiquer. Faire appel à une IA entre chaque étape n'apportait finalement pas tant de plus-value, et faisait perdre énormément de temps.

### Quatrième phase : la construction du démonstrateur

La solution était de faire un pas de côté. Plutôt que de demander à l'IA d'orchestrer des logiciels non structurés, j'ai décidé de construire un outil déterministe robuste, que l'IA pourra ensuite appeler comme une brique fiable.

C'est là qu'intervient le frontend. Il n'est pas le but final de mon projet. Il m'a été utile pour comprendre comment organiser la pipeline de façon logique : quels paramètres en entrée, dans quel ordre enchaîner les outils, quelles garanties poser. Le passage à une interface m'a forcée à concevoir des garde-fous, à limiter les libertés pour garantir la vérité des données, et à structurer clairement les sources d'information. Le frontend m'a permis de définir la forme du tool que l'IA appellera demain.

---

### Transition
**[4:30]**

Ce démonstrateur, construit avec cette rigueur, est le cœur de mon travail. Je vais maintenant vous montrer comment il fonctionne concrètement.

---

## Diapo 5 : Réalisations Techniques — Le Cœur
**[4:30 - 7:30]**

### Diapo 5a — Le démonstrateur : vue d'ensemble
**[0:45]**

Le démonstrateur que j'ai construit s'appelle Open Codex Web. C'est une application web full-stack qui orchestre les quatre outils en une seule chaîne déterministe.

Le principe est le suivant : l'ingénieur configure sa mission dans une interface guidée — il sélectionne un satellite depuis une bibliothèque, choisit son type de mission, ajuste ses paramètres orbitaux. La plateforme génère alors le script GMAT correspondant, l'exécute, récupère l'éphéméride de sortie, et déclenche automatiquement le pipeline aval : Simu-CIC, puis OPALIS et RF-COMLINK en parallèle. Chaque étape reporte son statut en temps réel.

Le résultat : un seul clic produit l'ensemble des analyses — orbite, éclairement, puissance, liaisons radio —, dans un répertoire horodaté et entièrement traçable. On fait varier l'orbite, et on constate directement l'effet sur les télécommunications et le système électrique.

### Diapo 5b — La digital thread et le système de templates GMAT
**[1:15]**

Deux choix d'architecture méritent d'être détaillés.

**Premier choix : la séparation satellite / mission et la digital thread.** J'ai imposé une règle stricte : la définition du satellite — sa masse, son orbite, ses surfaces, ses paramètres électriques — est une donnée de référence, immuable. La configuration de la mission — l'altitude cible, le type de propulsion, les stations sol — est une donnée d'étude, volatile. Cette séparation permet de tester des configurations de satellites qui pourrait etre fausse, par exemple mon programme n'est pas capable de calculer la nouvelle masse du satellite si nous decidions de rajouter une batterie au satellite. Le programme permet donc uniquement de tester pour un satellite donné, difference configurations orbitale. 


**Deuxième choix : le système de templates GMAT.** GMAT utilise des scripts texte. J'ai développé un mécanisme qui lit le script de référence, extrait automatiquement toutes les valeurs modifiables — altitude, excentricité, inclinaison, masse, surfaces —, les valide contre des règles de sécurité anti-injection, et les substitue par offsets de caractères dans une copie du script. Durant les premieres recheches sur l'IA, nous avions etudier la possibilité de generer les scenarios avec un LLM, mais cet idee a été abandonnee puis finalement cela demandait enormement de contexte pour des resultats peu fiable .
Nous ne pouvons donc pas tester n'importe quel scenario GMAT avec ce projet, nous sommes limité par le nombre de scénario implémenté. La logique derriere ce choix est que deja, nous n'avons pas forcement toujours besoin de tester des scenario hyper scecifique. mon maitre de stage m'a alors donné une liste de scenario qui devrait repondre à 80% des besoins. Puis, il sera egalement libre à l'utilisateur d'implementer son propre scénario GMAT, sans coder de logique spécifique.



### Diapo 5c — L'assistant IA d'analyse et la vraie cible
**[1:00]**

Le dernier élément visible est un assistant IA d'analyse. Après chaque run, l'ingénieur peut poser des questions en langage naturel : « Est-ce que mon carburant est suffisant ? », « Pourquoi la marge RF est-elle négative ? »

Pour que l'IA réponde de façon fiable, le backend génère un contexte de preuve compact — un fichier JSON qui contient les métriques clés, les verdicts, et les fichiers source correspondants. L'IA reçoit ce contexte et un prompt discipliné : citer le fichier source pour chaque affirmation, distinguer les faits des interprétations, signaler les preuves manquantes. Elle n'invente rien, elle n'exécute rien. Elle lit et elle explique.

Et ce principe va plus loin qu'un seul run : le backend sait comparer jusqu'à cinq runs simultanément. L'assistant reçoit un tableau de synthèse — altitude finale, carburant consommé, compteurs de verdicts — et l'ingénieur dispose de courbes comparatives qui superposent les évolutions temporelles des différents runs.

Mais — et c'est important — cet assistant d'analyse n'est pas l'apport IA majeur de mon projet. Il est un assistant de lecture. La vraie cible, c'est le tool calling : je suis en train de concevoir un tool déterministe, structuré, qu'un agent IA pourra appeler pour faire varier les paramètres orbitaux et répondre aux exigences de mission. Le frontend et l'assistant d'analyse m'ont permis de définir la forme de ce tool.

C'est précisément l'équilibre que je cherche : la rigueur du calcul déterministe, que l'IA appellera plutôt qu'elle n'orchestrera.

---

## Diapo 6 : Bilan & Apports
**[7:30 - 8:40]**

Sur le plan technique, ce projet m'a fait passer de la position de développeuse — celle qui implémente une feature — à celle d'architecte — celle qui conçoit un système avec ses contraintes de robustesse, de traçabilité et de maintenabilité.

J'ai développé une stack full-stack TypeScript complète : un backend Fastify avec gestion de processus externes, et un frontend React avec interface temps réel. J'ai intégré quatre outils hétérogènes — un binaire NASA, un CLI, des scripts Scilab — en un pipeline cohérent. Et j'ai conçu une approche d'IA qui assume ses limites : l'IA assiste, elle ne décide pas.

Au-delà de la technique, ce stage m'a surtout appris à naviguer l'incertitude. J'ai investi plusieurs semaines dans un agent IA qui orchestrait tout. Et j'ai fini par l'abandonner, parce que j'ai compris que la fiabilité du système primaire devait primer sur l'automatisation. C'était un pivot difficile, mais le bon.

Sur le plan humain, ce stage en Chine m'a aussi confrontée à un environnement de travail différent, dans une langue étrangère, sur un domaine que je découvrais. J'en ressors avec une vision système plus large et une confiance accrue dans ma capacité à apprendre vite.

---

## Diapo 7 : Conclusion & Perspectives
**[8:40 - 9:45]**

En conclusion, ce projet démontre qu'il est possible de construire un pont numérique fiable entre des outils d'analyse spatiale jusqu'ici isolés. Le démonstrateur fonctionne, il est testé — 96 fichiers de test backend et 17 fichiers de test frontend, validation par hash des templates GMAT — et il répond au besoin initial : produire des résultats chiffrés et traçables pour des études préliminaires.

Mais ce démonstrateur n'est qu'une étape. La perspective à court terme est l'intégration de mon outil dans un projet bien plus gros, où un agent IA utilisera le tool calling pour faire varier les paramètres orbitaux et répondre aux exigences de mission, selon le satellite défini lors de la session d'ingénierie concurrente. La première brique de comparaison multi-runs est déjà posée ; il reste à exposer le tool à l'agent et à concevoir la boucle de conseil itératif. À moyen terme, le laboratoire vise à déployer cet outil comme brique de base de sa future salle d'ingénierie concurrente augmentée.

Mon stage aura été une première pierre : prouver que la rigueur du calcul et l'assistance IA peuvent coexister, au service de l'ingénieur.

---

## Diapo 8 : Remerciements
**[9:45 - 10:00]**

Je tiens à remercier chaleureusement le Dr. Farid Gamgami pour son encadrement, toute l'équipe du laboratoire pour leur accueil, ainsi que mes tuteurs académiques, Mme Costil de l'UTBM et M. He de l'Université de Shanghai, pour leur suivi.

Je vous remercie pour votre attention. Je suis maintenant prête à répondre à vos questions.
