# ========================================
# 彩票应用 - 一键更新脚本（含 kkgithub 镜像回退）
# 用法：在 E:\lottery-app 目录下运行
#   powershell -ExecutionPolicy Bypass -File update.ps1
# 或带提交信息：
#   powershell -ExecutionPolicy Bypass -File update.ps1 -msg "更新数据"
# ========================================

param(
    [string]$msg = "更新代码"
)

Set-Location "E:\lottery-app"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  彩票应用 - 代码更新脚本" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. 可选：运行爬虫更新开奖数据
$updateData = Read-Host "`n是否先运行爬虫更新大乐透开奖数据？(y/n)"
if ($updateData -eq "y" -or $updateData -eq "Y") {
    Write-Host "`n[1/3] 正在爬取最新开奖数据..." -ForegroundColor Yellow
    python scripts/crawl_final.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "爬虫运行失败，请检查网络" -ForegroundColor Red
    } else {
        Write-Host "开奖数据已更新" -ForegroundColor Green
    }
}

# 2. 提交代码
Write-Host "`n[2/3] 正在提交代码..." -ForegroundColor Yellow
git add -A
git status --short
git commit -m $msg

# 3. 推送到 GitHub（自动镜像回退）
Write-Host "`n[3/3] 推送到 GitHub..." -ForegroundColor Yellow

# 3a. 先尝试直连 GitHub
$pushOutput = git push origin main 2>&1
$directResult = $LASTEXITCODE

if ($directResult -eq 0) {
    Write-Host "  推送成功（直连 GitHub）" -ForegroundColor Green
} elseif ($pushOutput -match "timed out|Failed to connect|Could not resolve|Connection refused|network") {
    # 3b. 网络错误 → 自动切换 kkgithub 镜像重试
    Write-Host "  直连 GitHub 失败（网络超时），切换 kkgithub 镜像推送..." -ForegroundColor Yellow

    # 配置镜像：github.com → kkgithub.com
    git config --local url."https://kkgithub.com/".insteadOf "https://github.com/"

    # 复制凭据：从 github.com 凭据生成 kkgithub.com 凭据
    $credFile = Join-Path $env:USERPROFILE ".git-credentials"
    $addedCred = $false
    if (Test-Path $credFile) {
        $lines = Get-Content $credFile -Encoding ascii
        $ghLine  = $lines | Where-Object { $_ -match "@github.com" }   | Select-Object -First 1
        $kkExist = $lines | Where-Object { $_ -match "@kkgithub.com" }
        if ($ghLine -and -not $kkExist) {
            $auth = $ghLine -replace "https://", "" -replace "@github.com.*", ""
            Add-Content $credFile "https://${auth}@kkgithub.com" -Encoding ascii
            $addedCred = $true
        }
    }

    # 通过镜像推送
    git push origin main 2>&1
    $mirrorResult = $LASTEXITCODE

    # 清理镜像配置
    git config --local --unset url."https://kkgithub.com/".insteadOf 2>$null

    # 清理临时凭据
    if ($addedCred -and (Test-Path $credFile)) {
        $lines = Get-Content $credFile -Encoding ascii
        $lines | Where-Object { $_ -notmatch "@kkgithub.com" } | Set-Content $credFile -Encoding ascii
    }

    if ($mirrorResult -eq 0) {
        Write-Host "  推送成功（通过 kkgithub 镜像）" -ForegroundColor Green
    } else {
        Write-Host "  镜像推送也失败，请检查网络或手动重试" -ForegroundColor Red
    }
} else {
    # 非网络错误（如分支冲突），镜像无法解决
    Write-Host "  推送失败（非网络原因），可能需要先同步：" -ForegroundColor Red
    Write-Host "    git pull origin main --rebase" -ForegroundColor Red
}

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "  更新完成！" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
