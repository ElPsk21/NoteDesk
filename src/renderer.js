// --- CodeMirror 6 Editor ---
import { createEditor, getContent, setContent, focusEditor, scrollToLine } from './editor.js';

// --- Application State ---
let currentFilePath = null; // Replaced by activeTabPath, but kept as a helper ref to not break other handlers directly
let currentFileContent = '';
let isUnsaved = false;
let saveTimeout = null;
let collapsedFolders = new Set();
let fileTreeData = [];
let viewMode = 'edit'; // 'edit', 'preview', 'split'
let selectedFolderPath = null; // Track currently selected folder for creation targets
let editorView = null; // CodeMirror EditorView instance

// --- Section 3 Application State ---
let openTabs = []; // Array of { path, name }
let activeTabPath = null;
let rightSidebarTab = 'outline'; // 'outline', 'tags', or 'backlinks'
let collapsedTags = new Set(); // Set of collapsed tag strings
let collapsedBacklinks = new Set(); // Set of collapsed backlink paths
let splitPercentage = 50; // Current percentage width of the editor container in split view

let lastLeftWidth = 260;
let lastRightWidth = 250;

function ensureLeftSidebarExpanded() {
  const leftSidebar = document.getElementById('left-sidebar');
  if (leftSidebar && leftSidebar.classList.contains('collapsed')) {
    leftSidebar.style.width = `${lastLeftWidth}px`;
    leftSidebar.classList.remove('collapsed');
    if (editorView) {
      setTimeout(() => editorView.requestMeasure(), 250);
    }
  }
}

function findFileInTree(nodes, fileName) {
  const cleanName = fileName.trim().toLowerCase();
  for (const node of nodes) {
    if (node.type === 'file') {
      const nodeNameNoExt = node.name.replace(/\.md$/, '').replace(/\.txt$/, '').trim().toLowerCase();
      if (nodeNameNoExt === cleanName) {
        return node.path;
      }
    } else if (node.type === 'directory') {
      const foundPath = findFileInTree(node.children, fileName);
      if (foundPath) return foundPath;
    }
  }
  return null;
}

async function handleWikilinkClick(noteName) {
  const foundPath = findFileInTree(fileTreeData, noteName);
  if (foundPath) {
    await openNote(foundPath);
  } else {
    const confirmed = await showConfirmModal(
      'Crear Nota',
      `La nota "${noteName}" no existe. ¿Deseas crearla?`
    );
    if (confirmed) {
      try {
        const folder = selectedFolderPath || null;
        const newPath = await window.api.createNote(folder, noteName);
        await refreshFileExplorer();
        await openNote(newPath);
      } catch (err) {
        console.error(err);
        showNotification(err.message, 'error');
      }
    }
  }
}

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
  editorContainer: document.getElementById('editor-container'),
  splitDivider: document.getElementById('split-divider'),
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
  
  // Section 3 Elements
  tabBar: document.getElementById('tab-bar'),
  btnOpenVault: document.getElementById('btn-open-vault'),
  btnTabOutline: document.getElementById('btn-tab-outline'),
  btnTabTags: document.getElementById('btn-tab-tags'),
  btnTabBacklinks: document.getElementById('btn-tab-backlinks'),
  outlineView: document.getElementById('outline-view'),
  tagsView: document.getElementById('tags-view'),
  backlinksView: document.getElementById('backlinks-view'),
  
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
      updateOutline(content);
      queueAutoSave();
    },
    getNoteNames: () => {
      return getAllNoteNames(fileTreeData);
    },
    onCreateNote: async (name) => {
      try {
        const folder = selectedFolderPath || null;
        const newPath = await window.api.createNote(folder, name);
        await refreshFileExplorer();
        showNotification(`Nota "${name}" creada en segundo plano.`, 'success');
      } catch (err) {
        console.error('Error al crear nota desde el autocompletado:', err);
        showNotification('No se pudo crear la nota.', 'error');
      }
    }
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
              if (el.noteTitleDisplay) el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
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

function getAllNoteNames(nodes) {
  const names = [];
  function recurse(list) {
    list.forEach(node => {
      if (node.type === 'file') {
        names.push(node.name.replace(/\.md$/, '').replace(/\.txt$/, ''));
      } else if (node.type === 'directory') {
        recurse(node.children);
      }
    });
  }
  recurse(nodes);
  return names;
}

// --- Note File Loading and Saving ---
async function openNote(filePath) {
  // If already open, switch to it
  const existingTab = openTabs.find(t => isPathEqual(t.path, filePath));
  if (existingTab) {
    await switchTab(filePath);
    return;
  }

  // If there's unsaved changes, prompt save first
  if (isUnsaved) {
    await saveCurrentNoteImmediately();
  }

  try {
    const content = await window.api.readNote(filePath);
    currentFileContent = content;
    isUnsaved = false;
    
    // Add to open tabs
    const parts = filePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    openTabs.push({ path: filePath, name: fileName });
    activeTabPath = filePath;
    currentFilePath = filePath;
    
    // Set UI states
    if (el.noteTitleDisplay) el.noteTitleDisplay.textContent = fileName.replace(/\.md$/, '');
    
    setContent(editorView, content);
    updateWordCount(content);
    updatePreview(content);
    updateOutline(content);
    
    el.welcomePane.classList.add('hidden');
    el.editorPane.classList.remove('hidden');
    
    el.saveStatus.textContent = 'Guardado';
    el.saveStatus.classList.remove('unsaved');
    
    renderTabs();
    renderFileExplorer();
    
    // Refresh tags view if active
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    // Refresh backlinks view if active
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
  } catch (err) {
    console.error('Error al abrir la nota:', err);
    showNotification('No se pudo abrir la nota seleccionada.', 'error');
  }
}

async function saveCurrentNoteImmediately() {
  if (!activeTabPath) return;
  clearTimeout(saveTimeout);
  
  try {
    const content = getContent(editorView);
    await window.api.saveNote(activeTabPath, content);
    currentFileContent = content;
    isUnsaved = false;
    
    el.saveStatus.textContent = 'Guardado';
    el.saveStatus.classList.remove('unsaved');
    
    // Refresh tab bar to clear unsaved dot
    renderTabs();
    
    // Refresh tags if they changed
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    // Refresh backlinks if they changed
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
  } catch (err) {
    console.error('Error al guardar:', err);
    el.saveStatus.textContent = 'Error al guardar';
  }
}

// Debounced auto-save
function queueAutoSave() {
  if (!activeTabPath) return;
  
  isUnsaved = true;
  el.saveStatus.textContent = 'Modificado';
  el.saveStatus.classList.add('unsaved');
  
  // Show unsaved dot on tab
  renderTabs();
  
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveCurrentNoteImmediately();
  }, 800);
}

// --- Section 3 Tab Navigation Management ---
function renderTabs() {
  el.tabBar.innerHTML = '';
  
  if (openTabs.length === 0) {
    el.welcomePane.classList.remove('hidden');
    el.editorPane.classList.add('hidden');
    activeTabPath = null;
    currentFilePath = null;
    updateOutline('');
    updateBacklinksView();
    return;
  }

  openTabs.forEach(tab => {
    const tabEl = document.createElement('div');
    const isActive = isPathEqual(tab.path, activeTabPath);
    tabEl.className = `tab-item ${isActive ? 'active' : ''} ${isActive && isUnsaved ? 'unsaved' : ''}`;
    tabEl.dataset.path = tab.path;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = tab.name.replace(/\.md$/, '');
    tabEl.appendChild(nameSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.path);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      switchTab(tab.path);
    });

    el.tabBar.appendChild(tabEl);
  });
}

async function switchTab(filePath) {
  if (isPathEqual(filePath, activeTabPath)) return;
  
  if (isUnsaved) {
    await saveCurrentNoteImmediately();
  }

  activeTabPath = filePath;
  currentFilePath = filePath;
  
  try {
    const content = await window.api.readNote(filePath);
    currentFileContent = content;
    isUnsaved = false;

    const parts = filePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1];
    if (el.noteTitleDisplay) el.noteTitleDisplay.textContent = fileName.replace(/\.md$/, '');
    
    setContent(editorView, content);
    updateWordCount(content);
    updatePreview(content);
    updateOutline(content);

    el.welcomePane.classList.add('hidden');
    el.editorPane.classList.remove('hidden');

    el.saveStatus.textContent = 'Guardado';
    el.saveStatus.classList.remove('unsaved');

    renderTabs();
    renderFileExplorer();
    
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
  } catch (err) {
    console.error('Error switching tab:', err);
    showNotification('No se pudo abrir la nota seleccionada.', 'error');
  }
}

async function closeTab(filePath) {
  const index = openTabs.findIndex(t => isPathEqual(t.path, filePath));
  if (index === -1) return;

  if (isPathEqual(filePath, activeTabPath) && isUnsaved) {
    await saveCurrentNoteImmediately();
  }

  openTabs.splice(index, 1);

  if (isPathEqual(filePath, activeTabPath)) {
    if (openTabs.length > 0) {
      const nextIndex = Math.min(index, openTabs.length - 1);
      const nextTab = openTabs[nextIndex];
      activeTabPath = null;
      await switchTab(nextTab.path);
    } else {
      activeTabPath = null;
      currentFilePath = null;
      renderTabs();
      renderFileExplorer();
    }
  } else {
    renderTabs();
  }
  if (openTabs.length === 0) {
    ensureLeftSidebarExpanded();
  }
}

// --- Section 3 Outline (Table of Contents) Logic ---
function updateOutline(markdownText) {
  el.outlineView.innerHTML = '';
  
  if (!activeTabPath || !markdownText) {
    el.outlineView.innerHTML = '<div class="empty-sidebar-view">Abre una nota para ver su índice.</div>';
    return;
  }

  const lines = markdownText.split('\n');
  const headings = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineNum: index + 1
      });
    }
  });

  if (headings.length === 0) {
    el.outlineView.innerHTML = '<div class="empty-sidebar-view">No se encontraron títulos.</div>';
    return;
  }

  headings.forEach(heading => {
    const item = document.createElement('div');
    item.className = `outline-item h${heading.level}`;
    item.textContent = heading.text;
    item.title = heading.text;
    item.addEventListener('click', () => {
      scrollToLine(editorView, heading.lineNum);
    });
    el.outlineView.appendChild(item);
  });
}

// --- Section 3 Tags Explorer Logic ---
async function updateTagsView() {
  el.tagsView.innerHTML = '';
  
  try {
    const tagsMap = await window.api.getVaultTags();
    const tagNames = Object.keys(tagsMap).sort((a, b) => a.localeCompare(b));

    if (tagNames.length === 0) {
      el.tagsView.innerHTML = '<div class="empty-sidebar-view">No se encontraron etiquetas.</div>';
      return;
    }

    tagNames.forEach(tag => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'tag-group';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'tag-header';
      
      const tagText = document.createElement('span');
      tagText.textContent = tag;

      const tagCount = document.createElement('span');
      tagCount.className = 'tag-count';
      tagCount.textContent = tagsMap[tag].length;

      headerDiv.appendChild(tagText);
      headerDiv.appendChild(tagCount);

      const filesDiv = document.createElement('div');
      filesDiv.className = 'tag-files';
      if (collapsedTags.has(tag)) {
        filesDiv.classList.add('collapsed');
      }

      headerDiv.addEventListener('click', () => {
        const isCollapsed = filesDiv.classList.toggle('collapsed');
        if (isCollapsed) {
          collapsedTags.add(tag);
        } else {
          collapsedTags.delete(tag);
        }
      });

      tagsMap[tag].forEach(file => {
        const fileLink = document.createElement('div');
        fileLink.className = 'tag-file-link';
        fileLink.textContent = file.name.replace(/\.md$/, '');
        fileLink.title = file.path;
        fileLink.addEventListener('click', () => {
          openNote(file.path);
        });
        filesDiv.appendChild(fileLink);
      });

      groupDiv.appendChild(headerDiv);
      groupDiv.appendChild(filesDiv);
      el.tagsView.appendChild(groupDiv);
    });
  } catch (err) {
    console.error('Error updating tags view:', err);
    el.tagsView.innerHTML = '<div class="empty-sidebar-view">Error al cargar etiquetas.</div>';
  }
}

// Helper to escape RegExp special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Open note and scroll to a specific line number
async function openNoteAndScroll(filePath, lineNum) {
  await openNote(filePath);
  if (lineNum) {
    setTimeout(() => {
      scrollToLine(editorView, lineNum);
    }, 50);
  }
}

// --- Section 3 Backlinks Explorer Logic ---
async function updateBacklinksView() {
  el.backlinksView.innerHTML = '';
  
  if (!activeTabPath) {
    el.backlinksView.innerHTML = '<div class="empty-sidebar-view">Abre una nota para ver sus backlinks.</div>';
    return;
  }

  try {
    el.backlinksView.innerHTML = '<div class="empty-sidebar-view">Buscando backlinks...</div>';
    const backlinks = await window.api.getBacklinks(activeTabPath);
    el.backlinksView.innerHTML = '';

    if (backlinks.length === 0) {
      el.backlinksView.innerHTML = '<div class="empty-sidebar-view">No hay backlinks para esta nota.</div>';
      return;
    }

    // Get current note name for highlighting wikilinks inside context
    const parts = activeTabPath.split(/[\\/]/);
    const targetNoteName = parts[parts.length - 1].replace(/\.md$/, '').replace(/\.txt$/, '').trim();

    backlinks.forEach(link => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'backlink-group';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'backlink-header';
      
      const titleWrapper = document.createElement('div');
      titleWrapper.className = 'backlink-title-wrapper';

      const isCollapsed = collapsedBacklinks.has(link.path);

      // Chevron Icon
      const chevronSpan = document.createElement('span');
      chevronSpan.className = `backlink-icon ${isCollapsed ? 'collapsed' : ''}`;
      chevronSpan.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'backlink-title';
      titleSpan.textContent = link.name.replace(/\.md$/, '');
      titleSpan.title = link.name;

      titleWrapper.appendChild(chevronSpan);
      titleWrapper.appendChild(titleSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'backlink-count';
      countSpan.textContent = link.contexts.length;

      headerDiv.appendChild(titleWrapper);
      headerDiv.appendChild(countSpan);

      const contextsDiv = document.createElement('div');
      contextsDiv.className = 'backlink-contexts';
      if (isCollapsed) {
        contextsDiv.classList.add('collapsed');
      }

      chevronSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = contextsDiv.classList.toggle('collapsed');
        chevronSpan.classList.toggle('collapsed', collapsed);
        if (collapsed) {
          collapsedBacklinks.add(link.path);
        } else {
          collapsedBacklinks.delete(link.path);
        }
      });
      
      headerDiv.addEventListener('click', (e) => {
        if (e.target.closest('.backlink-title')) {
          openNote(link.path);
        } else {
          const collapsed = contextsDiv.classList.toggle('collapsed');
          chevronSpan.classList.toggle('collapsed', collapsed);
          if (collapsed) {
            collapsedBacklinks.add(link.path);
          } else {
            collapsedBacklinks.delete(link.path);
          }
        }
      });

      // Render context items
      link.contexts.forEach(ctx => {
        const ctxItem = document.createElement('div');
        ctxItem.className = 'backlink-context-item';
        
        // Highlight current note wikilink references in the context text
        const escapedName = escapeRegExp(targetNoteName);
        const highlightRegex = new RegExp(`(\\[\\[${escapedName}(?:\\|[^\\]]*)?\\]\\])`, 'gi');
        
        // Convert HTML tags to entities
        const safeText = ctx.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

        const highlightedText = safeText.replace(highlightRegex, '<mark>$1</mark>');
        
        ctxItem.innerHTML = `<span style="opacity: 0.5; margin-right: 4px;">L${ctx.line}:</span> ${highlightedText}`;
        ctxItem.title = `Línea ${ctx.line}: ${ctx.text}`;
        
        ctxItem.addEventListener('click', (e) => {
          e.stopPropagation();
          openNoteAndScroll(link.path, ctx.line);
        });
        
        contextsDiv.appendChild(ctxItem);
      });

      groupDiv.appendChild(headerDiv);
      groupDiv.appendChild(contextsDiv);
      el.backlinksView.appendChild(groupDiv);
    });
  } catch (err) {
    console.error('Error updating backlinks view:', err);
    el.backlinksView.innerHTML = '<div class="empty-sidebar-view">Error al buscar backlinks.</div>';
  }
}


// Helper to nest headings hierarchically for Logseq-like outline styling in the preview
function nestHeadings(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const body = doc.body;
  const children = Array.from(body.childNodes);
  
  const root = document.createElement('div');
  root.className = 'markdown-root';
  
  let parentsStack = [root];
  let levelsStack = [0];

  children.forEach(node => {
    // Text nodes or comments go straight to the current active parent container
    if (node.nodeType !== Node.ELEMENT_NODE) {
      parentsStack[parentsStack.length - 1].appendChild(node);
      return;
    }

    const tagName = node.tagName.toLowerCase();
    const headingMatch = tagName.match(/^h([1-6])$/);
    
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      
      // Keep popping until we find a parent that is a higher level heading (lower number)
      while (levelsStack[levelsStack.length - 1] >= level) {
        parentsStack.pop();
        levelsStack.pop();
      }
      
      const section = document.createElement('div');
      section.className = `heading-section level-${level}`;
      
      parentsStack[parentsStack.length - 1].appendChild(section);
      section.appendChild(node);
      
      parentsStack.push(section);
      levelsStack.push(level);
    } else {
      parentsStack[parentsStack.length - 1].appendChild(node);
    }
  });
  
  return root.innerHTML;
}

// Preprocess markdown text to wrap indented normal lines and codeblocks into custom styled layout spans
function preprocessMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const processedLines = [];
  
  let currentHeadingSpaceIndent = 0;
  let inCodeBlock = false;
  let codeBlockIndentLevel = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if it's a fenced code block boundary
    const isFencedCode = /^[ \t]*\`\`\`/.test(line);
    
    if (isFencedCode) {
      if (!inCodeBlock) {
        // Starting a fenced code block!
        inCodeBlock = true;
        
        // Measure its space indentation
        const match = line.match(/^([ \t]*)\`\`\`/);
        const indentStr = match ? match[1] : '';
        const spacesCount = indentStr.replace(/\t/g, '  ').length;
        const indentLevel = Math.floor(spacesCount / 2);
        
        // Calculate relative indent level
        const relativeLevel = indentLevel - currentHeadingSpaceIndent;
        
        if (relativeLevel > 0) {
          codeBlockIndentLevel = relativeLevel;
          // Emit the opening span
          processedLines.push(`<span class="markdown-indent level-${relativeLevel}" style="display: block; margin-left: ${relativeLevel * 20}px; padding-left: 12px; border-left: 1.5px solid rgba(124, 58, 237, 0.15); margin-top: 4px; margin-bottom: 4px;">`);
        } else {
          codeBlockIndentLevel = 0;
        }
        
        // Push the opening fence (with the spaces removed so marked parses it correctly as a fence at the root of the span)
        processedLines.push('```' + line.slice(indentStr.length + 3));
      } else {
        // Ending the fenced code block!
        inCodeBlock = false;
        
        // Push the closing fence (without spaces)
        processedLines.push('```');
        
        // Close the span if we opened one
        if (codeBlockIndentLevel > 0) {
          processedLines.push('</span>');
        }
      }
      continue;
    }
    
    if (inCodeBlock) {
      // We are inside a code block. We should strip the leading indentation of the code block
      // so it sits nicely inside the block container without extra indentation inside the pre tag
      let strippedLine = line;
      if (codeBlockIndentLevel > 0) {
        // Strip codeBlockIndentLevel * 2 spaces (or tabs) from the start of the line if present
        const charsToStrip = codeBlockIndentLevel * 2;
        let strippedCount = 0;
        let j = 0;
        while (j < line.length && strippedCount < charsToStrip) {
          if (line[j] === ' ') {
            strippedCount += 1;
            j++;
          } else if (line[j] === '\t') {
            strippedCount += 2; // tab counts as 2 spaces
            j++;
          } else {
            break; // non-space character
          }
        }
        strippedLine = line.slice(j);
      }
      processedLines.push(strippedLine);
      continue;
    }
    
    // Normal line processing
    if (!line.trim()) {
      processedLines.push(line);
      continue;
    }
    
    // Check if it's a heading
    const headingMatch = line.match(/^([ \t]*)#+\s/);
    if (headingMatch) {
      const indentStr = headingMatch[1];
      const spacesCount = indentStr.replace(/\t/g, '  ').length;
      currentHeadingSpaceIndent = Math.floor(spacesCount / 2);
      processedLines.push(line);
      continue;
    }
    
    // Check if it's a list item or blockquote
    const isListItem = /^[ \t]*([-*+]|\d+\.)\s/.test(line);
    const isBlockquote = /^[ \t]*>/.test(line);
    
    if (isListItem || isBlockquote) {
      processedLines.push(line);
      continue;
    }
    
    const match = line.match(/^([ \t]+)(.*)$/);
    if (match) {
      const indentStr = match[1];
      const content = match[2];
      const spacesCount = indentStr.replace(/\t/g, '  ').length;
      const indentLevel = Math.floor(spacesCount / 2);
      
      const relativeLevel = indentLevel - currentHeadingSpaceIndent;
      
      if (relativeLevel > 0) {
        processedLines.push(`<span class="markdown-indent level-${relativeLevel}" style="display: block; margin-left: ${relativeLevel * 20}px; padding-left: 12px; border-left: 1.5px solid rgba(124, 58, 237, 0.15); margin-top: 4px; margin-bottom: 4px;">${content}</span>`);
        continue;
      }
    }
    processedLines.push(line);
  }
  
  return processedLines.join('\n');
}

// Update Markdown Preview
async function updatePreview(markdownText) {
  try {
    const preprocessed = preprocessMarkdown(markdownText || '');
    const html = await window.api.parseMarkdown(preprocessed);
    el.markdownPreview.innerHTML = nestHeadings(html);

    // Style wikilinks based on file existence
    el.markdownPreview.querySelectorAll('.wikilink').forEach(link => {
      const noteName = decodeURIComponent(link.dataset.target);
      const exists = findFileInTree(fileTreeData, noteName);
      if (!exists) {
        link.classList.add('new-note');
      }
    });
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
    const newPath = await window.api.renameItem(itemPath, newName);
    
    // Update open tabs
    openTabs.forEach(tab => {
      if (isPathEqual(tab.path, itemPath)) {
        tab.path = newPath;
        const parts = newPath.split(/[\\/]/);
        tab.name = parts[parts.length - 1];
      } else if (isPathSubpath(tab.path, itemPath)) {
        tab.path = newPath + tab.path.slice(itemPath.length);
      }
    });

    if (activeTabPath && (isPathEqual(activeTabPath, itemPath) || isPathSubpath(activeTabPath, itemPath))) {
      if (isPathEqual(activeTabPath, itemPath)) {
        activeTabPath = newPath;
      } else {
        activeTabPath = newPath + activeTabPath.slice(itemPath.length);
      }
      currentFilePath = activeTabPath;
      const parts = activeTabPath.split(/[\\/]/);
      const name = parts[parts.length - 1];
      if (el.noteTitleDisplay) el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
    }

    renderTabs();
    await refreshFileExplorer();
    
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
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
    
    // Close any tabs that were inside the deleted item
    const tabsToClose = openTabs.filter(tab => isPathEqual(tab.path, itemPath) || isPathSubpath(tab.path, itemPath));
    tabsToClose.forEach(tab => {
      const idx = openTabs.findIndex(t => isPathEqual(t.path, tab.path));
      if (idx !== -1) {
        openTabs.splice(idx, 1);
      }
    });

    if (activeTabPath && (isPathEqual(activeTabPath, itemPath) || isPathSubpath(activeTabPath, itemPath))) {
      if (openTabs.length > 0) {
        activeTabPath = null;
        await switchTab(openTabs[0].path);
      } else {
        activeTabPath = null;
        currentFilePath = null;
        el.editorPane.classList.add('hidden');
        el.welcomePane.classList.remove('hidden');
        el.statusWordCount.classList.add('hidden');
        el.statusCharCount.classList.add('hidden');
        updateOutline('');
      }
    } else {
      renderTabs();
    }

    await refreshFileExplorer();
    
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
    if (openTabs.length === 0) {
      ensureLeftSidebarExpanded();
    }
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
  
  // Apply the custom split width if in split view, otherwise reset inline styles
  if (mode === 'split') {
    el.editorContainer.style.flex = 'none';
    el.editorContainer.style.width = `${splitPercentage}%`;
  } else {
    el.editorContainer.style.flex = '';
    el.editorContainer.style.width = '';
  }
  
  // If moving into a mode with preview, update it immediately
  if (mode === 'preview' || mode === 'split') {
    updatePreview(getContent(editorView));
  }
}

// --- Event Listeners Wiring ---
function setupEventListeners() {
  // Intercept Wikilinks in Preview
  el.markdownPreview.addEventListener('click', async (e) => {
    const wikiLink = e.target.closest('.wikilink');
    if (wikiLink) {
      e.preventDefault();
      const noteName = decodeURIComponent(wikiLink.dataset.target);
      await handleWikilinkClick(noteName);
    }
  });

  // Intercept Wikilinks in Live Preview Editor (Ctrl/Cmd + Click)
  el.codemirrorHost.addEventListener('click', async (e) => {
    const linkEl = e.target.closest('.cm-wikilink-preview');
    if (linkEl && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      
      // Determine the target note name from the line text at the current selection position
      if (editorView) {
        const pos = editorView.state.selection.main.head;
        const line = editorView.state.doc.lineAt(pos);
        const text = line.text;
        const cursorOffset = pos - line.from;
        
        const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
        let match;
        while ((match = wikiRegex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (cursorOffset >= start && cursorOffset <= end) {
            const noteName = match[1].trim();
            await handleWikilinkClick(noteName);
            break;
          }
        }
      }
    }
  });

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
          if (el.noteTitleDisplay) el.noteTitleDisplay.textContent = name.replace(/\.md$/, '');
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
    if (rightSidebarTab === 'tags') {
      updateTagsView();
    }
    if (rightSidebarTab === 'backlinks') {
      updateBacklinksView();
    }
  });
  el.btnWelcomeNewFile.addEventListener('click', () => handleCreateNote());

  // Open Vault Button Listener
  el.btnOpenVault.addEventListener('click', async () => {
    try {
      const newPath = await window.api.openVaultDialog();
      if (newPath) {
        // Clear workspace
        openTabs = [];
        activeTabPath = null;
        currentFilePath = null;
        isUnsaved = false;
        
        // Reload UI
        renderTabs();
        await loadVaultInfo();
        await refreshFileExplorer();
        updateOutline('');
        if (rightSidebarTab === 'tags') {
          updateTagsView();
        }
        if (rightSidebarTab === 'backlinks') {
          updateBacklinksView();
        }
        ensureLeftSidebarExpanded();
        showNotification('Nueva bóveda abierta correctamente.', 'success');
      }
    } catch (err) {
      console.error(err);
      showNotification('Error al abrir la bóveda.', 'error');
    }
  });

  // Right Sidebar Tab Toggles
  el.btnTabOutline.addEventListener('click', () => {
    el.btnTabOutline.classList.add('active');
    el.btnTabTags.classList.remove('active');
    el.btnTabBacklinks.classList.remove('active');
    el.outlineView.classList.remove('hidden');
    el.tagsView.classList.add('hidden');
    el.backlinksView.classList.add('hidden');
    rightSidebarTab = 'outline';
    updateOutline(getContent(editorView));
  });

  el.btnTabTags.addEventListener('click', () => {
    el.btnTabOutline.classList.remove('active');
    el.btnTabTags.classList.add('active');
    el.btnTabBacklinks.classList.remove('active');
    el.outlineView.classList.add('hidden');
    el.tagsView.classList.remove('hidden');
    el.backlinksView.classList.add('hidden');
    rightSidebarTab = 'tags';
    updateTagsView();
  });

  el.btnTabBacklinks.addEventListener('click', () => {
    el.btnTabOutline.classList.remove('active');
    el.btnTabTags.classList.remove('active');
    el.btnTabBacklinks.classList.add('active');
    el.outlineView.classList.add('hidden');
    el.tagsView.classList.add('hidden');
    el.backlinksView.classList.remove('hidden');
    rightSidebarTab = 'backlinks';
    updateBacklinksView();
  });

  // Mode triggers
  el.btnModeEdit.addEventListener('click', () => setViewMode('edit'));
  el.btnModeSplit.addEventListener('click', () => setViewMode('split'));
  el.btnModePreview.addEventListener('click', () => setViewMode('preview'));

  // Editor input/tab handling is managed by CodeMirror 6 via the onChange callback

  // Double click file title to rename in header
  if (el.noteTitleDisplay) {
    el.noteTitleDisplay.addEventListener('dblclick', () => {
      if (!activeTabPath) return;
      const parts = activeTabPath.split(/[\\/]/);
      const fileName = parts[parts.length - 1];
      handleRenameNode(activeTabPath, fileName);
    });
  }

  // Keyboard Shortcuts (Ctrl+S, Ctrl+N, Ctrl+Alt+P)
  window.addEventListener('keydown', async (e) => {
    // Ctrl + S: Manual Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (activeTabPath && isUnsaved) {
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

  // --- Workspace Resizing and Collapsing Logic ---
  const leftSidebar = document.getElementById('left-sidebar');
  const rightSidebar = document.getElementById('right-sidebar');
  const leftResizer = document.getElementById('left-resizer');
  const rightResizer = document.getElementById('right-resizer');
  const btnCollapseLeft = document.getElementById('btn-collapse-left');
  const btnCollapseRight = document.getElementById('btn-collapse-right');
  const btnToggleLeftSidebar = document.getElementById('btn-toggle-left-sidebar');
  const btnToggleRightSidebar = document.getElementById('btn-toggle-right-sidebar');

  // Drag-to-resize left sidebar
  leftResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    leftSidebar.classList.add('resizing');
    leftResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      const newWidth = moveEvent.clientX;
      if (newWidth > 150 && newWidth < 450) {
        leftSidebar.style.width = `${newWidth}px`;
        leftSidebar.classList.remove('collapsed');
      } else if (newWidth <= 150) {
        if (openTabs.length === 0) {
          leftSidebar.style.width = '150px';
          leftSidebar.classList.remove('collapsed');
          return;
        }
        leftSidebar.style.width = '0px';
        leftSidebar.classList.add('collapsed');
      }
    };

    const onMouseUp = () => {
      leftSidebar.classList.remove('resizing');
      leftResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (editorView) {
        editorView.requestMeasure();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Drag-to-resize right sidebar
  rightResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    rightSidebar.classList.add('resizing');
    rightResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      if (newWidth > 150 && newWidth < 400) {
        rightSidebar.style.width = `${newWidth}px`;
        rightSidebar.classList.remove('collapsed');
      } else if (newWidth <= 150) {
        rightSidebar.style.width = '0px';
        rightSidebar.classList.add('collapsed');
      }
    };

    const onMouseUp = () => {
      rightSidebar.classList.remove('resizing');
      rightResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (editorView) {
        editorView.requestMeasure();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Drag-to-resize split view panes (editor and preview)
  el.splitDivider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    el.splitDivider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    const paneWidth = el.paneContent.offsetWidth;
    const paneLeft = el.paneContent.getBoundingClientRect().left;

    const onMouseMove = (moveEvent) => {
      const clientX = moveEvent.clientX;
      const relativeX = clientX - paneLeft;
      
      // Calculate percentage with boundary limits (between 15% and 85%)
      let percentage = (relativeX / paneWidth) * 100;
      if (percentage < 15) percentage = 15;
      if (percentage > 85) percentage = 85;

      splitPercentage = percentage;
      el.editorContainer.style.flex = 'none';
      el.editorContainer.style.width = `${percentage}%`;
      
      if (editorView) {
        editorView.requestMeasure();
      }
    };

    const onMouseUp = () => {
      el.splitDivider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (editorView) {
        editorView.requestMeasure();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Toggle Left Sidebar function
  function toggleLeftSidebar() {
    const isCollapsed = leftSidebar.classList.contains('collapsed');
    if (isCollapsed) {
      leftSidebar.style.width = `${lastLeftWidth}px`;
      leftSidebar.classList.remove('collapsed');
    } else {
      if (openTabs.length === 0) {
        showNotification('No se puede contraer el panel izquierdo si no hay páginas abiertas.', 'warning');
        return;
      }
      const currentWidth = leftSidebar.offsetWidth;
      if (currentWidth > 0) {
        lastLeftWidth = currentWidth;
      }
      leftSidebar.style.width = '0px';
      leftSidebar.classList.add('collapsed');
    }
    if (editorView) {
      setTimeout(() => editorView.requestMeasure(), 250);
    }
  }

  // Toggle Right Sidebar function
  function toggleRightSidebar() {
    const isCollapsed = rightSidebar.classList.contains('collapsed');
    if (isCollapsed) {
      rightSidebar.style.width = `${lastRightWidth}px`;
      rightSidebar.classList.remove('collapsed');
    } else {
      const currentWidth = rightSidebar.offsetWidth;
      if (currentWidth > 0) {
        lastRightWidth = currentWidth;
      }
      rightSidebar.style.width = '0px';
      rightSidebar.classList.add('collapsed');
    }
    if (editorView) {
      setTimeout(() => editorView.requestMeasure(), 250);
    }
  }

  // Double click resizers to toggle collapse
  leftResizer.addEventListener('dblclick', toggleLeftSidebar);
  rightResizer.addEventListener('dblclick', toggleRightSidebar);

  // Button clicks
  if (btnCollapseLeft) btnCollapseLeft.addEventListener('click', toggleLeftSidebar);
  if (btnToggleLeftSidebar) btnToggleLeftSidebar.addEventListener('click', toggleLeftSidebar);
  if (btnCollapseRight) btnCollapseRight.addEventListener('click', toggleRightSidebar);
  if (btnToggleRightSidebar) btnToggleRightSidebar.addEventListener('click', toggleRightSidebar);
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

