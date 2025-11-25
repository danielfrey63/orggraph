/**
 * DOM-Utilities [SF][DRY]
 * Hilfsfunktionen für DOM-Manipulation.
 */

import { STATUS_ID } from '../constants.js';

/**
 * Setzt den Status-Text in der Fußzeile [SF]
 * @param {string} msg - Statusnachricht
 */
export function setStatus(msg) {
  const el = document.querySelector(STATUS_ID);
  if (el) el.textContent = msg;
}

/**
 * Zeigt eine temporäre Benachrichtigung an [SF]
 * @param {string} message - Nachricht
 * @param {number} duration - Anzeigedauer in ms
 */
export function showTemporaryNotification(message, duration = 3000) {
  let notification = document.getElementById('temp-notification');
  
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'temp-notification';
    notification.style.position = 'fixed';
    notification.style.bottom = '60px';
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
  
  if (notification.hideTimeout) {
    clearTimeout(notification.hideTimeout);
  }
  
  notification.textContent = message;
  
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);
  
  notification.hideTimeout = setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, duration);
}

/**
 * Erstellt ein DOM-Element mit Attributen [SF][DRY]
 * @param {string} tag - Tag-Name
 * @param {Object} attrs - Attribute
 * @param {string|Node|Array} children - Kinder
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, children = null) {
  const el = document.createElement(tag);
  
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else {
      el.setAttribute(key, value);
    }
  }
  
  if (children) {
    if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          el.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
          el.appendChild(child);
        }
      });
    } else if (typeof children === 'string') {
      el.textContent = children;
    } else if (children instanceof Node) {
      el.appendChild(children);
    }
  }
  
  return el;
}

/**
 * Entfernt alle Kinder eines Elements [SF]
 * @param {HTMLElement} el - Element
 */
export function clearChildren(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Findet das nächste Elternelement mit einer bestimmten Klasse [SF]
 * @param {HTMLElement} el - Startelement
 * @param {string} className - Klassenname
 * @returns {HTMLElement|null}
 */
export function findParentWithClass(el, className) {
  let current = el.parentElement;
  while (current) {
    if (current.classList.contains(className)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Prüft ob ein Element sichtbar ist [SF]
 * @param {HTMLElement} el - Element
 * @returns {boolean}
 */
export function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export default {
  setStatus,
  showTemporaryNotification,
  createElement,
  clearChildren,
  findParentWithClass,
  isVisible
};
