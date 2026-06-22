# Servidor web local para "Mi Carrera" — Plan de Estudios
# Sirve los archivos de esta carpeta en http://localhost:5500/
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = 'http://localhost:5500/'

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  Write-Host "No se pudo iniciar (¿ya hay un servidor en el puerto 5500?)." -ForegroundColor Yellow
  Write-Host "Abrí http://localhost:5500/ en tu navegador." -ForegroundColor Yellow
  Start-Sleep 4; exit
}

Write-Host ""
Write-Host "  Servidor activo en $prefix" -ForegroundColor Green
Write-Host "  Carpeta: $root"
Write-Host "  Dejá esta ventana abierta mientras usás la página."
Write-Host "  Para cerrar el servidor: cerrá esta ventana." -ForegroundColor DarkGray
Write-Host ""

$mimes = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.js'='application/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.pdf'='application/pdf'
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
    if ($rel -eq '/') { $rel = '/index.html' }
    $path = Join-Path $root ($rel.TrimStart('/') -replace '/', '\')
    if (Test-Path $path -PathType Leaf) {
      $bytes = [IO.File]::ReadAllBytes($path)
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $ctx.Response.ContentType = if ($mimes.ContainsKey($ext)) { $mimes[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.OutputStream.Close()
  } catch { }
}
