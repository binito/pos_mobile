# Análise de Refactor - POS Mobile

## Visão Geral

Webapp mobile-first para registar pedidos de clientes.

**Arquivos principais**:
- `server.js` (871 linhas) - Backend Node.js
- `public/app.js` (1049 linhas) - Frontend JavaScript puro

## Pontos Fortes

- Código bem estruturado semanticamente (funções com nomes claros)
- Boas práticas de segurança (HMAC, timingSafeEqual, sanitização)
- Tratamento adequado de erros com fallback para backup
- Cache de produtos implementado corretamente
- Service worker implementado para offline

## Oportunidades de Refactor

### 1. Backend - server.js (871 linhas)

**Problema**: Arquivo monolítico que mistura múltiplas responsabilidades.

**Estrutura atual**:
- HTTP server + request handling
- Rotas API (login, orders, products, export)
- Autenticação (cookies, tokens HMAC)
- Leitura de produtos (CSV)
- CRUD de pedidos (JSON)
- Integração ZoneSoft (Python)
- Utilitários (CSV, formatação, validação)

**Estrutura proposta**:
```
server/
├── index.js          # Entry point
├── server.js         # Criação do servidor
├── routes/
│   ├── api.js        # Endpoints REST
│   └── static.js     # Servir ficheiros estáticos
├── middleware/
│   ├── auth.js       # Autenticação
│   └── error.js      # Handler de erros
├── services/
│   ├── products.js   # Leitura de produtos
│   ├── orders.js     # CRUD de pedidos
│   └── zonesoft.js   # Integração ZoneSoft
└── utils/
    ├── csv.js        # Parsing CSV
    └── auth.js       # Tokens, cookies
```

### 2. Frontend - app.js (1049 linhas)

**Problemas**:
- Estado global (`state`) não tipado
- Lógica de renderização misturada com lógica de dados
- Duplicação de código (fetch, renderização)

**Estrutura proposta**:
```
public/
├── js/
│   ├── state.js      # Estado da aplicação
│   ├── api.js        # Chamadas API
│   ├── render.js     # Renderização UI
│   └── main.js       # Entry point
└── app.js            # Bundle único (gerado)
```

### 3. Duplicação de Código

- `roundMoney` está duplicado (server.js linha 217 e app.js linha 1002)
- Lógica de `sendOrderToZoneSoft` pode ser simplificada

### 4. Falta de Testes

- Não há testes automatizados
- Dificulta refatoração segura

## Plano de Ação Recomendado

### Fase 1 - Preparação (1-2 dias)
- [ ] Adicionar testes unitários básicos
- [ ] Documentar endpoints API
- [ ] Criar script de build/test

### Fase 2 - Refactor Backend (3-5 dias)
- [ ] Extrair módulos de autenticação
- [ ] Extrair serviços de produtos/pedidos
- [ ] Separar routes API
- [ ] Manter compatibilidade com PM2

### Fase 3 - Refactor Frontend (2-3 dias)
- [ ] Modularizar JavaScript
- [ ] Considerar TypeScript
- [ ] Otimizar carregamento

## Risco/Benefício

**Risco**: Baixo - o código atual funciona
**Benefício**: Alto - melhor manutenibilidade, testabilidade, escalabilidade

## Decisão

**Vale a pena refactorar?** ✅ SIM

Recomendação: Refactor gradual, começando pelo backend.