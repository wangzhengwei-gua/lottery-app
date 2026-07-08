@echo off
chcp 65001 >nul
echo ========================================
echo   彩票应用 - GitHub推送（含镜像回退）
echo ========================================
echo.

cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -Command ^
  "$out = git push origin main 2>&1;" ^
  "$r = $LASTEXITCODE;" ^
  "if ($r -eq 0) { Write-Host '推送成功（直连 GitHub）' -ForegroundColor Green }" ^
  "elseif ($out -match 'timed out|Failed to connect|Could not resolve|network') {" ^
    "Write-Host '直连失败，切换 kkgithub 镜像...' -ForegroundColor Yellow;" ^
    "git config --local url.'https://kkgithub.com/'.insteadOf 'https://github.com/';" ^
    "$cf = Join-Path $env:USERPROFILE '.git-credentials'; $ac = $false;" ^
    "if (Test-Path $cf) {" ^
      "$ls = Get-Content $cf -Encoding ascii;" ^
      "$gh = $ls | Where-Object { $_ -match '@github.com' } | Select-Object -First 1;" ^
      "$ke = $ls | Where-Object { $_ -match '@kkgithub.com' };" ^
      "if ($gh -and -not $ke) { $a = $gh -replace 'https://','' -replace '@github.com.*',''; Add-Content $cf ('https://'+$a+'@kkgithub.com') -Encoding ascii; $ac = $true }" ^
    "};" ^
    "git push origin main 2>&1; $mr = $LASTEXITCODE;" ^
    "git config --local --unset url.'https://kkgithub.com/'.insteadOf 2>$null;" ^
    "if ($ac -and (Test-Path $cf)) { $ls = Get-Content $cf -Encoding ascii; $ls | Where-Object { $_ -notmatch '@kkgithub.com' } | Set-Content $cf -Encoding ascii };" ^
    "if ($mr -eq 0) { Write-Host '推送成功（通过镜像）' -ForegroundColor Green } else { Write-Host '镜像推送也失败' -ForegroundColor Red }" ^
  "} else {" ^
    "Write-Host '推送失败（非网络原因），可能需要: git pull origin main --rebase' -ForegroundColor Red" ^
  "}"

echo.
pause
