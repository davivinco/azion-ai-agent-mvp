import fs from "node:fs"
import path from "node:path"

const templatesRoot = path.resolve(process.cwd(), "../../packages/templates")

export function readTemplate<T>(fileName: string): T {
  const fullPath = path.join(templatesRoot, fileName)
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as T
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    ) as T
  }

  return value
}

export function forceActive(value: unknown, active: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => forceActive(v, active))

  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      obj[key] = key === "active" ? active : forceActive(val, active)
    }
    return obj
  }

  return value
}

export function omitKeysDeep<T>(value: T, keysToOmit: Set<string>): T {
  if (Array.isArray(value)) return value.map((v) => omitKeysDeep(v, keysToOmit)) as T

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !keysToOmit.has(key))
        .map(([key, val]) => [key, omitKeysDeep(val, keysToOmit)])
    ) as T
  }

  return value
}
