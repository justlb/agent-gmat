# Contrat d'entree OPALIS

Ce document definit les seules sources autorisees pour une execution OPALIS.
Une execution est associee a **une run GMAT** et ne melange jamais des donnees
d'une autre run ou d'un autre satellite.

```text
satellite.json de la run ─┐
                           ├─> adaptateur OPALIS ─> parametres statiques du cas .opalis
CIC/Sat de Simu-CIC ──────┘                         + flux dynamiques
```

## 1. Source dynamique : fichiers CIC de Simu-CIC

Le dossier d'entree est obligatoirement celui produit pour la run :

```text
<run>/opalis/02-simu-cic/02-fichiers-cic/Sat/
```

Ces fichiers ne sont pas remplaces par des valeurs de `satellite.json`. Ils
decrivent la geometrie et varient avec le temps.

| Donnee OPALIS | Fichier CIC attendu | Statut |
|---|---|---|
| angle Soleil de chaque section | `Sat_SUN_ANGLE_SA_<n>.TXT` | requis ; repli explicite SA_1 autorise |
| eclipse Terre | `Sat_SATELLITE_ECLIPSE.TXT` | requis |
| eclipse Lune | `Sat_SATELLITE_ECLIPSE_MOON.TXT` | facultatif |
| angle Terre de chaque section | `Sat_EARTH_ANGLE_SA_<n>.TXT` | requis ; repli explicite SA_1 autorise |
| altitude | `Sat_SATELLITE_ALTITUDE.TXT` | requis |
| direction Terre dans le repere satellite | `Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT` | requis |
| direction Soleil | `Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT`, sinon `Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT` | requis |
| coordonnees geographiques | `Sat_GEOGRAPHICAL_COORDINATES.TXT` | requis |

Le pipeline existant produit un `FLOWS-SA-<n>.TXT` pour chaque section solaire
OPALIS a partir de ces fichiers. Le manifeste doit signaler tout repli de
geometrie de SA_1 vers une autre section.

## 2. Source statique : satellite.json

Le fichier retenu est le snapshot de la run :

```text
<run>/satellite.json
```

Pour les runs anciennes, `satellite.digital-thread.json` est accepte comme
compatibilite de lecture. La bibliotheque satellite elle-meme ne constitue pas
une entree directe : ses valeurs doivent deja avoir ete copiees dans le
`satellite.json` de la run.

Les champs ci-dessous sont les entrees OPALIS. Ils reconstruisent toutes les
valeurs du premier onglet du cas `.opalis` a partir de `empty.opalis`; les
fichiers embarques, flux et resultats du cas de reference sont exclus. Les
valeurs sont configurees une fois avant le calcul et tracees dans
`opalis-parameters.json`.

| Donnee | Chemin dans satellite.json | Unite | Requis | Cible OPALIS attendue |
|---|---|---:|---|---|
| nom du satellite | `satellite.identity.name` | texte | non | `SimulationModel.PowerProfil.SatelliteName` |
| pas de reference | `satellite.bus.opalis.simulation.reference_time_step_s` | s | oui | `SimulationModel.SimulationTiming.Timestep` |
| duree de reference | `satellite.bus.opalis.simulation.reference_duration_s` | s | oui | `SimulationModel.SimulationTiming.Simultime` |
| mode alimentation | `satellite.bus.opalis.model.power_supply` | texte | oui | `SimulationModel.GlobalArchitecture.VSupply` |
| type de regulation | `satellite.bus.opalis.model.regulation_type` | texte | oui | `SimulationModel.GlobalArchitecture.RegulType` |
| resistance distribution | `satellite.bus.opalis.model.distribution_resistance_ohm` | ohm | oui | `SimulationModel.GlobalArchitecture.RDistribution` |
| tension initiale batterie | `satellite.bus.opalis.battery.initial_voltage_v` | V | oui | `SimulationModel.SimulationInitialisation.VBatt` |
| etat de charge initial | `satellite.bus.opalis.battery.initial_state_of_charge` | 0–1 | oui | `SimulationModel.SimulationInitialisation.SocBattery` |
| energie batterie | `satellite.bus.opalis.battery.energy_wh` | Wh | oui | `SimulationModel.Battery.Energy` |
| nombre de cellules paralleles | `satellite.bus.opalis.battery.cells_parallel` | entier | oui | `SimulationModel.Battery.NParallel` |
| nombre de cellules serie | `satellite.bus.opalis.battery.cells_series` | entier | oui | `SimulationModel.Battery.NSerie` |
| charge de distribution | `satellite.bus.opalis.power_distribution.constant_load_w` | W | oui | `SimulationModel.DistributionLines[0].PConstant` |
| marge de distribution | `satellite.bus.opalis.power_distribution.margin_w` | W ou % selon mode | oui | `SimulationModel.DistributionLines[0].PMargin` |
| mode de consommation | `satellite.bus.opalis.power_distribution.consumption_mode` | texte | oui | `SimulationModel.DistributionLines[0].PowerConsumptionMode` |
| constante solaire | `satellite.bus.opalis.environment.solar_constant_w_m2` | W/m² | oui | `SimulationModel.SolarGenerator.SolarConstant` |
| albedo | `satellite.bus.opalis.environment.albedo_w_m2` | W/m² | oui | `SimulationModel.SolarGenerator.Albedo` |
| rayonnement Terre | `satellite.bus.opalis.environment.earth_radiation_w_m2` | W/m² | oui | `SimulationModel.SolarGenerator.PEarth` |
| surface section n | `satellite.bus.opalis.solar_generator.sections[n].area_m2` | m² | oui | `SimulationModel.SolarGenerator.Sections[n].SectionArea` |
| filling factor section n | `satellite.bus.opalis.solar_generator.sections[n].filling_factor` | 0–1 | oui | `SimulationModel.SolarGenerator.Sections[n].FillingFactor` |
| cellules serie section n | `satellite.bus.opalis.solar_generator.sections[n].cells_series` | entier | oui | `SimulationModel.SolarGenerator.Sections[n].NSsection` |
| cellules paralleles section n | `satellite.bus.opalis.solar_generator.sections[n].cells_parallel` | entier | oui | `SimulationModel.SolarGenerator.Sections[n].NPsection` |

La geometrie generaliste `electrical_subsystem.solar_panels.total_area_m2` ne
sert pas a configurer OPALIS : seule la somme des
`satellite.bus.opalis.solar_generator.sections[*].area_m2` est utilisee. Les
deux grandeurs peuvent differer (surface projetee GMAT contre surface active
des faces/panneaux OPALIS).

Les proprietes manquantes dans une definition satellite doivent rester `null`.
L'adaptateur bloque alors OPALIS et affiche le chemin manquant ; il ne doit pas
inventer une valeur depuis un template.

## 3. Proprietes possedees par le template

Le template `.opalis` reste proprietaire de l'architecture non decrite par le
satellite : modele thermique, type de regulateur, donnees de cellule detaillees,
resistances, limites de courant, et profil de puissance dynamique. L'adaptateur
ne les ecrase pas.

Le point de depart est `D:/STAGE/APP/opalis-2.4.0/Example/empty.opalis`,
reference par `satellite.bus.opalis.model.template_id = "empty.opalis"`.
L'adaptateur devra renseigner toutes les proprietes statiques du premier onglet
de ce fichier avant de charger les CIC. Il ne copie jamais les fichiers
embarques (`ephemeris/*`), `results.xml`, `charts.xml`, ni les resultats des
cas de reference.

`SimulationModel.InterpolateEphemeris=true` est impose par le workflow, pas par
le satellite : il definit la maniere dont OPALIS lit les flux CIC.

> Note API : le XML OPALIS serialize l'element sous le nom `SolarCell`, mais
> l'API .NET expose la propriete comme `Cell`. Les chemins du manifeste
> utilisent donc `SimulationModel.SolarGenerator.Sections[n].Cell.*`.

## 4. Fichier d'entree resolu

Avant OPALIS, le backend devra produire ce fichier immuable dans le dossier de
la run :

```text
<run>/opalis/02-opalis-input/opalis-parameters.json
```

Il contiendra au minimum :

```json
{
  "schema_version": 1,
  "source_satellite": "satellite.json",
  "source_cic_directory": "opalis/02-simu-cic/02-fichiers-cic/Sat",
  "template": "<template OPALIS choisi>",
  "parameters": [
    {
      "source_path": "satellite.bus.electrical_subsystem.solar_panels.albedo_w_m2",
      "opalis_path": "SimulationModel.SolarGenerator.Albedo",
      "value": 410,
      "unit": "W/m²"
    }
  ],
  "validation": { "status": "ready", "missing": [], "warnings": [] }
}
```

Ce fichier est l'interface entre TypeScript et Python. Le pipeline Python ne
devra donc plus recevoir une suite de `--set` decidee a la main par le frontend.

## 5. Regles de validation avant lancement

OPALIS peut etre lance seulement si :

1. le dossier CIC de la meme run existe et contient tous les fichiers requis ;
2. `satellite.json` de la meme run existe ;
3. toutes les entrees statiques obligatoires sont numeriques, finies et dans
   leurs plages physiques ;
4. le nombre de sections dans `opalis_sections` est compatible avec le template
   OPALIS ;
5. la somme des surfaces de section correspond a `total_area_m2` ;
6. le fichier `opalis-parameters.json` est sauvegarde avant l'execution.

La prochaine etape implementera ce contrat dans un adaptateur TypeScript et
verifiera les chemins exacts contre le nouveau template OPALIS.
