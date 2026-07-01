/**
 * 进化湾全站通用组件
 * 
 * 功能：为所有子页面添加移动端 hamburger 菜单交互
 * 用法：在任意页面引入 <script src="/static/include.js"></script>
 * 要求：页面必须有 <nav class="nav-links" id="navLinks"> 导航模块
 */

(function() {
  'use strict';

  // ===== 1. 注入 hamburger CSS（仅当页面没有 shared.css 时）=====
  var STYLE_ID = 'evo-nav-style';
  if (!document.getElementById(STYLE_ID)) {
    var hasSharedCss = document.querySelector('link[href*="shared.css"]');
    if (!hasSharedCss) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        '.hamburger { display:none; flex-direction:column; gap:5px; background:none; border:none; cursor:pointer; padding:8px; }',
        '.hamburger span { display:block; width:24px; height:2px; background:#333; border-radius:2px; transition:all 0.3s; }',
        '.nav-overlay { display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:999; }',
        '@media (max-width:860px) {',
        '  .hamburger { display:flex !important; }',
        '  .nav-links.active { display:flex !important; flex-direction:column; position:fixed; top:0; right:0; width:280px; height:100vh; background:#fff; padding:70px 30px 30px; box-shadow:-4px 0 20px rgba(0,0,0,0.1); z-index:1000; gap:16px !important; align-items:flex-start !important; overflow-y:auto; }',
        '  .nav-links.active a { font-size:16px !important; width:100%; padding:8px 0; }',
        '  .nav-links.active a[href*="contact"], .nav-links.active .contact-btn { margin-top:8px; text-align:center; display:block; }',
        '  .nav-overlay.active { display:block !important; }',
        '  .hamburger.active span:nth-child(1) { transform:rotate(45deg) translate(5px,5px); }',
        '  .hamburger.active span:nth-child(2) { opacity:0; }',
        '  .hamburger.active span:nth-child(3) { transform:rotate(-45deg) translate(5px,-5px); }',
        '}',
        '@media (max-width:640px) {',
        '  footer > div > div:first-of-type { grid-template-columns:1fr !important; }',
        '}'
      ].join('\n');
      document.head.appendChild(style);
    }
  }

  // ===== 2. 注入 hamburger 按钮 =====
  // 只在有 nav-links 但没有 hamburger 的页面上注入
  document.addEventListener('DOMContentLoaded', function() {
    var navLinks = document.getElementById('navLinks');
    if (!navLinks) return;
    
    // 如果已经有 hamburger 按钮，跳过
    if (document.getElementById('hamburgerBtn')) return;
    
    // 创建 hamburger 按钮
    var ham = document.createElement('button');
    ham.className = 'hamburger';
    ham.id = 'hamburgerBtn';
    ham.setAttribute('aria-label', '菜单');
    ham.setAttribute('aria-expanded', 'false');
    ham.style.cssText = 'display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:8px;';
    ham.innerHTML = [
      '<span style="display:block;width:24px;height:2px;background:#333;border-radius:2px;transition:all 0.3s;"></span>',
      '<span style="display:block;width:24px;height:2px;background:#333;border-radius:2px;transition:all 0.3s;"></span>',
      '<span style="display:block;width:24px;height:2px;background:#333;border-radius:2px;transition:all 0.3s;"></span>'
    ].join('');
    
    // 插入到 nav-links 前面
    navLinks.parentNode.insertBefore(ham, navLinks);
    
    // 创建 overlay
    var overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    overlay.id = 'navOverlay';
    overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999;';
    document.body.appendChild(overlay);
    
    // 交互逻辑
    function toggleMenu(open) {
      var isOpen = open !== undefined ? open : !navLinks.classList.contains('active');
      navLinks.classList.toggle('active', isOpen);
      overlay.classList.toggle('active', isOpen);
      ham.classList.toggle('active', isOpen);
      ham.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }
    
    ham.addEventListener('click', function() { toggleMenu(); });
    overlay.addEventListener('click', function() { toggleMenu(false); });
    navLinks.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() { toggleMenu(false); });
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && navLinks.classList.contains('active')) {
        toggleMenu(false);
      }
    });
    
    // 响应式：窗口放大时自动关闭菜单
    window.addEventListener('resize', function() {
      if (window.innerWidth > 860 && navLinks.classList.contains('active')) {
        toggleMenu(false);
      }
    });
  });

  // ===== 3. 高亮当前页面 =====
  document.addEventListener('DOMContentLoaded', function() {
    var path = window.location.pathname;
    document.querySelectorAll('.nav-links a').forEach(function(a) {
      var href = a.getAttribute('href');
      if (!href || href === '#') return;
      if (href === path || (path.startsWith(href) && href !== '/')) {
        a.style.color = '#0f4c81';
        a.style.fontWeight = '600';
      }
    });
  });

})();
