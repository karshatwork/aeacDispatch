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
      btnCancel.onclick = () => this.handleAction(false);
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
          this.handleAction(null);
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      const backdrop = document.getElementById('custom-modal-backdrop');
      if (backdrop && backdrop.style.display !== 'none') {
        if (e.key === 'Escape') {
          const btnCancel = document.getElementById('custom-modal-btn-cancel');
          if (btnCancel && btnCancel.style.display !== 'none') {
            this.handleAction(false);
          }
        }
      }
    });

    // In-app License Modal wiring
    this.initLicenseModal();
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

      // Icon & theme styling
      if (iconWrap && iconEl) {
        if (type === 'danger' || type === 'error') {
          iconWrap.style.background = 'rgba(239, 68, 68, 0.15)';
          iconWrap.style.color = '#ef4444';
          iconWrap.style.borderColor = 'rgba(239, 68, 68, 0.3)';
          iconEl.className = 'ri-error-warning-line';
        } else if (type === 'success') {
          iconWrap.style.background = 'rgba(34, 197, 94, 0.15)';
          iconWrap.style.color = '#22c55e';
          iconWrap.style.borderColor = 'rgba(34, 197, 94, 0.3)';
          iconEl.className = 'ri-checkbox-circle-line';
        } else if (type === 'warning') {
          iconWrap.style.background = 'rgba(245, 158, 11, 0.15)';
          iconWrap.style.color = '#f59e0b';
          iconWrap.style.borderColor = 'rgba(245, 158, 11, 0.3)';
          iconEl.className = 'ri-alert-line';
        } else {
          iconWrap.style.background = 'rgba(56, 189, 248, 0.15)';
          iconWrap.style.color = '#38bdf8';
          iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.3)';
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
        if (isDanger) {
          iconWrap.style.background = 'rgba(239, 68, 68, 0.15)';
          iconWrap.style.color = '#ef4444';
          iconWrap.style.borderColor = 'rgba(239, 68, 68, 0.3)';
          iconEl.className = 'ri-question-line';
        } else {
          iconWrap.style.background = 'rgba(56, 189, 248, 0.15)';
          iconWrap.style.color = '#38bdf8';
          iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.3)';
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
        btnConfirm.className = 'btn-scada btn-primary';
      }

      if (iconWrap && iconEl) {
        iconWrap.style.background = 'rgba(56, 189, 248, 0.15)';
        iconWrap.style.color = '#38bdf8';
        iconWrap.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        iconEl.className = 'ri-edit-line';
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
