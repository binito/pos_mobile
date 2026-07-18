# pos_online - instalação numa loja com ZoneSoft (Windows)

Esta branch (`standalone-windows`) corre tudo num único PC Windows — o mesmo
onde o ZoneSoft/SQL Server já está instalado. Não precisa de Raspberry Pi
nem de nenhum outro computador.

## Antes de instalar

- **Confirma com a Zonesoft / com o cliente** que estão de acordo com esta
  integração. Isto não é uma integração oficial suportada pela Zonesoft —
  fala diretamente com a base de dados usando tabelas internas não
  documentadas. Funciona bem na instalação onde foi testado, mas cada
  instalação de ZoneSoft pode ter esquemas ligeiramente diferentes (versões,
  customizações). O instalador verifica a compatibilidade antes de ativar a
  escrita, mas não há garantia absoluta.
- Precisas de acesso de Administrador ao PC e a uma conta Windows com
  permissões de sysadmin no SQL Server (normalmente a mesma conta que já usa
  o ZoneSoft).
- O SQL Server precisa de dois requisitos técnicos que o instalador verifica
  e pode corrigir sozinho (com a tua confirmação, porque **ambos exigem
  reiniciar o serviço do SQL Server** — o que interrompe o ZoneSoft por uns
  segundos. Faz a instalação fora do horário de funcionamento da loja):
  1. Modo de autenticação "SQL Server and Windows Authentication mode" ativo.
  2. Protocolo TCP/IP ativo, com porta fixa (o instalador usa 1433 por
     omissão). Isto é frequentemente necessário mesmo que o SQL Server já
     esteja a funcionar bem para o ZoneSoft, porque o ZS Rest liga-se
     localmente sem TCP/IP — só a app Node precisa dele.

## Instalar

1. Abre o PowerShell **como Administrador** no PC onde o ZoneSoft está instalado.
2. Corre este comando único (descarrega e arranca o instalador logo a seguir):
   ```powershell
   irm https://raw.githubusercontent.com/binito/pos_mobile/standalone-windows/install.ps1 | iex
   ```
3. Segue as instruções — o script pergunta pela instância SQL, base de
   dados, posto/empregado a usar, e credenciais de login da app.
4. No fim, o próprio script mostra o endereço de acesso (local e na rede,
   para os telemóveis) e o login criado.

Alternativa sem o comando único: copia `install.ps1` manualmente para o PC e
corre `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\install.ps1`
numa PowerShell como Administrador.

O instalador:
- Descarrega o código mais recente da branch `standalone-windows`.
- Cria um login SQL dedicado, **com privilégios mínimos** (só o necessário:
  leitura de produtos/famílias/mapa de mesas, e leitura/escrita/remoção na
  tabela de consumo).
- Verifica se o esquema da base de dados é compatível antes de ativar a
  funcionalidade de mesas.
- Regista uma tarefa agendada para arrancar sozinho ao iniciar sessão.
- Abre a porta na firewall (só na rede privada).

## Depois de instalar

- Acede a partir de um telemóvel na mesma rede: `http://<IP do PC>:8787`
- Se o esquema não for 100% compatível, a app funciona à mesma para tirar
  pedidos, mas não envia artigos para as mesas do ZoneSoft — os detalhes
  ficam nos logs (`node --env-file=.env server/scripts/check-schema.js`
  para repetir a verificação a qualquer momento).

## Reinstalar / atualizar

Corre `install.ps1` outra vez — deteta a pasta existente e pergunta se
queres sobrepor os ficheiros (o `.env` com as tuas credenciais não é
tocado a menos que apagues a pasta toda).
