# Pilotage d'OPALIS avec Python

## Template de référence et interpolation

Le workflow utilise par défaut
`templates/cas A - interpolation lineaire.opalis`. Dans ce template, l'option
OPALIS `SimulationModel.InterpolateEphemeris` est activée. OPALIS interpole
donc linéairement les valeurs d'éphéméride manquantes pendant le calcul.
Conformément au comportement du GUI, le profil de consommation électrique
conserve son mode propre et n'est pas interpolé par cette option.

Le script `opalis_python.py` charge directement la bibliothèque .NET
`Opalis-2.3.0/lib/OpalisApi.dll`. Il fonctionne sous Windows avec Python 3.10+
et .NET Framework 4.8. Vérifiez que `py -3 --version` sélectionne bien Python
3 et non l'ancien Python 2.7.

Dans cette session, le lanceur `py -3` ne trouve pas Python 3. La commande
equivalente qui fonctionne est :

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_python.py --help
```

## Installation

```powershell
py -3 -m pip install -r requirements-opalis-python.txt
```

Si Windows refuse le chargement d'une DLL téléchargée, débloquez une fois le
dossier OPALIS :

```powershell
Get-ChildItem -Recurse '.\Opalis-2.3.0' | Unblock-File
```

## Lire une simulation

```powershell
py -3 .\opalis_python.py info '.\Opalis-2.3.0\Example\cas A.opalis'
```

Une propriété supplémentaire de l'API peut être demandée avec `--get` :

```powershell
py -3 .\opalis_python.py info '.\Opalis-2.3.0\Example\cas A.opalis' `
  --get SimulationModel.Battery.Energy
```

## Modifier et exécuter

```powershell
py -3 .\opalis_python.py run '.\Opalis-2.3.0\Example\cas A.opalis' `
  --set SimulationModel.PowerProfil.PMargin=12 `
  --set SimulationModel.SimulationInitialisation.SocBattery=0.8 `
  --save '.\resultats\cas-A-calcule.opalis' `
  --json '.\resultats\cas-A.json'
```

`--set` accepte toute propriété publique modifiable, avec son chemin complet
depuis `OpalisSimulation`. Les nombres décimaux utilisent un point.

Les elements dans les collections OPALIS peuvent etre cibles avec des crochets.
Exemple pour modifier la premiere section solaire :

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_python.py run `
  '.\resultats\cas-A-SA1-4-sections.opalis' `
  --set SimulationModel.SolarGenerator.Sections[0].NTsection=12 `
  --save '.\resultats\cas-A-SA1-4-sections-test-param.opalis'
```

## Balayer la marge de puissance

```powershell
py -3 .\opalis_python.py sweep '.\Opalis-2.3.0\Example\cas A.opalis' `
  --start 0 --stop 10 --step 1 `
  --csv '.\resultats\balayage-marge.csv'
```

Chaque essai repart du fichier source afin que l'état final d'un calcul ne
devienne pas l'état initial du suivant.

## Remplacer les éphémérides de « Generate fluxes »

Avec les fichiers placés dans `file_generate_flux`, la forme courte est :

```powershell
py -3 .\opalis_python.py generate-flux `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --section 0 `
  --inputs-dir '.\file_generate_flux' `
  --flux-output '.\resultats\FLOWS-SA-1.TXT' `
  --save '.\resultats\cas-A-SA1-nouvelles-ephemerides.opalis'
```

Ajoutez `--run` pour lancer le calcul OPALIS juste après le remplacement du
profil de flux. Le dossier `--inputs-dir` est mappé automatiquement vers :

- `Sat_SUN_ANGLE_SA_1.TXT`
- `Sat_SATELLITE_ECLIPSE.TXT`
- `Sat_SATELLITE_ECLIPSE_MOON.TXT`
- `Sat_EARTH_ANGLE_SA_1.TXT`
- `Sat_SATELLITE_ALTITUDE.TXT`
- `Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT`
- `Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT`
- `Sat_GEOGRAPHICAL_COORDINATES.TXT`

La commande suivante reproduit le calcul du dialogue **Generate fluxes**,
affecte le profil généré à la première section solaire du cas exemple, puis
sauvegarde un nouveau cas sans écraser l'original :

```powershell
py -3 .\opalis_python.py generate-flux `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --section 0 `
  --sun-angle '.\ephemerides\sun-angle-sa-1.mem' `
  --eclipse '.\ephemerides\satellite-eclipse.mem' `
  --earth-angle '.\ephemerides\earth-angle-sa-1.mem' `
  --altitude '.\ephemerides\satellite-altitude.mem' `
  --earth-direction '.\ephemerides\earth-direction-satellite-frame.mem' `
  --sun-direction '.\ephemerides\sun-direction-satellite-frame.mem' `
  --coordinates '.\ephemerides\geographical-coordinates.mem' `
  --flux-output '.\resultats\fluxes-sa-1.mem' `
  --save '.\resultats\cas-A-nouvelles-ephemerides.opalis' `
  --run
```

Ajoutez `--moon-eclipse chemin.mem` si l'éclipse lunaire doit être prise en
compte. L'index `--section` commence à zéro : `0` est la section 1 dans
l'interface, `1` la section 2, etc. Pour plusieurs sections, relancez la
commande pour chaque section en repartant du dernier fichier `.opalis` produit.

## Reduire le nombre de sections solaires

Pour repartir du cas genere et garder seulement les 4 premieres sections :

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_python.py resize-sections `
  '.\resultats\cas-A-SA1-nouvelles-ephemerides.opalis' `
  --count 4 `
  --save '.\resultats\cas-A-SA1-4-sections.opalis' `
  --json '.\resultats\cas-A-SA1-4-sections.json'
```

## Pipeline automatique complet

Le script `opalis_pipeline.py` orchestre la chaine complete :

1. lecture du dossier d'ephemerides ;
2. mapping vers les entrees attendues par Generate fluxes ;
3. generation du fichier `FLOWS-SA-*.TXT` ;
4. modification des parametres utilisateur avec `--set` ;
5. lancement du calcul OPALIS ;
6. sauvegarde du `.opalis` et du JSON de resultats.

Si le fichier de simulation n'est pas indique, le pipeline charge directement
`Opalis-2.3.0/Example/cas A.opalis`. Une copie de travail est creee dans le
dossier de sortie afin de ne jamais modifier l'exemple original.

Le pas et la duree sont synchronises automatiquement avec les fichiers de flux
dynamiques :

- la cadence CIC est calculee a partir des colonnes MJD et secondes UTC ;
- le pas OPALIS conserve la valeur du cas A, car il pilote aussi l'integration
  thermique ; il n'est reduit que si une entree dynamique exige plus fin ;
- la duree du cas A est conservee si les flux la couvrent et seulement reduite
  si leur plage commune est plus courte ;
- les valeurs detectees et les grilles de chaque fichier sont enregistrees
  dans `automatic_timing` du JSON de sortie.

Le remplacement dynamique reproduit aussi les affectations du GUI :

- les 8 fichiers geometriques CIC sont places dans leurs types
  `FlowsManagerApi` respectifs ;
- un `FLOWS-SA-n.TXT` a 6 colonnes est genere et charge dans chaque section du
  cas A ;
- les anciennes lignes `RawEphemeris` du cas A sont retirees ;
- le profil de puissance consommee embarque dans le cas A est recale sur la
  nouvelle plage temporelle et recharge avec `LoadPowerFile` ;
- le JSON consigne les fichiers utilises, les replis sur `SA_1`, le nombre de
  lignes retirees/ajoutees et le profil de puissance genere.

Par defaut, toutes les sections sont chargees. `--section 0` permet encore de
limiter explicitement l'operation a la premiere section, mais cela ne convient
que si le modele OPALIS a lui-meme une seule section ou si les autres profils
sont geres separement.

La commande minimale, depuis `3-run_OPALIS`, est donc :

```powershell
python .\opalis_pipeline.py `
  --ephemeris-dir C:\chemin\vers\CIC\Sat
```

`--time-step 60` force un pas particulier. `--no-auto-time-step` conserve le
pas du cas A et `--no-auto-duration` conserve sa duree. Les affectations
`--set SimulationModel.SimulationTiming...` sont appliquees en dernier et ont
donc toujours priorite.

Exemple teste :

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_pipeline.py `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --ephemeris-dir '.\file_generate_flux' `
  --sections-count 4 `
  --section 0 `
  --set SimulationModel.SolarGenerator.Sections[0].NTsection=12 `
  --output-dir '.\resultats\pipeline-test' `
  --name 'cas-A-pipeline-test'
```

Les sorties produites sont :

- `00-cas-reference/cas A.opalis`, la copie de travail du cas de reference ;
- `01-flux-dynamiques/FLOWS-SA-1.TXT`, le profil de flux genere ;
- `02-resultats/cas-A-pipeline-test.opalis`, le cas modifie et calcule ;
- `02-resultats/cas-A-pipeline-test.json`, le resume des entrees, parametres
  appliques et resultats OPALIS.

Exemple avec les ephemerides CIC `2304` :

```powershell
C:\Users\justine\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\opalis_pipeline.py `
  '.\Opalis-2.3.0\Example\cas A.opalis' `
  --ephemeris-dir 'C:\JUSTINE\APP\SIMU_CIC\simu_cic\result\2304\CIC\Sat' `
  --sections-count 4 `
  --section 0 `
  --output-dir '.\resultats\pipeline-2304' `
  --name 'cas-A-2304-4-sections'
```

Pour preparer le cas sans lancer le calcul, ajoutez `--no-run`.
