// ═══════════════════════════════════════════════════════════
//  settings/index.js — Main Settings Router
// ═══════════════════════════════════════════════════════════

import { renderSettingsMainMenu } from './menu.js';
import { renderSettingsStore } from './store.js';
import { renderSettingsPayment } from './payment.js';
import { renderSettingsUsers } from './users.js';
import { renderSettingsPermissions } from './permissions.js';
import { renderSettingsAcCatalog } from './ac-catalog.js';
import { 
  renderSettingsDocument, 
  renderSettingsAbout, 
  renderSettingsLineNotify, 
  renderSettingsLogoPage, 
  renderProductSettings 
} from './pages.js';

let settingsView = 'main'; // main | store | payment | users | about | logo | document | product-settings | permissions | line-notify | ac-catalog
let ctxRef = null;

/**
 * Main entry point for Settings page
 * @param {object} ctx - Context with state, methods
 */
export function renderSettingsPage(ctx) {
  ctxRef = ctx;
  
  // ✅ Restore settings view from URL hash (#settings/store, #settings/payment, etc.)
  const hash = window.location.hash.replace('#settings/', '').replace('#settings', '');
  settingsView = (hash && hash !== 'settings') ? hash : 'main';
  
  renderCurrentView();
  
  // Setup event listeners
  setupEventListeners();
}

/**
 * Setup event listeners for navigation
 */
function setupEventListeners() {
  // Listen for CustomEvent from buttons
  document.addEventListener('navigate-settings', (e) => {
    const target = e.detail;
    if (target === 'main') {
      goBack();
    } else {
      navigateToView(target);
    }
  });
}

/**
 * Render current view based on settingsView
 */
function renderCurrentView() {
  const el = document.getElementById('page-settings');
  if (!el) return;

  switch (settingsView) {
    case 'main':
      renderSettingsMainMenu(el, ctxRef, goBack, navigateToView);
      break;
    case 'store':
      renderSettingsStore(el, ctxRef, goBack, navigateToView);
      break;
    case 'logo':
      renderSettingsLogoPage(el, ctxRef, goBack);
      break;
    case 'payment':
      renderSettingsPayment(el, ctxRef, goBack, navigateToView);
      break;
    case 'users':
      renderSettingsUsers(el, ctxRef, goBack, navigateToView);
      break;
    case 'document':
      renderSettingsDocument(el, ctxRef, goBack);
      break;
    case 'product-settings':
      renderProductSettings(el, ctxRef, goBack);
      break;
    case 'permissions':
      renderSettingsPermissions(el, ctxRef, goBack);
      break;
    case 'line-notify':
      renderSettingsLineNotify(el, ctxRef, goBack);
      break;
    case 'about':
      renderSettingsAbout(el, ctxRef, goBack);
      break;
    case 'ac-catalog':
      renderSettingsAcCatalog(el, ctxRef, goBack, navigateToView);
      break;
    default:
      renderSettingsMainMenu(el, ctxRef, goBack, navigateToView);
  }
  
  // Setup event listeners after render
  setupEventListeners();
}

/**
 * Go back to main menu
 */
function goBack() {
  settingsView = 'main';
  // ✅ Update URL hash
  window.location.hash = '#settings';
  renderCurrentView();
}

/**
 * Navigate to specific view
 * @param {string} viewName - View name to navigate to
 */
function navigateToView(viewName) {
  settingsView = viewName;
  // ✅ Update URL hash so F5 refresh remembers where we are
  window.location.hash = `#settings/${viewName}`;
  renderCurrentView();
}

// Export navigation for external use
export { navigateToView };
