# Contexto do projeto

App mobile-first (Node.js) para registar pedidos de clientes, com integração ZoneSoft
(produtos via export CSV, envio de pedidos como documentos). Ver `README.md` para
comandos e caminhos.

## Decisão: sem API paga do ZoneSoft

Ficou decidido **não avançar** com a API oficial paga do ZoneSoft — o custo mais que
duplica a mensalidade atual. Não introduzir nenhuma integração que dependa dessa API.

A integração existente em `server/services/zonesoft.js` + `tools/zonesoft_create_order.py`
já não depende da API paga: usa um script que automatiza o preenchimento no site do
ZoneSoft (login/password), e está desativada por omissão (`ZONESOFT_ENABLED=1` para
ligar). Este é o caminho a manter/evoluir.

## Investigação em curso: acesso direto à base de dados do ZoneSoft

Alternativa a explorar como substituto da API paga: ligar diretamente à base de dados
local do ZoneSoft (na máquina onde o ZoneSoft está instalado) para ler dados sem custo
extra.

Isto só é viável correndo numa sessão com acesso à rede local onde o ZoneSoft está
instalado (não a partir de um ambiente cloud isolado).

Antes de tentar ligar:

1. Identificar o motor de BD que o ZoneSoft usa (procurar ficheiros `.fdb`/`.mdb`/`.mdf`,
   serviços a correr, ficheiros de configuração com connection strings).
2. Confirmar que os termos de licença do ZoneSoft não proíbem acesso direto à BD.
3. Testar só em modo leitura e, se possível, contra uma cópia/backup — não a BD de
   produção enquanto a app ZoneSoft está aberta (risco de locks/corrupção de dados).
