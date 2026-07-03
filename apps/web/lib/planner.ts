export type AgentAction =
  | "create_default_firewall"
  | "create_application_and_workload"
  | "import_dns"

export type AgentPlan = {
  action: AgentAction
  title: string
  clientId: string
  active: boolean
  parameters: Record<string, unknown>
  steps: string[]
  warnings: string[]
}

function extractQuotedName(message: string): string | null {
  const quoted = message.match(/["“”']([^"“”']+)["“”']/)
  if (quoted?.[1]) return quoted[1].trim()

  const called = message.match(/chamad[ao]\s+(.+?)(?:\s+(?:ativo|ativado|desativado|para|com|no|na)$|$)/i)
  if (called?.[1]) return called[1].trim()

  return null
}

function wantsActive(message: string): boolean {
  return /\b(ativo|ativada|ativado|active|enabled|habilitad[ao])\b/i.test(message)
}

function extractDomain(message: string): string | null {
  const match = message.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\b|\/)/i)
  return match?.[1] ?? null
}

function randomWorkloadDomain(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""

  for (let index = 0; index < 10; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return `${value}.com.br`
}

export function buildPlan(message: string, clientId: string): AgentPlan {
  const lower = message.toLowerCase()
  const active = wantsActive(message)
  const name = extractQuotedName(message)

  if (lower.includes("firewall")) {
    const firewallName = name || "Firewall Template"

    return {
      action: "create_default_firewall",
      title: `Criar firewall default "${firewallName}"`,
      clientId,
      active,
      parameters: {
        firewallName,
        debug: false
      },
      steps: [
        "Criar o Edge Firewall a partir do template 44495.",
        "Criar/associar as Function Instances do firewall, se aplicável.",
        "Localizar a Network List padrão Azion IP Tor Exit Nodes e substituir o ID fixo do template.",
        "Criar as 5 regras de request rules na ordem original.",
        `Criar tudo com active=${active}.`
      ],
      warnings: [
        "A Network List padrão de TOR será resolvida por nome: Azion IP Tor Exit Nodes.",
        "O template ainda referencia WAF 14289 e Function base 51884; em outra conta, esses IDs podem exigir mapeamento por nome depois."
      ]
    }
  }

  if (lower.includes("dns") || lower.includes("zona")) {
    const domain = extractDomain(message) || "example.com"

    return {
      action: "import_dns",
      title: `Importar DNS para "${domain}"`,
      clientId,
      active,
      parameters: {
        zoneName: domain,
        domain,
        records: []
      },
      steps: [
        "Criar zona DNS.",
        "Criar registros DNS informados.",
        `Criar zona com active=${active}.`
      ],
      warnings: [
        "Este MVP ainda espera os records como JSON estruturado na próxima evolução."
      ]
    }
  }

  const appName = name || "Application Template"
  const domain = extractDomain(message) || randomWorkloadDomain()

  return {
    action: "create_application_and_workload",
    title: `Criar Application e Workload "${appName}"`,
    clientId,
    active,
    parameters: {
      applicationName: appName,
      workloadName: appName,
      domains: [domain],
      connector: {
        name: `${appName} - httpbingo.org`,
        address: "httpbingo.org",
        host: "httpbingo.org"
      },
      workloadDomainStrategy: "random_if_not_provided",
      sourceApplicationId: 1756827464
    },
    steps: [
      "Criar a Application usando o template 1756827464, sem clone.",
      "Criar um Connector HTTP padrão apontando para httpbingo.org.",
      "Remapear o comportamento set_connector das request rules para o novo Connector.",
      "Criar Workload correspondente com domínio informado ou aleatório .com.br.",
      "Criar tudo com active=false por padrão, exceto quando o usuário pedir ativo."
    ],
    warnings: [
      "O domínio aleatório do Workload não terá DNS público apontando para a Azion; ele serve como placeholder/teste até configurar o DNS.",
      "A criação de Workload Deployment é tentada após criar o Workload para associar a Application ao Workload."
    ]
  }
}
