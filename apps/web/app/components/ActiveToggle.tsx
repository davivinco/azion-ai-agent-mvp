"use client"

type ActiveToggleProps = {
  active: boolean
  onChange: (active: boolean) => void
  disabled?: boolean
}

export function ActiveToggle({ active, onChange, disabled }: ActiveToggleProps) {
  return (
    <div className="active-toggle" role="group" aria-label="Estado de criação dos recursos">
      <button
        type="button"
        className={`active-toggle-option ${!active ? "selected" : ""}`}
        onClick={() => onChange(false)}
        disabled={disabled}
      >
        Criar desabilitado
      </button>
      <button
        type="button"
        className={`active-toggle-option ${active ? "selected" : ""}`}
        onClick={() => onChange(true)}
        disabled={disabled}
      >
        Criar ativado
      </button>
    </div>
  )
}
