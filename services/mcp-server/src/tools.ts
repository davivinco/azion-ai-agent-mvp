import { AzionClient } from "./azion-client.js"
import { parseDnsImport, type ProxiedOrigin } from "./dns-parser.js"
import { forceActive, readTemplate, stripUndefined, omitKeysDeep } from "./templates.js"

function buildDnsPreview(plan: Plan) {
  const rawText = String(plan.parameters.rawText || plan.originalPrompt || "")
  const parsed = parseDnsImport(
    rawText,
    String(plan.parameters.domain || plan.parameters.zoneName || "")
  )

  return {
    domain: parsed.domain,
    provider: parsed.provider,
    records: parsed.records,
    skipped: parsed.skipped,
    notes: parsed.notes,
    proxiedOrigins: parsed.proxiedOrigins
  }
}

type Plan = {
  action: string
  active: boolean
  parameters: Record<string, any>
  originalPrompt?: string
}

type FirewallTemplate = {
  firewall: Record<string, any>
  functions: Record<string, any>[]
  request_rules: Record<string, any>[]
}

type ApplicationTemplate = {
  application: Record<string, any>
  cache_settings: Record<string, any>[]
  request_rules: Record<string, any>[]
  response_rules: Record<string, any>[]
}

function randomWorkloadDomain(): string {
  return `${Math.random().toString(36).slice(2, 12)}.com.br`
}


function randomResourceSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

function withUniqueName(name: string): string {
  return `${name} - ${randomResourceSuffix()}`
}

function isNameAlreadyInUse(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('"code": "31000"')
    || message.includes('"code":"31000"')
    || message.includes('"Name Already In Use"')
}

async function postWithUniqueNameFallback(
  client: AzionClient,
  path: string,
  payload: Record<string, any>
) {
  try {
    return await client.post(path, payload)
  } catch (error) {
    if (!isNameAlreadyInUse(error) || !payload.name) {
      throw error
    }

    const retryPayload = {
      ...payload,
      name: withUniqueName(String(payload.name))
    }

    return client.post(path, retryPayload)
  }
}

function defaultHttpConnectorPayload(input: { name: string, active: boolean, address?: string, host?: string }) {
  const address = input.address || "httpbingo.org"
  const host = input.host || address

  return {
    name: input.name,
    active: input.active,
    type: "http",
    attributes: {
      addresses: [
        {
          active: input.active,
          address,
          http_port: 80,
          https_port: 443,
          modules: {
            load_balancer: {
              server_role: "primary",
              weight: 1
            }
          }
        }
      ],
      connection_options: {
        transport_policy: "force_https",
        http_version_policy: "http1_1",
        host,
        path_prefix: "",
        following_redirect: false,
        real_ip_header: "X-Real-IP",
        real_port_header: "X-Real-PORT",
        timeout_between_bytes: 120
      },
      modules: {
        load_balancer: {
          enabled: false,
          config: {
            method: "round_robin",
            max_retries: 0,
            connection_timeout: 60,
            read_write_timeout: 120
          }
        },
        origin_shield: {
          enabled: false,
          config: {
            origin_ip_acl: {
              enabled: false
            },
            hmac: {
              enabled: false
            }
          }
        }
      }
    }
  }
}

function withoutId<T extends Record<string, any>>(obj: T): T {
  const clone = structuredClone(obj)
  delete clone.id
  delete clone.source_id
  return clone
}

function remapApplicationRule(rule: Record<string, any>, cacheIdMap: Map<string, number>, connectorId?: number) {
  const cloned = structuredClone(rule)

  for (const behavior of cloned.behaviors || []) {
    const currentValue = behavior.attributes?.value

    if (behavior.type === "set_cache_policy") {
      const mapped = cacheIdMap.get(String(currentValue))
      if (mapped) behavior.attributes.value = mapped
    }

    if (behavior.type === "set_connector" && connectorId) {
      behavior.attributes.value = connectorId
    }
  }

  return cloned
}

type NetworkListSummary = {
  id: number
  name: string
  list_type?: string
}

const NETWORK_LIST_NAME_MAP: Record<string, string> = {
  "2": "Azion IP Tor Exit Nodes"
}

function extractResults(response: any): any[] {
  if (Array.isArray(response?.results)) return response.results
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response)) return response
  return []
}

async function listNetworkLists(client: AzionClient): Promise<NetworkListSummary[]> {
  const output: NetworkListSummary[] = []
  let page = 1
  let totalPages = 1

  do {
    const response: any = await client.get(`/workspace/network_lists?page=${page}&page_size=100`)
    output.push(...extractResults(response))
    totalPages = Number(response?.total_pages || response?.pagination?.total_pages || 1)
    page += 1
  } while (page <= totalPages)

  return output
}

async function resolveNetworkListsByName(client: AzionClient, names: string[]) {
  const networkLists = await listNetworkLists(client)
  const resolved = new Map<string, number>()

  for (const expectedName of names) {
    const found = networkLists.find((item) =>
      String(item.name || "").trim().toLowerCase() === expectedName.trim().toLowerCase()
    )

    if (!found?.id) {
      throw new Error(`Network List not found by name: ${expectedName}`)
    }

    resolved.set(expectedName, Number(found.id))
  }

  return resolved
}

function collectRequiredNetworkListNames(rules: Record<string, any>[]) {
  const names = new Set<string>()

  for (const rule of rules) {
    for (const group of rule.criteria || []) {
      for (const criterion of group || []) {
        const key = String(criterion.argument)
        const mappedName = NETWORK_LIST_NAME_MAP[key]
        if (mappedName) names.add(mappedName)
      }
    }
  }

  return [...names]
}

function remapFirewallRuleWaf(rule: Record<string, any>, wafId: number, active: boolean) {
  const cloned = structuredClone(rule)

  for (const behavior of cloned.behaviors || []) {
    if (behavior.type !== "set_waf") continue

    behavior.attributes = {
      ...behavior.attributes,
      waf_id: wafId,
      mode: active ? "blocking" : "logging"
    }
  }

  return cloned
}

function remapFirewallRuleNetworkLists(rule: Record<string, any>, resolvedByName: Map<string, number>) {
  const cloned = structuredClone(rule)

  for (const group of cloned.criteria || []) {
    for (const criterion of group || []) {
      const mappedName = NETWORK_LIST_NAME_MAP[String(criterion.argument)]
      if (!mappedName) continue

      const resolvedId = resolvedByName.get(mappedName)
      if (!resolvedId) {
        throw new Error(`Resolved Network List ID missing for: ${mappedName}`)
      }

      criterion.argument = resolvedId
    }
  }

  return cloned
}



export async function dryRun(plan: Plan) {
  if (plan.action === "create_default_firewall") {
    const template = readTemplate<FirewallTemplate>("default-firewall.template.json")
    return {
      action: plan.action,
      active: plan.active,
      wouldCreate: {
        firewall: {
          name: plan.parameters.firewallName,
          active: plan.active,
          modules: template.firewall.modules
        },
        functions: template.functions.length,
        requestRules: template.request_rules.map((rule) => rule.name),
        networkListsResolvedByName: collectRequiredNetworkListNames(template.request_rules),
        waf: {
          name: `${String(plan.parameters.firewallName || template.firewall.name)} - WAF`,
          createdPerAccount: true,
          mode: plan.active ? "blocking" : "logging"
        }
      }
    }
  }

  if (plan.action === "import_dns") {
    const preview = buildDnsPreview(plan)

    return {
      action: plan.action,
      active: plan.active,
      wouldCreate: {
        domain: preview.domain,
        provider: preview.provider,
        zoneName: plan.parameters.zoneName || preview.domain,
        records: preview.records,
        recordsCount: preview.records.length
      },
      skipped: preview.skipped,
      notes: withProxiedMigrationHint(preview)
    }
  }

  if (plan.action === "create_application_and_workload") {
    const template = readTemplate<ApplicationTemplate>("static-application.template.json")
    return {
      action: plan.action,
      active: plan.active,
      wouldCreate: {
        application: plan.parameters.applicationName,
        workload: plan.parameters.workloadName,
        domains: plan.parameters.domains,
        connector: plan.parameters.connector || {
          address: "httpbingo.org",
          host: "httpbingo.org"
        },
        cacheSettings: template.cache_settings.map((cache) => cache.name),
        requestRules: template.request_rules.map((rule) => rule.name),
        responseRules: template.response_rules.map((rule) => rule.name)
      }
    }
  }

  if (plan.action === "migrate_proxied_domains") {
    const preview = buildDnsPreview(plan)
    const groups = groupProxiedByOriginIp(preview.proxiedOrigins)

    return {
      action: plan.action,
      active: plan.active,
      wouldCreate: {
        domain: preview.domain,
        groups: groups.map((group) => {
          const host = pickCanonicalHostName(group.domains)

          return {
            host,
            originIp: group.originIp,
            domains: group.domains,
            certificateDomains: group.domains,
            acmeRecords: group.domains.map((fqdn) => acmeChallengeRecord(fqdn, preview.domain))
          }
        })
      },
      notes: preview.notes
    }
  }

  return {
    action: plan.action,
    active: plan.active,
    wouldCreate: plan.parameters
  }
}

export async function execute(plan: Plan, apiToken: string) {
  if (plan.action === "create_default_firewall") {
    return executeDefaultFirewall(plan, apiToken)
  }

  if (plan.action === "create_application_and_workload") {
    return executeApplicationAndWorkload(plan, apiToken)
  }

  if (plan.action === "import_dns") {
    return executeImportDns(plan, apiToken)
  }

  if (plan.action === "migrate_proxied_domains") {
    return executeMigrateProxiedDomains(plan, apiToken)
  }

  throw new Error(`Unsupported action: ${plan.action}`)
}

type FirewallStackInput = {
  name: string
  active: boolean
}

async function createFirewallStack(client: AzionClient, input: FirewallStackInput) {
  const template = readTemplate<FirewallTemplate>("default-firewall.template.json")
  const { name, active } = input

  const firewallPayload = stripUndefined({
    ...withoutId(template.firewall),
    name,
    active,
    debug: false
  })

  const firewallResponse: any = await postWithUniqueNameFallback(client, "/workspace/firewalls", firewallPayload)
  const firewallId = firewallResponse?.data?.id

  const createdFunctions: any[] = []
  for (const functionInstance of template.functions) {
    // Firewall Function Instances cannot be created with active=false in Azion API.
    // The firewall and request rules still follow the requested active flag, but
    // the function instance payload must omit active to avoid error 29002.
    const payload = omitKeysDeep(withoutId(functionInstance), new Set(["active"]))
    const response = await client.post(`/workspace/firewalls/${firewallId}/functions`, payload)
    createdFunctions.push(response)
  }

  const requiredNetworkListNames = collectRequiredNetworkListNames(template.request_rules)
  const resolvedNetworkLists = requiredNetworkListNames.length > 0
    ? await resolveNetworkListsByName(client, requiredNetworkListNames)
    : new Map<string, number>()

  const usesWaf = template.request_rules.some((rule) =>
    (rule.behaviors || []).some((behavior: Record<string, any>) => behavior.type === "set_waf")
  )

  // A WAF Ruleset only exists within the account it was created in, so the template's
  // waf_id (from the source account) can never be reused on another client. A new WAF
  // must be created here and its id substituted into the [WAF] Template rule.
  const wafResponse: any = usesWaf
    ? await postWithUniqueNameFallback(client, "/workspace/wafs", {
        name: `${name} - WAF`,
        active: true
      })
    : null
  const wafId = wafResponse?.data?.id

  const createdRules: any[] = []
  for (const rule of template.request_rules) {
    let remappedRule = remapFirewallRuleNetworkLists(withoutId(rule), resolvedNetworkLists)
    if (wafId) remappedRule = remapFirewallRuleWaf(remappedRule, wafId, active)
    const payload = forceActive(remappedRule, active)
    const response = await client.post(`/workspace/firewalls/${firewallId}/request_rules`, payload)
    createdRules.push(response)
  }

  return {
    firewall: firewallResponse,
    functions: createdFunctions,
    networkLists: Object.fromEntries(resolvedNetworkLists),
    waf: wafResponse,
    requestRules: createdRules
  }
}

async function executeDefaultFirewall(plan: Plan, apiToken: string) {
  const client = new AzionClient(apiToken)
  const template = readTemplate<FirewallTemplate>("default-firewall.template.json")
  const active = Boolean(plan.active)
  const name = String(plan.parameters.firewallName || template.firewall.name)

  return createFirewallStack(client, { name, active })
}

type ApplicationStackInput = {
  name: string
  workloadName?: string
  active: boolean
  connectorName: string
  connectorAddress: string
  connectorHost: string
  domains: string[]
  infrastructure?: number
  tlsCertificateId?: number
  edgeFirewallId?: number
}

async function createApplicationStack(client: AzionClient, input: ApplicationStackInput) {
  const template = readTemplate<ApplicationTemplate>("static-application.template.json")
  const { active } = input
  const workloadName = input.workloadName || input.name

  const applicationPayload = stripUndefined({
    ...withoutId(template.application),
    name: input.name,
    active,
    debug: false
  })

  const applicationResponse: any = await postWithUniqueNameFallback(client, "/workspace/applications", applicationPayload)
  const applicationId = applicationResponse?.data?.id
  const cacheIdMap = new Map<string, number>()

  for (const cacheSetting of template.cache_settings) {
    const oldId = String(cacheSetting.id || cacheSetting.source_id || "")
    const response: any = await client.post(
      `/workspace/applications/${applicationId}/cache_settings`,
      withoutId(cacheSetting)
    )
    if (oldId && response?.data?.id) cacheIdMap.set(oldId, response.data.id)
  }

  const connectorPayload = {
    name: input.connectorName,
    type: "http",
    active: true,
    attributes: {
      addresses: [
        {
          address: input.connectorAddress,
          http_port: 80,
          https_port: 443
        }
      ],
      connection_options: {
        transport_policy: "force_http",
        host: input.connectorHost
      },
      modules: {
        load_balancer: {
          enabled: false,
          config: null
        },
        origin_shield: {
          enabled: false,
          config: null
        }
      }
    }
  }

  const connectorResponse: any = await postWithUniqueNameFallback(client, "/workspace/connectors", connectorPayload)
  const connectorId = connectorResponse?.data?.id

  for (const rule of template.request_rules) {
    const payload = remapApplicationRule(withoutId(rule), cacheIdMap, connectorId)
    await client.post(`/workspace/applications/${applicationId}/request_rules`, forceActive(payload, active))
  }

  for (const rule of template.response_rules) {
    await client.post(`/workspace/applications/${applicationId}/response_rules`, forceActive(withoutId(rule), active))
  }

  const workloadPayload = {
    name: workloadName,
    active,
    infrastructure: input.infrastructure || 1,
    domains: input.domains,
    workload_domain_allow_access: true,
    protocols: {
      http: {
        versions: ["http1", "http2"],
        http_ports: [80],
        https_ports: [443],
        quic_ports: null
      }
    },
    tls: {
      certificate: input.tlsCertificateId ?? null,
      ciphers: 7,
      minimum_version: "tls_1_2"
    }
  }

  const workloadResponse: any = await postWithUniqueNameFallback(client, "/workspace/workloads", workloadPayload)
  const workloadId = workloadResponse?.data?.id

  let deploymentResponse: any = null
  let deploymentWarning: string | null = null

  if (workloadId && applicationId) {
    try {
      const deploymentAttributes: Record<string, any> = { edge_application: applicationId }
      if (input.edgeFirewallId) deploymentAttributes.edge_firewall = input.edgeFirewallId

      deploymentResponse = await client.post(`/workspace/workloads/${workloadId}/deployments`, {
        strategy: {
          type: "default",
          attributes: deploymentAttributes
        }
      })
    } catch (error) {
      deploymentWarning = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    application: applicationResponse,
    connector: connectorResponse,
    workload: workloadResponse,
    deployment: deploymentResponse,
    deploymentWarning
  }
}

async function executeApplicationAndWorkload(plan: Plan, apiToken: string) {
  const client = new AzionClient(apiToken)
  const active = Boolean(plan.active)

  const applicationName = String(plan.parameters.applicationName || "Application Template")
  const workloadName = String(plan.parameters.workloadName || applicationName)
  const domains = Array.isArray(plan.parameters.domains) && plan.parameters.domains.length > 0
    ? plan.parameters.domains.map(String)
    : [randomWorkloadDomain()]

  const connectorInput = typeof plan.parameters.connector === "object" && plan.parameters.connector !== null
    ? plan.parameters.connector as Record<string, any>
    : {}

  const stack = await createApplicationStack(client, {
    name: applicationName,
    workloadName,
    active,
    connectorName: String(connectorInput.name || `${applicationName} - httpbingo.org`),
    connectorAddress: String(connectorInput.address || "httpbingo.org"),
    connectorHost: String(connectorInput.host || "httpbingo.org"),
    domains,
    infrastructure: Number(plan.parameters.infrastructure || 1)
  })

  return {
    application: stack.application,
    connector: stack.connector,
    workload: stack.workload,
    deployment: stack.deployment,
    deploymentWarning: stack.deploymentWarning,
    defaults: {
      connectorAddress: "httpbingo.org",
      domains
    }
  }
}

async function postWithDnsFallback(client: AzionClient, primaryPath: string, fallbackPath: string, payload: unknown) {
  try {
    return await client.post(primaryPath, payload)
  } catch (primaryError) {
    try {
      return await client.post(fallbackPath, payload)
    } catch {
      throw primaryError
    }
  }
}

async function findOrCreateDnsZone(client: AzionClient, domain: string, zoneName: string, active: boolean) {
  try {
    return await postWithDnsFallback(client, "/edge_dns/zones", "/workspace/dns/zones", {
      name: zoneName,
      domain,
      active
    })
  } catch (createError) {
    try {
      const response: any = await client.get(`/workspace/dns/zones?domain=${encodeURIComponent(domain)}`)
      const existing = extractResults(response)[0]
      if (existing?.id) return { data: existing }
    } catch {
      // fall through and surface the original creation error below
    }

    throw createError
  }
}

function groupProxiedByOriginIp(proxiedOrigins: ProxiedOrigin[]) {
  const map = new Map<string, string[]>()

  for (const origin of proxiedOrigins) {
    const domains = map.get(origin.originIp) || []
    if (!domains.includes(origin.fqdn)) domains.push(origin.fqdn)
    map.set(origin.originIp, domains)
  }

  return Array.from(map.entries()).map(([originIp, domains]) => ({ originIp, domains }))
}

function pickCanonicalHostName(domains: string[]): string {
  const apex = domains.find((domain) => !domain.toLowerCase().startsWith("www."))
  if (apex) return apex

  const first = domains[0] || ""
  return first.toLowerCase().startsWith("www.") ? first.slice(4) : first
}

function acmeChallengeRecord(fqdn: string, zoneDomain: string) {
  const challengeFqdn = `_acme-challenge.${fqdn}`
  const lowerZone = zoneDomain.toLowerCase()
  const lowerChallenge = challengeFqdn.toLowerCase()

  const name = lowerChallenge === lowerZone
    ? "@"
    : lowerChallenge.endsWith("." + lowerZone)
      ? challengeFqdn.slice(0, -(lowerZone.length + 1))
      : challengeFqdn

  return {
    type: "CNAME",
    name,
    rdata: [`${fqdn}.letsencrypt.azion.com`],
    ttl: 300,
    description: "Let's Encrypt DNS-01 challenge (Azion AI Agent)"
  }
}

async function requestLetsEncryptCertificate(client: AzionClient, input: { name: string, domains: string[] }) {
  const [commonName, ...alternativeNames] = input.domains

  const payload: Record<string, any> = {
    name: input.name,
    authority: "lets_encrypt",
    challenge: "dns",
    common_name: commonName
  }

  if (alternativeNames.length > 0) {
    payload.alternative_names = alternativeNames
  }

  return postWithUniqueNameFallback(client, "/workspace/tls/certificates/request", payload)
}

function withProxiedMigrationHint(parsed: { notes: string[], proxiedOrigins: ProxiedOrigin[] }) {
  if (!parsed.proxiedOrigins.length) return parsed.notes

  return [
    ...parsed.notes,
    `${parsed.proxiedOrigins.length} registro(s) proxied encontrados. Para criar o stack completo (connector, application, firewall, workload e certificado Let's Encrypt) apontando para a origem real, peca: "Migre o stack completo para os dominios proxied" e cole os mesmos dados de DNS novamente.`
  ]
}

async function executeImportDns(plan: Plan, apiToken: string) {
  const client = new AzionClient(apiToken)
  const active = Boolean(plan.active)

  const rawText = String(plan.parameters.rawText || plan.originalPrompt || "")
  const currentRecords = Array.isArray(plan.parameters.records) ? plan.parameters.records : []

  const parsed = parseDnsImport(
    rawText,
    String(plan.parameters.domain || plan.parameters.zoneName || "")
  )

  const domain = String(plan.parameters.domain || parsed.domain || plan.parameters.zoneName || "").trim()

  if (!domain) {
    throw new Error("Nao foi possivel identificar o dominio/zona DNS no texto informado.")
  }

  const zoneName = String(plan.parameters.zoneName || domain)
  const records = currentRecords.length > 0 ? currentRecords : parsed.records

  if (!records.length) {
    throw new Error("Nao encontrei registros DNS validos para importar.")
  }

  const zoneResponse: any = await postWithDnsFallback(
    client,
    "/edge_dns/zones",
    "/workspace/dns/zones",
    {
      name: zoneName,
      domain,
      active
    }
  )

  const zoneId = zoneResponse?.data?.id
  const createdRecords: any[] = []
  const failedRecords: any[] = []

  for (const record of records) {
    try {
      const response = await postWithDnsFallback(
        client,
        `/edge_dns/zones/${zoneId}/records`,
        `/workspace/dns/zones/${zoneId}/records`,
        record
      )

      createdRecords.push({
        input: record,
        response
      })
    } catch (error) {
      failedRecords.push({
        input: record,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    zone: zoneResponse,
    records: createdRecords,
    failedRecords,
    parsed: {
      domain,
      provider: parsed.provider,
      totalParsed: records.length,
      skipped: parsed.skipped,
      notes: withProxiedMigrationHint(parsed)
    }
  }
}

async function executeMigrateProxiedDomains(plan: Plan, apiToken: string) {
  const client = new AzionClient(apiToken)
  const active = Boolean(plan.active)

  const rawText = String(plan.parameters.rawText || plan.originalPrompt || "")
  const parsed = parseDnsImport(rawText, String(plan.parameters.domain || plan.parameters.zoneName || ""))

  const domain = String(plan.parameters.domain || parsed.domain || plan.parameters.zoneName || "").trim()

  if (!domain) {
    throw new Error("Nao foi possivel identificar o dominio/zona DNS no texto informado.")
  }

  if (!parsed.proxiedOrigins.length) {
    throw new Error("Nenhum registro proxied encontrado no texto informado.")
  }

  const zoneName = String(plan.parameters.zoneName || domain)
  const zoneResponse: any = await findOrCreateDnsZone(client, domain, zoneName, active)
  const zoneId = zoneResponse?.data?.id

  const groups = groupProxiedByOriginIp(parsed.proxiedOrigins)
  const stacks: any[] = []

  for (const group of groups) {
    const host = pickCanonicalHostName(group.domains)

    const firewallStack = await createFirewallStack(client, { name: host, active })
    const firewallId = firewallStack.firewall?.data?.id

    const certificateResponse: any = await requestLetsEncryptCertificate(client, { name: host, domains: group.domains })
    const certificateId = certificateResponse?.data?.id

    const acmeRecords: any[] = []
    const failedAcmeRecords: any[] = []
    for (const fqdn of group.domains) {
      const record = acmeChallengeRecord(fqdn, domain)

      try {
        const response = await postWithDnsFallback(
          client,
          `/edge_dns/zones/${zoneId}/records`,
          `/workspace/dns/zones/${zoneId}/records`,
          record
        )
        acmeRecords.push({ input: record, response })
      } catch (error) {
        failedAcmeRecords.push({ input: record, error: error instanceof Error ? error.message : String(error) })
      }
    }

    const applicationStack = await createApplicationStack(client, {
      name: host,
      active,
      connectorName: host,
      connectorAddress: group.originIp,
      connectorHost: host,
      domains: group.domains,
      tlsCertificateId: certificateId,
      edgeFirewallId: firewallId
    })

    stacks.push({
      host,
      originIp: group.originIp,
      domains: group.domains,
      firewall: firewallStack.firewall,
      waf: firewallStack.waf,
      functions: firewallStack.functions,
      requestRules: firewallStack.requestRules,
      certificate: certificateResponse,
      acmeRecords,
      failedAcmeRecords,
      application: applicationStack.application,
      connector: applicationStack.connector,
      workload: applicationStack.workload,
      deployment: applicationStack.deployment,
      deploymentWarning: applicationStack.deploymentWarning
    })
  }

  return {
    zone: zoneResponse,
    stacks
  }
}
