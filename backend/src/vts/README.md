# backend/src/vts, cosyvoice, funasr

Near-empty directory for a legacy integration.

- `vts/` — Video Track Shot module (no source in this directory). GMAT runs may
  still retain generated VTS artefacts.
- CosyVoice (TTS) and FunASR (speech-to-text) are optional legacy services.
  Their runtime settings can be supplied in `config.json` or environment
  variables, but they are not part of the GMAT mission pipeline.

No active CosyVoice or FunASR source directory is maintained under `backend/src`.
