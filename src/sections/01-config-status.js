
// ===== src/constants.js =====
export const SVG_ID = "#graph";
export const STATUS_ID = "#status";
export const INPUT_COMBO_ID = "#comboInput";
export const LIST_COMBO_ID = "#comboList";
export const INPUT_DEPTH_ID = "#depth";

export const WIDTH = 1200;
export const HEIGHT = 800;
export const MAX_DROPDOWN_ITEMS = 100;
export const MIN_SEARCH_LENGTH = 2;
export const MAX_ROOTS = 5;
export const BFS_LEVEL_ANIMATION_DELAY_MS = 1000;


// ===== src/utils.js =====

export function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

/**
 * Zeigt eine temporäre Benachrichtigung an, ohne den Status zu überschreiben
 */
export function showTemporaryNotification(message, duration = 3000) {
  // Prüfe, ob bereits eine Benachrichtigung existiert
  let notification = document.getElementById('temp-notification');
  
  // Wenn nicht, erstelle eine neue
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'temp-notification';
        notification.className = 'toast';
    document.body.appendChild(notification);
  }
  
  // Bestehende Timer löschen
  if (notification.hideTimeout) {
    clearTimeout(notification.hideTimeout);
  }
  
  // Nachricht aktualisieren und einblenden
  notification.textContent = message;
  
  // Sicherstellen, dass das Element im DOM ist, bevor wir die Transition starten
    setTimeout(() => {
    notification.classList.add('visible');
  }, 10);
  
  // Nach der angegebenen Zeit ausblenden
    notification.hideTimeout = setTimeout(() => {
    notification.classList.remove('visible');
    // Nach dem Ausblenden aus dem DOM entfernen
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
        }, cssNumber('--toast-fade-ms')); // Dauer der Ausblend-Transition
  }, duration);
}


// ===== src/icons.js =====
// ========== Central icon registry (self-drawn, library-free) ==========
// Feather-style line icons, 24x24, inheriting `currentColor`. One entry per
// icon. Usage:
//   - static markup:  <i data-icon="eye"></i>      (hydrated once on load)
//   - dynamic markup: `<button data-icon="eye">${ICON.eye}</button>`
//   - toggling:       setIcon(el, on ? 'eye' : 'eyeClosed')
// No web font, no external dependency.

