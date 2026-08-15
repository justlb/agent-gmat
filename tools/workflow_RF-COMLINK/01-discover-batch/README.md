# Step 0 - RF-COMLINK batch discovery

RF-COMLINK scenarios are `.rfcl` ZIP containers. This step never uses mission
examples as input data; they are reserved for later comparison tests.

Run the safe installation check:

```powershell
python .\probe_rf_comlink.py
```

It only checks the executable and local documentation.

The current project installation was tested with `--help`, `-h`, and `/?`.
RF-COMLINK interpreted each option as a scenario filename and opened a
"Wrong file" dialog. It therefore has no usable native CLI batch interface.
The active integration path is: generate a `.rfcl` scenario automatically,
then open it in RF-COMLINK GUI.

Keep the following command only for testing a different RF-COMLINK
installation while observing the desktop:

```powershell
python .\probe_rf_comlink.py --probe-cli
```

Do not enable a web batch launcher for this installation without a separate
vendor-supported execution interface.
