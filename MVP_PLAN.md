# Agent GMAT — plan de développement MVP

## Objectif produit

Transformer une demande en langage naturel en un script GMAT d'orbit keeping fiable, en conservant exactement la structure d'un **template de script de référence**. Le LLM est utilisé une seule fois pour modifier les valeurs du template. La génération du fichier `.script` est ensuite déterministe.

## Méthode de travail

Le projet avance par MVP courts et vérifiables :

1. Définir une capacité unique et observable.
2. Écrire ou lancer un probe/test minimal.
3. Implémenter seulement ce qui est nécessaire.
4. Vérifier le résultat.
5. Créer un commit Git descriptif.

Les commits sont gérés par Codex sur ce dépôt. Les fichiers de configuration locale et secrets ne sont pas versionnés.

## Références et décisions d'architecture

Le projet `C:\JUSTINE\APP\AGENT_GITHUB\open_codex_web-master` est la source de vérité : les décisions, le code et les tests utiles y sont construits puis versionnés.

Le projet `C:\JUSTINE\APP\AGENT_GITHUB\open_codex_web-master6` peut être consulté comme référence pour comprendre une idée, un flux ou une intégration existante. Il n'est pas considéré comme fiable : toute logique reprise doit être relue, simplifiée si nécessaire et validée par un test dans le nouveau projet.

Avant chaque MVP qui touche à l'architecture, nous discutons et consignons :

1. le problème à résoudre et le résultat observable ;
2. les composants concernés et leurs responsabilités ;
3. les entrées, sorties et critères de validation ;
4. la plus petite expérimentation permettant de confirmer le choix.

## Feuille de route

### MVP-0 — Cadrage de l'architecture

Définir l'architecture minimale de la chaîne « demande utilisateur → édition unique des valeurs → rendu déterministe du template orbit keeping → fichier `.script` ». Produire une décision d'architecture et des critères de validation, sans implémenter la chaîne complète.

### MVP-1 — Connectivité LLM — terminé

Vérifier qu'une requête minimale atteint le backend LLM configuré et que la réponse est exploitable. Aucun agent GMAT ni génération de script à cette étape.

### MVP-2 — Template et rendu déterministe

Transformer le script orbit-keeping de référence en template à structure fixe, extraire toutes ses valeurs modifiables et produire un `.script` identique avec les valeurs par défaut.

### MVP-3 — Édition contrôlée en un appel

Demander au LLM de modifier uniquement le fichier de valeurs du template, en un seul appel et sans boucle de correction. Vérifier ensuite les changements de façon déterministe.

### MVP-4 — Intégration au workflow du projet

Brancher la chaîne validée au workflow du projet et exposer le `.script`, le diff des valeurs et les erreurs déterministes comme artefacts.

### Hors périmètre actuel

L'exécution du script dans GMAT, la correction automatique des erreurs, la planification de manœuvres et la sélection entre plusieurs types de missions ne font pas partie des premiers MVP.
