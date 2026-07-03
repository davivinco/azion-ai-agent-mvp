type Plan = {
  action: string
  title: string
  clientId: string
  active: boolean
  parameters: Record<string, unknown>
  steps: string[]
  warnings: string[]
  originalPrompt?: string
}

type Input = {
  message: string
  clientId: string
  fallbackPlan: Plan
  activeOverride?: boolean
}

function warn(plan: Plan, message: string): Plan {
  return {
    ...plan,
    warnings: [...(plan.warnings || []), message]
  }
}

function getContent(data: any): string {
  return String(
    data?.choices?.[0]?.message?.content ||
    data?.message?.content ||
    data?.content ||
    data?.text ||
    ""
  )
}

function extractJson(text: string): any {
  const clean = String(text || "").trim()

  if (clean.startsWith("{") && clean.endsWith("}")) {
    return JSON.parse(clean)
  }

  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error("LLM response has no JSON")
  }

  return JSON.parse(match[0])
}

function normalize(raw: any, input: Input): Plan {
  const fallback = input.fallbackPlan

  const allowed = [
    "create_default_firewall",
    "create_application_and_workload",
    "import_dns",
    "migrate_proxied_domains"
  ]

  const action = allowed.includes(raw?.action) ? raw.action : fallback.action

  const parameters =
    raw?.parameters && typeof raw.parameters === "object"
      ? raw.parameters
      : fallback.parameters

  let title = String(raw?.title || fallback.title)

  if (action === "create_application_and_workload" && parameters.applicationName) {
    title = `Criar Application e Workload "${parameters.applicationName}"`
  }

  if (action === "create_default_firewall" && parameters.firewallName) {
    title = `Criar firewall default "${parameters.firewallName}"`
  }

  if (action === "import_dns" && (parameters.domain || parameters.zoneName)) {
    title = `Importar DNS para "${parameters.domain || parameters.zoneName}"`
  }

  if (action === "migrate_proxied_domains") {
    const domainLabel = parameters.domain || parameters.zoneName
    title = domainLabel
      ? `Migrar stack completo para domínios proxied em "${domainLabel}"`
      : "Migrar stack completo para domínios proxied"
  }

  const active = typeof input.activeOverride === "boolean"
    ? input.activeOverride
    : typeof raw?.active === "boolean" ? raw.active : fallback.active

  return {
    action,
    title,
    clientId: String(raw?.clientId || input.clientId),
    active,
    parameters,
    steps: Array.isArray(raw?.steps) ? raw.steps.map(String) : fallback.steps,
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : fallback.warnings,
    originalPrompt: input.message
  }
}

export async function planWithLlm(input: Input): Promise<Plan> {
  const fallbackPlan: Plan = {
    ...input.fallbackPlan,
    originalPrompt: input.message
  }

  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const chatPath = process.env.LLM_CHAT_PATH || "/v1/chat/completions"
  const model = process.env.LLM_MODEL || "azion-llm"

  if (!baseUrl || !apiKey) {
    return warn(fallbackPlan, "LLM nao configurado; usando fallback rules-based.")
  }

  const systemPrompt = [
    "Voce e o planner do Azion AI Agent.",
    "Retorne somente JSON valido, sem markdown.",
    "Acoes permitidas: create_default_firewall, create_application_and_workload, import_dns, migrate_proxied_domains.",
    "Por padrao active deve ser false.",
    "Use active true somente se o usuario pedir explicitamente ativo ou habilitado.",
    "Use o clientId recebido.",
    "Para firewall use parameters.firewallName.",
    "Para application/workload use parameters.applicationName, parameters.workloadName, parameters.domains e parameters.connector.",
    "Para DNS use parameters.zoneName, parameters.domain, parameters.rawText e parameters.records.",
    "Quando o usuario pedir para importar zonas DNS e colar texto bruto de Route53, Cloudflare, Registro.br ou zone file, use action import_dns.",
    "Nesses casos, copie o texto original para parameters.rawText. Se nao tiver certeza dos records, deixe parameters.records vazio.",
    "Quando o usuario pedir para migrar/criar o stack completo (connector, application, firewall, workload, certificado Let's Encrypt) para dominios que estavam com Proxy status/proxied ativo (geralmente colando de novo o mesmo texto de DNS), use action migrate_proxied_domains, com parameters.rawText igual ao texto colado e parameters.domain/zoneName se identificaveis.",
    "Connector padrao: httpbingo.org.",
    "Ao extrair nomes, remova instrucoes complementares como: usando httpbingo, com dominio aleatorio, ativo, inativo, habilitado, para teste.",
    "Exemplo: 'Sobe uma aplicacao chamada App Cliente XPTO usando httpbingo e dominio aleatorio' deve usar applicationName='App Cliente XPTO' e workloadName='App Cliente XPTO'.",
    "Exemplo: 'Crie um firewall chamado Firewall XPTO ativo' deve usar firewallName='Firewall XPTO' e active=true.",
    "Se o input trouxer activeOverride (true ou false), ele tem prioridade absoluta sobre qualquer palavra do texto do usuario; use esse valor exatamente em active.",
    "Se faltar informacao, use o fallbackPlan recebido."
  ].join("\n")

  try {
    const response = await fetch(baseUrl.replace(/\/$/, "") + chatPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              message: input.message,
              clientId: input.clientId,
              activeOverride: typeof input.activeOverride === "boolean" ? input.activeOverride : null,
              fallbackPlan
            })
          }
        ]
      })
    })

    if (!response.ok) {
      const body = await response.text()
      return warn(fallbackPlan, "LLM HTTP " + response.status + "; usando fallback. " + body.slice(0, 160))
    }

    const data = await response.json()
    const content = getContent(data)

    if (!content) {
      return warn(fallbackPlan, "LLM sem conteudo; usando fallback rules-based.")
    }

    const parsed = extractJson(content)
    return normalize(parsed, input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return warn(fallbackPlan, "Erro ao chamar LLM: " + message + "; usando fallback rules-based.")
  }
}
