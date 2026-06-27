#!/bin/bash

# Bloath CMS 开发环境启动脚本

echo "=== Bloath CMS 开发环境 ==="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "Node.js 版本: $(node -v)"

# 进入项目根目录
cd "$(dirname "$0")"

# 安装依赖（如果 node_modules 不存在）
if [ ! -d "node_modules" ]; then
    echo "安装前端依赖..."
    cd web
    npm install
    cd ..
fi

if [ ! -d "cloudflare-worker/node_modules" ]; then
    echo "安装 Worker 依赖..."
    cd cloudflare-worker
    npm install
    cd ..
fi

# 启动开发服务器
echo ""
echo "启动开发服务器..."
cd web
npm run dev &
WEB_PID=$!

echo ""
echo "启动 Cloudflare Worker..."
cd ../cloudflare-worker
npm run dev

# 清理
kill $WEB_PID 2>/dev/null
