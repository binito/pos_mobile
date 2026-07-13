# Plano de Refactor - POS Mobile

## Contexto

**Problema**: O projecto tem arquitetura monolítica que dificulta manutenção e testes.

**Motivo**: 
- Backend: 871 linhas em `server.js` com múltiplas responsabilidades
- Frontend: 1049 linhas em `app.js` com estado global não tipado
- Falta de testes automatizados

**Objetivo**: Refatorar para arquitetura modular mantendo compatibilidade com PM2.

---

## Estrutura Proposta

### Backend (server.js → server/)

```
server/
├── index.js           # Entry point - server.listen()
├── server.js          # HTTP server creation
├── routes/
│   ├── api.js         # Endpoints REST
│   └── static.js      # Servir ficheiros estáticos
├── middleware/
│   ├── auth.js        # Autenticação (cookies, tokens)
│   └── error.js       # Handler de erros HTTP
├── services/
│   ├── products.js    # Leitura de produtos (CSV)
│   ├── orders.js      # CRUD de pedidos (JSON)
│   └── zonesoft.js    # Integração ZoneSoft
└── utils/
    ├── csv.js         # Parsing CSV
    └── format.js      # Formatação (money, dates)
```

### Frontend (public/app.js → public/js/)

```
public/js/
├── state.js           # Estado da aplicação (state object)
├── api.js             # Chamadas API (apiGet, parseApiResponse)
├── ui/
│   ├── render.js      # Renderização DOM
│   ├── events.js      # Bindings de eventos
│   └── components.js  # Componentes reutilizáveis
├── utils/
│   ├── format.js      # formatMoney, formatDate
│   └── string.js      # escapeHtml, normalizeText
└── main.js            # Entry point
```

---

## Fase 1: Backup e Preparação ✅

- [x] Inicializar git e criar commit de backup
- [x] Documentar estrutura atual

---

## Fase 2: Refactor Backend

### Etapa 2.1: Criar estrutura de pastas
```bash
mkdir -p server/{routes,middleware,services,utils}
```

### Etapa 2.2: Extrair utilitários (server/utils/format.js)
Funções: `roundMoney`, `sanitizeNext`, `escapeHtml` (se houver)

### Etapa 2.3: Extrair autenticação (server/middleware/auth.js)
Funções: `isAuthenticated`, `makeAuthToken`, `signAuth`, `authCookie`, `clearAuthCookie`

### Etapa 2.4: Extrair serviços
- `server/services/products.js` - `readProducts`
- `server/services/orders.js` - `readOrders`, `writeOrders`, `nextOrderId`
- `server/services/zonesoft.js` - `sendOrderToZoneSoft`

### Etapa 2.5: Criar middleware de erro (server/middleware/error.js)
Handler centralizado de erros HTTP

### Etapa 2.6: Separar rotas (server/routes/api.js)
Extrair `handleApi` para rotas específicas

### Etapa 2.7: Criar entry point (server/index.js)
Reexportar e iniciar servidor

---

## Fase 3: Refactor Frontend

### Etapa 3.1: Extrair estado (public/js/state.js)
Variável `state` e funções relacionadas

### Etapa 3.2: Extrair API (public/js/api.js)
Funções: `apiGet`, `parseApiResponse`, `loadInitialData`, `loadOrders`

### Etapa 3.3: Extrair utilitários (public/js/utils/)
Funções de formatação e string

### Etapa 3.4: Modularizar renderização
Separar funções de renderização em componentes

---

## Fase 4: Testes

### Testes Backend
```javascript
// test/services/products.test.js
// test/services/orders.test.js
// test/middleware/auth.test.js
```

### Testes Frontend
Usar Jest para testar funções puras

---

## Fase 5: Atualizar package.json

```json
{
  "scripts": {
    "start": "node server/index.js",
    "dev": "node server/index.js",
    "test": "node --test test/**/*.test.js",
    "check": "node --check server/index.js && node --check public/js/main.js"
  }
}
```

---

## Verificação

Após cada fase:
1. `npm run check` - Verificar sintaxe
2. Testar funcionalidade manualmente
3. Verificar logs do PM2
4. Commit com mensagem clara

---

## Arquivos Críticos a Modificar

1. `server.js` → será substituído por `server/index.js`
2. `public/app.js` → será substituído por `public/js/main.js`
3. `package.json` → atualizar scripts
4. `ecosystem.config.cjs` → atualizar path de entrada (se necessário)