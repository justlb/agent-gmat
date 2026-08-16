import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const pendingWrites = new Map<string, Promise<void>>()

/** Serializes read-modify-write operations for one local persistence target. */
export async function withFileWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath)
  const previous = pendingWrites.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  pendingWrites.set(key, chain)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (pendingWrites.get(key) === chain) pendingWrites.delete(key)
  }
}

export async function writeTextAtomically(filePath: string, source: string) {
  const output = path.resolve(filePath)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${crypto.randomUUID()}.tmp`)
  await fs.writeFile(temporary, source, "utf8")
  await fs.rename(temporary, output)
}

export async function updateJsonFile<T>(filePath: string, fallback: T, update: (current: T) => T | Promise<T>) {
  return withFileWriteLock(filePath, async () => {
    const source = await fs.readFile(filePath, "utf8").catch(() => null)
    let current = fallback
    if (source !== null) {
      try { current = JSON.parse(source) as T } catch { current = fallback }
    }
    const next = await update(current)
    await writeTextAtomically(filePath, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}
