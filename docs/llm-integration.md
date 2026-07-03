# LLM integration

## Estado atual

Nesta versão MVP, o endpoint `POST /api/plan` ainda usa um planner determinístico em `apps/web/lib/planner.ts`.

Isso significa que o sistema já parece um agente no fluxo operacional, mas a interpretação do comando ainda é baseada em regras simples:

- identifica `firewall`, `dns`, ou Application + Workload;
- extrai nome entre aspas;
- identifica se o usuário pediu `ativo`;
- extrai domínio quando existir;
- monta um plano JSON.

## Onde o LLM deve entrar

O LLM deve substituir ou complementar o arquivo `apps/web/lib/planner.ts`.

Fluxo desejado:

```text
Usuário escreve prompt
  ↓
/api/plan
  ↓
LLM interpreta intenção
  ↓
LLM retorna JSON estruturado
  ↓
backend valida schema
  ↓
front mostra dry-run
  ↓
usuário confirma
  ↓
fila Redis Streams
  ↓
worker
  ↓
mcp-server executa tool
```

## Contrato esperado do LLM

O LLM não deve executar nada diretamente. Ele deve apenas retornar um plano estruturado:

```json
{
  "action": "create_default_firewall",
  "title": "Criar firewall default \"Firewall Template\"",
  "clientId": "9152i",
  "active": false,
  "parameters": {
    "firewallName": "Firewall Template",
    "debug": false
  },
  "steps": [],
  "warnings": []
}
```

O backend continua sendo responsável por validar o JSON e decidir qual tool pode ser chamada.

## Próximo passo sugerido

Adicionar um provider em `apps/web/lib/llm-planner.ts` com variável de ambiente:

```text
AGENT_PLANNER_MODE=rules | llm
```

Para sandbox, pode continuar em `rules`. Para o produto real, usar `llm` com Azion AI Inference ou outro provedor compatível.
