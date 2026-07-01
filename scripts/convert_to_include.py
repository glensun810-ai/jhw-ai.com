#!/usr/bin/env python3
"""
将子页面从硬编码 nav/footer 转换为 include.js 组件模式
"""

import os, re, sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

EXCLUDE = ['/index.html', '/admin/', '/wechat/', '/static/']


def replace_nav(html):
    """替换各种模式的硬编码导航"""
    # Pattern A: <header>...</header> 包含 nav-links
    m = re.search(r'<header[^>]*>.*?nav-links.*?</header>', html, re.DOTALL)
    if m:
        html = html.replace(m.group(0), '<div id="nav-placeholder"></div>')
        return html, True
    
    # Pattern B: <nav>... 包含 nav-links 和 contact-btn（文章页）
    m = re.search(r'<nav>\s*<div class="nav-inner">.*?nav-links.*?contact-btn.*?</nav>', html, re.DOTALL)
    if m:
        html = html.replace(m.group(0), '<div id="nav-placeholder"></div>')
        return html, True
    
    # Pattern C: 只有 nav-links div + contact-btn（about/subsidy 等）
    # 找 logo + nav-links + contact-btn 的组合
    m = re.search(r'<a[^>]*class="logo"[^>]*>.*?</a>.*?nav-links.*?contact-btn[^>]*>.*?</a>', html, re.DOTALL)
    if m:
        # 找到包裹它们的容器
        full = m.group(0)
        start = html.rfind('<div', 0, m.start())
        if start >= 0:
            # 找到容器的结束
            container_nav_end = html.find('</nav>', m.start()) + 6
            # 找之后的 </div> 闭合（可能有一个 container 的闭合和 header 的闭合）
            possible_ends = []
            pos = container_nav_end
            for _ in range(3):
                nd = html.find('</div>', pos)
                if nd >= 0:
                    possible_ends.append(nd + 6)
                    pos = nd + 6
            if possible_ends:
                # 用最后一个 div 闭合
                end = possible_ends[-1]
                html = html[:start] + '<div id="nav-placeholder"></div>' + html[end:]
                return html, True
    
    # Pattern D: 单独的 nav-links div + contact-btn（没有 logo/header 包裹）
    m = re.search(r'<div class="nav-links"[^>]*>.*?</div>\s*<a[^>]*class="contact-btn"[^>]*>.*?</a>', html, re.DOTALL)
    if m:
        # 替换从 nav-links 上方最近的容器开始
        start = html.rfind('<nav', 0, m.start())
        if start >= 0:
            end = html.find('</nav>', m.start()) + 6
            html = html[:start] + '<div id="nav-placeholder"></div>' + html[end:]
            return html, True
    
    return html, False


def replace_footer(html):
    """替换硬编码 footer"""
    m = re.search(r'<footer[^>]*>.*?</footer>', html, re.DOTALL)
    if m:
        html = html.replace(m.group(0), '<div id="footer-placeholder"></div>')
        return html, True
    return html, False


def add_script_tag(html):
    """在 </body> 前添加 include.js"""
    if '/static/include.js' in html:
        return html, False
    body_end = html.find('</body>')
    if body_end >= 0:
        html = html[:body_end] + '\n<script src="/static/include.js"></script>\n' + html[body_end:]
        return html, True
    return html, False


def process_file(filepath, dry_run=False):
    with open(filepath, 'r', encoding='utf-8') as f:
        html = f.read()
    
    original = html
    changes = []
    
    html, nav_c = replace_nav(html)
    if nav_c: changes.append('nav')
    
    html, footer_c = replace_footer(html)
    if footer_c: changes.append('footer')
    
    html, script_c = add_script_tag(html)
    if script_c: changes.append('script')
    
    if changes:
        rel = filepath.replace(FRONTEND_DIR, '')
        if not dry_run:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html)
        print(f"  {'🔧' if not dry_run else '🔍'} {rel}: {' + '.join(changes)}")
    
    return bool(changes)


def main():
    dry_run = '--dry-run' in sys.argv
    
    print("=" * 60)
    print(f"页面转换: 硬编码 nav/footer → include.js 组件")
    print(f"模式: {'🔍 预览' if dry_run else '🚀 执行'}")
    print("=" * 60)
    
    html_files = []
    for root, dirs, files in os.walk(FRONTEND_DIR):
        dirs[:] = [d for d in dirs if d not in ['__pycache__']]
        for f in files:
            if not f.endswith('.html'):
                continue
            fp = os.path.join(root, f)
            rel = fp.replace(FRONTEND_DIR, '')
            if any(rel.startswith(e) for e in EXCLUDE):
                continue
            if not os.path.exists(fp):
                continue
            html_files.append(fp)
    
    fixed = 0
    for fp in sorted(html_files):
        if process_file(fp, dry_run=dry_run):
            fixed += 1
    
    print(f"\n{'=' * 60}")
    if dry_run:
        print(f"预览: {fixed} 个待转换")
    else:
        print(f"完成: {fixed} 个页面已转换")
        print(f"首页 index.html 结构复杂暂不做转换")


if __name__ == '__main__':
    main()
