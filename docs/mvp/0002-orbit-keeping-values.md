# MVP-2b — Valeurs orbit-keeping et rendu déterministe

Statut : terminé

Le script GMAT de référence reste immuable. Le fichier `orbit_keeping.values.yaml` contient 193 emplacements de valeurs avec leur contexte GMAT. Le renderer accepte uniquement ce même ensemble d'emplacements et rejette un YAML incomplet, invalide ou dont le contexte ne correspond plus au template.

## Essai manuel sous WSL

Copier les valeurs de référence avant modification :

```bash
cp workflow_agents/gmat_skills/orbit-keeping-template/references/orbit_keeping.values.yaml /tmp/orbit-keeping.values.yaml
```

Modifier des champs `value` dans la copie, puis rendre le script :

```bash
node --import tsx scripts/render_orbit_keeping_values.mts \
  --values /tmp/orbit-keeping.values.yaml \
  --output /tmp/mission.script
```

Le renderer ne contacte aucun LLM et n'exécute pas GMAT.
