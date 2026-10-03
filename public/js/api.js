// Extract and preserve desktop kiosk authentication token
const _urlParams = new URLSearchParams(window.location.search);
const _initialAppToken = _urlParams.get('authToken') || _urlParams.get('token');
if (_initialAppToken) {
  sessionStorage.setItem('dsp_app_token', _initialAppToken);
}

// Resolve the backend port dynamically:
//  - In Electron: preload exposes serverPort from main process env (process.env.PORT)
//  - In browser dev mode: use location.port (e.g. localhost:4000 → '4000')
//  - Fallback: '4000'
const _SERVER_PORT = (window.electronAPI && window.electronAPI.serverPort)
  ? String(window.electronAPI.serverPort)
  : (location.port || '4000');
const _API_HOST = `http://127.0.0.1:${_SERVER_PORT}`;

// public/js/api.js - API client with volatile in-memory session management
let _cachedDesktopSecret = null;
const api = {
  // In-memory token strictly bound to this process session
  token: null,
  currentUser: null,

  setSession(token, user) {
    this.token = token;
    this.currentUser = user;
    sessionStorage.setItem('dsp_token', token);
    sessionStorage.setItem('dsp_user', JSON.stringify(user));
  },

  restoreSession() {
    const token = sessionStorage.getItem('dsp_token');
    const userJson = sessionStorage.getItem('dsp_user');
    if (token && userJson) {
      try {
        this.token = token;
        this.currentUser = JSON.parse(userJson);
        return true;
      } catch (e) {
        this.clearSession();
      }
    }
    return false;
  },

  clearSession() {
    this.token = null;
    this.currentUser = null;
    sessionStorage.removeItem('dsp_token');
    sessionStorage.removeItem('dsp_user');
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const appToken = sessionStorage.getItem('dsp_app_token') || _urlParams.get('authToken');
    if (appToken) {
      headers['X-App-Token'] = appToken;
    }
    headers['Content-Type'] = 'application/json';

    if (!_cachedDesktopSecret && window.electronAPI && typeof window.electronAPI.getDesktopSecret === 'function') {
      try {
        _cachedDesktopSecret = await window.electronAPI.getDesktopSecret();
      } catch (e) {}
    }
    if (_cachedDesktopSecret) {
      headers['X-Desktop-Secret'] = _cachedDesktopSecret;
    }

    const apiBase = (window.location.protocol === 'file:' || window.location.protocol === 'app:')
      ? _API_HOST
      : '';
    const targetUrl = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`;

    try {
      const res = await fetch(targetUrl, {
        ...options,
        headers
      });

      if (res.status === 401) {
        this.clearSession();
        if (typeof showLoginScreen === 'function') {
          showLoginScreen('Your session has expired. Please login again.');
        }
        throw new Error('Session expired');
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Server request failed');
      }
      return data;
    } catch (err) {
      throw err;
    }
  },

  // Auth endpoints
  async login(username, password) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.setSession(res.token, res.user);
    return res;
  },

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout notification error:', e.message);
    } finally {
      this.clearSession();
    }
  },


  async changePassword(currentPassword, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  // Box endpoints
  async getBoxes(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/boxes?${qs}`);
  },

  async getModels() {
    return this.request('/api/boxes/models');
  },

  async holdBox(id, reason, remarks) {
    return this.request(`/api/boxes/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify({ reason, remarks })
    });
  },

  async releaseHold(id, remarks) {
    return this.request(`/api/boxes/${id}/release-hold`, {
      method: 'POST',
      body: JSON.stringify({ remarks })
    });
  },

  async rejectBox(id, reason, remarks) {
    return this.request(`/api/boxes/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, remarks })
    });
  },

  async reopenBox(id, remarks) {
    return this.request(`/api/boxes/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ remarks })
    });
  },

  // Dispatch endpoints
  async getActiveDispatch() {
    return this.request('/api/dispatch/active');
  },

  async planDispatch(modelId, targetType, targetQuantity) {
    return this.request('/api/dispatch/plan', {
      method: 'POST',
      body: JSON.stringify({ modelId, targetType, targetQuantity })
    });
  },

  async scanBox(dispatchId, scannedPayload) {
    return this.request('/api/dispatch/scan', {
      method: 'POST',
      body: JSON.stringify({ dispatchId, scannedPayload })
    });
  },

  async confirmDispatch(dispatchId, notes) {
    return this.request('/api/dispatch/confirm', {
      method: 'POST',
      body: JSON.stringify({ dispatchId, notes })
    });
  },

  async cancelDispatch(dispatchId, reason) {
    return this.request('/api/dispatch/cancel', {
      method: 'POST',
      body: JSON.stringify({ dispatchId, reason })
    });
  },

  async getDispatchBill(dispatchId) {
    return this.request(`/api/dispatch/bill/${dispatchId}`);
  },

  async getDispatchManifest(dispatchId) {
    return this.request(`/api/dispatch/bill/${dispatchId}`);
  },

  // Reports
  async getMonthlyReports() {
    return this.request('/api/reports/monthly');
  },

  async getFilteredReports(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/reports/monthly${qs ? `?${qs}` : ''}`);
  },

  async getDispatchHistory(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/reports/history?${qs}`);
  },

  // Trace
  async traceBox(query) {
    return this.request(`/api/trace/${encodeURIComponent(query)}`);
  },

  // System
  async getSystemStatus() {
    return this.request('/api/system/status');
  },

  async testDatabase(mongoUri) {
    return this.request('/api/system/db-test', {
      method: 'POST',
      body: JSON.stringify({ mongoUri })
    });
  },

  async saveDatabaseConfig(mongoUri) {
    return this.request('/api/system/db-config', {
      method: 'POST',
      body: JSON.stringify({ mongoUri })
    });
  },

  async getLegalDocuments() {
    return this.request('/api/system/legal');
  },

  async getComPorts() {
    return this.request('/api/system/com-ports');
  },

  async saveComConfig(config) {
    const payload = typeof config === 'object' ? config : { port: arguments[0], baudRate: arguments[1] };
    return this.request('/api/system/com-config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },



  async getUsers() {
    return this.request('/api/system/users');
  },

  async createUser(userData) {
    return this.request('/api/system/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  async resetPassword(userId, newPassword) {
    return this.request(`/api/system/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
  },

  async updateUser(userId, data) {
    return this.request(`/api/system/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async toggleUserActive(userId) {
    return this.request(`/api/system/users/${userId}/toggle-active`, {
      method: 'PATCH'
    });
  },

  async deleteUser(userId) {
    return this.request(`/api/system/users/${userId}`, {
      method: 'DELETE'
    });
  },

  async getLicense() {
    return this.request('/api/system/license');
  },

  async activateLicense(licenseKey) {
    return this.request('/api/system/license', {
      method: 'POST',
      body: JSON.stringify({ licenseKey })
    });
  },

  async getAuditReasons() {
    return this.request('/api/system/reasons');
  },

  async saveAuditReasons(data) {
    return this.request('/api/system/reasons', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};
