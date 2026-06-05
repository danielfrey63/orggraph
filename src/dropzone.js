// ========== Drag & drop file intake (standalone) ==========
// Renders an overlay prompting for files when nothing is loaded, and accepts
// drops anywhere in the window to (re)load data. Dependency-free.

let _overlay = null;
let _dragDepth = 0;

function ensureOverlay(onFiles) {
  if (_overlay) return _overlay;

  const overlay = document.createElement('div');
  overlay.className = 'dz-overlay';
  overlay.innerHTML = `
    <div class="dz-panel">
      <div class="dz-icon">⬇</div>
      <h2 class="dz-title">Daten hierher ziehen</h2>
      <p class="dz-text">
        JSON-Datensatz, optional <code>pseudo.data.json</code>, <code>env.json</code>
        und Attribut-Dateien (<code>.tsv</code>/<code>.csv</code>/<code>.txt</code>).<br>
        Mehrere Dateien gleichzeitig sind möglich. Die Inhalte werden lokal im Browser
        (IndexedDB) gespeichert und beim nächsten Öffnen automatisch geladen.
      </p>
      <button class="dz-pick" type="button">Dateien auswählen…</button>
    </div>`;

  const pick = overlay.querySelector('.dz-pick');
  pick.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = '.json,.tsv,.csv,.txt,application/json';
    picker.style.display = 'none';
    document.body.appendChild(picker);
    picker.addEventListener('change', () => {
      const files = picker.files;
      picker.remove();
      if (files && files.length) onFiles(files);
    });
    picker.click();
  });

  document.body.appendChild(overlay);
  _overlay = overlay;
  return overlay;
}

export function showDropZone(onFiles) {
  ensureOverlay(onFiles).classList.add('dz-visible');
}

export function hideDropZone() {
  if (_overlay) _overlay.classList.remove('dz-visible');
}

/**
 * Install window-wide drag&drop so files can be dropped any time to (re)load.
 * onFiles receives a FileList.
 */
export function installGlobalDrop(onFiles) {
  const onDragEnter = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    _dragDepth++;
    document.body.classList.add('dz-dragging');
  };
  const onDragOver = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (_dragDepth === 0) document.body.classList.remove('dz-dragging');
  };
  const onDrop = (e) => {
    e.preventDefault();
    _dragDepth = 0;
    document.body.classList.remove('dz-dragging');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
}
