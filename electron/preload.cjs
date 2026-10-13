// What the desktop app adds to the page: the shared projects folder. Nothing else of
// the computer is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('takeoffDesktop', {
  platform: process.platform,
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  revealFolder: () => ipcRenderer.invoke('folder:reveal'),
  list: () => ipcRenderer.invoke('folder:list'),
  dirFor: (name, id) => ipcRenderer.invoke('folder:dirFor', name, id),
  read: (dir) => ipcRenderer.invoke('folder:read', dir),
  write: (dir, json, meta) => ipcRenderer.invoke('folder:write', dir, json, meta),
  hasPdf: (dir, docId) => ipcRenderer.invoke('folder:hasPdf', dir, docId),
  readPdf: (dir, docId) => ipcRenderer.invoke('folder:readPdf', dir, docId),
  writePdf: (dir, docId, data) => ipcRenderer.invoke('folder:writePdf', dir, docId, data),
  trash: (dir) => ipcRenderer.invoke('folder:trash', dir),
});
