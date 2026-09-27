// src/desktop/preload.js - Secure Electron Bridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openLicenseFolder: () => ipcRenderer.invoke('open-license-folder'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onWindowStateChange: (callback) => {
    ipcRenderer.on('window-state-changed', (_event, data) => callback(data));
  },
  getDesktopSecret: () => ipcRenderer.invoke('get-desktop-secret'),
  // Synchronous: read once at page load so api.js/app.js can use it immediately
  serverPort: ipcRenderer.sendSync('get-server-port-sync'),
  isElectron: true
});
