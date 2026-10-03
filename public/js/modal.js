// public/js/modal.js - Zero-Native SCADA Custom Modal Dialog System
const customModal = {
  activeResolve: null,

  init() {
    const backdrop = document.getElementById('custom-modal-backdrop');
    if (!backdrop) return;

    const btnCancel = document.getElementById('custom-modal-btn-cancel');
    const btnConfirm = document.getElementById('custom-modal-btn-confirm');
    const input = document.getElementById('custom-modal-input');

    if (btnCancel) {
      btnCancel.onclick = () => this.handleCancel();
    }
    if (btnConfirm) {
      btnConfirm.onclick = () => {
        const inputWrap = document.getElementById('custom-modal-input-wrap');
        if (inputWrap && inputWrap.style.display !== 'none') {
          this.handleAction(input ? input.value : '');
        } else {
          this.handleAction(true);
        }
      };
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleAction(input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.handleCancel();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      const backdrop = document.getElementById('custom-modal-backdrop');
      if (backdrop && backdrop.style.display !== 'none') {
        if (e.key === 'Escape') {
          this.handleCancel();
        }
      }
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.handleCancel();
      }
    });

    // In-app License Modal wiring
    this.initLicenseModal();
  },

  handleCancel() {
    const inputWrap = document.getElementById('custom-modal-input-wrap');
    const isPrompt = inputWrap && inputWrap.style.display !== 'none';
    this.handleAction(isPrompt ? null : false);
  },

  handleAction(value) {
    const backdrop = document.getElementById('custom-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';

    if (typeof this.activeResolve === 'function') {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      resolve(value);
    }
  },

  alert(message, options = {}) {
    return new Promise((resolve) => {
      this.activeResolve = resolve;

      const backdrop = document.getElementById('custom-modal-backdrop');
      const titleEl = document.getElementById('custom-modal-title');
      const bodyEl = document.getElementById('custom-modal-body');
      const iconWrap = document.getElementById('custom-modal-icon-wrap');
      const iconEl = document.getElementById('custom-modal-icon');
      const inputWrap = document.getElementById('custom-modal-input-wrap');
      const btnCancel = document.getElementById('custom-modal-btn-cancel');
      const btnConfirm = document.getElementById('custom-modal-btn-confirm');

      const title = options.title || 'SYSTEM NOTICE';
      const type = options.type || 'info';

      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.innerHTML = (message || '').replace(/\n/g, '<br>');
      if (inputWrap) inputWrap.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';

      if (btnConfirm) {
        btnConfirm.textContent = options.confirmText || 'OK';
        btnConfirm.className = 'btn-scada btn-primary';
        btnConfirm.focus();
      }

      // Icon & theme styling (SCADA Pilot LED Indicator)
      if (iconWrap && iconEl) {
        iconWrap.style.background = '';
        iconWrap.style.color = '';
        iconWrap.style.borderColor = '';
        if (type === 'danger' || type === 'error') {
          iconWrap.className = 'custom-modal-icon-wrap icon-danger';
          iconEl.className = 'ri-error-warning-line';
        } else if (type === 'success') {
          iconWrap.className = 'custom-modal-icon-wrap icon-success';
          iconEl.className = 'ri-checkbox-circle-line';
        } else if (type === 'warning') {
          iconWrap.className = 'custom-modal-icon-wrap icon-warning';
          iconEl.className = 'ri-alert-line';
        } else {
          iconWrap.className = 'custom-modal-icon-wrap icon-primary';
          iconEl.className = 'ri-information-line';
        }
      }

      if (backdrop) backdrop.style.display = 'flex';
      if (window.sounds) window.sounds.playClick();
    });
  },

  confirm(message, options = {}) {
    return new Promise((resolve) => {
      this.activeResolve = resolve;

      const backdrop = document.getElementById('custom-modal-backdrop');
      const titleEl = document.getElementById('custom-modal-title');
      const bodyEl = document.getElementById('custom-modal-body');
      const iconWrap = document.getElementById('custom-modal-icon-wrap');
      const iconEl = document.getElementById('custom-modal-icon');
      const inputWrap = document.getElementById('custom-modal-input-wrap');
      const btnCancel = document.getElementById('custom-modal-btn-cancel');
      const btnConfirm = document.getElementById('custom-modal-btn-confirm');

      const title = options.title || 'CONFIRM ACTION';
      const isDanger = options.danger || false;

      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.innerHTML = (message || '').replace(/\n/g, '<br>');
      if (inputWrap) inputWrap.style.display = 'none';

      if (btnCancel) {
        btnCancel.style.display = 'inline-block';
        btnCancel.textContent = options.cancelText || 'CANCEL';
      }

      if (btnConfirm) {
        btnConfirm.textContent = options.confirmText || 'CONFIRM';
        btnConfirm.className = isDanger ? 'btn-scada btn-danger' : 'btn-scada btn-primary';
        btnConfirm.focus();
      }

      if (iconWrap && iconEl) {
        iconWrap.style.background = '';
        iconWrap.style.color = '';
        iconWrap.style.borderColor = '';
        if (isDanger) {
          iconWrap.className = 'custom-modal-icon-wrap icon-danger';
          iconEl.className = 'ri-error-warning-line';
        } else {
          iconWrap.className = 'custom-modal-icon-wrap icon-primary';
          iconEl.className = 'ri-questionnaire-line';
        }
      }

      if (backdrop) backdrop.style.display = 'flex';
      if (window.sounds) window.sounds.playClick();
    });
  },

  prompt(message, options = {}) {
    return new Promise((resolve) => {
      this.activeResolve = resolve;

      const backdrop = document.getElementById('custom-modal-backdrop');
      const titleEl = document.getElementById('custom-modal-title');
      const bodyEl = document.getElementById('custom-modal-body');
      const iconWrap = document.getElementById('custom-modal-icon-wrap');
      const iconEl = document.getElementById('custom-modal-icon');
      const inputWrap = document.getElementById('custom-modal-input-wrap');
      const input = document.getElementById('custom-modal-input');
      const btnCancel = document.getElementById('custom-modal-btn-cancel');
      const btnConfirm = document.getElementById('custom-modal-btn-confirm');

      const title = options.title || 'INPUT REQUIRED';

      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.innerHTML = (message || '').replace(/\n/g, '<br>');

      if (inputWrap) inputWrap.style.display = 'block';
      if (input) {
        input.type = options.inputType || 'text';
        input.placeholder = options.placeholder || '';
        input.value = options.defaultValue || '';
        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);
      }

      if (btnCancel) {
        btnCancel.style.display = 'inline-block';
        btnCancel.textContent = options.cancelText || 'CANCEL';
      }

      if (btnConfirm) {
        btnConfirm.textContent = options.confirmText || 'PROCEED';
        btnConfirm.className = options.danger ? 'btn-scada btn-danger' : 'btn-scada btn-primary';
      }

      if (iconWrap && iconEl) {
        if (options.danger) {
          iconWrap.style.background = 'rgba(239, 68, 68, 0.15)';
          iconWrap.style.color = '#ef4444';
          iconWrap.style.borderColor = 'rgba(239, 68, 68, 0.3)';
          iconEl.className = 'ri-error-warning-line';
        } else {
          iconWrap.style.background = 'rgba(56, 189, 248, 0.15)';
          iconWrap.style.color = '#38bdf8';
          iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.3)';
          iconEl.className = 'ri-edit-line';
        }
      }

      if (backdrop) backdrop.style.display = 'flex';
      if (window.sounds) window.sounds.playClick();
    });
  },

  initLicenseModal() {
    const copyBtn = document.getElementById('lic-modal-btn-copy');
    const folderBtn = document.getElementById('lic-modal-btn-folder');
    const activateBtn = document.getElementById('lic-modal-btn-activate');
    const keyInput = document.getElementById('lic-modal-key-input');
    const fpInput = document.getElementById('lic-modal-fingerprint');
    const errorBox = document.getElementById('lic-modal-error');

    if (copyBtn && fpInput) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(fpInput.value).then(() => {
          copyBtn.innerHTML = '<i class="ri-check-line"></i> COPIED!';
          copyBtn.style.background = 'var(--color-green)';
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> COPY ID';
            copyBtn.style.background = '';
          }, 2500);
        });
      };
    }

    if (folderBtn) {
      folderBtn.onclick = () => {
        if (window.electronAPI && typeof window.electronAPI.openLicenseFolder === 'function') {
          window.electronAPI.openLicenseFolder();
        } else {
          customModal.alert('Place the "license.key" file into the application root directory next to the executable.', { title: 'LICENSE FOLDER' });
        }
      };
    }

    if (activateBtn && keyInput) {
      activateBtn.onclick = async () => {
        const key = keyInput.value.trim();
        if (!key) {
          if (errorBox) {
            errorBox.textContent = 'Please paste a cryptographic license key string.';
            errorBox.style.display = 'block';
          }
          return;
        }

        try {
          if (errorBox) errorBox.style.display = 'none';
          const res = await api.activateLicense(key);
          if (res.success) {
            const modal = document.getElementById('license-activation-modal');
            if (modal) modal.style.display = 'none';
            await customModal.alert('License Activated Successfully!\n' + res.message, { title: 'ACTIVATION SUCCESS', type: 'success' });
            window.location.reload();
          } else {
            if (errorBox) {
              errorBox.textContent = res.error || 'Activation failed';
              errorBox.style.display = 'block';
            }
          }
        } catch (err) {
          if (errorBox) {
            errorBox.textContent = err.message || 'Activation failed';
            errorBox.style.display = 'block';
          }
        }
      };
    }
  },

  showLicenseModal(fingerprint) {
    const modal = document.getElementById('license-activation-modal');
    const fpInput = document.getElementById('lic-modal-fingerprint');
    if (fpInput && fingerprint) {
      fpInput.value = fingerprint;
    }
    if (modal) {
      modal.style.display = 'flex';
    }
  }
};

// Wire customModal globally on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  customModal.init();
});

// Overwrite native window.alert, window.confirm, window.prompt so zero native popups ever appear
window.alert = (msg) => customModal.alert(msg);
window.confirm = (msg) => {
  console.warn('Sync confirm called - prefer await customModal.confirm()');
  return true;
};

// ============================================================================
// DYNAMIC LEGAL DOCUMENTS VIEWER (EULA.md & LICENSE.md DIRECT RENDERER)
// ============================================================================
let _cachedLegalDocs = {
  eula: null,
  license: null,
  currentDoc: 'eula',
  sourceInfo: ''
};

function renderLegalMarkdown(markdownText) {
  if (!markdownText) {
    return '<div style="color: #64748b; padding: 20px; text-align: center;"><i class="ri-error-warning-line"></i> Document content not available.</div>';
  }

  const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  let paragraphLines = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      const fullText = paragraphLines.join('<br>').trim();
      if (fullText) {
        if (fullText.includes('CAREFULLY READ') || fullText.includes('IMPORTANT — READ CAREFULLY')) {
          html += `<div style="background: #fffbeb; border-left: 3px solid #f59e0b; padding: 10px 14px; margin: 12px 0; font-weight: 600; color: #92400e; border-radius: 2px;">${formatInline(fullText)}</div>`;
        } else {
          html += `<p class="eula-p">${formatInline(fullText)}</p>`;
        }
      }
      paragraphLines = [];
    }
  }

  function closeLists() {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  }

  function formatInline(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/&lt;br&gt;/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="eula-inline-code">$1</code>');
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      closeLists();
      continue;
    }

    if (line === '---' || line === '***') {
      flushParagraph();
      closeLists();
      html += '<hr class="eula-hr">';
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      closeLists();
      html += `<h1 class="eula-h1">${formatInline(line.substring(2))}</h1>`;
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      closeLists();
      html += `<h2 class="eula-h2">${formatInline(line.substring(3))}</h2>`;
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      closeLists();
      html += `<h3 class="eula-h3">${formatInline(line.substring(4))}</h3>`;
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul class="eula-ul">'; inUl = true; }
      html += `<li>${formatInline(ulMatch[1])}</li>`;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol class="eula-ol">'; inOl = true; }
      html += `<li>${formatInline(olMatch[2])}</li>`;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  closeLists();

  return html;
}

window.loadLegalDocuments = async function () {
  const container = document.getElementById('eula-doc-container');
  const sourceLabel = document.getElementById('eula-doc-source');

  try {
    // 1. First attempt: Direct Electron IPC filesystem bridge
    if (window.electronAPI && typeof window.electronAPI.readLegalDocument === 'function') {
      const eulaRes = await window.electronAPI.readLegalDocument('eula');
      const licRes = await window.electronAPI.readLegalDocument('license');

      _cachedLegalDocs.eula = eulaRes.success ? eulaRes.content : (eulaRes.error || 'Failed to read EULA.md');
      _cachedLegalDocs.license = licRes.success ? licRes.content : (licRes.error || 'Failed to read LICENSE.md');
      _cachedLegalDocs.sourceInfo = 'Workstation Direct File Reader';
      return;
    }

    // 2. Second attempt: Backend REST endpoint (/api/system/legal)
    let res;
    if (typeof api !== 'undefined' && typeof api.request === 'function') {
      res = await api.request('/api/system/legal');
    } else {
      const port = (window.electronAPI && window.electronAPI.serverPort) || location.port || '4000';
      const response = await fetch(`http://127.0.0.1:${port}/api/system/legal`);
      res = await response.json();
    }

    if (res && res.success && res.documents) {
      _cachedLegalDocs.eula = res.documents.eula;
      _cachedLegalDocs.license = res.documents.license;
      _cachedLegalDocs.sourceInfo = 'Server Direct File Stream';
    } else {
      throw new Error((res && res.error) || 'Failed to load legal agreements');
    }
  } catch (err) {
    console.error('[LEGAL VIEWER] Failed to load documents:', err);
    _cachedLegalDocs.eula = `# Legal Agreement Loading Error\n\nUnable to read file directly: ${err.message}`;
    _cachedLegalDocs.license = `# License Loading Error\n\nUnable to read file directly: ${err.message}`;
  }
};

window.switchLegalDoc = function (docType) {
  _cachedLegalDocs.currentDoc = docType;
  const container = document.getElementById('eula-doc-container');
  const sourceLabel = document.getElementById('eula-doc-source');
  const tabEula = document.getElementById('tab-btn-eula');
  const tabLic = document.getElementById('tab-btn-license');

  if (tabEula && tabLic) {
    if (docType === 'license') {
      tabLic.classList.add('active');
      tabEula.classList.remove('active');
    } else {
      tabEula.classList.add('active');
      tabLic.classList.remove('active');
    }
  }

  const rawDoc = docType === 'license' ? _cachedLegalDocs.license : _cachedLegalDocs.eula;
  const filename = docType === 'license' ? 'LICENSE.md' : 'EULA.md';

  if (container) {
    container.innerHTML = renderLegalMarkdown(rawDoc);
    container.scrollTop = 0;
  }

  if (sourceLabel) {
    sourceLabel.innerHTML = `<i class="ri-file-code-line"></i> Source: <strong>${filename}</strong>`;
  }
};

window.openEulaModal = async function (initialDoc = 'eula') {
  const modal = document.getElementById('eula-modal');
  if (modal) modal.style.display = 'flex';

  const container = document.getElementById('eula-doc-container');
  const hasError = _cachedLegalDocs.eula && _cachedLegalDocs.eula.includes('Legal Agreement Loading Error');
  if (hasError) {
    _cachedLegalDocs.eula = null;
    _cachedLegalDocs.license = null;
  }

  if (container && (!_cachedLegalDocs.eula || !_cachedLegalDocs.license)) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 50px 20px; color: #64748b;">
        <i class="ri-loader-4-line ri-spin" style="font-size: 24px; color: #0284c7; margin-bottom: 10px;"></i>
        <div style="font-family: var(--font-mono); font-size: 11px; font-weight: 600;">Streaming markdown document directly from disk...</div>
      </div>
    `;
  }

  await window.loadLegalDocuments();
  window.switchLegalDoc(initialDoc || _cachedLegalDocs.currentDoc || 'eula');
};

window.closeEulaModal = function () {
  const modal = document.getElementById('eula-modal');
  if (modal) modal.style.display = 'none';
};

