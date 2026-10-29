@echo off
setlocal
cd /d "%~dp0"

if not exist "server.js" (
  echo ERRO: server.js nao foi encontrado nesta pasta.
  echo Coloca este ficheiro .bat junto do server.js do repositorio Web_Conicals.
  pause
  exit /b 1
)
if not exist "public\index.html" (
  echo ERRO: public\index.html nao foi encontrado.
  pause
  exit /b 1
)

set "NODE=%~dp0node.exe"
if not exist "%NODE%" (
  set "NODE="
  for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%N"
)
if not defined NODE (
  echo ERRO: Node.js nao foi encontrado nesta pasta nem no PATH.
  echo Instala Node.js LTS ou coloca node.exe junto do server.js.
  pause
  exit /b 1
)
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado.
  echo Instala Node.js LTS ou coloca node.exe junto do server.js.
  pause
  exit /b 1
)

set "PORT="
for /f "usebackq delims=" %%P in (`powershell.exe -NoLogo -NoProfile -Command "$p=3040;while($p -le 3050){$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any,$p);try{$l.Start();$l.Stop();break}catch{$p++}};if($p -le 3050){$p}"`) do set "PORT=%%P"
if not defined PORT (
  echo ERRO: nao foi possivel escolher uma porta livre.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop';try{if(Get-NetFirewallRule -DisplayName 'CronicasWeb-LAN' -ErrorAction SilentlyContinue){exit 0}else{exit 1}}catch{exit 1}"
if errorlevel 1 (
  powershell.exe -NoLogo -NoProfile -Command "$p=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent();if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo O Windows vai pedir permissao para liberar o acesso na rede local.
    powershell.exe -NoLogo -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
    if not errorlevel 1 exit /b 0
    echo Nao foi possivel elevar esta sessao; vou iniciar o site sem alterar o firewall.
    echo Se outros dispositivos nao conseguirem ligar, executa este BAT como administrador.
  ) else (
    powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop';New-NetFirewallRule -DisplayName 'CronicasWeb-LAN' -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort '3040-3050' -RemoteAddress LocalSubnet -Profile Any -Program '%NODE%' | Out-Null"
    if errorlevel 1 (
      echo Nao foi possivel criar a regra automaticamente; o servidor vai iniciar na mesma.
      echo Se necessario, executa este BAT como administrador.
    )
  )
)

if not exist "data" mkdir "data"
set "HOST=0.0.0.0"
>"data\connection.txt" echo CRONICAS WEB - ACESSO NA REDE LOCAL
>>"data\connection.txt" echo Porta: %PORT%
>>"data\connection.txt" echo Neste computador: http://127.0.0.1:%PORT%/dm
echo.
echo ===== ENDERECOS PARA LIGACAO LOCAL =====
echo Neste computador: http://127.0.0.1:%PORT%/dm
set "FOUND_IP="
set "IP_FILE=%TEMP%\cronicas-web-ips-%RANDOM%-%RANDOM%.txt"
"%NODE%" -e "const os=require('node:os');process.stdout.write([...new Set(Object.values(os.networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal&&!a.address.startsWith('169.254.')).map(a=>a.address))].join(String.fromCharCode(10)))" > "%IP_FILE%"
for /f "usebackq delims=" %%I in ("%IP_FILE%") do (
  set "FOUND_IP=1"
  echo IP LAN %%I
  echo   DM:       http://%%I:%PORT%/dm
  echo   Player 1: http://%%I:%PORT%/player/1
  echo   Player 2: http://%%I:%PORT%/player/2
  echo   Player 3: http://%%I:%PORT%/player/3
  echo   Player 4: http://%%I:%PORT%/player/4
  echo   Player 5: http://%%I:%PORT%/player/5
  echo   Player 6: http://%%I:%PORT%/player/6
  echo   Projetor: http://%%I:%PORT%/projector
  >>"data\connection.txt" echo IP LAN %%I
  >>"data\connection.txt" echo DM: http://%%I:%PORT%/dm
  >>"data\connection.txt" echo Player 1: http://%%I:%PORT%/player/1
  >>"data\connection.txt" echo Player 2: http://%%I:%PORT%/player/2
  >>"data\connection.txt" echo Player 3: http://%%I:%PORT%/player/3
  >>"data\connection.txt" echo Player 4: http://%%I:%PORT%/player/4
  >>"data\connection.txt" echo Player 5: http://%%I:%PORT%/player/5
  >>"data\connection.txt" echo Player 6: http://%%I:%PORT%/player/6
  >>"data\connection.txt" echo Projetor: http://%%I:%PORT%/projector
)
del "%IP_FILE%" >nul 2>&1
if not defined FOUND_IP echo Nenhum IPv4 LAN encontrado; liga o Wi-Fi ou cabo de rede e inicia novamente.
echo Enderecos guardados em data\connection.txt
echo =========================================
echo.
echo A iniciar Cronicas Web com Node.js na porta %PORT%...
echo Para outros dispositivos na mesma rede, usa o endereco "Rede local" que aparece abaixo.
echo O endereco do DM termina em /dm; os jogadores usam /player/1 ate /player/6 e o projetor /projector.
echo Se a ligacao for bloqueada, permite o Node.js na rede privada no Firewall do Windows.
echo Mantem esta janela aberta durante o jogo. Ctrl+C termina o servidor.
echo.

start "" /b powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:%PORT%/dm';for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2;if($r.StatusCode -eq 200){Start-Process $u;exit}}catch{};Start-Sleep -Milliseconds 500}"
"%NODE%" server.js
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo O servidor terminou com o codigo %RESULT%. Consulta as mensagens acima.
pause
exit /b %RESULT%

