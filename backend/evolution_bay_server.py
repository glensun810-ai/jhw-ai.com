#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
进化湾 AI 产业集群服务平台 - 表单数据接收服务
接收表单提交，存入 SQLite 数据库，并提供管理后台
增强版：数据验证、重复提交防护、搜索、导出、统计分析
"""

from flask import Flask, request, jsonify, render_template_string, send_file, send_from_directory, g, Response
from flask.views import MethodView
import sqlite3
import datetime
import csv
import io
import os
import hashlib
import hmac
import base64
import time
import json
import re
from functools import wraps

try:
    import bcrypt
    USE_BCRYPT = True
except ImportError:
    USE_BCRYPT = False

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key-change-in-production')

# 数据库初始化
DB_PATH = os.environ.get('DB_PATH', '/home/ubuntu/evolution_bay/database/evolution_bay_leads.db')
# 管理后台 SPA 静态文件路径
ADMIN_SPA_DIR = os.environ.get('ADMIN_SPA_DIR',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'admin'))

# 管理后台认证（从环境变量读取，生产环境必须设置）
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')

_admin_password = os.environ.get('ADMIN_PASSWORD', 'changeme')
if USE_BCRYPT:
    ADMIN_PASSWORD_HASH = bcrypt.hashpw(_admin_password.encode(), bcrypt.gensalt())
else:
    ADMIN_PASSWORD_HASH = hashlib.sha256(_admin_password.encode()).hexdigest()

TOKEN_SECRET = os.environ.get('TOKEN_SECRET', app.secret_key).encode()
TOKEN_EXPIRY_HOURS = int(os.environ.get('TOKEN_EXPIRY_HOURS', '12'))
LEGACY_TOKEN = os.environ.get('LEGACY_TOKEN', '')

LOGIN_ATTEMPT_LIMIT = 5
LOGIN_LOCKOUT_MINUTES = 15
_login_attempts = {}


def verify_password(password):
    """验证密码（兼容 bcrypt 和 SHA256）"""
    if USE_BCRYPT:
        return bcrypt.checkpw(password.encode(), ADMIN_PASSWORD_HASH)
    else:
        return hashlib.sha256(password.encode()).hexdigest() == ADMIN_PASSWORD_HASH


def get_client_ip():
    """获取客户端真实 IP"""
    ip = request.headers.get('X-Forwarded-For', '')
    if ip:
        return ip.split(',')[0].strip()
    ip = request.headers.get('X-Real-IP', '')
    if ip:
        return ip.strip()
    return request.remote_addr


def check_login_lockout(ip):
    """检查 IP 是否被锁定"""
    if ip not in _login_attempts:
        return False, 0
    attempts, lock_time = _login_attempts[ip]
    if attempts >= LOGIN_ATTEMPT_LIMIT:
        elapsed = time.time() - lock_time
        if elapsed < LOGIN_LOCKOUT_MINUTES * 60:
            remaining = int((LOGIN_LOCKOUT_MINUTES * 60 - elapsed) / 60)
            return True, remaining
        else:
            del _login_attempts[ip]
    return False, 0


def record_login_failure(ip):
    """记录登录失败尝试"""
    if ip in _login_attempts:
        attempts, _ = _login_attempts[ip]
        _login_attempts[ip] = (attempts + 1, time.time())
    else:
        _login_attempts[ip] = (1, time.time())


def reset_login_attempts(ip):
    """重置登录尝试计数（登录成功后）"""
    if ip in _login_attempts:
        del _login_attempts[ip]


def generate_token(username):
    """生成 HMAC 签名的登录 token"""
    expiry = int(time.time()) + TOKEN_EXPIRY_HOURS * 3600
    payload = f'{username}.{expiry}'
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    sig = hmac.new(TOKEN_SECRET, payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
    return f'{payload_b64}.{sig}'


def verify_token(token):
    """验证 token，返回 (valid, username)"""
    try:
        parts = token.split('.')
        if len(parts) != 2:
            return False, None
        payload_b64, sig = parts
        # 验证签名
        expected_sig = hmac.new(TOKEN_SECRET, payload_b64.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected_sig):
            return False, None
        # 补齐 base64 padding
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        payload = base64.urlsafe_b64decode(payload_b64).decode()
        username, expiry_str = payload.split('.', 1)
        expiry = int(expiry_str)
        if time.time() > expiry:
            return False, None
        return True, username
    except Exception:
        return False, None

def init_db():
    """初始化数据库，扩展字段"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 创建主表（如果不存在）
    c.execute('''
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            company TEXT,
            phone TEXT NOT NULL,
            wechat TEXT,
            service TEXT,
            budget TEXT,
            details TEXT,
            submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT '新提交',
            note TEXT,
            ip_address TEXT,
            user_agent TEXT,
            referrer TEXT,
            form_source TEXT DEFAULT 'website'
        )
    ''')
    
    # 检查并添加新字段（兼容旧数据库）
    c.execute("PRAGMA table_info(leads)")
    columns = [row[1] for row in c.fetchall()]
    
    if 'ip_address' not in columns:
        c.execute('ALTER TABLE leads ADD COLUMN ip_address TEXT')
    if 'user_agent' not in columns:
        c.execute('ALTER TABLE leads ADD COLUMN user_agent TEXT')
    if 'referrer' not in columns:
        c.execute('ALTER TABLE leads ADD COLUMN referrer TEXT')
    if 'form_source' not in columns:
        c.execute('ALTER TABLE leads ADD COLUMN form_source TEXT DEFAULT "website"')
    
    # 创建提交记录表（防重复）
    c.execute('''
        CREATE TABLE IF NOT EXISTS submit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_hash TEXT NOT NULL,
            submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT
        )
    ''')
    
    c.execute('CREATE TABLE IF NOT EXISTS lead_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, action TEXT NOT NULL, field_name TEXT, old_value TEXT, new_value TEXT, operator TEXT DEFAULT "admin", created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
    
    # 添加索引（优化查询性能）
    c.execute('CREATE INDEX IF NOT EXISTS idx_leads_submit_time ON leads(submit_time)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_leads_service ON leads(service)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_leads_name ON leads(name)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_submit_logs_phone_hash ON submit_logs(phone_hash)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_lead_logs_lead_id ON lead_logs(lead_id)')
    
    conn.commit()
    conn.close()

init_db()


def add_lead_log(lead_id, action, field_name=None, old_value=None, new_value=None, operator="admin"):
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("INSERT INTO lead_logs (lead_id, action, field_name, old_value, new_value, operator) VALUES (?,?,?,?,?,?)", (lead_id, action, field_name, old_value, new_value, operator))
            conn.commit()
    except Exception:
        pass

def get_lead_logs(lead_id):
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            logs = [dict(row) for row in conn.execute("SELECT * FROM lead_logs WHERE lead_id=? ORDER BY created_at DESC LIMIT 50", (lead_id,)).fetchall()]
        return logs
    except Exception:
        return []

def get_db():
    """获取数据库连接"""
    if not hasattr(g, 'db'):
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'db'):
        g.db.close()

def hash_phone(phone):
    """对手机号进行哈希（用于防重复提交）"""
    return hashlib.sha256(phone.encode()).hexdigest()[:16]

def is_duplicate_submit(phone, ip_address, minutes=30):
    """检查是否在指定时间内重复提交"""
    phone_hash = hash_phone(phone)
    try:
        with sqlite3.connect(DB_PATH) as conn:
            count = conn.execute('''
                SELECT COUNT(*) FROM submit_logs 
                WHERE phone_hash = ? AND submit_time > datetime('now', ?)
            ''', (phone_hash, f'-{minutes} minutes')).fetchone()[0]
        return count > 0
    except Exception:
        return False

def log_submission(phone, ip_address):
    """记录提交日志"""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute('''
                INSERT INTO submit_logs (phone_hash, ip_address)
                VALUES (?, ?)
            ''', (hash_phone(phone), ip_address))
            conn.commit()
    except Exception:
        pass

def validate_phone(phone):
    """验证手机号格式（支持中国大陆和香港）"""
    if not phone:
        return False, '手机号不能为空'
    
    # 移除所有空格和特殊字符
    phone_clean = re.sub(r'[\s\-\+]', '', phone)
    
    # 中国大陆手机号：1[3-9]\d{9}
    if re.match(r'^1[3-9]\d{9}$', phone_clean):
        return True, 'ok'
    
    # 香港手机号：852开头或8位数字
    if re.match(r'^(852)?\d{8}$', phone_clean):
        return True, 'ok'
    
    return False, '请输入有效的手机号码'

def validate_name(name):
    """验证姓名"""
    if not name or len(name.strip()) < 2:
        return False, '姓名至少需要2个字符'
    if len(name) > 50:
        return False, '姓名不能超过50个字符'
    return True, 'ok'

def get_service_label(service_value):
    """将服务值转换为可读标签"""
    service_map = {
        'ai-marketing': 'AI 营销与增长',
        'ai-video': 'AI 视频与数字人',
        'ai-startup': 'AI 创业孵化',
        'ai-certification': 'AI 人才认证与培训',
        'ai-investment': 'AI 投融资对接',
        'ai-tools': 'AI 技术部署',
        'ai-compliance': 'AI 合规与风控',
        'ai-industry': '行业 AI 解决方案',
        'other': '其他 AI 相关需求',
        'AI训练师培训': 'AI 训练师培训'
    }
    return service_map.get(service_value, service_value or '-')

def get_budget_label(budget_value):
    """将预算值转换为可读标签"""
    budget_map = {
        '1万以内': '1万元以内',
        '1-5万': '1 - 5万元',
        '5-20万': '5 - 20万元',
        '20万以上': '20万元以上',
        '面议': '需进一步沟通'
    }
    return budget_map.get(budget_value, budget_value or '-')

# ==================== API 路由 ====================

@app.route('/api/submit', methods=['POST'])
def submit_form():
    """接收表单提交（增强版）"""
    try:
        data = request.form
        
        # 数据验证
        name = data.get('name', '').strip()
        phone = data.get('phone', '').strip()
        company = data.get('company', '').strip()
        wechat = data.get('wechat', '').strip()
        service = data.get('service', '').strip()
        budget = data.get('budget', '').strip()
        details = data.get('details', '').strip()
        form_source = data.get('source', 'website').strip()
        
        # 验证姓名
        valid, msg = validate_name(name)
        if not valid:
            return jsonify({'code': -1, 'msg': msg})
        
        # 验证手机号
        valid, msg = validate_phone(phone)
        if not valid:
            return jsonify({'code': -1, 'msg': msg})
        
        # 验证公司名称（如果有）
        if company and len(company) > 100:
            return jsonify({'code': -1, 'msg': '公司名称不能超过100个字符'})
        
        # 验证需求描述长度
        if details and len(details) > 2000:
            return jsonify({'code': -1, 'msg': '需求描述不能超过2000个字符'})
        
        # 防重复提交（30分钟内同一手机号只能提交一次）
        ip_address = request.remote_addr
        if is_duplicate_submit(phone, ip_address):
            return jsonify({
                'code': -2, 
                'msg': '您最近已提交过需求，我们的顾问会尽快联系您。如有紧急需求，请直接拨打 18718528592。'
            })
        
        # 获取请求信息
        user_agent = request.headers.get('User-Agent', '')
        referrer = request.headers.get('Referer', '')
        
        # 存入数据库
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO leads (name, company, phone, wechat, service, budget, details, 
                             ip_address, user_agent, referrer, form_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            name, company, phone, wechat, service, budget, details,
            ip_address, user_agent, referrer, form_source
        ))
        lead_id = c.lastrowid
        conn.commit()
        conn.close()
        
        # 记录提交日志（防重复）
        log_submission(phone, ip_address)
        
        return jsonify({
            'code': 0, 
            'msg': '提交成功！我们的专业顾问将在 24 小时内与您联系。',
            'data': {'id': lead_id}
        })
        
    except Exception as e:
        return jsonify({'code': -1, 'msg': f'提交失败：{str(e)}'})

# ==================== 管理后台 ====================

def admin_required(f):
    """管理员认证装饰器（支持 URL token 和 Bearer header）"""
    @wraps(f)
    def decorated(*args, **kwargs):
        # 优先检查 Authorization header
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            valid, username = verify_token(token)
            if valid:
                return f(*args, **kwargs)
            return jsonify({'code': -3, 'msg': 'Token 已过期，请重新登录'}), 401

        # 兼容 URL query token（旧版 token 或新版 API token）
        token = request.args.get('token', '')
        if LEGACY_TOKEN and token == LEGACY_TOKEN:
            return f(*args, **kwargs)
        valid, username = verify_token(token)
        if valid:
            return f(*args, **kwargs)

        # API 请求返回 JSON，页面请求返回 HTML 登录页
        if request.path.startswith('/admin/api/'):
            return jsonify({'code': -3, 'msg': '未登录或 Token 无效'}), 401
        return render_template_string(LOGIN_TEMPLATE)
    return decorated

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """管理后台登录页 — 返回 SPA"""
    return _serve_spa()


@app.route('/admin/api/login', methods=['POST'])
def admin_api_login():
    """管理后台 API 登录（返回 JSON + token）"""
    try:
        client_ip = get_client_ip()
        
        locked, remaining = check_login_lockout(client_ip)
        if locked:
            return jsonify({'code': -4, 'msg': f'登录失败次数过多，请 {remaining} 分钟后重试'})

        data = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()

        if not username or not password:
            record_login_failure(client_ip)
            return jsonify({'code': -1, 'msg': '用户名和密码不能为空'})

        if username == ADMIN_USERNAME and verify_password(password):
            reset_login_attempts(client_ip)
            token = generate_token(username)
            return jsonify({'code': 0, 'msg': '登录成功', 'token': token})

        record_login_failure(client_ip)
        
        attempts, _ = _login_attempts.get(client_ip, (0, 0))
        remaining_attempts = LOGIN_ATTEMPT_LIMIT - attempts
        if remaining_attempts > 0:
            return jsonify({'code': -1, 'msg': f'用户名或密码错误，还剩 {remaining_attempts} 次尝试机会'})
        else:
            return jsonify({'code': -4, 'msg': f'登录失败次数过多，请 {LOGIN_LOCKOUT_MINUTES} 分钟后重试'})
    except Exception as e:
        return jsonify({'code': -1, 'msg': f'登录失败：{str(e)}'})

@app.route('/admin')
def admin_panel():
    """管理后台主页 — 返回 SPA（认证由 API 层处理）"""
    return _serve_spa()

def _serve_spa():
    """读取并返回 SPA 的 index.html"""
    spa_index = os.path.join(ADMIN_SPA_DIR, 'index.html')
    try:
        with open(spa_index, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return render_template_string(LOGIN_TEMPLATE)


@app.route('/admin/css/<path:filename>')
def admin_spa_css(filename):
    """SPA 样式文件"""
    css_dir = os.path.join(ADMIN_SPA_DIR, 'css')
    return send_from_directory(css_dir, filename)


@app.route('/admin/js/<path:filename>')
def admin_spa_js(filename):
    """SPA 脚本文件"""
    js_dir = os.path.join(ADMIN_SPA_DIR, 'js')
    return send_from_directory(js_dir, filename)


@app.route('/admin/api/leads/batch', methods=['POST'])
@admin_required
def admin_api_batch_update():
    """批量更新线索状态"""
    try:
        data = request.get_json() or {}
        lead_ids = data.get('ids', [])
        new_status = data.get('status', '').strip()
        
        if not lead_ids or not new_status:
            return jsonify({'code': -1, 'msg': '缺少必要参数'})
        
        if new_status not in ['新提交', '已联系', '沟通中', '已转化', '无效']:
            return jsonify({'code': -1, 'msg': '无效的状态值'})
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        placeholders = ','.join('?' * len(lead_ids))
        c.execute(f'UPDATE leads SET status = ? WHERE id IN ({placeholders})', 
                  [new_status] + lead_ids)
        
        updated_count = c.rowcount
        
        for lead_id in lead_ids:
            c.execute('SELECT status FROM leads WHERE id = ?', (lead_id,))
            old_status = c.fetchone()[0] if c.fetchone() else None
            add_lead_log(lead_id, '批量状态更新', 'status', old_status, new_status)
        
        conn.commit()
        conn.close()
        
        return jsonify({'code': 0, 'msg': f'成功更新 {updated_count} 条线索', 'updated': updated_count})
    except Exception as e:
        return jsonify({'code': -1, 'msg': f'批量更新失败：{str(e)}'})


@app.route('/admin/api/leads/batch/delete', methods=['POST'])
@admin_required
def admin_api_batch_delete():
    """批量删除线索"""
    try:
        data = request.get_json() or {}
        lead_ids = data.get('ids', [])
        
        if not lead_ids:
            return jsonify({'code': -1, 'msg': '缺少必要参数'})
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        for lead_id in lead_ids:
            add_lead_log(lead_id, '批量删除')
        
        placeholders = ','.join('?' * len(lead_ids))
        c.execute(f'DELETE FROM leads WHERE id IN ({placeholders})', lead_ids)
        
        deleted_count = c.rowcount
        conn.commit()
        conn.close()
        
        return jsonify({'code': 0, 'msg': f'成功删除 {deleted_count} 条线索', 'deleted': deleted_count})
    except Exception as e:
        return jsonify({'code': -1, 'msg': f'批量删除失败：{str(e)}'})


ALLOWED_SORT_COLUMNS = {
    'id', 'name', 'company', 'phone', 'wechat', 'service',
    'budget', 'submit_time', 'status'
}


def get_leads(request_or_args, page=None, per_page=None, sort_by=None, sort_order=None):
    """获取线索列表（支持搜索、筛选、分页、排序）

    兼容两种调用方式：
    - get_leads(request) — 传统方式，返回列表（用于模板渲染和导出）
    - get_leads(request, page=1, per_page=20) — 返回分页字典（用于 JSON API）
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 统一从 request.args 或传入的 dict 获取参数
    if hasattr(request_or_args, 'args'):
        args = request_or_args.args
    else:
        args = request_or_args

    search_query = args.get('q', '').strip()
    status_filter = args.get('status', '').strip()
    date_from = args.get('date_from', '').strip()
    date_to = args.get('date_to', '').strip()

    where_clause = 'WHERE 1=1'
    params = []

    if search_query:
        where_clause += ' AND (name LIKE ? OR company LIKE ? OR phone LIKE ? OR wechat LIKE ? OR details LIKE ?)'
        search_term = f'%{search_query}%'
        params.extend([search_term] * 5)

    if status_filter:
        where_clause += ' AND status = ?'
        params.append(status_filter)

    if date_from:
        where_clause += ' AND DATE(submit_time) >= ?'
        params.append(date_from)

    if date_to:
        where_clause += ' AND DATE(submit_time) <= ?'
        params.append(date_to)

    # 排序（白名单校验防 SQL 注入）
    order_by = 'submit_time DESC'
    if sort_by and sort_by in ALLOWED_SORT_COLUMNS:
        direction = 'DESC' if sort_order == 'desc' else 'ASC'
        order_by = f'{sort_by} {direction}'

    columns = ['id', 'name', 'company', 'phone', 'wechat', 'service', 'budget',
               'details', 'submit_time', 'status', 'note', 'ip_address',
               'user_agent', 'referrer', 'form_source']

    if page is not None:
        # 分页模式
        per_page = max(1, min(per_page or 20, 100))
        page = max(1, page)

        # 查询总数
        count_query = f'SELECT COUNT(*) FROM leads {where_clause}'
        c.execute(count_query, params)
        total = c.fetchone()[0]

        total_pages = max(1, (total + per_page - 1) // per_page)
        offset = (page - 1) * per_page

        # 查询数据
        c.execute(f'SELECT * FROM leads {where_clause} ORDER BY {order_by} LIMIT ? OFFSET ?',
                  params + [per_page, offset])
        rows = c.fetchall()
        conn.close()

        leads = []
        for row in rows:
            lead = dict(zip(columns, row))
            lead['service_label'] = get_service_label(lead['service'])
            lead['budget_label'] = get_budget_label(lead['budget'])
            leads.append(lead)

        return {
            'leads': leads,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': total_pages
        }

    # 传统模式（不分页，返回全部匹配结果）
    c.execute(f'SELECT * FROM leads {where_clause} ORDER BY {order_by}', params)
    rows = c.fetchall()
    conn.close()

    leads = []
    for row in rows:
        lead = dict(zip(columns, row))
        lead['service_label'] = get_service_label(lead['service'])
        lead['budget_label'] = get_budget_label(lead['budget'])
        leads.append(lead)

    return leads

def generate_csv_rows(conn, where_clause, params, order_by):
    """生成 CSV 行数据（流式生成器）"""
    yield '\ufeff'
    yield ','.join([
        'ID', '姓名', '公司', '电话', '微信', '服务类型', '预算', 
        '需求描述', '提交时间', '状态', '备注', 'IP地址', '来源页面'
    ]) + '\n'
    
    c = conn.cursor()
    c.execute(f'SELECT * FROM leads {where_clause} ORDER BY {order_by}', params)
    
    while True:
        row = c.fetchone()
        if row is None:
            break
        
        columns = ['id', 'name', 'company', 'phone', 'wechat', 'service', 'budget',
                   'details', 'submit_time', 'status', 'note', 'ip_address',
                   'user_agent', 'referrer', 'form_source']
        lead = dict(zip(columns, row))
        
        service_label = get_service_label(lead['service'])
        budget_label = get_budget_label(lead['budget'])
        
        row_data = [
            str(lead['id']),
            lead['name'] or '',
            lead['company'] or '',
            lead['phone'] or '',
            lead['wechat'] or '',
            service_label or '',
            budget_label or '',
            lead['details'] or '',
            lead['submit_time'] or '',
            lead['status'] or '',
            lead['note'] or '',
            lead['ip_address'] or '',
            lead['referrer'] or ''
        ]
        
        writer = io.StringIO()
        csv.writer(writer).writerow(row_data)
        yield writer.getvalue()


@admin_required
def _export_csv_stream(request):
    """导出 CSV（流式版本，避免内存溢出）"""
    search_query = request.args.get('q', '').strip()
    status_filter = request.args.get('status', '').strip()
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    sort_by = request.args.get('sort_by', 'submit_time')
    sort_order = request.args.get('sort_order', 'desc')
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    where_clause = 'WHERE 1=1'
    params = []
    
    if search_query:
        where_clause += ' AND (name LIKE ? OR company LIKE ? OR phone LIKE ? OR wechat LIKE ? OR details LIKE ?)'
        search_term = f'%{search_query}%'
        params.extend([search_term] * 5)
    
    if status_filter:
        where_clause += ' AND status = ?'
        params.append(status_filter)
    
    if date_from:
        where_clause += ' AND DATE(submit_time) >= ?'
        params.append(date_from)
    
    if date_to:
        where_clause += ' AND DATE(submit_time) <= ?'
        params.append(date_to)
    
    order_by = 'submit_time DESC'
    if sort_by and sort_by in ['id', 'name', 'company', 'phone', 'service', 'budget', 'submit_time', 'status']:
        direction = 'DESC' if sort_order == 'desc' else 'ASC'
        order_by = f'{sort_by} {direction}'
    
    filename = f'进化湾线索_{datetime.datetime.now().strftime("%Y%m%d_%H%M")}.csv'
    
    response = Response(generate_csv_rows(conn, where_clause, params, order_by), mimetype='text/csv')
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@app.route('/admin/export')
def export_csv():
    """导出 CSV（增强版，支持搜索筛选后的结果）"""
    return _export_csv_stream(request)


@app.route('/admin/api/export')
@admin_required
def admin_api_export_csv():
    """导出 CSV（API 版本，支持 Bearer token + query token + 日期筛选）"""
    return export_csv()

@app.route('/admin/update_status', methods=['POST'])
@admin_required
def update_status():
    """更新线索状态"""
    lead_id = request.form.get('id')
    status = request.form.get('status')
    note = request.form.get('note', '').strip()
    
    if not lead_id or not status:
        return jsonify({'code': -1, 'msg': '参数不完整'})
    
    valid_statuses = ['新提交', '联系中', '已转化', '无效线索']
    if status not in valid_statuses:
        return jsonify({'code': -1, 'msg': '无效的状态值'})
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if note:
        c.execute('UPDATE leads SET status=?, note=? WHERE id=?', (status, note, lead_id))
    else:
        c.execute('UPDATE leads SET status=? WHERE id=?', (status, lead_id))
    conn.commit()
    conn.close()
    
    return jsonify({'code': 0, 'msg': '更新成功'})

@app.route('/admin/delete', methods=['POST'])
@admin_required
def delete_lead():
    """删除线索"""
    lead_id = request.form.get('id')
    if not lead_id:
        return jsonify({'code': -1, 'msg': '参数不完整'})
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM leads WHERE id=?', (lead_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'code': 0, 'msg': '删除成功'})

@app.route('/admin/stats')
@admin_required
def stats_api():
    """获取统计数据（用于图表）- 兼容旧版"""
    return _get_stats()


@app.route('/admin/api/stats')
@admin_required
def admin_api_stats():
    """获取增强统计数据（30天趋势 + 服务分布 + 最近线索）"""
    return _get_stats()


def _get_stats():
    """内部统计查询函数"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 总线索数
    c.execute('SELECT COUNT(*) as total FROM leads')
    total = c.fetchone()['total']

    # 今日新增
    c.execute("SELECT COUNT(*) FROM leads WHERE date(submit_time) = date('now', 'localtime')")
    today_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM leads WHERE date(submit_time) = date('now', 'localtime') AND status='新提交'")
    today_new = c.fetchone()[0]

    # 按状态统计
    c.execute('SELECT status, COUNT(*) as count FROM leads GROUP BY status')
    status_stats = {row['status']: row['count'] for row in c.fetchall()}

    # 按服务类型统计
    c.execute('SELECT service, COUNT(*) as count FROM leads GROUP BY service ORDER BY count DESC LIMIT 10')
    service_stats = [{'service': get_service_label(row['service']), 'count': row['count']}
                     for row in c.fetchall()]

    # 服务类型×状态交叉统计（转化漏斗）
    c.execute('''
        SELECT service, status, COUNT(*) as count
        FROM leads
        GROUP BY service, status
        ORDER BY service, status
    ''')
    service_funnel = {}
    for row in c.fetchall():
        svc = get_service_label(row['service'])
        if svc not in service_funnel:
            service_funnel[svc] = {}
        service_funnel[svc][row['status']] = row['count']

    # 按日期统计（最近 30 天）
    c.execute('''
        SELECT DATE(submit_time) as date, COUNT(*) as count
        FROM leads
        WHERE submit_time > datetime('now', '-30 days')
        GROUP BY DATE(submit_time)
        ORDER BY date
    ''')
    daily_stats_30d = [{'date': row['date'], 'count': row['count']} for row in c.fetchall()]

    # 线索来源分析
    c.execute('SELECT form_source, COUNT(*) as count FROM leads GROUP BY form_source ORDER BY count DESC')
    source_stats = [{'source': row['form_source'] or 'website', 'count': row['count']} for row in c.fetchall()]

    # 来源趋势（最近7天）
    c.execute('''
        SELECT form_source, DATE(submit_time) as date, COUNT(*) as count
        FROM leads
        WHERE submit_time > datetime('now', '-7 days')
        GROUP BY form_source, DATE(submit_time)
        ORDER BY form_source, date
    ''')
    source_trend = [{'source': row['form_source'] or 'website', 'date': row['date'], 'count': row['count']} 
                    for row in c.fetchall()]

    # 最近 5 条线索
    columns = ['id', 'name', 'company', 'phone', 'wechat', 'service', 'budget',
               'details', 'submit_time', 'status', 'note', 'ip_address',
               'user_agent', 'referrer', 'form_source']
    c.execute('SELECT * FROM leads ORDER BY submit_time DESC LIMIT 5')
    recent_leads = []
    for row in c.fetchall():
        lead = dict(zip(columns, row))
        lead['service_label'] = get_service_label(lead['service'])
        lead['budget_label'] = get_budget_label(lead['budget'])
        recent_leads.append(lead)

    conn.close()

    return jsonify({
        'code': 0,
        'total': total,
        'today': today_count,
        'today_new': today_new,
        'status_stats': status_stats,
        'service_stats': service_stats,
        'service_funnel': service_funnel,
        'daily_stats_30d': daily_stats_30d,
        'recent_leads': recent_leads,
        'source_stats': source_stats,
        'source_trend': source_trend
    })


@app.route('/admin/api/leads')
@admin_required
def admin_api_leads():
    """分页获取线索列表（JSON API）"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    sort_by = request.args.get('sort_by', 'submit_time')
    sort_order = request.args.get('sort_order', 'desc')

    result = get_leads(request, page=page, per_page=per_page,
                       sort_by=sort_by, sort_order=sort_order)
    result['code'] = 0
    return jsonify(result)


def _get_lead_dict(lead_id):
    """获取单条线索的字典数据"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM leads WHERE id=?', (lead_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        return None

    columns = ['id', 'name', 'company', 'phone', 'wechat', 'service', 'budget',
               'details', 'submit_time', 'status', 'note', 'ip_address',
               'user_agent', 'referrer', 'form_source']
    lead = dict(zip(columns, row))
    lead['service_label'] = get_service_label(lead['service'])
    lead['budget_label'] = get_budget_label(lead['budget'])
    return lead


@app.route('/admin/api/leads/<int:lead_id>')
@admin_required
def admin_api_get_lead(lead_id):
    """获取单条线索详情"""
    lead = _get_lead_dict(lead_id)
    if not lead:
        return jsonify({'code': -1, 'msg': '线索不存在'}), 404
    return jsonify({'code': 0, 'data': lead})


@app.route('/admin/api/leads/<int:lead_id>', methods=['PUT'])
@admin_required
def admin_api_update_lead(lead_id):
    """编辑线索（支持部分更新）"""
    data = request.get_json() or {}
    if not data:
        return jsonify({'code': -1, 'msg': '请求数据为空'})

    editable_fields = ['name', 'company', 'phone', 'wechat', 'service',
                       'budget', 'details', 'status', 'note']
    updates = {}
    for field in editable_fields:
        if field in data:
            updates[field] = data[field]

    if not updates:
        return jsonify({'code': -1, 'msg': '没有可更新的字段'})

    # 状态值校验
    if 'status' in updates:
        valid_statuses = ['新提交', '联系中', '已转化', '无效线索']
        if updates['status'] not in valid_statuses:
            return jsonify({'code': -1, 'msg': '无效的状态值'})

    set_clause = ', '.join(f'{k}=?' for k in updates)
    values = list(updates.values()) + [lead_id]

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(f'UPDATE leads SET {set_clause} WHERE id=?', values)
    conn.commit()
    conn.close()

    lead = _get_lead_dict(lead_id)
    return jsonify({'code': 0, 'msg': '更新成功', 'data': lead})


@app.route('/admin/api/leads/<int:lead_id>/status', methods=['PATCH'])
@admin_required
def admin_api_update_status(lead_id):
    """快速更新线索状态"""
    data = request.get_json() or {}
    status = data.get('status', '').strip()
    note = data.get('note', '').strip()

    valid_statuses = ['新提交', '联系中', '已转化', '无效线索']
    if status not in valid_statuses:
        return jsonify({'code': -1, 'msg': '无效的状态值'})

    old_lead = _get_lead_dict(lead_id)
    old_status = old_lead["status"] if old_lead else ""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if note:
        c.execute('UPDATE leads SET status=?, note=? WHERE id=?', (status, note, lead_id))
    else:
        c.execute('UPDATE leads SET status=? WHERE id=?', (status, lead_id))
    conn.commit()
    conn.close()
    add_lead_log(lead_id, "update_status", "status", old_status, status)
    lead = _get_lead_dict(lead_id)
    return jsonify({'code': 0, 'msg': '状态更新成功', 'data': lead})


@app.route('/admin/api/leads/<int:lead_id>', methods=['DELETE'])
@admin_required
def admin_api_delete_lead(lead_id):
    """删除线索"""
    lead = _get_lead_dict(lead_id)
    if not lead:
        return jsonify({'code': -1, 'msg': '线索不存在'}), 404

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM leads WHERE id=?', (lead_id,))
    conn.commit()
    conn.close()

    return jsonify({'code': 0, 'msg': '删除成功'})



@app.route('/admin/api/analytics')
@admin_required
def admin_api_analytics():
    import sqlite3, datetime, os
    PATH_ALIAS = {
        '/':                                     ('🏠 首页', ''),
        '/training/':                            ('🎓 AI 培训介绍', ''),
        '/faq/':                                 ('❓ 常见问题（FAQ）', ''),
        '/glossary/':                            ('📖 术语库（Glossary）', ''),
        '/blog/':                                ('📝 博客列表', ''),
        '/blog/guide/geo-optimization-guide.html':       ('🌍 GEO 优化指南', ''),
        '/blog/guide/ai-startup-incubation-guide.html':  ('🚀 AI 创业孵化指南', ''),
        '/blog/guide/ai-marketing-roi-case-study.html':  ('📊 AI 营销 ROI 案例研究', ''),
        '/blog/guide/h200-b300-server-comparison.html':  ('🖥 H200 vs B300 服务器对比', ''),
        '/news/':                                ('📰 新闻动态', ''),
        '/news/article-20260621-ai-consumer.html':      ('📰 AI消费级应用新闻', ''),
        '/wechat/ai-training-guide.html':        ('💬 微信·AI 培训指南', ''),
        '/subsidy/':                             ('💰 深圳创业补贴', ''),
        '/about/':                               ('🏢 关于我们', ''),
        '/smart-agent/':                         ('🤖 智能体解决方案', ''),
    }
    db = os.path.join(os.path.dirname(DB_PATH), 'analytics.db')
    if not os.path.exists(db):
        return jsonify({'code': 0, 'data': {'total_views': 0, 'total_visitors': 0, 'today_views': 0, 'yesterday_views': 0, 'daily_trend': [], 'weekly_trend': [], 'top_pages': [], 'all_pages': [], 'page_conversion': [], 'category_stats': []}})
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    tr = c.execute("SELECT value FROM summary WHERE metric='total_views'").fetchone()
    ur = c.execute("SELECT value FROM summary WHERE metric='total_unique_visitors'").fetchone()
    ts = datetime.date.today().isoformat()
    ys = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    
    tod = c.execute("SELECT SUM(count) as v FROM pageviews_daily WHERE date=?", (ts,)).fetchone()
    yes = c.execute("SELECT SUM(count) as v FROM pageviews_daily WHERE date=?", (ys,)).fetchone()

    daily_trend = c.execute("SELECT date, SUM(count) as views FROM pageviews_daily WHERE date >= date('now', '-30 days') GROUP BY date ORDER BY date").fetchall()
    weekly_trend = c.execute("""
        SELECT strftime('%Y-%m-%d', date, 'weekday 0', '-7 days') as week_start,
               SUM(count) as views
        FROM pageviews_daily
        WHERE date >= date('now', '-90 days')
        GROUP BY week_start
        ORDER BY week_start
    """).fetchall()

    all_pages_sql = """SELECT path, SUM(count) as views, 
                          SUM(unique_ips) as unique_ips
                      FROM pageviews_daily 
                      WHERE path NOT LIKE '/wp-%'
                        AND path NOT LIKE '/.env%'
                        AND path NOT LIKE '/.git%'
                        AND path NOT LIKE '/xmlrpc%'
                        AND path NOT LIKE '/favicon%'
                        AND path NOT LIKE '/robots.txt'
                        AND path NOT LIKE '/sitemap%'
                        AND path != '/health'
                        AND path NOT LIKE '%.css'
                        AND path NOT LIKE '%.js'
                        AND path NOT LIKE '%.png'
                        AND path NOT LIKE '%.jpg'
                        AND path NOT LIKE '%.jpeg'
                        AND path NOT LIKE '%.gif'
                        AND path NOT LIKE '%.svg'
                        AND path NOT LIKE '%.ico'
                        AND path NOT LIKE '%.woff'
                        AND path NOT LIKE '%.woff2'
                        AND path NOT LIKE '%.ttf'
                        AND path NOT LIKE '%.otf'
                        AND path NOT LIKE '%.json'
                        AND path NOT LIKE '%.xml'
                        AND path NOT LIKE '%.txt'
                        AND path NOT LIKE '%.pdf'
                        AND path NOT LIKE '%.zip'
                        AND path NOT LIKE '%.rar'
                        AND path NOT LIKE '/admin/%'
                      GROUP BY path ORDER BY views DESC"""
    all_pages = c.execute(all_pages_sql).fetchall()

    top_pages_sql = """SELECT path, SUM(count) as views FROM pageviews_daily 
                      WHERE path NOT LIKE '/wp-%'
                        AND path NOT LIKE '/.env%'
                        AND path NOT LIKE '/.git%'
                        AND path NOT LIKE '/xmlrpc%'
                        AND path NOT LIKE '/favicon%'
                        AND path NOT LIKE '/robots.txt'
                        AND path NOT LIKE '/sitemap%'
                        AND path != '/health'
                        AND path NOT LIKE '%.css'
                        AND path NOT LIKE '%.js'
                        AND path NOT LIKE '%.png'
                        AND path NOT LIKE '%.jpg'
                        AND path NOT LIKE '%.jpeg'
                        AND path NOT LIKE '%.gif'
                        AND path NOT LIKE '%.svg'
                        AND path NOT LIKE '%.ico'
                        AND path NOT LIKE '%.json'
                        AND path NOT LIKE '/admin/%'
                      GROUP BY path ORDER BY views DESC LIMIT 10"""
    top_pages = c.execute(top_pages_sql).fetchall()

    page_week_trend = c.execute("""
        SELECT path, date, SUM(count) as views
        FROM pageviews_daily
        WHERE date >= date('now', '-14 days')
          AND path NOT LIKE '/wp-%'
          AND path NOT LIKE '/.env%'
          AND path NOT LIKE '/.git%'
          AND path NOT LIKE '%.css'
          AND path NOT LIKE '%.js'
          AND path NOT LIKE '%.png'
          AND path NOT LIKE '%.jpg'
          AND path NOT LIKE '%.json'
          AND path NOT LIKE '/admin/%'
        GROUP BY path, date
        ORDER BY path, date
    """).fetchall()

    this_week = c.execute("""
        SELECT path, SUM(count) as views
        FROM pageviews_daily
        WHERE date >= date('now', '-7 days')
          AND path NOT LIKE '/wp-%'
          AND path NOT LIKE '/.env%'
          AND path NOT LIKE '/.git%'
          AND path NOT LIKE '%.css'
          AND path NOT LIKE '%.js'
          AND path NOT LIKE '%.png'
          AND path NOT LIKE '%.jpg'
          AND path NOT LIKE '%.json'
          AND path NOT LIKE '/admin/%'
        GROUP BY path
    """).fetchall()
    last_week = c.execute("""
        SELECT path, SUM(count) as views
        FROM pageviews_daily
        WHERE date >= date('now', '-14 days') AND date < date('now', '-7 days')
          AND path NOT LIKE '/wp-%'
          AND path NOT LIKE '/.env%'
          AND path NOT LIKE '/.git%'
          AND path NOT LIKE '%.css'
          AND path NOT LIKE '%.js'
          AND path NOT LIKE '%.png'
          AND path NOT LIKE '%.jpg'
          AND path NOT LIKE '%.json'
          AND path NOT LIKE '/admin/%'
        GROUP BY path
    """).fetchall()

    this_week_dict = {r['path']: r['views'] for r in this_week}
    last_week_dict = {r['path']: r['views'] for r in last_week}

    category_stats = {}
    category_map = {
        '/': 'home',
        '/blog/': 'blog',
        '/training/': 'training',
        '/faq/': 'faq',
        '/glossary/': 'glossary',
        '/news/': 'news',
        '/wechat/': 'wechat',
        '/subsidy/': 'subsidy',
        '/about/': 'about',
        '/smart-agent/': 'smart-agent'
    }
    category_names = {
        'home': '首页',
        'blog': '博客',
        'training': '培训',
        'faq': 'FAQ',
        'glossary': '术语库',
        'news': '新闻',
        'wechat': '微信',
        'subsidy': '补贴',
        'about': '关于',
        'smart-agent': '智能体'
    }

    for row in all_pages:
        path = row['path']
        views = row['views']
        cat = None
        for prefix, category in category_map.items():
            if path == prefix or path.startswith(prefix):
                cat = category
                break
        if cat:
            if cat not in category_stats:
                category_stats[cat] = {'views': 0, 'pages': 0}
            category_stats[cat]['views'] += views
            category_stats[cat]['pages'] += 1

    conn.close()

    conn_leads = sqlite3.connect(DB_PATH)
    conn_leads.row_factory = sqlite3.Row
    c_leads = conn_leads.cursor()
    total_leads = c_leads.execute('SELECT COUNT(*) FROM leads').fetchone()[0]
    leads_by_referrer = c_leads.execute("""
        SELECT SUBSTR(referrer, 1, INSTR(referrer || '/', '/', 8) - 1) as ref_path,
               COUNT(*) as lead_count
        FROM leads
        WHERE referrer IS NOT NULL AND referrer != ''
        GROUP BY ref_path
        ORDER BY lead_count DESC
        LIMIT 10
    """).fetchall()
    conn_leads.close()

    page_conversion = []
    for row in all_pages:
        path = row['path']
        views = row['views']
        lead_count = 0
        for lr in leads_by_referrer:
            ref = lr['ref_path']
            if ref and (path == ref or ref.endswith(path) or path.startswith(ref.split('://')[-1].split('/')[0] + '/')):
                lead_count += lr['lead_count']

        this_w = this_week_dict.get(path, 0)
        last_w = last_week_dict.get(path, 0)
        growth = ((this_w - last_w) / last_w * 100) if last_w > 0 else (100 if this_w > 0 else 0)
        conversion_rate = (lead_count / views * 100) if views > 0 else 0

        quality_score = 0
        if views >= 100:
            quality_score += 30
        elif views >= 50:
            quality_score += 20
        else:
            quality_score += 10
        if conversion_rate >= 5:
            quality_score += 40
        elif conversion_rate >= 2:
            quality_score += 25
        else:
            quality_score += 10
        if growth >= 20:
            quality_score += 30
        elif growth >= 0:
            quality_score += 20
        else:
            quality_score += 10
        quality_score = min(100, quality_score)

        status = 'normal'
        if quality_score >= 80:
            status = 'excellent'
        elif quality_score >= 60:
            status = 'good'
        elif quality_score >= 40:
            status = 'needs_improvement'
        else:
            status = 'critical'

        page_conversion.append({
            'path': path,
            'name': format_page(path, views, PATH_ALIAS)['name'],
            'views': views,
            'unique_ips': row['unique_ips'],
            'lead_count': lead_count,
            'conversion_rate': round(conversion_rate, 2),
            'this_week_views': this_w,
            'last_week_views': last_w,
            'growth_rate': round(growth, 1),
            'quality_score': quality_score,
            'status': status
        })

    return jsonify({'code': 0, 'data': {
        'total_views': tr['value'] if tr else 0,
        'total_unique_visitors': ur['value'] if ur else 0,
        'today_views': tod['v'] if tod and tod['v'] else 0,
        'yesterday_views': yes['v'] if yes and yes['v'] else 0,
        'total_leads': total_leads,
        'daily_trend': [{'date': r['date'], 'views': r['views']} for r in daily_trend],
        'weekly_trend': [{'week_start': r['week_start'], 'views': r['views']} for r in weekly_trend],
        'top_pages': [format_page(r['path'], r['views'], PATH_ALIAS) for r in top_pages],
        'all_pages': [format_page(r['path'], r['views'], PATH_ALIAS) for r in all_pages],
        'page_conversion': page_conversion,
        'category_stats': [{'name': category_names.get(k, k), 'category': k, 'views': v['views'], 'pages': v['pages']} for k, v in category_stats.items()],
        'leads_by_referrer': [{'path': r['ref_path'], 'count': r['lead_count']} for r in leads_by_referrer]
    }})


@app.route("/admin/api/leads/<int:lead_id>/logs")
@admin_required
def admin_api_lead_logs(lead_id):
    logs = get_lead_logs(lead_id)
    return jsonify({"code": 0, "data": logs})


@app.route('/admin/api/analytics/init', methods=['POST'])
@admin_required
def admin_api_analytics_init():
    import sqlite3, os
    db = os.path.join(os.path.dirname(DB_PATH), 'analytics.db')
    os.makedirs(os.path.dirname(db), exist_ok=True)
    conn = sqlite3.connect(db)
    c = conn.cursor()
    c.execute("CREATE TABLE IF NOT EXISTS pageviews_daily (date TEXT, path TEXT, count INTEGER DEFAULT 0, unique_ips INTEGER DEFAULT 0, PRIMARY KEY (date, path))")
    c.execute("CREATE TABLE IF NOT EXISTS summary (metric TEXT PRIMARY KEY, value INTEGER)")
    c.execute("INSERT OR IGNORE INTO summary VALUES ('total_views', 0)")
    c.execute("INSERT OR IGNORE INTO summary VALUES ('total_unique_visitors', 0)")
    conn.commit()
    conn.close()
    return jsonify({'code': 0, 'msg': '统计数据库已初始化'})

@app.route('/health')
def health():
    """健康检查"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT COUNT(*) FROM leads')
        count = c.fetchone()[0]
        conn.close()
        return jsonify({'status': 'ok', 'db': DB_PATH, 'leads_count': count})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500

# ==================== 管理后台模板 ====================

LOGIN_TEMPLATE = '''
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>进化湾® 管理后台登录</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f4c81 100%);
            height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .login-box { 
            background: #fff; padding: 50px 40px; border-radius: 16px; 
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); width: 420px;
        }
        .login-box h2 { 
            text-align: center; color: #1a1a2e; margin-bottom: 10px; font-size: 1.8em;
        }
        .login-box .subtitle {
            text-align: center; color: #888; margin-bottom: 30px; font-size: 0.95em;
        }
        .form-group { margin-bottom: 24px; }
        .form-group label { 
            display: block; margin-bottom: 10px; color: #555; 
            font-weight: 600; font-size: 0.95em;
        }
        .form-group input { 
            width: 100%; padding: 14px 16px; border: 2px solid #eee; 
            border-radius: 8px; font-size: 1em; transition: all 0.3s;
        }
        .form-group input:focus { outline: none; border-color: #0f4c81; background: #fafbfc; }
        .btn { 
            width: 100%; padding: 16px; background: linear-gradient(135deg, #0f4c81, #16213e); 
            color: #fff; border: none; border-radius: 8px; font-size: 1.05em; 
            font-weight: 600; cursor: pointer; transition: all 0.3s;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(15,76,129,0.3); }
        .error { 
            background: #fee; color: #e74c3c; text-align: center; 
            margin-bottom: 20px; padding: 12px; border-radius: 8px; font-size: 0.95em;
        }
        .footer {
            text-align: center; margin-top: 30px; color: #999; font-size: 0.85em;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <h2>进化湾®</h2>
        <p class="subtitle">AI 产业服务平台 · 管理后台</p>
        {% if error %}<div class="error">{{ error }}</div>{% endif %}
        <form method="POST">
            <div class="form-group">
                <label>👤 用户名</label>
                <input type="text" name="username" required autofocus>
            </div>
            <div class="form-group">
                <label>🔒 密码</label>
                <input type="password" name="password" required>
            </div>
            <button type="submit" class="btn">登 录</button>
        </form>
        <div class="footer">
            进化湾® 版权所有 © 2026
        </div>
    </div>
</body>
</html>
'''

def _is_noise_path(path):
    """判断路径是否为攻击扫描/敏感文件/非业务请求"""
    noise_prefixes = (
        '/wp-', '/wordpress', '/.env', '/.git', '/.svn', '/xmlrpc',
        '/phpmyadmin', '/pma', '/adminer', '/phpinfo', '/shell',
        '/backup', '/dump', '/tmp', '/test', '/testing', '/debug',
        '/vendor/', '/node_modules/', '/composer', '/web/',
        '/SDK/', '/sdk/',
    )
    if path.startswith(noise_prefixes):
        return True
    if path.endswith('.php') and not path.startswith('/blog/'):
        return True
    return False


def format_page(path, views, alias_map):
    """将 path 转换为带友好名称和可访问 URL 的条目"""
    import re
    # 精确匹配
    if path in alias_map:
        name, url_suffix = alias_map[path]
        url = url_suffix if url_suffix else path
        return {'path': path, 'name': name, 'url': url, 'views': views}
    # 博客文章子页面：/blog/guide/xxx.html
    m = re.match(r'^/blog/guide/(.+)\.html$', path)
    if m:
        from urllib.parse import unquote
        title = unquote(m.group(1).replace('-', ' ').replace('_', ' '))
        name = f'📄 博客文章：{title}'
        return {'path': path, 'name': name, 'url': path, 'views': views}
    # 其他已知前缀兜底
    prefix_map = {
        '/faq/':       '❓ FAQ',
        '/training/':  '🎓 培训',
        '/news/':      '📰 新闻',
        '/blog/':      '📝 博客',
        '/wechat/':    '💬 微信',
        '/glossary/':  '📖 术语',
    }
    for prefix, label in prefix_map.items():
        if path.startswith(prefix):
            sub = path[len(prefix):].lstrip('/')
            name = f'{label}：{sub}' if sub else label
            return {'path': path, 'name': name, 'url': path, 'views': views}
    # 未知路径
    return {'path': path, 'name': path, 'url': path, 'views': views}

if __name__ == '__main__':
    print('='*60)
    print('进化湾® 表单数据服务启动中...')
    print(f'数据库位置: {DB_PATH}')
    print('管理后台: http://your-server:5000/admin')
    print('表单接口: http://your-server:5000/api/submit')
    print('健康检查: http://your-server:5000/health')
    print('='*60)
    app.run(host='0.0.0.0', port=5000, debug=False)


