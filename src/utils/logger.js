/**
 * Logging-System für die OrgGraph-Anwendung [SF][SD]
 * Zentralisiertes Logging mit Debug-Modus-Unterstützung.
 */

let debugMode = false;

/**
 * Setzt den Debug-Modus [SF]
 * @param {boolean} enabled - Debug-Modus aktivieren/deaktivieren
 */
export function setDebugMode(enabled) {
  debugMode = !!enabled;
}

/**
 * Gibt den aktuellen Debug-Modus zurück [SF]
 * @returns {boolean}
 */
export function isDebugMode() {
  return debugMode;
}

/**
 * Formatiert einen Timestamp [SF]
 * @returns {string} Formatierter Timestamp
 */
export function ts() {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
}

/**
 * Loggt eine Nachricht wenn Debug-Modus aktiv [SF]
 * @param {...any} args - Log-Argumente
 */
export function log(...args) {
  if (debugMode) {
    console.log(`[${ts()}]`, ...args);
  }
}

/**
 * Loggt eine Warnung (immer sichtbar) [SF]
 * @param {...any} args - Log-Argumente
 */
export function warn(...args) {
  console.warn(`[${ts()}]`, ...args);
}

/**
 * Loggt einen Fehler (immer sichtbar) [SF]
 * @param {...any} args - Log-Argumente
 */
export function error(...args) {
  console.error(`[${ts()}]`, ...args);
}

/**
 * Logger-Objekt für Kompatibilität mit bestehendem Code [DRY]
 */
export const Logger = {
  log,
  warn,
  error,
  ts,
  setDebugMode,
  isDebugMode
};

export default Logger;
