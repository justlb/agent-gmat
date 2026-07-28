# ADR-0001 — Génération déterministe d'un script GMAT orbit keeping

Statut : accepté pour le MVP-0

## Contexte

Le produit doit adapter une mission GMAT d'orbit keeping à une demande en langage naturel. Toutes les missions produites doivent conserver la forme du script `AutonomousLEOReboost` fourni comme référence : même organisation générale, mêmes ressources GMAT et même séquence de mission.

Les valeurs doivent toutes pouvoir évoluer, notamment l'orbite initiale, l'orbite cible, l'altitude minimale, les masses, les surfaces, les paramètres atmosphériques, le propagateur, le solveur, les burns, les seuils, les durées et les sorties.

Les appels LLM sont lents. Le projet doit donc utiliser un seul appel LLM par demande et rester déterministe pour toutes les autres étapes. Le LLM ne doit pas corriger les erreurs rencontrées.

## Décision

La chaîne initiale utilise un seul template de mission : `orbit_keeping`.

Le template est composé de deux fichiers complémentaires :

- `orbit_keeping.script.hbs` contient la structure GMAT fixe issue du script de référence ;
- `orbit_keeping.values.yaml` contient toutes les valeurs remplaçables du script.

Le déroulement d'une génération est strictement linéaire :

1. le backend copie le fichier de valeurs par défaut dans un workspace d'exécution isolé ;
2. un unique appel LLM reçoit la demande, le fichier de valeurs et des instructions lui interdisant de modifier autre chose ;
3. le fichier YAML retourné est parsé et validé sans nouvel appel LLM ;
4. le moteur de template produit `mission.script` de façon déterministe ;
5. le workflow publie le script, le diff des valeurs et, en cas d'échec, une erreur structurée.

Une erreur de syntaxe YAML, une valeur absente ou un rendu impossible arrête la génération. Il n'existe aucune boucle de réparation automatique par le LLM.

## Responsabilités

### LLM

- interpréter la demande utilisateur ;
- modifier uniquement les valeurs du fichier YAML de travail ;
- effectuer toutes les modifications demandées pendant l'unique appel.

### Code déterministe

- préparer le workspace et copier les valeurs par défaut ;
- parser et valider le YAML ;
- calculer le diff avec les valeurs par défaut ;
- rendre le template en mode strict ;
- écrire atomiquement `mission.script` ;
- retourner une erreur sans tenter de la corriger.

### Template orbit keeping

- conserver la structure du script de référence ;
- exposer chaque valeur littérale utile sous un nom explicite ;
- ne contenir aucune décision métier dynamique cachée dans le renderer.

## Choix techniques minimaux

- TypeScript, dans le backend existant ;
- paquet `yaml` pour lire et écrire les valeurs ;
- Handlebars en mode strict pour rendre le fichier texte GMAT ;
- aucune exécution de GMAT dans le périmètre actuel ;
- aucun générateur GMAT générique et aucun planificateur de manœuvres.

Le projet `open_codex_web-master6` peut fournir des noms de propriétés GMAT et des exemples de sortie. Son orchestrateur, sa pipeline de correction et son générateur généraliste ne sont pas repris sans validation indépendante.

## Invariants vérifiables

1. Une demande déclenche au maximum un appel LLM.
2. Le renderer ne contacte jamais un modèle.
3. Les valeurs par défaut produisent un script équivalent au script de référence.
4. Changer une valeur YAML modifie uniquement les emplacements correspondants du `.script`.
5. Une clé manquante provoque une erreur explicite en mode strict.
6. Le workflow ne lance pas GMAT et ne répare pas automatiquement les erreurs.

## Étape suivante

Le MVP-1 vérifie uniquement la connectivité au LLM configuré avec une requête minimale et observable. Il n'intègre pas encore le template GMAT.
