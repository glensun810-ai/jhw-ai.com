(function () {
'use strict';

// ==================== Config ====================
const CONFIG = {
    API_BASE: '/admin/api',
    PER_PAGE: 20,
    TOKEN_KEY: 'admin_token'
};

// ==================== Toast ====================
const Toast = {
    show(msg, type) {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            el.addEventListener('animationend', () => el.remove());
        }, 3000);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    info(msg) { this.show(msg, 'info'); }
};

// ==================== Auth ====================
const Auth = {
    getToken() { return localStorage.getItem(CONFIG.TOKEN_KEY); },
    setToken(t) { localStorage.setItem(CONFIG.TOKEN_KEY, t); },
    clearToken() { localStorage.removeItem(CONFIG.TOKEN_KEY); },
    isLoggedIn() { return !!this.getToken(); }
};

// ==================== API Client ====================
const API = {
    async request(method, path, body) {
        const headers = { 'Content-Type': 'application/json' };
        const token = Auth.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${CONFIG.API_BASE}${path}`, opts);
        const data = await res.json();

        if (data.code === -3) {
            Auth.clearToken();
            Router.go('login');
            throw new Error(data.msg || '登录已过期');
        }
        if (data.code !== 0) {
            throw new Error(data.msg || '请求失败');
        }
        return data;
    },

    login(username, password) {
        return this.request('POST', '/login', { username, password });
    },

    getLeads(params) {
        const qs = new URLSearchParams(params).toString();
        return this.request('GET', `/leads?${qs}`);
    },

    getLead(id) {
        return this.request('GET', `/leads/${id}`);
    },

    updateLead(id, fields) {
        return this.request('PUT', `/leads/${id}`, fields);
    },

    updateStatus(id, status, note) {
        return this.request('PATCH', `/leads/${id}/status`, { status, note: note || '' });
    },

    deleteLead(id) {
        return this.request('DELETE', `/leads/${id}`);
    },

    getStats() {
        return this.request('GET', '/stats');
    },

    getExportUrl() {
        const token = Auth.getToken();
        if (token) return `${CONFIG.API_BASE}/export?token=${token}`;
        return `${CONFIG.API_BASE}/export`;
    }
};

// ==================== Loading ====================
const Loading = {
    show() { document.getElementById('loading-overlay').classList.remove('hidden'); },
    hide() { document.getElementById('loading-overlay').classList.add('hidden'); }
};

// ==================== Router ====================
const Router = {
    currentView: null,

    go(view, params) {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const el = document.getElementById(`view-${view}`);
        if (el) el.classList.remove('hidden');

        if (this.currentView && this.currentView.destroy) {
            this.currentView.destroy();
        }

        switch (view) {
            case 'login': this.currentView = LoginView; break;
            case 'dashboard': this.currentView = DashboardView; break;
            case 'leads': this.currentView = LeadsView; break;
            default: this.currentView = DashboardView;
        }

        // 确保导航按钮高亮同步
        document.querySelectorAll('[data-nav]').forEach(link => {
            link.classList.toggle('active', link.dataset.nav === view);
        });
        // 底部 Tab 高亮同步
        document.querySelectorAll('.tab-item').forEach(link => {
            link.classList.toggle('active', link.dataset.nav === view);
        });
        // 关闭移动端下拉菜单
        document.querySelectorAll('.header-nav-mobile').forEach(n => n.style.display = 'none');
        // 滚动到顶部
        window.scrollTo(0, 0);

        if (this.currentView && this.currentView.init) {
            this.currentView.init(params);
        }
    }
};

// ==================== LoginView ====================
const LoginView = {
    init() {
        if (Auth.isLoggedIn()) {
            Router.go('dashboard');
            return;
        }
        document.getElementById('login-error').classList.add('hidden');
        document.getElementById('login-form').onsubmit = (e) => {
            e.preventDefault();
            this.submit();
        };
    },

    async submit() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        if (!username || !password) return;

        const errorEl = document.getElementById('login-error');
        errorEl.classList.add('hidden');

        try {
            Loading.show();
            const data = await API.login(username, password);
            Auth.setToken(data.token);
            Toast.success('登录成功');
            Router.go('dashboard');
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        } finally {
            Loading.hide();
        }
    },

    destroy() {}
};

// ==================== DashboardView ====================
const DashboardView = {
    charts: {},
    _retryCount: 0,

    async init() {
        if (!Auth.isLoggedIn()) { Router.go('login'); return; }
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.nav === 'dashboard');
        });

        try {
            Loading.show();
            const data = await API.getStats();
            this.renderStats(data);
            this.renderCharts(data);
            this.renderRecentLeads(data.recent_leads || []);
            this.loadAnalytics();
        } catch (err) {
            this.handleError(err);
        } finally {
            Loading.hide();
        }
    },

    handleError(err) {
        console.error('Dashboard error:', err);
        if (this._retryCount < 2) {
            this._retryCount++;
            setTimeout(() => { this._retryCount = 0; this.init(); }, 3000);
        } else {
            this._retryCount = 0;
            Toast.error('数据加载失败，请刷新页面后重试');
        }
    },

    renderStats(data) {
        document.getElementById('stat-total').textContent = data.total || 0;
        document.getElementById('stat-new').textContent = data.status_stats['新提交'] || 0;
        document.getElementById('stat-contacting').textContent = data.status_stats['联系中'] || 0;
        document.getElementById('stat-converted').textContent = data.status_stats['已转化'] || 0;
        document.getElementById('stat-today-new').textContent = data.today_new || 0;

        // Click stat cards to navigate to filtered leads
        document.querySelectorAll('.stat-card').forEach(card => {
            card.onclick = () => {
                let status = '';
                if (card.classList.contains('stat-new')) status = '新提交';
                else if (card.classList.contains('stat-contacting')) status = '联系中';
                else if (card.classList.contains('stat-converted')) status = '已转化';
                Router.go('leads', { status });
            };
        });
    },

    renderCharts(data) {
        // Destroy existing charts
        Object.values(this.charts).forEach(c => c.destroy());
        this.charts = {};

        // Daily trend line chart
        const dailyData = data.daily_stats_30d || [];
        const labels = dailyData.map(d => d.date);
        const counts = dailyData.map(d => d.count);
        const ctx1 = document.getElementById('chart-daily').getContext('2d');
        this.charts.daily = new Chart(ctx1, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: '提交数',
                    data: counts,
                    borderColor: '#0f4c81',
                    backgroundColor: 'rgba(15,76,129,0.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointBackgroundColor: '#0f4c81'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });

        // Service distribution doughnut chart
        const serviceData = data.service_stats || [];
        const ctx2 = document.getElementById('chart-service').getContext('2d');
        const colors = ['#0f4c81', '#27ae60', '#f39c12', '#e74c3c', '#8e44ad',
                         '#2c3e50', '#16a085', '#d35400', '#2980b9', '#7f8c8d'];
        this.charts.service = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: serviceData.map(s => s.service),
                datasets: [{
                    data: serviceData.map(s => s.count),
                    backgroundColor: colors.slice(0, serviceData.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });
    },

    async loadAnalytics() {
        try {
            const token = Auth.getToken();
            if (!token) return;
            const resp = await fetch('/admin/api/analytics', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json();
            if (data.code !== 0) return;
            const d = data.data;
            
            document.getElementById('ana-total-views').textContent = d.total_views || 0;
            document.getElementById('ana-total-visitors').textContent = d.total_visitors || 0;
            document.getElementById('ana-today-views').textContent = d.today_views || 0;
            
            // 趋势图
            const canvas = document.getElementById('ana-chart');
            if (canvas && d.daily_trend && d.daily_trend.length > 0 && typeof Chart !== 'undefined') {
                new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: d.daily_trend.map(function(r) { return r.date.slice(5); }),
                        datasets: [{
                            label: '访问量',
                            data: d.daily_trend.map(function(r) { return r.views; }),
                            borderColor: '#0f4c81',
                            backgroundColor: 'rgba(15,76,129,0.1)',
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
                });
            } else if (canvas) {
                document.getElementById('ana-chart-container').innerHTML = '<p style="color:#999;padding:12px;">趋势数据将在 Nginx 日志解析脚本运行后自动生成。</p>';
            }
            
            // 热门页面
            var list = document.getElementById('ana-pages-list');
            if (list && d.top_pages && d.top_pages.length > 0) {
                var h = '<table class="mini-table"><thead><tr><th>页面</th><th>访问量</th></tr></thead><tbody>';
                d.top_pages.forEach(function(p) {
                    var path = p.path.length > 40 ? p.path.slice(0,40) + '...' : p.path;
                    h += '<tr><td>' + path + '</td><td>' + p.views + '</td></tr>';
                });
                h += '</tbody></table>';
                list.innerHTML = h;
            }
        } catch (err) {
            console.error('Analytics load error:', err);
        }
    },

    renderRecentLeads(leads) {
        const tbody = document.querySelector('#recent-leads-table tbody');
        if (!leads.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无数据</td></tr>';
            return;
        }
        tbody.innerHTML = leads.map(l => `
            <tr style="cursor:pointer" onclick="Router.go('leads', {highlight: ${l.id}})">
                <td>${l.id}</td>
                <td><strong>${this.esc(l.name)}</strong></td>
                <td>${this.esc(l.company || '-')}</td>
                <td>${this.esc(l.service_label)}</td>
                <td>${(l.submit_time || '').slice(0, 16)}</td>
                <td><span class="status-badge status-${this.statusClass(l.status)}">${l.status}</span></td>
            </tr>
        `).join('');
    },

    statusClass(status) {
        if (status === '新提交') return 'new';
        if (status === '联系中') return 'contacting';
        if (status === '已转化') return 'converted';
        return 'invalid';
    },

    esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    destroy() {
        Object.values(this.charts).forEach(c => c.destroy());
        this.charts = {};
    }
};

// Export for inline onclick
window.Router = Router;

// ==================== LeadsView ====================
const LeadsView = {
    state: {
        page: 1,
        perPage: CONFIG.PER_PAGE,
        sortBy: 'submit_time',
        sortOrder: 'desc',
        search: '',
        status: '',
        total: 0,
        totalPages: 1,
        highlightId: null
    },

    init(params) {
        if (!Auth.isLoggedIn()) { Router.go('login'); return; }
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.nav === 'leads');
        });

        if (params && params.status !== undefined) {
            this.state.status = params.status;
            document.getElementById('filter-status').value = params.status;
        }
        if (params && params.highlight) {
            this.state.highlightId = params.highlight;
        }

        this.bindEvents();
        this.load();
    },

    bindEvents() {
        document.getElementById('btn-search').onclick = () => {
            this.state.search = document.getElementById('search-input').value.trim();
            this.state.status = document.getElementById('filter-status').value;
            this.state.page = 1;
            this.load();
        };
        document.getElementById('btn-reset').onclick = () => {
            document.getElementById('search-input').value = '';
            document.getElementById('filter-status').value = '';
            this.state = { ...this.state, search: '', status: '', page: 1, sortBy: 'submit_time', sortOrder: 'desc' };
            this.load();
        };
        document.getElementById('search-input').onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('btn-search').click();
        };

        document.getElementById('btn-prev').onclick = () => {
            if (this.state.page > 1) { this.state.page--; this.load(); }
        };
        document.getElementById('btn-next').onclick = () => {
            if (this.state.page < this.state.totalPages) { this.state.page++; this.load(); }
        };

        // Sortable headers
        document.querySelectorAll('.data-table th.sortable').forEach(th => {
            th.onclick = () => {
                const col = th.dataset.sort;
                if (this.state.sortBy === col) {
                    this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    this.state.sortBy = col;
                    this.state.sortOrder = 'asc';
                }
                this.state.page = 1;
                this.load();
            };
        });

        // Modal close
        document.getElementById('modal-close').onclick = () => this.closeModal();
        document.getElementById('detail-modal').onclick = (e) => {
            if (e.target === document.getElementById('detail-modal')) this.closeModal();
        };
        document.getElementById('modal-save').onclick = () => this.saveLead();
        document.getElementById('modal-delete').onclick = () => this.deleteLead();
    },

    async load() {
        try {
            Loading.show();
            const params = {
                page: this.state.page,
                per_page: this.state.perPage,
                sort_by: this.state.sortBy,
                sort_order: this.state.sortOrder
            };
            if (this.state.search) params.q = this.state.search;
            if (this.state.status) params.status = this.state.status;

            const data = await API.getLeads(params);
            this.state.total = data.total;
            this.state.totalPages = data.total_pages;
            this.renderTable(data.leads);
            this.renderPagination();
            this.updateSortIndicators();
        } catch (err) {
            Toast.error('加载线索失败：' + err.message);
        } finally {
            Loading.hide();
        }
    },

    renderTable(leads) {
        const tbody = document.querySelector('#leads-table tbody');
        const emptyState = document.getElementById('empty-state');

        if (!leads.length) {
            tbody.innerHTML = '';
            emptyState.classList.remove('hidden');
            document.getElementById('pagination').classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        document.getElementById('pagination').classList.remove('hidden');

        tbody.innerHTML = leads.map(l => {
            const isHL = l.id === this.state.highlightId;
            return `
            <tr${isHL ? ' style="background:#eaf2fb"' : ''}>
                <td><strong>${l.id}</strong></td>
                <td><strong>${DashboardView.esc(l.name)}</strong></td>
                <td>${DashboardView.esc(l.company || '-')}</td>
                <td><a href="tel:${DashboardView.esc(l.phone)}" style="color:#0f4c81">${DashboardView.esc(l.phone)}</a></td>
                <td>${DashboardView.esc(l.service_label)}</td>
                <td>${DashboardView.esc(l.budget_label)}</td>
                <td>${(l.submit_time || '').slice(0, 16)}</td>
                <td><span class="status-badge status-${DashboardView.statusClass(l.status)}">${l.status}</span></td>
                <td>
                    <div class="action-btns">
                        <button class="act-detail" data-action="detail" data-id="${l.id}">详情</button>
                        ${l.status !== '联系中' ? `<button data-action="status" data-id="${l.id}" data-status="联系中">联系中</button>` : ''}
                        ${l.status !== '已转化' ? `<button data-action="status" data-id="${l.id}" data-status="已转化">已转化</button>` : ''}
                        ${l.status !== '无效线索' ? `<button data-action="status" data-id="${l.id}" data-status="无效线索" class="act-delete">无效</button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        // Bind row action buttons
        tbody.querySelectorAll('button[data-action]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = parseInt(btn.dataset.id);
                if (action === 'detail') this.openModal(id);
                if (action === 'status') this.quickStatus(id, btn.dataset.status);
            };
        });

        // Clear highlight after render
        this.state.highlightId = null;
    },

    renderPagination() {
        document.getElementById('page-info').textContent = `共 ${this.state.total} 条`;
        document.getElementById('page-indicator').textContent =
            `第 ${this.state.page} / ${this.state.totalPages} 页`;
        document.getElementById('btn-prev').disabled = this.state.page <= 1;
        document.getElementById('btn-next').disabled = this.state.page >= this.state.totalPages;
    },

    updateSortIndicators() {
        document.querySelectorAll('.data-table th.sortable').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            const icon = th.querySelector('.sort-icon');
            if (th.dataset.sort === this.state.sortBy) {
                th.classList.add(this.state.sortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
                icon.textContent = this.state.sortOrder === 'asc' ? '▲' : '▼';
            } else {
                icon.textContent = '';
            }
        });
    },

    async quickStatus(id, status) {
        if (!confirm(`确认将状态更新为「${status}」？`)) return;
        try {
            await API.updateStatus(id, status);
            Toast.success('状态已更新');
            this.load();
        } catch (err) {
            Toast.error('更新失败：' + err.message);
        }
    },

    // ---- Detail Modal ----
    async openModal(id) {
        try {
            Loading.show();
            const data = await API.getLead(id);
            const lead = data.data;
            this._modalLead = lead;

            document.getElementById('modal-lead-id').textContent = `#${lead.id}`;
            document.getElementById('modal-body').innerHTML = this.buildModalHTML(lead);
            document.getElementById('detail-modal').classList.remove('hidden');

            // Quick status buttons in modal
            document.getElementById('modal-body').querySelectorAll('.quick-status-btn').forEach(btn => {
                btn.onclick = async () => {
                    const st = btn.dataset.status;
                    const note = document.getElementById('modal-note').value;
                    try {
                        await API.updateStatus(lead.id, st, note);
                        Toast.success('状态已更新');
                        this.closeModal();
                        this.load();
                    } catch (err) {
                        Toast.error('更新失败：' + err.message);
                    }
                };
            });
        } catch (err) {
            Toast.error('加载详情失败：' + err.message);
        } finally {
            Loading.hide();
        }
    },

    buildModalHTML(lead) {
        return `
        <div class="detail-grid">
            <div class="detail-field">
                <label>姓名</label>
                <input type="text" id="modal-name" value="${DashboardView.esc(lead.name)}">
            </div>
            <div class="detail-field">
                <label>公司</label>
                <input type="text" id="modal-company" value="${DashboardView.esc(lead.company || '')}">
            </div>
            <div class="detail-field">
                <label>电话</label>
                <input type="text" id="modal-phone" value="${DashboardView.esc(lead.phone)}">
            </div>
            <div class="detail-field">
                <label>微信</label>
                <input type="text" id="modal-wechat" value="${DashboardView.esc(lead.wechat || '')}">
            </div>
            <div class="detail-field">
                <label>服务类型</label>
                <input type="text" id="modal-service" value="${DashboardView.esc(lead.service_label)}">
            </div>
            <div class="detail-field">
                <label>预算</label>
                <input type="text" id="modal-budget" value="${DashboardView.esc(lead.budget_label)}">
            </div>
            <div class="detail-field">
                <label>状态</label>
                <select id="modal-status">
                    <option value="新提交" ${lead.status === '新提交' ? 'selected' : ''}>新提交</option>
                    <option value="联系中" ${lead.status === '联系中' ? 'selected' : ''}>联系中</option>
                    <option value="已转化" ${lead.status === '已转化' ? 'selected' : ''}>已转化</option>
                    <option value="无效线索" ${lead.status === '无效线索' ? 'selected' : ''}>无效线索</option>
                </select>
            </div>
            <div class="detail-field">
                <label>提交时间</label>
                <div class="value">${(lead.submit_time || '').slice(0, 19)}</div>
            </div>
            <div class="detail-field detail-full">
                <label>需求描述</label>
                <textarea id="modal-details" rows="3">${DashboardView.esc(lead.details || '')}</textarea>
            </div>
            <div class="detail-field detail-full">
                <label>备注</label>
                <textarea id="modal-note" rows="2">${DashboardView.esc(lead.note || '')}</textarea>
            </div>
            <div class="detail-field">
                <label>IP 地址</label>
                <div class="value">${DashboardView.esc(lead.ip_address || '-')}</div>
            </div>
            <div class="detail-field">
                <label>来源页面</label>
                <div class="value" style="font-size:0.82em">${DashboardView.esc(lead.referrer || '-')}</div>
            </div>
            <div class="detail-field detail-full" style="margin-top:12px; padding-top:16px; border-top:1px solid var(--color-border)">
                <label>快速操作</label>
                <div class="action-btns" style="margin-top:8px">
                    <button class="quick-status-btn act-detail" data-status="联系中">标为「联系中」</button>
                    <button class="quick-status-btn" data-status="已转化" style="color:#27ae60;border-color:#27ae60">标为「已转化」</button>
                    <button class="quick-status-btn" data-status="无效线索" style="color:#95a5a6;border-color:#95a5a6">标为「无效线索」</button>
                </div>
            </div>
        </div>`;
    },

    async saveLead() {
        if (!this._modalLead) return;
        const fields = {
            name: document.getElementById('modal-name').value.trim(),
            company: document.getElementById('modal-company').value.trim(),
            phone: document.getElementById('modal-phone').value.trim(),
            wechat: document.getElementById('modal-wechat').value.trim(),
            details: document.getElementById('modal-details').value.trim(),
            status: document.getElementById('modal-status').value,
            note: document.getElementById('modal-note').value.trim()
        };
        try {
            await API.updateLead(this._modalLead.id, fields);
            Toast.success('保存成功');
            this.closeModal();
            this.load();
        } catch (err) {
            Toast.error('保存失败：' + err.message);
        }
    },

    async deleteLead() {
        if (!this._modalLead) {
            Toast.error('请先打开线索详情');
            return;
        }
        if (!confirm(`确认删除线索 #${this._modalLead.id}（${this._modalLead.name}）？此操作不可恢复。`)) return;
        try {
            await API.deleteLead(this._modalLead.id);
            Toast.success('已删除');
            this.closeModal();
            this.load();
        } catch (err) {
            Toast.error('删除失败：' + err.message);
        }
    },

    closeModal() {
        document.getElementById('detail-modal').classList.add('hidden');
        this._modalLead = null;
    },

    destroy() {
        this.closeModal();
    }
};

// ==================== Global Event Binding ====================
function bindGlobalEvents() {
    // Navigation
    document.querySelectorAll('[data-nav]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            Router.go(link.dataset.nav);
        });
    });

    // 底部 Tab 同步：点击 tab-item 触发导航
    document.querySelectorAll('.tab-item').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            Router.go(link.dataset.nav);
        });
    });

    // 汉堡菜单
    ['hamburgerAdmin', 'hamburgerAdmin2'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const mobileNav = this.closest('.header').querySelector('.header-nav-mobile');
                if (mobileNav) {
                    const isVisible = mobileNav.style.display === 'flex';
                    // 先关闭所有
                    document.querySelectorAll('.header-nav-mobile').forEach(n => n.style.display = 'none');
                    // 再切换当前
                    mobileNav.style.display = isVisible ? 'none' : 'flex';
                }
            });
        }
    });
    // 点击页面其他地方关闭菜单
    document.addEventListener('click', function() {
        document.querySelectorAll('.header-nav-mobile').forEach(n => n.style.display = 'none');
    });
    // 点击导航项后关闭菜单
    document.querySelectorAll('.header-nav-mobile .nav-link').forEach(link => {
        link.addEventListener('click', function() {
            document.querySelectorAll('.header-nav-mobile').forEach(n => n.style.display = 'none');
        });
    });

    // Logout
    document.querySelectorAll('#btn-logout, #btn-logout2').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            Auth.clearToken();
            Router.go('login');
        });
    });

    // Export
    const doExport = async () => {
        try {
            const token = Auth.getToken();
            if (!token) return;
            Toast.info('正在导出...');
            const qs = new URLSearchParams({ q: LeadsView.state.search, status: LeadsView.state.status });
            const resp = await fetch(`/admin/api/export?${qs}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) throw new Error('Export failed');
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('导出成功');
        } catch (err) {
            Toast.error('导出失败：' + err.message);
        }
    };
    document.querySelectorAll('#btn-export, #btn-export2').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            doExport();
        });
    });
}

// ==================== Init ====================
function init() {
    bindGlobalEvents();
    if (Auth.isLoggedIn()) {
        Router.go('dashboard');
    } else {
        Router.go('login');
    }
}

document.addEventListener('DOMContentLoaded', init);

})();
