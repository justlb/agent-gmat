// ======================================================================
// Simu-CIC - lancement depuis un fichier d'ephemerides OEM/CIC
// ======================================================================
// Utilisation depuis Scilab:
//   exec("C:\JUSTINE\APP\SIMU_CIC\conversion_GMAT-CIC\run_ephemeris_attitude_simulation.sce", -1)
//
// Le script:
//   1) charge Simu-CIC,
//   2) lit le fichier d'ephemerides pour extraire date de debut, duree et pas,
//   3) remplace l'orbite du scenario par ce fichier,
//   4) definit une loi d'attitude,
//   5) lance la simulation et sauvegarde les resultats.
// ======================================================================

// ----------------------------------------------------------------------
// Parametres utilisateur
// ----------------------------------------------------------------------
if exists("SCRIPT_DIR") == 0 then
  SCRIPT_DIR = get_absolute_file_path("run_ephemeris_attitude_simulation.sce");
end

if exists("SIMUCIC_DIR") == 0 then
  SIMUCIC_DIR = fullfile(SCRIPT_DIR, "..", "simu_cic");
end

// Fichier OEM/CIC compris par le GUI Simu-CIC.
if exists("EPHEMERIS_FILE") == 0 then
  EPHEMERIS_FILE = fullfile(SCRIPT_DIR, "EPH_GMAT_SIMU.txt");
end

// Scenario servant de base pour les parametres satellite, panneaux,
// capteurs, stations, options, etc.
if exists("BASE_SCENARIO") == 0 then
  BASE_SCENARIO = fullfile(SIMUCIC_DIR, "GUI", "examples", "Example_1.scd");
end

// Dossier racine de la run courante. Le backend le fournit toujours sous
// mission-runs/<id>/opalis/02-simu-cic : aucun resultat ne doit etre ecrit
// dans le repertoire du workflow partage.
if exists("SAVE_ROOT") == 0 then
  error("SAVE_ROOT est obligatoire : lancez Simu-CIC depuis une mission web.");
end

// Loi d'attitude par defaut: Nadir Trace.
// ATTITUDE_NADIR_AXIS: axe satellite pointe vers le nadir.
// ATTITUDE_TRACE_AXIS: axe satellite aligne avec la trace/vitesse sol.
if exists("ATTITUDE_LAW_NAME") == 0 then
  ATTITUDE_LAW_NAME = "NadirTrace_XY";
end
if exists("ATTITUDE_NADIR_AXIS") == 0 then
  ATTITUDE_NADIR_AXIS = "+X";
end
if exists("ATTITUDE_TRACE_AXIS") == 0 then
  ATTITUDE_TRACE_AXIS = "+Y";
end
// ATTITUDE_MODE is injected by run_scilab_simulation.py from the run-scoped
// Simu-CIC definition. Nadir pointing is the safe deterministic default.
if exists("ATTITUDE_MODE") == 0 then
  ATTITUDE_MODE = "nadir_pointing";
end
if exists("ATTITUDE_GROUND_STATIONS") == 0 then
  ATTITUDE_GROUND_STATIONS = list();
end

// Mettre %t si un graphe de verification est souhaite apres la simulation.
if exists("PLOT_AFTER_RUN") == 0 then
  PLOT_AFTER_RUN = %f;
end


// ----------------------------------------------------------------------
// Fonctions utilitaires
// ----------------------------------------------------------------------
function [info] = read_ephemeris_info(fname)
  if ~isfile(fname) then
    error("Fichier d''ephemerides introuvable: " + fname);
  end

  lines = mgetl(fname);
  samples = [];

  for k = 1:size(lines, "*")
    line = stripblanks(lines(k));

    if line == "" then
      continue;
    end

    cols = tokens(line);
    if size(cols, "*") < 8 then
      continue;
    end

    // Les lignes utiles commencent par:
    // MJD_day MJD_seconds X Y Z Vx Vy Vz
    ok = %t;
    vals = [];
    try
      vals = evstr(cols(1:8));
    catch
      ok = %f;
    end

    if ok then
      samples = [samples; matrix(vals, 1, 8)];
    end
  end

  if size(samples, 1) < 2 then
    error("Le fichier ne contient pas assez de lignes numeriques MJD/PV: " + fname);
  end

  mjd = samples(:, 1) + samples(:, 2) / 86400;
  cjd = CL_dat_convert("mjd", "cjd", mjd');

  dt = (mjd(2:$) - mjd(1:$-1)) * 86400;
  step_s = median(dt);
  duration_days = cjd($) - cjd(1);

  info = struct();
  info.start_date = CL_dat_cal2str(CL_dat_cjd2cal(cjd(1)), nd=3);
  info.stop_date = CL_dat_cal2str(CL_dat_cjd2cal(cjd($)), nd=3);
  info.duration_days = msprintf("%.15g", duration_days);
  info.step_s = msprintf("%.15g", step_s);
  info.nsamples = size(samples, 1);
endfunction


function [law] = make_nadir_trace_attitude_law(name, nadir_axis, trace_axis)
  law = struct();
  law.name = name;
  law.type = "Nadir Trace";
  law.params = struct();
  law.params.sat_axis2nadir = nadir_axis;
  law.params.sat_axis2trace = trace_axis;
endfunction


function [prof] = make_default_profile(attitude_name)
  prof = struct();
  prof.expr = "[DEFAULT]";
  prof.att = attitude_name;
  prof.constr = "None";
endfunction


function [law] = make_ground_station_attitude_law(name, station_name)
  law = struct();
  law.name = name;
  law.type = "GS Pointing - Min Ang";
  law.params = struct();
  law.params.frame = "(-Q, -S, +W)";
  law.params.station = station_name;
  law.params.sat_axis2station = "+X";
endfunction


function [cond] = make_ground_station_visibility_condition(name, station_name)
  cond = struct();
  cond.name = name;
  cond.type = "GS Visibility";
  cond.params = struct();
  cond.params.station = station_name;
endfunction


function [prof] = make_visibility_profile(condition_name, attitude_name)
  prof = struct();
  prof.expr = condition_name;
  prof.att = attitude_name;
  prof.constr = "None";
endfunction


// ----------------------------------------------------------------------
// Chargement Simu-CIC
// ----------------------------------------------------------------------
if exists("CL_dat_convert") == 0 then
  // Local project installation takes precedence over the legacy Scilab
  // contrib location.  This keeps the workflow portable across Scilab releases.
  celestlab_loader = "D:/STAGE/APP/celestlab/loader.sce";
  if ~isfile(celestlab_loader) then
    celestlab_loader = fullfile(SCI, "contrib", "celestlab", "loader.sce");
  end
  if ~isfile(celestlab_loader) then
    error("CelestLab est introuvable: " + celestlab_loader);
  end
  exec(celestlab_loader, -1);
end

if exists("CL_dat_convert") == 0 then
  error("CelestLab n''a pas pu etre charge: CL_dat_convert indisponible");
end

// En mode GUI, executer exactement le loader Simu-CIC fourni par CNES.
// En mode headless, reprendre sa partie non graphique (le menu console
// necessite une session graphique Scilab).
if exists("simucic_home") == 0 then
  if exists("SIMUCIC_HEADLESS") == 0 | ~SIMUCIC_HEADLESS then
    simucic_loader = fullfile(SIMUCIC_DIR, "loader.sce");
    if ~isfile(simucic_loader) then
      error("Loader Simu-CIC introuvable: " + simucic_loader);
    end
    exec(simucic_loader, -1);
  else
    simuciclib = lib(fullfile(SIMUCIC_DIR, "lib"));
    execstr([..
      "function [path] = simucic_home()"; ..
      "path = " + "''" + SIMUCIC_DIR + "''" + ";"; ..
      "endfunction" ..
    ]);
    __prot__ = funcprot(0);
    execstr("function abort(); mprintf(""Abort is not available\n""); endfunction");
    funcprot(__prot__);
    clear __prot__;
  end
end

if exists("simcicg_load") == 0 then
  error("La bibliotheque Simu-CIC n''a pas ete chargee correctement");
end

if ~isfile(BASE_SCENARIO) then
  error("Scenario de base introuvable: " + BASE_SCENARIO);
end

if ~isdir(SAVE_ROOT) then
  mkdir(SAVE_ROOT);
end


// ----------------------------------------------------------------------
// Lecture de l'ephemeride et preparation des donnees Simu-CIC
// ----------------------------------------------------------------------
info = read_ephemeris_info(EPHEMERIS_FILE);

mprintf("\n--- Ephemeride ---\n");
mprintf("Fichier      : %s\n", EPHEMERIS_FILE);
mprintf("Echantillons : %d\n", info.nsamples);
mprintf("Debut        : %s\n", info.start_date);
mprintf("Fin          : %s\n", info.stop_date);
mprintf("Duree [j]    : %s\n", info.duration_days);
mprintf("Pas [s]      : %s\n", info.step_s);

// Reprendre la sequence des exemples Simu-CIC officiels : le scenario est
// charge par l'API simcicg, puis sa structure est mise a jour avant le run.
// Cela initialise les donnees internes attendues par le moteur Simu-CIC.
if exists("SIMUCIC_HEADLESS") == 0 | ~SIMUCIC_HEADLESS then
  // Meme initialisation que le lanceur GUI local open_simucic_gui_template.sce.
  simucic_gui();
end
simcicg_load(BASE_SCENARIO);
data = simcicg_getData();

// L'orbite est fournie directement par le fichier d'ephemerides.
data.orbit.type = "Ephemeris File";
data.orbit.orb_data = struct();
data.orbit.orb_data.fname = EPHEMERIS_FILE;

// La simulation est bornee par les dates reellement presentes dans le fichier.
data.simulation.start_date = info.start_date;
data.simulation.duration_unit = "days";
data.simulation.duration = info.duration_days;
data.simulation.step = info.step_s;
data.simulation.description = [..
  "Simulation lancee par run_ephemeris_attitude_simulation.sce"; ..
  "Ephemeris file: " + EPHEMERIS_FILE; ..
  "Attitude mode: " + ATTITUDE_MODE + " / base law: " + ATTITUDE_LAW_NAME + ..
    " / nadir=" + ATTITUDE_NADIR_AXIS + ..
    " / trace=" + ATTITUDE_TRACE_AXIS ..
];

// Loi d'attitude utilisateur. Nadir Trace est toujours la loi de repli.
data.attitude.type = "User Defined";
data.attitude.att_data = struct();
data.attitude.att_data.laws = list();
data.attitude.att_data.laws(1) = make_nadir_trace_attitude_law(..
  ATTITUDE_LAW_NAME, ..
  ATTITUDE_NADIR_AXIS, ..
  ATTITUDE_TRACE_AXIS ..
);
data.attitude.att_data.conds = list();
data.attitude.att_data.profs = list();
if ATTITUDE_MODE == "ground_station_tracking" then
  if length(ATTITUDE_GROUND_STATIONS) == 0 then
    error("Le suivi de stations Simu-CIC requiert au moins une station predefinie");
  end
  // Use only the stations selected in the immutable backend catalogue.
  data.stations = list();
  for station_index = 1:length(ATTITUDE_GROUND_STATIONS)
    selected_station = ATTITUDE_GROUND_STATIONS(station_index);
    data.stations(station_index) = struct();
    data.stations(station_index).name = selected_station.name;
    data.stations(station_index).lon = selected_station.lon;
    data.stations(station_index).lat = selected_station.lat;
    data.stations(station_index).alt = selected_station.alt;
    data.stations(station_index).elevmin = selected_station.elevmin;

    station_law_name = "GroundStation_" + string(station_index);
    station_condition_name = "VisibleStation_" + string(station_index);
    data.attitude.att_data.laws(station_index + 1) = make_ground_station_attitude_law(station_law_name, selected_station.name);
    data.attitude.att_data.conds(station_index) = make_ground_station_visibility_condition(station_condition_name, selected_station.name);
    // Profiles are ordered as chosen by the engineer: the first visible station wins.
    data.attitude.att_data.profs(station_index) = make_visibility_profile(station_condition_name, station_law_name);
  end
  data.attitude.att_data.profs(length(ATTITUDE_GROUND_STATIONS) + 1) = make_default_profile(ATTITUDE_LAW_NAME);
else
  data.attitude.att_data.profs(1) = make_default_profile(ATTITUDE_LAW_NAME);
end


// ----------------------------------------------------------------------
// Lancement et sauvegarde
// ----------------------------------------------------------------------
mprintf("\n--- Simulation Simu-CIC ---\n");
run_id = msprintf("%.15g", round(CL_dat_now() * 86400));
save_path = fullfile(SAVE_ROOT, "run_" + run_id);

if ~isdir(save_path) then
  mkdir(save_path);
end

save(save_path + ".sod", "data");

// Sauvegarde egalement le scenario dans le format texte natif Simu-CIC.
// Le .sod reste utile pour Scilab; le .scd peut etre relu par Simu-CIC et
// permet d'inspecter les parametres exacts qui ont servi au calcul.
if exists("ms_saveToString") <> 0 then
  scenario_lines = ms_saveToString("data");
  scenario_header = [.. 
    "// ----------------------------------"; ..
    "// Simu-CIC - scenario generated by workflow_OPALIS"; ..
    "// Version: 1.4.4"; ..
    "// Date: " + info.start_date + " -> " + info.stop_date; ..
    "// ----------------------------------" ..
  ];
  mputl([scenario_header; scenario_lines], save_path + ".scd");
else
  error("Impossible de sauvegarder le scenario .scd: ms_saveToString indisponible");
end

// Sequence officielle Simu-CIC : transmettre le scenario modifie au moteur,
// executer, puis exporter les resultats (dont CIC/Sat) dans le dossier du run.
simcicg_setData(data);
res = simcicg_run();
simcicg_saveResults(save_path);

mprintf("Scenario Scilab       : %s.sod\n", save_path);
mprintf("Scenario Simu-CIC     : %s.scd\n", save_path);
mprintf("Resultats sauvegardes : %s\n", save_path);
mprintf("Dossier CIC genere    : %s\n", fullfile(save_path, "CIC"));

if exists("RUN_RESULT_MARKER") <> 0 then
  mputl(save_path, RUN_RESULT_MARKER);
end

if PLOT_AFTER_RUN then
  simcicg_plot("traj*eci");
end
