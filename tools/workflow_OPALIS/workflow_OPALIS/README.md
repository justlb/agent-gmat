# Workflow actif : GMAT -> Simu-CIC -> OPALIS

Le workflow web orchestre les trois etapes separees ci-dessous. Les scripts
restent ici comme adaptateurs techniques ; ils ne doivent pas etre lances via
un orchestrateur global dans ce repertoire.

1. `1-conversion_vers_SIMU-CIC/eph_conversion.py` convertit l'ephemeride OEM
   GMAT en fichier utilisable par Simu-CIC.
2. `2-run_SIMU-CIC/run_scilab_simulation.py` lance Simu-CIC avec un
   `--save-root` obligatoire, fourni par le backend.
3. `3-run_OPALIS/opalis_pipeline.py` prepare et execute le scenario OPALIS
   depuis les fichiers CIC et la definition du satellite.

Toutes les sorties d'une mission sont rangees exclusivement dans :

```text
data/user/default/gmat/mission-runs/<run-id>/opalis/
|-- 01-conversion_vers_SIMU-CIC/
|-- 02-simu-cic/
`-- 03-opalis/
```

Les anciens lanceurs manuels, sorties d'exemple et prototypes RF-COMLINK sont
conserves sous `archive/legacy/` et ne font pas partie du workflow actif.
