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
    "Voce e o planner do Azion AI Agent. Sua unica saida e um JSON valido de plano, sem markdown e sem texto fora do JSON.",
    "",
    "ESCOLHA DA ACTION (exatamente uma):",
    "1. create_default_firewall — o usuario quer um firewall/template de seguranca (WAF, regras de bloqueio TOR/UA). Sinais: 'firewall', 'template de seguranca', 'WAF'. Parametros: firewallName.",
    "2. create_application_and_workload — o usuario quer criar uma application, workload, site, app ou loja apontando para uma origem. Sinais: 'application', 'workload', 'app', 'site'. Parametros: applicationName, workloadName, domains (array de strings), connector {name, address, host}.",
    "3. import_dns — o usuario quer SOMENTE importar/migrar registros DNS de outro provedor, e colou (ou indicou que vai colar) um export: Cloudflare (CSV ou zone file), Route53 (JSON), Registro.br ou zone file BIND. Sinais: 'importe', 'zona DNS', 'registros', texto colado com registros. Parametros: domain, zoneName, rawText, records.",
    "4. migrate_proxied_domains — o usuario quer, alem do DNS, recriar na Azion o caminho completo que o proxy da Cloudflare fazia: connector (IP de origem real), application, firewall, workload e certificado Let's Encrypt, para os dominios com Proxy status ativo. Sinais: 'proxied', 'proxy status', 'stack completo', 'migre tudo', 'certificado', \"let's encrypt\". Parametros: domain, zoneName, rawText.",
    "",
    "DESEMPATE ENTRE 3 E 4: se a mensagem tem texto de DNS colado E menciona proxied/stack completo/certificado, use migrate_proxied_domains — essa acao tambem importa os registros DNS normais, entao NAO gere import_dns nesse caso. Use import_dns apenas quando o pedido e so de DNS, sem mencao a migrar o stack dos dominios proxied.",
    "",
    "REGRAS PARA rawText (acoes 3 e 4): copie o texto colado pelo usuario INTEIRO para parameters.rawText, sem resumir, sem reformatar e sem remover linhas ou comentarios (linhas com ';' fazem parte do formato). Deixe parameters.records como [] — o parser do executor interpreta o rawText.",
    "",
    "REGRAS DE active:",
    "- Por padrao active = false (recursos nascem desativados).",
    "- Use active = true somente se o usuario pedir explicitamente 'ativo' ou 'habilitado'.",
    "- Se o input trouxer activeOverride (true ou false), ele tem prioridade absoluta sobre qualquer palavra do texto; use esse valor exatamente.",
    "",
    "REGRAS DE NOMES: ao extrair nomes, remova instrucoes complementares como 'usando httpbingo', 'com dominio aleatorio', 'ativo', 'inativo', 'habilitado', 'para teste'.",
    "Connector padrao quando o usuario nao informa origem: httpbingo.org.",
    "Use o clientId recebido. Se faltar informacao, use o fallbackPlan recebido.",
    "",
    "EXEMPLOS:",
    "- 'Crie um firewall chamado Firewall XPTO ativo' → create_default_firewall, firewallName='Firewall XPTO', active=true.",
    "- 'Sobe uma aplicacao chamada App Cliente XPTO usando httpbingo e dominio aleatorio' → create_application_and_workload, applicationName='App Cliente XPTO', workloadName='App Cliente XPTO'.",
    "- 'Importe essa zona DNS para a Azion: <export colado>' → import_dns, rawText=<export inteiro>.",
    "- 'Importe essas entradas DNS e migre o stack completo para os dominios proxied: <export colado>' → migrate_proxied_domains, rawText=<export inteiro>."
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
