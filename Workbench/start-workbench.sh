#!/bin/bash
# 个人工作台启动脚本（由 LaunchAgent 调用，常驻后台）
export PATH="/Users/mac/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH"
export PERSONAL_DASHBOARD_VAULT_ROOT="/Users/mac/.workbuddy/wiki-knowledge"
export PERSONAL_DASHBOARD_HOST="127.0.0.1"
cd /Users/mac/workspace/sun-ai-workspace/person_dashboard/Workbench
exec npm run dev
