/**
 * CRM API Client with Authentication
 */

// ==================== LOADING BAR ====================
const LoadingBar = {
    _el: null,
    _count: 0,

    _ensure() {
        if (this._el) return;
        this._el = document.createElement('div');
        this._el.id = 'loadingBar';
        this._el.innerHTML = '<div class="loading-bar-progress"></div>';
        document.body.prepend(this._el);
    },

    show() {
        this._ensure();
        this._count++;
        this._el.classList.add('active');
    },

    hide() {
        this._count = Math.max(0, this._count - 1);
        if (this._count === 0 && this._el) {
            this._el.classList.remove('active');
        }
    }
};

const API = {
    baseUrl: '/api',
    token: localStorage.getItem('crm_token'),

    setToken(token) {
        this.token = token;
        localStorage.setItem('crm_token', token);
    },

    clearToken() {
        this.token = null;
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_user');
    },

    getCurrentUser() {
        const user = localStorage.getItem('crm_user');
        return user ? JSON.parse(user) : null;
    },

    saveUser(user) {
        localStorage.setItem('crm_user', JSON.stringify(user));
    },

    isLoggedIn() {
        return !!this.token;
    },

    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = '/pages/login.html';
            return false;
        }
        return true;
    },

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
                ...options.headers
            },
            ...options
        };

        LoadingBar.show();
        try {
            const response = await fetch(url, config);
            // 401 on /login means wrong credentials — let it fall through to the
            // error handler below instead of redirecting (which cleared the form silently)
            if (response.status === 401 && endpoint !== '/login') {
                this.clearToken();
                window.location.href = '/pages/login.html';
                return null;
            }
            if (!response.ok) {
                let error;
                try { error = await response.json(); } catch { error = { error: 'Ошибка сервера (' + response.status + ')' }; }
                throw new Error(error.error || 'Request failed');
            }
            return await response.json();
        } catch (err) {
            console.error('API Error:', err);
            throw err;
        } finally {
            LoadingBar.hide();
        }
    },

    // Auth
    async login(username, password, remember = true) {
        const result = await this.request('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password, remember })
        });
        if (result && result.token) {
            this.setToken(result.token);
            this.saveUser(result.user);
        }
        return result;
    },

    async logout() {
        try { await this.request('/logout', { method: 'POST' }); } catch (err) {}
        this.clearToken();
        window.location.href = '/pages/login.html';
    },

    async checkAuth() {
        try { return (await this.request('/auth/me'))?.user; } catch (err) { return null; }
    },

    // Projects
    async getProjects() { return this.request('/projects'); },
    async getProject(id) { return this.request(`/projects/${id}`); },
    async createProject(data) { return this.request('/projects', { method: 'POST', body: JSON.stringify(data) }); },
    async updateProject(id, data) { return this.request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
    async deleteProject(id) { return this.request(`/projects/${id}`, { method: 'DELETE' }); },

    // Hashtags
    async gethashtags() { return this.request('/hashtags'); },

    // Tasks
    async getTasks(projectId = null) {
        const query = projectId ? `?project_id=${projectId}` : '';
        return this.request(`/tasks${query}`);
    },
    async createTask(data) { return this.request('/tasks', { method: 'POST', body: JSON.stringify(data) }); },
    async updateTask(id, data) { return this.request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
    async deleteTask(id) { return this.request(`/tasks/${id}`, { method: 'DELETE' }); },

    // Subtasks
    async getSubtasks(taskId) { return this.request(`/tasks/${taskId}/subtasks`); },
    async createSubtask(data) { return this.request('/subtasks', { method: 'POST', body: JSON.stringify(data) }); },
    async updateSubtask(id, data) { return this.request(`/subtasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
    async deleteSubtask(id) { return this.request(`/subtasks/${id}`, { method: 'DELETE' }); },

    // Documents
    async getDocuments(projectId = null) {
        const query = projectId ? `?project_id=${projectId}` : '';
        return this.request(`/documents${query}`);
    },
    async addDocument(data) { return this.request('/documents', { method: 'POST', body: JSON.stringify(data) }); },
    async deleteDocument(id) { return this.request(`/documents/${id}`, { method: 'DELETE' }); },

    async getWikiKinds() { return this.request('/wiki-kinds'); },
    async createWikiKind(data) { return this.request('/wiki-kinds', { method: 'POST', body: JSON.stringify(data) }); },
    async deleteWikiKind(id) {
        LoadingBar.show();
        try {
            const res = await fetch(`${this.baseUrl}/wiki-kinds/${id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.token ? { Authorization: 'Bearer ' + this.token } : {})
                }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error(data.error || 'Ошибка удаления типа');
                err.status = res.status;
                err.data = data;
                throw err;
            }
            return data;
        } finally {
            LoadingBar.hide();
        }
    },
    async uploadFile(formData) {
        LoadingBar.show();
        try {
            if (!this.token) {
                throw new Error('Нет авторизации — войдите в аккаунт заново');
            }
            let res;
            try {
                res = await fetch('/api/uploads', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + this.token },
                    body: formData
                });
            } catch (netErr) {
                throw new Error('Сеть: не удалось связаться с сервером (' + (netErr.message || 'offline') + ')');
            }
            if (!res.ok) {
                let err = {};
                let raw = '';
                try { raw = await res.text(); err = JSON.parse(raw); } catch (e) {}
                const detail = err.error || raw.slice(0, 120) || res.statusText || 'без текста';
                let msg;
                if (res.status === 401) msg = 'Нет доступа (401) — сессия истекла, войдите снова';
                else if (res.status === 404) msg = 'API /api/uploads не найден (404) — перезапустите сервер';
                else if (res.status === 413) msg = 'Файл слишком большой для сервера (413)';
                else if (res.status === 400) msg = detail;
                else msg = 'Ошибка загрузки HTTP ' + res.status + ': ' + detail;
                const error = new Error(msg);
                error.status = res.status;
                error.data = err;
                throw error;
            }
            return res.json();
        } finally {
            LoadingBar.hide();
        }
    },

    async getWikiPages(params = {}) {
        const q = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') q.set(k, v);
        });
        const qs = q.toString();
        return this.request(`/wiki-pages${qs ? '?' + qs : ''}`);
    },
    async getWikiPage(id) { return this.request(`/wiki-pages/${id}`); },
    async createWikiPage(data) { return this.request('/wiki-pages', { method: 'POST', body: JSON.stringify(data) }); },
    async updateWikiPage(id, data) { return this.request(`/wiki-pages/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
    async reorderWikiPages(items) {
        return this.request('/wiki-pages/reorder', {
            method: 'POST',
            body: JSON.stringify({ items })
        });
    },
    async deleteWikiPage(id) { return this.request(`/wiki-pages/${id}`, { method: 'DELETE' }); },
    async uploadWikiPage(formData) {
        LoadingBar.show();
        try {
            if (!this.token) throw new Error('Нет авторизации — войдите заново');
            let res;
            try {
                res = await fetch('/api/wiki-pages/upload', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + this.token },
                    body: formData
                });
            } catch (netErr) {
                throw new Error('Сеть: ' + (netErr.message || 'нет связи с сервером'));
            }
            if (!res.ok) {
                let err = {};
                let raw = '';
                try { raw = await res.text(); err = JSON.parse(raw); } catch (e) {}
                const detail = err.error || raw.slice(0, 120) || res.statusText;
                if (res.status === 404) throw new Error('API wiki-upload не найден (404) — перезапустите сервер');
                throw new Error((detail || 'Ошибка загрузки') + ' [' + res.status + ']');
            }
            return res.json();
        } finally {
            LoadingBar.hide();
        }
    },

    // Calls
    async getCalls(projectId = null) {
        const query = projectId ? `?project_id=${projectId}` : '';
        return this.request(`/calls${query}`);
    },
    async addCall(data) { return this.request('/calls', { method: 'POST', body: JSON.stringify(data) }); },
    async deleteCall(id) { return this.request(`/calls/${id}`, { method: 'DELETE' }); },

    // Activity
    async getActivity(projectId = null, limit = 50) {
        const params = new URLSearchParams();
        if (projectId) params.append('project_id', projectId);
        params.append('limit', limit);
        return this.request(`/activity?${params.toString()}`);
    },

    // Stats
    async getStats() { return this.request('/stats'); },

    // Convenience methods
    async get(url) { return this.request(url.replace('/api', '')); },
    async post(url, data) { return this.request(url.replace('/api', ''), { method: 'POST', body: JSON.stringify(data) }); },
    async put(url, data) { return this.request(url.replace('/api', ''), { method: 'PUT', body: JSON.stringify(data) }); },
    async delete(url) { return this.request(url.replace('/api', ''), { method: 'DELETE' }); }
};

// Toast
function showToast(msg, type = 'success') {
    const icons = {
        success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
        error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };
    const colors = { success: '#10B981', error: '#EF4444', info: '#4F46E5' };

    const t = document.createElement('div');
    t.className = 'toast-item';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;align-items:center;gap:10px;padding:14px 20px;border-radius:10px;font-size:0.875rem;font-weight:500;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.2);transition:all 0.3s ease;max-width:400px;`;
    t.style.background = colors[type] || colors.info;
    t.innerHTML = `<span style="flex-shrink:0;display:flex;">${icons[type] || icons.info}</span><span style="flex:1;">${msg}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;padding:2px;margin-left:8px;font-size:1.1rem;line-height:1;" aria-label="Закрыть">&times;</button>`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 300); }, 4000);
}

// Modals
function openModal(id) {
    const el = document.getElementById(id);
    const overlay = document.getElementById('modalOverlay');
    if (!el || !overlay) return;
    if (!overlay.contains(el)) { overlay.innerHTML = ''; overlay.appendChild(el); }
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}

/**
 * Close modal.
 * closeModal(true) or closeModal({ discardDraft: true }) — clear draft (крестик / отмена)
 * closeModal() — keep draft (клик по фону)
 */
function closeModal(opts) {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    const discard = opts === true || (opts && typeof opts === 'object' && opts.discardDraft === true);
    const draftEl = overlay.querySelector('[data-draft-key]');
    const draftKey = draftEl ? draftEl.getAttribute('data-draft-key') : '';
    if (overlay._draftTimer) {
        clearInterval(overlay._draftTimer);
        overlay._draftTimer = null;
    }
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    if (discard && draftKey && typeof DraftStore !== 'undefined') {
        DraftStore.clear(draftKey);
    }
}
