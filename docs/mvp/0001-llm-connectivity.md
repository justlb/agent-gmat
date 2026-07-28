# MVP-1 — Connectivité LLM

Statut : terminé

## Objectif

Vérifier qu'une requête minimale atteint le modèle configuré et retourne du texte exploitable, sans démarrer le backend, un agent ou une chaîne GMAT.

## Implémentation

Le script `scripts/check_chat_model_endpoint.mjs` :

- lit `chatModel` depuis `config.json` ou les variables d'environnement prévues par le projet ;
- envoie exactement une requête `POST` vers l'API Responses ;
- limite la réponse à 16 tokens ;
- ne tente ni `/models`, ni retry, ni correction ;
- n'affiche jamais la clé API ;
- retourne un code de sortie non nul en cas d'erreur.

Commande depuis la racine du projet, sous WSL :

```bash
node scripts/check_chat_model_endpoint.mjs --json
```

Une configuration extérieure peut être utilisée temporairement sans être copiée :

```bash
node scripts/check_chat_model_endpoint.mjs --config /chemin/vers/config.json --json
```

## Vérifications

- quatre tests unitaires passent ;
- le test compte une seule requête sur le chemin de succès ;
- le test compte une seule requête sur le chemin d'erreur ;
- le résultat ne contient pas la clé API ;
- un probe réel a retourné `GMAT_PROBE_OK` en un seul appel.

La configuration utilisée pour le probe réel est restée locale et n'est pas versionnée.

## Conclusion

La connexion au LLM est opérationnelle. Le MVP suivant peut construire et tester le rendu déterministe du template orbit-keeping sans aucun appel LLM.
