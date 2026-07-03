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
    clearToken() { 
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem('admin_last_page');
    },
    isLoggedIn() { return !!this.getToken(); },
    getLastPage() { return localStorage.getItem('admin_last_page') || 'dashboard'; },
    setLastPage(page) { localStorage.setItem('admin_last_page', page); }
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

    batchUpdateStatus(ids, status) {
        return this.request('POST', '/leads/batch', { ids, status });
    },

    batchDelete(ids) {
        return this.request('POST', '/leads/batch/delete', { ids });
    }
};

// ==================== Loading ====================
const Loading = {
    show() { document.getElementById('loading-overlay').classList.remove('hidden'); },
    hide() { document.getElementById('loading-overlay').classList.add('hidden'); }
};

// ==================== Confirm Dialog ====================
const Confirm = {
    _resolve: null,
    
    show(message, title = '确认操作', type = 'confirm') {
        return new Promise((resolve) => {
            this._resolve = resolve;
            
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id = 'confirm-overlay';
            overlay.innerHTML = `
                <div class="modal-content" style="width:360px;max-width:90vw;">
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <button class="modal-close" onclick="Confirm.close(false)">&times;</button>
                    </div>
                    <div class="modal-body" style="text-align:center;padding:24px;">
                        <div style="font-size:3em;margin-bottom:16px;">${type === 'danger' ? '⚠️' : '❓'}</div>
                        <p style="font-size:0.95em;color:var(--color-text);">${message}</p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-ghost" onclick="Confirm.close(false)">取消</button>
                        <button class="btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}" onclick="Confirm.close(true)">确认</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            
            overlay.onclick = (e) => {
                if (e.target === overlay) this.close(false);
            };
        });
    },
    
    close(result) {
        const overlay = document.getElementById('confirm-overlay');
        if (overlay) overlay.remove();
        if (this._resolve) {
            this._resolve(result);
            this._resolve = null;
        }
    }
};

// ==================== Router ====================
const Router = {
    currentView: null,

    go(view, params) {
        // 保存当前页面
        if (view !== 'login') Auth.setLastPage(view);
        
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
            case 'analytics': this.currentView = AnalyticsView; break;
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
            this.renderServiceFunnel(data.service_funnel);
            this.renderSourceStats(data.source_stats);
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
            document.getElementById('ana-total-leads').textContent = d.total_leads || 0;
            
            const today = d.today_views || 0;
            const yesterday = d.yesterday_views || 0;
            const diff = today - yesterday;
            const changePercent = yesterday > 0 ? Math.round((diff / yesterday) * 100) : (today > 0 ? 100 : 0);
            const changeText = diff >= 0 ? `+${diff} (+${changePercent}%)` : `${diff} (${changePercent}%)`;
            const changeColor = diff >= 0 ? '#27ae60' : '#e74c3c';
            document.getElementById('ana-yesterday-views').innerHTML = `${yesterday}<br><span style="font-size:0.75em;color:${changeColor};">${changeText}</span>`;
            
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
            }
            
            // 分类统计饼图
            const catCanvas = document.getElementById('ana-category-chart');
            if (catCanvas && d.category_stats && d.category_stats.length > 0 && typeof Chart !== 'undefined') {
                const colors = ['#0f4c81', '#27ae60', '#f39c12', '#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#d35400', '#95a5a6', '#c0392b'];
                new Chart(catCanvas, {
                    type: 'doughnut',
                    data: {
                        labels: d.category_stats.map(function(c) { return c.name; }),
                        datasets: [{
                            data: d.category_stats.map(function(c) { return c.views; }),
                            backgroundColor: colors.slice(0, d.category_stats.length),
                            borderWidth: 2,
                            borderColor: '#fff'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
                });
            }
            
            // 热门页面
            var list = document.getElementById('ana-pages-list');
            if (list && d.top_pages && d.top_pages.length > 0) {
                var h = '<table class="mini-table" style="table-layout:auto;"><thead><tr><th>页面名称</th><th>访问量</th></tr></thead><tbody>';
                d.top_pages.forEach(function(p) {
                    var name = p.name || p.path;
                    var url = p.url || p.path;
                    var pathHint = p.path.length > 50 ? p.path.slice(0,50) + '...' : p.path;
                    h += '<tr><td><a href="' + url + '" target="_blank" title="' + pathHint + '" style="text-decoration:none;color:#0f4c81;">' + name + '</a><br><span style="font-size:0.75em;color:#999;">' + pathHint + '</span></td><td style="text-align:center;font-weight:bold;">' + p.views + '</td></tr>';
                });
                h += '</tbody></table>';
                list.innerHTML = h;
            }
            
            // 页面质量分析表格
            var qualityContainer = document.getElementById('page-quality-table-container');
            if (qualityContainer && d.page_conversion && d.page_conversion.length > 0) {
                var qh = '<table class="data-table" id="page-quality-table" style="font-size:0.85em;"><thead><tr><th>页面名称</th><th>访问量</th><th>独立IP</th><th>线索数</th><th>转化率</th><th>本周访问</th><th>增长率</th><th>质量评分</th><th>状态</th></tr></thead><tbody>';
                d.page_conversion.forEach(function(p) {
                    var statusClass = p.status === 'excellent' ? 'status-converted' : 
                                     p.status === 'good' ? 'status-contacting' : 
                                     p.status === 'needs_improvement' ? 'status-new' : 'status-invalid';
                    var statusText = p.status === 'excellent' ? '优秀' : 
                                     p.status === 'good' ? '良好' : 
                                     p.status === 'needs_improvement' ? '需优化' : '重点关注';
                    var growthColor = p.growth_rate >= 0 ? '#27ae60' : '#e74c3c';
                    var growthIcon = p.growth_rate >= 0 ? '↑' : '↓';
                    var scoreColor = p.quality_score >= 80 ? '#27ae60' : 
                                     p.quality_score >= 60 ? '#f39c12' : 
                                     p.quality_score >= 40 ? '#e67e22' : '#e74c3c';
                    qh += '<tr><td><a href="' + p.path + '" target="_blank" style="color:#0f4c81;text-decoration:none;" title="' + p.path + '">' + p.name + '</a></td>' +
                          '<td>' + p.views + '</td>' +
                          '<td>' + (p.unique_ips || 0) + '</td>' +
                          '<td style="font-weight:bold;color:#0f4c81;">' + p.lead_count + '</td>' +
                          '<td>' + p.conversion_rate + '%</td>' +
                          '<td>' + p.this_week_views + '</td>' +
                          '<td><span style="color:' + growthColor + ';">' + growthIcon + ' ' + p.growth_rate + '%</span></td>' +
                          '<td><span style="color:' + scoreColor + ';font-weight:bold;">' + p.quality_score + '</span></td>' +
                          '<td><span class="status-badge ' + statusClass + '">' + statusText + '</span></td></tr>';
                });
                qh += '</tbody></table>';
                qualityContainer.innerHTML = qh;
            } else if (qualityContainer) {
                qualityContainer.innerHTML = '<p style="color:#999;padding:12px;text-align:center;">暂无页面质量数据，请确保 Nginx 日志解析脚本已配置运行。</p>';
            }
        } catch (err) {
            console.error('Analytics load error:', err);
        }
    },

    renderServiceFunnel(funnel) {
        var container = document.getElementById('chart-funnel-container');
        if (!container) return;
        if (!funnel || Object.keys(funnel).length === 0) {
            container.innerHTML = '<p style="color:#999;font-size:0.85em;">暂无服务转化数据</p>';
            return;
        }
        
        // 生成转化率表格
        var statuses = ['新提交', '联系中', '已转化', '无效线索'];
        var html = '<table class="mini-table"><thead><tr><th>服务</th>';
        statuses.forEach(function(s) { html += '<th>' + s + '</th>'; });
        html += '<th>转化率</th></tr></thead><tbody>';
        
        Object.keys(funnel).forEach(function(svc) {
            html += '<tr><td><strong>' + svc + '</strong></td>';
            var total = 0;
            var converted = 0;
            statuses.forEach(function(st) {
                var count = funnel[svc][st] || 0;
                html += '<td>' + count + '</td>';
                total += count;
                if (st === '已转化') converted = count;
            });
            var rate = total > 0 ? (converted / total * 100).toFixed(0) : 0;
            html += '<td><strong>' + rate + '%</strong></td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    },

    renderSourceStats(stats) {
        var container = document.getElementById('chart-source-container');
        if (!container) return;
        if (!stats || stats.length === 0) {
            container.innerHTML = '<p style="color:#999;font-size:0.85em;">暂无来源数据</p>';
            return;
        }
        
        var total = stats.reduce(function(s, r) { return s + r.count; }, 0);
        var html = '<table class="mini-table"><thead><tr><th>来源</th><th>数量</th><th>占比</th></tr></thead><tbody>';
        stats.forEach(function(r) {
            var pct = total > 0 ? (r.count / total * 100).toFixed(1) : 0;
            html += '<tr><td>' + r.source + '</td><td>' + r.count + '</td><td>' + pct + '%</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
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

    async loadLogs(leadId) {
        try {
            const resp = await fetch('/admin/api/leads/' + leadId + '/logs', {
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            });
            const data = await resp.json();
            if (data.code !== 0) return;
            this.renderLogs(data.data || []);
        } catch (err) {
            console.error('Load logs error:', err);
        }
    },

    renderLogs(logs) {
        var container = document.getElementById('modal-timeline');
        if (!container) return;
        if (!logs.length) {
            container.innerHTML = '<div style="color:#999;font-size:0.85em;padding:8px 0;">暂无操作记录</div>';
            return;
        }
        var html = '';
        logs.forEach(function(log) {
            var time = (log.created_at || '').slice(0, 16);
            var action = '';
            if (log.action === 'update_status') action = '状态变更: ' + (log.old_value || '?') + ' → ' + log.new_value;
            else if (log.action === 'update_field') action = '字段更新: ' + log.field_name;
            else if (log.action === 'delete') action = '线索已删除';
            else action = log.action;
            html += '<div style="padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:0.85em;">';
            html += '<span style="color:#999;">' + time + '</span>';
            html += '<span style="margin-left:8px;color:#555;">' + action + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
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
            this.state.dateFrom = document.getElementById('filter-date-from').value;
            this.state.dateTo = document.getElementById('filter-date-to').value;
            this.state.page = 1;
            this.load();
        };
        document.getElementById('btn-reset').onclick = () => {
            document.getElementById('search-input').value = '';
            document.getElementById('filter-status').value = '';
            document.getElementById('filter-date-from').value = '';
            document.getElementById('filter-date-to').value = '';
            this.state = { ...this.state, search: '', status: '', dateFrom: '', dateTo: '', page: 1, sortBy: 'submit_time', sortOrder: 'desc' };
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

        // Batch operations
        const selectAllHeader = document.getElementById('select-all-header');
        selectAllHeader.onclick = () => {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => cb.checked = selectAllHeader.checked);
            this.updateBatchToolbar();
        };

        document.getElementById('select-all').onclick = () => {
            const selectAllHeader = document.getElementById('select-all-header');
            selectAllHeader.click();
        };

        document.getElementById('btn-batch-update').onclick = async () => {
            const selectedIds = this.getSelectedIds();
            const status = document.getElementById('batch-status').value;
            if (!status) {
                Toast.error('请选择要更新的状态');
                return;
            }
            const confirmed = await Confirm.show(`确认将选中的 ${selectedIds.length} 条线索状态更新为「${status}」？`, '批量更新状态');
            if (!confirmed) return;
            try {
                await API.batchUpdateStatus(selectedIds, status);
                Toast.success('批量更新成功');
                this.load();
            } catch (err) {
                Toast.error('批量更新失败：' + err.message);
            }
        };

        document.getElementById('btn-batch-delete').onclick = async () => {
            const selectedIds = this.getSelectedIds();
            const confirmed = await Confirm.show(`确认删除选中的 ${selectedIds.length} 条线索？此操作不可恢复。`, '批量删除', 'danger');
            if (!confirmed) return;
            try {
                await API.batchDelete(selectedIds);
                Toast.success('批量删除成功');
                this.load();
            } catch (err) {
                Toast.error('批量删除失败：' + err.message);
            }
        };

        document.getElementById('batch-status').onchange = () => {
            this.updateBatchToolbar();
        };
    },

    getSelectedIds() {
        const ids = [];
        document.querySelectorAll('.row-checkbox:checked').forEach(cb => {
            ids.push(parseInt(cb.dataset.id));
        });
        return ids;
    },

    updateBatchToolbar() {
        const selectedIds = this.getSelectedIds();
        const countEl = document.getElementById('selected-count');
        const updateBtn = document.getElementById('btn-batch-update');
        const deleteBtn = document.getElementById('btn-batch-delete');
        const statusSelect = document.getElementById('batch-status');

        countEl.textContent = `已选 ${selectedIds.length} 条`;
        const hasSelection = selectedIds.length > 0;
        const hasStatus = statusSelect.value !== '';

        updateBtn.disabled = !hasSelection || !hasStatus;
        deleteBtn.disabled = !hasSelection;
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
            if (this.state.dateFrom) params.date_from = this.state.dateFrom;
            if (this.state.dateTo) params.date_to = this.state.dateTo;

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

    highlightText(text, keyword) {
        if (!keyword) return DashboardView.esc(text || '');
        const regex = new RegExp(`(${DashboardView.esc(keyword)})`, 'gi');
        return (text || '').replace(regex, '<span class="highlight">$1</span>');
    },

    renderTable(leads) {
        const tbody = document.querySelector('#leads-table tbody');
        const emptyState = document.getElementById('empty-state');
        const mobileCardList = document.getElementById('mobile-card-list');
        const searchKeyword = this.state.search;

        if (!leads.length) {
            tbody.innerHTML = '';
            mobileCardList.innerHTML = '';
            emptyState.classList.remove('hidden');
            document.getElementById('pagination').classList.add('hidden');
            document.getElementById('batch-toolbar').style.display = 'none';
            return;
        }

        emptyState.classList.add('hidden');
        document.getElementById('pagination').classList.remove('hidden');
        document.getElementById('batch-toolbar').style.display = 'flex';

        tbody.innerHTML = leads.map(l => {
            const isHL = l.id === this.state.highlightId;
            return `
            <tr${isHL ? ' style="background:#eaf2fb"' : ''} data-row-id="${l.id}">
                <td><input type="checkbox" class="row-checkbox" data-id="${l.id}" style="width:16px;height:16px;"></td>
                <td><strong>${l.id}</strong></td>
                <td><strong>${this.highlightText(l.name, searchKeyword)}</strong></td>
                <td>${this.highlightText(l.company || '-', searchKeyword)}</td>
                <td><a href="tel:${DashboardView.esc(l.phone)}" style="color:#0f4c81">${this.highlightText(l.phone, searchKeyword)}</a></td>
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

        mobileCardList.innerHTML = leads.map(l => {
            const statusClass = DashboardView.statusClass(l.status);
            return `
            <div class="mobile-card status-${statusClass}" data-card-id="${l.id}">
                <div class="mobile-card-header">
                    <div>
                        <div class="mobile-card-title">${this.highlightText(l.name, searchKeyword)}</div>
                        <div style="font-size:0.75em;color:var(--color-text-muted);margin-top:2px;">#${l.id} · ${(l.submit_time || '').slice(0, 16)}</div>
                    </div>
                    <span class="mobile-card-status">${l.status}</span>
                </div>
                <div class="mobile-card-info">
                    <div class="mobile-card-info-item">
                        <span class="mobile-card-info-label">公司</span>
                        <span class="mobile-card-info-value">${this.highlightText(l.company || '-', searchKeyword)}</span>
                    </div>
                    <div class="mobile-card-info-item">
                        <span class="mobile-card-info-label">电话</span>
                        <span class="mobile-card-info-value"><a href="tel:${DashboardView.esc(l.phone)}">${this.highlightText(l.phone, searchKeyword)}</a></span>
                    </div>
                    <div class="mobile-card-info-item">
                        <span class="mobile-card-info-label">服务</span>
                        <span class="mobile-card-info-value">${DashboardView.esc(l.service_label)}</span>
                    </div>
                    <div class="mobile-card-info-item">
                        <span class="mobile-card-info-label">预算</span>
                        <span class="mobile-card-info-value">${DashboardView.esc(l.budget_label)}</span>
                    </div>
                </div>
                <div class="mobile-card-actions">
                    <button class="act-detail" data-action="detail" data-id="${l.id}">详情</button>
                    ${l.status !== '联系中' ? `<button data-action="status" data-id="${l.id}" data-status="联系中">联系中</button>` : ''}
                    ${l.status !== '已转化' ? `<button data-action="status" data-id="${l.id}" data-status="已转化">已转化</button>` : ''}
                    ${l.status !== '无效线索' ? `<button data-action="status" data-id="${l.id}" data-status="无效线索" class="act-delete">无效</button>` : ''}
                </div>
            </div>`;
        }).join('');

        // Bind row action buttons
        document.querySelectorAll('button[data-action]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = parseInt(btn.dataset.id);
                if (action === 'detail') this.openModal(id);
                if (action === 'status') this.quickStatus(id, btn.dataset.status);
            };
        });

        // Bind checkbox change events
        tbody.querySelectorAll('.row-checkbox').forEach(cb => {
            cb.onchange = () => {
                this.updateBatchToolbar();
                const selectAllHeader = document.getElementById('select-all-header');
                const allChecked = document.querySelectorAll('.row-checkbox:checked').length === 
                                   document.querySelectorAll('.row-checkbox').length;
                selectAllHeader.checked = allChecked;
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
        const row = document.querySelector(`tr[data-row-id="${id}"]`);
        const card = document.querySelector(`div[data-card-id="${id}"]`);
        
        if (row) row.classList.add('row-updating');
        if (card) card.classList.add('row-updating');
        
        try {
            await API.updateStatus(id, status);
            Toast.success(`状态已更新为「${status}」`);
            
            setTimeout(() => {
                this.load();
            }, 300);
        } catch (err) {
            Toast.error('更新失败：' + err.message);
            if (row) row.classList.remove('row-updating');
            if (card) card.classList.remove('row-updating');
        }
    },

    // ---- Detail Modal ----
    async openModal(id) {
        try {
            Loading.show();
            const data = await API.getLead(id);
            const lead = data.data;
            this._modalLead = lead;
            this.loadLogs(id);

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
                <label>操作记录</label>
                <div id="modal-timeline" style="font-size:0.85em;color:#555;max-height:150px;overflow-y:auto;"></div>
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
        const confirmed = await Confirm.show(`确认删除线索 #${this._modalLead.id}（${this._modalLead.name}）？此操作不可恢复。`, '删除线索', 'danger');
        if (!confirmed) return;
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

// ==================== AnalyticsView ====================
const AnalyticsView = {
    charts: {},

    init() {
        this.bindEvents();
        this.loadData();
    },

    bindEvents() {
        document.getElementById('btn-logout3')?.addEventListener('click', () => Auth.logout());
        
        ['hamburgerAdmin3'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const mobileNav = this.closest('.header').querySelector('.header-nav-mobile');
                    if (mobileNav) {
                        const isVisible = mobileNav.style.display === 'flex';
                        document.querySelectorAll('.header-nav-mobile').forEach(n => n.style.display = 'none');
                        mobileNav.style.display = isVisible ? 'none' : 'flex';
                    }
                });
            }
        });
    },

    async loadData() {
        try {
            Loading.show();
            const token = Auth.getToken();
            if (!token) return;
            
            const resp = await fetch('/admin/api/analytics', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json();
            if (data.code !== 0) {
                Toast.error('加载分析数据失败');
                return;
            }
            
            const d = data.data;
            this.renderSummary(d);
            this.renderCharts(d);
            this.renderPageTable(d);
            
        } catch (err) {
            Toast.error('加载分析数据失败：' + err.message);
        } finally {
            Loading.hide();
        }
    },

    renderSummary(d) {
        document.getElementById('ana2-total-views').textContent = d.total_views || 0;
        document.getElementById('ana2-total-visitors').textContent = d.total_unique_visitors || 0;
        document.getElementById('ana2-today-views').textContent = d.today_views || 0;
        document.getElementById('ana2-page-count').textContent = (d.all_pages || []).length;
    },

    renderCharts(d) {
        for (const key in this.charts) {
            this.charts[key].destroy();
        }
        this.charts = {};

        const canvas = document.getElementById('ana2-chart');
        if (canvas && d.daily_trend && d.daily_trend.length > 0 && typeof Chart !== 'undefined') {
            this.charts.trend = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: d.daily_trend.map(r => r.date.slice(5)),
                    datasets: [{
                        label: '访问量',
                        data: d.daily_trend.map(r => r.views),
                        borderColor: '#0f4c81',
                        backgroundColor: 'rgba(15,76,129,0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
                }
            });
        }

        const catCanvas = document.getElementById('ana2-category-chart');
        if (catCanvas && d.category_stats && d.category_stats.length > 0 && typeof Chart !== 'undefined') {
            const colors = ['#0f4c81', '#27ae60', '#f39c12', '#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#d35400', '#95a5a6', '#c0392b'];
            this.charts.category = new Chart(catCanvas, {
                type: 'doughnut',
                data: {
                    labels: d.category_stats.map(c => c.name),
                    datasets: [{
                        data: d.category_stats.map(c => c.views),
                        backgroundColor: colors.slice(0, d.category_stats.length),
                        borderWidth: 2,
                        borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } }
                }
            });
        }
    },

    renderPageTable(d) {
        const container = document.getElementById('analytics-table-container');
        if (!container) return;

        const pages = d.all_pages || [];
        const pageConversion = d.page_conversion || [];
        const pageDataMap = {};
        
        pageConversion.forEach(p => {
            pageDataMap[p.path] = p;
        });

        if (pages.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">暂无页面访问数据</p>';
            return;
        }

        const headers = [
            { key: 'name', label: '页面名称', width: '25%' },
            { key: 'path', label: '路径', width: '25%' },
            { key: 'views', label: '总访问量', width: '12%' },
            { key: 'unique_ips', label: '独立访客', width: '12%' },
            { key: 'this_week', label: '本周访问', width: '10%' },
            { key: 'last_week', label: '上周访问', width: '10%' },
            { key: 'growth', label: '周增长率', width: '10%' },
            { key: 'conversion', label: '转化率', width: '10%' },
            { key: 'status', label: '状态', width: '8%' }
        ];

        let html = `
            <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;">
                    <thead>
                        <tr>${headers.map(h => `<th style="width:${h.width};">${h.label}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
        `;

        pages.forEach((row, index) => {
            const path = row.path;
            const conv = pageDataMap[path] || {};
            const name = conv.name || path;
            const views = row.views;
            const unique_ips = row.unique_ips || 0;
            const this_week = conv.this_week_views || 0;
            const last_week = conv.last_week_views || 0;
            const growth = conv.growth_rate !== undefined ? conv.growth_rate : 0;
            const conversion = conv.conversion_rate !== undefined ? conv.conversion_rate : 0;
            const status = conv.status || 'normal';

            const growthClass = growth >= 0 ? 'text-green' : 'text-red';
            const growthText = growth >= 0 ? `+${growth}%` : `${growth}%`;
            
            const statusColors = {
                'excellent': '#27ae60',
                'good': '#2980b9',
                'normal': '#f39c12',
                'needs_improvement': '#e67e22',
                'critical': '#e74c3c'
            };
            const statusLabels = {
                'excellent': '优秀',
                'good': '良好',
                'normal': '正常',
                'needs_improvement': '需改进',
                'critical': '关注'
            };

            html += `
                <tr style="${index % 2 === 0 ? 'background:#fafafa;' : ''}">
                    <td style="padding:12px;font-weight:500;">${this.escape(name)}</td>
                    <td style="padding:12px;font-family:monospace;font-size:0.85em;color:#666;">${this.escape(path)}</td>
                    <td style="padding:12px;text-align:right;font-weight:600;">${views}</td>
                    <td style="padding:12px;text-align:right;">${unique_ips}</td>
                    <td style="padding:12px;text-align:right;">${this_week}</td>
                    <td style="padding:12px;text-align:right;">${last_week}</td>
                    <td style="padding:12px;text-align:right;font-weight:600;">
                        <span class="${growthClass}">${growthText}</span>
                    </td>
                    <td style="padding:12px;text-align:right;">${conversion}%</td>
                    <td style="padding:12px;text-align:center;">
                        <span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:0.75em;font-weight:500;color:#fff;background:${statusColors[status] || '#95a5a6'};">
                            ${statusLabels[status] || '未知'}
                        </span>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
            <div style="margin-top:12px;font-size:0.85em;color:#999;">
                共 ${pages.length} 个页面 · 数据更新时间：${new Date().toLocaleString('zh-CN')}
            </div>
        `;

        container.innerHTML = html;
    },

    escape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    destroy() {
        for (const key in this.charts) {
            if (this.charts[key]) {
                this.charts[key].destroy();
            }
        }
        this.charts = {};
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
            var dateFrom = document.getElementById('filter-date-from') ? document.getElementById('filter-date-from').value : '';
            var dateTo = document.getElementById('filter-date-to') ? document.getElementById('filter-date-to').value : '';
            var qs = new URLSearchParams({ q: LeadsView.state.search, status: LeadsView.state.status });
            if (dateFrom) qs.set('date_from', dateFrom);
            if (dateTo) qs.set('date_to', dateTo);
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
        Router.go(Auth.getLastPage());
    } else {
        Router.go('login');
    }
}

document.addEventListener('DOMContentLoaded', init);

})();
