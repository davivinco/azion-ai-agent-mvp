import { planWithLlm } from "../../../lib/llm-planner"

export const dynamic = "force-dynamic"

function activeFrom(message: string) {
  return /\b(ativo|ativa|ativado|ativada|habilitado|enabled)\b/i.test(message)
}

function domainFrom(message: string) {
  const found = message.match(/\b[a-z0-9_-]+(?:\.[a-z0-9_-]+)+\.?\b/i)
  return found ? found[0].replace(/\.$/, "").toLowerCase() : ""
}

function nameFrom(message: string, fallback: string) {
  const quoted = message.match(/"([^"]+)"/)
  if (quoted?.[1]) return quoted[1].trim()

  const called = message.match(/chamad[ao]\s+(.+?)(?:\s+usando|\s+com|\s+ativo|$)/i)
  if (called?.[1]) return called[1].trim()

  return fallback
}

function randomDomain() {
  return Math.random().toString(36).slice(2, 12) + ".com.br"
}

function wantsProxiedMigration(message: string) {
  const lower = message.toLowerCase()
  const mentionsProxied = lower.includes("proxied") || lower.includes("proxy")
  const mentionsMigrationIntent = lower.includes("stack completo")
    || lower.includes("lets encrypt")
    || lower.includes("let's encrypt")
    || lower.includes("certificado")
    || lower.includes("migr")

  return mentionsProxied && mentionsMigrationIntent
}

function fallbackPlan(message: string, clientId: string, activeOverride?: boolean) {
  const lower = message.toLowerCase()
  const active = typeof activeOverride === "boolean" ? activeOverride : activeFrom(message)

  if (wantsProxiedMigration(message)) {
    const domain = domainFrom(message)

    return {
      action: "migrate_proxied_domains",
      title: domain ? `Migrar stack completo para domínios proxied em "${domain}"` : "Migrar stack completo para domínios proxied",
      clientId,
      active,
      parameters: {
        domain,
        zoneName: domain,
        rawText: message
      },
      steps: [
        "Reconhecer registros proxied no texto colado",
        "Agrupar domínios por IP de origem",
        "Criar Firewall (com WAF) por host",
        "Solicitar certificado Let's Encrypt (desafio DNS) por host",
        "Criar registro _acme-challenge para cada domínio",
        "Criar Connector, Application e Workload por host, vinculando Firewall e certificado"
      ],
      warnings: [
        "Connector e certificado são sempre criados ativos; o restante segue o toggle ativo/desabilitado.",
        "A emissão do certificado Let's Encrypt é assíncrona; acompanhe o status no console da Azion."
      ],
      originalPrompt: message,
      planner: "rules"
    }
  }

  if (lower.includes("dns") || lower.includes("zona") || lower.includes("route53") || lower.includes("cloudflare")) {
    const domain = domainFrom(message)

    return {
      action: "import_dns",
      title: domain ? 'Importar DNS para "' + domain + '"' : "Importar zonas DNS",
      clientId,
      active,
      parameters: {
        domain,
        zoneName: domain,
        records: [],
        rawText: message
      },
      steps: ["Interpretar texto DNS", "Criar zona", "Criar registros"],
      warnings: ["Linhas DNS nao reconhecidas serao ignoradas."],
      originalPrompt: message,
      planner: "rules"
    }
  }

  if (lower.includes("firewall")) {
    const name = nameFrom(message, "Firewall Template")

    return {
      action: "create_default_firewall",
      title: 'Criar firewall default "' + name + '"',
      clientId,
      active,
      parameters: { firewallName: name, debug: false },
      steps: ["Criar firewall", "Criar function instances", "Criar request rules"],
      warnings: [],
      originalPrompt: message,
      planner: "rules"
    }
  }

  const name = nameFrom(message, "Application Template")
  const domain = domainFrom(message) || randomDomain()

  return {
    action: "create_application_and_workload",
    title: 'Criar Application e Workload "' + name + '"',
    clientId,
    active,
    parameters: {
      applicationName: name,
      workloadName: name,
      domains: [domain],
      connector: {
        name: name + " - httpbingo.org",
        address: "httpbingo.org",
        host: "httpbingo.org"
      },
      sourceApplicationId: 1756827464
    },
    steps: ["Criar Application", "Criar Connector", "Criar Workload"],
    warnings: [],
    originalPrompt: message,
    planner: "rules"
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const message = String(body.message || "")
    const clientId = String(body.clientId || "")
    const activeOverride = typeof body.activeOverride === "boolean" ? body.activeOverride : undefined

    if (!message.trim()) {
      return Response.json({ error: "message is required" }, { status: 400 })
    }

    const fallback = fallbackPlan(message, clientId, activeOverride)
    const mode = process.env.AGENT_PLANNER_MODE || "rules"

    if (mode !== "llm") {
      return Response.json({ planner: "rules", plan: fallback })
    }

    const plan = await planWithLlm({ message, clientId, fallbackPlan: fallback, activeOverride })
    const parameters = { ...(plan.parameters || {}) } as Record<string, unknown>

    if (plan.action === "import_dns" || plan.action === "migrate_proxied_domains") {
      parameters.rawText = String(parameters.rawText || message)
    }

    return Response.json({
      planner: "llm",
      plan: {
        ...plan,
        parameters,
        planner: "llm",
        originalPrompt: message
      }
    })
  } catch (error) {
    return Response.json({
      error: "plan_failed",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
