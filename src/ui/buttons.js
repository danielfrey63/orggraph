/**
 * Button-Utilities [SF][DRY]
 * Hilfsfunktionen für Button-Erstellung und -Verwaltung.
 */

import { getEyeSVG } from './icons.js';

/**
 * Aktualisiert einen Eye-Toggle-Button [DRY]
 * @param {HTMLElement} btn - Der Button
 * @param {boolean} isVisible - Aktueller Sichtbarkeitszustand
 * @param {string} titleVisible - Tooltip wenn sichtbar
 * @param {string} titleHidden - Tooltip wenn versteckt
 */
export function updateEyeButton(btn, isVisible, titleVisible, titleHidden) {
  if (!btn) return;
  
  btn.classList.toggle('active', isVisible);
  btn.title = isVisible ? titleVisible : titleHidden;
  
  const icon = btn.querySelector('.codicon');
  if (icon) {
    icon.classList.toggle('codicon-eye', isVisible);
    icon.classList.toggle('codicon-eye-closed', !isVisible);
  }
}

/**
 * Erstellt einen Eye-Toggle-Button [DRY]
 * @param {Object} options - Konfiguration
 * @returns {HTMLButtonElement}
 */
export function createEyeButton({ isVisible, titleVisible, titleHidden, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = isVisible ? 'legend-icon-btn active' : 'legend-icon-btn';
  btn.title = isVisible ? titleVisible : titleHidden;
  btn.innerHTML = getEyeSVG(!isVisible);
  btn.setAttribute('data-ignore-header-click', 'true');
  
  if (onClick) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
  }
  
  return btn;
}

/**
 * Generischer Toggle-Handler [DRY]
 * @param {HTMLElement} btn - Der Toggle-Button
 * @param {Function} onToggle - Callback mit neuem Zustand
 */
export function setupToggleButton(btn, onToggle) {
  if (!btn) return;
  
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const isActive = btn.classList.contains('active');
    onToggle(isActive);
  });
}

/**
 * Initialisiert einen Toggle-Button mit ENV-Konfiguration [SF]
 * @param {HTMLElement} btn - Der Button
 * @param {boolean|null} envValue - Wert aus ENV-Config
 * @param {Function} onToggle - Callback
 * @returns {boolean} Initialer Zustand
 */
export function initToggleFromEnv(btn, envValue, onToggle) {
  if (!btn) return false;
  
  let initialState;
  if (envValue !== null && envValue !== undefined) {
    initialState = !!envValue;
    if (!initialState) btn.classList.remove('active');
    else btn.classList.add('active');
  } else {
    initialState = btn.classList.contains('active');
  }
  
  setupToggleButton(btn, onToggle);
  return initialState;
}

/**
 * Erstellt einen Icon-Button [SF]
 * @param {Object} options - Konfiguration
 * @returns {HTMLButtonElement}
 */
export function createIconButton({ icon, title, className = '', onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `legend-icon-btn ${className}`.trim();
  btn.title = title;
  btn.innerHTML = icon;
  btn.setAttribute('data-ignore-header-click', 'true');
  
  if (onClick) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
  }
  
  return btn;
}

export default {
  updateEyeButton,
  createEyeButton,
  setupToggleButton,
  initToggleFromEnv,
  createIconButton
};
