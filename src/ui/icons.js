/**
 * Icon-Utilities [SF][DRY]
 * Zentrale Verwaltung von Codicon-Icons.
 */

/**
 * Checkbox-Icon [SF]
 * @param {boolean} checked - Ist gecheckt
 * @returns {string} HTML
 */
export function getCheckboxSVG(checked = false) {
  return checked
    ? '<i class="codicon codicon-check" aria-hidden="true"></i>'
    : '<i class="codicon codicon-close" aria-hidden="true"></i>';
}

/**
 * Chevron-Icon [SF]
 * @returns {string} HTML
 */
export function getChevronSVG() {
  return '<i class="codicon codicon-chevron-down" aria-hidden="true"></i>';
}

/**
 * Check-All-Icon [SF]
 * @returns {string} HTML
 */
export function getCheckAllSVG() {
  return '<i class="codicon codicon-check-all" aria-hidden="true"></i>';
}

/**
 * Eye-Icon [SF]
 * @param {boolean} closed - Ist geschlossen
 * @returns {string} HTML
 */
export function getEyeSVG(closed = false) {
  return closed
    ? '<i class="codicon codicon-eye-closed" aria-hidden="true"></i>'
    : '<i class="codicon codicon-eye" aria-hidden="true"></i>';
}

/**
 * Save-Icon [SF]
 * @returns {string} HTML
 */
export function getSaveSVG() {
  return '<i class="codicon codicon-save" aria-hidden="true"></i>';
}

/**
 * Download-Icon [SF]
 * @returns {string} HTML
 */
export function getDownloadSVG() {
  return '<i class="codicon codicon-cloud-download" aria-hidden="true"></i>';
}

/**
 * Aktualisiert ein Checkbox-Icon [SF]
 * @param {HTMLElement} element - Das Element
 * @param {boolean} checked - Neuer Zustand
 */
export function updateCheckboxIcon(element, checked) {
  element.innerHTML = getCheckboxSVG(checked);
  element.className = checked
    ? element.className.replace(/\s*checked/, '') + ' checked'
    : element.className.replace(/\s*checked/, '');
}

/**
 * Initialisiert alle Chevron-Icons im DOM [SF]
 */
export function initializeChevronIcons() {
  document.querySelectorAll('.legend-chevron').forEach(chevronBtn => {
    chevronBtn.innerHTML = getChevronSVG();
  });
}

export default {
  getCheckboxSVG,
  getChevronSVG,
  getCheckAllSVG,
  getEyeSVG,
  getSaveSVG,
  getDownloadSVG,
  updateCheckboxIcon,
  initializeChevronIcons
};
