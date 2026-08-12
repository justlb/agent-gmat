// Local GUI launcher template used by agent-gmat-main.
// Tokens are replaced by the backend with Windows-native paths.

CELESTLAB_LOADER = '__CELESTLAB_LOADER__';
SIMUCIC_LOADER = '__SIMUCIC_LOADER__';
SCENARIO_FILE = '__SCENARIO_FILE__';

if ~isfile(CELESTLAB_LOADER) then
  error("CelestLab loader is unavailable: " + CELESTLAB_LOADER);
end
exec(CELESTLAB_LOADER, -1);
if exists("CL_dat_convert") == 0 then
  error("CelestLab did not load correctly");
end

if ~isfile(SIMUCIC_LOADER) then
  error("Simu-CIC loader is unavailable: " + SIMUCIC_LOADER);
end
exec(SIMUCIC_LOADER, -1);
if exists("simucic_gui") == 0 | exists("simcicg_load") == 0 then
  error("Simu-CIC did not load correctly");
end

if ~isfile(SCENARIO_FILE) then
  error("Generated Simu-CIC scenario is unavailable: " + SCENARIO_FILE);
end
simucic_gui();
simcicg_load(SCENARIO_FILE);
