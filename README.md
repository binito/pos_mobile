# Pedidos Clientes

Webapp mobile-first para registar pedidos de clientes no telemóvel.

## Como abrir

Com o servidor ligado na rede local:

- `http://192.168.1.176:8787`
- `http://192.168.1.177:8787`

Usa o IP que estiver acessível no S22, estando o telemóvel na mesma rede.

## Produtos

A app lê os produtos diretamente do export do ZONESOFT:

`/home/jorge/Vscode/site/Produtos.csv`

Esse ficheiro já é atualizado pelos cron jobs existentes.

## Pedidos

Os pedidos ficam guardados em:

`/home/jorge/pos_mobile/data/orders.json`

Também há exportação CSV dentro da app, no separador `Pedidos`.

## Comandos

```bash
npm run check
npm run dev
pm2 list
pm2 restart pos-mobile-orders
pm2 logs pos-mobile-orders
```
