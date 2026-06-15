const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');

// Configure marked options
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Disable indented code blocks to allow leading spaces for visual outline indentation, and add Wikilink support
marked.use({
  tokenizer: {
    code(src) {
      return undefined;
    }
  },
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src) { return src.indexOf('[['); },
      tokenizer(src, tokens) {
        const rule = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
        const match = rule.exec(src);
        if (match) {
          return {
            type: 'wikilink',
            raw: match[0],
            noteName: match[1].trim(),
            label: match[2] ? match[2].trim() : match[1].trim()
          };
        }
      },
      renderer(token) {
        return `<a class="wikilink" href="#" data-target="${encodeURIComponent(token.noteName)}">${token.label}</a>`;
      }
    }
  ]
});



let configFilePath = '';
let config = {};
let vaultPath = '';

function loadConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = fs.readFileSync(configFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return {};
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(configFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

function initializeConfigAndVault() {
  if (app.isPackaged) {
    configFilePath = path.join(app.getPath('userData'), 'config.json');
  } else {
    configFilePath = path.join(__dirname, 'config.json');
  }

  config = loadConfig();

  if (config.vaultPath) {
    vaultPath = config.vaultPath;
  } else {
    if (app.isPackaged) {
      vaultPath = path.join(app.getPath('documents'), 'NoteDesk Bóveda');
    } else {
      vaultPath = path.join(__dirname, 'vault');
    }
    config.vaultPath = vaultPath;
    saveConfig(config);
  }

  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e1e', // Prevents bright white flash during load
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide the default application menu bar (File, Edit, View, Window...)
  mainWindow.setMenu(null);

  // Load the index.html from the src directory
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open the DevTools if needed during development
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  initializeConfigAndVault();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Helper: build tree recursively
function buildFileTree(dirPath) {
  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    return null;
  }
  const name = path.basename(dirPath);
  const files = fs.readdirSync(dirPath);
  const children = [];

  for (const file of files) {
    if (file.startsWith('.')) continue; // skip hidden files/directories
    const fullPath = path.join(dirPath, file);
    const fileStats = fs.statSync(fullPath);

    if (fileStats.isDirectory()) {
      const childTree = buildFileTree(fullPath);
      if (childTree) {
        children.push(childTree);
      }
    } else if (fileStats.isFile() && (file.toLowerCase().endsWith('.md') || file.toLowerCase().endsWith('.txt'))) {
      children.push({
        name: file,
        path: fullPath,
        type: 'file',
      });
    }
  }

  // Sort: directories first, then files, both alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    name: name,
    path: dirPath,
    type: 'directory',
    children: children,
  };
}

// IPC Handlers
ipcMain.handle('get-vault-path', () => {
  return vaultPath;
});

ipcMain.handle('parse-markdown', async (event, text) => {
  return marked.parse(text);
});

ipcMain.handle('get-notes-tree', async () => {
  const tree = buildFileTree(vaultPath);
  return tree ? tree.children : [];
});

ipcMain.handle('read-note', async (event, filePath) => {
  // Validate path is inside the vault for safety
  if (!filePath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }
  return await fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('save-note', async (event, filePath, content) => {
  if (!filePath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }
  await fs.promises.writeFile(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('create-note', async (event, parentFolderPath, fileName) => {
  const targetFolder = parentFolderPath || vaultPath;
  if (!targetFolder.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }

  let baseName = fileName.trim();
  if (!baseName) {
    baseName = 'Sin Título';
  }
  if (!baseName.endsWith('.md')) {
    baseName += '.md';
  }

  let targetPath = path.join(targetFolder, baseName);
  let counter = 1;
  while (fs.existsSync(targetPath)) {
    const ext = '.md';
    const base = path.basename(baseName, ext);
    targetPath = path.join(targetFolder, `${base} (${counter})${ext}`);
    counter++;
  }

  const defaultContent = `# ${path.basename(targetPath, '.md')}\n\n`;
  await fs.promises.writeFile(targetPath, defaultContent, 'utf-8');
  return targetPath;
});

ipcMain.handle('create-folder', async (event, parentFolderPath, folderName) => {
  const targetFolder = parentFolderPath || vaultPath;
  if (!targetFolder.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }

  let baseName = folderName.trim();
  if (!baseName) {
    baseName = 'Nueva Carpeta';
  }

  let targetPath = path.join(targetFolder, baseName);
  let counter = 1;
  while (fs.existsSync(targetPath)) {
    targetPath = path.join(targetFolder, `${baseName} (${counter})`);
    counter++;
  }

  await fs.promises.mkdir(targetPath, { recursive: true });
  return targetPath;
});

ipcMain.handle('delete-item', async (event, filePath) => {
  if (!filePath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }

  try {
    await shell.trashItem(filePath);
    return { success: true };
  } catch (err) {
    // Fallback if trash system isn't available
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      await fs.promises.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(filePath);
    }
    return { success: true };
  }
});

ipcMain.handle('rename-item', async (event, oldPath, newName) => {
  if (!oldPath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }

  const cleanName = newName.trim();
  if (!cleanName) {
    throw new Error('Nombre inválido.');
  }

  const stats = fs.statSync(oldPath);
  const dir = path.dirname(oldPath);
  let targetName = cleanName;

  if (stats.isFile() && !cleanName.toLowerCase().endsWith('.md') && !cleanName.toLowerCase().endsWith('.txt')) {
    const ext = path.extname(oldPath);
    targetName = cleanName + ext;
  }

  const newPath = path.join(dir, targetName);

  if (fs.existsSync(newPath)) {
    throw new Error('Ya existe un archivo o carpeta con ese nombre.');
  }

  await fs.promises.rename(oldPath, newPath);
  return newPath;
});

ipcMain.handle('move-item', async (event, oldPath, targetFolderPath) => {
  if (!oldPath.startsWith(vaultPath) || !targetFolderPath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }

  // Prevent moving a folder inside itself or its own subfolders
  const relative = path.relative(oldPath, targetFolderPath);
  const isSubdir = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (isSubdir || oldPath === targetFolderPath) {
    throw new Error('No puedes mover una carpeta dentro de sí misma.');
  }

  const itemName = path.basename(oldPath);
  let targetPath = path.join(targetFolderPath, itemName);

  // If the target path is identical to the current path, do nothing
  if (oldPath === targetPath) {
    return oldPath;
  }

  // Handle name collisions in the target folder
  if (fs.existsSync(targetPath)) {
    const ext = path.extname(itemName);
    const base = path.basename(itemName, ext);
    let counter = 1;
    if (ext) { // File
      while (fs.existsSync(targetPath)) {
        targetPath = path.join(targetFolderPath, `${base} (${counter})${ext}`);
        counter++;
      }
    } else { // Directory
      while (fs.existsSync(targetPath)) {
        targetPath = path.join(targetFolderPath, `${itemName} (${counter})`);
        counter++;
      }
    }
  }

  await fs.promises.rename(oldPath, targetPath);
  return targetPath;
});

ipcMain.handle('rename-vault', async (event, newName) => {
  const cleanName = newName.trim();
  if (!cleanName) {
    throw new Error('Nombre de bóveda inválido.');
  }

  if (/[\\/:*?"<>|]/.test(cleanName)) {
    throw new Error('El nombre no puede contener caracteres inválidos: \\ / : * ? " < > |');
  }

  const parentDir = path.dirname(vaultPath);
  const newVaultPath = path.join(parentDir, cleanName);

  if (fs.existsSync(newVaultPath)) {
    throw new Error('Ya existe una carpeta con ese nombre.');
  }

  await fs.promises.rename(vaultPath, newVaultPath);
  
  vaultPath = newVaultPath;
  config.vaultPath = vaultPath;
  saveConfig(config);

  return vaultPath;
});

ipcMain.on('show-item-context-menu', (event, filePath, isDirectory) => {
  const template = [];

  if (isDirectory) {
    template.push(
      {
        label: 'Nueva Nota',
        click: () => {
          event.sender.send('context-menu-command', { command: 'create-note', filePath });
        }
      },
      {
        label: 'Nueva Carpeta',
        click: () => {
          event.sender.send('context-menu-command', { command: 'create-folder', filePath });
        }
      },
      { type: 'separator' }
    );
  } else {
    template.push(
      {
        label: 'Abrir Nota',
        click: () => {
          event.sender.send('context-menu-command', { command: 'open-note', filePath });
        }
      },
      { type: 'separator' }
    );
  }

  template.push(
    {
      label: 'Renombrar',
      click: () => {
        event.sender.send('context-menu-command', { command: 'rename-item', filePath });
      }
    },
    {
      label: 'Eliminar',
      click: () => {
        event.sender.send('context-menu-command', { command: 'delete-item', filePath });
      }
    },
    { type: 'separator' },
    {
      label: 'Mostrar en el explorador de archivos',
      click: () => {
        if (isDirectory) {
          shell.openPath(filePath);
        } else {
          shell.showItemInFolder(filePath);
        }
      }
    }
  );

  const menu = Menu.buildFromTemplate(template);
  const win = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: win });
});

// Helper to recursively scan tags in files
function scanTagsRecursively(dirPath, tagMap = {}) {
  try {
    if (!fs.existsSync(dirPath)) return tagMap;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        scanTagsRecursively(fullPath, tagMap);
      } else if (stats.isFile() && (file.toLowerCase().endsWith('.md') || file.toLowerCase().endsWith('.txt'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Match hashtags like #tag, excluding headers (# Heading) and hex colors (#123)
        const regex = /(?:^|\s)#([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ]+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const tagName = '#' + match[1];
          // Skip standard CSS hex colors
          if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(tagName)) {
            continue;
          }
          if (!tagMap[tagName]) {
            tagMap[tagName] = [];
          }
          if (!tagMap[tagName].some(f => f.path === fullPath)) {
            tagMap[tagName].push({
              name: file,
              path: fullPath
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Error scanning tags in:', dirPath, err);
  }
  return tagMap;
}

ipcMain.handle('open-vault-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Seleccionar Carpeta de Bóveda',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];

  // Update vaultPath and configuration
  vaultPath = selectedPath;
  config.vaultPath = vaultPath;
  saveConfig(config);

  return vaultPath;
});

ipcMain.handle('get-vault-tags', async () => {
  const tagMap = scanTagsRecursively(vaultPath);
  return tagMap;
});

// Helper to recursively scan backlinks pointing to a note
function scanBacklinksRecursively(dirPath, targetNoteName, targetFilePath, backlinks = []) {
  try {
    if (!fs.existsSync(dirPath)) return backlinks;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        scanBacklinksRecursively(fullPath, targetNoteName, targetFilePath, backlinks);
      } else if (stats.isFile() && (file.toLowerCase().endsWith('.md') || file.toLowerCase().endsWith('.txt'))) {
        // Skip the target note itself to prevent self-linking
        if (fullPath.toLowerCase() === targetFilePath.toLowerCase()) {
          continue;
        }
        
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        const contexts = [];
        let fileHasLink = false;
        
        // Find wikilinks like [[Note Name]] or [[Note Name|Label]]
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
          let match;
          while ((match = regex.exec(line)) !== null) {
            const linkedNoteName = match[1].trim().toLowerCase();
            if (linkedNoteName === targetNoteName) {
              fileHasLink = true;
              contexts.push({
                line: i + 1,
                text: line.trim()
              });
            }
          }
        }
        
        if (fileHasLink) {
          backlinks.push({
            name: file,
            path: fullPath,
            contexts: contexts
          });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning backlinks in:', dirPath, err);
  }
  return backlinks;
}

ipcMain.handle('get-backlinks', async (event, filePath) => {
  if (!filePath) return [];
  if (!filePath.startsWith(vaultPath)) {
    throw new Error('Access denied: path is outside the vault.');
  }
  const ext = path.extname(filePath);
  const targetNoteName = path.basename(filePath, ext).trim().toLowerCase();
  
  return scanBacklinksRecursively(vaultPath, targetNoteName, filePath);
});
