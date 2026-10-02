// public/js/scada-ui.js - Precision Retro-Industrial SCADA Custom UI Controls
// Zero dependencies, 100% offline, native keyboard & pointer interaction

(function (window, document) {
  'use strict';

  // ==========================================================================
  // 1. SCADA CUSTOM DROPDOWN (scadaDropdown)
  // ==========================================================================
  const scadaDropdown = {
    instances: new Map(),

    attach(selectEl) {
      if (!selectEl) return null;
      if (selectEl._scadaDropdownAttached) return selectEl._scadaDropdown;
      if (selectEl.tagName !== 'SELECT') return null;

      const wrapper = document.createElement('div');
      wrapper.className = 'scada-select-wrap';
      if (selectEl.id) wrapper.id = `${selectEl.id}-scada-wrap`;

      // Copy flex or width styles if needed
      if (selectEl.style.width) wrapper.style.width = selectEl.style.width;
      if (selectEl.style.minWidth) wrapper.style.minWidth = selectEl.style.minWidth;
      if (selectEl.style.maxWidth) wrapper.style.maxWidth = selectEl.style.maxWidth;
      if (selectEl.style.flex) wrapper.style.flex = selectEl.style.flex;

      // Trigger button
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'scada-select-trigger';
      if (selectEl.disabled) trigger.disabled = true;
      // Mirror explicit height / font-size / font-weight from source select so it fits its container
      if (selectEl.style.height) trigger.style.height = selectEl.style.height;
      if (selectEl.style.fontSize) trigger.style.fontSize = selectEl.style.fontSize;
      if (selectEl.style.fontWeight) trigger.style.fontWeight = selectEl.style.fontWeight;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'scada-select-label';

      const arrowIcon = document.createElement('i');
      arrowIcon.className = 'ri-arrow-down-s-line scada-select-arrow';

      trigger.appendChild(labelSpan);
      trigger.appendChild(arrowIcon);

      // Dropdown menu container
      const menu = document.createElement('div');
      menu.className = 'scada-select-menu';

      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);

      // Insert wrapper into DOM right where select is
      selectEl.parentNode.insertBefore(wrapper, selectEl);
      selectEl.style.display = 'none';
      wrapper.appendChild(selectEl);

      const instance = {
        selectEl,
        wrapper,
        trigger,
        labelSpan,
        menu,
        isOpen: false,

        sync() {
          const selectedOption = selectEl.options[selectEl.selectedIndex];
          labelSpan.textContent = selectedOption ? selectedOption.text : '-- Select --';
          if (selectEl.disabled) {
            trigger.disabled = true;
            wrapper.classList.add('disabled');
          } else {
            trigger.disabled = false;
            wrapper.classList.remove('disabled');
          }

          // Build options list
          menu.innerHTML = '';
          const optionsContainer = document.createElement('div');
          optionsContainer.className = 'scada-select-options-list';

          for (let i = 0; i < selectEl.options.length; i++) {
            const opt = selectEl.options[i];
            const item = document.createElement('div');
            item.className = 'scada-select-item';
            if (opt.disabled) item.classList.add('disabled');
            if (opt.selected) item.classList.add('selected');

            item.textContent = opt.text;

            if (!opt.disabled) {
              item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectEl.selectedIndex = i;
                instance.sync();
                instance.close();
                // Dispatch native change event
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.sounds) window.sounds.playClick();
              });
            }

            optionsContainer.appendChild(item);
          }
          menu.appendChild(optionsContainer);
        },

        open() {
          if (this.isOpen || selectEl.disabled) return;
          // Close any other open dropdowns
          scadaDropdown.closeAll();

          this.sync();
          wrapper.classList.add('open');
          this.isOpen = true;

          // Step 1: Append menu to document.body so NO parent can clip it
          if (menu.parentNode !== document.body) {
            document.body.appendChild(menu);
          }

          // Step 2: Position off-screen and show so we can measure real dimensions
          menu.style.position = 'fixed';
          menu.style.zIndex = '100000';
          menu.style.top = '-9999px';
          menu.style.bottom = 'auto';
          menu.style.left = '-9999px';
          menu.style.display = 'block';
          menu.classList.add('is-open');

          // Step 3: Measure after layout
          const rect = trigger.getBoundingClientRect();
          menu.style.minWidth = `${Math.round(rect.width)}px`;
          menu.style.width = 'max-content';
          menu.style.maxWidth = `min(540px, calc(100vw - 24px))`;

          const menuHeight = menu.offsetHeight || 220;
          const menuWidth = Math.max(rect.width, menu.offsetWidth || 0);
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;

          // Step 4: Set horizontal position with viewport bounds guard
          let leftPos = rect.left;
          if (leftPos + menuWidth > window.innerWidth - 12) {
            leftPos = Math.max(12, window.innerWidth - menuWidth - 12);
          }
          menu.style.left = `${Math.round(leftPos)}px`;

          // Step 5: Flip up if not enough space below
          if (spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow) {
            menu.style.top = 'auto';
            menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 3)}px`;
          } else {
            menu.style.top = `${Math.round(rect.bottom + 3)}px`;
            menu.style.bottom = 'auto';
          }
        },

        close() {
          if (!this.isOpen) return;
          wrapper.classList.remove('open');
          menu.style.display = 'none';
          menu.classList.remove('is-open');
          this.isOpen = false;
        },

        toggle() {
          if (this.isOpen) this.close();
          else this.open();
        }
      };

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        instance.toggle();
        if (window.sounds) window.sounds.playClick();
      });

      // Keyboard support
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          instance.open();
        } else if (e.key === 'Escape') {
          instance.close();
        }
      });

      selectEl._scadaDropdownAttached = true;
      selectEl._scadaDropdown = instance;
      scadaDropdown.instances.set(selectEl, instance);

      // Initial sync
      instance.sync();
      return instance;
    },

    initAll() {
      document.querySelectorAll('select').forEach(select => {
        if (!select.classList.contains('no-scada')) {
          scadaDropdown.attach(select);
        }
      });
    },

    closeAll() {
      scadaDropdown.instances.forEach(inst => inst.close());
    },

    syncAll() {
      scadaDropdown.instances.forEach(inst => inst.sync());
    }
  };

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.scada-select-wrap') && !e.target.closest('.scada-select-menu')) {
      scadaDropdown.closeAll();
    }
  });

  // Close dropdown on scroll (but NOT when scrolling within the menu itself)
  window.addEventListener('scroll', (e) => {
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('.scada-select-menu')) return;
    scadaDropdown.closeAll();
  }, true);

  window.addEventListener('resize', () => {
    scadaDropdown.closeAll();
  });

  // ==========================================================================
  // 2. SCADA PRECISION DATE PICKER (scadaDatePicker)
  // ==========================================================================
  const scadaDatePicker = {
    instances: new Map(),
    activeInstance: null,
    popupEl: null,

    init() {
      if (this.popupEl) return;

      const popup = document.createElement('div');
      popup.className = 'scada-datepicker-popup';
      popup.style.display = 'none';

      popup.innerHTML = `
        <div class="scada-dp-header">
          <button type="button" class="scada-dp-nav-btn" id="scada-dp-btn-prev" title="Previous Month">
            <i class="ri-arrow-left-s-line"></i>
          </button>
          <div class="scada-dp-title" id="scada-dp-title">October 2026</div>
          <button type="button" class="scada-dp-nav-btn" id="scada-dp-btn-next" title="Next Month">
            <i class="ri-arrow-right-s-line"></i>
          </button>
        </div>
        <div class="scada-dp-weekdays">
          <span>SU</span><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span>
        </div>
        <div class="scada-dp-grid" id="scada-dp-grid"></div>
        <div class="scada-dp-footer">
          <button type="button" class="btn-scada btn-secondary scada-dp-preset-btn" id="scada-dp-btn-clear">CLEAR</button>
          <button type="button" class="btn-scada btn-primary scada-dp-preset-btn" id="scada-dp-btn-today">TODAY</button>
        </div>
      `;

      document.body.appendChild(popup);
      this.popupEl = popup;

      // Event handlers for popup buttons
      document.getElementById('scada-dp-btn-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.activeInstance) return;
        this.activeInstance.viewMonth--;
        if (this.activeInstance.viewMonth < 0) {
          this.activeInstance.viewMonth = 11;
          this.activeInstance.viewYear--;
        }
        this.renderCalendar();
      });

      document.getElementById('scada-dp-btn-next').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.activeInstance) return;
        this.activeInstance.viewMonth++;
        if (this.activeInstance.viewMonth > 11) {
          this.activeInstance.viewMonth = 0;
          this.activeInstance.viewYear++;
        }
        this.renderCalendar();
      });

      document.getElementById('scada-dp-btn-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.activeInstance) return;
        this.activeInstance.clear();
        this.close();
      });

      document.getElementById('scada-dp-btn-today').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.activeInstance) return;
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        this.activeInstance.setDate(`${yyyy}-${mm}-${dd}`);
        this.close();
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!this.activeInstance) return;
        if (!e.target.closest('.scada-datepicker-popup') && !e.target.closest('.scada-datepicker-wrap')) {
          this.close();
        }
      });

      // Close on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeInstance) {
          this.close();
        }
      });
    },

    attach(inputEl, options = {}) {
      if (!inputEl) return null;
      if (inputEl._scadaDatePickerAttached) return inputEl._scadaDatePicker;
      this.init();

      // Wrap input with calendar trigger icon
      const wrapper = document.createElement('div');
      wrapper.className = 'scada-datepicker-wrap';
      if (inputEl.style.width) wrapper.style.width = inputEl.style.width;
      if (inputEl.style.flex) wrapper.style.flex = inputEl.style.flex;

      inputEl.parentNode.insertBefore(wrapper, inputEl);
      wrapper.appendChild(inputEl);

      const calIcon = document.createElement('i');
      calIcon.className = 'ri-calendar-line scada-dp-icon';
      wrapper.appendChild(calIcon);

      inputEl.readOnly = true;
      inputEl.style.cursor = 'pointer';
      inputEl.style.paddingRight = '30px';

      const instance = {
        inputEl,
        wrapper,
        viewYear: new Date().getFullYear(),
        viewMonth: new Date().getMonth(),

        getDate() {
          return inputEl.value.trim();
        },

        setDate(dateStr) {
          inputEl.value = dateStr || '';
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          if (window.sounds) window.sounds.playClick();
        },

        clear() {
          inputEl.value = '';
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          if (window.sounds) window.sounds.playClick();
        },

        open() {
          scadaDropdown.closeAll();
          scadaDatePicker.openFor(this);
        }
      };

      const handleOpen = (e) => {
        e.stopPropagation();
        instance.open();
      };

      inputEl.addEventListener('click', handleOpen);
      calIcon.addEventListener('click', handleOpen);

      inputEl._scadaDatePickerAttached = true;
      inputEl._scadaDatePicker = instance;
      this.instances.set(inputEl, instance);

      return instance;
    },

    openFor(instance) {
      this.activeInstance = instance;
      const curDateStr = instance.getDate();
      if (curDateStr && /^\d{4}-\d{2}-\d{2}$/.test(curDateStr)) {
        const parts = curDateStr.split('-');
        instance.viewYear = parseInt(parts[0], 10);
        instance.viewMonth = parseInt(parts[1], 10) - 1;
      } else {
        const now = new Date();
        instance.viewYear = now.getFullYear();
        instance.viewMonth = now.getMonth();
      }

      this.renderCalendar();

      // Position popup below input
      const rect = instance.inputEl.getBoundingClientRect();
      const popup = this.popupEl;
      popup.style.display = 'block';

      const popupHeight = popup.offsetHeight || 280;
      const popupWidth = popup.offsetWidth || 260;

      let top = rect.bottom + window.scrollY + 4;
      let left = rect.left + window.scrollX;

      // Ensure it doesn't overflow viewport
      if (left + popupWidth > window.innerWidth - 10) {
        left = window.innerWidth - popupWidth - 10;
      }
      if (top + popupHeight > window.innerHeight + window.scrollY - 10) {
        top = rect.top + window.scrollY - popupHeight - 4;
      }

      popup.style.top = `${Math.max(10, top)}px`;
      popup.style.left = `${Math.max(10, left)}px`;
    },

    close() {
      if (this.popupEl) this.popupEl.style.display = 'none';
      this.activeInstance = null;
    },

    renderCalendar() {
      if (!this.activeInstance) return;
      const inst = this.activeInstance;
      const year = inst.viewYear;
      const month = inst.viewMonth;

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      const titleEl = document.getElementById('scada-dp-title');
      if (titleEl) titleEl.textContent = `${monthNames[month]} ${year}`;

      const gridEl = document.getElementById('scada-dp-grid');
      if (!gridEl) return;
      gridEl.innerHTML = '';

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      const currentDateStr = inst.getDate();
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // 1. Previous month trailing days
      for (let i = firstDay - 1; i >= 0; i--) {
        const d = daysInPrevMonth - i;
        const cell = document.createElement('div');
        cell.className = 'scada-dp-cell other-month';
        cell.textContent = d;
        gridEl.appendChild(cell);
      }

      // 2. Current month days
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'scada-dp-cell';
        cell.textContent = d;

        if (dateStr === todayStr) cell.classList.add('today');
        if (dateStr === currentDateStr) cell.classList.add('selected');

        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          inst.setDate(dateStr);
          scadaDatePicker.close();
        });

        gridEl.appendChild(cell);
      }

      // 3. Next month leading days (fill 42 cells total)
      const totalCells = firstDay + daysInMonth;
      const remainingCells = (totalCells > 35 ? 42 : 35) - totalCells;
      for (let d = 1; d <= remainingCells; d++) {
        const cell = document.createElement('div');
        cell.className = 'scada-dp-cell other-month';
        cell.textContent = d;
        gridEl.appendChild(cell);
      }
    }
  };

  // Expose on window
  window.scadaDropdown = scadaDropdown;
  window.scadaDatePicker = scadaDatePicker;

})(window, document);
