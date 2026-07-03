export type AzionDnsRecord = {
  type: string
  name: string
  rdata: string[]
  ttl: number
  description?: string
}

export type ProxiedOrigin = {
  fqdn: string
  originIp: string
}

export type DnsImportResult = {
  domain: string
  provider: "cloudflare_csv" | "route53_json" | "zonefile"
  records: AzionDnsRecord[]
  skipped: string[]
  notes: string[]
  proxiedOrigins: ProxiedOrigin[]
}

const DNS_TYPES = new Set(["A", "AAAA", "ANAME", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"])

function clean(value: string) {
  return String(value || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "")
}

function tokens(line: string) {
  return line.match(/"[^"]*"|'[^']*'|\S+/g) || []
}

function isNumber(value: string) {
  return /^\d+$/.test(value)
}

function rootDomain(host: string) {
  const parts = clean(host).toLowerCase().replace(/^\*\./, "").split(".").filter(Boolean)
  if (parts.length <= 2) return parts.join(".")

  const last = parts[parts.length - 1]
  const prev = parts[parts.length - 2]

  if (last === "br" && ["com", "net", "org", "gov", "edu"].includes(prev)) {
    return parts.slice(-3).join(".")
  }

  return parts.slice(-2).join(".")
}

function inferDomain(rawText: string, fallback?: string) {
  if (fallback && fallback.includes(".")) return rootDomain(fallback)

  const explicit = rawText.match(/(?:zone|zona|domain|dominio|hosted zone)\s*[:=]\s*([a-z0-9._*-]+\.[a-z0-9._-]+)/i)
  if (explicit?.[1]) return rootDomain(explicit[1])

  const matches = rawText.match(/\b[a-z0-9_*_-]+(?:\.[a-z0-9_*_-]+)+\.?\b/gi) || []
  return matches[0] ? rootDomain(matches[0]) : ""
}

function normalizeName(name: string, domain: string) {
  const n = clean(name).toLowerCase()
  const d = clean(domain).toLowerCase()

  if (!n || n === d) return "@"
  if (n.endsWith("." + d)) return n.slice(0, -(d.length + 1))
  return n
}

function isApexNameserverRecord(name: string, type: string) {
  return name === "@" && (type === "NS" || type === "SOA")
}

function unwrapMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, "$1")
}

function stripLineComment(line: string): { record: string, comment: string } {
  // BIND/RFC1035 semantics: ';' starts a comment to end of line, unless inside quotes.
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ";" && !inQuotes) {
      return { record: line.slice(0, index), comment: line.slice(index + 1) }
    }
  }

  return { record: line, comment: "" }
}

function extractCloudflareProxiedTag(comment: string): boolean | null {
  const match = comment.match(/cf_tags=cf-proxied:(true|false)/i)
  return match ? match[1].toLowerCase() === "true" : null
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += char
    }
  }

  result.push(current)
  return result.map((value) => value.trim())
}

function group(records: AzionDnsRecord[]) {
  const map = new Map<string, AzionDnsRecord>()

  for (const record of records) {
    const key = `${record.type}|${record.name}|${record.ttl}`
    const current = map.get(key)

    if (!current) {
      map.set(key, { ...record, rdata: [...record.rdata] })
      continue
    }

    current.rdata = Array.from(new Set([...current.rdata, ...record.rdata]))
  }

  return Array.from(map.values())
}

function extractJsonBlock(rawText: string): any {
  const trimmed = String(rawText || "").trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    // the payload may have a free-text instruction before the JSON block; try again below
  }

  const startIdx = trimmed.search(/[{[]/)
  if (startIdx === -1) return null

  try {
    return JSON.parse(trimmed.slice(startIdx))
  } catch {
    return null
  }
}

function asRoute53List(json: any): any[] | null {
  const list = Array.isArray(json) ? json : json?.ResourceRecordSets

  if (Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === "object" && "Type" in list[0] && "Name" in list[0]) {
    return list
  }

  return null
}

type CsvBlock = { headers: string[], rows: string[] }

function extractCsvBlock(rawText: string): CsvBlock | null {
  const lines = String(rawText || "").split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || !line.includes(",")) continue

    const headers = splitCsvLine(line).map((col) => col.toLowerCase())
    if (headers.includes("type") && headers.includes("name") && headers.includes("content")) {
      return {
        headers,
        rows: lines.slice(index + 1).map((row) => row.trim()).filter(Boolean)
      }
    }
  }

  return null
}

export function detectProvider(rawText: string): "cloudflare_csv" | "route53_json" | "zonefile" {
  const jsonBlock = extractJsonBlock(rawText)
  if (jsonBlock && asRoute53List(jsonBlock)) return "route53_json"
  if (extractCsvBlock(rawText)) return "cloudflare_csv"
  return "zonefile"
}

function parseCloudflareCsv(block: CsvBlock, domain: string) {
  const headers = block.headers

  const columnIndex = {
    type: headers.indexOf("type"),
    name: headers.indexOf("name"),
    content: headers.indexOf("content"),
    ttl: headers.indexOf("ttl"),
    priority: headers.indexOf("priority"),
    proxy: headers.findIndex((col) => col.includes("proxy"))
  }

  const records: AzionDnsRecord[] = []
  const skipped: string[] = []
  const notes: string[] = []
  const proxiedOrigins: ProxiedOrigin[] = []
  let proxiedCount = 0

  for (const row of block.rows) {
    const cols = splitCsvLine(row)
    const type = clean(cols[columnIndex.type] || "").toUpperCase()
    const rawName = cols[columnIndex.name] || ""
    const content = clean(cols[columnIndex.content] || "")
    const ttlRaw = columnIndex.ttl >= 0 ? clean(cols[columnIndex.ttl] || "") : ""
    const priority = columnIndex.priority >= 0 ? clean(cols[columnIndex.priority] || "") : ""
    const proxied = columnIndex.proxy >= 0 && /^(true|proxied)$/i.test(clean(cols[columnIndex.proxy] || ""))

    if (!type || !content) {
      if (row.trim()) skipped.push(row)
      continue
    }

    if (type === "SRV") {
      skipped.push(row)
      notes.push("Registro SRV do Cloudflare foi ignorado: as colunas de prioridade/peso/porta do export do Cloudflare não são confiáveis o suficiente para tradução automática. Cadastre este SRV manualmente na Azion.")
      continue
    }

    if (!DNS_TYPES.has(type)) {
      skipped.push(row)
      continue
    }

    const name = normalizeName(rawName, domain)

    if (isApexNameserverRecord(name, type)) {
      notes.push(`Registro ${type} na raiz da zona (${rawName || "@"}) foi ignorado: a Azion Edge DNS já gerencia os nameservers desta zona.`)
      continue
    }

    const ttl = isNumber(ttlRaw) ? Number(ttlRaw) : 300
    const rdata = type === "MX" && priority ? [`${priority} ${content}`] : [content]

    if (proxied) {
      proxiedCount += 1

      if (type === "A" || type === "AAAA") {
        const fqdn = name === "@" ? domain : `${name}.${domain}`
        proxiedOrigins.push({ fqdn, originIp: content })
      }
    }

    records.push({
      type,
      name,
      rdata,
      ttl,
      description: "Imported by Azion AI Agent (Cloudflare)"
    })
  }

  if (proxiedCount > 0) {
    notes.push(`${proxiedCount} registro(s) estavam com Proxy status ativo no Cloudflare. O valor de origem real foi importado, mas o tráfego deixará de passar pelo proxy do Cloudflare após a migração — configure Application/Workload na Azion para assumir esse papel.`)
  }

  return { records, skipped, notes, proxiedOrigins }
}

function parseRoute53Json(list: any[], domain: string) {
  const records: AzionDnsRecord[] = []
  const skipped: string[] = []
  const notes: string[] = []

  for (const entry of list) {
    const type = String(entry?.Type || "").toUpperCase()
    const rawName = String(entry?.Name || "")

    if (!DNS_TYPES.has(type)) {
      skipped.push(JSON.stringify(entry))
      continue
    }

    const name = normalizeName(rawName, domain)

    if (isApexNameserverRecord(name, type)) {
      notes.push(`Registro ${type} na raiz da zona foi ignorado: a Azion Edge DNS já gerencia os nameservers desta zona.`)
      continue
    }

    if (entry?.AliasTarget?.DNSName) {
      const target = clean(String(entry.AliasTarget.DNSName))
      records.push({
        type: "ANAME",
        name,
        rdata: [target],
        ttl: 300,
        description: "Imported by Azion AI Agent (Route53 Alias)"
      })
      notes.push(`Registro Alias (${type}) em "${rawName || "@"}" foi convertido para ANAME apontando para ${target}. Confirme se o destino precisa existir como recurso próprio na Azion.`)
      continue
    }

    const values = Array.isArray(entry?.ResourceRecords)
      ? entry.ResourceRecords.map((record: any) => clean(String(record?.Value || ""))).filter(Boolean)
      : []

    if (!values.length) {
      skipped.push(JSON.stringify(entry))
      continue
    }

    const ttl = Number(entry?.TTL) || 300
    const rdata = (type === "TXT" || type === "MX" || type === "SRV") ? [values.join(" ")] : values

    records.push({
      type,
      name,
      rdata,
      ttl,
      description: "Imported by Azion AI Agent (Route53)"
    })
  }

  return { records, skipped, notes, proxiedOrigins: [] as ProxiedOrigin[] }
}

function parseLine(line: string, domain: string): { record: AzionDnsRecord | null, note?: string, proxied?: boolean, usedDelimitedHeuristic?: boolean } {
  const original = line.trim()

  if (!original || original.startsWith("#") || original.startsWith(";") || original.startsWith("$")) {
    return { record: null }
  }

  if (/^(type|nome|name)\s+/i.test(original)) return { record: null }

  const { record: recordPart, comment } = stripLineComment(original)
  const proxiedTag = extractCloudflareProxiedTag(comment)

  const parts = tokens(recordPart.replace(/[,\t]+/g, " "))
  if (parts.length < 3) return { record: null }

  let name = ""
  let type = ""
  let ttl = 300
  let values: string[] = []

  if (DNS_TYPES.has(parts[0].toUpperCase())) {
    type = parts[0].toUpperCase()
    name = parts[1]
    values = parts.slice(2)
  } else {
    name = parts[0]
    let idx = 1

    if (parts[idx] && isNumber(parts[idx])) {
      ttl = Number(parts[idx])
      idx++
    }

    if (parts[idx]?.toUpperCase() === "IN") idx++

    type = parts[idx]?.toUpperCase() || ""
    values = parts.slice(idx + 1)
  }

  if (!DNS_TYPES.has(type)) return { record: null }

  values = values.map(clean).filter(Boolean)

  if (type === "MX" && values.length >= 2) values = [values.join(" ")]
  if (type === "SRV" && values.length >= 4) values = [values.join(" ")]
  if (type === "TXT") values = [values.join(" ")]

  values = values.filter((v) => !["auto", "automatic", "proxied", "dns", "only", "dns_only"].includes(v.toLowerCase()))

  if (!values.length) return { record: null }

  const normalizedName = normalizeName(name, domain)

  if (isApexNameserverRecord(normalizedName, type)) {
    return {
      record: null,
      note: `Registro ${type} na raiz da zona foi ignorado: a Azion Edge DNS já gerencia os nameservers desta zona.`
    }
  }

  return {
    record: {
      type,
      name: normalizedName,
      rdata: values,
      ttl,
      description: "Imported by Azion AI Agent"
    },
    proxied: proxiedTag === true && (type === "A" || type === "AAAA"),
    usedDelimitedHeuristic: /[,\t]/.test(recordPart)
  }
}

function parseZoneFileLike(rawText: string, domain: string) {
  const records: AzionDnsRecord[] = []
  const skipped: string[] = []
  const notes: string[] = []
  const proxiedOrigins: ProxiedOrigin[] = []
  let heuristicTableUsed = false
  let proxiedCount = 0

  for (const line of String(rawText || "").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const { record, note, proxied, usedDelimitedHeuristic } = parseLine(line, domain)

    if (note) {
      notes.push(note)
      continue
    }

    if (record) {
      records.push(record)
      if (usedDelimitedHeuristic) heuristicTableUsed = true

      if (proxied) {
        proxiedCount += 1
        const fqdn = record.name === "@" ? domain : `${record.name}.${domain}`
        proxiedOrigins.push({ fqdn, originIp: record.rdata[0] })
      }

      continue
    }

    if (!trimmed.startsWith("#") && !trimmed.startsWith(";") && !trimmed.startsWith("$")) {
      skipped.push(trimmed)
    }
  }

  if (heuristicTableUsed) {
    notes.push("Uma ou mais linhas foram interpretadas como tabela delimitada (CSV/tab) pelo parser genérico, formato comum em exports de GoCache ou similares. Revise os registros antes de confirmar a execução.")
  }

  if (proxiedCount > 0) {
    notes.push(`${proxiedCount} registro(s) estavam com Proxy status ativo no Cloudflare (cf_tags=cf-proxied:true). O valor de origem real foi importado, mas o tráfego deixará de passar pelo proxy do Cloudflare após a migração — configure Application/Workload na Azion para assumir esse papel.`)
  }

  return { records, skipped, notes, proxiedOrigins }
}

export function parseDnsImport(rawText: string, fallbackDomain?: string): DnsImportResult {
  const text = unwrapMarkdownLinks(String(rawText || ""))
  const domain = inferDomain(text, fallbackDomain)

  const jsonBlock = extractJsonBlock(text)
  const route53List = jsonBlock ? asRoute53List(jsonBlock) : null

  if (route53List) {
    const outcome = parseRoute53Json(route53List, domain)
    return { domain, provider: "route53_json", records: group(outcome.records), skipped: outcome.skipped, notes: outcome.notes, proxiedOrigins: outcome.proxiedOrigins }
  }

  const csvBlock = extractCsvBlock(text)

  if (csvBlock) {
    const outcome = parseCloudflareCsv(csvBlock, domain)
    return { domain, provider: "cloudflare_csv", records: group(outcome.records), skipped: outcome.skipped, notes: outcome.notes, proxiedOrigins: outcome.proxiedOrigins }
  }

  const outcome = parseZoneFileLike(text, domain)
  return { domain, provider: "zonefile", records: group(outcome.records), skipped: outcome.skipped, notes: outcome.notes, proxiedOrigins: outcome.proxiedOrigins }
}
