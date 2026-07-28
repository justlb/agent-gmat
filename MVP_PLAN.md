# Agent GMAT — plan de développement MVP

## Objectif produit

Transformer une demande en langage naturel en un script GMAT fiable en partant d'un **template de mission existant**. Le LLM doit choisir le template adapté, le copier dans l'espace de travail, puis modifier les paramètres réellement demandés.

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

Définir ensemble l'architecture minimale de la chaîne « demande utilisateur → choix du template → édition du YAML → génération et validation GMAT ». Produire un schéma et des critères de validation, sans implémenter la chaîne complète.

### MVP-1 — Connectivité LLM

Vérifier qu'une requête minimale atteint le backend LLM configuré et que la réponse est exploitable. Aucun agent GMAT ni génération de script à cette étape.

### MVP-2 — Catalogue de templates

Définir un petit catalogue de templates GMAT, avec leur objectif et les fichiers qu'ils autorisent à modifier.

### MVP-3 — Édition contrôlée d'un template

À partir d'un seul template, demander au LLM de modifier directement le YAML de mission, puis vérifier que les valeurs demandées sont présentes.

### MVP-4 — Génération et validation GMAT

Générer le script `.script` depuis le YAML modifié et valider que GMAT peut le charger ou l'exécuter.

### MVP-5 — Sélection de template

Laisser le LLM choisir le bon template parmi le catalogue, avec une trace explicite du template retenu et des modifications appliquées.
