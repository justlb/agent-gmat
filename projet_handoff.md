# Agent GMAT — handoff MVP

## Objectif produit

Créer un agent capable de générer un fichier GMAT `.script` à partir d’une demande utilisateur.

Le système ne doit pas générer une mission arbitraire. Il doit partir d’un template GMAT fixe, puis modifier ses valeurs selon la demande :

- masse sèche ;
- masse de carburant ;
- aire de traînée ;
- altitude minimale ;
- paramètres orbitaux Keplerian ;
- et toute autre valeur déjà présente dans le template.

Exemple :

> Change dry mass to 200 kg, drag area to 10 m2, and minimum altitude to 210 km.

Le résultat doit être un nouveau `values.yaml` et un nouveau `.script`, sans modifier la structure du template.

## Principes d’architecture

- Un unique appel LLM par demande utilisateur.
- Le LLM ne corrige pas les erreurs et ne relance jamais une génération.
- Le LLM retourne uniquement un patch YAML de valeurs.
- Toute la suite est déterministe :
  - validation ;
  - application des changements ;
  - rendu du `.script` ;
  - sauvegarde des artefacts.
- Le LLM ne choisit pas encore de template : MVP actuel = un unique template `orbit-keeping`.
- Le template actuel reste Keplerian. Les demandes de conversion Cartesian sont hors périmètre ; un futur template Cartesian distinct sera nécessaire.

## Pipeline implémentée

```text
Demande utilisateur
  → LLM : retourne seulement des changements YAML
  → validation des identifiants et des valeurs
  → values.yaml modifié
  → renderer déterministe
  → mission.script

  Les composants existants sont dans backend/src/gmat/ :
orbitKeepingTemplate.ts
localisation et copie déterministe du template de référence ;

orbitKeepingValues.ts
extraction des 193 valeurs modifiables ;
lecture/validation du YAML ;
application des changements ;
rendu déterministe du script ;

orbitKeepingLlmEdit.ts
un appel HTTP au modèle ;
demande une réponse YAML stricte ;
aucun retry ;

backend/scripts/edit_orbit_keeping_with_llm.mts
CLI permettant de tester le flux complet ;
écrit par défaut les résultats dans data/output_data/.

Template de référence :
backend/workflow_agents/gmat_skills/orbit-keeping-template/references/orbit_keeping.script
Valeurs de référence :
backend/workflow_agents/gmat_skills/orbit-keeping-template/references/orbit_keeping.values.yaml
État vérifié
Les tests suivants ont déjà réussi sous WSL :
node --import tsx --test \
  tests/gmat/orbitKeepingTemplate.test.ts \
  tests/gmat/orbitKeepingValues.test.ts \
  tests/gmat/orbitKeepingLlmEdit.test.ts

npm run build
Un test réel du LLM a aussi confirmé qu’un appel unique modifie bien des valeurs demandées, notamment DryMass, DragArea et minAltitude.
Prochain MVP : connecter la pipeline au frontend
Le frontend ne doit pas appeler le LLM directement : il n’a pas accès à la clé API ni au système de fichiers serveur.
Architecture cible :
Chat frontend, mode « GMAT Orbit Keeping »
  → POST /api/gmat/orbit-keeping/generate
  → service backend GMAT
      → un appel LLM
      → renderer déterministe
      → fichiers dans le workspace utilisateur
  → réponse JSON
  → affichage des changements et téléchargement du script
Le projet thermal utilise le système d’agent géré général (/api/run/managed/dispatch). Ce mécanisme peut lancer plusieurs appels LLM, donc il ne convient pas à cette pipeline GMAT déterministe.
Le frontend doit réutiliser le chat existant, mais ajouter un mode explicite :
General | GMAT Orbit Keeping
General : comportement actuel, agent géré.
GMAT Orbit Keeping : appelle l’API GMAT dédiée.
Le choix explicite évite un appel LLM de routage.
Étapes restantes
1. Créer le service GMAT
Créer :
backend/src/gmat/orbitKeeping.service.ts
Responsabilités :
charger le YAML de référence ;
appeler editOrbitKeepingValuesWithLlm() une seule fois ;
écrire le YAML modifié ;
appeler renderOrbitKeepingFromValues() ;
retourner les chemins, changements et latence.
Tests :
un appel LLM unique, YAML et .script produits ;
erreur LLM : aucun retry et aucun fichier produit.
2. Ajouter la route HTTP
Créer :
POST /api/gmat/orbit-keeping/generate
Entrée :
{
  "request": "Change dry mass to 200 kg and drag area to 10 m2."
}
Sortie :
{
  "changes": [],
  "latencyMs": 0,
  "scriptPath": "...",
  "valuesPath": "..."
}
Les artefacts doivent être écrits dans le workspace utilisateur, jamais dans un dossier partagé. Le dossier data/output_data/ reste réservé aux essais CLI locaux.
3. Ajouter les validations déterministes
À couvrir :
identifiant de slot inconnu ;
identifiant dupliqué ;
YAML LLM invalide ;
valeur avec retour à la ligne ou ; ;
erreur HTTP LLM ;
aucune nouvelle tentative LLM.
4. Connecter le frontend
Modifier le chat existant :
ajouter un sélecteur de mode ;
ajouter un client HTTP GMAT ;
en mode GMAT, envoyer le prompt à l’API dédiée ;
afficher les changements acceptés, l’état de chargement, les erreurs et un lien vers le .script.
5. Test d’intégration réel
Demande de test :
Change dry mass to 200 kg, drag area to 10 m2, and minimum altitude to 210 km.
Vérifier :
une seule requête au modèle ;
trois changements dans le YAML ;
trois changements dans le script ;
structure du template inchangée ;
artefacts dans le workspace utilisateur.
Commande WSL d’installation
Si node_modules a été créé sous Windows, le recréer sous WSL :
cd /mnt/c/JUSTINE/APP/AGENT_GITHUB/open_codex_web-master/backend
rm -rf node_modules
npm ci --registry=https://registry.npmmirror.com --no-audit --proxy=null --https-proxy=null
Git
Dépôt distant :
https://github.com/justlb/agent-gmat
Branche actuelle : main.
Dernier commit connu :
2b5c8ce feat: add one-call LLM orbit keeping value editor
# GMAT run execution and contextual analysis

The orbit-keeping frontend flow now creates an immutable timestamped run and, when
`tools.gmat.bin` is configured, executes `GmatConsole.exe --run <script>`.

Each new run contains:

- `orbit_keeping.script`
- `orbit_keeping.values.yaml`
- `gmat.log`
- `ReboostReport.txt` when GMAT produces it
- `gmat_result.json`
- `run_manifest.json`
- `conversation.json` after the first question about the saved run

The frontend `Files` panel groups these files by run. Selecting **Discuss this
run** binds subsequent GMAT chat messages to the saved run and calls
`POST /api/gmat/orbit-keeping/analyze`; this analysis does not execute GMAT
again. Selecting **New GMAT run** clears that context so the next GMAT message
creates and executes a new run.

The first normalized result contract is intentionally limited to the values
available in `ReboostReport.txt`: reported altitude extrema, final reported
altitude/fuel/epoch, report sample count, and fuel difference between the first
and last report rows. These are named “reported” metrics because the current
template does not yet export a continuous orbit timeline.
