# tools

External workflow scripts called by the backend to drive scientific tools
(Simu-CIC, OPALIS, RF-COMLINK). The backend invokes the scripts from WSL; where
needed, a worker then starts the configured Windows scientific executable.

| Directory | Purpose |
|---|---|
| `workflow_OPALIS/` | GMAT OEM → Simu-CIC → OPALIS three-step Python pipeline. |
| `workflow_RF-COMLINK/` | RF-COMLINK batch discovery, scenario preparation, and result saving. |
