#!/bin/bash
# 数据库备份脚本
# 每天自动备份，保留最近 7 天

BACKUP_DIR="/home/ubuntu/evolution_bay/database/backups"
DB_PATH="/home/ubuntu/evolution_bay/database/evolution_bay_leads.db"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/leads_$DATE.db"

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_FILE"

# 删除 7 天前的备份
find "$BACKUP_DIR" -name "leads_*.db" -mtime +7 -delete

echo "备份完成: $BACKUP_FILE"
