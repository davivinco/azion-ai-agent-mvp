import fs from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function findTemplatesDir() {
  const candidates = [
    "/packages/templates",
    path.join(process.cwd(), "../../packages/templates"),
    path.join(process.cwd(), "packages/templates"),
    path.join(process.cwd(), "../packages/templates")
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

export async function GET() {
  const templatesDir = findTemplatesDir()

  const summary =
    readJson(path.join(templatesDir, "template-summary.json")) || {}

  const firewall =
    readJson(path.join(templatesDir, "default-firewall.template.json")) || {}

  const application =
    readJson(path.join(templatesDir, "static-application.template.json")) || {}

  const response = {
    templatesDir,
    defaults: {
      application: "inactive",
      workload: "inactive",
      firewall: "inactive",
      requestRules: "inactive",
      responseRules: "inactive",
      connector: "active",
      connectorReason: "Connector precisa estar ativo para ser referenciado por Rules Engine."
    },
    firewall: {
      sourceId: summary?.firewall?.source_id || summary?.firewall?.id || 44495,
      requestRulesCount:
        summary?.firewall?.request_rules_count ||
        firewall?.request_rules?.length ||
        0,
      functionsCount:
        summary?.firewall?.functions_count ||
        firewall?.functions?.length ||
        0,
      networkListsResolvedByName: ["Azion IP Tor Exit Nodes"],
      wafCreatedPerAccount: true,
      functionStillById: true
    },
    application: {
      sourceId: summary?.application?.source_id || summary?.application?.id || 1756827464,
      cacheSettingsCount:
        summary?.application?.cache_settings_count ||
        application?.cache_settings?.length ||
        0,
      requestRulesCount:
        summary?.application?.request_rules_count ||
        application?.request_rules?.length ||
        0,
      responseRulesCount:
        summary?.application?.response_rules_count ||
        application?.response_rules?.length ||
        0,
      connectorDefault: {
        address: "httpbingo.org",
        host: "httpbingo.org",
        active: true
      },
      workloadDomainStrategy: "random_if_not_provided"
    }
  }

  return Response.json(response)
}
