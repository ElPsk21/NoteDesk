const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  getNotesTree: () => ipcRenderer.invoke('get-notes-tree'),
  readNote: (filePath) => ipcRenderer.invoke('read-note', filePath),
  saveNote: (filePath, content) => ipcRenderer.invoke('save-note', filePath, content),
  createNote: (folderPath, fileName) => ipcRenderer.invoke('create-note', folderPath, fileName),
  createFolder: (parentFolderPath, folderName) => ipcRenderer.invoke('create-folder', parentFolderPath, folderName),
  deleteItem: (filePath) => ipcRenderer.invoke('delete-item', filePath),
  renameItem: (oldPath, newName) => ipcRenderer.invoke('rename-item', oldPath, newName),
  moveItem: (oldPath, targetFolderPath) => ipcRenderer.invoke('move-item', oldPath, targetFolderPath),
  parseMarkdown: (text) => ipcRenderer.invoke('parse-markdown', text),
  renameVault: (newName) => ipcRenderer.invoke('rename-vault', newName),
  showItemContextMenu: (filePath, isDirectory) => ipcRenderer.send('show-item-context-menu', filePath, isDirectory),
  onContextMenuCommand: (callback) => ipcRenderer.on('context-menu-command', (event, data) => callback(data)),
  openVaultDialog: () => ipcRenderer.invoke('open-vault-dialog'),
  getVaultTags: () => ipcRenderer.invoke('get-vault-tags'),
});


