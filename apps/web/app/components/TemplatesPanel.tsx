"use client"

import { useEffect, useState } from "react"

type TemplatesInfo = {
  defaults: Record<string, string>
  firewall: {
    sourceId: number
    requestRulesCount: number
    functionsCount: number
    networkListsResolvedByName: string[]
    wafCreatedPerAccount: boolean
    functionStillById: boolean
  }
  application: {
    sourceId: number
    cacheSettingsCount: number
    requestRulesCount: number
    responseRulesCount: number
    connectorDefault: {
      address: string
      host: string
      active: boolean
    }
    workloadDomainStrategy: string
  }
}

export function TemplatesPanel() {
  const [data, setData] = useState<TemplatesInfo | null>(null)

  async function loadTemplates() {
    try {
      const res = await fetch("/api/templates")
      const json = await res.json()
      setData(json)
    } catch {
      setData(null)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  return (
    <div className="templates-card">
      <div className="templates-header">
        <span className="label">Templates</span>
        <button className="mini-btn" type="button" onClick={loadTemplates}>
          Atualizar
        </button>
      </div>

      {!data ? (
        <p className="empty-history">Não foi possível carregar os templates.</p>
      ) : (
        <div className="templates-list">
          <details>
            <summary>Firewall Template</summary>
            <ul>
              <li>Source ID: {data.firewall.sourceId}</li>
              <li>Request Rules: {data.firewall.requestRulesCount}</li>
              <li>Functions: {data.firewall.functionsCount}</li>
              <li>Network List por nome: Azion IP Tor Exit Nodes</li>
              <li>WAF: {data.firewall.wafCreatedPerAccount ? "criado novo por conta (WAF Ruleset)" : "por ID fixo"}</li>
            </ul>
          </details>

          <details>
            <summary>Application Template</summary>
            <ul>
              <li>Source ID: {data.application.sourceId}</li>
              <li>Cache Settings: {data.application.cacheSettingsCount}</li>
              <li>Request Rules: {data.application.requestRulesCount}</li>
              <li>Response Rules: {data.application.responseRulesCount}</li>
              <li>Connector: {data.application.connectorDefault.address}</li>
            </ul>
          </details>

          <details>
            <summary>Defaults</summary>
            <ul>
              <li>Application: inactive</li>
              <li>Workload: inactive</li>
              <li>Firewall: inactive</li>
              <li>Rules: inactive</li>
              <li>Connector: active</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}
