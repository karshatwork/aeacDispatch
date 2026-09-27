// public/js/app.js - Main Application Controller
let activeTx = null;
let currentTab = 'tab-dispatch';
let ws = null;
let dailyChart = null;
let modelChart = null;
let systemAlarmCallback = null;
let currentQuantityMode = 'boxes';

function setQuantityMode(mode) {
  currentQuantityMode = mode;
  const btnBoxes = document.getElementById('btn-mode-boxes');
  const btnParts = document.getElementById('btn-mode-parts');
  const label = document.getElementById('dispatch-qty-label');
  const input = document.getElementById('dispatch-target-qty');

  if (mode === 'boxes') {
    if (btnBoxes) btnBoxes.className = 'toggle-segment active';
    if (btnParts) btnParts.className = 'toggle-segment';
    if (label) label.textContent = 'REQUIRED BOXES COUNT';
    if (input && parseInt(input.value, 10) > 15) input.value = 2;
  } else {
    if (btnBoxes) btnBoxes.className = 'toggle-segment';
    if (btnParts) btnParts.className = 'toggle-segment active';
    if (label) label.textContent = 'REQUIRED PARTS COUNT';
    if (input && parseInt(input.value, 10) <= 10) input.value = 50;
  }
}

// ============================================================================
// INITIALIZATION & AUTH LIFECYCLE
// ============================================================================
function initTitlebarControls() {
  const minBtn = document.getElementById('win-btn-minimize');
  const maxBtn = document.getElementById('win-btn-maximize');
  const closeBtn = document.getElementById('win-btn-close');
  const maxIcon = document.getElementById('win-max-icon');
  const titlebar = document.getElementById('app-titlebar');

  if (minBtn) {
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && typeof window.electronAPI.minimizeWindow === 'function') {
        window.electronAPI.minimizeWindow();
      }
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && typeof window.electronAPI.maximizeWindow === 'function') {
        window.electronAPI.maximizeWindow();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.electronAPI && typeof window.electronAPI.closeWindow === 'function') {
        window.electronAPI.closeWindow();
      }
    });
  }

  if (titlebar) {
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.titlebar-controls')) return;
      if (window.electronAPI && typeof window.electronAPI.maximizeWindow === 'function') {
        window.electronAPI.maximizeWindow();
      }
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onWindowStateChange === 'function') {
    window.electronAPI.onWindowStateChange((data) => {
      if (maxIcon) {
        if (data && data.isMaximized) {
          maxIcon.className = 'ri-file-copy-line';
          if (maxBtn) maxBtn.title = 'Restore Window';
        } else {
          maxIcon.className = 'ri-checkbox-blank-line';
          if (maxBtn) maxBtn.title = 'Maximize Window';
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize native titlebar controls
  initTitlebarControls();

  // Clean URL immediately so tokens are never exposed in window title, location bar, or history
  if (window.history && window.history.replaceState && window.location.search) {
    window.history.replaceState(null, 'RecordKeeper Dispatch - Dispatch Management System', window.location.pathname);
  }

  // Start digital telemetry clock immediately (active on login and in-terminal)
  startClock();

  // Initial health check & start 5-second telemetry polling
  checkSystemHealth();
  setInterval(checkSystemHealth, 5000);

  // Check if session exists in memory
  if (api.restoreSession()) {
    initApp();
  } else {
    showLoginScreen();
  }

  // Synchronize audio button state with stored settings
  updateAudioToggleUI();

  // Setup login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);
});

// ============================================================================
// ON-SCREEN SYSTEM ALARM & DATABASE TELEMETRY
// ============================================================================
function showSystemAlarm(title, message, onAction = null, actionLabel = 'RESOLVE') {
  const banner = document.getElementById('global-system-alarm');
  if (!banner) return;
  document.getElementById('global-alarm-title').textContent = title;
  document.getElementById('global-alarm-msg').textContent = message;

  const btn = document.getElementById('global-alarm-btn');
  if (onAction) {
    btn.style.display = 'inline-block';
    btn.textContent = actionLabel;
    systemAlarmCallback = onAction;
  } else {
    btn.style.display = 'none';
    systemAlarmCallback = null;
  }
  banner.style.display = 'flex';
}

function dismissGlobalAlarm() {
  const banner = document.getElementById('global-system-alarm');
  if (banner) banner.style.display = 'none';
  systemAlarmCallback = null;
}

function handleAlarmAction() {
  if (typeof systemAlarmCallback === 'function') {
    systemAlarmCallback();
  }
}

async function checkSystemHealth() {
  try {
    const res = await api.request('/api/system/health');
    if (res && res.database) {
      updateDbTelemetry(res.database);
    }
    if (res && res.scanner) {
      updateScannerStatusPill(res.scanner);
    }
    if (res && res.license) {
      if (!res.license.valid) {
        customModal.showLicenseModal(res.license.machineCode);
      }
    }
  } catch (err) {
    updateDbTelemetry({ isConnected: false, lastError: 'API Server offline / unreachable' });
  }
}

function updateFaviconState(isOffline) {
  const link = document.querySelector("link[rel*='icon']");
  if (!link) return;
  if (!isOffline) {
    link.href = '/favicon.ico';
    return;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = '/favicon.ico';
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 32, 32);
      const imgData = ctx.getImageData(0, 0, 32, 32);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const avg = (imgData.data[i] + imgData.data[i + 1] + imgData.data[i + 2]) / 3;
        imgData.data[i] = avg;
        imgData.data[i + 1] = avg;
        imgData.data[i + 2] = avg;
      }
      ctx.putImageData(imgData, 0, 0);
      link.href = canvas.toDataURL('image/png');
    };
  } catch (e) { }
}

function updateDbTelemetry(db) {
  const chip = document.getElementById('header-db-chip');
  const led = document.getElementById('header-db-led');
  const text = document.getElementById('header-db-text');
  const loginWarn = document.getElementById('login-db-warning');
  const loginWarnText = document.getElementById('login-db-warning-text');

  if (db.isConnected) {
    updateFaviconState(false);
    if (led) led.className = 'status-led led-green';
    if (text) text.textContent = db.isEmbedded ? 'DATABASE (IN-MEMORY DEV)' : 'DATABASE ONLINE';
    if (chip) chip.title = `Connected to ${db.host || 'MongoDB'}/${db.name || ''} - Click for settings`;
    if (loginWarn) loginWarn.style.display = 'none';
    dismissGlobalAlarm();
  } else {
    updateFaviconState(true);
    if (led) led.className = 'status-led led-red';
    if (text) text.textContent = 'DATABASE OFFLINE';
    const errorDetails = db.lastError || 'Connection refused';
    const targetUri = db.configuredUri || 'configured host';
    if (chip) chip.title = `DB Disconnected (${targetUri}): ${errorDetails}`;

    // Show warning on login screen
    if (loginWarn) {
      loginWarn.style.display = 'block';
      if (loginWarnText) {
        loginWarnText.textContent = `Cannot reach ${targetUri} (${errorDetails}). Safe Mode active. Login requires a working database.`;
      }
    }

    // If logged in, show on-screen alarm banner
    if (api.currentUser) {
      showSystemAlarm(
        'ALARM: DATABASE OFFLINE (SAFE MODE)',
        `MongoDB unreachable at ${targetUri}: ${errorDetails}. Reconfigure connection parameters.`,
        () => switchTab('tab-system'),
        'DB SETTINGS'
      );
    }
  }
}

async function handleDbChipClick() {
  if (api.currentUser) {
    if (['manager', 'admin'].includes(api.currentUser.role)) {
      switchTab('tab-system');
    } else {
      await customModal.alert('Database telemetry can be configured by Managers and Administrators in System Settings.', { title: 'ACCESS RESTRICTED', type: 'warning' });
    }
  } else {
    await customModal.alert('Please login to configure Database parameters in System Settings.', { title: 'AUTHENTICATION REQUIRED', type: 'info' });
  }
}


function showLoginScreen(errorMessage = '') {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('terminal-shell').style.display = 'none';
  const userWrap = document.querySelector('.titlebar-user-wrap');
  if (userWrap) userWrap.style.display = 'none';
  const dd = document.getElementById('titlebar-user-dropdown');
  if (dd) dd.classList.remove('active');
  const unameEl = document.getElementById('header-username');
  if (unameEl) unameEl.textContent = '--';
  const roleEl = document.getElementById('header-role');
  if (roleEl) roleEl.textContent = '--';
  const fullEl = document.getElementById('dropdown-username-full');
  if (fullEl) fullEl.textContent = '--';
  const errBox = document.getElementById('login-error');
  if (errorMessage) {
    errBox.textContent = errorMessage;
    errBox.style.display = 'block';
  } else {
    errBox.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value;
  const errBox = document.getElementById('login-error');

  errBox.style.display = 'none';

  if (!usernameInput || !passwordInput) {
    sounds.init();
    sounds.playViolation();
    errBox.textContent = !usernameInput
      ? 'Please enter operator username.'
      : 'Please enter password.';
    errBox.style.display = 'block';
    if (!usernameInput) {
      document.getElementById('login-username').focus();
    } else {
      document.getElementById('login-password').focus();
    }
    return;
  }

  try {
    const res = await api.login(usernameInput, passwordInput);
    sounds.init();
    sounds.playSuccess();
    initApp();
  } catch (err) {
    sounds.init();
    sounds.playViolation();
    errBox.textContent = err.message || 'Login failed';
    errBox.style.display = 'block';
  }
}

function handleLogout() {
  currentTab = 'tab-dispatch';
  api.clearSession();
  if (ws) {
    ws.close();
    ws = null;
  }
  showLoginScreen('You have logged out.');
}

async function initApp() {
  currentTab = 'tab-dispatch';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('terminal-shell').style.display = 'flex';
  const userWrap = document.querySelector('.titlebar-user-wrap');
  if (userWrap) userWrap.style.display = 'block';

  const user = api.currentUser;
  const unameEl = document.getElementById('header-username');
  if (unameEl) unameEl.textContent = user.username.toUpperCase();
  const roleEl = document.getElementById('header-role');
  if (roleEl) roleEl.textContent = user.role.toUpperCase();
  const fullEl = document.getElementById('dropdown-username-full');
  if (fullEl) fullEl.textContent = `${user.username.toUpperCase()} (${user.role.toUpperCase()})`;
  updateAudioToggleUI();

  // Role visibility: Hide tabs if unauthorized
  const userRole = user.role;
  const isSupervisorOrAbove = ['supervisor', 'manager', 'admin'].includes(userRole);
  const isManagerOrAbove = ['manager', 'admin'].includes(userRole);

  const tabHoldReject = document.querySelector('[data-tab="tab-hold-reject"]');
  const tabReports = document.querySelector('[data-tab="tab-reports"]');
  const tabUsers = document.querySelector('[data-tab="tab-users"]');
  const tabSystem = document.querySelector('[data-tab="tab-system"]');

  if (tabHoldReject) tabHoldReject.style.display = isSupervisorOrAbove ? 'flex' : 'none';
  if (tabReports) tabReports.style.display = isSupervisorOrAbove ? 'flex' : 'none';
  if (tabUsers) tabUsers.style.display = isManagerOrAbove ? 'flex' : 'none';
  if (tabSystem) tabSystem.style.display = isManagerOrAbove ? 'flex' : 'none';

  // Connect WebSocket
  connectWebSocket();

  // Start digital telemetry clock
  startClock();

  // Load Initial Tab
  switchTab(currentTab);

  // Check active dispatch
  checkActiveDispatch();
}

// ============================================================================
// WEBSOCKET FOR HARDWARE COM SCANNER & TELEMETRY
// ============================================================================
async function connectWebSocket() {
  if (ws) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const appToken = sessionStorage.getItem('dsp_app_token') || new URLSearchParams(location.search).get('authToken');

  // Resolve host:port — in Electron use preload-injected port; in browser use location.host
  const serverPort = (window.electronAPI && window.electronAPI.serverPort)
    ? String(window.electronAPI.serverPort)
    : (location.port || '4000');
  const host = (location.host && location.host.length > 0 && location.protocol.startsWith('http'))
    ? location.host
    : `127.0.0.1:${serverPort}`;

  let secret = '';
  if (window.electronAPI && typeof window.electronAPI.getDesktopSecret === 'function') {
    try {
      secret = await window.electronAPI.getDesktopSecret();
    } catch (e) { }
  }

  const params = new URLSearchParams();
  if (appToken) params.set('authToken', appToken);
  if (secret) params.set('desktopSecret', secret);
  const q = params.toString() ? `?${params.toString()}` : '';
  const wsUrl = `${protocol}//${host}${q}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to live hardware channel');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'SCANNER_STATUS') {
        updateScannerStatusPill(msg.payload);
      } else if (msg.type === 'SCANNER_DATA') {
        handleHardwareScan(msg.payload.qrData);
      }
    } catch (e) { }
  };

  ws.onclose = () => {
    ws = null;
    setTimeout(connectWebSocket, 3000);
  };
}

function updateScannerStatusPill(status) {
  const pill = document.getElementById('header-scanner-status');
  if (!pill) return;
  const port = status.activePort || 'COM3';
  if (status.isConnected) {
    pill.innerHTML = `<span class="status-led led-green"></span> <span>SCANNER ONLINE</span>`;
    pill.title = `Hardware Scanner (${port}) - Online & Ready`;
  } else {
    pill.innerHTML = `<span class="status-led led-amber"></span> <span>SCANNER OFFLINE</span>`;
    pill.title = `Hardware Scanner (${port}) - Waiting for connection`;
  }
}

function handleHardwareScan(qrData) {
  console.log('[HARDWARE SCAN]', qrData);
  if (currentTab === 'tab-dispatch' && activeTx && activeTx.status === 'in_progress') {
    processBoxScan(qrData);
  } else if (currentTab === 'tab-traceability') {
    document.getElementById('trace-query-input').value = qrData;
    executeTrace(qrData);
  } else {
    showBannerAlert(`Scanned QR: ${qrData}`, 'info');
  }
}

// ============================================================================
// TAB NAVIGATION & CLOCK
// ============================================================================
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.view-content').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.rail-item, .nav-tab').forEach(tab => tab.classList.remove('active'));

  const targetView = document.getElementById(tabId);
  const targetTab = document.querySelector(`[data-tab="${tabId}"]`);

  if (targetView) targetView.classList.add('active');
  if (targetTab) targetTab.classList.add('active');

  // Load view-specific data
  if (tabId === 'tab-dispatch') loadDispatchView();
  else if (tabId === 'tab-inventory') loadInventoryView();
  else if (tabId === 'tab-hold-reject') loadHoldRejectView();
  else if (tabId === 'tab-reports') loadReportsView();
  else if (tabId === 'tab-users') loadUsersTable();
  else if (tabId === 'tab-system') loadSystemView();
}

let _clockInterval = null;
function startClock() {
  if (_clockInterval) return;
  function update() {
    const el = document.getElementById('clock-display');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString([], { hour12: false });
    }
  }
  update();
  _clockInterval = setInterval(update, 1000);
}

function updateAudioToggleUI() {
  const btn = document.getElementById('btn-audio-mute');
  if (!btn) return;
  const isMuted = sounds.muted;
  btn.innerHTML = isMuted
    ? '<i class="ri-volume-mute-line" style="color: #f87171; font-size: 15px;"></i> <span>Audio Feedback: MUTED</span>'
    : '<i class="ri-volume-up-line" style="color: #38bdf8; font-size: 15px;"></i> <span>Audio Feedback: ON</span>';
  btn.title = isMuted ? 'Unmute Sound' : 'Mute Sound';
}

function handleToggleAudio() {
  sounds.toggleMute();
  updateAudioToggleUI();
  if (!sounds.muted) sounds.playClick();
}

// Global tactile click feedback
document.addEventListener('click', (e) => {
  if (e.target.closest('button, .rail-item, .nav-tab, .btn-scada')) {
    sounds.playClick();
  }
});

// ============================================================================
// VIEW 1: DISPATCH TERMINAL
// ============================================================================

async function loadDispatchView() {
  await loadModelSelector();
  await checkActiveDispatch();
}

async function loadModelSelector() {
  try {
    const res = await api.getModels();
    const select = document.getElementById('dispatch-model-select');
    select.innerHTML = '';

    res.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.modelId;
      opt.textContent = `${m.modelId} - ${m.modelName} (Part: ${m.customerPartNo})`;
      opt.dataset.availableBoxes = m.availableBoxes;
      opt.dataset.availableParts = m.availableParts;
      select.appendChild(opt);
    });

    updateAvailableStockDisplay();
    select.onchange = updateAvailableStockDisplay;
  } catch (err) {
    console.error('Failed to load models:', err.message);
  }
}

function updateAvailableStockDisplay() {
  const select = document.getElementById('dispatch-model-select');
  const selectedOpt = select.options[select.selectedIndex];
  if (!selectedOpt) return;

  const boxes = selectedOpt.dataset.availableBoxes || 0;
  const parts = selectedOpt.dataset.availableParts || 0;

  document.getElementById('disp-avail-boxes').textContent = `${boxes} BOXES`;
  document.getElementById('disp-avail-parts').textContent = `${parts} AVAILABLE PARTS`;
}


async function checkActiveDispatch() {
  try {
    const res = await api.getActiveDispatch();
    if (res.activeTransaction) {
      activeTx = res.activeTransaction;
      renderActiveDispatchUI();
    } else {
      activeTx = null;
      renderIdleDispatchUI();
    }
  } catch (err) {
    console.error('Check active dispatch error:', err.message);
  }
}

async function handleStartDispatch() {
  const select = document.getElementById('dispatch-model-select');
  const modelId = select.value;
  const qty = parseInt(document.getElementById('dispatch-target-qty').value, 10);

  if (!qty || qty <= 0) {
    await customModal.alert('Please enter a positive required quantity', { title: 'INVALID QUANTITY', type: 'warning' });
    return;
  }

  try {
    const res = await api.planDispatch(modelId, currentQuantityMode, qty);
    activeTx = res.transaction;
    sounds.playSuccess();
    renderActiveDispatchUI();
    showBannerAlert(res.message, 'success');
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Could not start dispatch: ' + err.message, { title: 'DISPATCH ERROR', type: 'danger' });
  }
}

function renderActiveDispatchUI() {
  document.getElementById('dispatch-setup-card').style.display = 'none';
  document.getElementById('dispatch-active-card').style.display = 'block';

  document.getElementById('active-tx-id').textContent = activeTx.dispatchId;
  document.getElementById('active-tx-target').textContent = `${activeTx.targetQuantity} ${activeTx.targetType.toUpperCase()}`;
  document.getElementById('active-tx-model').textContent = activeTx.modelId;
  document.getElementById('active-tx-operator').textContent = activeTx.operatorUsername;

  // Render Pick Table
  const tbody = document.getElementById('fifo-pick-tbody');
  tbody.innerHTML = '';

  const scannedBoxIds = (activeTx.scannedBoxes || []).map(s => s.boxId.toString());

  activeTx.allocatedBoxes.forEach((box, index) => {
    const isScanned = scannedBoxIds.includes(box.boxId.toString());
    const tr = document.createElement('tr');
    if (isScanned) tr.style.background = 'rgba(5, 150, 105, 0.15)';

    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td><strong style="color: #38bdf8;">BOX-${box.batchNumber}</strong></td>
      <td>${new Date(box.closedAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
      <td><strong>${box.completedCount} PCS</strong></td>
      <td style="font-size: 10px; color: #94a3b8; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${box.batchQrData}
      </td>
      <td>
        ${isScanned ? '<span class="badge badge-verified"><i class="ri-check-line"></i> VERIFIED</span>' : '<span class="badge badge-pending">PENDING SCAN</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Update progress bar & text
  const scannedCount = activeTx.scannedBoxes ? activeTx.scannedBoxes.length : 0;
  const totalCount = activeTx.allocatedBoxes.length;
  const pct = Math.round((scannedCount / totalCount) * 100);

  const progressFill = document.getElementById('dispatch-progress-fill');
  if (progressFill) progressFill.style.width = `${pct}%`;

  document.getElementById('dispatch-progress-text').textContent = `PROGRESS: ${scannedCount} / ${totalCount} BOXES SCANNED (${pct}%)`;
  document.getElementById('btn-confirm-dispatch').disabled = scannedCount !== totalCount;

  // Update Radial Gauge
  const radialGauge = document.getElementById('dispatch-radial-gauge');
  const radialPct = document.getElementById('dispatch-radial-pct');
  const radialBoxes = document.getElementById('dispatch-radial-boxes');
  const radialParts = document.getElementById('dispatch-radial-parts');

  const circumference = 2 * Math.PI * 70; // 439.82
  const offset = circumference - (pct / 100) * circumference;
  if (radialGauge) radialGauge.style.strokeDashoffset = offset;
  if (radialPct) radialPct.textContent = `${pct}%`;

  const totalParts = activeTx.allocatedBoxes.reduce((sum, b) => sum + (b.completedCount || 0), 0);
  const scannedParts = activeTx.allocatedBoxes
    .filter(b => scannedBoxIds.includes(b.boxId.toString()))
    .reduce((sum, b) => sum + (b.completedCount || 0), 0);

  if (radialBoxes) radialBoxes.textContent = `${scannedCount} / ${totalCount}`;
  if (radialParts) radialParts.textContent = `${scannedParts} / ${totalParts}`;

  // Update Next Target Reticle
  const nextUnscannedBox = activeTx.allocatedBoxes.find(b => !scannedBoxIds.includes(b.boxId.toString()));
  const reticleBatch = document.getElementById('reticle-next-batch');
  const reticleModel = document.getElementById('reticle-next-model');
  const reticleSub = document.getElementById('reticle-next-sub');

  if (nextUnscannedBox) {
    if (reticleBatch) reticleBatch.textContent = `BATCH #${nextUnscannedBox.batchNumber}`;
    if (reticleModel) reticleModel.textContent = activeTx.modelId;
    if (reticleSub) reticleSub.innerHTML = `Closed: ${new Date(nextUnscannedBox.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; Qty: ${nextUnscannedBox.completedCount} Pcs`;
  } else {
    if (reticleBatch) reticleBatch.textContent = `ALL VERIFIED`;
    if (reticleSub) reticleSub.innerHTML = `100% of order scanned. Ready to complete dispatch.`;
  }

  // Update Visual Animated Transfer Deck
  const infeedLane = document.getElementById('transfer-infeed-lane');
  const dockLane = document.getElementById('transfer-dock-lane');
  const infeedCountEl = document.getElementById('transfer-infeed-count');
  const dockCountEl = document.getElementById('transfer-dock-count');

  if (infeedLane && dockLane) {
    infeedLane.innerHTML = '';
    dockLane.innerHTML = '';

    const pendingBoxes = activeTx.allocatedBoxes.filter(b => !scannedBoxIds.includes(b.boxId.toString()));
    const loadedBoxes = activeTx.allocatedBoxes.filter(b => scannedBoxIds.includes(b.boxId.toString()));

    if (infeedCountEl) infeedCountEl.textContent = `${pendingBoxes.length} PENDING`;
    if (dockCountEl) dockCountEl.textContent = `${loadedBoxes.length} LOADED`;

    // Render pending infeed boxes
    if (pendingBoxes.length === 0) {
      infeedLane.innerHTML = '<span style="color: #64748b; font-size: 11px; font-family: var(--font-mono); margin: auto;">ALL BOXES TRANSFERRED</span>';
    } else {
      pendingBoxes.forEach((box, i) => {
        const isNextTarget = i === 0;
        const bEl = document.createElement('div');
        bEl.className = `dispatch-box-item ${isNextTarget ? 'target-pulse' : ''}`;
        bEl.innerHTML = `
          <div style="font-size: 8px; opacity: 0.85;">#${box.batchNumber}</div>
          <div style="font-size: 10px; font-weight: 800;">${box.completedCount}P</div>
          ${isNextTarget ? '<div style="font-size: 7px; color: #7dd3fc; font-weight: 900; letter-spacing: 0.5px;">NEXT</div>' : ''}
        `;
        bEl.title = `Box #${box.batchNumber} (${box.completedCount} Pcs) - Next Target`;
        infeedLane.appendChild(bEl);
      });
    }

    // Render loaded pallet boxes
    if (loadedBoxes.length === 0) {
      dockLane.innerHTML = '<span style="color: #64748b; font-size: 11px; font-family: var(--font-mono); margin: auto;">WAITING FOR SCAN...</span>';
    } else {
      loadedBoxes.forEach(box => {
        const bEl = document.createElement('div');
        bEl.className = 'dispatch-box-item loaded-check';
        bEl.innerHTML = `
          <i class="ri-checkbox-circle-fill" style="font-size: 16px; color: #a7f3d0;"></i>
          <div style="font-size: 8px; font-weight: 800;">#${box.batchNumber}</div>
        `;
        bEl.title = `Loaded Box #${box.batchNumber} (${box.completedCount} Pcs)`;
        dockLane.appendChild(bEl);
      });
    }
  }
}

function renderIdleDispatchUI() {
  document.getElementById('dispatch-setup-card').style.display = 'block';
  document.getElementById('dispatch-active-card').style.display = 'none';
  const progressFill = document.getElementById('dispatch-progress-fill');
  if (progressFill) progressFill.style.width = '0%';
  document.getElementById('fifo-pick-tbody').innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No active dispatch session. Select a model and start a session above.</td></tr>';
  document.getElementById('dispatch-progress-text').textContent = 'NO ACTIVE DISPATCH';
  document.getElementById('btn-confirm-dispatch').disabled = true;
}

async function processBoxScan(scannedPayload) {
  if (!activeTx) return;

  try {
    const res = await api.scanBox(activeTx.dispatchId, scannedPayload);
    if (res.success) {
      sounds.playSuccess();
      showBannerAlert(res.message, 'success');
      // Refresh active transaction state
      await checkActiveDispatch();
    } else {
      sounds.playViolation();
      showBannerAlert(res.message, 'danger');
      triggerAlarmShake();
    }
  } catch (err) {
    sounds.playViolation();
    showBannerAlert('Scan error: ' + err.message, 'danger');
    triggerAlarmShake();
  }
}

function triggerAlarmShake() {
  const deck = document.getElementById('dispatch-active-card') || document.getElementById('tab-dispatch');
  if (deck) {
    deck.style.animation = 'alarm-screen-shake 0.5s ease';
    setTimeout(() => { deck.style.animation = ''; }, 600);
  }
}

async function handleConfirmDispatch() {
  if (!activeTx) return;

  const notes = await customModal.prompt('Enter any dispatch notes (optional):', { title: 'CONFIRM DISPATCH NOTES', placeholder: 'Optional notes' });
  try {
    const res = await api.confirmDispatch(activeTx.dispatchId, notes || '');
    sounds.playCompletion();
    const completedDispatchId = activeTx.dispatchId;
    activeTx = null;
    renderIdleDispatchUI();
    showBannerAlert(res.message, 'success');

    // Automatically open the detailed Delivery Challan / Bill!
    openDispatchBill(completedDispatchId);
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Failed to confirm dispatch: ' + err.message, { title: 'CONFIRM FAILED', type: 'danger' });
  }
}


async function handleCancelDispatch() {
  if (!activeTx) return;
  const ok = await customModal.confirm(`Are you sure you want to CANCEL dispatch session ${activeTx.dispatchId}?`, { title: 'CANCEL DISPATCH', danger: true, confirmText: 'YES, CANCEL' });
  if (!ok) return;

  const reason = await customModal.prompt('Reason for cancellation:', { title: 'CANCELLATION REASON', defaultValue: 'Operator cancelled' });
  if (reason === null) return;
  try {
    await api.cancelDispatch(activeTx.dispatchId, reason);
    activeTx = null;
    renderIdleDispatchUI();
    showBannerAlert('Dispatch session cancelled.', 'info');
  } catch (err) {
    await customModal.alert('Cancel failed: ' + err.message, { title: 'CANCEL ERROR', type: 'danger' });
  }
}

function handleManualScanInput(val) {
  if (!val) return;
  processBoxScan(val);
  document.getElementById('test-scan-input').value = '';
}

function showBannerAlert(msg, type = 'info') {
  const banner = document.getElementById('disp-alert-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  banner.classList.remove('alarm-active');

  if (type === 'danger') {
    banner.classList.add('alarm-active');
  } else if (type === 'success') {
    banner.style.background = '#dcfce7';
    banner.style.borderColor = 'var(--color-green)';
    banner.style.color = '#166534';
  } else {
    banner.style.background = '#dbeafe';
    banner.style.borderColor = 'var(--color-blue)';
    banner.style.color = '#1e40af';
  }
}

// ============================================================================
// VIEW 2: INVENTORY & STATUS
// ============================================================================
async function loadInventoryView() {
  const modelSelect = document.getElementById('inv-filter-model');
  if (modelSelect && modelSelect.children.length <= 1) {
    try {
      const modelsRes = await api.getModels();
      if (modelsRes && modelsRes.models) {
        modelsRes.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.modelId;
          opt.textContent = m.modelId;
          modelSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('Failed to load models list for filter:', err);
    }
  }

  await applyInventoryFilter();
}

async function applyInventoryFilter() {
  const modelEl = document.getElementById('inv-filter-model');
  const statusEl = document.getElementById('inv-filter-status');
  const searchEl = document.getElementById('inv-filter-search');

  const modelId = modelEl ? modelEl.value : 'ALL';
  const status = statusEl ? statusEl.value : 'ALL';
  const search = searchEl ? searchEl.value.trim() : '';

  try {
    const tbody = document.getElementById('inventory-tbody') || document.getElementById('inv-tbody');
    if (!tbody) return;

    const res = await api.getBoxes({ modelId, status, search });
    tbody.innerHTML = '';

    if (!res || !res.boxes || res.boxes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 24px;">No boxes matching filter criteria.</td></tr>';
      return;
    }

    const userRole = (api.currentUser && api.currentUser.role) || 'admin';
    const isSupervisorOrAbove = ['supervisor', 'manager', 'admin'].includes(userRole);
    const isManagerOrAbove = ['manager', 'admin'].includes(userRole);

    res.boxes.forEach(b => {
      const tr = document.createElement('tr');
      let statusBadge = `<span class="badge badge-${b.status}">${(b.status || 'unknown').toUpperCase()}</span>`;

      let actionsHtml = '';
      if (b.status === 'available' && isSupervisorOrAbove) {
        actionsHtml = `
          <button class="btn-chunky btn-amber" onclick="openHoldModal('${b._id}', ${b.batchNumber})"><i class="ri-pause-circle-line"></i> HOLD</button>
          <button class="btn-chunky btn-danger" onclick="openRejectModal('${b._id}', ${b.batchNumber})"><i class="ri-close-circle-line"></i> REJECT</button>
        `;
      } else if (b.status === 'hold' && isSupervisorOrAbove) {
        actionsHtml = `<button class="btn-chunky btn-success" onclick="quickReleaseHold('${b._id}', ${b.batchNumber})"><i class="ri-play-circle-line"></i> RELEASE</button>`;
      } else if (b.status === 'rejected' && isManagerOrAbove) {
        actionsHtml = `<button class="btn-chunky btn-primary" onclick="openReopenModal('${b._id}', ${b.batchNumber})"><i class="ri-restart-line"></i> REOPEN</button>`;
      } else {
        actionsHtml = `<button class="btn-chunky" onclick="traceSpecificBox('${b.batchNumber}')"><i class="ri-search-line"></i> TRACE</button>`;
      }

      const closedTime = b.closedAt ? new Date(b.closedAt).toISOString().slice(0, 16).replace('T', ' ') : 'N/A';

      tr.innerHTML = `
        <td><strong style="color: #38bdf8;">BOX-${b.batchNumber}</strong></td>
        <td><strong>${b.modelId}</strong></td>
        <td>MC-${b.machineNo || '1'} (${b.shiftCode || 'A'})</td>
        <td>${closedTime}</td>
        <td><strong>${b.completedCount || 0} / ${b.batchSize || 0}</strong></td>
        <td>${statusBadge}</td>
        <td style="font-size: 11px; color: #94a3b8;">${b.holdReason || b.rejectionReason || b.dispatchId || 'Ready in bay'}</td>
        <td>${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load inventory:', err.message);
  }
}

// ============================================================================
// VIEW 3: HOLD / REJECT DESK
// ============================================================================
async function loadHoldRejectView() {
  try {
    const [holdBoxes, rejBoxes] = await Promise.all([
      api.getBoxes({ status: 'hold' }),
      api.getBoxes({ status: 'rejected' })
    ]);

    // Active Holds
    const holdTbody = document.getElementById('hold-tbody') || document.getElementById('hold-desk-tbody');
    if (holdTbody) {
      holdTbody.innerHTML = '';
      const holdCountEl = document.getElementById('hold-count') || document.getElementById('hold-count-badge');
      const hList = (holdBoxes && holdBoxes.boxes) || [];
      if (holdCountEl) holdCountEl.textContent = hList.length;

      if (hList.length === 0) {
        holdTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 20px;">No boxes currently on hold.</td></tr>';
      } else {
        hList.forEach(b => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong style="color: #38bdf8;">BOX-${b.batchNumber}</strong> (${b.modelId})</td>
            <td><strong>${b.holdId || 'HLD-PENDING'}</strong></td>
            <td>${b.holdReason || ''}<br><span style="font-size: 10px; color: #94a3b8;">${b.holdRemarks || ''}</span></td>
            <td>${b.heldBy || 'Supervisor'}</td>
            <td>
              <button class="btn-chunky btn-success" onclick="quickReleaseHold('${b._id}', ${b.batchNumber})"><i class="ri-play-circle-line"></i> RELEASE</button>
            </td>
          `;
          holdTbody.appendChild(tr);
        });
      }
    }

    // Rejected Inventory
    const rejTbody = document.getElementById('reject-tbody') || document.getElementById('rej-desk-tbody');
    if (rejTbody) {
      rejTbody.innerHTML = '';
      const rejCountEl = document.getElementById('reject-count') || document.getElementById('reject-count-badge');
      const rList = (rejBoxes && rejBoxes.boxes) || [];
      if (rejCountEl) rejCountEl.textContent = rList.length;

      const userRole = (api.currentUser && api.currentUser.role) || 'admin';
      const isManagerOrAbove = ['manager', 'admin'].includes(userRole);

      if (rList.length === 0) {
        rejTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 20px;">No boxes currently rejected.</td></tr>';
      } else {
        rList.forEach(b => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong style="color: #f87171;">BOX-${b.batchNumber}</strong> (${b.modelId})</td>
            <td><strong>${b.rejectionId || 'REJ-PENDING'}</strong></td>
            <td>${b.rejectionReason || ''}<br><span style="font-size: 10px; color: #94a3b8;">${b.rejectionRemarks || ''}</span></td>
            <td>${b.rejectedBy || 'Supervisor'}</td>
            <td>
              ${isManagerOrAbove ? `<button class="btn-chunky btn-primary" onclick="openReopenModal('${b._id}', ${b.batchNumber})"><i class="ri-restart-line"></i> REOPEN (MGR)</button>` : '<span style="color: #64748b; font-size: 11px;">MGR ONLY</span>'}
            </td>
          `;
          rejTbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.error('Failed to load hold/reject desk:', err.message);
  }
}

// Modal actions: Hold, Release, Reject, Reopen
let activeModalBoxId = null;

function openHoldModal(boxId, batchNumber) {
  activeModalBoxId = boxId;
  document.getElementById('modal-hold-title').textContent = `PUT BOX #${batchNumber} ON HOLD`;
  openModal('modal-hold');
}

async function submitHoldModal() {
  const reason = document.getElementById('modal-hold-reason').value;
  const remarks = document.getElementById('modal-hold-remarks').value;
  try {
    await api.holdBox(activeModalBoxId, reason, remarks);
    sounds.playAlert();
    closeModals();
    applyInventoryFilter();
  } catch (err) {
    await customModal.alert('Hold failed: ' + err.message, { title: 'HOLD ERROR', type: 'danger' });
  }
}

async function quickReleaseHold(boxId, batchNumber) {
  const remarks = await customModal.prompt(`Enter release remarks for Box #${batchNumber}:`, { title: 'RELEASE BOX FROM HOLD', defaultValue: 'Inspected and cleared' });
  if (remarks === null) return;
  try {
    await api.releaseHold(boxId, remarks);
    sounds.playSuccess();
    applyInventoryFilter();
    loadHoldRejectView();
  } catch (err) {
    await customModal.alert('Release failed: ' + err.message, { title: 'RELEASE ERROR', type: 'danger' });
  }
}

function openRejectModal(boxId, batchNumber) {
  activeModalBoxId = boxId;
  document.getElementById('modal-reject-title').textContent = `REJECT BOX #${batchNumber}`;
  openModal('modal-reject');
}

async function submitRejectModal() {
  const reason = document.getElementById('modal-reject-reason').value;
  const remarks = document.getElementById('modal-reject-remarks').value;
  try {
    await api.rejectBox(activeModalBoxId, reason, remarks);
    sounds.playViolation();
    closeModals();
    applyInventoryFilter();
  } catch (err) {
    await customModal.alert('Reject failed: ' + err.message, { title: 'REJECT ERROR', type: 'danger' });
  }
}

function openReopenModal(boxId, batchNumber) {
  activeModalBoxId = boxId;
  document.getElementById('modal-reopen-title').textContent = `MANAGER APPROVAL: REOPEN BOX #${batchNumber}`;
  openModal('modal-reopen');
}

async function submitReopenModal() {
  const remarks = document.getElementById('modal-reopen-remarks').value.trim();
  if (!remarks || remarks.length < 5) {
    await customModal.alert('Mandatory Manager remarks required (minimum 5 characters)', { title: 'REOPEN RESTRICTION', type: 'warning' });
    return;
  }

  try {
    await api.reopenBox(activeModalBoxId, remarks);
    sounds.playSuccess();
    closeModals();
    applyInventoryFilter();
    loadHoldRejectView();
  } catch (err) {
    await customModal.alert('Reopen failed: ' + err.message, { title: 'REOPEN ERROR', type: 'danger' });
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('active');
    m.style.display = 'none';
  });
}

// Global modal dismiss listeners (Escape key & backdrop click)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModals();
  }
});

document.addEventListener('click', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
    closeModals();
  }
});

// ============================================================================
// VIEW 4: BOX TRACEABILITY
// ============================================================================
async function executeTrace(query) {
  const q = query || document.getElementById('trace-query-input').value.trim();
  if (!q) return;

  try {
    const res = await api.traceBox(q);
    const box = res.box;
    const timeline = res.timeline;

    document.getElementById('trace-results-container').style.display = 'block';
    document.getElementById('trace-box-header').textContent = `BOX #${box.batchNumber} - ${box.modelId} (${box.modelName})`;
    document.getElementById('trace-box-status').innerHTML = `<span class="badge badge-${box.status}">${box.status.toUpperCase()}</span>`;
    document.getElementById('trace-box-meta').textContent = `Machine: MC-${box.machineNo} | Shift: ${box.shiftCode} | Closed At: ${new Date(box.closedAt).toLocaleString()} | Parts: ${box.completedCount}/${box.batchSize}`;

    const timelineContainer = document.getElementById('trace-timeline-items');
    timelineContainer.innerHTML = '';

    timeline.forEach(event => {
      const item = document.createElement('div');
      item.className = 'box-bordered';
      item.style.marginBottom = '10px';

      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-weight: 800;">
          <span style="color: #38bdf8;">${event.eventType}</span>
          <span style="font-family: var(--font-mono); color: #94a3b8; font-size: 11px;">${new Date(event.timestamp).toLocaleString()}</span>
        </div>
        <div style="font-size: 11px; margin-top: 4px; color: #cbd5e1;">
          By: <strong>${event.performedBy}</strong> (${event.userRole})
          ${event.referenceId ? ` | Ref: <strong>${event.referenceId}</strong>` : ''}
          ${event.reason ? ` | Reason: <em>${event.reason}</em>` : ''}
        </div>
        ${event.remarks ? `<div style="font-size: 11px; color: #94a3b8; font-style: italic; margin-top: 2px;">"${event.remarks}"</div>` : ''}
      `;
      timelineContainer.appendChild(item);
    });

    sounds.playAlert();
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Trace lookup error: ' + err.message, { title: 'TRACE LOOKUP ERROR', type: 'danger' });
  }
}

function traceSpecificBox(batchNum) {
  switchTab('tab-traceability');
  document.getElementById('trace-query-input').value = batchNum;
  executeTrace(batchNum);
}

// ============================================================================
// VIEW 5: REPORTS & ANALYTICS
// ============================================================================
async function loadReportsView() {
  try {
    const [monthlyRes, histRes] = await Promise.all([
      api.getMonthlyReports(),
      api.getDispatchHistory({ limit: 15 })
    ]);

    // Metrics
    document.getElementById('rep-month-name').textContent = monthlyRes.metrics.monthName.toUpperCase();
    document.getElementById('rep-boxes-month').textContent = monthlyRes.metrics.dispatchedThisMonthBoxes;
    document.getElementById('rep-parts-month').textContent = monthlyRes.metrics.dispatchedThisMonthParts.toLocaleString();
    document.getElementById('rep-active-holds').textContent = monthlyRes.metrics.activeHoldBoxes;
    document.getElementById('rep-rejected-month').textContent = monthlyRes.metrics.rejectedThisMonthBoxes;

    // Charts (Offline Chart.js)
    if (typeof Chart !== 'undefined') {
      renderDailyChart(monthlyRes.charts.daily);
      renderModelChart(monthlyRes.charts.models);
    }

    // Historical Table
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '';

    histRes.transactions.forEach(tx => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color: #38bdf8;">${tx.dispatchId}</strong></td>
        <td><strong>${tx.modelId}</strong></td>
        <td>${tx.allocatedBoxes.length} Boxes</td>
        <td><strong>${tx.dispatchedPartCount} Parts</strong></td>
        <td>${tx.operatorUsername}</td>
        <td>${new Date(tx.completedAt).toLocaleString()}</td>
        <td>
          <button class="btn-chunky btn-primary" onclick="openDispatchBill('${tx.dispatchId}')"><i class="ri-file-text-line"></i> VIEW MANIFEST</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load reports:', err.message);
  }
}

function renderDailyChart(chartData) {
  const ctx = document.getElementById('chart-daily-volume');
  if (!ctx) return;
  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: 'Boxes Dispatched',
        data: chartData.data,
        backgroundColor: '#0284c7',
        borderColor: '#0369a1',
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: "'Inter', sans-serif", size: 10 } } },
        y: { grid: { color: '#e2e8f0' }, ticks: { color: '#475569', font: { family: "'Inter', sans-serif", size: 10 } }, beginAtZero: true }
      }
    }
  });
}

function renderModelChart(chartData) {
  const ctx = document.getElementById('chart-model-dist');
  if (!ctx) return;
  if (modelChart) modelChart.destroy();

  modelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartData.labels,
      datasets: [{
        data: chartData.data,
        backgroundColor: ['#0284c7', '#059669', '#d97706', '#6366f1', '#0ea5e9']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#334155', font: { family: "'Inter', sans-serif", size: 11 } } } }
    }
  });
}

function exportCsvReport() {
  window.open('/api/reports/export-csv', '_blank');
}

// ============================================================================
// DETAILED DISPATCH BILL / DELIVERY CHALLAN VIEW & PDF PRINT
// ============================================================================
async function openDispatchBill(dispatchId) {
  try {
    const res = await api.getDispatchBill(dispatchId);
    const bill = res.bill;

    document.getElementById('bill-dispatch-id').textContent = bill.dispatchId;
    document.getElementById('bill-date').textContent = new Date(bill.completedAt || bill.startedAt).toLocaleString();
    document.getElementById('bill-model-name').textContent = `${bill.modelId} (${bill.modelName})`;
    document.getElementById('bill-customer-part').textContent = bill.customerPartNo;
    document.getElementById('bill-internal-part').textContent = bill.internalPartId;
    document.getElementById('bill-rev-info').textContent = `REV: ${bill.productRevNo} / SW: ${bill.softwareRevNo}`;
    document.getElementById('bill-operator').textContent = bill.operatorUsername;
    document.getElementById('bill-totals').textContent = `${bill.totalBoxes} Boxes / ${bill.totalParts} Total Parts`;

    // Render Box & Serial breakdown
    const container = document.getElementById('bill-boxes-container');
    container.innerHTML = '';

    bill.boxes.forEach((b, idx) => {
      const boxCard = document.createElement('div');
      boxCard.style.border = '1px solid #cbd5e1';
      boxCard.style.padding = '8px';
      boxCard.style.marginBottom = '8px';
      boxCard.style.background = '#f8fafc';
      boxCard.style.color = '#000';

      const serialsList = (b.serialNumbers || []).join(', ');

      boxCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-weight: bold; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
          <span>${idx + 1}. BOX #${b.batchNumber} (Quantity: ${b.completedCount} Pcs)</span>
          <span>Closed: ${new Date(b.closedAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
        </div>
        <div style="font-size: 9pt; margin-top: 4px; color: #475569;">
          <strong>Batch QR:</strong> ${b.batchQrData}
        </div>
        <div style="font-size: 8pt; margin-top: 4px; color: #1e293b; max-height: 80px; overflow-y: auto; word-break: break-all;">
          <strong>Serials (${b.serialNumbers ? b.serialNumbers.length : 0}):</strong> ${serialsList || 'No individual serials recorded'}
        </div>
      `;
      container.appendChild(boxCard);
    });

    openModal('modal-dispatch-bill');
  } catch (err) {
    await customModal.alert('Failed to load bill: ' + err.message, { title: 'BILL LOAD ERROR', type: 'danger' });
  }
}

function printDispatchBill() {
  window.print();
}

// ============================================================================
// VIEW 6: SYSTEM & USERS (MGR / ADMIN)
// ============================================================================
async function loadSystemView() {
  try {
    const statusRes = await api.getSystemStatus();
    document.getElementById('sys-db-host').textContent = `${statusRes.database.host || 'localhost'} (${statusRes.database.name || 'plc_sticker'})`;
    document.getElementById('sys-sync-watermark').textContent = statusRes.sync.watermark ? new Date(statusRes.sync.watermark).toLocaleString() : 'Today (Initialized)';
    document.getElementById('sys-synced-count').textContent = statusRes.sync.totalSyncedBoxes;

    // Load COM ports and serial settings
    if (api.currentUser.role === 'admin' || api.currentUser.role === 'manager') {
      await loadComPortsList();
      if (statusRes.scanner) {
        if (document.getElementById('sys-com-baud') && statusRes.scanner.baudRate) {
          document.getElementById('sys-com-baud').value = String(statusRes.scanner.baudRate);
        }
        if (document.getElementById('sys-com-databits') && statusRes.scanner.dataBits) {
          document.getElementById('sys-com-databits').value = String(statusRes.scanner.dataBits);
        }
        if (document.getElementById('sys-com-parity') && statusRes.scanner.parity) {
          document.getElementById('sys-com-parity').value = statusRes.scanner.parity;
        }
        if (document.getElementById('sys-com-stopbits') && statusRes.scanner.stopBits) {
          document.getElementById('sys-com-stopbits').value = String(statusRes.scanner.stopBits);
        }
        const badge = document.getElementById('sys-com-status-badge');
        if (badge) {
          badge.className = statusRes.scanner.isConnected ? 'badge badge-available' : 'badge badge-hold';
          badge.textContent = statusRes.scanner.isConnected ? 'CONNECTED // READY' : 'OFFLINE // READY';
        }
      }
    }

    // Load license
    loadLicenseInfo();
  } catch (err) {
    console.error('Failed to load system view:', err.message);
  }
}

async function handleSeedDummyData() {
  const ok = await customModal.confirm('Populate/refresh rich dummy data? This will load available bins, held bins, rejected bins, and past dispatch history.', { title: 'SEED TEST DATA' });
  if (!ok) return;
  try {
    const res = await api.seedDummyData(true);
    sounds.playSuccess();
    await customModal.alert(res.message, { title: 'SEED DATA SUCCESS', type: 'success' });
    loadSystemView();
    if (typeof loadInventoryView === 'function') loadInventoryView();
    if (typeof loadModelSelector === 'function') loadModelSelector();
  } catch (err) {
    await customModal.alert('Failed to seed dummy data: ' + err.message, { title: 'SEED ERROR', type: 'danger' });
  }
}

async function loadLicenseInfo() {
  try {
    const lic = await api.getLicense();
    if (document.getElementById('sys-machine-code')) {
      document.getElementById('sys-machine-code').textContent = lic.machineCode || '--';
    }
    const badge = document.getElementById('sys-lic-badge');
    const custEl = document.getElementById('sys-lic-customer');
    const expEl = document.getElementById('sys-lic-expiry');
    const tierEl = document.getElementById('sys-lic-tier');

    if (lic.licensed && lic.details) {
      if (badge) {
        badge.className = 'badge badge-success';
        badge.textContent = 'ACTIVE';
      }
      if (custEl) custEl.textContent = lic.details.customerName || lic.details.licensee || '--';
      if (expEl) expEl.textContent = lic.details.expiresAt || '--';
      if (tierEl) tierEl.textContent = (lic.details.tier || 'ENTERPRISE APPLIANCE').toUpperCase();
    } else {
      if (badge) {
        badge.className = 'badge badge-rejected';
        badge.textContent = 'UNLICENSED';
      }
      if (custEl) custEl.textContent = 'UNLICENSED';
      if (expEl) expEl.textContent = lic.error || 'No valid license';
      if (tierEl) tierEl.textContent = 'RESTRICTED';
    }
  } catch (e) {
    console.error('Could not load license info:', e.message);
  }
}

async function handleActivateLicense() {
  const input = document.getElementById('sys-license-input');
  const msgEl = document.getElementById('sys-lic-msg');
  const key = input ? input.value.trim() : '';

  if (!key) {
    await customModal.alert('Please paste a cryptographic license key string', { title: 'LICENSE KEY REQUIRED', type: 'warning' });
    return;
  }

  msgEl.textContent = 'Verifying and activating license...';
  msgEl.style.color = '#38bdf8';

  try {
    const res = await api.activateLicense(key);
    msgEl.textContent = res.message;
    msgEl.style.color = '#34d399';
    await customModal.alert(res.message, { title: 'LICENSE ACTIVATION', type: 'success' });
    loadLicenseInfo();
    if (input) input.value = '';
  } catch (err) {
    msgEl.textContent = 'Activation Failed: ' + err.message;
    msgEl.style.color = '#f87171';
    await customModal.alert('License Activation Failed: ' + err.message, { title: 'ACTIVATION ERROR', type: 'danger' });
  }
}

async function testDatabaseConnection() {
  const uri = document.getElementById('sys-db-uri-input').value.trim();
  if (!uri) return await customModal.alert('Enter MongoDB URI', { title: 'DATABASE URI REQUIRED', type: 'warning' });

  const resultBox = document.getElementById('sys-db-test-result');
  resultBox.textContent = 'Testing connection...';
  resultBox.style.color = '#38bdf8';

  try {
    const res = await api.testDatabase(uri);
    if (res.success) {
      resultBox.textContent = res.message;
      resultBox.style.color = '#34d399';
    } else {
      resultBox.textContent = res.message;
      resultBox.style.color = '#f87171';
    }
  } catch (err) {
    resultBox.textContent = 'Test failed: ' + err.message;
    resultBox.style.color = '#f87171';
  }
}

async function saveDatabaseConfig() {
  const uri = document.getElementById('sys-db-uri-input').value.trim();
  if (!uri) return await customModal.alert('Enter MongoDB URI', { title: 'DATABASE URI REQUIRED', type: 'warning' });
  const ok = await customModal.confirm('Update active MongoDB URI and reconnect?', { title: 'CONFIRM DB RECONFIGURATION', danger: true });
  if (!ok) return;

  try {
    const res = await api.saveDatabaseConfig(uri);
    await customModal.alert(res.message, { title: 'DATABASE CONFIG SAVED', type: 'success' });
    loadSystemView();
  } catch (err) {
    await customModal.alert('Save failed: ' + err.message, { title: 'SAVE ERROR', type: 'danger' });
  }
}

async function loadComPortsList() {
  const portSelect = document.getElementById('sys-com-select');
  if (!portSelect) return;
  try {
    const portRes = await api.getComPorts();
    const curVal = portSelect.value;
    portSelect.innerHTML = '';

    if (!portRes.ports || portRes.ports.length === 0) {
      const opt = document.createElement('option');
      opt.value = 'COM3';
      opt.textContent = 'COM3 (Default Scanner Port)';
      portSelect.appendChild(opt);
    } else {
      portRes.ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = `${p.path} (${p.manufacturer || 'Hardware Serial Device'})`;
        if (p.path === curVal) opt.selected = true;
        portSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.warn('Could not list COM ports:', err.message);
  }
}

async function saveComPortConfig() {
  const port = document.getElementById('sys-com-select')?.value || 'COM3';
  const baudRate = document.getElementById('sys-com-baud')?.value || '9600';
  const dataBits = document.getElementById('sys-com-databits')?.value || '8';
  const stopBits = document.getElementById('sys-com-stopbits')?.value || '1';
  const parity = document.getElementById('sys-com-parity')?.value || 'none';
  const delimiter = document.getElementById('sys-com-delimiter')?.value || 'CRLF';
  const msgEl = document.getElementById('sys-com-msg');

  try {
    const res = await api.saveComConfig({ port, baudRate, dataBits, stopBits, parity, delimiter });
    sounds.playSuccess();
    if (msgEl) {
      msgEl.style.color = '#059669';
      msgEl.textContent = res.message;
    } else {
      await customModal.alert(res.message, { title: 'SERIAL CONFIG SAVED', type: 'success' });
    }
    const badge = document.getElementById('sys-com-status-badge');
    if (badge) {
      badge.className = 'badge badge-available';
      badge.textContent = `${port} @ ${baudRate} BPS`;
    }
  } catch (err) {
    sounds.playViolation();
    if (msgEl) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = 'Configuration error: ' + err.message;
    } else {
      await customModal.alert('COM config failed: ' + err.message, { title: 'SERIAL CONFIG ERROR', type: 'danger' });
    }
  }
}

let _currentUsersList = [];

async function loadUsersTable() {
  try {
    const res = await api.getUsers();
    _currentUsersList = res.users || [];
    const count = _currentUsersList.length;
    const tbody = document.getElementById('sys-users-tbody');
    if (tbody) tbody.innerHTML = '';

    const countChip = document.getElementById('sys-users-count-chip');
    if (countChip) {
      countChip.textContent = `${count} / 10 USERS`;
      countChip.className = count >= 10 ? 'badge badge-rejected' : 'badge badge-available';
    }

    const warningBanner = document.getElementById('user-quota-warning');
    if (warningBanner) {
      warningBanner.style.display = count >= 10 ? 'block' : 'none';
    }

    const createBtn = document.getElementById('btn-create-user');
    if (createBtn) {
      if (count >= 10) {
        createBtn.disabled = true;
        createBtn.style.opacity = '0.5';
        createBtn.style.cursor = 'not-allowed';
        createBtn.title = 'Maximum capacity reached (10/10 users). Delete an account to create a new one.';
      } else {
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
        createBtn.style.cursor = 'pointer';
        createBtn.title = 'Add new operator account';
      }
    }

    const currentUser = api.currentUser;
    const isAdmin = currentUser && currentUser.role === 'admin';

    if (tbody) {
      if (_currentUsersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No users registered.</td></tr>';
      } else {
        _currentUsersList.forEach(u => {
          const tr = document.createElement('tr');
          const isSelf = currentUser && (currentUser.id === u._id || currentUser.username.toLowerCase() === u.username.toLowerCase());
          const deleteBtnHtml = (isAdmin && !isSelf)
            ? `<button class="btn-chunky text-danger" style="margin-left: 6px;" onclick="handleDeleteUser('${u._id}', '${u.username}')"><i class="ri-delete-bin-line"></i> DELETE</button>`
            : '';
          tr.innerHTML = `
            <td><strong>${u.username}</strong> ${isSelf ? '<span class="badge" style="background:#e0f2fe; color:#0284c7; font-size:9px; margin-left:4px;">YOU</span>' : ''}</td>
            <td>${u.fullName}</td>
            <td><span class="badge badge-verified">${u.role.toUpperCase()}</span></td>
            <td>${u.active ? '<span style="color: #059669; font-weight:700;">ACTIVE</span>' : '<span style="color: #dc2626; font-weight:700;">INACTIVE</span>'}</td>
            <td>
              <button class="btn-chunky" onclick="resetUserPassword('${u._id}', '${u.username}')"><i class="ri-key-line"></i> RESET PWD</button>
              ${deleteBtnHtml}
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    console.error('Failed to load users:', err.message);
  }
}

async function handleCreateUser() {
  if (_currentUsersList && _currentUsersList.length >= 10) {
    return await customModal.alert('Terminal operator capacity reached! A maximum of 10 users are allowed on this terminal. Please delete or deactivate an existing user before creating a new one.', {
      title: 'USER QUOTA EXCEEDED (10/10)',
      type: 'warning'
    });
  }

  const username = await customModal.prompt('Enter new username:', { title: 'CREATE USER - USERNAME' });
  if (!username) return;
  const fullName = await customModal.prompt('Enter full name:', { title: 'CREATE USER - FULL NAME' });
  if (!fullName) return;
  const password = await customModal.prompt('Enter temporary password (min 6 chars):', { title: 'CREATE USER - PASSWORD', inputType: 'password' });
  if (!password || password.length < 6) {
    return await customModal.alert('Password must be at least 6 characters.', { title: 'PASSWORD TOO SHORT', type: 'warning' });
  }
  const role = await customModal.prompt('Enter role (operator / supervisor / manager / admin):', { title: 'CREATE USER - ROLE', defaultValue: 'operator' });
  if (!role) return;

  try {
    await api.createUser({ username, fullName, password, role: role.toLowerCase() });
    await customModal.alert(`User ${username} created successfully!`, { title: 'USER CREATED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    await customModal.alert('Create user failed: ' + err.message, { title: 'CREATE USER ERROR', type: 'danger' });
  }
}

async function handleDeleteUser(userId, username) {
  const confirmed = await customModal.confirm(`Are you sure you want to permanently delete operator account "${username}"?`, {
    title: 'CONFIRM DELETE OPERATOR',
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await api.deleteUser(userId);
    await customModal.alert(res.message || `User account '${username}' deleted.`, { title: 'ACCOUNT DELETED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    await customModal.alert('Delete failed: ' + err.message, { title: 'DELETE FAILED', type: 'danger' });
  }
}

async function resetUserPassword(userId, username) {
  const newPwd = await customModal.prompt(`Enter new password for ${username}:`, { title: 'RESET PASSWORD', inputType: 'password' });
  if (!newPwd || newPwd.length < 6) {
    return await customModal.alert('Password must be at least 6 characters.', { title: 'PASSWORD TOO SHORT', type: 'warning' });
  }

  try {
    await api.resetPassword(userId, newPwd);
    await customModal.alert(`Password reset for ${username}!`, { title: 'PASSWORD RESET', type: 'success' });
  } catch (err) {
    await customModal.alert('Password reset failed: ' + err.message, { title: 'RESET FAILED', type: 'danger' });
  }
}

// ============================================================================
// TITLEBAR OPERATOR DROPDOWN & ACTIONS
// ============================================================================
function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  if (!api.currentUser) return;
  const dd = document.getElementById('titlebar-user-dropdown');
  if (dd) dd.classList.toggle('active');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const dd = document.getElementById('titlebar-user-dropdown');
  if (dd && dd.classList.contains('active') && !e.target.closest('.titlebar-user-wrap')) {
    dd.classList.remove('active');
  }
});
