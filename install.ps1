<#
  Instalador do pos_online para uma nova loja com ZoneSoft (Windows).

  O que faz:
   1. Verifica se o Node.js esta instalado.
   2. Descarrega o codigo do pos_online do GitHub (branch standalone-windows).
   3. Cria um login SQL dedicado, de privilegios minimos, no SQL Server do ZoneSoft.
   4. Configura o ficheiro .env com os dados desta loja.
   5. Verifica se o esquema da base de dados e compativel.
   6. Regista uma tarefa agendada para o pos_online arrancar sozinho ao iniciar sessao.
   7. Abre a porta na firewall (rede privada).

  Corre este script como Administrador, no PC onde o ZoneSoft/SQL Server esta instalado.
#>

$ErrorActionPreference = 'Stop'

function Write-Step($text) {
    Write-Host ""
    Write-Host "== $text ==" -ForegroundColor Cyan
}

function Write-Warn2($text) {
    Write-Host "AVISO: $text" -ForegroundColor Yellow
}

function Write-Err2($text) {
    Write-Host "ERRO: $text" -ForegroundColor Red
}

function New-RandomSecret([int]$length = 24) {
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

Write-Host "=======================================" -ForegroundColor Green
Write-Host " Instalador pos_online (ZoneSoft)"       -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

# 1. Node.js -----------------------------------------------------------
Write-Step "A verificar Node.js"
try {
    $nodeVersion = (node -v)
    Write-Host "Node.js encontrado: $nodeVersion"
} catch {
    Write-Err2 "Node.js nao esta instalado ou nao esta no PATH."
    Write-Host "Instala o Node.js LTS a partir de https://nodejs.org/ e corre este script outra vez."
    exit 1
}

# 2. Pasta de instalacao -------------------------------------------------
Write-Step "Pasta de instalacao"
$installDir = Read-Host "Pasta de instalacao (Enter para C:\pos_online)"
if ([string]::IsNullOrWhiteSpace($installDir)) { $installDir = "C:\pos_online" }

if (Test-Path $installDir) {
    Write-Warn2 "A pasta '$installDir' ja existe."
    $overwrite = Read-Host "Continuar e sobrepor os ficheiros do pos_online la dentro? (s/N)"
    if ($overwrite -ne 's') { exit 1 }
} else {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# 3. Descarregar codigo do GitHub ----------------------------------------
Write-Step "A descarregar o pos_online do GitHub"
$branch = "standalone-windows"
$zipUrl = "https://github.com/binito/pos_mobile/archive/refs/heads/$branch.zip"
$zipPath = Join-Path $env:TEMP "pos_online_$branch.zip"

Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
$extractDir = Join-Path $env:TEMP "pos_online_extract"
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$sourceDir = Get-ChildItem $extractDir | Select-Object -First 1
Copy-Item "$($sourceDir.FullName)\*" $installDir -Recurse -Force
Remove-Item $zipPath -Force
Remove-Item $extractDir -Recurse -Force

Write-Host "Codigo instalado em $installDir"

# 4. npm install -----------------------------------------------------------
Write-Step "A instalar dependencias (npm install)"
Push-Location $installDir
npm install --omit=dev
Pop-Location

# 5. Dados do SQL Server ----------------------------------------------------
Write-Step "Ligacao ao SQL Server do ZoneSoft"
$sqlInstance = Read-Host "Instancia do SQL Server (Enter para localhost\ZONESOFTSQL)"
if ([string]::IsNullOrWhiteSpace($sqlInstance)) { $sqlInstance = "localhost\ZONESOFTSQL" }

Write-Host "A listar bases de dados disponiveis nesta instancia..."
try {
    sqlcmd -S $sqlInstance -E -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name NOT IN ('master','model','msdb','tempdb')"
} catch {
    Write-Err2 "Nao consegui ligar a instancia '$sqlInstance' com autenticacao Windows. Confirma o nome da instancia e tenta outra vez."
    exit 1
}

$sqlDatabase = Read-Host "Nome da base de dados do ZoneSoft (ex: zsrest_2024_0)"
if ([string]::IsNullOrWhiteSpace($sqlDatabase)) {
    Write-Err2 "Tens de indicar o nome da base de dados."
    exit 1
}

# 6. Verificar modo de autenticacao ------------------------------------------
Write-Step "A verificar modo de autenticacao do SQL Server"
$integratedOnly = sqlcmd -S $sqlInstance -E -h -1 -W -Q "SET NOCOUNT ON; SELECT SERVERPROPERTY('IsIntegratedSecurityOnly')"
if ($integratedOnly.Trim() -eq "1") {
    Write-Warn2 "Esta instancia so aceita autenticacao Windows (modo misto desativado)."
    Write-Host "Para o pos_online funcionar, tens de ativar 'SQL Server and Windows Authentication mode':"
    Write-Host "  1. Abre o SQL Server Management Studio (SSMS)"
    Write-Host "  2. Clica com o botao direito na instancia -> Properties -> Security"
    Write-Host "  3. Escolhe 'SQL Server and Windows Authentication mode'"
    Write-Host "  4. Reinicia o servico do SQL Server (isto interrompe o ZoneSoft por breves segundos - faz fora do horario de servico)"
    $cont = Read-Host "Continuar a instalacao na mesma? Vais ter de repetir os passos de SQL depois (s/N)"
    if ($cont -ne 's') { exit 1 }
}

# 6b. TCP/IP (necessario para a app Node se ligar - autenticacao Windows local nao chega) --
Write-Step "A verificar TCP/IP"
$instanceNameOnly = ($sqlInstance -split '\\')[1]
$tcpPort = "1433"
$needsTcpFix = $false
$tcpRegPath = $null

try {
    if ($instanceNameOnly) {
        $instancesKey = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL" -ErrorAction Stop
        $regInstanceId = $instancesKey.$instanceNameOnly
        $tcpRegPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$regInstanceId\MSSQLServer\SuperSocketNetLib\Tcp"
    } else {
        $tcpRegPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQLSERVER\MSSQLServer\SuperSocketNetLib\Tcp"
    }
    $tcpEnabled = (Get-ItemProperty $tcpRegPath -ErrorAction Stop).Enabled
    $existingPort = (Get-ItemProperty "$tcpRegPath\IPAll" -ErrorAction SilentlyContinue).TcpPort
    if ($tcpEnabled -eq 1 -and $existingPort) {
        $tcpPort = $existingPort
        Write-Host "TCP/IP ja esta ativo, porta $tcpPort."
    } else {
        $needsTcpFix = $true
    }
} catch {
    Write-Warn2 "Nao consegui verificar o registo automaticamente."
    $needsTcpFix = $true
}

if ($needsTcpFix) {
    Write-Warn2 "TCP/IP nao esta ativo (ou sem porta fixa) nesta instancia."
    Write-Host "A app Node precisa de TCP/IP para se ligar ao SQL Server - a autenticacao Windows local usada pelo sqlcmd nao chega."
    $fixNow = Read-Host "Ativar TCP/IP com porta fixa $tcpPort agora? Isto reinicia o SQL Server por alguns segundos (S/n)"
    if ($fixNow -ne 'n') {
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
        if (-not $isAdmin) {
            Write-Err2 "Este script nao esta a correr como Administrador. Fecha e corre outra vez com 'Executar como Administrador'."
            exit 1
        }
        Set-ItemProperty -Path $tcpRegPath -Name "Enabled" -Value 1
        Set-ItemProperty -Path "$tcpRegPath\IPAll" -Name "TcpPort" -Value $tcpPort
        Set-ItemProperty -Path "$tcpRegPath\IPAll" -Name "TcpDynamicPorts" -Value ""
        $serviceName = if ($instanceNameOnly) { "MSSQL`$$instanceNameOnly" } else { "MSSQLSERVER" }
        Write-Host "A reiniciar o servico $serviceName..."
        Restart-Service -Name $serviceName -Force
        Start-Sleep -Seconds 3
        Write-Host "TCP/IP ativo na porta $tcpPort."
    } else {
        Write-Warn2 "Sem TCP/IP, a app pos_online nao vai conseguir ligar-se ao SQL Server. Corre este script outra vez depois de resolver."
    }
}

# 7. Criar login SQL dedicado --------------------------------------------
Write-Step "A criar login SQL dedicado para o pos_online"
$dbLoginName = "pos_online_svc"
$dbLoginPassword = New-RandomSecret 24

try {
    sqlcmd -S $sqlInstance -E -v LoginName="$dbLoginName" LoginPassword="$dbLoginPassword" DatabaseName="$sqlDatabase" -i "$installDir\setup-database.sql"
} catch {
    Write-Err2 "Falhou a criar o login SQL. Verifica se o modo de autenticacao misto esta ativo e tenta outra vez."
    exit 1
}

# 8. Configuracao da aplicacao --------------------------------------------
Write-Step "Configuracao da aplicacao"
$posto = Read-Host "Numero do posto/registo a usar para artigos enviados do pos_online (Enter para 1)"
if ([string]::IsNullOrWhiteSpace($posto)) { $posto = "1" }

Write-Host "A listar empregados disponiveis..."
sqlcmd -S $sqlInstance -E -d $sqlDatabase -h -1 -W -Q "SET NOCOUNT ON; SELECT codigo, nome FROM dbo.empregados ORDER BY codigo"
$empid = Read-Host "Codigo do empregado a atribuir aos artigos enviados do pos_online"
if ([string]::IsNullOrWhiteSpace($empid)) {
    Write-Err2 "Tens de indicar um codigo de empregado valido."
    exit 1
}

$authUser = Read-Host "Utilizador de login da app pos_online (para o staff)"
$authPass = Read-Host "Password de login da app pos_online"
$port = Read-Host "Porta HTTP da app (Enter para 8787)"
if ([string]::IsNullOrWhiteSpace($port)) { $port = "8787" }

$authSecret = New-RandomSecret 32
$sqlHostOnly = ($sqlInstance -split '\\')[0]

# 9. Escrever .env -----------------------------------------------------------
Write-Step "A escrever .env"
@"
PORT=$port
HOST=0.0.0.0
MSSQL_SERVER=$sqlHostOnly
MSSQL_PORT=$tcpPort
MSSQL_DATABASE=$sqlDatabase
MSSQL_USER=$dbLoginName
MSSQL_PASSWORD=$dbLoginPassword
PRODUCTS_CACHE_TTL_MS=30000
ZONESOFT_POSTO=$posto
ZONESOFT_EMPID=$empid
POS_AUTH_USER=$authUser
POS_AUTH_PASS=$authPass
POS_AUTH_SECRET=$authSecret
TABLE_WATCH_INTERVAL_MS=30000
ZONESOFT_ENABLED=0
"@ | Out-File -FilePath "$installDir\.env" -Encoding utf8 -NoNewline

Write-Host "Ficheiro .env criado."

# 10. Verificar esquema -----------------------------------------------------
Write-Step "A verificar esquema da base de dados"
Push-Location $installDir
node --env-file=.env server\scripts\check-schema.js
$schemaExit = $LASTEXITCODE
Pop-Location

if ($schemaExit -ne 0) {
    Write-Warn2 "O esquema nao e totalmente compativel - a funcionalidade de mesas pode nao funcionar bem nesta loja."
    Write-Host "A app de pedidos vai funcionar na mesma, so a integracao com o ZoneSoft e que fica limitada."
}

# 11. Tarefa agendada ---------------------------------------------------------
Write-Step "A registar arranque automatico"
$taskName = "POS_Online_ZoneSoft"
$nodeExe = (Get-Command node.exe).Source
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "--env-file=.env server\index.js" -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "pos_online - app de pedidos ligada ao ZoneSoft" -RunLevel Limited -Force | Out-Null
Write-Host "Tarefa agendada '$taskName' criada (arranca ao iniciar sessao)."

# 12. Firewall -------------------------------------------------------------------
Write-Step "A abrir porta na firewall (rede privada)"
$ruleName = "POS_Online_$port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Profile Private -Action Allow | Out-Null
    Write-Host "Regra de firewall criada para a porta $port (rede privada)."
} else {
    Write-Host "Regra de firewall ja existia."
}

# 13. Arrancar agora e resumo -----------------------------------------------
Write-Step "A arrancar o pos_online"
Start-ScheduledTask -TaskName $taskName

$appOnline = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:$port/healthz" -TimeoutSec 2
        if ($health.ok) { $appOnline = $true; break }
    } catch {}
}

$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Instalacao concluida" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

if ($appOnline) {
    Write-Host "O pos_online esta a correr." -ForegroundColor Green
} else {
    Write-Warn2 "Nao consegui confirmar que o pos_online arrancou. Ve os logs em: Get-ScheduledTaskInfo -TaskName '$taskName'"
}

if ($schemaExit -ne 0) {
    Write-Warn2 "A funcionalidade de mesas ficou desativada (esquema incompativel) - a app funciona so para tirar pedidos."
}

Write-Host ""
Write-Host "Acesso a partir deste PC:      http://localhost:$port"
if ($localIp) {
    Write-Host "Acesso na rede (telemoveis):    http://$($localIp):$port"
}
Write-Host ""
Write-Host "Login da app:"
Write-Host "  Utilizador: $authUser"
Write-Host "  Password:   $authPass"
Write-Host ""
Write-Host "Guarda esta informacao (URL + login) num local seguro e partilha com o staff." -ForegroundColor Yellow
