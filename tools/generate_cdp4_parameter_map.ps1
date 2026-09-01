param(
  [string]$TemplatePath = "D:\STAGE\agent-gmat-main\data\templates\satellite.definition.multi-propulsion.template.json",
  [string]$CsvPath = "C:\Users\justl\Documents\xwechat_files\wxid_6mmbdg6y39pd12_092c\msg\file\2026-08\parameter_types_local_test_model.csv",
  [string]$OutputPath = "D:\STAGE\agent-gmat-main\data\templates\satellite.definition.multi-propulsion.cdp4-parameter-map.json"
)

$ErrorActionPreference = 'Stop'

function Get-NullLeaves($value, [string]$path = '') {
  if ($null -eq $value) { return [pscustomobject]@{ template_path = $path } }
  if ($value -is [string] -or $value -is [ValueType]) { return }
  if ($value -is [System.Collections.IEnumerable]) {
    $index = 0
    foreach ($item in $value) { Get-NullLeaves $item "$path[$index]"; $index++ }
    return
  }
  foreach ($property in $value.PSObject.Properties) {
    $childPath = if ($path) { "$path.$($property.Name)" } else { $property.Name }
    Get-NullLeaves $property.Value $childPath
  }
}

function Get-Tokens([string]$text) {
  $normalised = $text -replace '([a-z])([A-Z])', '$1 $2' -replace '[_\.\[\]\-]', ' '
  $normalised = $normalised.ToLowerInvariant()
  @($normalised -split '\s+' | Where-Object { $_ -and $_ -notmatch '^\d+$' -and $_ -notin @(
    'satellite','bus','subsystem','engines','engine','performance','installation','system',
    'model','simulation','primary','array','range','operating','mode','legacy','compatibility',
    'electric','chemical','spacecraft','payload','mission','lifecycle','of','at','per','body',
    'frame','link','links','propulsion','propellants','power','solar','battery','antenna'
  ) })
}

function Get-Intent([string]$path) {
  $p = $path.ToLowerInvariant()
  if ($p -match 'specific_impulse') { return 'specific impulse' }
  if ($p -match 'total_impulse') { return 'total impulse' }
  if ($p -match 'minimum_impulse') { return 'minimum impulse bit' }
  if ($p -match 'nominal_thrust|main_engine_thrust') { return 'thrust' }
  if ($p -match 'thrust_range') { return 'thrust' }
  if ($p -match 'mass_kg|propellant_mass|usable_propellant|residual_propellant') { return 'mass' }
  if ($p -match 'inertia') { return 'moment of inertia' }
  if ($p -match 'area_m2|cell_area') { return 'area' }
  if ($p -match 'length|width|height|span|aperture|focal_length') { return 'length' }
  if ($p -match 'pressure') { return 'pressure' }
  if ($p -match 'temperature') { return 'temperature' }
  if ($p -match 'voltage') { return 'voltage' }
  if ($p -match 'efficiency') { return 'efficiency' }
  if ($p -match 'frequency') { return 'frequency' }
  if ($p -match 'data_rate|binary_rate') { return 'data rate' }
  if ($p -match 'gain') { return 'antenna gain' }
  if ($p -match 'eirp') { return 'eirp' }
  if ($p -match 'capacity_ah') { return 'battery capacity' }
  if ($p -match 'energy_wh') { return 'energy' }
  if ($p -match 'power|load|heaters|constant_load|rated_power') { return 'power' }
  if ($p -match 'altitude') { return 'altitude' }
  if ($p -match 'lifetime|duration|time_step|burn_time') { return 'time' }
  if ($p -match 'coefficient') { return 'coefficient' }
  if ($p -match 'angle|pointing|axis|orientation|polarization') { return 'angle' }
  if ($p -match 'resistance') { return 'resistance' }
  if ($p -match 'memory|storage') { return 'data storage' }
  return $null
}

function Get-ExpectedUnit([string]$path) {
  $p = $path.ToLowerInvariant()
  if ($p -match 'kg_m2') { return 'kg·m²' }
  if ($p -match 'mass_kg|propellant_mass|usable_propellant|residual_propellant') { return 'kg' }
  if ($p -match 'thrust_range_mn') { return 'mN' }
  if ($p -match 'thrust_n|nominal_thrust_newtons') { return 'N' }
  if ($p -match 'impulse_ns') { return 'N·s' }
  if ($p -match 'delta_v_mps') { return 'm/s' }
  if ($p -match 'power_kw|load_kw') { return 'kW' }
  if ($p -match 'power_w|load_w|heaters_power') { return 'W' }
  if ($p -match 'voltage_v') { return 'V' }
  if ($p -match 'capacity_ah') { return 'A·h' }
  if ($p -match 'energy_wh') { return 'W·h' }
  if ($p -match 'area_m2') { return 'm²' }
  if ($p -match 'meters') { return 'm' }
  if ($p -match 'pressure_bar') { return 'bar' }
  if ($p -match 'celsius') { return '°C' }
  if ($p -match 'frequency_mhz') { return 'MHz' }
  if ($p -match 'gain_db|loss_db|ebn0_db|eirp_dbw|axial_ratio_db') { return 'dB' }
  if ($p -match 'resistance_ohm') { return 'Ω' }
  if ($p -match 'percent') { return '%' }
  if ($p -match 'arcsec') { return 'arcsec' }
  if ($p -match 'angle_deg') { return '°' }
  if ($p -match 'time_step_s|duration_s|burn_time_s|active_duration_s|repeat_period_s') { return 's' }
  if ($p -match 'lifetime_hours') { return 'h' }
  return $null
}
$template = Get-Content -Raw -LiteralPath $TemplatePath | ConvertFrom-Json
$rows = @(Import-Csv -LiteralPath $CsvPath)
$stop = @('name','type','id','role','quantity','status','strategy','source','manufacturer','operator','country','technology','propellant','fuel','oxidizer','material','chemistry','coding','modulation','control','method','location','architecture','objective','constellation','platform','passivation','processing','regulation','distribution','direction','requires','tracking','selection','family','redundancy','ratio','feed','valves','pressurization','unit','cells','manual','limit','decommissioning','reentry','site','vehicle','date')

$mappings = foreach ($leaf in @(Get-NullLeaves $template)) {
  $intent = Get-Intent $leaf.template_path
  $expectedUnit = Get-ExpectedUnit $leaf.template_path
  $queryTokens = @(Get-Tokens $leaf.template_path | Where-Object { $_ -notin $stop })
  $scored = foreach ($row in $rows) {
    $candidateText = "$($row.Name) $($row.'Short Name')".ToLowerInvariant()
    $candidateTokens = @(Get-Tokens $candidateText)
    if ($expectedUnit -and $row.'Unit Short Name' -ne $expectedUnit) { continue }
    $score = 0
    if ($intent -and $candidateText -match [regex]::Escape($intent)) { $score += 12 }
    if ($intent -and $row.Name.ToLowerInvariant() -eq $intent) { $score += 20 }
    foreach ($token in $queryTokens) {
      if ($candidateTokens -contains $token) { $score += 3 }
      elseif ($token.Length -ge 5 -and $candidateText -match [regex]::Escape($token)) { $score += 2 }
    }
    # Contextual refinements prevent generic matches from hiding a more precise CDP4 type.
    if ($leaf.template_path -match 'battery.*capacity' -and $candidateText -match 'battery') { $score += 5 }
    if ($leaf.template_path -match 'antenna.*gain' -and $candidateText -match 'antenna') { $score += 5 }
    if ($leaf.template_path -match 'solar.*power' -and $candidateText -match 'solar') { $score += 5 }
    if ($leaf.template_path -match 'drag.*coefficient' -and $candidateText -match 'drag') { $score += 5 }
    if ($leaf.template_path -match 'dry' -and $candidateText -match 'dry') { $score += 30 }
    if ($leaf.template_path -match 'wet' -and $candidateText -match 'wet') { $score += 30 }
    if ($score -gt 0) {
      [pscustomobject]@{
        score = $score
        name = $row.Name
        short_name = $row.'Short Name'
        unit_full_name = $row.'Unit Full Name'
        unit_short_name = $row.'Unit Short Name'
        iid = $row.IID
        default_scale_iid = $row.'Default Scale IID'
      }
    }
  }
  $candidates = if (-not $intent -and -not $expectedUnit) { @() } else { @($scored | Sort-Object @{ Expression = 'score'; Descending = $true }, name | Select-Object -First 3) }
  $bestScore = if ($candidates.Count) { $candidates[0].score } else { 0 }
  $confidence = if ($expectedUnit -and $bestScore -ge 15) { 'high' } elseif ($expectedUnit -and $bestScore -ge 9) { 'medium' } elseif ($bestScore -ge 9) { 'low' } else { 'none' }
  [pscustomobject]@{
    template_path = $leaf.template_path
    inferred_concept = $intent
    expected_unit_short_name = $expectedUnit
    match_status = if ($confidence -in @('high','medium')) { 'candidate_found' } else { 'needs_review' }
    confidence = $confidence
    cdp4_parameter_type_candidates = $candidates
  }
}

$result = [ordered]@{
  schema_version = '1.0.0'
  generated_at = (Get-Date).ToUniversalTime().ToString('o')
  purpose = 'Candidate CDP4 ParameterType correspondences for null fields in satellite.definition.multi-propulsion.template.json. Candidates are semantic suggestions, not confirmed bindings.'
  source_template = $TemplatePath
  source_cdp4_parameter_types_csv = $CsvPath
  summary = [ordered]@{
    null_template_fields = @($mappings).Count
    candidate_found = @($mappings | Where-Object match_status -eq 'candidate_found').Count
    needs_review = @($mappings | Where-Object match_status -eq 'needs_review').Count
  }
  mappings = @($mappings)
}

$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8



