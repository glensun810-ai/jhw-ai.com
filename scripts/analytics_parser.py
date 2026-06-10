#!/usr/bin/env python3
"""
进化湾网站访问统计解析器 v2.2

数据流水线:
  Nginx access.log + 轮转文件  →  解析器(每5分钟cron)  →  analytics.db  →  API  →  后台

核心改进:
  1. 支持读取已轮转的旧日志文件 (*.gz, 无后缀)
  2. 位置文件超出access.log大小时自动重置并补采轮转文件
  3. 首次/全量回扫：扫描所有历史日志，pageviews_daily 表从零重建
  4. unique_ips 按(日期, path)写入该path在当日实际独立IP数，不做跨行累加
  5. total_unique_visitors = 各日该path最大unique_ips之和（合理近似）
"""

import re
import sqlite3
import datetime
import os
import gzip
from collections import defaultdict

DB = '/www/wwwroot/jhw-ai.com/database/analytics.db'
LOG = '/var/log/nginx/access.log'
POS = '/www/wwwroot/jhw-ai.com/database/analytics_position.txt'
def _is_noise_path(path):
    """判断路径是否为攻击扫描/敏感文件/非业务请求，是则返回 True（应过滤）"""
    # WordPress 扫描
    if path.startswith("/wp-") or path.startswith("/wordpress"):
        return True
    # 常见漏洞扫描与敏感文件
    noise_patterns = (
        "/.env", "/.git", "/.svn", "/.DS_Store", "/xmlrpc", "/license",
        "/readme", "/phpmyadmin", "/pma", "/adminer", "/phpinfo",
        "/shell", "/backup", "/dump", "/sql", "/db_", "/database",
        "/tmp", "/test", "/testing", "/debug", "/log", "/logs",
        "/vendor/", "/node_modules", "/composer", "/package",
        "/web/", "/web/.env",
        "/sdk/", "/SDK/",
        "/config.json", "/config.php", "/config.xml",
        "/sitemaps.xml", "/sitemap_index.xml",
    )
    if path.startswith(noise_patterns):
        return True
    # .php 直接请求（非 blog 路径）
    if path.endswith(".php") and not path.startswith("/blog/"):
        return True
    # /wp-content /wp-includes /wp-admin 全覆盖
    if "/wp-" in path or "/wp_" in path:
        return True
    return False


PT = re.compile(
    r'(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"\S+\s+(\S+)\s+\S+"\s+(\d+)'
)


def get_pos():
    try:
        with open(POS) as f:
            return int(f.read().strip())
    except Exception:
        return 0


def save_pos(p):
    os.makedirs(os.path.dirname(POS), exist_ok=True)
    with open(POS, 'w') as f:
        f.write(str(p))


def parse_lines(lines):
    """解析日志行列表，返回 (date->path->count, date->{ips})"""
    dc = {}
    di = {}
    for line in lines:
        m = PT.search(line)
        if not m:
            continue
        status = m.group(4)
        if status not in ('200', '304'):
            continue
        path = m.group(3)
        if not path.startswith('/') or path.startswith(('/admin', '/api')):
            continue
        # 过滤攻击扫描、敏感文件、第三方组件探测等非业务路径
        if _is_noise_path(path):
            continue
        ip = m.group(1)
        try:
            ts = m.group(2).split(' ')[0]
            dt = datetime.datetime.strptime(ts, '%d/%b/%Y:%H:%M:%S')
        except Exception:
            continue
        dk = dt.date().isoformat()
        if dk not in dc:
            dc[dk] = {}
            di[dk] = {}
        if path not in dc[dk]:
            dc[dk][path] = 0
            di[dk][path] = set()
        dc[dk][path] += 1
        di[dk][path].add(ip)
    return dc, di


def parse_file(filepath):
    """解析单个文件(自动检测gzip)"""
    try:
        with open(filepath, 'rb') as f:
            raw = f.read()
        if raw[:2] == b'\x1f\x8b':
            text = gzip.decompress(raw).decode('utf-8', errors='replace')
        else:
            text = raw.decode('utf-8', errors='replace')
    except Exception as e:
        print(f'    [skip] {os.path.basename(filepath)}: {e}')
        return {}, {}
    return parse_lines(text.split('\n'))


def is_rotated_log(filename):
    return filename.startswith('access.log-') and filename != 'access.log'


def init_db(c):
    c.execute('''CREATE TABLE IF NOT EXISTS pageviews_daily (
        date TEXT, path TEXT, count INTEGER DEFAULT 0,
        unique_ips INTEGER DEFAULT 0, PRIMARY KEY (date,path)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS summary (
        metric TEXT PRIMARY KEY, value INTEGER
    )''')
    c.execute("INSERT OR IGNORE INTO summary VALUES ('total_views', 0)")
    c.execute("INSERT OR IGNORE INTO summary VALUES ('total_unique_visitors', 0)")


def write_fullscan(conn, c, dc, di):
    """全量回扫写入：从零重建，unique_ips按(date,path)写入该路径的独立IP数"""
    c.execute('DELETE FROM pageviews_daily')
    c.execute("UPDATE summary SET value=0 WHERE metric='total_views'")
    c.execute("UPDATE summary SET value=0 WHERE metric='total_unique_visitors'")

    total = 0
    daily_uv = {}
    for dk in sorted(dc.keys()):
        paths = dc[dk]
        path_ips = di[dk]
        for path, cnt in paths.items():
            uv = len(path_ips[path])
            c.execute(
                'INSERT INTO pageviews_daily (date,path,count,unique_ips) VALUES (?,?,?,?)',
                (dk, path, cnt, uv)
            )
            total += cnt
        # 该日期所有path中最大的unique_ips
        daily_uv[dk] = max(len(ips) for ips in path_ips.values())

    total_uv = sum(daily_uv.values())
    c.execute(
        'UPDATE summary SET value=? WHERE metric="total_unique_visitors"',
        (total_uv,)
    )
    c.execute(
        'UPDATE summary SET value=? WHERE metric="total_views"',
        (total,)
    )
    conn.commit()
    return total


def write_incremental(conn, c, dc, di):
    """增量写入：count累加，unique_ips精确写入该path独立IP数"""
    total_new = 0
    for dk in sorted(dc.keys()):
        paths = dc[dk]
        path_ips = di[dk]
        for path, cnt in paths.items():
            uv = len(path_ips[path])
            c.execute(
                """INSERT INTO pageviews_daily (date,path,count,unique_ips)
                   VALUES (?,?,?,?)
                   ON CONFLICT(date,path) DO UPDATE SET count=count+?""",
                (dk, path, cnt, uv, cnt)
            )
            total_new += cnt

    c.execute(
        'UPDATE summary SET value=value+? WHERE metric="total_views"',
        (total_new,)
    )

    # 重算 total_unique_visitors = 各日每条path最大unique_ips之和
    rows = c.execute(
        'SELECT date, MAX(unique_ips) FROM pageviews_daily GROUP BY date'
    ).fetchall()
    total_uv = sum(row[1] for row in rows) if rows else 0
    c.execute(
        'UPDATE summary SET value=? WHERE metric="total_unique_visitors"',
        (total_uv,)
    )
    conn.commit()
    return total_new


def run():
    log_dir = os.path.dirname(LOG)
    os.makedirs(os.path.dirname(DB), exist_ok=True)

    conn = sqlite3.connect(DB)
    c = conn.cursor()
    init_db(c)

    if not os.path.exists(LOG):
        print(f'Log not found: {LOG}')
        conn.close()
        return

    total_before = c.execute(
        "SELECT value FROM summary WHERE metric='total_views'"
    ).fetchone()
    is_fullscan = (total_before is None or total_before[0] < 10)

    files_to_parse = []
    new_pos = 0

    if is_fullscan:
        print('[fullscan] 全量回扫所有日志文件...')
        for fn in sorted(os.listdir(log_dir)):
            fp = os.path.join(log_dir, fn)
            if not os.path.isfile(fp):
                continue
            if fn == 'access.log' or is_rotated_log(fn):
                files_to_parse.append(fp)
    else:
        pos = get_pos()
        sz = os.path.getsize(LOG)

        if pos > sz:
            print(f'[rotate] 位置文件({pos}) > 日志大小({sz}), 检测到日志轮转')
            for fn in sorted(os.listdir(log_dir)):
                fp = os.path.join(log_dir, fn)
                if is_rotated_log(fn) and os.path.isfile(fp):
                    files_to_parse.append(fp)
            pos = 0

        with open(LOG) as f:
            f.seek(pos)
            new_lines = f.readlines()
            new_pos = f.tell()

        if new_lines:
            tmp_path = LOG + '.tmp_incremental'
            with open(tmp_path, 'w') as ftmp:
                ftmp.writelines(new_lines)
            files_to_parse.append(tmp_path)
        else:
            print('No new lines')

    if not files_to_parse:
        conn.close()
        return

    # 解析并合并
    merged_dc = {}
    merged_di = {}

    for fp in files_to_parse:
        fn = os.path.basename(fp)
        dc, di = parse_file(fp)
        if not dc and not di:
            continue
        file_views = sum(sum(v.values()) for v in dc.values())
        print(f'  {fn}: +{file_views} views')

        for dk, paths in dc.items():
            if dk not in merged_dc:
                merged_dc[dk] = {}
                merged_di[dk] = {}
            for path, cnt in paths.items():
                merged_dc[dk][path] = merged_dc[dk].get(path, 0) + cnt
                if path not in merged_di[dk]:
                    merged_di[dk][path] = set()
                merged_di[dk][path].update(di[dk][path])

        if fp.endswith('.tmp_incremental'):
            try:
                os.remove(fp)
            except Exception:
                pass

    if is_fullscan:
        total_new = write_fullscan(conn, c, merged_dc, merged_di)
    else:
        total_new = write_incremental(conn, c, merged_dc, merged_di)

    tr = c.execute(
        "SELECT value FROM summary WHERE metric='total_views'"
    ).fetchone()
    ur = c.execute(
        "SELECT value FROM summary WHERE metric='total_unique_visitors'"
    ).fetchone()

    conn.close()

    if not is_fullscan:
        save_pos(new_pos)

    total_now = tr[0] if tr else 0
    unique_now = ur[0] if ur else 0
    print(f'OK: +{total_new} new, total={total_now}, unique={unique_now}')


if __name__ == '__main__':
    run()



