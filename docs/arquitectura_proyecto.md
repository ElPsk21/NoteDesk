# Arquitectura y Estado del Proyecto: NoteDesk

NoteDesk es un editor de notas personal y outliner de bloques en Markdown de alto rendimiento, diseñado sobre **Electron** y **CodeMirror 6**, emulando la experiencia de usuario y persistencia de herramientas premium como **LogSeq** y **Obsidian**.

---

## 🗺️ Estado Actual del Proyecto

El proyecto está completamente implementado y cuenta con las siguientes capacidades activas:
1. **Editor Outliner en Bloques (LogSeq Style)**: Cada línea en el editor es un bloque. Toda nota cargada o creada se migra automáticamente a formato de bloque (`- bloque`), ocultando los marcadores `-` en líneas inactivas y reemplazándolos por círculos interactivos en color de acento que reaccionan al pasar el ratón.
2. **Tabulación Inteligente**: Las teclas `Tab` y `Shift+Tab` indentan y desindentan la línea o selecciones múltiples por completo desde cualquier parte del cursor. Las guías verticales (hilos conectores) se dibujan y se iluminan dinámicamente.
3. **Panel de Ajustes e Interlineado**: Permite la personalización completa persistida del Tema (Claro, Oscuro, Medianoche), Color de Resaltado, Color de Texto, Color de Símbolos, Fuentes, y del **Interlineado (Line-height)** del editor.
4. **Navegación e Indexación de Backlinks & Tags**: Indexación en tiempo real de hashtags de notas, pestañas laterales para Esquemas (Outline), Etiquetas (Tags) y Enlaces Bi-direccionales (Backlinks), con la capacidad de hacer Ctrl+Clic para abrir notas interconectadas.
5. **Divisor de Pantalla (Split View Resizer)**: Divisor interactivo y ajustable que redibuja el editor CodeMirror de forma fluida.

---

## 📦 Componentes del Proyecto

A continuación se detalla la estructura y el rol de cada uno de los archivos clave que componen NoteDesk:

### 1. Proceso Principal (Main Process)
* **[main.js](file:///c:/1Practicas/NoteDesk/main.js)**: 
  * Orquesta el ciclo de vida de la aplicación Electron.
  * Inicializa el directorio de la Bóveda (Vault) y el archivo de configuración `config.json` para persistencia.
  * Configura el parser `marked` para habilitar soporte GFM, backlinks, wikilinks (`[[Nota]]`) y desactivar bloques de código indentados involuntarios.
  * Define los canales IPC (`ipcMain.handle`) para operaciones seguras en disco: leer/escribir notas, crear carpetas/archivos, mover elementos (soporte drag & drop), escanear etiquetas recursivamente, indexar enlaces bidireccionales y guardar/cargar configuraciones de usuario.

### 2. Puente de API (IPC Bridge)
* **[preload.js](file:///c:/1Practicas/NoteDesk/preload.js)**:
  * Actúa como capa intermedia segura usando `contextBridge` y `ipcRenderer`.
  * Expone de forma controlada la API `window.api` al proceso de renderizado, protegiendo a la aplicación de inyecciones de código arbitrarias en el frontend.

### 3. Interfaz de Usuario (UI)
* **[src/index.html](file:///c:/1Practicas/NoteDesk/src/index.html)**:
  * Define el layout de tres paneles:
    * **Panel Izquierdo**: Barra de navegación superior (Bóveda y creación rápida), árbol de carpetas (File Explorer) y el panel colapsable de **Ajustes** en la parte inferior.
    * **Panel Central**: Área del editor de texto y visor (Markdown Preview) con controles de pestaña (Tab Bar) y el botón selector de modo (Edición, Vista Dividida, Previsualización).
    * **Panel Derecho**: Pestañas de utilidad lateral: Esquema (Outline de encabezados), Etiquetas indexadas (Tags) y Enlaces Bi-direccionales (Backlinks).
  * Incluye la estructura de modales de confirmación interactivos.

### 4. Estilos y Tematización
* **[src/styles.css](file:///c:/1Practicas/NoteDesk/src/styles.css)**:
  * Centraliza todo el diseño visual con variables CSS personalizables (`:root`).
  * Implementa las hojas de estilo completas de los tres temas principales: Claro (`light`), Medianoche (`midnight`) y Oscuro.
  * Contiene los estilos para guías de tabulación interactivas en el editor (`.cm-indent-guide`) y en el preview, así como los círculos de viñeta outliner (`.cm-list-bullet`) con animaciones de escalado y resplandor (glow) en hover.

### 5. Configuración y Extensiones de CodeMirror 6
* **[src/editor.js](file:///c:/1Practicas/NoteDesk/src/editor.js)**:
  * Encapsula la inicialización y plugins de CodeMirror 6.
  * Define el tema nativo del editor mapeado a las variables del sistema (`noteDeskTheme`) e inyecta la tipografía, interlineado (`var(--editor-line-height)`) y colores dinámicamente.
  * Contiene los comandos outliner de tabulación personalizados `indentListCommand` y `outdentListCommand` que manipulan espacios y viñetas al presionar `Tab`/`Shift+Tab`.
  * Define el plugin `markdownLivePreview` para ocultar la sintaxis Markdown en líneas inactivas, ocultar símbolos `#` integrados en viñetas, inyectar líneas de guía de indentación y colocar clases de viñeta en caracteres de espacio.

### 6. Controlador del Cliente (Renderer Process)
* **[src/renderer.js](file:///c:/1Practicas/NoteDesk/src/renderer.js)**:
  * Gestiona toda la interactividad del lado del cliente.
  * Registra listeners del DOM, maneja la carga y guardado de notas, controla las pestañas de archivos abiertos y actualiza las vistas de Word Count, esquemas, backlinks y tags.
  * Implementa `convertToLogseqFormat` para asegurar la compatibilidad con LogSeq convirtiendo notas lineales tradicionales en listas de bloques viñetados.
  * Sincroniza y aplica los cambios del menú de ajustes en tiempo real sobre el árbol de variables CSS.

---

## 🛠️ Flujo de Compilación y Ejecución

* **Herramienta de Construcción**: La aplicación utiliza `esbuild` para empaquetar el frontend en un archivo bundle autoejecutable de alta velocidad.
* **Comandos Clave**:
  * `npm run build`: Genera el empaquetado del archivo `src/renderer.js` a `src/renderer.bundle.js`.
  * `npm run start` / `npx electron .`: Compila los componentes y lanza el contenedor Electron para ejecución y pruebas locales.
