/**
 * CRM Data Layer — API-backed persistence
 */
(function() {
    'use strict';

    window.CRM = {
        _cache: { projects: null, tasks: null },

        async load() {
            try {
                this._cache.projects = await API.getProjects();
                this._cache.tasks = await API.getTasks();
            } catch (err) {
                console.error('Failed to load data:', err);
                this._cache = { projects: [], tasks: [] };
            }
            return this._cache;
        },

        getProjects() { return this._cache.projects || []; },
        
        getProject(id) {
            return (this._cache.projects || []).find(p => p.id === id) || null;
        },

        async createProject(data) {
            const project = await API.createProject(data);
            this._cache.projects = await API.getProjects();
            return project;
        },

        async updateProject(id, updates) {
            const existing = this.getProject(id);
            if (!existing) return null;
            const updated = { ...existing, ...updates };
            await API.updateProject(id, updated);
            this._cache.projects = await API.getProjects();
            return updated;
        },

        async deleteProject(id) {
            await API.deleteProject(id);
            this._cache.projects = await API.getProjects();
            this._cache.tasks = await API.getTasks();
        },

        getTasks(projectId) {
            const tasks = this._cache.tasks || [];
            return projectId ? tasks.filter(t => t.project_id === projectId) : tasks;
        },

        async addTask(data) {
            const task = await API.createTask(data);
            this._cache.tasks = await API.getTasks();
            return task;
        },

        async updateTask(id, updates) {
            const existing = (this._cache.tasks || []).find(t => t.id === id);
            if (!existing) return null;
            const updated = { ...existing, ...updates };
            await API.updateTask(id, updated);
            this._cache.tasks = await API.getTasks();
            return updated;
        },

        async deleteTask(id) {
            await API.deleteTask(id);
            this._cache.tasks = await API.getTasks();
        },

        async getSubtasks(taskId) {
            return API.getSubtasks(taskId);
        },

        async addSubtask(data) {
            return API.createSubtask(data);
        },

        async updateSubtask(id, data) {
            return API.updateSubtask(id, data);
        },

        async deleteSubtask(id) {
            return API.deleteSubtask(id);
        },

        async getDocuments(projectId) {
            return API.getDocuments(projectId);
        },

        async addDocument(data) {
            return API.addDocument(data);
        },

        async deleteDocument(id) {
            return API.deleteDocument(id);
        },

        async getActivity(projectId, limit) {
            return API.getActivity(projectId, limit);
        },

        async getStats() {
            return API.getStats();
        },

        async moveTask(taskId, newColumn) {
            const task = (this._cache.tasks || []).find(t => t.id === taskId);
            if (!task) return;
            await this.updateTask(taskId, {
                column_status: newColumn,
                done: newColumn === 'Готово' ? 1 : 0
            });
        }
    };
})();
