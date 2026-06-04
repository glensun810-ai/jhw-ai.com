# 进化湾网站 — 自动部署指南

> 文档版本: v1.0  
> 适用项目: jhw-ai.com  
> 服务器: 阿里云 ECS (120.76.156.83)  
> 仓库: `git@github.com:glensun810-ai/jhw-ai.com.git`

---

## 一、环境概览

| 组件 | 生产环境路径 | 说明 |
|---|---|---|
| **网站根目录** | `/www/wwwroot/jhw-ai.com/frontend/` | Nginx `root` 指向 |
| **静态资源** | `/www/wwwroot/jhw-ai.com/frontend/static/` | Nginx `/static/` alias |
| **后端应用** | `/www/wwwroot/jhw-ai.com/backend/evolution_bay_server.py` | Flask + SQLite |
| **数据库** | `/www/wwwroot/jhw-ai.com/database/evolution_bay_leads.db` | 线索数据 |
| **统计数据库** | `/www/wwwroot/jhw-ai.com/database/analytics.db` | 访问统计 |
| **统计解析脚本** | `/www/wwwroot/jhw-ai.com/scripts/analytics_parser.py` | cron 每5分钟 |
| **Nginx 配置** | `/etc/nginx/conf.d/jhw-ai.com.conf` | 站点配置 |
| **SSL 证书** | `/etc/nginx/ssl/jhw-ai.com.fullchain.crt` + `.key` | Let's Encrypt |
| **Python** | 3.8+ | 系统默认 |
| **Flask** | 3.0+ | pip 安装 |
| **进程管理** | `nohup` + 手动重启 | 后台运行 |

---

## 二、部署流程

### 2.1 标准部署（推荐）

```bash
# 1. 本地提交代码
cd /Users/sgl/Downloads/jhw-ai.com-v0.3
git add -A
git commit -m "描述本次变更"
git push origin master

# 2. SCP 上传到服务器（逐个文件）
for f in \
  "frontend/index.html" \
  "frontend/faq/index.html" \
  "frontend/glossary/index.html" \
  "frontend/blog/index.html" \
  "frontend/blog/guide/geo-optimization-guide.html" \
  "frontend/admin/index.html" \
  "frontend/admin/css/admin.css" \
  "frontend/admin/js/admin.js" \
  "frontend/sitemap.xml" \
  "frontend/robots.txt" \
  "frontend/static/logo.png" \
  "frontend/static/qr-wechat.png" \
  "frontend/static/wecom-qr.png" \
  "frontend/static/group-qr.png" \
  "backend/evolution_bay_server.py"; do
  scp "/Users/sgl/Downloads/jhw-ai.com-v0.3/$f" "root@120.76.156.83:/www/wwwroot/jhw-ai.com/$f"
done

# 3. SSH 到服务器重启后端
ssh root@120.76.156.83
# 在服务器上执行：
pkill -f evolution_bay_server.py
sleep 1
cd /www/wwwroot/jhw-ai.com/backend && nohup python3 evolution_bay_server.py > server.log 2>&1 &
sleep 3

# 4. 验证
curl -sk 'https://www.jhw-ai.com/health'
curl -sk -o /dev/null -w '%{http_code}' 'https://www.jhw-ai.com/'
curl -sk -o /dev/null -w '%{http_code}' 'https://www.jhw-ai.com/admin'
```

### 2.2 快速部署（仅前端改动时）

只上传前端文件时，不需要重启后端：

```bash
scp /Users/sgl/Downloads/jhw-ai.com-v0.3/frontend/admin/index.html \
    root@120.76.156.83:/www/wwwroot/jhw-ai.com/frontend/admin/index.html
# Nginx 自动服务更新后的文件，无需重启
```

### 2.3 快速部署（仅后端改动时）

```bash
scp /Users/sgl/Downloads/jhw-ai.com-v0.3/backend/evolution_bay_server.py \
    root@120.76.156.83:/www/wwwroot/jhw-ai.com/backend/evolution_bay_server.py

ssh root@120.76.156.83 "pkill -f evolution_bay_server; sleep 1; cd /www/wwwroot/jhw-ai.com/backend && nohup python3 evolution_bay_server.py > server.log 2>&1 &"
```

---

## 三、服务器上常用维护命令

### 3.1 后端管理

```bash
# 查看后端是否运行
ps aux | grep evolution_bay | grep -v grep

# 重启后端
pkill -f evolution_bay_server.py
sleep 1
cd /www/wwwroot/jhw-ai.com/backend && nohup python3 evolution_bay_server.py > server.log 2>&1 &

# 查看后端日志
tail -50 /www/wwwroot/jhw-ai.com/backend/server.log

# 测试后端本地是否正常
curl -sk 'http://127.0.0.1:5000/health'
```

### 3.2 Nginx 管理

```bash
# 测试配置语法
nginx -t

# 重载配置（不中断服务）
nginx -s reload

# 查看 Nginx 配置位置
# 主配置: /etc/nginx/nginx.conf
# 站点配置: /etc/nginx/conf.d/jhw-ai.com.conf
# 宝塔面板备份: /www/server/panel/vhost/nginx/jhw-ai.com.conf
#   → 修改后需复制到 /etc/nginx/conf.d/ 才能生效
```

### 3.3 访问统计

```bash
# 查看统计数据
TOKEN=$(curl -sk -X POST 'https://www.jhw-ai.com/admin/api/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"sgl810","password":"sgl@810SGl"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')

# 网站访问统计
curl -sk "https://www.jhw-ai.com/admin/api/analytics" \
  -H "Authorization: Bearer $TOKEN"

# 线索统计
curl -sk "https://www.jhw-ai.com/admin/api/stats" \
  -H "Authorization: Bearer $TOKEN"
```

### 3.4 数据库管理

```bash
# 查看线索数据库
sqlite3 /www/wwwroot/jhw-ai.com/database/evolution_bay_leads.db "SELECT COUNT(*) FROM leads"
sqlite3 /www/wwwroot/jhw-ai.com/database/evolution_bay_leads.db "SELECT id, name, phone, status, submit_time FROM leads ORDER BY id DESC LIMIT 10"

# 查看统计数据库
sqlite3 /www/wwwroot/jhw-ai.com/database/analytics.db "SELECT * FROM summary"
sqlite3 /www/wwwroot/jhw-ai.com/database/analytics.db "SELECT date, SUM(count) as views FROM pageviews_daily GROUP BY date ORDER BY date DESC LIMIT 7"
```

---

## 四、部署清单

每次部署前对照检查：

- [ ] 本地代码已提交并 push 到 GitHub
- [ ] 前端文件已通过 SCP 上传到服务器
- [ ] 后端文件已上传
- [ ] 后端进程已重启（仅后端变更时）
- [ ] Nginx 配置已同步（仅配置变更时）
- [ ] 首页返回 200：`curl -sk -o /dev/null -w '%{http_code}' 'https://www.jhw-ai.com/'`
- [ ] 管理后台返回 200：`curl -sk -o /dev/null -w '%{http_code}' 'https://www.jhw-ai.com/admin'`
- [ ] 静态资源返回 200：`curl -sk -o /dev/null -w '%{http_code}' 'https://www.jhw-ai.com/static/qr-wechat.png'`
- [ ] 健康检查返回 200：`curl -sk 'https://www.jhw-ai.com/health'`

---

## 五、常见问题

### Q: 后端启动报错 "unable to open database file"
**原因:** SQLite 数据库文件路径权限不足或目录不存在。  
**解决:** `mkdir -p /www/wwwroot/jhw-ai.com/database && chmod 755 /www/wwwroot/jhw-ai.com/database`

### Q: 管理后台返回 404
**原因:** Nginx 的 `/admin` 路由未正确代理到 Flask。  
**解决:** 检查 `/etc/nginx/conf.d/jhw-ai.com.conf` 中 `location /admin` 是否存在且 `proxy_pass` 正确。

### Q: 静态资源 404
**原因:** `/static/` 的 `alias` 路径不正确。  
**解决:** 确认 `location /static/ { alias /www/wwwroot/jhw-ai.com/frontend/static/; }`

### Q: Nginx 配置修改后不生效
**原因:** 宝塔面板的配置路径（`/www/server/panel/vhost/nginx/`）与实际 Nginx 加载路径（`/etc/nginx/conf.d/`）不一致。  
**解决:** `cp /www/server/panel/vhost/nginx/jhw-ai.com.conf /etc/nginx/conf.d/jhw-ai.com.conf && nginx -s reload`

---

## 六、项目文件结构

```
jhw-ai.com-v0.3/
├── frontend/
│   ├── index.html              # 首页
│   ├── robots.txt              # SEO 爬虫规则
│   ├── sitemap.xml             # 站点地图
│   ├── faq/index.html          # FAQ 页面（8条进化湾专属）
│   ├── glossary/index.html     # 术语表（12条+转化引导）
│   ├── blog/
│   │   ├── index.html          # 知识中心（1篇已发布）
│   │   └── guide/geo-optimization-guide.html
│   ├── static/                 # 图片资源
│   │   ├── logo.png
│   │   ├── qr-wechat.png
│   │   ├── wecom-qr.png
│   │   └── group-qr.png
│   └── admin/
│       ├── index.html          # 管理后台 SPA
│       ├── css/admin.css       # 后台样式（3个响应式断点）
│       └── js/admin.js         # 后台逻辑（704行）
├── backend/
│   └── evolution_bay_server.py # Flask 后端 API
├── database/
│   └── evolution_bay_leads.db  # SQLite 数据库
├── scripts/
│   └── analytics_parser.py     # Nginx 日志解析脚本（cron）
├── nginx/
│   └── jhw-ai.conf             # Nginx 配置（部署参考）
├── DEPLOY.md                   # 本部署文档
└── 后台管理系统功能优化规划方案.md
```

---

## 七、监控

| 检查项 | 命令 | 预期 |
|---|---|---|
| 后端进程 | `ps aux | grep evolution_bay` | 应有一个 python3 进程 |
| Flask 端口 | `netstat -tlnp | grep 5000` | LISTEN |
| Nginx 进程 | `ps aux | grep nginx` | master + worker 进程 |
| 磁盘空间 | `df -h /` | 使用率 < 80% |
| 定时任务 | `crontab -l | grep analytics` | `*/5 * * * *` |
| 访问日志 | `tail -50 /var/log/nginx/access.log` | 正常请求记录 |
| 错误日志 | `tail -10 /var/log/nginx/error.log` | 无持续错误 |

---

*文档结束*
