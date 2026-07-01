#!/usr/bin/env python3
"""
进化湾全站导航同步脚本 v2.0

处理三种页面模板：
  Type A: 标准页面（about/faq/blog/news/subsidy/training/glossary）
  Type B: 文章/详情页（blog/guide/*.html, news/article-*.html）含 back-link
  Type C: 首页（特殊，保留现有结构）
"""

import os, re, sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# ===== 标准导航链接列表（所有模板共用）=====
NAV_LINKS = [
    ('/', '首页'),
    ('/#services', '核心服务'),
    ('/#smart-agent', '制造经营大脑'),
    ('/training/', 'AI训练师培训'),
    ('/subsidy/', '创业补贴'),
    ('/about/', '关于'),
    ('/news/', '动态·洞察'),
    ('/faq/', 'FAQ'),
    ('/#form', '联系我们'),
]

def render_nav_html(extra_indent="", active_path=None):
    """生成标准导航 HTML"""
    lines = []
    for href, text in NAV_LINKS:
        active = ' class="active"' if active_path and href == active_path else ''
        lines.append(f'{extra_indent}<a href="{href}"{active}>{text}</a>')
    return '\n'.join(lines)

def render_contact_btn(extra_indent="", href="/#form"):
    return f'{extra_indent}<a href="{href}" class="contact-btn">获取方案</a>'

# 标准 footer 快速链接块
FOOTER_LINKS_HTML = [
    '<p><a href="./">首页</a></p>',
    '<p><a href="/#services">核心服务</a>\n                <a href="/#smart-agent">制造经营大脑</a></p>',
    '<p><a href="/training/">AI训练师培训</a></p>',
    '<p><a href="/subsidy/">创业补贴</a></p>',
    '<p><a href="/news/">动态</a></p>',
    '<p><a href="/faq/">常见问题 FAQ</a></p>',
    '<p><a href="/glossary/">AI 术语表</a></p>',
    '<p><a href="/#space">产业基地</a></p>',
    '<p><a href="/#form">联系我们</a></p>',
]


def sync_type_a(filepath, html):
    """Type A: 标准页面（about/faq/blog/news/subsidy/training/glossary 含 logo）"""
    changes = []
    
    # === 替换 nav ===
    nav_match = re.search(r'<nav[^>]*>(.*?)</nav>', html, re.DOTALL)
    if not nav_match:
        return changes, html
    
    old_nav = nav_match.group(0)
    nav_tag = re.search(r'<nav[^>]*>', old_nav).group(0)
    new_nav = nav_tag + '\n' + render_nav_html("                ") + '\n            </nav>'
    
    if old_nav.strip() != new_nav.strip():
        html = html.replace(old_nav, new_nav)
        changes.append("nav")
    
    # === 替换 footer 快速链接 ===
    footer_start = html.find('<footer')
    if footer_start >= 0:
        footer_end = html.find('</footer>', footer_start)
        footer = html[footer_start:footer_end]
        
        if '制造经营大脑' not in footer:
            # 找到快速链接 div 中的链接列表
            ql_start = footer.find('快速链接')
            if ql_start >= 0:
                links_start = footer.find('<p><a', ql_start)
                links_end = footer.rfind('</p>', ql_start, footer.find('</div>', ql_start) + 50)
                if links_start >= 0 and links_end >= 0:
                    old_links = footer[links_start:links_end + 4]
                    indent = old_links[:len(old_links) - len(old_links.lstrip())]
                    new_links = '\n'.join(indent + l for l in FOOTER_LINKS_HTML)
                    html = html.replace(old_links, new_links)
                    changes.append("footer")
    
    return changes, html


def sync_type_b(filepath, html):
    """Type B: 文章/详情页（blog/guide/*, news/article-*）含 back-link"""
    changes = []
    
    # === 替换 nav-links 块 ===
    nl_match = re.search(r'<div class="nav-links"[^>]*>(.*?)</div>', html, re.DOTALL)
    if nl_match:
        old_nl = nl_match.group(0)
        nl_tag = re.search(r'<div class="nav-links"[^>]*>', old_nl).group(0)
        new_nl = nl_tag + '\n' + render_nav_html("            ") + '\n            </div>'
        if old_nl.strip() != new_nl.strip():
            html = html.replace(old_nl, new_nl)
            changes.append("nav")
    
    # === 替换 contact-btn ===
    cb_match = re.search(r'<a[^>]*class="contact-btn"[^>]*>.*?</a>', html)
    if cb_match:
        old_cb = cb_match.group(0)
        cb_tag = re.search(r'<a[^>]*class="contact-btn"[^>]*>', old_cb).group(0)
        # Keep the original href
        href_match = re.search(r'href="([^"]*)"', cb_tag)
        href = href_match.group(1) if href_match else '/#form'
        new_cb = cb_tag + '获取方案</a>'
        # Only replace if it matches the old pattern
        if '获取方案' in old_cb and old_cb != new_cb:
            html = html.replace(old_cb, new_cb)
            if 'contact' not in changes:
                changes.append("contact")
    
    # === 替换 footer 快速链接 ===
    footer_start = html.find('<footer')
    if footer_start >= 0:
        footer_end = html.find('</footer>', footer_start)
        footer = html[footer_start:footer_end]
        
        if '制造经营大脑' not in footer:
            ql_start = footer.find('快速链接')
            if ql_start >= 0:
                links_start = footer.find('<p><a', ql_start)
                links_end = footer.rfind('</p>', ql_start, footer.find('</div>', ql_start) + 50)
                if links_start >= 0 and links_end >= 0:
                    old_links = footer[links_start:links_end + 4]
                    indent = old_links[:len(old_links) - len(old_links.lstrip())]
                    new_links = '\n'.join(indent + l for l in FOOTER_LINKS_HTML)
                    html = html.replace(old_links, new_links)
                    changes.append("footer")
    
    return changes, html


def main():
    dry_run = '--dry-run' in sys.argv
    
    print("=" * 60)
    print(f"进化湾全站导航同步脚本 v2.0")
    print(f"模式: {'🔍 预览' if dry_run else '🚀 执行'}")
    print("=" * 60)
    
    html_files = []
    for root, dirs, files in os.walk(FRONTEND_DIR):
        dirs[:] = [d for d in dirs if d not in ['__pycache__']]
        for f in files:
            if f.endswith('.html'):
                html_files.append(os.path.join(root, f))
    
    stats = {'fixed': 0, 'skipped': 0, 'errors': 0}
    
    for fp in sorted(html_files):
        rel = fp.replace(FRONTEND_DIR, "")
        
        # 跳过不需要修改的页面
        if '/wechat/' in rel:
            stats['skipped'] += 1
            continue
        if '/admin/' in rel:
            stats['skipped'] += 1
            continue
        if rel == '/index.html' or rel == '/smart-agent/index.html':
            stats['skipped'] += 1
            continue
        # 跳过重复路径（这些是 nginx 路径歧义导致的，后续删除文件）
        if rel.startswith('/blog/blog/') or rel.startswith('/faq/faq/') or rel.startswith('/glossary/glossary/'):
            stats['skipped'] += 1
            continue
        if rel.startswith('/ai-') or rel.startswith('/geo-') or rel.startswith('/h200-'):
            stats['skipped'] += 1  # 根目录残留文件，后续删除
            continue
        
        with open(fp, 'r', encoding='utf-8') as f:
            html = f.read()
        
        # 判断页面类型
        if '/blog/guide/' in rel or '/news/article-' in rel:
            changes, new_html = sync_type_b(fp, html)
        else:
            changes, new_html = sync_type_a(fp, html)
        
        if changes:
            if not dry_run:
                with open(fp, 'w', encoding='utf-8') as f:
                    f.write(new_html)
            print(f"  {'🔧' if not dry_run else '🔍'} {rel}: {' + '.join(changes)}")
            stats['fixed'] += 1
    
    print(f"\n{'=' * 60}")
    if dry_run:
        print(f"预览: {stats['fixed']} 个待修复, {stats['skipped']} 个跳过")
        print("去掉 --dry-run 执行")
    else:
        print(f"完成: {stats['fixed']} 个已修复, {stats['skipped']} 个跳过")
        verify()


def verify():
    """修复后验证"""
    print(f"\n--- 验证 ---")
    errors = 0
    for root, dirs, files in os.walk(FRONTEND_DIR):
        for f in files:
            if not f.endswith('.html'):
                continue
            fp = os.path.join(root, f)
            rel = fp.replace(FRONTEND_DIR, "")
            
            if '/wechat/' in rel or '/admin/' in rel or rel == '/index.html':
                continue
            if rel.startswith('/blog/blog/') or rel.startswith('/faq/faq/') or rel.startswith('/glossary/glossary/'):
                continue
            if rel.startswith('/ai-') or rel.startswith('/geo-') or rel.startswith('/h200-'):
                continue
            
            with open(fp, encoding='utf-8') as f:
                html = f.read()
            
            has_nav_brain = False
            nav_match = re.search(r'<nav[^>]*>(.*?)</nav>', html, re.DOTALL)
            if nav_match:
                has_nav_brain = '制造经营大脑' in nav_match.group(1)
            
            if not has_nav_brain:
                # Type B pages: check nav-links div
                nl_match = re.search(r'class="nav-links"[^>]*>.*?制造经营大脑', html, re.DOTALL)
                if not nl_match:
                    print(f"  ❌ {rel}: nav 仍缺少制造经营大脑")
                    errors += 1
            
            footer_start = html.find('<footer')
            if footer_start >= 0:
                footer_end = html.find('</footer>', footer_start)
                footer = html[footer_start:footer_end]
                if '制造经营大脑' not in footer:
                    print(f"  ⚠️  {rel}: footer 仍缺少制造经营大脑")
                    errors += 1
    
    print(f"验证: {'✅ 全部通过' if errors == 0 else f'❌ {errors} 个问题'}")


if __name__ == '__main__':
    main()
