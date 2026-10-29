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
if not exist "%NODE%" set "NODE=node.exe"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado.
  echo Instala Node.js LTS ou coloca node.exe junto do server.js.
  pause
  exit /b 1
)

set "PORT="
for /f "usebackq delims=" %%P in (`powershell.exe -NoLogo -NoProfile -Command "$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any,0);$l.Start();$p=([System.Net.IPEndPoint]$l.LocalEndpoint).Port;$l.Stop();$p"`) do set "PORT=%%P"
if not defined PORT (
  echo ERRO: nao foi possivel escolher uma porta livre.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"
set "HOST=0.0.0.0"
echo A iniciar Cronicas Web com Node.js na porta %PORT%...
echo Mantem esta janela aberta durante o jogo. Ctrl+C termina o servidor.
echo.

start "" /b powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:%PORT%/dm';for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2;if($r.StatusCode -eq 200){Start-Process $u;exit}}catch{};Start-Sleep -Milliseconds 500}"
"%NODE%" server.js
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo O servidor terminou com o codigo %RESULT%. Consulta as mensagens acima.
pause
exit /b %RESULT%
