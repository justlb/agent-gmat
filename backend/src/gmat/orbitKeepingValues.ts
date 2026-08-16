import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument, stringify } from "yaml"

import { defaultOrbitKeepingTemplatePath } from "./orbitKeepingTemplate.js"

const SIMPLE_ASSIGNMENT = /^(\s*)([A-Za-z][A-Za-z0-9_.]*)(\s*=\s*)(.+?)(;\s*)$/u
const INLINE_LITERAL = /'[^'\r\n]*'|(?<![A-Za-z_])[-+]?(?:\d+\.\d+|\d+)(?:e[-+]?\d+)?(?![A-Za-z_])|\b(?:true|false|On|Off)\b/giu

export type OrbitKeepingValueSlot = {
  id: string
  context: string
  value: string
}

export type OrbitKeepingValues = {
  schemaVersion: 1
  templateId: "orbit-keeping"
  slots: OrbitKeepingValueSlot[]
}

export type OrbitKeepingValueChange = {
  id: string
  value: string
}

type LocatedSlot = OrbitKeepingValueSlot & { start: number; end: number }

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "")
}

function stableContext(value: string) {
  return value.replace(/\s+/gu, " ").trim()
}

function locateSlots(template: string): LocatedSlot[] {
  const slots: LocatedSlot[] = []
  let lineStart = 0
  let lineNumber = 1

  for (const line of template.split(/(?<=\n)/u)) {
    const lineWithoutNewline = line.replace(/\r?\n$/u, "")
    const assignment = SIMPLE_ASSIGNMENT.exec(lineWithoutNewline)

    if (assignment) {
      const [, indent, left, separator, value] = assignment
      const start = lineStart + indent.length + left.length + separator.length
      slots.push({
        id: `line_${String(lineNumber).padStart(3, "0")}_${safeId(left)}`,
        context: lineWithoutNewline.trim(),
        value,
        start,
        end: start + value.length,
      })
    } else if (!lineWithoutNewline.trimStart().startsWith("%")) {
      let literalIndex = 0
      for (const match of lineWithoutNewline.matchAll(INLINE_LITERAL)) {
        const value = match[0]
        const start = lineStart + (match.index ?? 0)
        literalIndex += 1
        slots.push({
          id: `line_${String(lineNumber).padStart(3, "0")}_literal_${literalIndex}`,
          context: lineWithoutNewline.trim(),
          value,
          start,
          end: start + value.length,
        })
      }
    }

    lineStart += line.length
    lineNumber += 1
  }

  return slots
}

function assertSafeValue(value: unknown, id: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`value slot ${id} must contain a non-empty string`)
  }
  if (/\r|\n/u.test(value)) {
    throw new Error(`value slot ${id} contains forbidden line or command syntax`)
  }
  if (/;/u.test(value) && !/^\[\s*[-+0-9.eE;\s]+\]$/u.test(value)) {
    throw new Error(`value slot ${id} contains forbidden line or command syntax`)
  }
}

export function extractOrbitKeepingValues(template: string): OrbitKeepingValues {
  return {
    schemaVersion: 1,
    templateId: "orbit-keeping",
    slots: locateSlots(template).map(({ id, context, value }) => ({ id, context, value })),
  }
}

export function parseOrbitKeepingValues(source: string): OrbitKeepingValues {
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`values YAML is invalid: ${document.errors[0].message}`)
  }
  const parsed = document.toJS()
  if (!parsed || typeof parsed !== "object") throw new Error("values YAML must be an object")
  const values = parsed as Partial<OrbitKeepingValues>
  if (values.schemaVersion !== 1 || values.templateId !== "orbit-keeping" || !Array.isArray(values.slots)) {
    throw new Error("values YAML has an unsupported schema or template id")
  }
  const slots = values.slots.map((slot) => {
    if (!slot || typeof slot !== "object") throw new Error("values YAML contains an invalid slot")
    const candidate = slot as Partial<OrbitKeepingValueSlot>
    if (typeof candidate.id !== "string" || typeof candidate.context !== "string") {
      throw new Error("values YAML slot is missing id or context")
    }
    assertSafeValue(candidate.value, candidate.id)
    return { id: candidate.id, context: candidate.context, value: candidate.value }
  })
  return { schemaVersion: 1, templateId: "orbit-keeping", slots }
}

export function applyOrbitKeepingValueChanges(
  values: OrbitKeepingValues,
  changes: OrbitKeepingValueChange[],
): OrbitKeepingValues {
  const knownSlots = new Map(values.slots.map((slot) => [slot.id, slot]))
  const changedIds = new Set<string>()

  for (const change of changes) {
    if (!change || typeof change.id !== "string") {
      throw new Error("LLM patch contains an invalid slot id")
    }
    if (changedIds.has(change.id)) {
      throw new Error(`LLM patch changes slot ${change.id} more than once`)
    }
    if (!knownSlots.has(change.id)) {
      throw new Error(`LLM patch references an unknown slot: ${change.id}`)
    }
    assertSafeValue(change.value, change.id)
    changedIds.add(change.id)
  }

  const replacementValues = new Map(changes.map((change) => [change.id, change.value]))
  return {
    ...values,
    slots: values.slots.map((slot) => ({
      ...slot,
      value: replacementValues.get(slot.id) ?? slot.value,
    })),
  }
}

export function renderOrbitKeepingValues(template: string, values: OrbitKeepingValues) {
  const located = locateSlots(template)
  const replacementsById = new Map(values.slots.map((slot) => [slot.id, slot]))
  const replacementsByContext = new Map<string, OrbitKeepingValueSlot[]>()
  for (const slot of values.slots) {
    const key = stableContext(slot.context)
    const matches = replacementsByContext.get(key) ?? []
    matches.push(slot)
    replacementsByContext.set(key, matches)
  }
  const contextOccurrence = new Map<string, number>()
  const used = new Set<OrbitKeepingValueSlot>()
  const replacements: Array<{ expected: LocatedSlot; replacement: OrbitKeepingValueSlot }> = []
  for (const expected of located) {
    // A template may gain immutable defaults (such as a new EphemerisFile)
    // after a draft was written. Match old slots by their stable context when
    // their line-based ids have shifted, and keep new template defaults intact.
    const byId = replacementsById.get(expected.id)
    const context = stableContext(expected.context)
    const occurrence = contextOccurrence.get(context) ?? 0
    const replacement = byId && stableContext(byId.context) === context
      ? byId
      : replacementsByContext.get(context)?.[occurrence]
    contextOccurrence.set(context, occurrence + 1)
    if (!replacement) continue
    assertSafeValue(replacement.value, expected.id)
    used.add(replacement)
    replacements.push({ expected, replacement })
  }
  let rendered = template
  for (const { expected, replacement } of replacements.reverse()) {
    rendered = `${rendered.slice(0, expected.start)}${replacement.value}${rendered.slice(expected.end)}`
  }
  const unmatched = values.slots.filter(slot => !used.has(slot))
  if (unmatched.length) throw new Error(`values YAML does not match template slot ${unmatched[0].id}`)
  return rendered
}

export async function writeDefaultOrbitKeepingValues({
  outputPath,
  templatePath = defaultOrbitKeepingTemplatePath(),
}: {
  outputPath: string
  templatePath?: string
}) {
  const template = await fs.readFile(templatePath, "utf8")
  const values = extractOrbitKeepingValues(template)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, stringify(values), "utf8")
  return values
}

export async function renderOrbitKeepingFromValues({
  outputPath,
  valuesPath,
  templatePath = defaultOrbitKeepingTemplatePath(),
}: {
  outputPath: string
  valuesPath: string
  templatePath?: string
}) {
  const [template, valuesSource] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(valuesPath, "utf8"),
  ])
  const rendered = renderOrbitKeepingValues(template, parseOrbitKeepingValues(valuesSource))
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, rendered, "utf8")
  return { outputPath, valuesPath, templatePath, bytesWritten: Buffer.byteLength(rendered, "utf8") }
}
