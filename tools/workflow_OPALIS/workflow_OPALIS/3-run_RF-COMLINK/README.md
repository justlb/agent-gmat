# Compatibilite — ancien emplacement RF-COMLINK

Le pipeline RF-COMLINK est maintenant l'etape 4 du workflow commun :
`../4-run_RF-COMLINK/`. Cet ancien dossier est conserve pour les resultats et
commandes existantes. Le script ci-dessous redirige automatiquement vers la
version canonique.

---

# Simu-CIC vers RF-COMLINK

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

Exemple :

```powershell
python .\rfcomlink_pipeline.py `
  --cic-dir '..\2-run_SIMU-CIC\resultats_simu_cic\run_xxx\CIC\Sat' `
  --name 'starlink-run-001'
```

Le résultat est créé dans `resultats_rf_comlink/<nom>/`. Ouvrir ensuite le
`.rfcl` généré dans le GUI RF-COMLINK et lancer le calcul. Aucun calcul CLI
RF-COMLINK n'est supposé par ce workflow.
