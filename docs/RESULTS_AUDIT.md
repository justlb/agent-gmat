# Audit de finalisation : résultats, chatbot et nettoyage

Date : 6 septembre 2026.

## Périmètre et limites

Audit statique ciblé de la page Results, des graphiques, de la conversation, des routes et du contexte d'analyse, avec inspection de l'organisation du dépôt. Ce document constitue le plan de finalisation demandé ; aucune suppression ni refonte fonctionnelle n'a été réalisée. Il ne certifie pas l'absence de code mort dans tout le projet. Aucune inspection visuelle de l'application ni évaluation avec un modèle réel n'a été effectuée.

Modifications déjà présentes à préserver : backend/src/opalis/opalisResults.ts, backend/src/runs/runViewModel.ts, frontend/src/pages/agent/MissionOverview.tsx, frontend/src/pages/agent/runViewApi.ts ; nouveaux tests opalisAssessment.test.ts et MissionOverview.test.tsx ; cache backend/tsconfig.tsbuildinfo.

## Ce qui fonctionne déjà dans la conception

- La page sélectionne ensemble le résumé, les graphiques et la discussion d'une exécution.
- ResultsDiscussion est remonté avec une clé runPath ; une réponse tardive ne doit pas contaminer une autre sélection. Un test couvre ce scénario.
- POST /api/runs/analysis contourne le routeur d'intentions et analyse uniquement l'exécution sélectionnée. Il ne lance pas de simulation.
- Le contexte rassemble GMAT, Simu-CIC, OPALIS et RF-COMLINK, avec références aux fichiers et données manquantes.
- Le prompt demande de distinguer faits et interprétations, de citer les sources et de répondre dans la langue de la question.
- Les conversations utilisent la persistance atomique existante. Le succès complet exige les quatre étapes terminées.

## Constats et priorités

| Priorité | Constat vérifié | Action proposée |
| --- | --- | --- |
| Haute | runResultsApi.ts déduit altitudeKm de semiMajorAxisKm - 6378.1363 si l'altitude manque ; electricSamples fait la même conversion. | Identifier explicitement cette grandeur comme dérivée du demi-grand axe ; pour une altitude instantanée, utiliser une distance radiale disponible. Tester une orbite non circulaire. |
| Haute | runAnalysisLlm.ts demande des citations mais retourne seulement un texte libre ; aucune validation structurée des références. | Retourner des références structurées liées à un catalogue de preuves autorisées, puis afficher des sources ouvrables. La validité du chemin ne suffit pas à prouver une conclusion : conserver une évaluation des réponses. |
| Haute | Le manifeste et toute la conversation sont réinjectés à chaque question, sans budget de contexte explicite. | Limiter le contexte, garder les derniers échanges et un résumé de conversation ; conserver séparément l'historique intégral. Prioriser les preuves pertinentes. |
| Moyenne | Le frontend attend une réponse complète ; aucun bouton d'annulation ni flux progressif dans ce parcours. | Ajouter affichage progressif, annulation et reprise contrôlée. Prévoir des identifiants de requête pour éviter les doublons après une réponse perdue. |
| Moyenne | L'analyse des résultats est enregistrée avec channel: gmat-draft ; le chargement restitue aussi les discussions préparatoires. | Introduire un canal results-analysis, garder la compatibilité des archives et différencier préparation et analyse dans l'interface. |
| Moyenne | ResultsDiscussion utilise ReactMarkdown sans remark-gfm. | Réutiliser les capacités Markdown existantes pour les tableaux ; ajouter copier la réponse et suggestions contextuelles. |
| Moyenne | La page recharge la liste toutes les cinq secondes, même sans exécution active. | Espacer les vérifications au repos, les suspendre quand la page est masquée, conserver Refresh et la détection de nouvelles exécutions. |
| Moyenne | Chaque question régénère le contexte et relit les sorties, notamment CIC. | Mettre en cache selon une version ou empreinte des artefacts ; invalider pendant l'avancement du workflow. Ne pas réutiliser un contexte périmé. |
| Moyenne | SelectedResults ne réactive pas loading lors d'un rafraîchissement ; les anciennes données restent visibles pendant le rechargement. | Distinguer chargement initial, actualisation et données périmées ; afficher la fraîcheur du résumé et des courbes. |
| Moyenne | La comparaison se fonde uniquement sur templateId et superpose les courbes. | Montrer les différences de configuration, unités et durées ; ajouter les écarts chiffrés pertinents. Le chatbot ne reçoit actuellement pas la seconde exécution. |

## Expérience cible

1. Un résumé initial : état de la chaîne, objectifs atteints ou non évaluables, alertes et indicateurs clés avec unités et sources.
2. Des détails par outil et des graphiques sélectionnables, avec valeurs au survol et export des données ; conserver les données indisponibles comme telles.
3. Un assistant proposant « Résumer cette simulation », « Expliquer les alertes » et « Quelles données manquent ? ». Pour une comparaison, transmettre explicitement les deux exécutions et identifier la provenance de chaque conclusion.
4. Des réponses courtes organisées en constat, explication, preuves et limites. Les chiffres viennent des résultats déterministes ; le modèle sert à les expliquer.
5. Sur petit écran, un accès direct à la discussion, plutôt que de devoir parcourir toute la page pour atteindre le panneau placé après les résultats.

## Nettoyage et simplification

### Candidats observés, à traiter selon leur nature

- backend/tsconfig.tsbuildinfo : cache généré non suivi ; candidat au nettoyage et à une règle *.tsbuildinfo dans .gitignore.
- archive/legacy : les seuls fichiers trouvés lors de l'inspection sont deux caches Python ; vérifier l'inventaire final et les références documentaires avant suppression des répertoires.
- package-lock.json à la racine : packages est vide et aucun package.json racine n'a été trouvé. Candidat probable au retrait après vérification des scripts. Conserver les lockfiles frontend et backend.
- tmp : contient des inspections RF/OPALIS, mais aussi un script et des rendus de rapport de stage. Ne pas assimiler tout ce dossier à des déchets ; isoler les livrables et références avant nettoyage.
- reports/gmat-batch-60s.json et .md : rapports suivis par Git, potentiellement preuves de validation. Les conserver ou les archiver explicitement.
- node_modules et dist : sorties reproductibles, pas du code mort. Leur suppression ne simplifie pas l'architecture et peut empêcher une validation hors ligne.
- data, outils et modèles de workflow : ressources utilisées indirectement par configuration, chemins ou processus externes. L'absence d'import TypeScript ne prouve pas leur inutilité.

### Simplifications ciblées

- Extraire ResultCharts et ses fonctions pures de GmatAnalysisPanel.tsx. Aucune utilisation du composant exporté GmatAnalysisPanel n'a été trouvée dans frontend/src ; son fichier reste utilisé pour ResultCharts. Vérifier les références complètes avant de retirer l'ancien panneau.
- Réutiliser requestApiJson au lieu du client local de runResultsApi, en préservant cache: no-store et les messages utiles lorsque le serveur retourne autre chose que du JSON.
- Mutualiser le décodage responseText, présent dans sept fichiers backend, après comparaison des variantes ; garder les prompts métier spécifiques.
- Décomposer les longues lignes JSX et les effets asynchrones de ResultsPage et ResultsDiscussion en fonctions lisibles. Un hook de discussion peut regrouper chargement, envoi, erreur et annulation.
- Ajouter des commentaires anglais sur les invariants : isolation par exécution, provenance, unités, contexte périmé, annulation, compatibilité des anciens fichiers. Éviter de commenter chaque instruction évidente.
- Reporter la décomposition des gros modules hors périmètre, comme ComplianceCheckPanel.tsx (~148 Ko) et AgentPage.tsx (~77 Ko), à une intervention distincte si elle est réellement nécessaire.

## Ordre de réalisation et critères de sortie

1. Stabiliser l'environnement de validation Windows et obtenir une référence des tests existants, en préservant les modifications locales.
2. Nettoyer les seuls artefacts identifiés, extraire les graphiques et mutualiser les utilitaires ; vérifier les imports, la compilation et les tests ciblés après chaque lot.
3. Corriger la provenance des grandeurs, introduire des sources structurées et borner le contexte du chatbot.
4. Ajouter suggestions, reprise, annulation et affichage progressif ; clarifier les erreurs de chargement d'historique et d'envoi.
5. Finaliser le résumé, les comparaisons et l'affichage mobile ; commenter en anglais les modules touchés.

Validation attendue : aucune modification des entrées de mission et aucun lancement d'outil depuis le chatbot ; isolation entre exécutions même avec réponse tardive ; preuves absentes explicitement signalées ; citations résolues dans la bonne exécution ; gestion d'un historique long, d'un délai dépassé, d'un échec réseau et de répétitions ; comparaison sans mélange de sources ; conservation des comportements métier existants.

Préparer un petit corpus de questions sur des exécutions connues (succès, échec, résultats partiels, preuve manquante, orbite elliptique, comparaison), avec faits attendus vérifiés. Les tests avec réponse de modèle simulée ne mesurent pas la qualité réelle de l'assistant.

## Vérifications effectuées

Inspection du code et lecture des tests existants, sans modification fonctionnelle. Tentatives :

- Frontend : ResultsPage.test.tsx, runResultsApi.test.ts et MissionOverview.test.tsx. Démarrage bloqué par le module natif manquant @rollup/rollup-win32-x64-msvc.
- Backend : runAnalysisContext.test.ts, runResults.routes.test.ts et runResults.test.ts. Démarrage bloqué dans tsx par uv_os_get_passwd / ENOMEM.

Ces erreurs surviennent avant les assertions ; elles ne démontrent pas des régressions métier. Aucun résultat de test passant n'est revendiqué.
