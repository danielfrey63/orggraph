
// ===== src/constants.js =====
const SVG_ID = "#graph";
const STATUS_ID = "#status";
const INPUT_COMBO_ID = "#comboInput";
const LIST_COMBO_ID = "#comboList";
const INPUT_DEPTH_ID = "#depth";
const BTN_APPLY_ID = "#apply";

const WIDTH = 1200;
const HEIGHT = 800;
const MAX_DROPDOWN_ITEMS = 100;
const MIN_SEARCH_LENGTH = 2;
const MAX_ROOTS = 5;
const BFS_LEVEL_ANIMATION_DELAY_MS = 1000;


// ===== src/utils.js =====

function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

/**
 * Zeigt eine temporäre Benachrichtigung an, ohne den Status zu überschreiben
 */
function showTemporaryNotification(message, duration = 3000) {
  // Prüfe, ob bereits eine Benachrichtigung existiert
  let notification = document.getElementById('temp-notification');
  
  // Wenn nicht, erstelle eine neue
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'temp-notification';
    notification.style.position = 'fixed';
    notification.style.bottom = '60px'; // Über dem Footer
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.background = 'var(--text-strong)';
    notification.style.color = 'var(--panel-bg)';
    notification.style.padding = '8px 16px';
    notification.style.borderRadius = '4px';
    notification.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    notification.style.zIndex = '1000';
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease';
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
    notification.style.opacity = '1';
  }, 10);
  
  // Nach der angegebenen Zeit ausblenden
  notification.hideTimeout = setTimeout(() => {
    notification.style.opacity = '0';
    // Nach dem Ausblenden aus dem DOM entfernen
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300); // Dauer der Ausblend-Transition
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

