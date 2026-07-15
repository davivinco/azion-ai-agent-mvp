import type { PlanView } from "../components/PlanSummary"

type PreviewRecord = {
  type: string
  name: string
  rdata: string[]
  ttl: number
}

type DnsPreviewResult = {
  domain: string
  provider: string
  records: PreviewRecord[]
  skipped: string[]
  notes: string[]
  groups: {
    host: string
    originIp: string
    domains: string[]
    certificateDomains: string[]
    acmeRecords: { name: string, rdata: string[] }[]
  }[]
}

async function fetchDnsPreview(plan: any): Promise<DnsPreviewResult | null> {
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
      notes: data.result.notes || [],
      groups: wouldCreate.groups || []
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

export type PlanMessageView = {
  content: string
  view: PlanView | null
}

function baseView(plan: any): PlanView {
  return {
    steps: Array.isArray(plan?.steps) ? plan.steps.map(String) : [],
    warnings: Array.isArray(plan?.warnings) ? plan.warnings.map(String) : []
  }
}

async function buildDnsPlanView(plan: any): Promise<PlanMessageView> {
  const preview = await fetchDnsPreview(plan)
  const view = baseView(plan)

  if (!preview) {
    return {
      content: "Não foi possível consultar o preview dos registros agora — o parser ainda vai interpretar o texto na execução. Revise com atenção antes de confirmar.",
      view
    }
  }

  view.zone = {
    domain: preview.domain || "não identificada",
    providerLabel: PROVIDER_LABELS[preview.provider] || preview.provider
  }
  view.records = preview.records
  view.notes = preview.notes
  view.skipped = preview.skipped.length

  const recordsLabel = preview.records.length === 1 ? "1 registro reconhecido" : `${preview.records.length} registros reconhecidos`

  return {
    content: preview.records.length > 0
      ? `Zona ${view.zone.domain} detectada no formato ${view.zone.providerLabel}, com ${recordsLabel}. Revise a tabela abaixo antes de confirmar.`
      : "Nenhum registro foi reconhecido no texto colado. Confira se o export veio completo.",
    view
  }
}

async function buildProxiedMigrationPlanView(plan: any): Promise<PlanMessageView> {
  const preview = await fetchDnsPreview(plan)
  const view = baseView(plan)

  if (!preview) {
    return {
      content: "Não foi possível consultar o preview da migração agora. Revise os dados colados antes de confirmar a execução.",
      view
    }
  }

  if (preview.groups.length === 0) {
    return {
      content: "Nenhum registro proxied foi encontrado no texto informado. Cole novamente o export da Cloudflare com os registros de Proxy status ativo.",
      view
    }
  }

  view.zone = { domain: preview.domain || "não identificada" }
  view.records = preview.records
  view.groups = preview.groups
  view.notes = preview.notes

  const hostsLabel = preview.groups.length === 1 ? "1 host proxied detectado" : `${preview.groups.length} hosts proxied detectados`

  return {
    content: `${hostsLabel} na zona ${view.zone.domain}. Cada host abaixo ganha Connector (IP de origem real), Application, Firewall (WAF em modo logging) e Workload com o mesmo nome, mais o certificado Let's Encrypt.`,
    view
  }
}

export async function buildPlanView(plan: any): Promise<PlanMessageView> {
  if (plan?.action === "import_dns") {
    return buildDnsPlanView(plan)
  }

  if (plan?.action === "migrate_proxied_domains") {
    return buildProxiedMigrationPlanView(plan)
  }

  if (plan?.action === "create_default_firewall") {
    const name = plan?.parameters?.firewallName || "Firewall Template"
    return {
      content: `Plano pronto para o firewall "${name}": regras de bloqueio TOR e filtro de User-Agent, com um WAF próprio criado em modo logging. Revise as etapas e confirme.`,
      view: baseView(plan)
    }
  }

  if (plan?.action === "create_application_and_workload") {
    const name = plan?.parameters?.applicationName || "Application Template"
    const domains = Array.isArray(plan?.parameters?.domains) ? plan.parameters.domains : []
    const connector = plan?.parameters?.connector?.address
    const parts = [`Plano pronto para a application e workload "${name}"`]
    if (domains.length > 0) parts.push(`no domínio ${domains.join(", ")}`)
    if (connector) parts.push(`com connector para ${connector}`)
    return {
      content: parts.join(", ") + ". Revise as etapas e confirme.",
      view: baseView(plan)
    }
  }

  return {
    content: "Plano gerado. Revise as etapas abaixo e confirme a execução quando estiver tudo certo.",
    view: baseView(plan)
  }
}
