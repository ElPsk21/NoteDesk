// --- CodeMirror 6 Editor ---
import { createEditor, getContent, setContent, focusEditor } from './editor.js';

// --- Application State ---
let currentFilePath = null;
let currentFileContent = '';
let isUnsaved = false;
let saveTimeout = null;
let collapsedFolders = new Set();
let fileTreeData = [];
let viewMode = 'edit'; // 'edit', 'preview', 'split'
let selectedFolderPath = null; // Track currently selected folder for creation targets
let editorView = null; // CodeMirror EditorView instance

// --- Path Comparison Helpers ---
function isPathEqual(pathA, pathB) {
  if (!pathA || !pathB) return false;
  return pathA.toLowerCase().replace(/\\/g, '/') === pathB.toLowerCase().replace(/\\/g, '/');
}

function isPathSubpath(activePath, targetPath) {
  if (!activePath || !targetPath) return false;
  const normActive = activePath.toLowerCase().replace(/\\/g, '/');
  const normTarget = targetPath.toLowerCase().replace(/\\/g, '/');
  return normActive === normTarget || normActive.startsWith(normTarget + '/');
}

// --- Element Cache ---
const el = {
  vaultTitle: document.getElementById('vault-title'),
  vaultInfo: document.querySelector('.vault-info'),
  fileExplorer: document.getElementById('file-explorer'),
  welcomePane: document.getElementById('welcome-pane'),
  editorPane: document.getElementById('editor-pane'),
  noteTitleDisplay: document.getElementById('note-title-display'),
  noteTitleInput: document.getElementById('note-title-input'),
  saveStatus: document.getElementById('save-status'),
  codemirrorHost: document.getElementById('codemirror-host'),
  markdownPreview: document.getElementById('markdown-preview'),
  paneContent: document.getElementById('pane-content'),
  statusVaultPath: document.getElementById('status-vault-path'),
  statusWordCount: document.getElementById('status-word-count'),
  statusCharCount: document.getElementById('status-char-count'),
  searchInput: document.getElementById('search-input'),
  btnNewFile: document.getElementById('btn-new-file'),
  btnNewFolder: document.getElementById('btn-new-folder'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnWelcomeNewFile: document.getElementById('btn-welcome-new-file'),
  btnModeEdit: document.getElementById('btn-mode-edit'),
  btnModeSplit: document.getElementById('btn-mode-split'),
  btnModePreview: document.getElementById('btn-mode-preview'),
  
  // Modals
  modalContainer: document.getElementById('modal-container'),
  modalTitle: document.getElementById('modal-title'),
  modalInput: document.getElementById('modal-input'),
  modalError: document.getElementById('modal-error'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalConfirm: document.getElementById('btn-modal-confirm')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize CodeMirror 6 editor
  editorView = createEditor(el.codemirrorHost, {
    onChange: (content) => {
      updateWordCount(content);
      if (viewMode === 'preview' || viewMode === 'split') {
        updatePreview(content);
      }
      queueAutoSave();
    },
  });

  setupEventListeners();
  await loadVaultInfo();
  await refreshFileExplorer();
});

// Load basic vault information
async function loadVaultInfo() {
  try {
    const vaultPath = await window.api.getVaultPath();
    // Show last folder name as vault title
    const parts = vaultPath.split(/[\\/]/);
    const vaultName = parts[parts.length - 1] || 'Bóveda';
    el.vaultTitle.textContent = vaultName;
    el.statusVaultPath.textContent = `Bóveda: ${vaultPath}`;
  } catch (err) {
    console.error('Error al obtener ruta del vault:', err);
    el.statusVaultPath.textContent = 'Error al conectar la bóveda';
  }
}

// Fetch and render the latest file tree
async function refreshFileExplorer() {
  try {
    fileTreeData = await window.api.getNotesTree();
    renderFileExplorer();
  } catch (err) {
    console.error('Error al actualizar el explorador de archivos:', err);
  }
}

// --- File Explorer Tree Rendering ---
function renderFileExplorer() {
  el.fileExplorer.innerHTML = '';
  const searchVal = el.searchInput.value.trim();
  
  let matchingPaths = null;
  if (searchVal) {
    matchingPaths = getSearchMatchPaths(fileTreeData, searchVal);
  }

  if (fileTreeData.length === 0) {
    el.fileExplorer.innerHTML = `
      <div class="empty-explorer">
        <svg class="empty-explorer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <span class="empty-explorer-text">La bóveda está vacía</span>
        <button id="btn-empty-create" class="btn-empty-action">Crear Nota</button>
      </div>
    `;
    document.getElementById('btn-empty-create').addEventListener('click', () => handleCreateNote());
    return;
  }

  const fragment = document.createDocumentFragment();
  renderTreeNodes(fileTreeData, fragment, 0, matchingPaths);
  el.fileExplorer.appendChild(fragment);
}

// Recursively render node items
function renderTreeNodes(nodes, container, depth = 0, matchingPaths = null) {
  nodes.forEach(node => {
    // If filtering, only render matching nodes or parents of matching nodes
    if (matchingPaths && !matchingPaths.has(node.path)) {
      return;
    }

    const nodeRow = document.createElement('div');
    nodeRow.className = `tree-row ${node.type === 'directory' ? 'directory-node' : 'file-node'}`;
    if (isPathEqual(node.path, currentFilePath)) {
      nodeRow.classList.add('active');
    }
    if (node.path === selectedFolderPath && node.type === 'directory') {
      nodeRow.classList.add('selected-folder');
    }

    nodeRow.style.paddingLeft = `${8 + depth * 12}px`;
    nodeRow.dataset.path = node.path;
    nodeRow.dataset.type = node.type;

    // Drag and Drop settings
    nodeRow.draggable = true;
    nodeRow.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', node.path);
      e.dataTransfer.effectAllowed = 'move';
      nodeRow.classList.add('dragging');
    });

    nodeRow.addEventListener('dragend', (e) => {
      e.stopPropagation();
      nodeRow.classList.remove('dragging');
    });

    if (node.type === 'directory') {
      nodeRow.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        nodeRow.classList.add('drag-over');
      });

      nodeRow.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        nodeRow.classList.remove('drag-over');
      });

      nodeRow.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        nodeRow.classList.remove('drag-over');
        
        const draggedPath = e.dataTransfer.getData('text/plain');
        if (draggedPath && draggedPath !== node.path) {
          try {
            const newPath = await window.api.moveItem(draggedPath, node.path);
            
            // If the moved item is the current file, update its loaded path
            if (currentFilePath === draggedPath) {
              currentFilePath = newPath;
              const parts = newPath.split(/[\\/]/);
              const name = parts[parts.length - 1];
              el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
            }
            
            await refreshFileExplorer();
          } catch (err) {
            console.error(err);
            showNotification(err.message, 'error');
          }
        }
      });
    }

    // Chevron (for folders)
    if (node.type === 'directory') {
      const isCollapsed = collapsedFolders.has(node.path);
      const chevron = document.createElement('span');
      chevron.className = `chevron-wrapper`;
      chevron.innerHTML = `
        <svg class="chevron ${isCollapsed ? 'collapsed' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;
      nodeRow.appendChild(chevron);
    } else {
      // Spacer instead of chevron for alignment
      const spacer = document.createElement('span');
      spacer.className = 'tree-indent';
      nodeRow.appendChild(spacer);
    }

    // Type Icon
    const iconSpan = document.createElement('span');
    iconSpan.className = 'node-icon';
    if (node.type === 'directory') {
      iconSpan.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    } else {
      iconSpan.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `;
    }
    nodeRow.appendChild(iconSpan);

    // Label (Remove .md extension for display if it's a file)
    const labelSpan = document.createElement('span');
    labelSpan.className = 'node-name';
    labelSpan.textContent = node.type === 'file' ? node.name.replace(/\.md$/, '') : node.name;
    nodeRow.appendChild(labelSpan);

    // Quick Action Hover Buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'node-actions';
    
    // Add file inside folder (only for folders)
    if (node.type === 'directory') {
      const addFileBtn = document.createElement('button');
      addFileBtn.className = 'btn-node-action';
      addFileBtn.title = 'Nueva Nota aquí';
      addFileBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      `;
      addFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCreateNote(node.path);
      });
      actionsDiv.appendChild(addFileBtn);
    }

    // Rename Button
    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-node-action';
    renameBtn.title = 'Renombrar';
    renameBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
    `;
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRenameNode(node.path, node.name);
    });
    actionsDiv.appendChild(renameBtn);

    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-node-action';
    deleteBtn.title = 'Mover a la Papelera';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteNode(node.path, node.name);
    });
    actionsDiv.appendChild(deleteBtn);

    nodeRow.appendChild(actionsDiv);

    // Row Click Interaction
    nodeRow.addEventListener('click', (e) => {
      if (node.type === 'directory') {
        const isCollapsed = collapsedFolders.has(node.path);
        if (isCollapsed) {
          collapsedFolders.delete(node.path);
        } else {
          collapsedFolders.add(node.path);
        }
        selectedFolderPath = node.path;
        renderFileExplorer();
      } else {
        openNote(node.path);
      }
    });

    // Right-Click Context Menu Interaction
    nodeRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.api.showItemContextMenu(node.path, node.type === 'directory');
    });

    container.appendChild(nodeRow);

    // Recursively render children if folder is expanded
    if (node.type === 'directory') {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      
      const isCollapsed = collapsedFolders.has(node.path);
      // Force open children if we are active in a search
      if (isCollapsed && !matchingPaths) {
        childrenContainer.classList.add('collapsed');
      }

      renderTreeNodes(node.children, childrenContainer, depth + 1, matchingPaths);
      container.appendChild(childrenContainer);
    }
  });
}

// --- Search Filter Matching helper ---
function getSearchMatchPaths(nodes, query) {
  const lowercaseQuery = query.toLowerCase();
  const matchedPaths = new Set();

  function checkNode(node) {
    let matchesSelf = node.name.toLowerCase().includes(lowercaseQuery);
    let matchesChildren = false;

    if (node.type === 'directory') {
      node.children.forEach(child => {
        if (checkNode(child)) {
          matchesChildren = true;
        }
      });
    }

    if (matchesSelf || matchesChildren) {
      matchedPaths.add(node.path);
      return true;
    }
    return false;
  }

  nodes.forEach(checkNode);
  return matchedPaths;
}

// --- Note File Loading and Saving ---
async function openNote(filePath) {
  // If there's unsaved changes, prompt save first
  if (isUnsaved) {
    await saveCurrentNoteImmediately();
  }

  try {
    const content = await window.api.readNote(filePath);
    currentFilePath = filePath;
    currentFileContent = content;
    isUnsaved = false;
    
    // Set UI states
    const parts = filePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    el.noteTitleDisplay.textContent = fileName.replace(/\.md$/, '');
    
    setContent(editorView, content);
    updateWordCount(content);
    updatePreview(content);
    
    el.welcomePane.classList.add('hidden');
    el.editorPane.classList.remove('hidden');
    
    el.saveStatus.textContent = 'Guardado';
    el.saveStatus.classList.remove('unsaved');
    
    // Refresh explorer to mark active node
    renderFileExplorer();
  } catch (err) {
    console.error('Error al abrir la nota:', err);
    showNotification('No se pudo abrir la nota seleccionada.', 'error');
  }
}

async function saveCurrentNoteImmediately() {
  if (!currentFilePath) return;
  clearTimeout(saveTimeout);
  
  try {
    const content = getContent(editorView);
    await window.api.saveNote(currentFilePath, content);
    currentFileContent = content;
    isUnsaved = false;
    
    el.saveStatus.textContent = 'Guardado';
    el.saveStatus.classList.remove('unsaved');
  } catch (err) {
    console.error('Error al guardar:', err);
    el.saveStatus.textContent = 'Error al guardar';
  }
}

// Debounced auto-save
function queueAutoSave() {
  if (!currentFilePath) return;
  
  isUnsaved = true;
  el.saveStatus.textContent = 'Modificado';
  el.saveStatus.classList.add('unsaved');
  
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveCurrentNoteImmediately();
  }, 800);
}

// Update Markdown Preview
async function updatePreview(markdownText) {
  try {
    const html = await window.api.parseMarkdown(markdownText || '');
    el.markdownPreview.innerHTML = html;
  } catch (err) {
    el.markdownPreview.innerHTML = `<p style="color: red;">Error al procesar Markdown: ${err.message}</p>`;
  }
}

// Word & Char counts
function updateWordCount(text) {
  const cleanText = text.trim();
  const words = cleanText ? cleanText.split(/\s+/).filter(w => w.length > 0).length : 0;
  const chars = text.length;

  el.statusWordCount.textContent = `${words} palabra${words === 1 ? '' : 's'}`;
  el.statusCharCount.textContent = `${chars} caracter${chars === 1 ? '' : 'es'}`;
  
  el.statusWordCount.classList.remove('hidden');
  el.statusCharCount.classList.remove('hidden');
}

// --- Note & Folder Actions ---
async function handleCreateNote(targetFolder = null) {
  const name = await showPromptModal('Crear Nueva Nota', 'Nota sin título');
  if (name === null) return; // cancelled
  
  try {
    const folder = targetFolder || selectedFolderPath || null;
    const newPath = await window.api.createNote(folder, name);
    await refreshFileExplorer();
    await openNote(newPath);
  } catch (err) {
    console.error(err);
    showNotification(err.message, 'error');
  }
}

async function handleCreateFolder() {
  const name = await showPromptModal('Crear Nueva Carpeta', 'Carpeta sin título');
  if (name === null) return; // cancelled

  try {
    const parent = selectedFolderPath || null;
    await window.api.createFolder(parent, name);
    await refreshFileExplorer();
  } catch (err) {
    console.error(err);
    showNotification(err.message, 'error');
  }
}

async function handleRenameNode(itemPath, currentName) {
  const cleanName = currentName.replace(/\.md$/, '');
  const newName = await showPromptModal('Renombrar', cleanName);
  if (newName === null) return; // cancelled

  try {
    const isFile = itemPath.endsWith('.md') || itemPath.endsWith('.txt');
    const newPath = await window.api.renameItem(itemPath, newName);
    
    // If renaming active file, reload details
    if (isPathEqual(currentFilePath, itemPath)) {
      currentFilePath = newPath;
      const parts = newPath.split(/[\\/]/);
      const name = parts[parts.length - 1];
      el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
    }

    await refreshFileExplorer();
  } catch (err) {
    console.error(err);
    showNotification(err.message, 'error');
  }
}

async function handleDeleteNode(itemPath, itemName) {
  const confirmed = await showConfirmModal('Eliminar', `¿Estás seguro de que deseas mover "${itemName}" a la papelera?`);
  if (!confirmed) return;

  try {
    await window.api.deleteItem(itemPath);
    
    // If active note (or its parent directory) was deleted, clear workspace
    if (isPathSubpath(currentFilePath, itemPath)) {
      currentFilePath = null;
      currentFileContent = '';
      isUnsaved = false;
      el.editorPane.classList.add('hidden');
      el.welcomePane.classList.remove('hidden');
      el.statusWordCount.classList.add('hidden');
      el.statusCharCount.classList.add('hidden');
    }

    await refreshFileExplorer();
  } catch (err) {
    console.error(err);
    showNotification(err.message, 'error');
  }
}

// --- View Modes Setup ---
function setViewMode(mode) {
  viewMode = mode;
  
  // Update switcher styling
  el.btnModeEdit.classList.toggle('active', mode === 'edit');
  el.btnModeSplit.classList.toggle('active', mode === 'split');
  el.btnModePreview.classList.toggle('active', mode === 'preview');
  
  // Update wrapper pane view styling
  el.paneContent.className = `pane-content mode-${mode}`;
  
  // If moving into a mode with preview, update it immediately
  if (mode === 'preview' || mode === 'split') {
    updatePreview(getContent(editorView));
  }
}

// --- Event Listeners Wiring ---
function setupEventListeners() {
  // Vault Rename
  el.vaultInfo.addEventListener('click', async () => {
    try {
      const currentPath = await window.api.getVaultPath();
      const parts = currentPath.split(/[\\/]/);
      const currentName = parts[parts.length - 1];

      const newName = await showPromptModal('Renombrar Bóveda (Carpeta raíz)', currentName);
      if (newName && newName !== currentName) {
        const newPath = await window.api.renameVault(newName);

        // Update active file path in state if open
        if (currentFilePath) {
          // Normalize paths for replacement
          const normCurrent = currentPath.toLowerCase().replace(/\\/g, '/');
          const normNew = newPath.toLowerCase().replace(/\\/g, '/');
          const normFilePath = currentFilePath.toLowerCase().replace(/\\/g, '/');
          
          if (normFilePath.startsWith(normCurrent)) {
            // Reconstruct absolute path preserving original case structure outside vault
            currentFilePath = newPath + currentFilePath.slice(currentPath.length);
          }
        }

        await loadVaultInfo();
        await refreshFileExplorer();
        showNotification('Bóveda renombrada correctamente.', 'success');
      }
    } catch (err) {
      console.error(err);
      showNotification(err.message, 'error');
    }
  });

  // Search bar
  el.searchInput.addEventListener('input', () => {
    renderFileExplorer();
  });

  // Drag over empty space in file explorer (move to root vault)
  el.fileExplorer.addEventListener('dragover', (e) => {
    e.preventDefault();
    const targetRow = e.target.closest('.tree-row');
    if (!targetRow || targetRow.dataset.type !== 'directory') {
      el.fileExplorer.classList.add('drag-over');
    } else {
      el.fileExplorer.classList.remove('drag-over');
    }
  });

  el.fileExplorer.addEventListener('dragleave', (e) => {
    if (!el.fileExplorer.contains(e.relatedTarget)) {
      el.fileExplorer.classList.remove('drag-over');
    }
  });

  el.fileExplorer.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.fileExplorer.classList.remove('drag-over');

    const targetRow = e.target.closest('.tree-row');
    if (targetRow && targetRow.dataset.type === 'directory') {
      return; // Handled by node row listener
    }

    const draggedPath = e.dataTransfer.getData('text/plain');
    if (draggedPath) {
      try {
        const vaultPath = await window.api.getVaultPath();
        const newPath = await window.api.moveItem(draggedPath, vaultPath);

        if (isPathEqual(currentFilePath, draggedPath)) {
          currentFilePath = newPath;
          const parts = newPath.split(/[\\/]/);
          const name = parts[parts.length - 1];
          el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
        }

        await refreshFileExplorer();
      } catch (err) {
        console.error(err);
        showNotification(err.message, 'error');
      }
    }
  });

  // Action Buttons
  el.btnNewFile.addEventListener('click', () => handleCreateNote());
  el.btnNewFolder.addEventListener('click', () => handleCreateFolder());
  el.btnRefresh.addEventListener('click', () => {
    refreshFileExplorer();
    loadVaultInfo();
  });
  el.btnWelcomeNewFile.addEventListener('click', () => handleCreateNote());

  // Mode triggers
  el.btnModeEdit.addEventListener('click', () => setViewMode('edit'));
  el.btnModeSplit.addEventListener('click', () => setViewMode('split'));
  el.btnModePreview.addEventListener('click', () => setViewMode('preview'));

  // Editor input/tab handling is managed by CodeMirror 6 via the onChange callback

  // Double click file title to rename in header
  el.noteTitleDisplay.addEventListener('dblclick', () => {
    if (!currentFilePath) return;
    const parts = currentFilePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    handleRenameNode(currentFilePath, fileName);
  });

  // Keyboard Shortcuts (Ctrl+S, Ctrl+N, Ctrl+Alt+P)
  window.addEventListener('keydown', async (e) => {
    // Ctrl + S: Manual Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (currentFilePath && isUnsaved) {
        await saveCurrentNoteImmediately();
      }
    }
    
    // Ctrl + N: New note
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      handleCreateNote();
    }

    // Ctrl + Alt + P: Toggle Split View
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'p') {
      e.preventDefault();
      if (viewMode !== 'split') {
        setViewMode('split');
      } else {
        setViewMode('edit');
      }
    }
  });

  // Handle commands sent from native context menu click
  window.api.onContextMenuCommand(async ({ command, filePath }) => {
    if (command === 'open-note') {
      await openNote(filePath);
    } else if (command === 'rename-item') {
      const parts = filePath.split(/[\\/]/);
      const name = parts[parts.length - 1];
      await handleRenameNode(filePath, name);
    } else if (command === 'delete-item') {
      const parts = filePath.split(/[\\/]/);
      const name = parts[parts.length - 1];
      await handleDeleteNode(filePath, name);
    } else if (command === 'create-note') {
      await handleCreateNote(filePath);
    } else if (command === 'create-folder') {
      await handleCreateFolder(filePath);
    }
  });
}

// --- Custom Prompt & Confirm Modal Logic ---
function showPromptModal(title, defaultValue = '') {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalInput.classList.remove('hidden');
    el.modalInput.value = defaultValue;
    el.modalError.classList.add('hidden');
    el.modalContainer.classList.remove('hidden');
    
    el.modalInput.focus();
    el.modalInput.select();

    function cleanup() {
      el.modalContainer.classList.add('hidden');
      el.btnModalConfirm.removeEventListener('click', onConfirm);
      el.btnModalCancel.removeEventListener('click', onCancel);
      el.modalInput.removeEventListener('keydown', onKeyDown);
    }

    function onConfirm() {
      const val = el.modalInput.value.trim();
      if (!val) {
        el.modalError.textContent = 'El nombre no puede estar vacío.';
        el.modalError.classList.remove('hidden');
        return;
      }
      cleanup();
      resolve(val);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKeyDown(e) {
      if (e.key === 'Enter') {
        onConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    }

    el.btnModalConfirm.addEventListener('click', onConfirm);
    el.btnModalCancel.addEventListener('click', onCancel);
    el.modalInput.addEventListener('keydown', onKeyDown);
  });
}

function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalInput.classList.add('hidden');
    el.modalError.textContent = message;
    el.modalError.classList.remove('hidden');
    el.modalContainer.classList.remove('hidden');
    
    el.btnModalConfirm.focus();

    function cleanup() {
      el.modalContainer.classList.add('hidden');
      el.modalInput.classList.remove('hidden');
      el.btnModalConfirm.removeEventListener('click', onConfirm);
      el.btnModalCancel.removeEventListener('click', onCancel);
    }

    function onConfirm() {
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    el.btnModalConfirm.addEventListener('click', onConfirm);
    el.btnModalCancel.addEventListener('click', onCancel);
  });
}

function showNotification(message, type = 'success', duration = 4000) {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const messageSpan = document.createElement('span');
  messageSpan.className = 'toast-message';
  
  // Clean up Electron remote invocation error prefixes if present
  let cleanMessage = message;
  if (message.includes("Error invoking remote method")) {
    const parts = message.split('Error:');
    if (parts.length > 1) {
      cleanMessage = parts[parts.length - 1].trim();
    }
  }
  
  messageSpan.textContent = cleanMessage;
  toast.appendChild(messageSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  closeBtn.addEventListener('click', () => {
    removeToast(toast);
  });
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    removeToast(toast);
  }, duration);

  function removeToast(el) {
    el.style.animation = 'fadeOutToast 0.2s forwards';
    el.addEventListener('animationend', () => {
      el.remove();
    });
  }
}

