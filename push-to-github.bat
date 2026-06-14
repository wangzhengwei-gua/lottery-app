@echo off
chcp 65001 >nul
echo ========================================
echo   彩票应用 - GitHub推送脚本
echo ========================================
echo.
echo 当前提交信息:
git log --oneline -1
echo.
echo 正在推送到GitHub...
echo.

cd /d "%~dp0"
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ✅ 推送成功！
) else (
    echo.
    echo ❌ 推送失败，请检查网络连接
    echo.
    echo 可能的解决方案:
    echo 1. 检查网络连接是否正常
    echo 2. 如果使用代理，设置环境变量: set HTTP_PROXY=http://127.0.0.1:7890
    echo 3. 尝试使用SSH方式推送（需要配置SSH密钥）
    echo 4. 稍后重试
)

pause
