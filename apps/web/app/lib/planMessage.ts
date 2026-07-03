type PreviewRecord = {
  type: string
  name: string
  rdata: string[]
  ttl: number
}

async function fetchDnsPreview(plan: any): Promise<{
  domain: string
  provider: string
  records: PreviewRecord[]
  skipped: string[]
  notes: string[]
} | null> {
  try {
    const res = await fetch("/api/dns/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan })
    })

    if (!res.ok) return null

    const data = await res.json()
    const wouldCreate = data?.result?.wouldCreate

    if (!wouldCreate) return null

    return {
      domain: wouldCreate.domain || "",
      provider: wouldCreate.provider || "zonefile",
      records: wouldCreate.records || [],
      skipped: data.result.skipped || [],
      notes: data.result.notes || []
    }
  } catch {
    return null
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare_csv: "Cloudflare (CSV)",
  route53_json: "Route53 (JSON)",
  zonefile: "Zone file / genérico"
}

async function buildDnsPlanMessage(plan: any) {
  const preview = await fetchDnsPreview(plan)

  if (!preview) {
    return "Plano DNS gerado.\n\nNão foi possível consultar o preview no mcp-server agora. O parser ainda tentará interpretar o texto na execução.\n\nRevise os registros antes de confirmar a execução."
  }

  const lines = [
    "Plano DNS gerado",
    "",
    `Zona detectada: ${preview.domain || "não identificada"}`,
    `Formato identificado: ${PROVIDER_LABELS[preview.provider] || preview.provider}`,
    "",
    "Registros detectados:"
  ]

  const displayRecords = preview.records.slice(0, 12)

  if (displayRecords.length === 0) {
    lines.push("Nenhum registro foi identificado no preview.")
  } else {
    for (const record of displayRecords) {
      lines.push(`• ${record.name} — ${record.type} — ${record.rdata.join(" ")} (TTL ${record.ttl})`)
    }

    if (preview.records.length > displayRecords.length) {
      lines.push(`• ... e mais ${preview.records.length - displayRecords.length} registro(s)`)
    }
  }

  if (preview.notes.length > 0) {
    lines.push("", "Observações da tradução:")
    for (const note of preview.notes) lines.push(`⚠ ${note}`)
  }

  if (preview.skipped.length > 0) {
    lines.push("", `${preview.skipped.length} linha(s) não reconhecida(s) e ignorada(s).`)
  }

  lines.push("", "Revise os registros acima antes de confirmar a execução.")

  return lines.join("\n")
}

type ProxiedGroupPreview = {
  host: string
  originIp: string
  domains: string[]
  certificateDomains: string[]
  acmeRecords: { name: string, rdata: string[] }[]
}

async function fetchProxiedMigrationPreview(plan: any): Promise<{
  domain: string
  groups: ProxiedGroupPreview[]
  notes: string[]
} | null> {
  try {
    const res = await fetch("/api/dns/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan })
    })

    if (!res.ok) return null

    const data = await res.json()
    const wouldCreate = data?.result?.wouldCreate

    if (!wouldCreate) return null

    return {
      domain: wouldCreate.domain || "",
      groups: wouldCreate.groups || [],
      notes: data.result.notes || []
    }
  } catch {
    return null
  }
}

async function buildProxiedMigrationPlanMessage(plan: any) {
  const preview = await fetchProxiedMigrationPreview(plan)

  if (!preview) {
    return "Plano de migração gerado.\n\nNão foi possível consultar o preview no mcp-server agora. Revise os dados colados antes de confirmar a execução."
  }

  if (preview.groups.length === 0) {
    return "Nenhum registro proxied foi encontrado no texto informado.\n\nCole novamente os dados de DNS (Cloudflare CSV) com Proxy status ativo para migrar o stack completo."
  }

  const lines = [
    "Plano de migração de domínios proxied gerado",
    "",
    `Zona: ${preview.domain || "não identificada"}`,
    ""
  ]

  for (const group of preview.groups) {
    lines.push(`Host: ${group.host}`)
    lines.push(`• IP de origem: ${group.originIp}`)
    lines.push(`• Domínios: ${group.domains.join(", ")}`)
    lines.push(`• Certificado Let's Encrypt para: ${group.certificateDomains.join(", ")}`)
    for (const record of group.acmeRecords) {
      lines.push(`• Registro ACME: ${record.name} → CNAME ${record.rdata.join(" ")}`)
    }
    lines.push("")
  }

  lines.push("Cada host acima vai ganhar Connector, Application, Firewall (com WAF) e Workload próprios, todos com esse mesmo nome.")

  if (preview.notes.length > 0) {
    lines.push("", "Observações:")
    for (const note of preview.notes) lines.push(`⚠ ${note}`)
  }

  lines.push("", "Revise antes de confirmar a execução.")

  return lines.join("\n")
}

export async function buildPlanMessage(plan: any) {
  if (plan?.action === "import_dns") {
    return buildDnsPlanMessage(plan)
  }

  if (plan?.action === "migrate_proxied_domains") {
    return buildProxiedMigrationPlanMessage(plan)
  }

  return "Plano gerado para " + plan?.action + ". Revise abaixo e confirme a execução quando estiver tudo certo."
}
