# Workflow ephemeride -> Simu-CIC -> OPALIS + RF-COMLINK

Le lanceur `run_workflow.py` execute les quatre etapes dans l'ordre :

1. il charge `1-conversion_vers_SIMU-CIC/eph_conversion.py` et produit un
   fichier dont le nom finit par `-SIMU.txt` ;
2. il passe ce fichier a `2-run_SIMU-CIC/run_scilab_simulation.py`, puis copie
   le dossier CIC genere dans le dossier du run ;
3. il passe `CIC/Sat` a `3-run_OPALIS/opalis_pipeline.py` et sauvegarde le cas
   OPALIS calcule ainsi que son resume JSON ;
4. il passe le meme dossier `CIC/Sat` a
   `4-run_RF-COMLINK/rfcomlink_pipeline.py`, qui prepare une copie `.rfcl`
   avec les entrees geometrie CIC embarquees.

La quatrieme etape prepare le cas RF-COMLINK mais ne lance pas son calcul :
ouvrir le `.rfcl` produit dans le GUI RF-COMLINK. Utilisez `--no-rf-comlink`
pour ne produire que la branche OPALIS.

Avant le calcul, le pipeline OPALIS lit la grille temporelle des fichiers
dynamiques. Il conserve le pas d'integration du cas A (`0,5 s`), indispensable
a la stabilite de son modele thermique, sauf si une entree demande un pas plus
fin. La duree du cas A est egalement conservee lorsque les nouvelles donnees la
couvrent ; elle est seulement reduite quand les fichiers sont plus courts.

Le cas A contient 7 sections solaires. Par defaut, le pipeline genere et charge
un fichier `FLOWS-SA-n.TXT` pour chacune d'elles. Si Simu-CIC ne fournit que
`SUN_ANGLE_SA_1` et `EARTH_ANGLE_SA_1`, cette geometrie est reutilisee pour les
sections 2 a 7 et l'hypothese est inscrite dans `reused_sa_1_geometry` du JSON.
Des fichiers `SA_2`, `SA_3`, etc. seront utilises automatiquement des qu'ils
existent.

Avant le chargement, les anciennes lignes dynamiques du cas A sont supprimees.
Comme sa consommation est configuree en mode `Profile`, le profil embarque est
recale cycliquement sur les nouvelles dates et sauvegarde sous
`POWER-DISTRIBUTION-1.TXT`. Ce profil conserve sa cadence de 10 s, tandis que
le calcul interne reste au pas stable de 0,5 s du cas A.

Le cas `.opalis` de reference est copie dans le dossier du run avant ouverture,
car l'API OPALIS l'ouvre en lecture/ecriture. Le fichier original n'est jamais
modifie.

## Execution simple

Depuis la racine de ce projet :

```powershell
.\run_workflow.cmd
```

Le lanceur retrouve automatiquement Python 3, y compris l'interpreteur
embarque disponible sur cette machine. Il fonctionne meme lorsque la politique
Windows interdit l'execution des scripts PowerShell `.ps1`.

Si `run_workflow.py` est lance directement avec un autre Python (par exemple
Python 3.14), les etapes Simu-CIC et OPALIS utilisent quand meme par defaut le
Python embarque qui contient `pythonnet`. `--python` permet de remplacer ce
choix explicitement.

Le workflow verifie `pythonnet` avant de lancer Simu-CIC. Si une installation
est necessaire, la commande affichee contient le chemin absolu du bon Python et
de `3-run_OPALIS/requirements-opalis-python.txt`.

Sans argument, le workflow utilise :

- l'ephemeride source detectee dans `1-conversion_vers_SIMU-CIC` (actuellement
  `EPH_GMAT.txt`) ;
- `C:\JUSTINE\APP\SIMU_CIC\simu_cic\GUI\examples\Example_1.scd` ;
- `C:\JUSTINE\APP\OPALIS\Opalis-2.3.0\Example\cas A.opalis`.

Une autre ephemeride peut etre fournie en premier argument :

```powershell
.\run_workflow.cmd C:\chemin\vers\mon-ephemeride.txt
```

Exemple avec des options OPALIS :

```powershell
.\run_workflow.cmd .\1-conversion_vers_SIMU-CIC\EPH_GMAT.txt `
  --sections-count 4 `
  --section 0 `
  --set SimulationModel.SolarGenerator.Sections[0].NTsection=12
```

Pour preparer le cas OPALIS sans lancer son calcul, ajouter
`--no-opalis-run`. Les chemins d'installation peuvent etre remplaces avec
`--simucic-dir`, `--base-scenario`, `--opalis-dir`, `--simulation` et
`--scilab`.

Un reglage explicite conserve la priorite sur la detection automatique :

```powershell
.\run_workflow.cmd `
  --set SimulationModel.SimulationTiming.Timestep=60 `
  --set SimulationModel.SimulationTiming.Simultime=18000
```

## Sorties

Chaque execution cree un dossier unique dans `resultats_workflow` :

```text
resultats_workflow/<nom-du-run>/
|-- LISEZ-MOI.txt                       # index simple du run
|-- 00-entrees/
|   `-- ephemeride-source/<source>.txt  # copie de l'entree originale
|-- 01-conversion/
|   `-- <source>_SIMU.txt               # sortie de l'etape 1
|-- 02-simu-cic/
|   |-- 01-execution-complete/          # scenarios .sod/.scd, donnees, VTS et CIC
|   `-- 02-fichiers-cic/Sat/*.TXT       # CIC effectivement transmis a OPALIS
|-- 03-opalis/
|   |-- 00-cas-reference/cas A.opalis   # copie de travail du cas A
|   |-- 01-flux-dynamiques/FLOWS-*.TXT  # flux generes depuis CIC
|   `-- 02-resultats/
|       |-- <nom-du-run>.opalis         # resultat principal
|       `-- <nom-du-run>.json           # resume du calcul
|-- 04-rf-comlink/
|   `-- <nom-du-run>/
|       |-- <nom-du-run>.rfcl           # cas RF-COMLINK prepare
|       `-- workflow.json               # CIC et template effectivement utilises
`-- workflow.json                       # manifeste technique complet
```

`resultats_workflow/DERNIER-RUN.txt` pointe toujours vers le run le plus
recent, son guide et son dossier de resultats OPALIS.

Pour une utilisation normale, ouvrir d'abord `LISEZ-MOI.txt`, puis consulter
`03-opalis/02-resultats`. Les dossiers numerotes suivent l'ordre reel du
workflow. Les runs deja existants ne sont pas reorganises retroactivement.

Simu-CIC sauvegarde deux versions du scenario dans `02-simu-cic/01-execution-complete` :

- `run_<id>.sod`, sauvegarde binaire de la structure Scilab ;
- `run_<id>.scd`, scenario texte natif, rechargeable dans Simu-CIC.

Le workflow s'arrete des qu'une etape echoue. `workflow.json` conserve alors
le statut `failed` et le message d'erreur. Un nom explicite peut etre donne
avec `--name`; un dossier existant n'est jamais remplace.

Quand OPALIS termine mais renvoie des indicateurs `NaN`, infinis ou un taux de
completion superieur a 100 %, le run reste techniquement termine et ces
anomalies sont inscrites dans `quality_warnings` et `warnings` du manifeste.
