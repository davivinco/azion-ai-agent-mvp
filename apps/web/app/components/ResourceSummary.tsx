type ResourceRow = {
  label: string
  name?: string
  id?: string | number
  active?: boolean
  count?: number
}

function getData(resource: any) {
  return resource?.data || resource || null
}

function singleRow(label: string, resource: any): ResourceRow | null {
  const data = getData(resource)
  if (!data) return null

  return {
    label,
    name: data.name,
    id: data.id,
    active: typeof data.active === "boolean" ? data.active : undefined
  }
}

function countRow(label: string, list: any): ResourceRow | null {
  if (!Array.isArray(list) || list.length === 0) return null
  return { label, count: list.length }
}

function buildRows(result: any): ResourceRow[] {
  if (!result) return []

  return [
    singleRow("Firewall", result.firewall),
    singleRow("WAF", result.waf),
    countRow("Function Instances", result.functions),
    countRow("Request Rules", result.requestRules),
    countRow("Response Rules", result.responseRules),
    singleRow("Application", result.application),
    singleRow("Connector", result.connector),
    singleRow("Workload", result.workload),
    singleRow("Certificado", result.certificate),
    singleRow("Deployment", result.deployment),
    singleRow("DNS Zone", result.zone),
    countRow("DNS Records", result.records),
    countRow("Registros ACME (Let's Encrypt)", result.acmeRecords),
    countRow("DNS Records com falha", result.failedRecords)
  ].filter(Boolean) as ResourceRow[]
}

function RowList({ rows }: { rows: ResourceRow[] }) {
  if (rows.length === 0) return null

  return (
    <ul className="resource-summary-list">
      {rows.map((row) => (
        <li key={row.label} className="resource-summary-row">
          <span className="resource-summary-label">{row.label}</span>
          {row.count !== undefined ? (
            <span className="resource-summary-value">{row.count}</span>
          ) : (
            <span className="resource-summary-value">
              {row.name || "—"}
              {row.id ? <span className="resource-summary-id"> · ID {row.id}</span> : null}
              {row.active !== undefined ? (
                <span className={`resource-summary-active ${row.active ? "on" : "off"}`}>
                  {row.active ? "active" : "inactive"}
                </span>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ResourceSummary({ result }: { result: any }) {
  if (!result) return null

  if (Array.isArray(result.stacks)) {
    const zoneRows = buildRows({ zone: result.zone })

    if (result.stacks.length === 0 && zoneRows.length === 0) return null

    return (
      <div className="resource-summary">
        <span className="resource-summary-title">Recursos</span>
        <RowList rows={zoneRows} />
        {result.stacks.map((stack: any) => (
          <div key={stack.host} className="resource-summary-stack">
            <span className="resource-summary-stack-title">{stack.host}</span>
            <RowList rows={buildRows(stack)} />
          </div>
        ))}
      </div>
    )
  }

  const rows = buildRows(result)
  if (rows.length === 0) return null

  return (
    <div className="resource-summary">
      <span className="resource-summary-title">Recursos</span>
      <RowList rows={rows} />
    </div>
  )
}
