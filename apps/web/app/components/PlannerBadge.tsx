type PlannerBadgeProps = {
  planner?: string
}

export function PlannerBadge({ planner }: PlannerBadgeProps) {
  const value = planner || "rules"
  const label = value === "llm" ? "LLM" : "Rules"

  return (
    <span className="planner-badge" data-planner={value}>
      {label}
    </span>
  )
}
