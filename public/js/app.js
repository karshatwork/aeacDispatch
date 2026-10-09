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
  const select = document.getElementById('dispatch-model-select');
  const selectedOpt = select ? select.options[select.selectedIndex] : null;
  const batchSize = selectedOpt ? (parseInt(selectedOpt.dataset.batchSize, 10) || 20) : 20;

  if (mode === 'boxes') {
    if (btnBoxes) btnBoxes.className = 'toggle-segment active';
    if (btnParts) btnParts.className = 'toggle-segment';
    if (label) label.textContent = 'REQUIRED BOXES COUNT';
    if (input && parseInt(input.value, 10) > 15) input.value = 2;
  } else {
    if (btnBoxes) btnBoxes.className = 'toggle-segment';
    if (btnParts) btnParts.className = 'toggle-segment active';
    if (label) label.textContent = `REQUIRED PARTS COUNT (${batchSize}/box)`;
    if (input && parseInt(input.value, 10) <= 10) input.value = batchSize * 2;
  }
  validateDispatchQuantity();
}

function validateDispatchQuantity() {
  const select = document.getElementById('dispatch-model-select');
  const selectedOpt = select ? select.options[select.selectedIndex] : null;
  const input = document.getElementById('dispatch-target-qty');
  const hintEl = document.getElementById('dispatch-qty-hint');
  if (!input || !selectedOpt) return { valid: true };

  const qty = parseInt(input.value, 10);
  const batchSize = parseInt(selectedOpt.dataset.batchSize, 10) || 20;

  if (currentQuantityMode === 'parts') {
    if (qty > 0 && qty % batchSize !== 0) {
      const nextMultiple = Math.ceil(qty / batchSize) * batchSize;
      if (hintEl) {
        hintEl.style.display = 'block';
        hintEl.innerHTML = `<span style="color: #dc2626; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" onclick="document.getElementById('dispatch-target-qty').value=${nextMultiple}; validateDispatchQuantity();" title="Click to apply recommended quantity"><i class="ri-alert-line"></i> Not a multiple of ${batchSize}. Recommended: <strong style="text-decoration: underline;">${nextMultiple} parts</strong></span>`;
      }
      return { valid: false, qty, batchSize, nextMultiple };
    }
  }

  if (hintEl) {
    hintEl.style.display = 'none';
    hintEl.textContent = '';
  }
  return { valid: true, qty, batchSize };
}

/**
 * Helper to parse physical sticker fields matching printed shop-floor labels.
 * Reads document properties directly from box document fields.
 * Strictly extracts sticker code (shiftBatchCode) and printed batch date from batchQrData.
 */
function getBoxStickerInfo(box) {
  if (!box) {
    return {
      shiftBatchCode: '--',
      customerPartNo: '--',
      internalPartId: '--',
      batchDate: '--',
      supplierCode: '--',
      batchNumber: ''
    };
  }

  let shiftBatchCode = '--';
  let batchDate = '--';
  let supplierCode = box.supplierCode || '--';
  let internalPartId = box.internalPartId || box.modelId || '--';
  let customerPartNo = box.customerPartNo || '--';

  // Strictly extract sticker code, date, and part details from 2D DataMatrix QR string
  if (box.batchQrData) {
    const raw = box.batchQrData.replace(/^\*+|\*+$/g, '').trim();
    const parts = raw.split('|');

    if (parts.length >= 7) {
      if (parts[0]) supplierCode = parts[0];
      if (parts[1]) internalPartId = parts[1];
      if (parts[2]) customerPartNo = parts[2];
      if (parts[5] && parts[5].includes('.')) {
        batchDate = parts[5];
      }
      if (parts[6]) {
        shiftBatchCode = parts[6];
      }
    }
  }

  // Fallback: If customerPartNo is '--' and activeTx is present, use activeTx.customerPartNo
  if (customerPartNo === '--' && typeof activeTx !== 'undefined' && activeTx && activeTx.customerPartNo) {
    customerPartNo = activeTx.customerPartNo;
  }

  const batchNumber = box.batchNumber ? String(box.batchNumber) : '';

  return {
    shiftBatchCode,
    customerPartNo,
    internalPartId,
    batchDate,
    supplierCode,
    batchNumber
  };
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
    window.history.replaceState(null, 'RecordKeeper Dispatch', window.location.pathname);
  }

  // Start digital telemetry clock immediately (active on login, lock screen, and in-terminal)
  startClock();

  // Setup login form & dropdowns
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  if (window.scadaDropdown) {
    window.scadaDropdown.initAll();
  }

  // HARD SECURITY GATE: Verify license before booting login or terminal
  const initialHealth = await checkSystemHealth();
  if (initialHealth && initialHealth.license && !initialHealth.license.valid) {
    console.warn('[SECURITY] Terminal locked: License verification failed. Halting boot sequence.');
    showLicenseLockScreen(initialHealth.license);
    // DO NOT BOOT FURTHER!
    return;
  }

  // License valid: proceed with normal terminal boot
  setInterval(checkSystemHealth, 5000);

  // Check if session exists in memory
  if (api.restoreSession()) {
    initApp();
  } else {
    showLoginScreen();
  }

  // Synchronize audio button state with stored settings
  updateAudioToggleUI();
});

// ============================================================================
// TERMINAL LICENSE LOCKOUT MANAGEMENT
// ============================================================================
let _isLicenseLocked = false;

function showLicenseLockScreen(license) {
  _isLicenseLocked = true;
  const lockScreen = document.getElementById('license-lock-screen');
  const loginScreen = document.getElementById('login-screen');
  const terminalShell = document.getElementById('terminal-shell');

  if (loginScreen) loginScreen.style.display = 'none';
  if (terminalShell) terminalShell.style.display = 'none';

  if (!lockScreen) return;

  const fpText = document.getElementById('lock-machine-code');
  if (fpText) fpText.textContent = license.machineCode || 'UNKNOWN-HARDWARE-ID';

  const titleEl = document.getElementById('lock-issue-title');
  const descEl = document.getElementById('lock-issue-desc');
  const badgeEl = document.getElementById('lock-badge-text');

  if (license.productMismatch) {
    if (badgeEl) badgeEl.textContent = 'PRODUCT MISMATCH';
    if (titleEl) titleEl.textContent = 'LICENSE PRODUCT MISMATCH';
    if (descEl) descEl.textContent = license.error || 'This license was issued for a different software product.';
  } else if (license.hardwareMismatch) {
    if (badgeEl) badgeEl.textContent = 'HARDWARE MISMATCH';
    if (titleEl) titleEl.textContent = 'HARDWARE LOCK MISMATCH DETECTED';
    if (descEl) descEl.textContent = license.error || 'The installed license key is registered to a different physical machine.';
  } else if (license.clockTampered) {
    if (badgeEl) badgeEl.textContent = 'CLOCK TAMPERING';
    if (titleEl) titleEl.textContent = 'SYSTEM CLOCK ROLLBACK DETECTED';
    if (descEl) descEl.textContent = license.error || 'System clock rollback detected. Clock cannot be moved backwards.';
  } else if (license.expired) {
    if (badgeEl) badgeEl.textContent = 'LICENSE EXPIRED';
    if (titleEl) titleEl.textContent = 'COMMERCIAL LICENSE EXPIRED';
    if (descEl) descEl.textContent = license.error || 'This license has expired. Contact vendor for renewal.';
  } else if (license.tampered) {
    if (badgeEl) badgeEl.textContent = 'SIGNATURE INVALID';
    if (titleEl) titleEl.textContent = 'CRYPTOGRAPHIC SIGNATURE VERIFICATION FAILED';
    if (descEl) descEl.textContent = 'License signature verification failed. The file is corrupt or has been tampered with.';
  } else {
    if (badgeEl) badgeEl.textContent = 'UNLICENSED SYSTEM';
    if (titleEl) titleEl.textContent = 'NO VALID LICENSE INSTALLED';
    if (descEl) descEl.textContent = license.error || 'No valid license.key found in the application directory.';
  }

  lockScreen.style.display = 'flex';
}

function hideLicenseLockScreen() {
  _isLicenseLocked = false;
  const lockScreen = document.getElementById('license-lock-screen');
  if (lockScreen) lockScreen.style.display = 'none';
}

async function copyLockMachineCode() {
  const fpText = document.getElementById('lock-machine-code');
  const copyBtn = document.getElementById('lock-copy-btn');
  if (!fpText) return;

  const code = fpText.textContent.trim();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    if (copyBtn) {
      const origHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '<i class="ri-check-line"></i> COPIED!';
      copyBtn.classList.remove('btn-primary');
      copyBtn.classList.add('btn-success');
      setTimeout(() => {
        copyBtn.innerHTML = origHtml;
        copyBtn.classList.remove('btn-success');
        copyBtn.classList.add('btn-primary');
      }, 2000);
    }
  } catch (e) {
    alert('Fingerprint code: ' + code);
  }
}

async function openHostLicenseFolder() {
  if (window.electronAPI && typeof window.electronAPI.openLicenseFolder === 'function') {
    await window.electronAPI.openLicenseFolder();
  } else {
    alert('License Directory: Place your license.key into the application root folder.');
  }
}

function triggerLicenseFileInput() {
  const fileInput = document.getElementById('lock-license-file-input');
  if (fileInput) fileInput.click();
}

async function handleLicenseFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    if (!content) return;

    try {
      const res = await api.request('/api/system/license/activate', {
        method: 'POST',
        body: JSON.stringify({ licenseKey: content })
      });

      if (res && res.success) {
        if (window.audioFeedback) window.audioFeedback.playSuccess();
        alert('License Activated Successfully! Starting gateway...');
        await recheckLicenseAndBoot();
      } else {
        alert(res.error || 'Activation failed');
      }
    } catch (err) {
      alert('Activation error: ' + (err.message || 'Invalid license file'));
    }
  };
  reader.readAsText(file);
}

async function recheckLicenseAndBoot() {
  const res = await checkSystemHealth();
  if (res && res.license && res.license.valid) {
    hideLicenseLockScreen();
    setInterval(checkSystemHealth, 5000);
    if (api.restoreSession()) {
      initApp();
    } else {
      showLoginScreen();
    }
    updateAudioToggleUI();
  } else {
    const errorMsg = res && res.license ? res.license.error : 'License verification failed';
    if (res && res.license) {
      showLicenseLockScreen(res.license);
    }
    alert('Verification Result: ' + errorMsg);
  }
}

function handleMailtoClick(event, url) {
  const targetUrl = url || 'mailto:work.karsh@gmail.com';
  if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
    if (event) event.preventDefault();
    window.electronAPI.openExternal(targetUrl);
    return;
  }
}

window.copyLockMachineCode = copyLockMachineCode;
window.openHostLicenseFolder = openHostLicenseFolder;
window.triggerLicenseFileInput = triggerLicenseFileInput;
window.handleLicenseFileSelected = handleLicenseFileSelected;
window.recheckLicenseAndBoot = recheckLicenseAndBoot;
window.showLicenseLockScreen = showLicenseLockScreen;
window.hideLicenseLockScreen = hideLicenseLockScreen;
window.handleMailtoClick = handleMailtoClick;

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
      updateDbTelemetry(res.database, res.sync);
    }
    if (res && res.scanner) {
      updateScannerStatusPill(res.scanner);
    }
    if (res && res.license) {
      if (!res.license.valid) {
        showLicenseLockScreen(res.license);
      } else if (_isLicenseLocked) {
        hideLicenseLockScreen();
      }
    }
    return res;
  } catch (err) {
    updateDbTelemetry({ isConnected: false, lastError: 'API Server offline / unreachable' });
    return null;
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

function updateDbTelemetry(db, sync) {
  window.lastKnownDbConnected = !!db.isConnected;
  const chip = document.getElementById('header-db-chip');
  const led = document.getElementById('header-db-led');
  const text = document.getElementById('header-db-text');
  const loginWarn = document.getElementById('login-db-warning');
  const loginWarnText = document.getElementById('login-db-warning-text');

  const dbHostEl = document.getElementById('sys-db-host');
  const dbWatermarkEl = document.getElementById('sys-sync-watermark');
  const dbSyncedCountEl = document.getElementById('sys-synced-count');

  if (db.isConnected) {
    updateFaviconState(false);
    if (led) led.className = 'status-led led-green';
    if (text) text.textContent = db.isEmbedded ? 'DATABASE (IN-MEMORY DEV)' : 'DATABASE ONLINE';
    if (chip) chip.title = `Connected to ${db.host || 'MongoDB'}/${db.name || ''}`;
    if (loginWarn) loginWarn.style.display = 'none';
    dismissGlobalAlarm();

    if (dbHostEl) {
      dbHostEl.style.color = 'var(--color-primary)';
      dbHostEl.textContent = `${db.host || 'localhost'} (${db.name || 'default'})`;
    }
  } else {
    updateFaviconState(true);
    if (led) led.className = 'status-led led-red';
    if (text) text.textContent = 'DATABASE OFFLINE';
    const errorDetails = db.lastError || 'Connection refused';
    const targetUri = db.configuredUri || 'configured host';
    if (chip) chip.title = `DB Disconnected (${targetUri}): ${errorDetails}`;

    if (dbHostEl) {
      dbHostEl.style.color = '#ef4444';
      dbHostEl.textContent = 'OFFLINE / DISCONNECTED';
    }
    if (dbWatermarkEl) {
      dbWatermarkEl.textContent = 'Database offline';
    }

    // Show warning on login screen
    if (loginWarn) {
      loginWarn.style.display = 'block';
      if (loginWarnText) {
        loginWarnText.textContent = `Cannot reach ${targetUri} (${errorDetails}). Safe Mode active. Database connection required for production operations.`;
      }
    }

    // If logged in, show on-screen alarm banner (admin gets DB SETTINGS action)
    if (api.currentUser) {
      if (api.currentUser.role === 'admin') {
        showSystemAlarm(
          'ALARM: DATABASE OFFLINE (SAFE MODE)',
          `MongoDB unreachable at ${targetUri}: ${errorDetails}. Reconfigure connection parameters.`,
          () => switchTab('tab-system'),
          'DB SETTINGS'
        );
      } else {
        showSystemAlarm(
          'ALARM: DATABASE OFFLINE (SAFE MODE)',
          `MongoDB unreachable at ${targetUri}: ${errorDetails}. Please notify System Administrator.`
        );
      }
    }
  }

  if (sync) {
    if (dbWatermarkEl && db.isConnected) {
      dbWatermarkEl.textContent = sync.watermark ? new Date(sync.watermark).toLocaleString() : 'Live (Initialized)';
    }
    if (dbSyncedCountEl) {
      dbSyncedCountEl.textContent = (sync.totalSyncedBoxes != null) ? sync.totalSyncedBoxes : '0';
    }
  }
}

function handleDbChipClick() {
  // Navigation via chip click intentionally removed per UI specification
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
      ? 'Please enter username.'
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

async function handleLogout() {
  currentTab = 'tab-dispatch';
  activeTx = null;
  if (ws) {
    ws.close();
    ws = null;
  }
  await api.logout();
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
  const isAdmin = userRole === 'admin';

  const tabReports = document.querySelector('[data-tab="tab-reports"]');
  const tabUsers = document.querySelector('[data-tab="tab-users"]');
  const tabSystem = document.querySelector('[data-tab="tab-system"]');

  if (tabReports) tabReports.style.display = isSupervisorOrAbove ? 'flex' : 'none';
  if (tabUsers) tabUsers.style.display = isAdmin ? 'flex' : 'none';
  if (tabSystem) tabSystem.style.display = isAdmin ? 'flex' : 'none';

  // Connect WebSocket
  connectWebSocket();

  // Start digital telemetry clock
  startClock();

  // Load quality audit reasons (Hold & Reject dropdowns)
  loadAuditReasons();

  // If database is offline, direct administrator straight to system settings
  if (window.lastKnownDbConnected === false && isAdmin) {
    currentTab = 'tab-system';
  }

  // Load Initial Tab
  switchTab(currentTab);

  // Check active dispatch
  if (currentTab === 'tab-dispatch') {
    checkActiveDispatch();
  }
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
  const comBadge = document.getElementById('sys-com-status-badge');
  const port = (status && status.activePort) || 'COM3';

  if (status && status.isConnected) {
    if (pill) {
      pill.innerHTML = `<span class="status-led led-green"></span> <span>SCANNER ONLINE</span>`;
      pill.title = `Hardware Scanner (${port}) - Online & Ready`;
    }
    if (comBadge) {
      comBadge.className = 'badge badge-success';
      comBadge.textContent = 'ONLINE';
    }
  } else {
    if (pill) {
      pill.innerHTML = `<span class="status-led led-amber"></span> <span>SCANNER OFFLINE</span>`;
      pill.title = `Hardware Scanner (${port}) - Waiting for connection`;
    }
    if (comBadge) {
      comBadge.className = 'badge badge-hold';
      comBadge.textContent = 'OFFLINE';
    }
  }
}

function handleHardwareScan(qrData) {
  console.log('[HARDWARE SCAN]', qrData);
  // 1. If an action modal is open (Hold, Reject, Release, Reopen), route scan to modal verification
  if (activeModalBoxId && activeModalType) {
    handleModalScanVerification(qrData);
    return;
  }

  if (currentTab === 'tab-dispatch' && activeTx && activeTx.status === 'in_progress') {
    processBoxScan(qrData);
  } else if (currentTab === 'tab-traceability') {
    const traceInput = document.getElementById('trace-query-input');
    if (traceInput) traceInput.value = qrData;
    executeTrace(qrData);
  } else if (currentTab === 'tab-inventory') {
    const searchInput = document.getElementById('inv-filter-search');
    if (searchInput) searchInput.value = qrData;
    executeInventorySearch();
  } else {
    showBannerAlert(`Scanned QR: ${qrData}`, 'info');
  }
}


// ============================================================================
// TAB NAVIGATION & CLOCK
// ============================================================================
function switchTab(tabId) {
  if (tabId === 'tab-users' && (!api.currentUser || api.currentUser.role !== 'admin')) {
    customModal.alert('Access restricted: Only system administrators can access user management.', { title: 'ACCESS DENIED', type: 'warning' });
    return switchTab('tab-dispatch');
  }

  if (tabId === 'tab-system' && (!api.currentUser || api.currentUser.role !== 'admin')) {
    customModal.alert('Access restricted: Only system administrators can access system settings.', { title: 'ACCESS DENIED', type: 'warning' });
    return switchTab('tab-dispatch');
  }

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
  else if (tabId === 'tab-reports') loadReportsView();
  else if (tabId === 'tab-users') loadUsersTable();
  else if (tabId === 'tab-system') loadSystemView();

  // Auto-initialize any selects in the newly activated view
  if (window.scadaDropdown) {
    setTimeout(() => {
      window.scadaDropdown.initAll();
      window.scadaDropdown.syncAll();
    }, 50);
  }
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

async function loadModelSelector(preserveSelected = true) {
  try {
    const select = document.getElementById('dispatch-model-select');
    if (!select) return;
    const currentVal = (preserveSelected && select.value) ? select.value : null;

    const res = await api.getModels();
    select.innerHTML = '';

    if (!res.models || res.models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No models available';
      opt.dataset.availableBoxes = 0;
      opt.dataset.availableParts = 0;
      select.appendChild(opt);
    } else {
      res.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.modelId;
        opt.textContent = m.modelName ? `${m.modelName} (Part: ${m.customerPartNo})` : m.modelId;
        opt.dataset.availableBoxes = m.availableBoxes;
        opt.dataset.availableParts = m.availableParts;
        opt.dataset.batchSize = m.batchSize || 20;
        select.appendChild(opt);
      });
    }

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
      select.value = currentVal;
    }

    if (window.scadaDropdown && select) {
      window.scadaDropdown.attach(select).sync();
    }

    updateAvailableStockDisplay();
    select.onchange = () => {
      updateAvailableStockDisplay();
      validateDispatchQuantity();
      if (select._scadaDropdown) select._scadaDropdown.sync();
    };
  } catch (err) {
    console.error('Failed to load models:', err.message);
  }
}

function updateAvailableStockDisplay() {
  const select = document.getElementById('dispatch-model-select');
  if (!select) return;
  const selectedOpt = select.options[select.selectedIndex];
  const boxEl = document.getElementById('disp-avail-boxes');
  const partEl = document.getElementById('disp-avail-parts');

  if (!selectedOpt) {
    if (boxEl) boxEl.textContent = '0 BOXES';
    if (partEl) partEl.textContent = '0 PARTS';
    return;
  }

  const boxes = selectedOpt.dataset.availableBoxes || 0;
  const parts = selectedOpt.dataset.availableParts || 0;

  if (boxEl) boxEl.textContent = `${boxes} BOXES`;
  if (partEl) partEl.textContent = `${parts} AVAILABLE PARTS`;
  validateDispatchQuantity();
}


async function checkActiveDispatch() {
  try {
    const res = await api.getActiveDispatch();
    if (res.activeTransaction) {
      activeTx = res.activeTransaction;
      renderActiveDispatchUI();
    } else {
      activeTx = null;
      await renderIdleDispatchUI();
    }
  } catch (err) {
    console.error('Check active dispatch error:', err.message);
  }
}

async function handleStartDispatch() {
  const select = document.getElementById('dispatch-model-select');
  const modelId = select.value;
  const input = document.getElementById('dispatch-target-qty');
  const qty = parseInt(input.value, 10);

  if (!qty || qty <= 0) {
    await customModal.alert('Please enter a positive required quantity', { title: 'INVALID QUANTITY', type: 'warning' });
    return;
  }

  const selectedOpt = select.options[select.selectedIndex];
  const batchSize = selectedOpt ? (parseInt(selectedOpt.dataset.batchSize, 10) || 20) : 20;

  if (currentQuantityMode === 'parts' && qty % batchSize !== 0) {
    const nextMultiple = Math.ceil(qty / batchSize) * batchSize;
    const boxesCount = nextMultiple / batchSize;
    sounds.playViolation();
    const applyRecommended = await customModal.confirm(
      `Selected parts quantity (${qty}) is not a multiple of the packaging standard (${batchSize} parts/box for ${modelId}).\n\nRecommended next multiple: ${nextMultiple} parts (${boxesCount} full ${boxesCount === 1 ? 'box' : 'boxes'}).\n\nWould you like to set the required quantity to ${nextMultiple} parts?`,
      {
        title: 'INVALID PARTS QUANTITY',
        type: 'warning',
        confirmText: `SET TO ${nextMultiple} PARTS`,
        cancelText: 'CANCEL'
      }
    );
    if (applyRecommended) {
      input.value = nextMultiple;
      validateDispatchQuantity();
    }
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
  document.getElementById('active-tx-model').textContent = activeTx.modelName || activeTx.modelId;
  document.getElementById('active-tx-operator').textContent = activeTx.operatorFullName || activeTx.operatorUsername;

  // Render Pick Table (6 Columns: RANK, BATCH / SHIFT CODE, CUSTOMER PART NO, PRODUCED AT, PARTS, STATUS)
  const tbody = document.getElementById('fifo-pick-tbody');
  tbody.innerHTML = '';

  const scannedBoxIds = (activeTx.scannedBoxes || []).map(s => s.boxId.toString());

  activeTx.allocatedBoxes.forEach((box, index) => {
    const isScanned = scannedBoxIds.includes(box.boxId.toString());
    const tr = document.createElement('tr');
    tr.setAttribute('data-box-id', box.boxId);
    if (isScanned) tr.style.background = 'rgba(5, 150, 105, 0.15)';

    const sticker = getBoxStickerInfo(box);
    const producedTime = box.closedAt ? new Date(box.closedAt).toISOString().slice(0, 16).replace('T', ' ') : (sticker.batchDate || '--');

    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td>
        <strong style="color: #0f172a; font-size: 13.5px; font-family: var(--font-mono);">${sticker.shiftBatchCode}</strong>
        <div style="font-size: 10.5px; color: #64748b; font-weight: 600; font-family: var(--font-mono); margin-top: 2px;">
          <i class="ri-calendar-line" style="color: #0284c7;"></i> ${sticker.batchDate}
        </div>
      </td>
      <td>
        <strong style="color: #0284c7; font-size: 12px; font-family: var(--font-mono);">${sticker.customerPartNo}</strong>
      </td>
      <td style="font-family: var(--font-mono); font-size: 11px;">${producedTime}</td>
      <td><strong>${box.completedCount} PCS</strong></td>
      <td>
        ${isScanned ? '<span class="badge badge-verified"><i class="ri-check-line"></i> VERIFIED</span>' : '<span class="badge badge-pending"><i class="ri-barcode-box-line"></i> PENDING SCAN</span>'}
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Update progress bar
  const scannedCount = activeTx.scannedBoxes ? activeTx.scannedBoxes.length : 0;
  const totalCount = activeTx.allocatedBoxes.length;
  const pct = totalCount > 0 ? Math.round((scannedCount / totalCount) * 100) : 0;

  const progressFill = document.getElementById('dispatch-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${pct}%`;
    progressFill.style.background = pct === 100 ? '#059669' : '#0284c7';
  }

  const progText = document.getElementById('dispatch-progress-text');
  if (progText) {
    progText.textContent = `PROGRESS: ${scannedCount} / ${totalCount} BOXES SCANNED (${pct}%)`;
  }
  document.getElementById('btn-confirm-dispatch').disabled = scannedCount !== totalCount;

  // Update Telemetry Counters
  const radialPct = document.getElementById('dispatch-radial-pct');
  const radialBoxes = document.getElementById('dispatch-radial-boxes');
  const radialParts = document.getElementById('dispatch-radial-parts');

  if (radialPct) radialPct.textContent = `${pct}%`;

  const totalParts = activeTx.allocatedBoxes.reduce((sum, b) => sum + (b.completedCount || 0), 0);
  const scannedParts = activeTx.allocatedBoxes
    .filter(b => scannedBoxIds.includes(b.boxId.toString()))
    .reduce((sum, b) => sum + (b.completedCount || 0), 0);

  if (radialBoxes) radialBoxes.textContent = `${scannedCount} / ${totalCount}`;
  if (radialParts) radialParts.textContent = `${scannedParts} / ${totalParts}`;

  // Update Next Target Physical Sticker Card
  const nextUnscannedBox = activeTx.allocatedBoxes.find(b => !scannedBoxIds.includes(b.boxId.toString()));
  const stickerQty = document.getElementById('reticle-sticker-qty');
  const stickerCode = document.getElementById('reticle-sticker-code');
  const stickerCustPart = document.getElementById('reticle-sticker-custpart');
  const stickerDate = document.getElementById('reticle-sticker-date');
  const stickerModel = document.getElementById('reticle-sticker-model');

  if (nextUnscannedBox) {
    const sticker = getBoxStickerInfo(nextUnscannedBox);
    if (stickerQty) stickerQty.textContent = `${nextUnscannedBox.completedCount || 60} PCS`;
    if (stickerCode) stickerCode.textContent = sticker.shiftBatchCode;
    if (stickerCustPart) stickerCustPart.textContent = sticker.customerPartNo;
    if (stickerDate) stickerDate.textContent = sticker.batchDate || (nextUnscannedBox.closedAt ? new Date(nextUnscannedBox.closedAt).toISOString().slice(0, 10) : '--');
    if (stickerModel) stickerModel.textContent = activeTx.modelName || activeTx.modelId;
  } else {
    if (stickerQty) stickerQty.textContent = '0 PCS';
    if (stickerCode) stickerCode.textContent = 'ALL VERIFIED';
    if (stickerCustPart) stickerCustPart.textContent = 'ORDER COMPLETE';
    if (stickerDate) stickerDate.textContent = 'SUCCESS';
    if (stickerModel) stickerModel.textContent = activeTx.modelName || activeTx.modelId;
  }

  // Update Status Badge
  const statusBadge = document.getElementById('active-tx-status-badge');
  if (scannedCount === totalCount && totalCount > 0) {
    if (statusBadge) {
      statusBadge.className = 'badge badge-verified';
      statusBadge.textContent = 'READY_FOR_LOAD';
    }
  } else {
    if (statusBadge) {
      statusBadge.className = 'badge badge-available';
      statusBadge.textContent = 'IN PROGRESS';
    }
  }

  // Render Staging Bay Warehouse Animation Entity
  if (window.dispatchAnimation) {
    window.dispatchAnimation.render({
      allocatedBoxes: activeTx.allocatedBoxes.map(b => ({ ...b, label: getBoxStickerInfo(b).shiftBatchCode })),
      scannedBoxes: activeTx.scannedBoxes || [],
      isComplete: scannedCount === totalCount && totalCount > 0
    });
  }
}

async function renderIdleDispatchUI() {
  const setupCard = document.getElementById('dispatch-setup-card');
  const activeCard = document.getElementById('dispatch-active-card');
  if (setupCard) setupCard.style.display = 'block';
  if (activeCard) activeCard.style.display = 'none';

  const progressFill = document.getElementById('dispatch-progress-fill');
  if (progressFill) progressFill.style.width = '0%';
  const pickTbody = document.getElementById('fifo-pick-tbody');
  if (pickTbody) {
    pickTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No active dispatch session. Select a model and start a session above.</td></tr>';
  }
  const progText = document.getElementById('dispatch-progress-text');
  if (progText) progText.textContent = 'NO ACTIVE DISPATCH';
  const confirmBtn = document.getElementById('btn-confirm-dispatch');
  if (confirmBtn) confirmBtn.disabled = true;

  if (window.dispatchAnimation) {
    window.dispatchAnimation.reset();
  }
  clearBannerAlert();

  // Reload available models and live stock count for the initiate new dispatch session card
  await loadModelSelector(true);
}

async function processBoxScan(scannedPayload) {
  if (!activeTx) return;

  try {
    const res = await api.scanBox(activeTx.dispatchId, scannedPayload);
    if (res.success) {
      sounds.playSuccess();
      showBannerAlert(res.message, 'success');
      // Refresh active transaction state (animation queues box via render)
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
  if (notes === null) return; // User cancelled modal dialog

  try {
    const res = await api.confirmDispatch(activeTx.dispatchId, notes || '');
    sounds.playCompletion();
    const completedDispatchId = activeTx.dispatchId;

    // Trigger forklift departure celebration animation before resetting
    if (window.dispatchAnimation) {
      await window.dispatchAnimation.triggerDeparture();
    }

    activeTx = null;
    await renderIdleDispatchUI();
    showBannerAlert(res.message, 'success');

    // Automatically open the detailed Delivery Challan / Bill!
    openDispatchBill(completedDispatchId);
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Failed to confirm dispatch: ' + err.message, { title: 'CONFIRM FAILED', type: 'danger' });
  }
}


function handleCancelDispatch() {
  if (window.sounds) window.sounds.playClick();
  if (!activeTx) return;
  const dispatchIdEl = document.getElementById('modal-cancel-dispatch-id');
  const metaEl = document.getElementById('modal-cancel-meta');
  const reasonEl = document.getElementById('modal-cancel-reason');
  const errEl = document.getElementById('modal-cancel-error');

  if (dispatchIdEl) dispatchIdEl.textContent = activeTx.dispatchId;
  if (metaEl) {
    const scanned = (activeTx.scannedBoxes && activeTx.scannedBoxes.length) || 0;
    const total = (activeTx.allocatedBoxes && activeTx.allocatedBoxes.length) || 0;
    metaEl.textContent = `Model: ${activeTx.modelName || activeTx.modelId} • Scanned: ${scanned} / ${total} Boxes`;
  }
  if (reasonEl) {
    reasonEl.value = 'Operator cancelled';
    setTimeout(() => reasonEl.focus(), 150);
  }
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  openModal('modal-cancel-dispatch');
}

async function submitCancelDispatchModal() {
  if (!activeTx) return;
  const reasonEl = document.getElementById('modal-cancel-reason');
  const errEl = document.getElementById('modal-cancel-error');
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!reason) {
    if (errEl) {
      errEl.textContent = 'Please provide a reason for cancelling this active session.';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (reasonEl) reasonEl.focus();
    return;
  }

  try {
    await api.cancelDispatch(activeTx.dispatchId, reason);
    sounds.playAlert();
    closeModals();
    activeTx = null;
    await renderIdleDispatchUI();
    showBannerAlert('Dispatch session cancelled.', 'info', 4000);
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Cancellation failed: ' + err.message;
      errEl.style.display = 'block';
    } else {
      await customModal.alert('Cancel failed: ' + err.message, { title: 'CANCEL ERROR', type: 'danger' });
    }
    sounds.playViolation();
  }
}

let _dispAlertTimeout = null;

function showBannerAlert(msg, type = 'info', autoClearMs = 4500) {
  const banner = document.getElementById('disp-alert-banner');
  if (!banner) return;
  if (_dispAlertTimeout) {
    clearTimeout(_dispAlertTimeout);
    _dispAlertTimeout = null;
  }
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

  if (autoClearMs > 0) {
    _dispAlertTimeout = setTimeout(() => {
      clearBannerAlert();
    }, autoClearMs);
  }
}

function clearBannerAlert() {
  const banner = document.getElementById('disp-alert-banner');
  if (!banner) return;
  banner.style.display = 'none';
  banner.textContent = '';
  banner.classList.remove('alarm-active');
  if (_dispAlertTimeout) {
    clearTimeout(_dispAlertTimeout);
    _dispAlertTimeout = null;
  }
}

// ============================================================================
// VIEW 2: BOX INVENTORY
// ============================================================================
let _invCurrentPage = 1;
let _invTotalPages = 1;
let _invLimit = 25;

async function loadInventoryView() {
  const modelSelect = document.getElementById('inv-filter-model');
  if (modelSelect && modelSelect.children.length <= 1) {
    try {
      const modelsRes = await api.getModels();
      if (modelsRes && modelsRes.models) {
        modelsRes.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.modelId;
          opt.textContent = m.modelName || m.modelId;
          modelSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('Failed to load models list for filter:', err);
    }
  }

  // Attach custom SCADA dropdown
  if (window.scadaDropdown && modelSelect) {
    window.scadaDropdown.attach(modelSelect).sync();
  }

  // Attach custom SCADA datepickers
  const dateFromEl = document.getElementById('inv-filter-date-from');
  const dateToEl = document.getElementById('inv-filter-date-to');
  if (window.scadaDatePicker) {
    if (dateFromEl) window.scadaDatePicker.attach(dateFromEl, { placeholder: 'YYYY-MM-DD' });
    if (dateToEl) window.scadaDatePicker.attach(dateToEl, { placeholder: 'YYYY-MM-DD' });
  }

  // Default to current month if not already set
  if (dateFromEl && !dateFromEl.value) {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    if (dateFromEl._scadaDatePicker) dateFromEl._scadaDatePicker.setDate(firstDay);
    else dateFromEl.value = firstDay;
  }
  if (dateToEl && !dateToEl.value) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    if (dateToEl._scadaDatePicker) dateToEl._scadaDatePicker.setDate(lastDayStr);
    else dateToEl.value = lastDayStr;
  }

  await applyInventoryFilter(1);
}

function setInventoryStatusFilter(status) {
  if (window.sounds) window.sounds.playClick();
  const hiddenInput = document.getElementById('inv-filter-status');
  if (hiddenInput) hiddenInput.value = status;

  document.querySelectorAll('#inv-status-tabs-container .inv-status-tab-btn').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  applyInventoryFilter(1);
}

function executeInventorySearch() {
  if (window.sounds) window.sounds.playClick();
  const searchEl = document.getElementById('inv-filter-search');
  const query = searchEl ? searchEl.value.trim() : '';

  // If searching with a keyword, clear all other filters so search is unconstrained
  if (query) {
    const modelEl = document.getElementById('inv-filter-model');
    if (modelEl) {
      modelEl.value = 'ALL';
      if (modelEl._scadaDropdown) modelEl._scadaDropdown.sync();
    }

    const dateFromEl = document.getElementById('inv-filter-date-from');
    const dateToEl = document.getElementById('inv-filter-date-to');
    if (dateFromEl) {
      dateFromEl.value = '';
      if (dateFromEl._scadaDatePicker) dateFromEl._scadaDatePicker.clear();
    }
    if (dateToEl) {
      dateToEl.value = '';
      if (dateToEl._scadaDatePicker) dateToEl._scadaDatePicker.clear();
    }

    const hiddenInput = document.getElementById('inv-filter-status');
    if (hiddenInput) hiddenInput.value = 'ALL';

    document.querySelectorAll('#inv-status-tabs-container .inv-status-tab-btn').forEach(btn => {
      if (btn.dataset.status === 'ALL') {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  applyInventoryFilter(1);
}

function resetInventoryFilters() {
  if (window.sounds) window.sounds.playClick();
  const modelEl = document.getElementById('inv-filter-model');
  const searchEl = document.getElementById('inv-filter-search');
  const dateFromEl = document.getElementById('inv-filter-date-from');
  const dateToEl = document.getElementById('inv-filter-date-to');

  if (modelEl) {
    modelEl.value = 'ALL';
    if (modelEl._scadaDropdown) modelEl._scadaDropdown.sync();
  }
  if (searchEl) searchEl.value = '';

  // Reset dates to current month defaults
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  if (dateFromEl) {
    if (dateFromEl._scadaDatePicker) dateFromEl._scadaDatePicker.setDate(firstDay);
    else dateFromEl.value = firstDay;
  }
  if (dateToEl) {
    if (dateToEl._scadaDatePicker) dateToEl._scadaDatePicker.setDate(lastDayStr);
    else dateToEl.value = lastDayStr;
  }

  const hiddenInput = document.getElementById('inv-filter-status');
  if (hiddenInput) hiddenInput.value = 'ALL';

  document.querySelectorAll('#inv-status-tabs-container .inv-status-tab-btn').forEach(btn => {
    if (btn.dataset.status === 'ALL') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  applyInventoryFilter(1);
}

function changeInventoryPage(delta) {
  if (window.sounds) window.sounds.playClick();
  const newPage = _invCurrentPage + delta;
  if (newPage >= 1 && newPage <= _invTotalPages) {
    applyInventoryFilter(newPage);
  }
}

async function applyInventoryFilter(page = 1) {
  _invCurrentPage = page;
  const modelEl = document.getElementById('inv-filter-model');
  const statusEl = document.getElementById('inv-filter-status');
  const searchEl = document.getElementById('inv-filter-search');
  const dateFromEl = document.getElementById('inv-filter-date-from');
  const dateToEl = document.getElementById('inv-filter-date-to');

  const modelId = modelEl ? modelEl.value : 'ALL';
  const status = statusEl ? statusEl.value : 'ALL';
  const search = searchEl ? searchEl.value.trim() : '';
  const dateFrom = dateFromEl ? dateFromEl.value.trim() : '';
  const dateTo = dateToEl ? dateToEl.value.trim() : '';

  try {
    const tbody = document.getElementById('inventory-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;"><i class="ri-loader-4-line scada-spin" style="font-size: 16px; display: inline-block; vertical-align: middle; margin-right: 6px;"></i> Loading inventory data...</td></tr>';

    const queryParams = { modelId, status, page: _invCurrentPage, limit: _invLimit };
    if (search) queryParams.search = search;
    if (dateFrom) queryParams.dateFrom = dateFrom;
    if (dateTo) queryParams.dateTo = dateTo;

    const res = await api.getBoxes(queryParams);
    tbody.innerHTML = '';

    const totalChip = document.getElementById('inv-total-chip');
    const pageInfo = document.getElementById('inv-pagination-info');
    const pageDisplay = document.getElementById('inv-page-display');
    const btnPrev = document.getElementById('btn-inv-prev');
    const btnNext = document.getElementById('btn-inv-next');

    const totalBoxes = (res && res.total) || 0;
    _invTotalPages = (res && res.pages) || 1;

    if (totalChip) totalChip.textContent = `${totalBoxes} BOXES`;
    if (pageInfo) {
      const start = totalBoxes === 0 ? 0 : (_invCurrentPage - 1) * _invLimit + 1;
      const end = Math.min(_invCurrentPage * _invLimit, totalBoxes);
      pageInfo.textContent = `Showing ${start} - ${end} of ${totalBoxes} boxes`;
    }
    if (pageDisplay) pageDisplay.textContent = `PAGE ${_invCurrentPage} / ${_invTotalPages || 1}`;
    if (btnPrev) btnPrev.disabled = _invCurrentPage <= 1;
    if (btnNext) btnNext.disabled = _invCurrentPage >= _invTotalPages;

    if (!res || !res.boxes || res.boxes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 32px;"><i class="ri-inbox-line" style="font-size: 24px; display: block; margin-bottom: 6px; color: #94a3b8;"></i> No boxes found matching filter criteria.</td></tr>';
      return;
    }

    const userRole = (api.currentUser && api.currentUser.role) || 'admin';
    const isSupervisorOrAbove = ['supervisor', 'manager', 'admin'].includes(userRole);
    const isManagerOrAbove = ['manager', 'admin'].includes(userRole);

    res.boxes.forEach(b => {
      const tr = document.createElement('tr');
      const sticker = getBoxStickerInfo(b);
      const statusBadge = `<span class="badge badge-${b.status}">${(b.status || 'unknown').toUpperCase()}</span>`;

      // Reference ID column
      let refHtml = '<span style="color: #94a3b8; font-size: 11px;">—</span>';
      if (b.status === 'hold') {
        refHtml = `<span class="badge badge-hold" style="font-size: 9.5px; padding: 2px 6px;">${b.holdId || 'HLD-PENDING'}</span>`;
      } else if (b.status === 'rejected') {
        refHtml = `<span class="badge badge-rejected" style="font-size: 9.5px; padding: 2px 6px;">${b.rejectionId || 'REJ-PENDING'}</span>`;
      } else if (b.status === 'dispatched') {
        refHtml = `<span class="badge badge-success" style="font-size: 9.5px; padding: 2px 6px;"><strong style="font-family: var(--font-mono);">${b.dispatchId || 'DISPATCHED'}</strong></span>`;
      }

      // Details / Reason column
      let detailsHtml = '<span style="color: #94a3b8; font-size: 11px;">—</span>';
      if (b.status === 'hold') {
        detailsHtml = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 11px; font-weight: 600; color: #b45309;">${b.holdReason || 'Reason unspecified'}</span>
            ${b.holdRemarks ? `<span style="font-size: 10px; color: #64748b;">${b.holdRemarks}</span>` : ''}
          </div>
        `;
      } else if (b.status === 'rejected') {
        detailsHtml = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 11px; font-weight: 600; color: #dc2626;">${b.rejectionReason || 'Reason unspecified'}</span>
            ${b.rejectionRemarks ? `<span style="font-size: 10px; color: #64748b;">${b.rejectionRemarks}</span>` : ''}
          </div>
        `;
      } else if (b.status === 'dispatched') {
        const dispatchDate = b.dispatchedAt ? new Date(b.dispatchedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (b.updatedAt ? new Date(b.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
        detailsHtml = `
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-heading);">
            Dispatched at: ${dispatchDate}
          </div>
        `;
      }

      // Actions Column: Always include TRACE icon + contextual operation
      let actionsHtml = `
        <div style="display: flex; gap: 5px; align-items: center; justify-content: flex-end;">
          <button class="hud-icon-btn" onclick="traceSpecificBox('${b.batchNumber}')" title="Trace Box #${b.batchNumber} Lifecycle" style="width: 28px; height: 28px; font-size: 13px;">
            <i class="ri-search-eye-line"></i>
          </button>
      `;

      const safeQrParam = encodeURIComponent(b.batchQrData || '');
      const stickerCodeParam = encodeURIComponent(sticker.shiftBatchCode);
      const modelNameParam = encodeURIComponent(b.modelName || b.modelId || '');

      if (b.status === 'available' && isSupervisorOrAbove) {
        actionsHtml += `
          <button class="btn-scada btn-warning" style="padding: 2px 7px; font-size: 10px; height: 26px;" onclick="openHoldModal('${b._id}', '${stickerCodeParam}', '${modelNameParam}', ${b.completedCount || 0}, '${safeQrParam}')">
            <i class="ri-pause-circle-line"></i> HOLD
          </button>
          <button class="btn-scada btn-danger" style="padding: 2px 7px; font-size: 10px; height: 26px;" onclick="openRejectModal('${b._id}', '${stickerCodeParam}', '${modelNameParam}', ${b.completedCount || 0}, '${safeQrParam}')">
            <i class="ri-close-circle-line"></i> REJECT
          </button>
        `;
      } else if (b.status === 'hold' && isSupervisorOrAbove) {
        actionsHtml += `
          <button class="btn-scada btn-success" style="padding: 2px 9px; font-size: 10px; height: 26px;" onclick="openReleaseModal('${b._id}', '${stickerCodeParam}', '${modelNameParam}', ${b.completedCount || 0}, '${safeQrParam}')">
            <i class="ri-play-circle-line"></i> RELEASE
          </button>
        `;
      } else if (b.status === 'rejected' && isManagerOrAbove) {
        actionsHtml += `
          <button class="btn-scada btn-primary" style="padding: 2px 9px; font-size: 10px; height: 26px;" onclick="openReopenModal('${b._id}', '${stickerCodeParam}', '${modelNameParam}', ${b.completedCount || 0}, '${safeQrParam}')">
            <i class="ri-restart-line"></i> REOPEN
          </button>
        `;
      } else if (b.status === 'dispatched' && b.dispatchId) {
        actionsHtml += `
          <button class="btn-scada btn-secondary" style="padding: 2px 8px; font-size: 10px; height: 26px;" onclick="openDispatchBill('${b.dispatchId}')" title="View Delivery Challan">
            <i class="ri-file-text-line"></i> MANIFEST
          </button>
        `;
      }


      actionsHtml += `</div>`;

      const producedTime = b.closedAt ? new Date(b.closedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';

      tr.innerHTML = `
        <td>
          <strong style="font-size: 13.5px; font-family: var(--font-mono); color: #0f172a;">${sticker.shiftBatchCode}</strong>
          <div style="font-size: 10.5px; color: #64748b; font-weight: 600; font-family: var(--font-mono); margin-top: 2px;">
            <i class="ri-calendar-line" style="color: #0284c7;"></i> ${sticker.batchDate}
          </div>
        </td>
        <td><strong>${b.modelName || b.modelId}</strong></td>
        <td style="font-family: var(--font-mono); font-size: 11px; font-weight: 700;">MC-${b.machineNo || '18'}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${producedTime}</td>
        <td><strong>${b.completedCount || 0} / ${b.batchSize || 0}</strong></td>
        <td>${statusBadge}</td>
        <td>${refHtml}</td>
        <td>${detailsHtml}</td>
        <td style="text-align: right;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load inventory:', err.message);
    const tbody = document.getElementById('inventory-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #dc2626; padding: 24px;"><i class="ri-error-warning-line" style="font-size: 20px; vertical-align: middle; margin-right: 6px;"></i> Failed to load inventory: ${err.message || 'Server error'}</td></tr>`;
    }
  }
}

// Modal actions: Hold, Release, Reject, Reopen
let activeModalBoxId = null;
let activeModalBatchNumber = null;
let activeModalQrData = null;
let activeModalType = null;
let activeModalVerified = false;

function resetModalScanState(modalType, batchNumber) {
  const cardEl = document.getElementById(`modal-${modalType}-scan-card`);
  const titleEl = document.getElementById(`modal-${modalType}-scan-title`);
  const descEl = document.getElementById(`modal-${modalType}-scan-desc`);
  const pillEl = document.getElementById(`modal-${modalType}-scan-pill`);

  if (cardEl) {
    cardEl.style.background = '#fffbeb';
    cardEl.style.border = '1px dashed #f59e0b';
  }
  if (titleEl) {
    titleEl.style.color = '#92400e';
    titleEl.textContent = 'PHYSICAL BOX SCAN REQUIRED';
  }
  if (descEl) {
    descEl.style.color = '#b45309';
    descEl.textContent = `Scan barcode on Box ${batchNumber} to verify in hand`;
  }
  if (pillEl) {
    pillEl.className = 'badge';
    pillEl.style.background = '#fde68a';
    pillEl.style.color = '#92400e';
    pillEl.textContent = 'AWAITING SCAN';
  }
}

function handleModalScanVerification(qrData) {
  const scanned = (qrData || '').trim();
  const targetBatchStr = String(activeModalBatchNumber);
  const targetQr = (activeModalQrData || '').trim();

  // Match: exact QR payload, exact batch number string, or embedded delimiter
  const isMatch = (targetQr && scanned === targetQr) ||
    scanned === targetBatchStr ||
    scanned.includes(`|${targetBatchStr}*`) ||
    scanned.includes(`|${targetBatchStr}|`) ||
    scanned.endsWith(`|${targetBatchStr}`);

  const modalType = activeModalType;
  const cardEl = document.getElementById(`modal-${modalType}-scan-card`);
  const titleEl = document.getElementById(`modal-${modalType}-scan-title`);
  const descEl = document.getElementById(`modal-${modalType}-scan-desc`);
  const pillEl = document.getElementById(`modal-${modalType}-scan-pill`);
  const errEl = document.getElementById(`modal-${modalType}-error`);

  if (isMatch) {
    activeModalVerified = true;
    sounds.playSuccess();
    if (errEl) errEl.style.display = 'none';

    if (cardEl) {
      cardEl.style.background = '#f0fdf4';
      cardEl.style.border = '1px solid #86efac';
    }
    if (titleEl) {
      titleEl.style.color = '#15803d';
      titleEl.textContent = 'PHYSICAL BOX VERIFIED';
    }
    if (descEl) {
      descEl.style.color = '#166534';
      descEl.textContent = `Box ${targetBatchStr} barcode scanned and confirmed.`;
    }
    if (pillEl) {
      pillEl.className = 'badge badge-success';
      pillEl.style.background = '';
      pillEl.style.color = '';
      pillEl.textContent = 'VERIFIED';
    }

    // "if typing enter/clicking the button is required, with scan, it should not be required..."
    // Auto-submit immediately if mandatory inputs are present!
    if (modalType === 'hold') {
      const reason = document.getElementById('modal-hold-reason')?.value;
      const remarks = document.getElementById('modal-hold-remarks')?.value.trim();
      if (reason && remarks) {
        submitHoldModal();
      } else {
        if (!reason) document.getElementById('modal-hold-reason')?.focus();
        else document.getElementById('modal-hold-remarks')?.focus();
      }
    } else if (modalType === 'reject') {
      const reason = document.getElementById('modal-reject-reason')?.value;
      const remarks = document.getElementById('modal-reject-remarks')?.value.trim();
      if (reason && remarks) {
        submitRejectModal();
      } else {
        if (!reason) document.getElementById('modal-reject-reason')?.focus();
        else document.getElementById('modal-reject-remarks')?.focus();
      }
    } else if (modalType === 'release') {
      const remarks = document.getElementById('modal-release-remarks')?.value.trim();
      if (remarks && remarks.length >= 3) {
        submitReleaseModal();
      } else {
        document.getElementById('modal-release-remarks')?.focus();
      }
    } else if (modalType === 'reopen') {
      const remarks = document.getElementById('modal-reopen-remarks')?.value.trim();
      if (remarks && remarks.length >= 5) {
        submitReopenModal();
      } else {
        document.getElementById('modal-reopen-remarks')?.focus();
      }
    }
  } else {
    sounds.playViolation();
    if (errEl) {
      errEl.textContent = `PHYSICAL SCAN MISMATCH: Scanned "${scanned}" does not match Box ${targetBatchStr}!`;
      errEl.style.display = 'block';
    }
    if (cardEl) {
      cardEl.style.background = '#fef2f2';
      cardEl.style.border = '1px solid #fca5a5';
    }
    if (titleEl) {
      titleEl.style.color = '#991b1b';
      titleEl.textContent = 'BARCODE MISMATCH';
    }
    if (descEl) {
      descEl.style.color = '#dc2626';
      descEl.textContent = `Scanned barcode does not match Box ${targetBatchStr}!`;
    }
    if (pillEl) {
      pillEl.className = 'badge badge-danger';
      pillEl.style.background = '';
      pillEl.style.color = '';
      pillEl.textContent = 'MISMATCH';
    }
  }
}

function openHoldModal(boxId, stickerCodeRaw, modelNameRaw, qty, encodedQr = '') {
  if (window.sounds) window.sounds.playClick();
  const stickerCode = decodeURIComponent(stickerCodeRaw || '');
  const modelName = decodeURIComponent(modelNameRaw || '');

  activeModalBoxId = boxId;
  activeModalBatchNumber = stickerCode;
  activeModalQrData = decodeURIComponent(encodedQr || '');
  activeModalType = 'hold';
  activeModalVerified = false;

  const title = document.getElementById('modal-hold-title');
  if (title) title.textContent = `PUT BOX ${stickerCode} ON HOLD`;

  const label = document.getElementById('modal-hold-box-label');
  if (label) label.textContent = `BOX ${stickerCode}`;

  const meta = document.getElementById('modal-hold-box-meta');
  if (meta) meta.textContent = `Model: ${modelName || '--'} • Qty: ${qty != null ? qty : '--'} PCS`;

  const errEl = document.getElementById('modal-hold-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  resetModalScanState('hold', batchNumber);

  // Populate reasons and force blank default selection
  populateModalReasonDropdowns();
  const reasonSelect = document.getElementById('modal-hold-reason');
  if (reasonSelect) {
    reasonSelect.value = '';
    if (reasonSelect._scadaDropdown) reasonSelect._scadaDropdown.sync();
  }

  const remarksInput = document.getElementById('modal-hold-remarks');
  if (remarksInput) {
    remarksInput.value = '';
  }

  openModal('modal-hold');
}

async function submitHoldModal() {
  const reasonEl = document.getElementById('modal-hold-reason');
  const remarksEl = document.getElementById('modal-hold-remarks');
  const errEl = document.getElementById('modal-hold-error');

  const reason = reasonEl ? reasonEl.value : '';
  const remarks = remarksEl ? remarksEl.value.trim() : '';

  if (!reason || reason === '') {
    if (errEl) {
      errEl.textContent = 'Please select an appropriate reason for putting the box on hold.';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (reasonEl) reasonEl.focus();
    return;
  }

  if (!remarks) {
    if (errEl) {
      errEl.textContent = 'Supervisor remarks are mandatory. Please provide quarantine details.';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (remarksEl) remarksEl.focus();
    return;
  }

  if (!activeModalVerified) {
    if (errEl) {
      errEl.textContent = `PHYSICAL SCAN MANDATORY: Please scan Box ${activeModalBatchNumber} barcode to authorize hold.`;
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    return;
  }

  if (errEl) errEl.style.display = 'none';

  try {
    await api.holdBox(activeModalBoxId, reason, remarks);
    sounds.playAlert();
    closeModals();
    applyInventoryFilter();
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Hold failed: ' + err.message;
      errEl.style.display = 'block';
    } else {
      await customModal.alert('Hold failed: ' + err.message, { title: 'HOLD ERROR', type: 'danger' });
    }
    sounds.playViolation();
  }
}

function openReleaseModal(boxId, stickerCodeRaw, modelNameRaw, qty, encodedQr = '') {
  if (window.sounds) window.sounds.playClick();
  const stickerCode = decodeURIComponent(stickerCodeRaw || '');
  const modelName = decodeURIComponent(modelNameRaw || '');

  activeModalBoxId = boxId;
  activeModalBatchNumber = stickerCode;
  activeModalQrData = decodeURIComponent(encodedQr || '');
  activeModalType = 'release';
  activeModalVerified = false;

  const title = document.getElementById('modal-release-title');
  if (title) title.textContent = `RELEASE BOX ${stickerCode}`;

  const label = document.getElementById('modal-release-box-label');
  if (label) label.textContent = `BOX ${stickerCode}`;

  const meta = document.getElementById('modal-release-box-meta');
  if (meta) meta.textContent = `Model: ${modelName || '--'} • Qty: ${qty != null ? qty : '--'} PCS`;

  const errEl = document.getElementById('modal-release-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  resetModalScanState('release', batchNumber);

  const remarksInput = document.getElementById('modal-release-remarks');
  if (remarksInput) {
    remarksInput.value = '';
    setTimeout(() => remarksInput.focus(), 150);
  }

  openModal('modal-release');
}

async function submitReleaseModal() {
  if (!activeModalBoxId) return;

  const errEl = document.getElementById('modal-release-error');
  const remarksInput = document.getElementById('modal-release-remarks');
  const remarks = remarksInput ? remarksInput.value.trim() : '';

  if (!remarks || remarks.length < 3) {
    if (errEl) {
      errEl.textContent = 'Please enter release remarks (min 3 characters).';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (remarksInput) remarksInput.focus();
    return;
  }

  if (!activeModalVerified) {
    if (errEl) {
      errEl.textContent = `PHYSICAL SCAN MANDATORY: Please scan Box ${activeModalBatchNumber} barcode to authorize release.`;
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    return;
  }

  try {
    await api.releaseHold(activeModalBoxId, remarks);
    closeModals();
    sounds.playSuccess();
    applyInventoryFilter();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Failed to release box';
      errEl.style.display = 'block';
    } else {
      await customModal.alert('Release failed: ' + err.message, { title: 'RELEASE ERROR', type: 'danger' });
    }
    sounds.playViolation();
  }
}

async function quickReleaseHold(boxId, batchNumber, modelId, qty, encodedQr = '') {
  openReleaseModal(boxId, batchNumber, modelId, qty, encodedQr);
}

function openRejectModal(boxId, stickerCodeRaw, modelNameRaw, qty, encodedQr = '') {
  if (window.sounds) window.sounds.playClick();
  const stickerCode = decodeURIComponent(stickerCodeRaw || '');
  const modelName = decodeURIComponent(modelNameRaw || '');

  activeModalBoxId = boxId;
  activeModalBatchNumber = stickerCode;
  activeModalQrData = decodeURIComponent(encodedQr || '');
  activeModalType = 'reject';
  activeModalVerified = false;

  const title = document.getElementById('modal-reject-title');
  if (title) title.textContent = `REJECT BOX ${stickerCode}`;

  const label = document.getElementById('modal-reject-box-label');
  if (label) label.textContent = `BOX ${stickerCode}`;

  const meta = document.getElementById('modal-reject-box-meta');
  if (meta) meta.textContent = `Model: ${modelName || '--'} • Qty: ${qty != null ? qty : '--'} PCS`;

  const errEl = document.getElementById('modal-reject-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  resetModalScanState('reject', batchNumber);

  // Populate reasons and force blank default selection
  populateModalReasonDropdowns();
  const reasonSelect = document.getElementById('modal-reject-reason');
  if (reasonSelect) {
    reasonSelect.value = '';
    if (reasonSelect._scadaDropdown) reasonSelect._scadaDropdown.sync();
  }

  const remarksInput = document.getElementById('modal-reject-remarks');
  if (remarksInput) {
    remarksInput.value = '';
  }

  openModal('modal-reject');
}

async function submitRejectModal() {
  const reasonEl = document.getElementById('modal-reject-reason');
  const remarksEl = document.getElementById('modal-reject-remarks');
  const errEl = document.getElementById('modal-reject-error');

  const reason = reasonEl ? reasonEl.value : '';
  const remarks = remarksEl ? remarksEl.value.trim() : '';

  if (!reason || reason === '') {
    if (errEl) {
      errEl.textContent = 'Please select an appropriate rejection defect reason.';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (reasonEl) reasonEl.focus();
    return;
  }

  if (!remarks) {
    if (errEl) {
      errEl.textContent = 'Rejection remarks are mandatory. Please provide defect details.';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (remarksEl) remarksEl.focus();
    return;
  }

  if (!activeModalVerified) {
    if (errEl) {
      errEl.textContent = `PHYSICAL SCAN MANDATORY: Please scan Box ${activeModalBatchNumber} barcode to authorize rejection.`;
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    return;
  }

  if (errEl) errEl.style.display = 'none';

  try {
    await api.rejectBox(activeModalBoxId, reason, remarks);
    sounds.playViolation();
    closeModals();
    applyInventoryFilter();
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Reject failed: ' + err.message;
      errEl.style.display = 'block';
    } else {
      await customModal.alert('Reject failed: ' + err.message, { title: 'REJECT ERROR', type: 'danger' });
    }
    sounds.playViolation();
  }
}

function openReopenModal(boxId, stickerCodeRaw, modelNameRaw, qty, encodedQr = '') {
  if (window.sounds) window.sounds.playClick();
  const stickerCode = decodeURIComponent(stickerCodeRaw || '');
  const modelName = decodeURIComponent(modelNameRaw || '');

  activeModalBoxId = boxId;
  activeModalBatchNumber = stickerCode;
  activeModalQrData = decodeURIComponent(encodedQr || '');
  activeModalType = 'reopen';
  activeModalVerified = false;

  const title = document.getElementById('modal-reopen-title');
  if (title) title.textContent = `REOPEN BOX ${stickerCode}`;

  const label = document.getElementById('modal-reopen-box-label');
  if (label) label.textContent = `BOX ${stickerCode}`;

  const meta = document.getElementById('modal-reopen-box-meta');
  if (meta) meta.textContent = `Model: ${modelName || '--'} • Qty: ${qty != null ? qty : '--'} PCS`;

  const errEl = document.getElementById('modal-reopen-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  resetModalScanState('reopen', batchNumber);

  const remarksInput = document.getElementById('modal-reopen-remarks');
  if (remarksInput) {
    remarksInput.value = '';
    setTimeout(() => remarksInput.focus(), 150);
  }

  openModal('modal-reopen');
}

async function submitReopenModal() {
  const remarksEl = document.getElementById('modal-reopen-remarks');
  const errEl = document.getElementById('modal-reopen-error');
  const remarks = remarksEl ? remarksEl.value.trim() : '';

  if (!remarks || remarks.length < 5) {
    if (errEl) {
      errEl.textContent = 'Mandatory remarks required (minimum 5 characters).';
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    if (remarksEl) remarksEl.focus();
    return;
  }

  if (!activeModalVerified) {
    if (errEl) {
      errEl.textContent = `PHYSICAL SCAN MANDATORY: Please scan Box #${activeModalBatchNumber} barcode to authorize reopen.`;
      errEl.style.display = 'block';
    }
    sounds.playViolation();
    return;
  }

  if (errEl) errEl.style.display = 'none';

  try {
    await api.reopenBox(activeModalBoxId, remarks);
    sounds.playSuccess();
    closeModals();
    applyInventoryFilter();
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Reopen failed: ' + err.message;
      errEl.style.display = 'block';
    } else {
      await customModal.alert('Reopen failed: ' + err.message, { title: 'REOPEN ERROR', type: 'danger' });
    }
    sounds.playViolation();
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
  activeModalBoxId = null;
  activeModalBatchNumber = null;
  activeModalQrData = null;
  activeModalType = null;
  activeModalVerified = false;
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
const SCADA_EVENT_CONFIG = {
  'BOX_INGESTED': {
    title: 'PRODUCTION INGESTION',
    icon: 'ri-inbox-archive-line',
    class: 'evt-ingested',
    badgeClass: 'badge-evt-ingested',
    calloutClass: 'callout-evt-ingested',
    desc: 'Produced and packed at production line'
  },
  'BOX_HELD': {
    title: 'QUALITY AUDIT HOLD PLACED',
    icon: 'ri-pause-line',
    class: 'evt-held',
    badgeClass: 'badge-evt-held',
    calloutClass: 'callout-evt-held',
    desc: 'Box quarantined pending quality investigation'
  },
  'BOX_HOLD_RELEASED': {
    title: 'QUALITY HOLD CLEARED & RELEASED',
    icon: 'ri-check-line',
    class: 'evt-released',
    badgeClass: 'badge-evt-released',
    calloutClass: 'callout-evt-released',
    desc: 'Authorized release back to available inventory'
  },
  'BOX_REJECTED': {
    title: 'QUALITY REJECTION (DEFECT QUARANTINE)',
    icon: 'ri-close-line',
    class: 'evt-rejected',
    badgeClass: 'badge-evt-rejected',
    calloutClass: 'callout-evt-rejected',
    desc: 'Scrapped or flagged for complete rejection'
  },
  'BOX_REJECT_REOPENED': {
    title: 'MANAGER REOPENING AUTHORIZATION',
    icon: 'ri-lock-unlock-line',
    class: 'evt-reopened',
    badgeClass: 'badge-evt-reopened',
    calloutClass: 'callout-evt-reopened',
    desc: 'High-level override and release'
  },
  'BOX_ALLOCATED': {
    title: 'ALLOCATED TO FIFO DISPATCH ORDER',
    icon: 'ri-stack-line',
    class: 'evt-allocated',
    badgeClass: 'badge-evt-allocated',
    calloutClass: 'callout-evt-allocated',
    desc: 'Reserved for strict FIFO dispatch staging'
  },
  'BOX_SCANNED': {
    title: 'PHYSICAL BARCODE SCAN VERIFIED',
    icon: 'ri-qr-scan-2-line',
    class: 'evt-scanned',
    badgeClass: 'badge-evt-scanned',
    calloutClass: 'callout-evt-scanned',
    desc: 'Scanned & matched by scanner'
  },
  'BOX_DISPATCHED': {
    title: 'FINAL CUSTOMER DISPATCH CONFIRMED',
    icon: 'ri-truck-line',
    class: 'evt-dispatched',
    badgeClass: 'badge-evt-dispatched',
    calloutClass: 'callout-evt-dispatched',
    desc: 'Order manifest closed and handed over for shipment'
  }
};

let _currentTracedBox = null;
let _currentTracedSerials = [];

// Copy Reference ID to clipboard with tactile feedback
window.copyReferenceId = async function (idStr, el) {
  if (!idStr) return;
  try {
    await navigator.clipboard.writeText(idStr);
    const originalContent = el.innerHTML;
    el.classList.add('copied');
    el.innerHTML = `<i class="ri-check-line" style="font-size: 10px;"></i> COPIED`;
    setTimeout(() => {
      el.classList.remove('copied');
      el.innerHTML = originalContent;
    }, 1300);
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
};

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffSec = Math.round((now - d) / 1000);

  if (diffSec < 45) return 'Just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffDays < 30) return `${diffWeeks}w ago`;
  const diffMonths = Math.round(diffDays / 30.44);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = (diffDays / 365.25).toFixed(1);
  const cleanYears = diffYears.endsWith('.0') ? parseInt(diffYears, 10) : diffYears;
  return `${cleanYears}y ago`;
}

function updateTimelineLine() {
  const rail = document.getElementById('trace-timeline-items');
  if (!rail) return;
  const nodes = rail.querySelectorAll('.scada-timeline-node');
  let line = document.getElementById('scada-timeline-connecting-line');
  if (nodes.length < 2) {
    if (line) line.style.display = 'none';
    return;
  }
  if (!line) {
    line = document.createElement('div');
    line.id = 'scada-timeline-connecting-line';
    rail.appendChild(line);
  }

  const railRect = rail.getBoundingClientRect();
  const firstRect = nodes[0].getBoundingClientRect();
  const lastRect = nodes[nodes.length - 1].getBoundingClientRect();

  const top = (firstRect.top + firstRect.height / 2) - railRect.top;
  const bottom = railRect.bottom - (lastRect.top + lastRect.height / 2);
  const left = (firstRect.left + firstRect.width / 2) - railRect.left;

  line.style.display = 'block';
  line.style.position = 'absolute';
  line.style.left = `${left - 1}px`;
  line.style.top = `${top}px`;
  line.style.bottom = `${bottom}px`;
  line.style.width = '2px';
  line.style.background = '#94a3b8';
  line.style.zIndex = '1';
  line.style.pointerEvents = 'none';
}
window.addEventListener('resize', updateTimelineLine);

async function executeTrace(query) {
  const q = query || document.getElementById('trace-query-input').value.trim();
  if (!q) return;

  const resultsContainer = document.getElementById('trace-results-container');
  const emptyState = document.getElementById('trace-empty-state');

  try {
    const res = await api.traceBox(q);
    const box = res.box;
    const timeline = res.timeline;
    _currentTracedBox = box;
    _currentTracedSerials = box.serialNumbers || [];

    if (emptyState) emptyState.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';

    // 1. Compact Box Header
    const sticker = getBoxStickerInfo(box);
    document.getElementById('trace-box-title').textContent = `BOX ${sticker.shiftBatchCode} - ${box.modelName || box.modelId}`;
    document.getElementById('trace-customer-name').innerHTML = `<i class="ri-building-line"></i> ${box.customerName || 'Mahindra & Mahindra Powertrain'}`;
    document.getElementById('trace-customer-part').textContent = sticker.customerPartNo || box.customerPartNo || 'N/A';
    document.getElementById('trace-model-id').textContent = box.modelName || box.modelId;

    // Status Badge
    const statusMap = {
      'available': { label: 'AVAILABLE', cls: 'badge-available' },
      'hold': { label: 'ON QA HOLD', cls: 'badge-hold' },
      'rejected': { label: 'REJECTED / SCRAP', cls: 'badge-rejected' },
      'dispatched': { label: 'DISPATCHED', cls: 'badge-dispatched' }
    };
    const stInfo = statusMap[box.status] || { label: box.status.toUpperCase(), cls: 'badge-verified' };
    document.getElementById('trace-box-status-badge').innerHTML = `<span class="badge ${stInfo.cls}" style="font-size: 11px; padding: 4px 10px; font-weight: 800;">${stInfo.label}</span>`;

    // 2. Compact Telemetry Metric Chips
    document.getElementById('trace-tile-machine').textContent = `MC-${box.machineNo}`;
    if (window.sounds) window.sounds.playClick();

    const isPartial = box.completedCount < box.batchSize;
    const qtyEl = document.getElementById('trace-tile-qty');
    if (qtyEl) {
      if (isPartial) {
        qtyEl.innerHTML = `
          <span style="color: #b45309; font-weight: 800;">${box.completedCount}</span> / ${box.batchSize} PCS
          <span class="badge" style="background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; font-size: 8.5px; padding: 1px 5px; margin-left: 3px; font-weight: 800; letter-spacing: 0.02em; vertical-align: middle;">PARTIAL</span>
        `;
      } else {
        qtyEl.textContent = `${box.completedCount} / ${box.batchSize} PCS`;
      }
    }

    const now = new Date();
    const closedDate = new Date(box.closedAt);
    const isToday = closedDate.toDateString() === now.toDateString();
    const closedDisplay = isToday
      ? closedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : closedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('trace-tile-closed').textContent = `${closedDisplay} (${formatRelativeTime(box.closedAt)})`;

    // Serials Count in Button
    const btnCount = document.getElementById('trace-serials-btn-count');
    if (btnCount) btnCount.textContent = _currentTracedSerials.length;

    // 3. Chronological Lifecycle Timeline Rail
    const timelineContainer = document.getElementById('trace-timeline-items');
    timelineContainer.innerHTML = '';

    const counter = document.getElementById('trace-event-counter');
    if (counter) counter.textContent = `${timeline.length} AUDIT EVENTS`;

    timeline.forEach(event => {
      const conf = SCADA_EVENT_CONFIG[event.eventType] || {
        title: (event.eventType || '').replace(/_/g, ' '),
        icon: 'ri-record-circle-line',
        class: 'evt-ingested',
        badgeClass: 'badge-evt-ingested',
        calloutClass: 'callout-evt-ingested'
      };

      const step = document.createElement('div');
      step.className = `scada-timeline-step ${conf.class}`;

      const eventDate = new Date(event.timestamp);
      const formattedTime = eventDate.toLocaleString([], {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const relTime = formatRelativeTime(event.timestamp);

      // Clean event tag display: replace underscores with spaces
      const eventTagDisplay = (event.eventType || '').replace(/_/g, ' ');

      // Use Full Name for actor
      const actorName = event.performedByName || event.performedBy || 'System';

      // Callout box: display for QA/hold/reject/reopen actions, or whenever custom reason/remarks exist
      const isAutoMilestone = ['BOX_INGESTED', 'BOX_ALLOCATED', 'BOX_SCANNED', 'BOX_DISPATCHED'].includes(event.eventType);
      let calloutHtml = '';
      if (event.reason || (event.remarks && !isAutoMilestone)) {
        calloutHtml = `
          <div class="scada-callout-box ${conf.calloutClass}">
            ${event.reason ? `<span style="margin-right: 8px;"><strong>AUDIT REASON:</strong> ${event.reason}</span>` : ''}
            ${event.remarks ? `<span><strong>REMARKS:</strong> &ldquo;${event.remarks}&rdquo;</span>` : ''}
          </div>
        `;
      }

      // Copyable Reference ID Chip
      const refChip = event.referenceId ? `
        <span class="scada-ref-chip" onclick="copyReferenceId('${event.referenceId}', this)" title="Click to copy ${event.referenceId}">
          <i class="ri-hashtag" style="color: var(--color-primary); font-size: 10px;"></i>
          <span>${event.referenceId}</span>
          <i class="ri-file-copy-line" style="font-size: 10px; margin-left: 2px; opacity: 0.65;"></i>
        </span>
      ` : '';

      step.innerHTML = `
        <div class="scada-timeline-node" title="${conf.title}">
          <i class="${conf.icon}"></i>
        </div>
        <div class="scada-event-card ${conf.class}">
          <div class="scada-event-card-header">
            <div class="scada-event-left-info">
              <span class="badge ${conf.badgeClass}" style="font-size: 9.5px; padding: 2px 7px; font-weight: 800; letter-spacing: 0.03em;">${eventTagDisplay}</span>
              <span class="scada-event-title">${conf.title}</span>
              <span class="scada-event-actor-inline">
                &bull; By: <strong>${actorName}</strong>
                <span class="badge badge-verified" style="font-size: 8.5px; padding: 1px 4px;">${event.userRole}</span>
              </span>
              ${refChip}
            </div>
            <div class="scada-event-time">
              <i class="ri-time-line" style="color: var(--text-muted);"></i>
              <span>${formattedTime}</span>
              <span style="color: #64748b; font-size: 9.5px;">(${relTime})</span>
            </div>
          </div>
          ${calloutHtml}
        </div>
      `;

      timelineContainer.appendChild(step);
    });

    // Update dynamic line connection precisely between first and last nodes
    requestAnimationFrame(updateTimelineLine);

    sounds.playAlert();
  } catch (err) {
    sounds.playViolation();
    if (emptyState) emptyState.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'none';
    await customModal.alert('Trace lookup error: ' + err.message, { title: 'TRACE LOOKUP ERROR', type: 'danger' });
  }
}

function traceSpecificBox(batchNum) {
  switchTab('tab-traceability');
  const input = document.getElementById('trace-query-input');
  if (input) input.value = batchNum;
  executeTrace(batchNum);
}

function openSerialsModal() {
  const modal = document.getElementById('trace-serials-modal');
  const sub = document.getElementById('trace-serials-modal-sub');
  const filterInput = document.getElementById('trace-modal-serial-filter');
  if (filterInput) filterInput.value = '';
  if (sub && _currentTracedBox) {
    const isPartial = _currentTracedBox.completedCount < _currentTracedBox.batchSize;
    const shortCount = _currentTracedBox.batchSize - _currentTracedBox.completedCount;
    const statusNote = isPartial
      ? ` &bull; <span style="color: #b45309; font-weight: 700;">Partial Box (${shortCount} short of ${_currentTracedBox.batchSize})</span>`
      : ' &bull; <span style="color: #15803d; font-weight: 700;">Full Standard Box</span>';
    sub.innerHTML = `Box #${_currentTracedBox.batchNumber} &bull; Model ${_currentTracedBox.modelName || _currentTracedBox.modelId} &bull; ${_currentTracedSerials.length} Serialized Parts${statusNote}`;
  }
  renderModalSerials(_currentTracedSerials);
  if (modal) modal.style.display = 'flex';
}

function closeSerialsModal() {
  const modal = document.getElementById('trace-serials-modal');
  if (modal) modal.style.display = 'none';
}

function filterModalSerials(query) {
  const q = (query || '').toLowerCase().trim();
  const filtered = _currentTracedSerials.filter(s => s.toLowerCase().includes(q));
  renderModalSerials(filtered);
}

function renderModalSerials(serials) {
  const grid = document.getElementById('trace-modal-serials-grid');
  if (!grid) return;
  if (serials.length === 0) {
    grid.innerHTML = '<div style="padding: 18px; color: var(--text-muted); font-size: 11px; text-align: center; grid-column: 1 / -1;">No matching serial numbers found.</div>';
    return;
  }
  grid.innerHTML = serials.map(s => `<div class="trace-serial-chip">${s}</div>`).join('');
}

window.executeTrace = executeTrace;
window.traceSpecificBox = traceSpecificBox;
window.openSerialsModal = openSerialsModal;
window.closeSerialsModal = closeSerialsModal;
window.filterModalSerials = filterModalSerials;

// ============================================================================
// VIEW 5: DISPATCH REPORTS & ANALYTICS
// ============================================================================
let _repCurrentPage = 1;
let _repTotalPages = 1;
let _repLimit = 15;

async function loadReportsView() {
  // Populate model dropdown if empty
  const modelSelect = document.getElementById('rep-filter-model');
  if (modelSelect && modelSelect.children.length <= 1) {
    try {
      const modelsRes = await api.getModels();
      if (modelsRes && modelsRes.models) {
        modelsRes.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.modelId;
          opt.textContent = m.modelName || m.modelId;
          modelSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('Failed to load models list for reports filter:', err);
    }
  }

  // Attach custom SCADA dropdown & datepickers
  if (window.scadaDropdown && modelSelect) {
    window.scadaDropdown.attach(modelSelect).sync();
  }

  const dateFromEl = document.getElementById('rep-filter-date-from');
  const dateToEl = document.getElementById('rep-filter-date-to');
  if (window.scadaDatePicker) {
    if (dateFromEl) window.scadaDatePicker.attach(dateFromEl, { placeholder: 'YYYY-MM-DD' });
    if (dateToEl) window.scadaDatePicker.attach(dateToEl, { placeholder: 'YYYY-MM-DD' });
  }

  // Default to current month if dates not already set
  if (dateFromEl && !dateFromEl.value) {
    const now = new Date();
    const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    if (dateFromEl._scadaDatePicker) dateFromEl._scadaDatePicker.setDate(firstDay);
    else dateFromEl.value = firstDay;
  }
  if (dateToEl && !dateToEl.value) {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    if (dateToEl._scadaDatePicker) dateToEl._scadaDatePicker.setDate(lastDayStr);
    else dateToEl.value = lastDayStr;
  }

  // Load everything filtered
  await applyReportsFilter(1);
}

function resetReportsFilter() {
  if (window.sounds) window.sounds.playClick();
  const dateFrom = document.getElementById('rep-filter-date-from');
  const dateTo = document.getElementById('rep-filter-date-to');
  const modelEl = document.getElementById('rep-filter-model');
  const statusEl = document.getElementById('rep-filter-status');

  // Reset to current month defaults
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  if (dateFrom) {
    if (dateFrom._scadaDatePicker) dateFrom._scadaDatePicker.setDate(firstDay);
    else dateFrom.value = firstDay;
  }
  if (dateTo) {
    if (dateTo._scadaDatePicker) dateTo._scadaDatePicker.setDate(lastDayStr);
    else dateTo.value = lastDayStr;
  }
  if (modelEl) {
    modelEl.value = 'ALL';
    if (modelEl._scadaDropdown) modelEl._scadaDropdown.sync();
  }
  if (statusEl) {
    statusEl.value = 'ALL';
    if (statusEl._scadaDropdown) statusEl._scadaDropdown.sync();
  }
  applyReportsFilter(1);
}

function changeReportsPage(delta) {
  if (window.sounds) window.sounds.playClick();
  const newPage = _repCurrentPage + delta;
  if (newPage >= 1 && newPage <= _repTotalPages) {
    applyReportsFilter(newPage);
  }
}

async function applyReportsFilter(page = 1) {
  if (window.sounds) window.sounds.playClick();
  _repCurrentPage = page;
  const dateFromEl = document.getElementById('rep-filter-date-from');
  const dateToEl = document.getElementById('rep-filter-date-to');
  const modelEl = document.getElementById('rep-filter-model');
  const statusEl = document.getElementById('rep-filter-status');

  const dateFrom = dateFromEl ? dateFromEl.value : '';
  const dateTo = dateToEl ? dateToEl.value : '';
  const modelId = modelEl ? modelEl.value : 'ALL';
  const status = statusEl ? statusEl.value : 'ALL';

  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 24px;"><i class="ri-loader-4-line scada-spin" style="font-size: 16px; display: inline-block; vertical-align: middle; margin-right: 6px;"></i> Loading dispatch transactions...</td></tr>';

  // Build shared filter params
  const filterParams = {};
  if (dateFrom) filterParams.dateFrom = dateFrom;
  if (dateTo) filterParams.dateTo = dateTo;
  if (modelId && modelId !== 'ALL') filterParams.modelId = modelId;
  if (status && status !== 'ALL') filterParams.status = status;

  // Fetch stats/charts and history table in parallel
  const [statsRes] = await Promise.allSettled([
    api.getFilteredReports({ dateFrom, dateTo, modelId })
  ]);

  // Update stats tiles and charts from filtered data
  if (statsRes.status === 'fulfilled' && statsRes.value) {
    const monthlyRes = statsRes.value;
    const repMonth = document.getElementById('rep-month-name');
    if (repMonth && monthlyRes.metrics) repMonth.textContent = (monthlyRes.metrics.monthName || 'FILTERED').toUpperCase();

    const repBoxes = document.getElementById('rep-boxes-month');
    if (repBoxes && monthlyRes.metrics) repBoxes.textContent = monthlyRes.metrics.dispatchedThisMonthBoxes || 0;

    const repParts = document.getElementById('rep-parts-month');
    if (repParts && monthlyRes.metrics) repParts.textContent = (monthlyRes.metrics.dispatchedThisMonthParts || 0).toLocaleString();

    const repTxs = document.getElementById('rep-txs-month');
    if (repTxs && monthlyRes.metrics) repTxs.textContent = (monthlyRes.metrics.dispatchedThisMonthTxs || 0).toLocaleString();

    const repRej = document.getElementById('rep-rejected-month');
    if (repRej && monthlyRes.metrics) repRej.textContent = monthlyRes.metrics.rejectedThisMonthBoxes || 0;

    if (typeof Chart !== 'undefined' && monthlyRes.charts) {
      renderDailyChart(monthlyRes.charts.daily);
      renderModelChart(monthlyRes.charts.models);
    }
  }

  try {
    const params = { page: _repCurrentPage, limit: _repLimit, ...filterParams };
    const res = await api.getDispatchHistory(params);
    tbody.innerHTML = '';

    const totalChip = document.getElementById('rep-total-chip');
    const pageInfo = document.getElementById('reports-pagination-info');
    const pageDisplay = document.getElementById('reports-page-display');
    const btnPrev = document.getElementById('btn-rep-prev');
    const btnNext = document.getElementById('btn-rep-next');

    const totalTxs = (res && res.total) || 0;
    _repTotalPages = (res && res.pages) || 1;

    if (totalChip) totalChip.textContent = `${totalTxs} DISPATCHES`;
    if (pageInfo) {
      const start = totalTxs === 0 ? 0 : (_repCurrentPage - 1) * _repLimit + 1;
      const end = Math.min(_repCurrentPage * _repLimit, totalTxs);
      pageInfo.textContent = `Showing ${start} - ${end} of ${totalTxs} dispatches`;
    }
    if (pageDisplay) pageDisplay.textContent = `PAGE ${_repCurrentPage} / ${_repTotalPages || 1}`;
    if (btnPrev) btnPrev.disabled = _repCurrentPage <= 1;
    if (btnNext) btnNext.disabled = _repCurrentPage >= _repTotalPages;

    if (!res || !res.transactions || res.transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 32px;"><i class="ri-inbox-line" style="font-size: 24px; display: block; margin-bottom: 6px; color: #94a3b8;"></i> No dispatch transactions found matching filter criteria.</td></tr>';
      return;
    }

    res.transactions.forEach(tx => {
      const tr = document.createElement('tr');
      const allocatedCount = (tx.allocatedBoxes && tx.allocatedBoxes.length) || 0;
      const scannedCount = (tx.scannedBoxes && tx.scannedBoxes.length) || 0;
      const partCount = tx.dispatchedPartCount || 0;
      const dateObj = tx.completedAt || tx.cancelledAt || tx.startedAt || tx.createdAt;
      const timeStr = dateObj ? new Date(dateObj).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';

      // Status Badge
      let statusBadge = '';
      if (tx.status === 'completed') {
        statusBadge = '<span class="badge badge-success" style="font-size: 9.5px; padding: 2px 7px; font-weight: 700;">COMPLETED</span>';
      } else if (tx.status === 'cancelled') {
        statusBadge = `<span class="badge badge-danger" style="font-size: 9.5px; padding: 2px 7px; font-weight: 700;" title="${tx.cancellationReason || 'Cancelled'}">CANCELLED</span>`;
      } else if (tx.status === 'stale') {
        statusBadge = `<span class="badge" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-size: 9.5px; padding: 2px 7px; font-weight: 700;" title="${tx.cancellationReason || 'Aborted / Stale'}">FAILED / STALE</span>`;
      } else {
        statusBadge = `<span class="badge" style="font-size: 9.5px; padding: 2px 7px;">${(tx.status || '').toUpperCase()}</span>`;
      }

      // Progress display
      let progressDisplay = '';
      if (tx.status === 'completed') {
        progressDisplay = `${allocatedCount} Boxes`;
      } else {
        progressDisplay = `<span style="font-family: var(--font-mono); font-size: 11px;">${scannedCount} / ${allocatedCount} Scanned</span>`;
      }

      // Parts display
      const partsDisplay = tx.status === 'completed'
        ? `<strong>${partCount.toLocaleString()} Parts</strong>`
        : `<span style="color: var(--text-secondary); font-size: 11px;">${partCount} Target Parts</span>`;

      // Actions Column
      let actionsHtml = '';
      if (tx.status === 'completed') {
        actionsHtml = `
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="btn-scada btn-secondary" style="padding: 2px 8px; font-size: 10.5px; height: 26px;" onclick="showDispatchDetails('${tx.dispatchId}')" title="View Transaction Details & Remarks">
              <i class="ri-information-line"></i> DETAILS
            </button>
            <button class="btn-scada btn-secondary" style="padding: 2px 8px; font-size: 10.5px; height: 26px;" onclick="openDispatchBill('${tx.dispatchId}')" title="View Dispatch Manifest & Advice Note">
              <i class="ri-file-text-line"></i> MANIFEST
            </button>
          </div>
        `;
      } else {
        // Unsuccessful transactions (cancelled or stale/aborted) cannot have a manifest
        actionsHtml = `
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="btn-scada btn-secondary" style="padding: 2px 8px; font-size: 10.5px; height: 26px;" onclick="showDispatchDetails('${tx.dispatchId}')" title="View Reason & Audit Details">
              <i class="ri-information-line"></i> DETAILS
            </button>
          </div>
        `;
      }

      tr.innerHTML = `
        <td>
          <span class="copyable-dispatch-id" onclick="copyToClipboard('${tx.dispatchId}', this)" title="Click to copy Dispatch ID ${tx.dispatchId}">
            <strong style="color: var(--color-primary); font-family: var(--font-mono);">${tx.dispatchId}</strong>
            <i class="ri-file-copy-line" style="font-size: 11px; opacity: 0.6; color: var(--color-primary);"></i>
          </span>
        </td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${timeStr}</td>
        <td>${statusBadge}</td>
        <td><strong>${tx.modelName || tx.modelId}</strong></td>
        <td>${progressDisplay}</td>
        <td>${partsDisplay}</td>
        <td style="color: var(--text-secondary);">${tx.operatorFullName || tx.operatorUsername || '--'}</td>
        <td style="text-align: right;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load dispatch history:', err.message);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #dc2626; padding: 24px;">Failed to load transactions: ${err.message}</td></tr>`;
  }
}

async function showDispatchDetails(dispatchId) {
  if (window.sounds) window.sounds.playClick();
  try {
    const res = await api.getDispatchBill(dispatchId);
    if (!res || !res.bill) throw new Error('Transaction details not found');
    const b = res.bill;
    const isCompleted = b.status === 'completed';
    const isCancelled = b.status === 'cancelled';
    const openedAt = b.startedAt ? new Date(b.startedAt).toLocaleString() : 'N/A';
    const endedAt = b.completedAt ? new Date(b.completedAt).toLocaleString() : (b.cancelledAt ? new Date(b.cancelledAt).toLocaleString() : 'N/A');
    const scannedCount = (b.scannedBoxes && b.scannedBoxes.length) || 0;
    const totalBoxes = b.totalBoxes || (b.boxes && b.boxes.length) || 0;

    const iconWrap = document.getElementById('modal-dtl-icon-wrap');
    const iconEl = document.getElementById('modal-dtl-icon');
    const titleEl = document.getElementById('modal-dtl-title');
    const subtitleEl = document.getElementById('modal-dtl-subtitle');
    const contextEl = document.getElementById('modal-dtl-context');
    const contextIconEl = document.getElementById('modal-dtl-context-icon');
    const dspIdEl = document.getElementById('modal-dtl-dispatch-id');
    const badgeEl = document.getElementById('modal-dtl-status-badge');
    const reasonLabelEl = document.getElementById('modal-dtl-reason-label');
    const reasonEl = document.getElementById('modal-dtl-reason');
    const termLabelEl = document.getElementById('modal-dtl-term-label');
    const modelEl = document.getElementById('modal-dtl-model');
    const operatorEl = document.getElementById('modal-dtl-operator');
    const openedEl = document.getElementById('modal-dtl-opened');
    const terminatedEl = document.getElementById('modal-dtl-terminated');
    const progressEl = document.getElementById('modal-dtl-progress');
    const partsEl = document.getElementById('modal-dtl-parts');
    const btnManifest = document.getElementById('modal-dtl-btn-manifest');

    if (dspIdEl) {
      dspIdEl.textContent = b.dispatchId || dispatchId;
    }
    if (modelEl) {
      modelEl.textContent = b.modelName || b.modelId || '--';
    }
    if (operatorEl) {
      operatorEl.textContent = b.operatorFullName || b.operatorUsername || '--';
    }
    if (openedEl) {
      openedEl.textContent = openedAt;
    }
    if (terminatedEl) {
      terminatedEl.textContent = endedAt;
    }
    if (progressEl) {
      progressEl.textContent = `${scannedCount} of ${totalBoxes} Verified`;
    }
    if (partsEl) {
      partsEl.textContent = `${(b.totalParts || 0).toLocaleString()} Parts`;
    }

    if (isCompleted) {
      // SUCCESSFUL / COMPLETED DISPATCH
      if (iconWrap) iconWrap.className = 'custom-modal-icon-wrap icon-success';
      if (iconEl) iconEl.className = 'ri-checkbox-circle-line';
      if (titleEl) titleEl.textContent = 'DISPATCH TRANSACTION DETAILS';
      if (subtitleEl) subtitleEl.innerHTML = 'Completed Successfully &bull; Outbound Dispatch Ledger';
      if (contextEl) contextEl.style.borderLeftColor = 'var(--color-success)';
      if (contextIconEl) contextIconEl.style.color = 'var(--color-success)';
      if (badgeEl) {
        badgeEl.className = 'badge badge-success';
        badgeEl.textContent = 'COMPLETED';
      }
      if (reasonLabelEl) {
        reasonLabelEl.innerHTML = '<i class="ri-chat-check-line"></i> DISPATCH COMPLETION NOTES / REMARKS';
      }
      if (reasonEl) {
        if (b.notes && b.notes.trim()) {
          reasonEl.textContent = `“${b.notes.trim()}”`;
          reasonEl.style.color = '#0f172a';
        } else {
          reasonEl.innerHTML = '<span style="color: var(--text-secondary); font-style: italic; font-weight: normal;">No additional notes recorded on completion.</span>';
          reasonEl.style.color = 'var(--text-secondary)';
        }
      }
      if (termLabelEl) termLabelEl.textContent = 'COMPLETED AT';

      // Successful modals CAN have manifest
      if (btnManifest) {
        btnManifest.style.display = 'inline-flex';
        btnManifest.onclick = () => {
          closeModals();
          if (typeof openDispatchBill === 'function') {
            openDispatchBill(b.dispatchId || dispatchId);
          }
        };
      }
    } else {
      // UNSUCCESSFUL DISPATCH (Cancelled or Aborted / Stale)
      if (isCancelled) {
        if (iconWrap) iconWrap.className = 'custom-modal-icon-wrap icon-danger';
        if (iconEl) iconEl.className = 'ri-close-circle-line';
        if (titleEl) titleEl.textContent = 'DISPATCH TRANSACTION AUDIT';
        if (subtitleEl) subtitleEl.innerHTML = 'Cancelled by Operator &bull; Shop-Floor Governance Ledger';
        if (contextEl) contextEl.style.borderLeftColor = 'var(--color-danger)';
        if (contextIconEl) contextIconEl.style.color = 'var(--color-danger)';
        if (badgeEl) {
          badgeEl.className = 'badge badge-danger';
          badgeEl.textContent = 'CANCELLED';
        }
        if (reasonLabelEl) {
          reasonLabelEl.innerHTML = '<i class="ri-information-line"></i> REASON FOR CANCELLATION / ABORT';
        }
        if (reasonEl) {
          const reasonText = b.cancellationReason || 'Operator cancelled session';
          reasonEl.textContent = `“${reasonText}”`;
          reasonEl.style.color = '#b91c1c';
        }
      } else {
        // Stale / Aborted
        if (iconWrap) iconWrap.className = 'custom-modal-icon-wrap icon-warning';
        if (iconEl) iconEl.className = 'ri-error-warning-line';
        if (titleEl) titleEl.textContent = 'DISPATCH TRANSACTION AUDIT';
        if (subtitleEl) subtitleEl.innerHTML = 'Aborted / Stale Session &bull; Shop-Floor Governance Ledger';
        if (contextEl) contextEl.style.borderLeftColor = 'var(--color-warning)';
        if (contextIconEl) contextIconEl.style.color = 'var(--color-warning)';
        if (badgeEl) {
          badgeEl.className = 'badge badge-hold';
          badgeEl.textContent = (b.status || 'STALE').toUpperCase();
        }
        if (reasonLabelEl) {
          reasonLabelEl.innerHTML = '<i class="ri-information-line"></i> REASON FOR CANCELLATION / ABORT';
        }
        if (reasonEl) {
          const reasonText = b.cancellationReason || 'Application closed or restarted before transaction was completed';
          reasonEl.textContent = `“${reasonText}”`;
          reasonEl.style.color = '#b45309';
        }
      }
      if (termLabelEl) termLabelEl.textContent = 'TERMINATED AT';

      // Unsuccessful modals CANNOT have manifest
      if (btnManifest) {
        btnManifest.style.display = 'none';
      }
    }

    openModal('modal-dispatch-details');
  } catch (err) {
    console.error('Failed to load transaction details:', err);
    if (window.customModal) {
      customModal.alert('Could not load transaction details: ' + err.message, { title: 'ERROR', type: 'danger' });
    }
  }
}
window.showDispatchDetails = showDispatchDetails;
window.showAbortedDispatchDetails = showDispatchDetails;


async function exportInventoryCsv() {
  if (window.sounds) window.sounds.playClick();
  try {
    const modelEl = document.getElementById('inv-filter-model');
    const statusEl = document.getElementById('inv-filter-status');
    const dateFromEl = document.getElementById('inv-filter-date-from');
    const dateToEl = document.getElementById('inv-filter-date-to');
    const searchEl = document.getElementById('inv-filter-search');

    const params = new URLSearchParams();
    const modelId = modelEl ? modelEl.value : 'ALL';
    const status = statusEl ? statusEl.value : 'ALL';
    const dateFrom = dateFromEl ? dateFromEl.value : '';
    const dateTo = dateToEl ? dateToEl.value : '';
    const search = searchEl ? searchEl.value.trim() : '';

    if (modelId && modelId !== 'ALL') params.append('modelId', modelId);
    if (status && status !== 'ALL') params.append('status', status);
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    if (search) params.append('search', search);

    const qs = params.toString();
    const url = `/api/boxes/export-csv${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${api.token}` } });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `box_inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
    sounds.playSuccess();
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('CSV Export failed: ' + err.message, { title: 'EXPORT ERROR', type: 'danger' });
  }
}
window.exportInventoryCsv = exportInventoryCsv;

// ============================================================================
// CLIPBOARD & CHART VISUALIZATION MODES
// ============================================================================
async function copyToClipboard(text, el) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (el) {
      const originalHtml = el.innerHTML;
      el.innerHTML = `<span style="color: #059669; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><i class="ri-check-line" style="font-size: 12px;"></i> COPIED!</span>`;
      setTimeout(() => {
        el.innerHTML = originalHtml;
      }, 1300);
    }
    if (window.sounds) window.sounds.playSuccess();
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
}
window.copyToClipboard = copyToClipboard;

let _chartVizMode = 'boxes'; // 'boxes' | 'parts'
let _cachedDailyChartData = null;
let _cachedModelChartData = null;

function setChartMode(mode) {
  _chartVizMode = mode;
  document.querySelectorAll('.rep-viz-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });
  if (window.sounds) window.sounds.playClick();
  if (_cachedDailyChartData) renderDailyChart(_cachedDailyChartData);
  if (_cachedModelChartData) renderModelChart(_cachedModelChartData);
}
window.setChartMode = setChartMode;

function renderDailyChart(chartData) {
  const ctx = document.getElementById('chart-daily-volume');
  if (!ctx || !chartData) return;
  _cachedDailyChartData = chartData;
  if (dailyChart) dailyChart.destroy();

  const isMonthly = !!chartData.isMonthly;
  const titleEl = document.getElementById('rep-volume-title');
  if (titleEl) titleEl.textContent = isMonthly ? 'MONTHLY DISPATCH VOLUME' : 'DAILY DISPATCH VOLUME';

  const isParts = _chartVizMode === 'parts';
  const dataVals = isParts
    ? (chartData.dataParts || chartData.data || [])
    : (chartData.dataBoxes || chartData.data || []);
  const label = isParts ? 'Parts Dispatched' : 'Boxes Dispatched';
  const strokeColor = isParts ? '#059669' : '#0284c7';
  const fillColor = isParts ? 'rgba(5, 150, 105, 0.12)' : 'rgba(2, 132, 199, 0.12)';

  const chartType = isMonthly ? 'bar' : 'line';
  const datasetConfig = isMonthly
    ? {
      label,
      data: dataVals,
      backgroundColor: strokeColor,
      borderRadius: 4,
      maxBarThickness: 38
    }
    : {
      label,
      data: dataVals,
      borderColor: strokeColor,
      backgroundColor: fillColor,
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: (chartData.labels && chartData.labels.length > 25) ? 2 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: strokeColor
    };

  dailyChart = new Chart(ctx, {
    type: chartType,
    data: {
      labels: chartData.labels || [],
      datasets: [datasetConfig]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toLocaleString()} ${isParts ? 'Parts' : 'Boxes'}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9' },
          ticks: {
            color: '#64748b',
            font: { family: "'Inter', sans-serif", size: 10 },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: isMonthly ? 12 : 20
          }
        },
        y: {
          grid: { color: '#e2e8f0' },
          ticks: {
            color: '#64748b',
            font: { family: "'Inter', sans-serif", size: 10 },
            precision: 0
          },
          beginAtZero: true
        }
      }
    }
  });
}

function renderModelChart(chartData) {
  const ctx = document.getElementById('chart-model-dist');
  if (!ctx || !chartData) return;
  _cachedModelChartData = chartData;
  if (modelChart) modelChart.destroy();

  const isParts = _chartVizMode === 'parts';
  const dataVals = isParts
    ? (chartData.dataParts || chartData.data || [])
    : (chartData.dataBoxes || chartData.data || []);

  modelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartData.labels || [],
      datasets: [{
        data: dataVals,
        backgroundColor: [
          '#0284c7', // 1. Sky Blue
          '#059669', // 2. Emerald Green
          '#d97706', // 3. Amber Gold
          '#6366f1', // 4. Indigo Purple
          '#ef4444', // 5. Crimson Red
          '#0d9488', // 6. Deep Teal
          '#8b5cf6', // 7. Electric Violet
          '#f43f5e', // 8. Warm Rose
          '#06b6d4', // 9. Azure Cyan
          '#84cc16', // 10. Spring Lime
          '#f97316', // 11. Vivid Tangerine
          '#64748b'  // 12. Steel Slate
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#334155',
            font: { family: "'Inter', sans-serif", size: 11 },
            boxWidth: 12,
            padding: 8
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} ${isParts ? 'Parts' : 'Boxes'}`
          }
        }
      }
    }
  });
}

async function exportCsvReport() {
  try {
    const dateFrom = document.getElementById('rep-filter-date-from')?.value || '';
    const dateTo = document.getElementById('rep-filter-date-to')?.value || '';
    const modelId = document.getElementById('rep-filter-model')?.value || 'ALL';
    const status = document.getElementById('rep-filter-status')?.value || 'ALL';

    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    if (modelId && modelId !== 'ALL') params.append('modelId', modelId);
    if (status && status !== 'ALL') params.append('status', status);

    const qs = params.toString();
    const url = `/api/reports/export-csv${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status} Unauthorized/Error`);
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `dispatch_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
    sounds.playSuccess();
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('CSV Export failed: ' + err.message, { title: 'EXPORT ERROR', type: 'danger' });
  }
}

// ============================================================================
// DETAILED DISPATCH BILL / DELIVERY CHALLAN VIEW & PDF PRINT
// ============================================================================
// ─── MANIFEST SHARED STYLES ──────────────────────────────────────────────────
const MANIFEST_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#0f172a;font-size:9pt;line-height:1.5;}
  .doc-wrap{max-width:794px;margin:0 auto;padding:32px 36px 40px;}
  /* Header band */
  .doc-header-band{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:18px 28px;display:flex;justify-content:space-between;align-items:center;border-radius:4px 4px 0 0;}
  .doc-header-title{color:#fff;}
  .doc-header-title h1{font-size:16pt;font-weight:800;letter-spacing:0.5px;margin-bottom:2px;}
  .doc-header-title .doc-id{font-size:10pt;font-weight:600;color:#7dd3fc;letter-spacing:0.5px;font-family:monospace;}
  .doc-header-logo{height:42px;max-width:160px;object-fit:contain;}
  /* Status bar */
  .doc-status-bar{padding:6px 28px;font-size:8pt;font-weight:700;letter-spacing:1.5px;display:flex;align-items:center;gap:8px;}
  .doc-status-bar.completed{background:#022c22;color:#6ee7b7;}
  .doc-status-bar.in-progress{background:#431407;color:#fdba74;}
  .doc-status-dot{width:6px;height:6px;border-radius:50%;display:inline-block;}
  .doc-status-bar.completed .doc-status-dot{background:#10b981;}
  .doc-status-bar.in-progress .doc-status-dot{background:#f97316;animation:pulse-dot 1s ease-in-out infinite alternate;}
  @keyframes pulse-dot{from{opacity:0.4}to{opacity:1}}
  /* Meta grid */
  .doc-meta{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;margin-bottom:24px;}
  .doc-meta-col{padding:14px 20px;}
  .doc-meta-col:first-child{border-right:1px solid #e2e8f0;}
  .doc-meta-row{display:flex;gap:6px;padding:3px 0;font-size:9pt;}
  .doc-meta-label{color:#64748b;font-weight:600;min-width:105px;flex-shrink:0;}
  .doc-meta-value{color:#0f172a;font-weight:500;word-break:break-word;min-width:0;}
  .doc-meta-value.highlight{color:#0284c7;font-weight:700;}
  /* Section heading */
  .doc-section-heading{font-size:9pt;font-weight:800;letter-spacing:1.5px;color:#334155;text-transform:uppercase;border-bottom:2px solid #0284c7;padding-bottom:5px;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
  .doc-section-heading::before{content:'';display:inline-block;width:4px;height:14px;background:#0284c7;border-radius:2px;}
  /* Box table */
  .doc-table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:24px;}
  .doc-table thead tr{background:#0f172a;color:#fff;}
  .doc-table th{padding:8px 10px;font-weight:700;letter-spacing:0.5px;font-size:8pt;text-transform:uppercase;}
  .doc-table th:first-child{border-radius:0;}
  .doc-table td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle;}
  .doc-table tr:nth-child(even) td{background:#f8fafc;}
  .doc-table tr.serial-row td{background:#f1f5f9;padding:6px 14px;}
  .doc-table .box-id{color:#0284c7;font-weight:700;font-family:monospace;}
  .doc-table .parts-val{font-weight:700;text-align:center;}
  .doc-table .status-cell{text-align:center;}
  .badge-verified{display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 9px;border-radius:20px;font-size:7.5pt;font-weight:700;letter-spacing:0.5px;}
  .badge-pending{display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#b45309;border:1px solid #fcd34d;padding:2px 9px;border-radius:20px;font-size:7.5pt;font-weight:700;letter-spacing:0.5px;}
  /* Serials */
  .serial-grid{display:flex;flex-wrap:wrap;gap:3px;}
  .serial-chip{background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:3px;font-size:7.5pt;font-family:monospace;color:#334155;}
  /* Signatures */
  .doc-signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:40px;padding-top:30px;border-top:1px solid #e2e8f0;}
  .doc-sig-block{text-align:center;}
  .doc-sig-line{height:1px;background:#0f172a;margin-bottom:6px;}
  .doc-sig-label{font-size:8pt;font-weight:700;color:#334155;letter-spacing:0.5px;text-transform:uppercase;}
  .doc-sig-name{font-size:8pt;color:#64748b;margin-top:2px;}
  /* Footer */
  .doc-footer{margin-top:24px;padding-top:12px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;font-size:7.5pt;color:#94a3b8;}
  @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact;}button{display:none!important;}}
`;

/**
 * Builds premium enterprise manifest HTML (both completed and pending share this).
 * @param {object} opts
 */
function buildManifestHTML({ title, docId, status, isCompleted, meta, boxes, includeSerials, operatorName, logoDataUrl }) {
  const logoSrc = logoDataUrl || '';

  const fmtDate = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';

  const statusBarClass = isCompleted ? 'completed' : 'in-progress';
  const statusText = isCompleted ? 'VERIFIED & DISPATCHED' : 'SCANNING IN PROGRESS — DRAFT';

  const tableRows = boxes.map((b, idx) => {
    const verified = b.verified !== false; // default to true for completed
    const badge = (isCompleted || verified)
      ? `<span class="badge-verified">&#10003; VERIFIED</span>`
      : `<span class="badge-pending">&#9679; PENDING SCAN</span>`;
    const rowBg = (!isCompleted && !verified) ? '' : '';

    let serialRow = '';
    if (includeSerials && b.serialNumbers && b.serialNumbers.length > 0) {
      const chips = b.serialNumbers.map(s => `<span class="serial-chip">${s}</span>`).join('');
      serialRow = `<tr class="serial-row"><td colspan="5"><div class="serial-grid">${chips}</div></td></tr>`;
    }

    const dateStr = b.closedAt ? new Date(b.closedAt).toISOString().slice(0, 16).replace('T', ' ') : '--';
    const sticker = getBoxStickerInfo(b);

    return `
      <tr>
        <td style="color:#64748b;font-weight:600;">${idx + 1}</td>
        <td class="box-id">
          <div style="font-weight:700;color:#0f172a;">${sticker.shiftBatchCode}</div>
          <div style="font-size:7.5pt;color:#64748b;font-weight:600;">Date: ${sticker.batchDate} | Part: ${sticker.customerPartNo}</div>
        </td>
        <td>${dateStr}</td>
        <td class="parts-val">${b.completedCount} PCS</td>
        <td class="status-cell">${badge}</td>
      </tr>
      ${serialRow}`;
  }).join('');

  const metaRows = meta.map(([label, value, hl]) =>
    `<div class="doc-meta-row"><span class="doc-meta-label">${label}</span><span class="doc-meta-value${hl ? ' highlight' : ''}">${value}</span></div>`
  ).join('');

  const [col1Meta, col2Meta] = [meta.slice(0, Math.ceil(meta.length / 2)), meta.slice(Math.ceil(meta.length / 2))];

  const col1Html = col1Meta.map(([label, value, hl]) =>
    `<div class="doc-meta-row"><span class="doc-meta-label">${label}</span><span class="doc-meta-value${hl ? ' highlight' : ''}">${value}</span></div>`
  ).join('');

  const col2Html = col2Meta.map(([label, value, hl]) =>
    `<div class="doc-meta-row"><span class="doc-meta-label">${label}</span><span class="doc-meta-value${hl ? ' highlight' : ''}">${value}</span></div>`
  ).join('');

  const printedAt = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>${MANIFEST_CSS}</style>
</head>
<body>
<div class="doc-wrap">
  <div class="doc-header-band">
    <div class="doc-header-title">
      <h1>${title}</h1>
      <div class="doc-id">${docId}</div>
    </div>
    ${logoSrc ? `<img src="${logoSrc}" class="doc-header-logo" alt="Customer Logo">` : ''}
  </div>
  <div class="doc-status-bar ${statusBarClass}">
    <span class="doc-status-dot"></span>
    ${statusText}
  </div>
  <div class="doc-meta">
    <div class="doc-meta-col">${col1Html}</div>
    <div class="doc-meta-col">${col2Html}</div>
  </div>

  <div class="doc-section-heading">Box Allocation &amp; Verification Ledger</div>
  <table class="doc-table">
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>Box / Batch ID</th>
        <th>Produced At</th>
        <th style="text-align:center;">Parts (PCS)</th>
        <th style="text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div class="doc-signatures">
    <div class="doc-sig-block">
      <div class="doc-sig-line"></div>
      <div class="doc-sig-label">Prepared By (Operator)</div>
      <div class="doc-sig-name">${operatorName || ''}</div>
    </div>
    <div class="doc-sig-block">
      <div class="doc-sig-line"></div>
      <div class="doc-sig-label">Authorized By (Dispatch In-Charge)</div>
    </div>
  </div>

  <div class="doc-footer">
    <span>Document generated: ${printedAt}</span>
    <span>RecordKeeper Dispatch</span>
  </div>
</div>
</body>
</html>`;
}

/**
 * Fetch the customer logo as a base64 data URL so it embeds cleanly in
 * standalone HTML pages (about:blank new windows, Electron temp-file PDFs).
 */
async function fetchLogoDataUrl() {
  try {
    let resp = await fetch('/assets/logo-right.png').catch(() => null);
    if (!resp || !resp.ok) {
      const origin = (window.electronAPI?.isElectron)
        ? `http://127.0.0.1:${window.electronAPI?.serverPort || 4000}`
        : window.location.origin;
      resp = await fetch(`${origin}/assets/logo-right.png`).catch(() => null);
    }
    if (!resp || !resp.ok) return '';
    const blob = await resp.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/**
 * Export HTML to PDF. In Electron uses native IPC (no dialog).
 * In browser, opens a new tab with a print button.
 */
async function exportToPDF(html, filename) {
  if (window.electronAPI && typeof window.electronAPI.printToPDF === 'function') {
    try {
      await window.electronAPI.printToPDF(html, filename);
    } catch (err) {
      await customModal.alert('PDF export failed: ' + err.message, { title: 'PDF ERROR', type: 'danger' });
    }
  } else {
    // Web fallback — open in new tab with a print button
    const win = window.open('', '_blank', 'width=900,height=720');
    if (!win) { await customModal.alert('Popup blocked. Please allow popups for this site.', { title: 'POPUP BLOCKED', type: 'warning' }); return; }
    // Inject print button into the HTML
    const btnHtml = `<div style="position:fixed;top:12px;right:16px;z-index:9999;display:flex;gap:8px;">
      <button onclick="window.print()" style="background:#0284c7;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-weight:700;font-size:12px;cursor:pointer;">&#128438; Save as PDF</button>
      <button onclick="window.close()" style="background:#64748b;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-weight:700;font-size:12px;cursor:pointer;">&#10005;</button>
    </div>`;
    const withBtn = html.replace('</body>', btnHtml + '</body>');
    win.document.write(withBtn);
    win.document.close();
  }
}

// ─── COMPLETED DISPATCH MANIFEST ─────────────────────────────────────────────
async function openDispatchBill(dispatchId) {
  try {
    const res = await api.getDispatchBill(dispatchId);
    const bill = res.bill;

    document.getElementById('bill-dispatch-id').textContent = bill.dispatchId;
    document.getElementById('bill-date').textContent = new Date(bill.completedAt || bill.startedAt).toLocaleString();
    document.getElementById('bill-model-name').textContent = bill.modelName || bill.modelId;
    document.getElementById('bill-customer-part').textContent = bill.customerPartNo;
    document.getElementById('bill-internal-part').textContent = bill.internalPartId;
    document.getElementById('bill-operator').textContent = bill.operatorFullName || bill.operatorUsername;
    document.getElementById('bill-totals').textContent = `${bill.totalBoxes} Boxes / ${bill.totalParts} Total Parts`;

    // Reset serial toggle
    const toggle = document.getElementById('bill-serial-toggle');
    if (toggle) toggle.checked = false;

    // Store bill for later use by save PDF button
    window._currentBill = bill;

    // Render boxes table
    const container = document.getElementById('bill-boxes-container');
    container.innerHTML = '';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:9.5pt;';
    table.innerHTML = `
      <thead><tr style="background:#0f172a;color:#fff;">
        <th style="padding:7px 10px;text-align:left;font-size:8pt;letter-spacing:0.5px;width:40px;">#</th>
        <th style="padding:7px 10px;text-align:left;font-size:8pt;letter-spacing:0.5px;">BOX / BATCH</th>
        <th style="padding:7px 10px;text-align:left;font-size:8pt;letter-spacing:0.5px;">PRODUCED AT</th>
        <th style="padding:7px 10px;text-align:center;font-size:8pt;letter-spacing:0.5px;">PARTS</th>
        <th style="padding:7px 10px;text-align:center;font-size:8pt;letter-spacing:0.5px;">STATUS</th>
      </tr></thead>
      <tbody id="bill-boxes-tbody"></tbody>`;
    container.appendChild(table);

    const tbody = table.querySelector('#bill-boxes-tbody');
    bill.boxes.forEach((b, idx) => {
      const hasSerials = b.serialNumbers && b.serialNumbers.length > 0;
      const statusBadge = `<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 9px;border-radius:20px;font-size:7.5pt;font-weight:700;">&#10003; VERIFIED</span>`;
      const sticker = getBoxStickerInfo(b);

      const tr = document.createElement('tr');
      tr.style.background = idx % 2 === 1 ? '#f8fafc' : '';
      tr.innerHTML = `
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;font-weight:600;">${idx + 1}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">
          <div style="color:#0f172a;font-weight:700;font-family:monospace;">${sticker.shiftBatchCode}</div>
          <div style="font-size:7.5pt;color:#64748b;font-weight:600;">Date: ${sticker.batchDate} | Part: ${sticker.customerPartNo}</div>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">${new Date(b.closedAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:700;">${b.completedCount} PCS</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">${statusBadge}</td>`;
      tbody.appendChild(tr);

      if (hasSerials) {
        const serialTr = document.createElement('tr');
        serialTr.className = 'bill-serial-row';
        serialTr.style.cssText = 'display:none;background:#f8fafc;';
        const chips = b.serialNumbers.map(s =>
          `<span style="display:inline-block;background:#fff;border:1px solid #cbd5e1;padding:2px 6px;border-radius:3px;font-size:7.5pt;font-family:monospace;color:#334155;margin:2px;">${s}</span>`
        ).join('');
        serialTr.innerHTML = `<td colspan="5" style="padding:8px 14px;border-bottom:1px solid #f1f5f9;">${chips}</td>`;
        tbody.appendChild(serialTr);
      }
    });

    openModal('modal-dispatch-bill');
  } catch (err) {
    await customModal.alert('Failed to load bill: ' + err.message, { title: 'MANIFEST LOAD ERROR', type: 'danger' });
  }
}

function toggleManifestSerials() {
  const show = document.getElementById('bill-serial-toggle')?.checked;
  document.querySelectorAll('.bill-serial-row').forEach(row => {
    row.style.display = show ? 'table-row' : 'none';
  });
}

async function printDispatchBill() {
  const bill = window._currentBill;
  if (!bill) return;
  const includeSerials = document.getElementById('bill-serial-toggle')?.checked;
  const operatorName = bill.operatorFullName || bill.operatorUsername;

  const [logoDataUrl] = await Promise.all([fetchLogoDataUrl()]);

  const meta = [
    ['Dispatch Date:', new Date(bill.completedAt || bill.startedAt).toLocaleString()],
    ['Model / Product:', bill.modelName || bill.modelId],
    ['Customer Part No:', bill.customerPartNo],
    ['Internal Part ID:', bill.internalPartId],
    ['Dispatched By:', operatorName],
    ['Total Dispatched:', `${bill.totalBoxes} Boxes / ${bill.totalParts} Parts`, true],
  ];

  const html = buildManifestHTML({
    title: 'DISPATCH MANIFEST',
    docId: bill.dispatchId,
    status: bill.status,
    isCompleted: true,
    meta,
    boxes: bill.boxes.map(b => ({ ...b, verified: true })),
    includeSerials,
    operatorName,
    logoDataUrl
  });

  await exportToPDF(html, `Dispatch-Manifest-${bill.dispatchId}.pdf`);
}

// ─── PENDING DISPATCH MANIFEST ────────────────────────────────────────────────
async function printPendingManifest() {
  if (!activeTx || !activeTx.allocatedBoxes || activeTx.allocatedBoxes.length === 0) {
    await customModal.alert('No active dispatch session to print.', { title: 'NO ACTIVE SESSION', type: 'warning' });
    return;
  }

  const orderId = activeTx.dispatchId || '--';
  const model = activeTx.modelName || activeTx.modelId || '--';
  const operator = activeTx.operatorFullName || activeTx.operatorUsername || '--';
  const target = `${activeTx.targetQuantity} ${activeTx.targetType ? activeTx.targetType.toUpperCase() : 'BOXES'}`;

  const scannedBoxIds = (activeTx.scannedBoxes || []).map(s => s.boxId.toString());

  const boxes = activeTx.allocatedBoxes.map(box => {
    return {
      boxId: box.boxId,
      batchNumber: box.batchNumber,
      completedCount: box.completedCount,
      batchQrData: box.batchQrData,
      closedAt: box.closedAt,
      customerPartNo: box.customerPartNo || activeTx.customerPartNo || '',
      serialNumbers: box.serialNumbers || [],
      verified: scannedBoxIds.includes(box.boxId.toString())
    };
  });

  const meta = [
    ['Printed At:', new Date().toLocaleString()],
    ['Model:', model],
    ['Target Quantity:', target],
    ['Operator:', operator],
    ['Order Reference:', orderId],
    ['Status:', 'SCANNING IN PROGRESS — DRAFT', true],
  ];

  const logoDataUrl = await fetchLogoDataUrl();

  const html = buildManifestHTML({
    title: 'PENDING DISPATCH NOTE',
    docId: orderId,
    status: 'in_progress',
    isCompleted: false,
    meta,
    boxes,
    includeSerials: false,
    operatorName: operator,
    logoDataUrl
  });

  await exportToPDF(html, `Pending-Dispatch-Note-${orderId}.pdf`);
}


// ============================================================================
// VIEW 6: SYSTEM CONFIGURATION (ADMIN ONLY)
// ============================================================================
async function loadSystemView(showFeedback = false) {
  if (!api.currentUser || api.currentUser.role !== 'admin') {
    return;
  }

  const refreshBtn = document.getElementById('btn-refresh-telemetry');
  const refreshIcon = document.getElementById('icon-refresh-telemetry');
  if (refreshIcon) refreshIcon.classList.add('scada-spin');

  try {
    const statusRes = await api.getSystemStatus();
    const dbHostEl = document.getElementById('sys-db-host');
    const dbWatermarkEl = document.getElementById('sys-sync-watermark');
    const dbSyncedCountEl = document.getElementById('sys-synced-count');

    if (statusRes.database && statusRes.database.isConnected) {
      if (dbHostEl) {
        dbHostEl.style.color = 'var(--color-primary)';
        dbHostEl.textContent = `${statusRes.database.host} (${statusRes.database.name || 'default'})`;
      }
      if (dbWatermarkEl) {
        dbWatermarkEl.textContent = statusRes.sync && statusRes.sync.watermark ? new Date(statusRes.sync.watermark).toLocaleString() : 'Live (Initialized)';
      }
    } else {
      if (dbHostEl) {
        dbHostEl.style.color = '#ef4444';
        dbHostEl.textContent = 'OFFLINE / DISCONNECTED';
      }
      if (dbWatermarkEl) {
        dbWatermarkEl.textContent = 'Database offline';
      }
    }

    if (dbSyncedCountEl) {
      dbSyncedCountEl.textContent = (statusRes.sync && statusRes.sync.totalSyncedBoxes != null) ? statusRes.sync.totalSyncedBoxes : '0';
    }

    // Pre-fill builder fields with active database configuration if not user-edited
    const hostInput = document.getElementById('sys-db-builder-host');
    const portInput = document.getElementById('sys-db-builder-port');
    const nameInput = document.getElementById('sys-db-builder-name');
    if (statusRes.database) {
      if (hostInput && !hostInput.dataset.userEdited && statusRes.database.host) {
        hostInput.value = statusRes.database.host;
      }
      if (portInput && !portInput.dataset.userEdited && statusRes.database.port) {
        portInput.value = String(statusRes.database.port);
      }
      if (nameInput && !nameInput.dataset.userEdited && statusRes.database.name) {
        nameInput.value = statusRes.database.name;
      }
      updateComposedDbUri();
    }

    // Load COM ports and serial settings
    if (api.currentUser.role === 'admin') {
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
        if (document.getElementById('sys-com-delimiter') && statusRes.scanner.delimiter) {
          const delimEl = document.getElementById('sys-com-delimiter');
          const dVal = String(statusRes.scanner.delimiter);
          if (['CRLF', 'CR', 'LF', 'TAB'].includes(dVal)) {
            delimEl.value = dVal;
          } else if (dVal.includes('CRLF') || dVal === '\r\n') {
            delimEl.value = 'CRLF';
          } else if (dVal.includes('CR') || dVal === '\r') {
            delimEl.value = 'CR';
          } else if (dVal.includes('LF') || dVal === '\n') {
            delimEl.value = 'LF';
          } else if (dVal.includes('TAB') || dVal === '\t') {
            delimEl.value = 'TAB';
          }
        }
        const badge = document.getElementById('sys-com-status-badge');
        if (badge) {
          badge.className = statusRes.scanner.isConnected ? 'badge badge-available' : 'badge badge-hold';
          badge.textContent = statusRes.scanner.isConnected ? 'CONNECTED' : 'OFFLINE';
        }
      }

      // Convert all system selects into SCADA custom dropdowns
      if (window.scadaDropdown) {
        window.scadaDropdown.initAll();
        window.scadaDropdown.syncAll();
      }
    }

    // Load license
    loadLicenseInfo();

    // Load audit reasons
    loadAuditReasons();

    if (showFeedback && refreshBtn) {
      const origText = refreshBtn.innerHTML;
      refreshBtn.innerHTML = '<i class="ri-checkbox-circle-line" style="color: #059669;"></i> REFRESHED';
      setTimeout(() => { refreshBtn.innerHTML = origText; }, 1800);
    }
  } catch (err) {
    console.error('Failed to load system view:', err.message);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('scada-spin');
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

let _dbConfigMode = 'builder';

function setDbConfigMode(mode) {
  _dbConfigMode = mode;
  const btnBuilder = document.getElementById('btn-db-mode-builder');
  const btnRaw = document.getElementById('btn-db-mode-raw');
  const builderContainer = document.getElementById('sys-db-builder-container');
  const rawContainer = document.getElementById('sys-db-raw-container');

  if (mode === 'raw') {
    if (btnBuilder) btnBuilder.className = 'btn-scada btn-secondary';
    if (btnRaw) btnRaw.className = 'btn-scada btn-primary';
    if (builderContainer) builderContainer.style.display = 'none';
    if (rawContainer) rawContainer.style.display = 'block';
  } else {
    if (btnBuilder) btnBuilder.className = 'btn-scada btn-primary';
    if (btnRaw) btnRaw.className = 'btn-scada btn-secondary';
    if (builderContainer) builderContainer.style.display = 'block';
    if (rawContainer) rawContainer.style.display = 'none';
    updateComposedDbUri();
  }
}

function toggleDbAuthFields() {
  const authMode = document.getElementById('sys-db-builder-authmode')?.value || 'none';
  const authFields = document.getElementById('sys-db-auth-fields');
  if (authFields) {
    authFields.style.display = authMode === 'userpass' ? 'grid' : 'none';
  }
  updateComposedDbUri();
}

function updateComposedDbUri() {
  const host = (document.getElementById('sys-db-builder-host')?.value || '').trim() || 'localhost';
  const port = (document.getElementById('sys-db-builder-port')?.value || '').trim() || '27017';
  const dbName = (document.getElementById('sys-db-builder-name')?.value || '').trim();
  const authMode = document.getElementById('sys-db-builder-authmode')?.value || 'none';
  const previewEl = document.getElementById('sys-db-composed-preview');

  let previewUri = 'mongodb://';
  let realUri = 'mongodb://';

  if (authMode === 'userpass') {
    const user = (document.getElementById('sys-db-builder-user')?.value || '').trim();
    const pass = document.getElementById('sys-db-builder-pass')?.value || '';
    const authDb = (document.getElementById('sys-db-builder-authdb')?.value || '').trim() || 'admin';

    const displayUser = user || 'user';
    const displayPass = pass ? '••••••••' : 'pass';
    const authQuery = authDb ? `?authSource=${encodeURIComponent(authDb)}` : '';

    previewUri += `${encodeURIComponent(displayUser)}:${displayPass}@${host}:${port}/${encodeURIComponent(dbName || '<database>')}${authQuery}`;
    realUri += `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${encodeURIComponent(dbName)}${authQuery}`;
  } else {
    previewUri += `${host}:${port}/${encodeURIComponent(dbName || '<database>')}`;
    realUri += `${host}:${port}/${encodeURIComponent(dbName)}`;
  }

  if (previewEl) {
    previewEl.textContent = previewUri;
  }

  // Also sync to raw input
  const rawInput = document.getElementById('sys-db-uri-input');
  if (rawInput && _dbConfigMode === 'builder') {
    rawInput.value = realUri;
  }

  return { realUri, dbName, host, port, authMode };
}

function getEffectiveDbUri() {
  if (_dbConfigMode === 'raw') {
    const input = document.getElementById('sys-db-uri-input');
    const uri = input ? input.value.trim() : '';
    if (!uri) {
      return { error: 'Please enter a raw MongoDB connection URI.' };
    }
    return { uri };
  }

  // Builder mode:
  const host = (document.getElementById('sys-db-builder-host')?.value || '').trim();
  const port = (document.getElementById('sys-db-builder-port')?.value || '').trim();
  const dbName = (document.getElementById('sys-db-builder-name')?.value || '').trim();
  const authMode = document.getElementById('sys-db-builder-authmode')?.value || 'none';

  if (!host) {
    return { error: 'Host / IP address is required (e.g. localhost or 127.0.0.1).' };
  }
  if (!port) {
    return { error: 'Port is required (default 27017).' };
  }
  if (!dbName) {
    return { error: 'Database name is required.' };
  }

  let uri = 'mongodb://';
  if (authMode === 'userpass') {
    const user = (document.getElementById('sys-db-builder-user')?.value || '').trim();
    const pass = document.getElementById('sys-db-builder-pass')?.value || '';
    const authDb = (document.getElementById('sys-db-builder-authdb')?.value || '').trim() || 'admin';

    if (!user) {
      return { error: 'Username is required when authentication is enabled.' };
    }
    const authQuery = authDb ? `?authSource=${encodeURIComponent(authDb)}` : '';
    uri += `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${encodeURIComponent(dbName)}${authQuery}`;
  } else {
    uri += `${host}:${port}/${encodeURIComponent(dbName)}`;
  }

  return { uri };
}

async function testDatabaseConnection() {
  const resultBox = document.getElementById('sys-db-test-result');
  const uriData = getEffectiveDbUri();
  if (uriData.error) {
    return await customModal.alert(uriData.error, { title: 'INVALID CONFIGURATION', type: 'warning' });
  }
  const uri = uriData.uri;

  if (resultBox) {
    resultBox.textContent = 'Testing connection reachability & credentials...';
    resultBox.style.color = '#38bdf8';
  }

  try {
    const res = await api.testDatabase(uri);
    if (res.success) {
      sounds.playSuccess();
      if (resultBox) {
        resultBox.textContent = res.message;
        resultBox.style.color = '#059669';
      }
    } else {
      sounds.playViolation();
      if (resultBox) {
        resultBox.textContent = res.message;
        resultBox.style.color = '#ef4444';
      }
    }
  } catch (err) {
    sounds.playViolation();
    if (resultBox) {
      resultBox.textContent = 'Test failed: ' + err.message;
      resultBox.style.color = '#ef4444';
    }
  }
}

async function saveDatabaseConfig() {
  const uriData = getEffectiveDbUri();
  if (uriData.error) {
    return await customModal.alert(uriData.error, { title: 'INVALID CONFIGURATION', type: 'warning' });
  }
  const uri = uriData.uri;

  const ok = await customModal.confirm('Update persistent MongoDB connection URI and reconnect?', { title: 'RECONNECT DATABASE', danger: true });
  if (!ok) return;

  const resultBox = document.getElementById('sys-db-test-result');
  if (resultBox) {
    resultBox.textContent = 'Connecting and updating database...';
    resultBox.style.color = '#38bdf8';
  }

  try {
    const res = await api.saveDatabaseConfig(uri);
    sounds.playSuccess();
    if (resultBox) {
      resultBox.textContent = res.message;
      resultBox.style.color = '#059669';
    }
    const rawInput = document.getElementById('sys-db-uri-input');
    if (rawInput) rawInput.value = '';
    const passInput = document.getElementById('sys-db-builder-pass');
    if (passInput) passInput.value = '';
    updateComposedDbUri();
    await customModal.alert(res.message, { title: 'DATABASE CONNECTED', type: 'success' });
    loadSystemView(true);
  } catch (err) {
    sounds.playViolation();
    if (resultBox) {
      resultBox.textContent = 'Connection failed: ' + err.message;
      resultBox.style.color = '#ef4444';
    }
    await customModal.alert('Save & reconnect failed: ' + err.message, { title: 'DATABASE ERROR', type: 'danger' });
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

    if (window.scadaDropdown) {
      window.scadaDropdown.attach(portSelect).sync();
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
  const badge = document.getElementById('sys-com-status-badge');

  try {
    const res = await api.saveComConfig({ port, baudRate, dataBits, stopBits, parity, delimiter });
    if (res.success && res.isConnected) {
      sounds.playSuccess();
      if (msgEl) {
        msgEl.style.color = '#059669';
        msgEl.textContent = res.message;
      }
      if (badge) {
        badge.className = 'badge badge-available';
        badge.textContent = `CONNECTED // ${port}`;
      }
    } else {
      sounds.playViolation();
      if (msgEl) {
        msgEl.style.color = '#ef4444';
        msgEl.textContent = res.message || res.error || 'Port connection failed';
      }
      if (badge) {
        badge.className = 'badge badge-hold';
        badge.textContent = 'OFFLINE';
      }
    }
  } catch (err) {
    sounds.playViolation();
    if (msgEl) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = err.message || 'Configuration error';
    }
    if (badge) {
      badge.className = 'badge badge-hold';
      badge.textContent = 'OFFLINE';
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
        createBtn.title = 'Add new account';
      }
    }

    const currentUser = api.currentUser;
    const currentUserId = currentUser ? (currentUser.id || currentUser._id) : null;
    const currentUsername = currentUser ? (currentUser.username || '').toLowerCase() : '';

    if (tbody) {
      if (_currentUsersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 24px;">No registered operators found on this terminal.</td></tr>';
      } else {
        _currentUsersList.forEach(u => {
          const tr = document.createElement('tr');
          const isSelf = currentUserId && (
            u._id === currentUserId ||
            (u.username && u.username.toLowerCase() === currentUsername)
          );

          const statusToggle = `
            <div class="scada-status-rocker">
              <button type="button" class="rocker-btn ${u.active ? 'active' : 'inactive'}"
                id="user-toggle-${u._id}"
                ${isSelf ? 'disabled' : ''}
                onclick="handleToggleUserActive('${u._id}', '${u.username}', ${u.active ? 'true' : 'false'})"
                title="${isSelf ? 'Cannot deactivate your own active session' : (u.active ? 'Click to deactivate operator' : 'Click to activate operator')}">
                <span class="rocker-led"></span>
                <span>${u.active ? 'ACTIVE' : 'INACTIVE'}</span>
              </button>
            </div>
          `;

          const editBtn = `<button class="btn-action-icon btn-action-edit" onclick="openEditUserModal('${u._id}')" title="Edit operator profile"><i class="ri-edit-line"></i> EDIT</button>`;
          const resetBtn = `<button class="btn-action-icon btn-action-reset" onclick="openResetPasswordModal('${u._id}', '${u.username}')" title="Reset password"><i class="ri-key-line"></i> RESET PWD</button>`;
          const deleteBtn = `<button class="btn-action-icon btn-action-delete" onclick="handleDeleteUser('${u._id}', '${u.username}')" title="Permanently delete account" ${isSelf ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''}><i class="ri-delete-bin-line"></i> DELETE</button>`;

          tr.innerHTML = `
            <td>${statusToggle}</td>
            <td>
              <strong style="color: var(--text-heading); font-size: 13px;">${u.username}</strong>
              ${isSelf ? '<span class="badge" style="background:#e0f2fe; color:#0284c7; font-size:9px; margin-left:6px; font-weight:800;">YOU</span>' : ''}
            </td>
            <td>${u.fullName || '--'}</td>
            <td><span class="badge badge-verified">${(u.role || 'operator').toUpperCase()}</span></td>
            <td style="text-align: right; padding-right: 14px;">
              <div class="user-actions-group" style="justify-content: flex-end;">
                ${editBtn}
                ${resetBtn}
                ${deleteBtn}
              </div>
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

// ----------------------------------------------------------------------------
// 1. CREATE USER (SINGLE POPUP MODAL)
// ----------------------------------------------------------------------------
function handleCreateUser() {
  if (_currentUsersList && _currentUsersList.length >= 10) {
    return customModal.alert('Terminal operator capacity reached! A maximum of 10 users are allowed on this terminal. Delete an existing account before creating a new one.', {
      title: 'USER QUOTA EXCEEDED (10/10)',
      type: 'warning'
    });
  }

  const modal = document.getElementById('create-user-modal');
  if (!modal) return;

  document.getElementById('cu-username').value = '';
  document.getElementById('cu-fullname').value = '';
  document.getElementById('cu-password').value = '';
  const roleSelect = document.getElementById('cu-role');
  if (roleSelect) {
    roleSelect.value = 'operator';
    if (window.scadaDropdown) {
      const dd = window.scadaDropdown.attach(roleSelect);
      if (dd && typeof dd.sync === 'function') dd.sync();
    }
  }
  const errBox = document.getElementById('cu-error');
  if (errBox) errBox.style.display = 'none';

  modal.style.display = 'flex';
  modal.classList.add('active');
  setTimeout(() => document.getElementById('cu-username')?.focus(), 50);
}

function closeCreateUserModal() {
  const modal = document.getElementById('create-user-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

async function submitCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('cu-username').value.trim();
  const fullName = document.getElementById('cu-fullname').value.trim();
  const password = document.getElementById('cu-password').value;
  const role = document.getElementById('cu-role').value;
  const errBox = document.getElementById('cu-error');

  if (!username || !fullName) {
    if (errBox) {
      errBox.textContent = 'Please fill in both username and full name.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (!password || password.length < 6) {
    if (errBox) {
      errBox.textContent = 'Password must be at least 6 characters long.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    await api.createUser({ username, fullName, password, role });
    sounds.playSuccess();
    closeCreateUserModal();
    await customModal.alert(`Account '${username}' created successfully!`, { title: 'USER CREATED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    sounds.playViolation();
    if (errBox) {
      errBox.textContent = err.message || 'Failed to create user';
      errBox.style.display = 'block';
    }
  }
}

// ----------------------------------------------------------------------------
// 2. EDIT USER MODAL
// ----------------------------------------------------------------------------
function openEditUserModal(userId) {
  const user = _currentUsersList.find(u => u._id === userId);
  if (!user) return;

  const modal = document.getElementById('edit-user-modal');
  if (!modal) return;

  const currentUser = api.currentUser;
  const currentUserId = currentUser ? (currentUser.id || currentUser._id) : null;
  const isSelf = currentUserId && (user._id === currentUserId);

  document.getElementById('eu-id').value = user._id;
  document.getElementById('eu-username').value = user.username;
  document.getElementById('eu-fullname').value = user.fullName || '';

  const roleSelect = document.getElementById('eu-role');
  if (roleSelect) {
    roleSelect.value = user.role || 'operator';
    roleSelect.disabled = isSelf; // Cannot demote own admin account
    roleSelect.title = isSelf ? 'Cannot modify your own administrator role' : '';
    if (window.scadaDropdown) {
      const dd = window.scadaDropdown.attach(roleSelect);
      if (dd && typeof dd.sync === 'function') dd.sync();
    }
  }

  const activeSelect = document.getElementById('eu-active');
  if (activeSelect) {
    activeSelect.value = String(user.active !== false);
    activeSelect.disabled = isSelf; // Cannot deactivate own account
    activeSelect.title = isSelf ? 'Cannot deactivate your own active account' : '';
    if (window.scadaDropdown) {
      const dd = window.scadaDropdown.attach(activeSelect);
      if (dd && typeof dd.sync === 'function') dd.sync();
    }
  }

  const errBox = document.getElementById('eu-error');
  if (errBox) errBox.style.display = 'none';

  modal.style.display = 'flex';
  modal.classList.add('active');
  setTimeout(() => document.getElementById('eu-fullname')?.focus(), 50);
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

async function submitEditUser(e) {
  e.preventDefault();
  const userId = document.getElementById('eu-id').value;
  const fullName = document.getElementById('eu-fullname').value.trim();
  const role = document.getElementById('eu-role').value;
  const active = document.getElementById('eu-active').value === 'true';
  const errBox = document.getElementById('eu-error');

  if (!fullName) {
    if (errBox) {
      errBox.textContent = 'Full name cannot be empty.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await api.updateUser(userId, { fullName, role, active });
    sounds.playSuccess();
    closeEditUserModal();
    await customModal.alert(res.message || 'Operator details updated successfully!', { title: 'ACCOUNT UPDATED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    sounds.playViolation();
    if (errBox) {
      errBox.textContent = err.message || 'Failed to update operator';
      errBox.style.display = 'block';
    }
  }
}

// ----------------------------------------------------------------------------
// 3. RESET PASSWORD MODAL
// ----------------------------------------------------------------------------
function openResetPasswordModal(userId, username) {
  const modal = document.getElementById('reset-password-modal');
  if (!modal) return;

  document.getElementById('rp-id').value = userId;
  const nameEl = document.getElementById('rp-username');
  if (nameEl) nameEl.textContent = username;

  document.getElementById('rp-password').value = '';
  document.getElementById('rp-confirm').value = '';

  const errBox = document.getElementById('rp-error');
  if (errBox) errBox.style.display = 'none';

  modal.style.display = 'flex';
  modal.classList.add('active');
  setTimeout(() => document.getElementById('rp-password')?.focus(), 50);
}

function closeResetPasswordModal() {
  const modal = document.getElementById('reset-password-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

async function submitResetPassword(e) {
  e.preventDefault();
  const userId = document.getElementById('rp-id').value;
  const username = document.getElementById('rp-username').textContent;
  const password = document.getElementById('rp-password').value;
  const confirm = document.getElementById('rp-confirm').value;
  const errBox = document.getElementById('rp-error');

  if (!password || password.length < 6) {
    if (errBox) {
      errBox.textContent = 'Password must be at least 6 characters long.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (password !== confirm) {
    if (errBox) {
      errBox.textContent = 'Passwords do not match. Please re-enter.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await api.resetPassword(userId, password);
    sounds.playSuccess();
    closeResetPasswordModal();
    await customModal.alert(res.message || `Password successfully reset for '${username}'.`, { title: 'PASSWORD RESET', type: 'success' });
  } catch (err) {
    sounds.playViolation();
    if (errBox) {
      errBox.textContent = err.message || 'Password reset failed';
      errBox.style.display = 'block';
    }
  }
}

// ----------------------------------------------------------------------------
// 4. TOGGLE OPERATOR ACTIVE / DEACTIVATE
// ----------------------------------------------------------------------------
async function handleToggleUserActive(userId, username, currentActive) {
  const actionText = currentActive ? 'deactivate' : 'activate';
  const ok = await customModal.confirm(`Are you sure you want to ${actionText} account "${username}"?`, {
    title: `${actionText.toUpperCase()} ACCOUNT`,
    danger: currentActive
  });
  if (!ok) return;

  try {
    const res = await api.toggleUserActive(userId);
    sounds.playSuccess();
    await customModal.alert(res.message, { title: 'STATUS UPDATED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Status toggle failed: ' + err.message, { title: 'ACTION FAILED', type: 'danger' });
  }
}

// ----------------------------------------------------------------------------
// 5. DELETE ACCOUNT
// ----------------------------------------------------------------------------
async function handleDeleteUser(userId, username) {
  const confirmed = await customModal.confirm(`Are you sure you want to permanently delete account "${username}"? This action cannot be undone.`, {
    title: 'CONFIRM DELETE ACCOUNT',
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await api.deleteUser(userId);
    sounds.playSuccess();
    await customModal.alert(res.message || `User account '${username}' permanently deleted.`, { title: 'ACCOUNT DELETED', type: 'success' });
    loadUsersTable();
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Delete failed: ' + err.message, { title: 'DELETE FAILED', type: 'danger' });
  }
}

// Expose all user management handlers globally on window
window.loadUsersTable = loadUsersTable;
window.handleCreateUser = handleCreateUser;
window.closeCreateUserModal = closeCreateUserModal;
window.submitCreateUser = submitCreateUser;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.submitEditUser = submitEditUser;
window.openResetPasswordModal = openResetPasswordModal;
window.closeResetPasswordModal = closeResetPasswordModal;
window.submitResetPassword = submitResetPassword;
window.handleToggleUserActive = handleToggleUserActive;
window.handleDeleteUser = handleDeleteUser;

// ============================================================================
// QUALITY AUDIT REASONS (HOLD & REJECT) MANAGEMENT
// ============================================================================
let _currentAuditReasons = {
  holdReasons: [
    'Visual Quality Inspection',
    'Packaging / Label Defect',
    'Lab Testing Pending',
    'Dimensional Tolerance Check',
    'Supervisor Discretion'
  ],
  rejectionReasons: [
    'Damaged QR / Barcode Sticker',
    'Defective Part Inside Box',
    'Box Packaging Crushed',
    'Quantity Mismatch',
    'Laser Marking Illegible',
    'Tape Seal Damaged'
  ]
};
let _activeReasonsCategory = 'hold';

async function loadAuditReasons() {
  try {
    const res = await api.getAuditReasons();
    if (res.success) {
      _currentAuditReasons.holdReasons = res.holdReasons || [];
      _currentAuditReasons.rejectionReasons = res.rejectionReasons || [];
      renderReasonsList();
      populateModalReasonDropdowns();
    }
  } catch (err) {
    console.warn('Could not load audit reasons:', err.message);
  }
}

function switchReasonsCategory(category) {
  _activeReasonsCategory = category;
  const btnHold = document.getElementById('btn-reasons-tab-hold');
  const btnReject = document.getElementById('btn-reasons-tab-reject');
  const badgeHold = document.getElementById('badge-hold-reasons-count');
  const badgeReject = document.getElementById('badge-reject-reasons-count');
  const inputEl = document.getElementById('sys-new-reason-input');

  if (category === 'hold') {
    if (btnHold) btnHold.className = 'btn-scada btn-primary';
    if (btnReject) btnReject.className = 'btn-scada btn-secondary';
    if (badgeHold) {
      badgeHold.style.background = 'rgba(255,255,255,0.25)';
      badgeHold.style.color = '#fff';
    }
    if (badgeReject) {
      badgeReject.style.background = 'rgba(0,0,0,0.08)';
      badgeReject.style.color = '#334155';
    }
    if (inputEl) inputEl.placeholder = 'Type new hold reason (e.g. Surface Scratches)...';
  } else {
    if (btnHold) btnHold.className = 'btn-scada btn-secondary';
    if (btnReject) btnReject.className = 'btn-scada btn-primary';
    if (badgeHold) {
      badgeHold.style.background = 'rgba(0,0,0,0.08)';
      badgeHold.style.color = '#334155';
    }
    if (badgeReject) {
      badgeReject.style.background = 'rgba(255,255,255,0.25)';
      badgeReject.style.color = '#fff';
    }
    if (inputEl) inputEl.placeholder = 'Type new reject reason (e.g. Tape Seal Damaged)...';
  }

  renderReasonsList();
}

function renderReasonsList() {
  const container = document.getElementById('sys-reasons-list');
  const countHoldBadge = document.getElementById('badge-hold-reasons-count');
  const countRejectBadge = document.getElementById('badge-reject-reasons-count');

  if (countHoldBadge) countHoldBadge.textContent = _currentAuditReasons.holdReasons.length;
  if (countRejectBadge) countRejectBadge.textContent = _currentAuditReasons.rejectionReasons.length;

  if (!container) return;

  const currentList = _activeReasonsCategory === 'hold'
    ? _currentAuditReasons.holdReasons
    : _currentAuditReasons.rejectionReasons;

  if (!currentList || currentList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 18px 10px; color: #94a3b8; font-size: 11px;">
        <i class="ri-inbox-line" style="font-size: 18px; display: block; margin-bottom: 4px;"></i>
        No ${_activeReasonsCategory === 'hold' ? 'Hold' : 'Rejection'} reasons configured. Add one above.
      </div>
    `;
    return;
  }

  container.innerHTML = currentList.map((reason, idx) => `
    <div class="audit-reason-item" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: #ffffff; border: 1px solid var(--border-light); border-radius: var(--border-radius-sm); margin-bottom: 4px;">
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
        <i class="${_activeReasonsCategory === 'hold' ? 'ri-pause-circle-line text-warning' : 'ri-close-circle-line text-danger'}" style="font-size: 13px; flex-shrink: 0;"></i>
        <span style="font-size: 11.5px; font-weight: 600; color: var(--text-heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${reason}</span>
      </div>
      <button class="hud-icon-btn text-danger" onclick="deleteAuditReason(${idx})" title="Delete reason '${reason}'" style="padding: 2px 6px;">
        <i class="ri-delete-bin-line" style="font-size: 13px;"></i>
      </button>
    </div>
  `).join('');
}

async function addNewAuditReason() {
  const inputEl = document.getElementById('sys-new-reason-input');
  const val = inputEl ? inputEl.value.trim() : '';
  if (!val) return;

  const currentList = _activeReasonsCategory === 'hold'
    ? _currentAuditReasons.holdReasons
    : _currentAuditReasons.rejectionReasons;

  // Case-insensitive duplicate check
  if (currentList.some(r => r.toLowerCase() === val.toLowerCase())) {
    await customModal.alert(`The reason "${val}" already exists in the ${_activeReasonsCategory === 'hold' ? 'Hold' : 'Rejection'} list.`, {
      title: 'DUPLICATE REASON',
      type: 'warning'
    });
    return;
  }

  currentList.push(val);

  try {
    const res = await api.saveAuditReasons(_currentAuditReasons);
    sounds.playSuccess();
    if (inputEl) inputEl.value = '';
    renderReasonsList();
    populateModalReasonDropdowns();

    const statusMsg = document.getElementById('sys-reasons-status-msg');
    if (statusMsg) {
      statusMsg.textContent = `Added "${val}" to ${_activeReasonsCategory.toUpperCase()} options!`;
      statusMsg.style.color = '#059669';
      setTimeout(() => {
        statusMsg.textContent = 'Options populate Hold/Reject modal dropdowns';
        statusMsg.style.color = '#64748b';
      }, 2500);
    }
  } catch (err) {
    currentList.pop();
    sounds.playViolation();
    await customModal.alert('Failed to save reason: ' + err.message, { title: 'SAVE ERROR', type: 'danger' });
  }
}

async function deleteAuditReason(index) {
  const currentList = _activeReasonsCategory === 'hold'
    ? _currentAuditReasons.holdReasons
    : _currentAuditReasons.rejectionReasons;

  const reasonToDelete = currentList[index];
  if (!reasonToDelete) return;

  const confirmed = await customModal.confirm(`Remove reason option "${reasonToDelete}"?`, {
    title: `DELETE ${_activeReasonsCategory.toUpperCase()} REASON`,
    danger: true
  });
  if (!confirmed) return;

  currentList.splice(index, 1);

  try {
    await api.saveAuditReasons(_currentAuditReasons);
    sounds.playSuccess();
    renderReasonsList();
    populateModalReasonDropdowns();

    const statusMsg = document.getElementById('sys-reasons-status-msg');
    if (statusMsg) {
      statusMsg.textContent = `Removed "${reasonToDelete}"`;
      statusMsg.style.color = '#059669';
      setTimeout(() => {
        statusMsg.textContent = 'Options populate Hold/Reject modal dropdowns';
        statusMsg.style.color = '#64748b';
      }, 2500);
    }
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Failed to delete reason: ' + err.message, { title: 'DELETE ERROR', type: 'danger' });
    loadAuditReasons();
  }
}

async function resetReasonsToDefaults() {
  const confirmed = await customModal.confirm('Reset both Hold and Reject reason dropdowns back to factory defaults?', {
    title: 'RESET AUDIT REASONS',
    danger: true
  });
  if (!confirmed) return;

  _currentAuditReasons.holdReasons = [
    'Visual Quality Inspection',
    'Packaging / Label Defect',
    'Lab Testing Pending',
    'Dimensional Tolerance Check',
    'Supervisor Discretion'
  ];
  _currentAuditReasons.rejectionReasons = [
    'Damaged QR / Barcode Sticker',
    'Defective Part Inside Box',
    'Box Packaging Crushed',
    'Quantity Mismatch',
    'Laser Marking Illegible',
    'Tape Seal Damaged'
  ];

  try {
    await api.saveAuditReasons(_currentAuditReasons);
    sounds.playSuccess();
    renderReasonsList();
    populateModalReasonDropdowns();

    const statusMsg = document.getElementById('sys-reasons-status-msg');
    if (statusMsg) {
      statusMsg.textContent = 'Restored factory default options!';
      statusMsg.style.color = '#059669';
      setTimeout(() => {
        statusMsg.textContent = 'Options populate Hold/Reject modal dropdowns';
        statusMsg.style.color = '#64748b';
      }, 2500);
    }
  } catch (err) {
    sounds.playViolation();
    await customModal.alert('Failed to reset reasons: ' + err.message, { title: 'RESET ERROR', type: 'danger' });
  }
}

function populateModalReasonDropdowns() {
  const holdSelect = document.getElementById('modal-hold-reason');
  if (holdSelect && _currentAuditReasons.holdReasons) {
    const curVal = holdSelect.value;
    const defaultPlaceholder = '<option value="" disabled selected>-- Select a Hold Reason --</option>';
    const optionsHtml = _currentAuditReasons.holdReasons.map(r => `<option value="${r}">${r}</option>`).join('');
    holdSelect.innerHTML = defaultPlaceholder + optionsHtml;
    if (curVal && _currentAuditReasons.holdReasons.includes(curVal)) {
      holdSelect.value = curVal;
    } else {
      holdSelect.value = '';
    }
    if (window.scadaDropdown) window.scadaDropdown.attach(holdSelect).sync();
  }

  const rejectSelect = document.getElementById('modal-reject-reason');
  if (rejectSelect && _currentAuditReasons.rejectionReasons) {
    const curVal = rejectSelect.value;
    const defaultPlaceholder = '<option value="" disabled selected>-- Select a Rejection Reason --</option>';
    const optionsHtml = _currentAuditReasons.rejectionReasons.map(r => `<option value="${r}">${r}</option>`).join('');
    rejectSelect.innerHTML = defaultPlaceholder + optionsHtml;
    if (curVal && _currentAuditReasons.rejectionReasons.includes(curVal)) {
      rejectSelect.value = curVal;
    } else {
      rejectSelect.value = '';
    }
    if (window.scadaDropdown) window.scadaDropdown.attach(rejectSelect).sync();
  }
}

// Expose reasons functions globally on window
window.switchReasonsCategory = switchReasonsCategory;
window.addNewAuditReason = addNewAuditReason;
window.deleteAuditReason = deleteAuditReason;
window.resetReasonsToDefaults = resetReasonsToDefaults;
window.populateModalReasonDropdowns = populateModalReasonDropdowns;
window.loadAuditReasons = loadAuditReasons;

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

// Expose inventory, modal & reports functions globally on window
window.setInventoryStatusFilter = setInventoryStatusFilter;
window.executeInventorySearch = executeInventorySearch;
window.resetInventoryFilters = resetInventoryFilters;
window.changeInventoryPage = changeInventoryPage;
window.applyInventoryFilter = applyInventoryFilter;
window.loadInventoryView = loadInventoryView;
window.openHoldModal = openHoldModal;
window.submitHoldModal = submitHoldModal;
window.quickReleaseHold = quickReleaseHold;
window.openRejectModal = openRejectModal;
window.submitRejectModal = submitRejectModal;
window.openReopenModal = openReopenModal;
window.submitReopenModal = submitReopenModal;
window.openModal = openModal;
window.closeModals = closeModals;

window.loadReportsView = loadReportsView;
window.applyReportsFilter = applyReportsFilter;
window.resetReportsFilter = resetReportsFilter;
window.changeReportsPage = changeReportsPage;
window.openReleaseModal = openReleaseModal;
window.submitReleaseModal = submitReleaseModal;
window.handleCancelDispatch = handleCancelDispatch;
window.submitCancelDispatchModal = submitCancelDispatchModal;
window.exportCsvReport = exportCsvReport;
window.openDispatchBill = openDispatchBill;
window.printDispatchBill = printDispatchBill;
window.printPendingManifest = printPendingManifest;
window.toggleManifestSerials = toggleManifestSerials;
window.toggleUserDropdown = toggleUserDropdown;

function clearTraceInput() {
  const input = document.getElementById('trace-query-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  const inlineClearBtn = document.getElementById('trace-clear-btn');
  if (inlineClearBtn) inlineClearBtn.style.display = 'none';

  const resultsContainer = document.getElementById('trace-results-container');
  const emptyState = document.getElementById('trace-empty-state');
  if (resultsContainer) resultsContainer.style.display = 'none';
  if (emptyState) emptyState.style.display = 'block';
}

function toggleTraceClearIcon(val) {
  const inlineClearBtn = document.getElementById('trace-clear-btn');
  if (inlineClearBtn) {
    inlineClearBtn.style.display = (val && val.trim().length > 0) ? 'block' : 'none';
  }
}
window.clearTraceInput = clearTraceInput;
window.toggleTraceClearIcon = toggleTraceClearIcon;
