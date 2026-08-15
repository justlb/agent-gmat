# Step 2 - Prepare the RF-COMLINK scenario

This step consumes the run-local `rf-comlink/01-input/rf-comlink-inputs.json`.
That manifest is produced only after the selected satellite definition, the
executed Simu-CIC attitude, the selected ground station, and the CIC files have
passed validation. It then creates:

`rf-comlink/02-scenario/prepared-rf-comlink.rfcl`

The `.rfcl` file is a ZIP container. Link XML values come from `satellite.json`
and CIC paths come from the executed Simu-CIC run. A station is never inferred
from the RF link band; it must be the station actually selected and present in
the Simu-CIC output.

The web endpoint is:

`POST /api/rf-comlink/prepare-scenario` with `{ "runPath": "..." }`

RF-COMLINK itself is opened in the next GUI step because this installation does
not expose a supported native batch execution interface.
