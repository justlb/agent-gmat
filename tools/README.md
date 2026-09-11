# tools

External workflow scripts called by the backend to drive scientific tools (Simu-CIC, OPALIS, RF-COMLINK). These run on Windows and are invoked via the backend's external-process runner.

| Directory | Purpose |
|---|---|
| `workflow_OPALIS/` | GMAT OEM → Simu-CIC → OPALIS three-step Python pipeline. |
| `workflow_RF-COMLINK/` | RF-COMLINK batch discovery, scenario preparation, and result saving. |
