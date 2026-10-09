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
  isElectron: true,
  // Print an HTML string to PDF (Electron-native, no print dialog)
  printToPDF: (html, filename) => ipcRenderer.invoke('print-to-pdf', { html, filename }),
  // Open external link or mailto in default OS application
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Direct legal markdown file reader
  readLegalDocument: (docType) => ipcRenderer.invoke('read-legal-document', docType),
  // Native OS Save File dialog for CSV and other exports
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options)
});
