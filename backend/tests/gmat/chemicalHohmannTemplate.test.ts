import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { defaultChemicalHohmannTemplatePath, renderChemicalHohmannBaseline } from "../../src/gmat/chemicalHohmannTemplate.js"

test("chemical Hohmann baseline is byte-identical to its canonical GMAT reference", async () => {
  const outputPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "chemical-hohmann-")), "transfer.script")
  await renderChemicalHohmannBaseline({ outputPath })
  assert.deepEqual(await fs.readFile(outputPath), await fs.readFile(defaultChemicalHohmannTemplatePath()))
})
