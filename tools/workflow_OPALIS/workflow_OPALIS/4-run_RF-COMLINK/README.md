# Etape 4 — Simu-CIC vers RF-COMLINK

`rfcomlink_pipeline.py` prépare un cas `.rfcl` à partir du dossier `CIC/Sat`
produit par Simu-CIC. Le template n'est jamais modifié : une copie est créée
avec les entrées CIC embarquées dans l'archive RF-COMLINK.

Les trois entrées géométriques obligatoires sont injectées dans chaque lien :

- `Sat_DISTANCE_GROUND_STATION_1.TXT` → `RangeFile` ;
- `Sat_SATELLITE_DIRECTION-GROUND_STATION_1_FRAME.TXT` → `SatelliteDirectionFile` ;
- `Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_1.TXT` → `VisibilityFile`.

Si `PAYLOAD_DATA_RATE.TXT` existe, il est également injecté dans les liens de
télémesure. Le script accepte les variantes historiques du nom de fichier de
direction générées par Simu-CIC.

Lance normalement depuis `..\\run_workflow.py`. Pour tester uniquement cette
etape sur un dossier `CIC\\Sat` deja produit, utilisez :

```powershell
python .\rfcomlink_pipeline.py `
  --cic-dir '..\2-run_SIMU-CIC\resultats_simu_cic\run_xxx\CIC\Sat' `
  --name 'starlink-run-001'
```

Le résultat est créé dans `resultats_rf_comlink/<nom>/` (ou dans
`04-rf-comlink/<nom>/` quand il est appelé par le workflow global). Ouvrir ensuite le
`.rfcl` généré dans le GUI RF-COMLINK et lancer le calcul. Aucun calcul CLI
RF-COMLINK n'est supposé par ce workflow.
