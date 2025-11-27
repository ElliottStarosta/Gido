let state = {
  isActive: false,
  goal: '',
  apiServerUrl: 'https://gido-zb9c.onrender.com',
  currentStep: 0,
  steps: [],
  completedElements: new Set(),
  currentPage: window.location.href,
  actionHistory: [],
  baseDomain: new URL(window.location.href).hostname,
  isRecording: false,
  recognition: null,
  shadowRoot: null,
  isHistoryCollapsed: true
};

state.isClickInterceptionActive = false;

const HISTORY_LIMIT = 10;

function normalizeActionHistory(rawHistory = []) {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        step: index + 1,
        instruction: entry,
        action: '',
        targetText: '',
        reasoning: entry,
        timestamp: Date.now()
      };
    }
    return {
      step: entry?.step ?? index + 1,
      instruction: entry?.instruction || entry?.text || entry?.summary || '',
      action: entry?.action || '',
      targetText: entry?.targetText || entry?.target || '',
      reasoning: entry?.reasoning || '',
      timestamp: entry?.timestamp || Date.now()
    };
  });
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHistoryContext() {
  if (!state.actionHistory || state.actionHistory.length === 0) return '';
  const lines = state.actionHistory
    .map((entry, index) => {
      const actionLabel = entry.action ? entry.action.toUpperCase() : 'STEP';
      const detail = entry.instruction || entry.targetText || entry.reasoning || 'No detail available';
      return `${index + 1}. ${actionLabel}: ${detail}`;
    })
    .join('\n');
  return `\nPrevious actions taken:\n${lines}`;
}

function enableClickInterception() {
  state.isClickInterceptionActive = true;
  updateStatus('Click mode enabled - click any element on the page');
  
  document.addEventListener('click', handleDirectClick, true);
}
function disableClickInterception() {
  state.isClickInterceptionActive = false;
  document.removeEventListener('click', handleDirectClick, true);
}
function handleDirectClick(e) {
  if (!state.isClickInterceptionActive || !state.isActive) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const clickedElement = e.target;
  console.log('[Direct Click]', clickedElement);
  
  // Mark as completed and trigger interaction
  const allElements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="searchbox"]');
  for (let i = 0; i < allElements.length; i++) {
    if (allElements[i] === clickedElement || allElements[i].contains(clickedElement)) {
      state.completedElements.add(`elem_${i}`);
      break;
    }
  }
  
  disableClickInterception();
  onElementInteraction(e);
}


function loadGSAP() {
  return new Promise((resolve) => {
    if (window.gsap) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js';
    script.onload = () => {
      console.log('[GSAP] Loaded successfully');
      resolve();
    };
    script.onerror = () => {
      console.warn('[GSAP] Failed to load');
      resolve();
    };
    document.head.appendChild(script);
  });
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isSameDomain(url1, url2) {
  return getDomain(url1) === getDomain(url2);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'active' });
    return true;
  }
  if (request.action === 'startNavigation') {
    state.goal = request.goal;
    state.apiKey = request.apiKey;
    state.apiProvider = request.apiProvider || 'openrouter';
    console.log('[Content Script] Received goal');
    startNavigation(request.goal);
    sendResponse({ status: 'Navigation started' });
  }
  if (request.action === 'reset') {
    resetNavigation();
    sendResponse({ status: 'Reset complete' });
  }
  return true;
});

async function loadState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(['navState']);
      if (result.navState) {
        const saved = result.navState;
        // Load state regardless of domain if task is active
        state.isActive = saved.isActive || false;
        state.goal = saved.goal || '';
        state.apiKey = saved.apiKey || state.apiKey;
        state.apiProvider = saved.apiProvider || 'openrouter';
        state.currentStep = saved.currentStep || 0;
        state.completedElements = new Set(saved.completedElements || []);
        state.actionHistory = normalizeActionHistory(saved.actionHistory || []);
        state.currentPage = window.location.href;
        // Update baseDomain to current domain for cross-domain navigation
        state.baseDomain = getDomain(window.location.href);
        await saveState();
        
        if (state.isActive && state.goal) {
          setTimeout(() => {
            const panel = getElementFromShadow('aiNavPanel');
            const fab = getElementFromShadow('aiNavFab');
            if (panel && fab && window.gsap) {
              gsap.to(fab, { scale: 0, opacity: 0, duration: 0.3, onComplete: () => fab.classList.add('hidden') });
              gsap.to(panel, { scale: 1, opacity: 1, duration: 0.3 });
              panel.classList.add('open');
            }
            updateEndJourneyButtonVisibility();
            updateStatus(`Resuming: ${state.goal}`);
          }, 100);
          if (document.readyState === 'complete') {
            resumeNavigation();
          } else {
            window.addEventListener('load', resumeNavigation, { once: true });
          }
        } else {
          // Ensure button is hidden if no active navigation
          setTimeout(() => {
            updateEndJourneyButtonVisibility();
          }, 100);
        }
      }
    }
  } catch (error) {
    console.error('[State Load Error]', error);
  }
}

async function resumeNavigation() {
  updateStatus(`Resuming (Step ${state.currentStep + 1}): ${state.goal}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await highlightNextElement();
}

async function saveState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stateToSave = {
        isActive: state.isActive,
        goal: state.goal,
        apiKey: state.apiKey,
        apiProvider: state.apiProvider,
        currentStep: state.currentStep,
        completedElements: Array.from(state.completedElements),
        currentPage: state.currentPage,
        actionHistory: state.actionHistory,
        baseDomain: state.baseDomain,
        savedAt: Date.now()
      };
      await chrome.storage.local.set({ navState: stateToSave });
      console.log('[Content Script] State saved across tabs');
    }
  } catch (error) {
    console.error('[State Save Error]', error);
  }
}

async function clearStoredState() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(['navState']);
    console.log('[Content Script] State cleared - task completed');
  }
}

function getElementFromShadow(id) {
  if (!state.shadowRoot) return null;
  return state.shadowRoot.getElementById(id);
}

async function initUI() {
  await loadGSAP();
  await loadState();
  injectThinkingIndicatorStyles();
  createThinkingIndicator();
  createUIShadowDOM();
  injectPageStyles();
  updateTooltipColors();
  initSpeechRecognition();
  document.addEventListener('keydown', handleKeyboardShortcuts);
  console.log('[Content Script] UI initialized');
}


function handleKeyboardShortcuts(e) {
  // Alt + Shift + E: Complete goal and stop navigation
  if (e.altKey && e.shiftKey && e.code === 'KeyE') {
    e.preventDefault();
    completeGoal();
    return;
  }
  
  // Alt + Shift + C: Enable click mode (optional - allows clicking elements directly)
  if (e.altKey && e.shiftKey && e.code === 'KeyC') {
    e.preventDefault();
    if (state.isActive) {
      enableClickInterception();
    }
    return;
  }
}

function completeGoal() {
  if (!state.isActive) {
    updateStatus('No active navigation to complete');
    return;
  }
  
  removeHighlights();
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  clearActionHistory();
  state.baseDomain = '';
  
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Goal completed with keyboard shortcut!');
  
  // Clear stored state when task is manually ended
  clearStoredState();
  updateEndJourneyButtonVisibility();
  console.log('[Shortcut] Goal completed via Alt+Shift+E');
}

function endJourney() {
  if (!state.isActive) {
    updateStatus('No active navigation to end');
    return;
  }
  
  removeHighlights();
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  clearActionHistory();
  state.baseDomain = '';
  
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Journey ended successfully');
  
  // Clear stored state when task is manually ended
  clearStoredState();
  updateEndJourneyButtonVisibility();
  console.log('[End Journey] Navigation terminated by user');
}


function createUIShadowDOM() {
  if (getElementFromShadow('ai-nav-container')) {
    console.log('[Content Script] UI already exists');
    return;
  }

  const host = document.createElement('div');
  host.id = 'ai-nav-shadow-host';
  document.body.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  state.shadowRoot = shadowRoot;


  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: revert !important;
    }

    .ai-nav-container {
      position: fixed !important;
      bottom: 30px !important;
      right: 30px !important;
      z-index: 999999 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
    }

    .ai-nav-fab {
      position: fixed !important;
      bottom: 30px !important;
      right: 30px !important;
      width: 56px !important;
      height: 56px !important;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border: 1.5px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 50% !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 26px !important;
      color: white !important;
      box-shadow: 
        0 8px 32px rgba(102, 126, 234, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.3),
        inset 0 -1px 0 rgba(0, 0, 0, 0.1) !important;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      z-index: 999999 !important;
      padding: 0 !important;
    }

    .ai-nav-fab:hover {
      transform: scale(1.1) !important;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.3) 0%, rgba(118, 75, 162, 0.3) 100%) !important;
      box-shadow: 
        0 12px 40px rgba(102, 126, 234, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.4),
        inset 0 -1px 0 rgba(0, 0, 0, 0.15) !important;
      border-color: rgba(255, 255, 255, 0.4) !important;
    }

    .ai-nav-fab:active {
      transform: scale(0.95) !important;
    }

    .gido-logo {
      width: 32px !important;
      height: 32px !important;
      object-fit: contain !important;
    }

    .ai-nav-fab.hidden {
      display: none !important;
    }

    .ai-nav-panel {
      position: fixed !important;
      bottom: 30px !important;
      right: 30px !important;
      width: 380px !important;
      background: #ffffff !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 16px !important;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12) !important;
      display: none !important;
      flex-direction: column !important;
      z-index: 999999 !important;
      overflow: hidden !important;
    }

    .ai-nav-panel.open {
      display: flex !important;
    }

    .panel-header {
      background: #ffffff !important;
      color: #1f2937 !important;
      padding: 18px 20px !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      border-bottom: 1px solid #f0f0f0 !important;
    }

    .panel-header h3 {
      font-size: 16px !important;
      font-weight: 700 !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      margin: 0 !important;
      letter-spacing: -0.3px !important;
      color: #1f2937 !important;
    }

    .header-icon {
      width: 20px !important;
      height: 20px !important;
      color: #15803d !important;
    }

    .icon {
      width: 1em !important;
      height: 1em !important;
      display: inline-block !important;
      vertical-align: -0.125em !important;
    }

    .close-btn {
      background: #f3f4f6 !important;
      border: none !important;
      color: #6b7280 !important;
      width: 36px !important;
      height: 36px !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 18px !important;
      transition: all 0.2s !important;
      padding: 0 !important;
    }

    .close-btn:hover {
      background: #e5e7eb !important;
      color: #374151 !important;
      transform: scale(1.05) !important;
    }

    .close-btn:active {
      transform: scale(0.95) !important;
    }

    .input-section {
      padding: 16px 20px !important;
      display: flex !important;
      gap: 0 !important;
      align-items: flex-end !important;
      border-bottom: 1px solid #f0f0f0 !important;
      background: #ffffff !important;
    }

    .input-wrapper {
      flex: 1 !important;
      display: flex !important;
      gap: 10px !important;
      align-items: center !important;
      background: #f9fafb !important;
      border: 1.5px solid #e5e7eb !important;
      border-radius: 10px !important;
      padding: 12px 14px !important;
      transition: all 0.2s !important;
    }

    .input-wrapper:focus-within {
      border-color: #15803d !important;
      background: #ffffff !important;
      box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.08) !important;
    }

    .input-field {
      flex: 1 !important;
      border: none !important;
      background: transparent !important;
      outline: none !important;
      font-size: 14px !important;
      font-family: inherit !important;
      resize: none !important;
      max-height: 60px !important;
      color: #1f2937 !important;
      font-weight: 500 !important;
    }

    .input-field::placeholder {
      color: #9ca3af !important;
      font-weight: 400 !important;
    }

    .icon-btn {
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      color: #d1d5db !important;
      font-size: 16px !important;
      padding: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
      width: 24px !important;
      height: 24px !important;
    }

    .icon-btn:hover {
      color: #15803d !important;
      transform: scale(1.1) !important;
    }

    .icon-btn.recording {
      color: #04720dff !important;
      animation: ai-pulse 1.5s ease-in-out infinite !important;
    }

    .send-btn {
      width: 24px !important;
      height: 24px !important;
      background: #15803d !important;
      border: none !important;
      border-radius: 4px !important;
      cursor: pointer !important;
      color: white !important;
      font-size: 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
      flex-shrink: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      margin-left: 4px !important;
    }

    .send-btn:hover {
      background: #166534 !important;
      color: white !important;
      transform: scale(1.1) !important;
      box-shadow: none !important;
    }

    .send-btn:active {
      transform: scale(0.95) !important;
    }

    .history-section {
      padding: 16px 20px !important;
      border-top: 1px solid #f0f0f0 !important;
      border-bottom: 1px solid #f0f0f0 !important;
      background: #ffffff !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      max-height: 220px !important;
      transition: max-height 0.2s ease !important;
    }

    .history-section.collapsed {
      max-height: 70px !important;
    }

    .history-section.collapsed .history-list {
      display: none !important;
    }

    .history-section.collapsed .history-empty {
      display: none !important;
    }

    .history-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      font-size: 13px !important;
      color: #374151 !important;
      font-weight: 600 !important;
    }

    .history-title {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
    }

    .history-count {
      font-size: 12px !important;
      color: #6b7280 !important;
      background: #f3f4f6 !important;
      border-radius: 999px !important;
      padding: 2px 8px !important;
      font-weight: 600 !important;
    }

    .history-controls {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
    }

    .history-toggle {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      padding: 4px 8px !important;
      border-radius: 8px !important;
      border: 1px solid transparent !important;
      background: #f3f4f6 !important;
      color: #4b5563 !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: background 0.15s ease, color 0.15s ease !important;
    }

    .history-toggle:hover {
      background: #e5e7eb !important;
      color: #111827 !important;
    }

    .history-toggle:focus {
      outline: 2px solid #15803d !important;
      outline-offset: 2px !important;
    }

    .history-toggle-icon {
      width: 12px !important;
      height: 12px !important;
      transition: transform 0.2s ease !important;
    }

    .history-section.collapsed .history-toggle-icon {
      transform: rotate(-90deg) !important;
    }

    .history-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
      max-height: 170px !important;
      overflow-y: auto !important;
      padding-right: 4px !important;
    }

    .history-empty {
      font-size: 12px !important;
      color: #9ca3af !important;
      text-align: center !important;
      margin: 0 !important;
    }

    .history-item {
      background: #f9fafb !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 12px !important;
      padding: 12px !important;
    }

    .history-item-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      font-size: 12px !important;
      color: #6b7280 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
    }

    .history-item-step {
      font-weight: 700 !important;
      color: #111827 !important;
    }

    .history-item-action {
      font-weight: 600 !important;
      color: #047857 !important;
    }

    .history-item-instruction {
      margin-top: 8px !important;
      font-size: 13px !important;
      color: #1f2937 !important;
      font-weight: 600 !important;
      line-height: 1.5 !important;
    }

    .history-item-target,
    .history-item-reason {
      margin-top: 6px !important;
      font-size: 12px !important;
      color: #4b5563 !important;
      line-height: 1.4 !important;
    }

    .status-box {
      padding: 16px 20px !important;
      background: #f9fafb !important;
      border-top: 1px solid #f0f0f0 !important;
      min-height: 68px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .status-text {
      font-size: 13px !important;
      color: #6b7280 !important;
      font-weight: 500 !important;
      text-align: center !important;
      line-height: 1.5 !important;
      margin: 0 !important;
    }

    .status-text i {
      margin-right: 8px !important;
      color: #15803d !important;
    }

    .status-text.loading i {
      animation: ai-spin 1s linear infinite !important;
    }

    .end-journey-btn {
      width: 100% !important;
      padding: 12px 20px !important;
      background: #016b17ff !important;
      color: white !important;
      border: none !important;
      border-radius: 10px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      transition: all 0.2s ease !important;
      margin-top: 12px !important;
      box-shadow: 0 2px 8px rgba(220, 38, 38, 0.2) !important;
    }

    .end-journey-btn:hover {
      background: #b91c1c !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3) !important;
    }

    .end-journey-btn:active {
      transform: translateY(0) !important;
      box-shadow: 0 2px 6px rgba(220, 38, 38, 0.25) !important;
    }

    .end-journey-btn.hidden {
      display: none !important;
    }

    @keyframes ai-pulse {
      0%, 100% { opacity: 1 !important; }
      50% { opacity: 0.6 !important; }
    }

    @keyframes ai-spin {
      from { transform: rotate(0deg) !important; }
      to { transform: rotate(360deg) !important; }
    }

    @media (max-width: 600px) {
      .ai-nav-panel {
        width: calc(100vw - 40px) !important;
        max-height: 70vh !important;
      }
    }
  `;
  shadowRoot.appendChild(style);

  const container = document.createElement('div');
  container.id = 'ai-nav-container';
  container.className = 'ai-nav-container';
  container.innerHTML = `
    <button class="ai-nav-fab" id="aiNavFab">
      <img src="${chrome.runtime.getURL('icons/gido.png')}" alt="Gido" class="gido-logo">
    </button>
    <div class="ai-nav-panel" id="aiNavPanel">
      <div class="panel-header">
        <h3>
          <svg class="icon header-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          GIDO
        </h3>
        <button class="close-btn" id="aiNavClose">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="input-section">
        <div class="input-wrapper">
          <input 
            type="text" 
            class="input-field" 
            placeholder="What should I do?"
            id="aiNavInput"
          >
          <button class="icon-btn" id="aiNavMic">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v12a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
          <button class="send-btn" id="aiNavSend">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <div class="history-section" id="aiNavHistorySection">
        <div class="history-header">
          <div class="history-title">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16v16H4z"></path>
              <path d="M8 2v4M16 2v4M4 10h16"></path>
            </svg>
            Instruction history
          </div>
          <div class="history-controls">
            <span class="history-count" id="aiNavHistoryCount">0</span>
            <button 
              class="history-toggle" 
              id="aiNavHistoryToggleBtn" 
              type="button" 
              aria-expanded="false"
              aria-controls="aiNavHistoryList"
            >
              <span id="aiNavHistoryToggleText">Show</span>
              <svg class="history-toggle-icon" id="aiNavHistoryToggleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="history-list" id="aiNavHistoryList">
          <p class="history-empty">No instructions yet.</p>
        </div>
      </div>
      <div class="status-box">
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
          <div class="status-text" id="aiNavStatus">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            Ready to help
          </div>
          <button class="end-journey-btn hidden" id="aiNavEndJourney">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            End Journey
          </button>
        </div>
      </div>
    </div>
  `;
  shadowRoot.appendChild(container);
  renderActionHistory();
  initHistoryToggle();
  updateEndJourneyButtonVisibility();

  console.log('[Content Script] UI created');
  setupEventListeners();
  setupTextareaAutoResize();
}

function injectPageStyles() {
  if (document.getElementById('ai-nav-page-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'ai-nav-page-styles';
  style.textContent = `
    .ai-nav-highlight-overlay {
      border: 3px solid #15803d !important;
      border-radius: 12px !important;
      box-shadow: 0 0 0 5px rgba(21, 128, 61, 0.12), 0 0 30px rgba(21, 128, 61, 0.25), inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      animation: ai-pulse-overlay 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
      pointer-events: none !important;
      background: linear-gradient(135deg, rgba(21, 128, 61, 0.06) 0%, rgba(34, 197, 94, 0.06) 100%) !important;
      position: absolute !important;
      z-index: 999997 !important;
    }
    
    @keyframes ai-pulse-overlay {
      0%, 100% {
        box-shadow: 0 0 0 5px rgba(21, 128, 61, 0.12), 0 0 30px rgba(21, 128, 61, 0.25), inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      }
      50% {
        box-shadow: 0 0 0 8px rgba(21, 128, 61, 0.2), 0 0 45px rgba(21, 128, 61, 0.4), inset 0 0 0 2px rgba(255, 255, 255, 0.7) !important;
      }
    }
    
    .ai-nav-tooltip {
      background: #1f2937 !important;
      color: white !important;
      padding: 12px 16px !important;
      border-radius: 10px !important;
      font-size: 13px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      z-index: 999998 !important;
      pointer-events: auto !important;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3) !important;
      max-width: 220px !important;
      text-align: center !important;
      line-height: 1.5 !important;
      white-space: normal !important;
      word-wrap: break-word !important;
      animation: ai-tooltip-fadein 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      position: absolute !important;
    }
    
    .ai-nav-tooltip:hover {
      cursor: none !important;
    }
    
    .ai-nav-tooltip-magnifier {
      position: fixed !important;
      width: 425px !important;
      height: 160px !important;
      border: 3px solid #15803d !important;
      border-radius: 10px !important;
      background: white !important;
      z-index: 999999 !important;
      pointer-events: none !important;
      display: none !important;
      box-shadow: 0 0 0 2px #15803d, inset 0 0 15px rgba(21, 128, 61, 0.2), 0 8px 16px rgba(0, 0, 0, 0.2) !important;
      overflow: hidden !important;
    }
    
    .ai-nav-tooltip-magnifier.active {
      display: block !important;
      cursor: none !important;
      caret-color: transparent !important;
    }
    
    .ai-nav-tooltip-magnifier-content {
      position: absolute !important;
      width: 220px !important;
      height: 100px !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      color: #1f2937 !important;
      line-height: 1.5 !important;
      overflow: hidden !important;
      white-space: normal !important;
      word-wrap: break-word !important;
    }
    
    @keyframes ai-tooltip-fadein {
      from {
        opacity: 0 !important;
        transform: translateX(-50%) translateY(10px) scale(0.9) !important;
      }
      to {
        opacity: 1 !important;
        transform: translateX(-50%) translateY(0) scale(1) !important;
      }
    }
    
    .ai-nav-tooltip-action {
      font-size: 11px !important;
      font-weight: 800 !important;
      letter-spacing: 1.2px !important;
      margin-bottom: 6px !important;
      color: #10b981 !important;
      text-transform: uppercase !important;
    }
    
    .ai-nav-tooltip-instruction {
      font-size: 13px !important;
      font-weight: 500 !important;
      opacity: 0.95 !important;
      line-height: 1.5 !important;
      color: #f3f4f6 !important;
    }
    
    .ai-nav-tooltip-arrow {
      position: absolute !important;
      left: 50% !important;
      width: 0 !important;
      height: 0 !important;
      border-left: 8px solid transparent !important;
      border-right: 8px solid transparent !important;
      pointer-events: none !important;
    }
    
    .journey-complete-notification {
      position: fixed !important;
      top: 20px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: white !important;
      padding: 16px 24px !important;
      border-radius: 12px !important;
      box-shadow: 0 10px 40px rgba(16, 185, 129, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) inset !important;
      z-index: 1000000 !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      min-width: 320px !important;
      max-width: 90vw !important;
      animation: journey-complete-slide-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      pointer-events: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      cursor: pointer !important;
      transition: transform 0.2s ease !important;
    }
    
    .journey-complete-notification:hover {
      transform: translateX(-50%) translateY(-2px) !important;
    }
    
    .journey-complete-notification.hidden {
      display: none !important;
    }
    
    .journey-complete-notification-icon {
      width: 24px !important;
      height: 24px !important;
      flex-shrink: 0 !important;
      animation: journey-complete-bounce 0.6s ease-out !important;
    }
    
    @keyframes journey-complete-slide-in {
      from {
        opacity: 0 !important;
        transform: translateX(-50%) translateY(-20px) scale(0.9) !important;
      }
      to {
        opacity: 1 !important;
        transform: translateX(-50%) translateY(0) scale(1) !important;
      }
    }
    
    @keyframes journey-complete-bounce {
      0%, 100% {
        transform: scale(1) !important;
      }
      50% {
        transform: scale(1.2) !important;
      }
    }

    .ai-thinking-indicator {
      position: fixed !important;
      top: 30px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      color: white !important;
      padding: 14px 24px !important;
      border-radius: 12px !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      z-index: 999998 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      box-shadow: 
        0 8px 32px rgba(102, 126, 234, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.2),
        inset 0 -1px 0 rgba(0, 0, 0, 0.1) !important;
      border: 1.5px solid rgba(255, 255, 255, 0.2) !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.3s ease !important;
      animation: ai-thinking-slide-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
    }

    .ai-thinking-indicator.hidden {
      display: none !important;
    }

    .ai-thinking-indicator.show {
      opacity: 1 !important;
    }

    .ai-thinking-icon {
      width: 20px !important;
      height: 20px !important;
      display: inline-block !important;
      animation: ai-thinking-spin 2s linear infinite !important;
      flex-shrink: 0 !important;
    }

    @keyframes ai-thinking-spin {
      from {
        transform: rotate(0deg) !important;
      }
      to {
        transform: rotate(360deg) !important;
      }
    }

    @keyframes ai-thinking-slide-in {
      from {
        opacity: 0 !important;
        transform: translateX(-50%) translateY(-20px) scale(0.9) !important;
      }
      to {
        opacity: 1 !important;
        transform: translateX(-50%) translateY(0) scale(1) !important;
      }
    }
  `;
  
  document.head.appendChild(style);
  console.log('[Page Styles] Injected highlight and tooltip styles');
}



function setupPanelMagnifier() {
  const shadowRoot = state.shadowRoot;
  if (!shadowRoot) return;

  // Create magnifier styles IN THE SHADOW ROOT
  const style = document.createElement('style');
  style.textContent = `
    .ai-nav-panel-magnifier {
      position: fixed !important;
      width: 280px !important;
      height: 180px !important;
      border: 3px solid #15803d !important;
      border-radius: 12px !important;
      background: white !important;
      z-index: 1000001 !important;
      pointer-events: none !important;
      display: none !important;
      box-shadow: 
        0 0 0 2px #15803d,
        inset 0 0 15px rgba(21, 128, 61, 0.1),
        0 12px 24px rgba(0, 0, 0, 0.25) !important;
      overflow: hidden !important;
      opacity: 0 !important;
      transition: opacity 0.15s ease !important;
      cursor: none !important;
    }

    .ai-nav-panel-magnifier.active {
      display: block !important;
      opacity: 1 !important;
      cursor: none !important;
    }

    .ai-nav-panel-magnifier-content {
      position: absolute !important;
      width: 100% !important;
      height: 100% !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      font-size: 24px !important;
      line-height: 1.6 !important;
      overflow: hidden !important;
      pointer-events: none !important;
      color: #1f2937 !important;
      padding: 12px !important;
      box-sizing: border-box !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
    }

    .ai-nav-panel-magnifier-label {
      position: absolute !important;
      top: 8px !important;
      right: 8px !important;
      background: rgba(21, 128, 61, 0.9) !important;
      color: white !important;
      padding: 3px 8px !important;
      border-radius: 4px !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      letter-spacing: 0.5px !important;
      pointer-events: none !important;
    }

    .ai-nav-panel-magnifier-reticle {
      position: absolute !important;
      width: 3px !important;
      height: 3px !important;
      background: rgba(21, 128, 61, 0.7) !important;
      border-radius: 50% !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      pointer-events: none !important;
    }
  `;
  shadowRoot.appendChild(style);

  // Create magnifier HTML IN THE SHADOW ROOT
  const magnifierDiv = document.createElement('div');
  magnifierDiv.className = 'ai-nav-panel-magnifier';
  magnifierDiv.id = 'ai-nav-panel-magnifier';

  const content = document.createElement('div');
  content.className = 'ai-nav-panel-magnifier-content';
  content.id = 'ai-nav-panel-magnifier-content';

  const label = document.createElement('div');
  label.className = 'ai-nav-panel-magnifier-label';
  label.textContent = '2x ZOOM';

  const reticle = document.createElement('div');
  reticle.className = 'ai-nav-panel-magnifier-reticle';

  magnifierDiv.appendChild(content);
  magnifierDiv.appendChild(label);
  magnifierDiv.appendChild(reticle);
  shadowRoot.appendChild(magnifierDiv);

  // Hide cursor when magnifier is active
  const cursorHideStyle = document.createElement('style');
  cursorHideStyle.textContent = `
    body.magnifier-active,
    body.magnifier-active * {
      cursor: none !important;
    }
    body.magnifier-active input,
    body.magnifier-active textarea,
    body.magnifier-active input:focus,
    body.magnifier-active textarea:focus {
      caret-color: transparent !important;
      cursor: none !important;
    }
  `;
  document.head.appendChild(cursorHideStyle);

  const magnifier = {
    element: magnifierDiv,
    content: content,
    isActive: false,
    hoverTimeout: null,
    currentTarget: null
  };

  // Get panel elements from shadow root
  const panel = getElementFromShadow('aiNavPanel');
  const input = getElementFromShadow('aiNavInput');
  const historyList = getElementFromShadow('aiNavHistoryList');

  if (!panel || !input || !historyList) {
    console.warn('[Panel Magnifier] Could not find panel elements');
    return;
  }

  // Show magnifier when hovering over panel text - hold 1.5 seconds
  panel.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'SVG' || target === input) return;

    const text = target.textContent || '';
    if (!text || text.trim().length < 2) return;

    if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);

    magnifier.hoverTimeout = setTimeout(() => {
      if (!target.textContent || !document.contains(target)) return;
      
      magnifier.currentTarget = target;
      content.textContent = target.textContent.trim();
      content.style.fontSize = '24px';
      content.style.fontWeight = window.getComputedStyle(target).fontWeight || '600';
      content.style.color = window.getComputedStyle(target).color || '#1f2937';

      magnifier.isActive = true;
      magnifierDiv.classList.add('active');
      document.body.classList.add('magnifier-active');
      
      updateMagnifierPosition(e.clientX, e.clientY);
    }, 1500);
  }, true);

  // Hide magnifier when leaving panel or the specific element
  panel.addEventListener('mouseout', (e) => {
    const target = e.target;
    
    // Only hide if we're actually leaving the element that triggered it
    if (magnifier.currentTarget === target || magnifier.currentTarget?.contains(target)) {
      if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);
      magnifier.isActive = false;
      magnifier.currentTarget = null;
      magnifierDiv.classList.remove('active');
      document.body.classList.remove('magnifier-active');
    }
  }, true);

  // Follow mouse while magnifier is active - zoom over cursor position
  panel.addEventListener('mousemove', (e) => {
    if (!magnifier.isActive || !magnifier.currentTarget) return;
    
    // Check if still over the same element
    if (!magnifier.currentTarget.contains(e.target) && magnifier.currentTarget !== e.target) {
      // Left the element, hide magnifier
      magnifier.isActive = false;
      magnifier.currentTarget = null;
      magnifierDiv.classList.remove('active');
      document.body.classList.remove('magnifier-active');
      if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);
      return;
    }
    
    updateMagnifierPosition(e.clientX, e.clientY);
  }, true);

  // Show magnifier when hovering over history - hold 1.5 seconds
  historyList.addEventListener('mouseover', (e) => {
    const historyItem = e.target.closest('.history-item');
    if (!historyItem) return;

    const text = historyItem.textContent || '';
    if (!text || text.trim().length < 2) return;

    if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);

    magnifier.hoverTimeout = setTimeout(() => {
      if (!document.contains(historyItem)) return;
      
      magnifier.currentTarget = historyItem;
      content.textContent = historyItem.textContent.trim();
      content.style.fontSize = '22px';
      content.style.fontWeight = '600';
      content.style.color = '#1f2937';

      magnifier.isActive = true;
      magnifierDiv.classList.add('active');
      document.body.classList.add('magnifier-active');
      updateMagnifierPosition(e.clientX, e.clientY);
    }, 1500);
  }, true);

  // Follow mouse in history
  historyList.addEventListener('mousemove', (e) => {
    if (!magnifier.isActive || !magnifier.currentTarget) return;
    
    const historyItem = e.target.closest('.history-item');
    if (historyItem !== magnifier.currentTarget) {
      magnifier.isActive = false;
      magnifier.currentTarget = null;
      magnifierDiv.classList.remove('active');
      document.body.classList.remove('magnifier-active');
      if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);
      return;
    }
    
    updateMagnifierPosition(e.clientX, e.clientY);
  }, true);

  historyList.addEventListener('mouseout', () => {
    if (magnifier.hoverTimeout) clearTimeout(magnifier.hoverTimeout);
    magnifier.isActive = false;
    magnifier.currentTarget = null;
    magnifierDiv.classList.remove('active');
    document.body.classList.remove('magnifier-active');
  }, true);

  function updateMagnifierPosition(cursorX, cursorY) {
    const magnifierHeight = 180;
    const magnifierWidth = 280;

    // Center magnifier on cursor
    let left = cursorX - magnifierWidth / 2;
    let top = cursorY - magnifierHeight / 2;

    // Keep within viewport with padding
    if (left < 10) left = 10;
    if (left + magnifierWidth > window.innerWidth - 10) {
      left = window.innerWidth - magnifierWidth - 10;
    }
    if (top < 10) top = 10;
    if (top + magnifierHeight > window.innerHeight - 10) {
      top = window.innerHeight - magnifierHeight - 10;
    }

    magnifierDiv.style.left = left + 'px';
    magnifierDiv.style.top = top + 'px';
  }
}

function setupTypingMagnifier() {
  // Create styles for the typing magnifier
  const style = document.createElement('style');
  style.id = 'ai-typing-magnifier-styles';
  style.textContent = `
    .ai-typing-magnifier {
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      width: 600px !important;
      height: 120px !important;
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%) !important;
      border: 3px solid #15803d !important;
      border-radius: 16px !important;
      box-shadow: 
        0 0 0 2px #15803d,
        inset 0 0 20px rgba(21, 128, 61, 0.08),
        0 20px 40px rgba(0, 0, 0, 0.15) !important;
      z-index: 1000002 !important;
      pointer-events: none !important;
      display: none !important;
      opacity: 0 !important;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      overflow: hidden !important;
    }

    .ai-typing-magnifier.active {
      display: block !important;
      opacity: 1 !important;
      transform: translate(-50%, -50%) scale(1) !important;
    }

    .ai-typing-magnifier-content {
      position: absolute !important;
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 20px !important;
      box-sizing: border-box !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      font-size: 32px !important;
      font-weight: 600 !important;
      color: #1f2937 !important;
      line-height: 1.4 !important;
      text-align: center !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      overflow: hidden !important;
    }

    .ai-typing-magnifier-label {
      position: absolute !important;
      top: 12px !important;
      right: 16px !important;
      background: rgba(21, 128, 61, 0.9) !important;
      color: white !important;
      padding: 4px 10px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      letter-spacing: 0.8px !important;
      text-transform: uppercase !important;
      pointer-events: none !important;
    }

    .ai-typing-magnifier-cursor {
      display: inline-block !important;
      width: 2px !important;
      height: 1.2em !important;
      background: #15803d !important;
      margin-left: 2px !important;
      animation: ai-typing-cursor-blink 1s infinite !important;
    }

    @keyframes ai-typing-cursor-blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }

    .ai-typing-magnifier-placeholder {
      color: #9ca3af !important;
      font-style: italic !important;
    }

    @media (max-width: 700px) {
      .ai-typing-magnifier {
        width: 90vw !important;
        height: 100px !important;
      }
      
      .ai-typing-magnifier-content {
        font-size: 24px !important;
        padding: 16px !important;
      }
    }
  `;
  
  // Remove old style if exists
  const oldStyle = document.getElementById('ai-typing-magnifier-styles');
  if (oldStyle) oldStyle.remove();
  
  document.head.appendChild(style);

  // Create magnifier HTML
  const magnifierDiv = document.createElement('div');
  magnifierDiv.className = 'ai-typing-magnifier';
  magnifierDiv.id = 'ai-typing-magnifier';

  const content = document.createElement('div');
  content.className = 'ai-typing-magnifier-content';
  content.id = 'ai-typing-magnifier-content';

  const label = document.createElement('div');
  label.className = 'ai-typing-magnifier-label';
  label.textContent = 'TYPING VIEW';

  magnifierDiv.appendChild(content);
  magnifierDiv.appendChild(label);
  document.body.appendChild(magnifierDiv);

  const typingMagnifier = {
    element: magnifierDiv,
    content: content,
    isActive: false,
    typingTimeout: null,
    lastValue: ''
  };

  // Get input element from shadow root
  const input = getElementFromShadow('aiNavInput');
  
  if (!input) {
    console.warn('[Typing Magnifier] Could not find input element');
    return;
  }

  // Show magnifier when user starts typing
  input.addEventListener('input', (e) => {
    const currentValue = e.target.value;
    
    // Clear existing timeout
    if (typingMagnifier.typingTimeout) {
      clearTimeout(typingMagnifier.typingTimeout);
    }

    // Show magnifier if user is typing
    if (currentValue.length > 0) {
      if (!typingMagnifier.isActive) {
        typingMagnifier.isActive = true;
        magnifierDiv.classList.add('active');
        console.log('[Typing Magnifier] Activated');
      }
      
      // Update content with typing cursor
      updateTypingContent(currentValue);
      
      // Hide magnifier after 3 seconds of no typing
      typingMagnifier.typingTimeout = setTimeout(() => {
        hideTypingMagnifier();
      }, 3000);
    } else {
      // Hide immediately if input is empty
      hideTypingMagnifier();
    }
    
    typingMagnifier.lastValue = currentValue;
  });

  // Also show magnifier when user focuses on input and starts typing
  input.addEventListener('focus', () => {
    if (input.value.length > 0) {
      if (!typingMagnifier.isActive) {
        typingMagnifier.isActive = true;
        magnifierDiv.classList.add('active');
        updateTypingContent(input.value);
        console.log('[Typing Magnifier] Activated on focus');
      }
    }
  });

  // Hide magnifier when input loses focus (after a delay)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!input.matches(':focus')) {
        hideTypingMagnifier();
      }
    }, 500);
  });

  // Handle keydown events for immediate response
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      hideTypingMagnifier();
      return;
    }
    
    // Show magnifier immediately when user starts typing (before input event)
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
      const currentValue = input.value;
      
      // Predict what the value will be after this keypress
      let futureValue = currentValue;
      if (e.key === 'Backspace') {
        futureValue = currentValue.slice(0, -1);
      } else if (e.key === 'Delete') {
        // Handle delete key
        futureValue = currentValue;
      } else if (e.key.length === 1) {
        futureValue = currentValue + e.key;
      }
      
      if (futureValue.length > 0 && !typingMagnifier.isActive) {
        typingMagnifier.isActive = true;
        magnifierDiv.classList.add('active');
        console.log('[Typing Magnifier] Activated on keydown');
      }
    }
  });

  function updateTypingContent(text) {
    if (text.trim().length === 0) {
      content.innerHTML = '<span class="ai-typing-magnifier-placeholder">Start typing your instruction...</span>';
    } else {
      // Show text with blinking cursor
      content.innerHTML = `${escapeHtml(text)}<span class="ai-typing-magnifier-cursor"></span>`;
    }
  }

  function hideTypingMagnifier() {
    if (typingMagnifier.isActive) {
      typingMagnifier.isActive = false;
      magnifierDiv.classList.remove('active');
      console.log('[Typing Magnifier] Deactivated');
    }
    
    if (typingMagnifier.typingTimeout) {
      clearTimeout(typingMagnifier.typingTimeout);
      typingMagnifier.typingTimeout = null;
    }
  }

  // Initialize with placeholder
  updateTypingContent('');
  
  console.log('[Typing Magnifier] Setup complete');
}

function injectThinkingIndicatorStyles() {
  if (document.getElementById('ai-thinking-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'ai-thinking-styles';
  style.textContent = `
    @keyframes scale-in {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    @keyframes l21 {
      50%  {box-shadow: 19px 0 0 3px, 38px 0 0 7px, 57px 0 0 3px}
      100% {box-shadow: 19px 0 0 0, 38px 0 0 3px, 57px 0 0 7px}
    }

    @keyframes pulse-opacity {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .ai-thinking-indicator {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, #15803d 0%, #10b981 100%);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      color: white;
      padding: 80px 50px 50px 50px;
      border-radius: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 30px;
      z-index: 999998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      box-shadow: 0 25px 80px rgba(21, 128, 61, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.4), inset 0 -1px 0 rgba(0, 0, 0, 0.2);
      border: 2.5px solid rgba(255, 255, 255, 0.4);
      opacity: 0;
      pointer-events: none;
      animation: scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      width: 350px;
      text-align: center;
      line-height: 1.4;
    }

    .ai-thinking-indicator.hidden {
      display: none !important;
    }

    .ai-thinking-indicator.show {
      opacity: 1;
    }

    .ai-thinking-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      width: 100%;
    }

    .loading-dots {
      color: #ffffff;
      width: 4px;
      aspect-ratio: 1;
      border-radius: 50%;
      box-shadow: 19px 0 0 7px, 38px 0 0 3px, 57px 0 0 0;
      transform: translateX(-38px);
      animation: l21 0.5s infinite alternate linear;
    }

    .gido-thinking-text {
      font-size: 28px;
      font-weight: 700;
      color: white;
      margin: 0;
      letter-spacing: 0.5px;
      animation: pulse-opacity 2s ease-in-out infinite;
      text-transform: uppercase;
    }

    @media (max-width: 600px) {
      .ai-thinking-indicator {
        padding: 40px 50px;
        min-width: 90vw;
      }

      .gido-thinking-text {
        font-size: 24px;
      }

      .factory-loader {
        width: 70px;
        height: 12px;
      }
    }
  `;
  
  document.head.appendChild(style);
  console.log('[Thinking Indicator Styles] Injected');
}


function createThinkingIndicator() {
  if (document.getElementById('ai-thinking-indicator')) {
    return;
  }

  const indicator = document.createElement('div');
  indicator.id = 'ai-thinking-indicator';
  indicator.className = 'ai-thinking-indicator hidden';
  indicator.innerHTML = `
    <div class="ai-thinking-container">
      <div class="loading-dots"></div>
      <div class="gido-thinking-text">GIDO IS THINKING</div>
    </div>
  `;
  
  document.body.appendChild(indicator);
  console.log('[Thinking Indicator] Created');
}


// Show the thinking indicator
function showThinkingIndicator() {
  const indicator = document.getElementById('ai-thinking-indicator');
  if (indicator) {
    indicator.classList.remove('hidden');
    setTimeout(() => {
      indicator.classList.add('show');
    }, 10);
  }
}

// Hide the thinking indicator
function hideThinkingIndicator() {
  const indicator = document.getElementById('ai-thinking-indicator');
  if (indicator) {
    indicator.classList.remove('show');
    setTimeout(() => {
      indicator.classList.add('hidden');
    }, 300);
  }
}


function openPanel() {
  const panel = getElementFromShadow('aiNavPanel');
  const fab = getElementFromShadow('aiNavFab');
  
  if (window.gsap) {
    gsap.to(fab, { scale: 0, opacity: 0, duration: 0.3, onComplete: () => fab.classList.add('hidden') });
    panel.classList.add('open');
    gsap.fromTo(panel, 
      { scale: 0.8, opacity: 0, y: 20 },
      { scale: 1, opacity: 1, y: 0, duration: 0.3, ease: 'back.out(1.7)' }
    );
  } else {
    panel.classList.add('open');
    fab.classList.add('hidden');
  }
  updateEndJourneyButtonVisibility();
  setTimeout(() => {
    getElementFromShadow('aiNavInput').focus();
  }, 300);
}

function closePanel() {
  const panel = getElementFromShadow('aiNavPanel');
  const fab = getElementFromShadow('aiNavFab');
  
  if (window.gsap) {
    gsap.to(panel, { scale: 0.8, opacity: 0, y: 20, duration: 0.3, onComplete: () => panel.classList.remove('open') });
    fab.classList.remove('hidden');
    gsap.fromTo(fab, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
  } else {
    panel.classList.remove('open');
    fab.classList.remove('hidden');
  }
}

function setupEventListeners() {
  const fab = getElementFromShadow('aiNavFab');
  const closeBtn = getElementFromShadow('aiNavClose');
  
  fab.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  getElementFromShadow('aiNavSend').addEventListener('click', handleSend);
  getElementFromShadow('aiNavInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  getElementFromShadow('aiNavMic').addEventListener('click', toggleSpeechRecognition);
  getElementFromShadow('aiNavEndJourney').addEventListener('click', endJourney);
  setupPanelMagnifier();
  setupTypingMagnifier();
}

function setupTextareaAutoResize() {
  const textarea = getElementFromShadow('aiNavInput');
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 60) + 'px';
  });
}


function updateStatus(text, loading = false) {
  const status = getElementFromShadow('aiNavStatus');
  if (status) {
    status.innerHTML = text;
    status.classList.toggle('loading', loading);
    if (window.gsap) {
      gsap.fromTo(status, { y: -5, opacity: 0.8 }, { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
    }
  }
}

function updateEndJourneyButtonVisibility() {
  const endJourneyBtn = getElementFromShadow('aiNavEndJourney');
  if (endJourneyBtn) {
    if (state.isActive) {
      endJourneyBtn.classList.remove('hidden');
    } else {
      endJourneyBtn.classList.add('hidden');
    }
  }
}

function showJourneyCompleteNotification() {
  // Remove any existing notification
  const existingNotification = document.getElementById('journey-complete-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.id = 'journey-complete-notification';
  notification.className = 'journey-complete-notification';
  notification.innerHTML = `
    <svg class="journey-complete-notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <div>
      <div style="font-weight: 700; margin-bottom: 2px;">Journey Complete!</div>
      <div style="font-size: 13px; font-weight: 400; opacity: 0.95;">You've reached your destination</div>
    </div>
  `;

  document.body.appendChild(notification);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (notification && notification.parentNode) {
      if (window.gsap) {
        gsap.to(notification, {
          opacity: 0,
          y: -20,
          scale: 0.9,
          duration: 0.3,
          onComplete: () => notification.remove()
        });
      } else {
        notification.remove();
      }
    }
  }, 5000);

  // Also add click to dismiss
  notification.addEventListener('click', () => {
    if (window.gsap) {
      gsap.to(notification, {
        opacity: 0,
        y: -20,
        scale: 0.9,
        duration: 0.3,
        onComplete: () => notification.remove()
      });
    } else {
      notification.remove();
    }
  });
}

function renderActionHistory() {
  const list = getElementFromShadow('aiNavHistoryList');
  const count = getElementFromShadow('aiNavHistoryCount');
  if (!list) return;

  const history = state.actionHistory || [];
  if (count) {
    count.textContent = history.length;
  }

  if (history.length === 0) {
    list.innerHTML = '<p class="history-empty">No instructions yet.</p>';
    return;
  }

  const items = history
    .map((entry, index) => {
      const stepLabel = entry.step || index + 1;
      const actionLabel = entry.action ? entry.action.toUpperCase() : 'STEP';
      const targetLabel = entry.targetText
        ? `<div class="history-item-target">${escapeHtml(entry.targetText)}</div>`
        : '';
      const reasoningLabel = entry.reasoning
        ? `<div class="history-item-reason">${escapeHtml(entry.reasoning)}</div>`
        : '';
      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-item-step">Step ${escapeHtml(stepLabel.toString())}</span>
            <span class="history-item-action">${escapeHtml(actionLabel)}</span>
          </div>
          <div class="history-item-instruction">${escapeHtml(entry.instruction || 'Instruction unavailable')}</div>
          ${targetLabel}
          ${reasoningLabel}
        </div>
      `;
    })
    .join('');

  list.innerHTML = items;
  updateHistoryCollapseState();
}

function updateHistoryCollapseState() {
  const section = getElementFromShadow('aiNavHistorySection');
  const list = getElementFromShadow('aiNavHistoryList');
  const toggleBtn = getElementFromShadow('aiNavHistoryToggleBtn');
  const toggleText = getElementFromShadow('aiNavHistoryToggleText');

  if (!section || !list || !toggleBtn) return;

  section.classList.toggle('collapsed', state.isHistoryCollapsed);
  list.style.display = state.isHistoryCollapsed ? 'none' : 'flex';
  list.setAttribute('aria-hidden', state.isHistoryCollapsed ? 'true' : 'false');
  toggleBtn.setAttribute('aria-expanded', (!state.isHistoryCollapsed).toString());

  if (toggleText) {
    toggleText.textContent = state.isHistoryCollapsed ? 'Show' : 'Hide';
  }
}

function initHistoryToggle() {
  const toggleBtn = getElementFromShadow('aiNavHistoryToggleBtn');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    state.isHistoryCollapsed = !state.isHistoryCollapsed;
    updateHistoryCollapseState();
  });

  updateHistoryCollapseState();
}

function clearActionHistory() {
  state.actionHistory = [];
  renderActionHistory();
}

async function handleSend() {
  const goal = getElementFromShadow('aiNavInput').value.trim();
  if (!goal) return;
  getElementFromShadow('aiNavInput').value = '';
  if (window.gsap) {
    gsap.to(getElementFromShadow('aiNavSend'), { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 });
  }
  await startNavigation(goal);
}

function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
      state.isRecording = true;
      const micBtn = getElementFromShadow('aiNavMic');
      micBtn.classList.add('recording');
      updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg> Listening...', true);
      if (window.gsap) {
        gsap.to(micBtn, { scale: 1.15, duration: 0.2 });
      }
    };

    state.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      const input = getElementFromShadow('aiNavInput');
      if (finalTranscript) {
        input.value = finalTranscript.trim();
      } else if (interimTranscript) {
        input.value = interimTranscript;
      }
    };

    state.recognition.onerror = (event) => {
      stopRecording();
      if (event.error === 'no-speech') {
        updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> No speech detected');
      }
    };

    state.recognition.onend = () => {
      stopRecording();
    };
  }
}

function toggleSpeechRecognition() {
  if (!state.recognition) {
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Speech recognition not supported');
    return;
  }
  if (state.isRecording) {
    state.recognition.stop();
  } else {
    getElementFromShadow('aiNavInput').value = '';
    state.recognition.start();
  }
}

function stopRecording() {
  state.isRecording = false;
  const micBtn = getElementFromShadow('aiNavMic');
  if (micBtn) {
    micBtn.classList.remove('recording');
    if (window.gsap) {
      gsap.to(micBtn, { scale: 1, duration: 0.2 });
    }
  }
}

async function startNavigation(goal) {
  state.goal = goal;
  state.isActive = true;
  state.currentStep = 0;
  state.steps = [];
  state.completedElements.clear();
  clearActionHistory();
  state.currentPage = window.location.href;
  state.baseDomain = getDomain(window.location.href);
  await saveState();
  updateEndJourneyButtonVisibility();
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Planning your journey...', true);
  await highlightNextElement();
}

async function getPageElements() {
  const elements = [];
  const selectors = ['button', 'a', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]'];
  let id = 0;
  const host = document.getElementById('ai-nav-shadow-host');
  
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (host?.contains(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const text = (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').trim();
      const href = el.getAttribute('href') || '';
      const className = el.className || '';
      const id_attr = el.id || '';
      
      elements.push({
        id: `elem_${id}`,
        text: text.substring(0, 100),
        type: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        href: href.substring(0, 50),
        className: className.substring(0, 100),
        elementId: id_attr.substring(0, 100),
        element: el,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
      id++;
    });
  });
  return elements;
}

async function callAPI(prompt) {
  try {
    const response = await fetch(`${state.apiServerUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': window.location.href
      },
      body: JSON.stringify({
        model: 'kwaipilot/kat-coder-pro:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[API Error]', error);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('[API Error]', error);
    return null;
  }
}

function getWebsiteColors() {
  const colors = new Set();
  const elements = document.querySelectorAll('*');
  
  for (let el of elements) {
    if (elements.length > 5000) break; // Performance limit
    const bgColor = window.getComputedStyle(el).backgroundColor;
    const textColor = window.getComputedStyle(el).color;
    
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)') colors.add(bgColor);
    if (textColor && textColor !== 'rgba(0, 0, 0, 0)') colors.add(textColor);
  }
  
  return Array.from(colors).slice(0, 10);
}

function rgbToHex(rgb) {
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#000000';
  return '#' + [match[1], match[2], match[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function getContrast(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function getAccessibleColor(websiteColors) {
  const candidates = [
    '#ffffff', '#000000', '#15803d', '#dc2626', '#2563eb',
    '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#fbbf24'
  ];
  
  const avgContrast = websiteColors
    .map(color => getContrast(rgbToHex(color)))
    .reduce((a, b) => a + b, 0) / websiteColors.length;
  
  const targetDark = avgContrast > 128;
  
  const bestColor = candidates
    .map(color => ({
      color,
      contrast: Math.abs(getContrast(color) - (targetDark ? 50 : 200)),
      lightness: getContrast(color)
    }))
    .filter(c => {
      const minContrast = targetDark ? 100 : 50;
      return Math.abs(c.lightness - (targetDark ? 0 : 255)) > minContrast;
    })
    .sort((a, b) => a.contrast - b.contrast)[0];
  
  return bestColor?.color || (avgContrast > 128 ? '#ffffff' : '#000000');
}

function updateTooltipColors() {
  const websiteColors = getWebsiteColors();
  const textColor = getAccessibleColor(websiteColors);
  const bgColor = getContrast(textColor) > 128 ? '#ffffff' : '#1a1a1a';
  
  const style = document.createElement('style');
  style.id = 'ai-nav-accessible-colors';
  style.textContent = `
    .ai-nav-tooltip {
      background: ${bgColor} !important;
      color: ${textColor} !important;
      border: 2px solid ${textColor} !important;
    }
    
    .ai-nav-tooltip-action {
      color: ${textColor} !important;
      opacity: 0.9 !important;
    }
    
    .ai-nav-tooltip-instruction {
      color: ${textColor} !important;
    }
    
    .ai-nav-tooltip-arrow {
      border-top-color: ${bgColor} !important;
      border-bottom-color: ${bgColor} !important;
    }
    
    .ai-nav-tooltip-magnifier {
      background: ${bgColor} !important;
      border-color: ${textColor} !important;
    }
    
    .ai-nav-tooltip-magnifier-content {
      color: ${textColor} !important;
    }
    
    .ai-nav-highlight-overlay {
      border-color: ${textColor} !important;
      border-radius: 12px !important;
      box-shadow: 0 0 0 5px ${textColor}22, 0 0 30px ${textColor}40, inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      animation: ai-pulse-overlay 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
      pointer-events: none !important;
      background: linear-gradient(135deg, ${textColor}0f 0%, ${textColor}0f 100%) !important;
      position: absolute !important;
      z-index: 999997 !important;
    }
    
    @keyframes ai-pulse-overlay {
      0%, 100% {
        box-shadow: 0 0 0 5px ${textColor}22, 0 0 30px ${textColor}40, inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      }
      50% {
        box-shadow: 0 0 0 8px ${textColor}33, 0 0 45px ${textColor}66, inset 0 0 0 2px rgba(255, 255, 255, 0.7) !important;
      }
    }
  `;
  
  // Remove old style if exists
  const oldStyle = document.getElementById('ai-nav-accessible-colors');
  if (oldStyle) oldStyle.remove();
  
  document.head.appendChild(style);
}

async function highlightNextElement() {
  showThinkingIndicator();
  
  const elements = await getPageElements();
  const pageUrl = window.location.href;
  const availableElements = elements.filter(e => !state.completedElements.has(e.id));
  
  const elementList = availableElements
    .slice(0, 10000)
    .map(e => {
      let description = `${e.id}: [${e.type}]`;
      if (e.text) description += ` "${e.text}"`;
      if (e.role) description += ` role="${e.role}"`;
      if (e.href) description += ` href="${e.href}"`;
      if (e.className) description += ` class="${e.className}"`;
      if (e.elementId) description += ` id="${e.elementId}"`;
      return description;
    })
    .join('\n');

  const historyContext = buildHistoryContext();

  const prompt = `You are an AI web navigation assistant helping a user accomplish a task. Your PRIMARY JOB is to recognize when the goal has been achieved.

USER'S GOAL: "${state.goal}"

CURRENT CONTEXT:
- Current page URL: ${pageUrl}
- Step number: ${state.currentStep + 1}
- Base domain: ${state.baseDomain}
${historyContext}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

CRITICAL INSTRUCTIONS:
1. FIRST: Determine if the goal has been ACHIEVED. If the user wanted to navigate to a website and we are now ON that website, respond with "NONE".
2. Check if the current page URL or page content matches the goal. If yes, respond with "NONE" immediately.
3. Only if the goal is NOT achieved, find the next logical step.
4. Think about what a human would naturally do next to accomplish the goal.
5. You may need to navigate between different domains/pages to complete this goal.
6. If you need to search, look for search boxes, search buttons, or search icons.
7. Choose the MOST RELEVANT element that moves closer to the goal.
8. If no element seems relevant OR the goal appears complete, respond with "NONE".

GOAL COMPLETION EXAMPLES:
- If goal is "navigate to the grade cs website" and current URL contains "gradecs" or "grade-cs", respond with NONE.
- If goal is "go to google.com" and current URL is "google.com", respond with NONE.
- If goal is "find the login page" and we are on the login page, respond with NONE.

RESPONSE FORMAT (respond with ONLY this format):
ELEMENT_ID: elem_X (or NONE if goal is complete/no relevant elements)
ACTION: (click/type/search/select)
INSTRUCTION: (brief instruction for user)
REASONING: (one sentence explaining why this is the logical next step)`;

  const aiResponse = await callAPI(prompt);
  
  hideThinkingIndicator();
  
  if (!aiResponse) {
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Error getting AI response');
    return;
  }

  console.log('[AI Response]', aiResponse);

  const elementMatch = aiResponse.match(/ELEMENT_ID:\s*(elem_\d+|NONE)/i);
  const actionMatch = aiResponse.match(/ACTION:\s*(.+)/i);
  const instructionMatch = aiResponse.match(/INSTRUCTION:\s*(.+)/i);
  const reasoningMatch = aiResponse.match(/REASONING:\s*(.+)/i);

  if (!elementMatch || elementMatch[1] === 'NONE') {
    state.isActive = false;
    removeHighlights();
    showJourneyCompleteNotification();
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Journey completed successfully!');
    state.goal = '';
    state.currentStep = 0;
    state.completedElements.clear();
    clearActionHistory();
    state.baseDomain = '';
    clearStoredState();
    updateEndJourneyButtonVisibility();
    console.log('[Journey Complete] AI detected destination reached');
    return;
  }

  const targetId = elementMatch[1];
  const action = actionMatch ? actionMatch[1].trim().split('\n')[0] : 'click';
  const instruction = instructionMatch ? instructionMatch[1].trim().split('\n')[0] : 'Click this element';
  const reasoning = reasoningMatch ? reasoningMatch[1].trim().split('\n')[0] : '';

  const targetElement = availableElements.find(e => e.id === targetId);

  if (targetElement) {
    const targetPreview = targetElement.text
      ? targetElement.text.substring(0, 100)
      : (targetElement.elementId || targetElement.href || targetElement.type || '');
    const historyEntry = {
      step: state.currentStep + 1,
      instruction,
      action,
      targetText: targetPreview,
      reasoning,
      timestamp: Date.now()
    };
    state.actionHistory.push(historyEntry);
    if (state.actionHistory.length > HISTORY_LIMIT) {
      state.actionHistory.shift();
    }
    renderActionHistory();

    highlightElement(targetElement, instruction, action);
    state.completedElements.add(targetId);
    await saveState();
    updateStatus(`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Step ${state.currentStep + 1}: ${instruction}`);
  } else {
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Element not found, retrying...');
    setTimeout(() => highlightNextElement(), 1000);
  }
}



function highlightElement(elem, instruction, action) {
  removeHighlights();

  const rect = elem.element.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  
  const overlay = document.createElement('div');
  overlay.className = 'ai-nav-highlight-overlay';
  overlay.id = 'ai-nav-highlight-overlay';
  
  overlay.style.left = (rect.left + scrollX) + 'px';
  overlay.style.top = (rect.top + scrollY) + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  
  document.body.appendChild(overlay);

  if (window.gsap) {
    gsap.fromTo(overlay,
      { scale: 0.9, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
    );
  }

  elem.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const tooltip = document.createElement('div');
  tooltip.className = 'ai-nav-tooltip';
  tooltip.innerHTML = `
    <div class="ai-nav-tooltip-action">${action.toUpperCase()}</div>
    <div class="ai-nav-tooltip-instruction">${instruction}</div>
    <div class="ai-nav-tooltip-arrow"></div>
  `;
  document.body.appendChild(tooltip);

  // Create magnifier glass
  const magnifier = document.createElement('div');
  magnifier.className = 'ai-nav-tooltip-magnifier';
  magnifier.id = 'ai-nav-magnifier';
  const magnifierContent = document.createElement('div');
  magnifierContent.className = 'ai-nav-tooltip-magnifier-content';
  magnifierContent.textContent = instruction;
  magnifier.appendChild(magnifierContent);
  document.body.appendChild(magnifier);

  // Force layout calculation to get tooltip dimensions
  const arrowSize = 8;
  const spacing = 16;
  const tooltipWidth = 220;
  const tooltipHeight = tooltip.offsetHeight || 80;
  
  const viewportHeight = window.innerHeight;
  const centerX = rect.left + scrollX + rect.width / 2;
  
  let tooltipTop;
  let arrowPosition = 'bottom';
  
  // Calculate available space above and below
  const spaceAbove = rect.top;
  const spaceBelow = viewportHeight - rect.bottom;
  
  // Position above if enough space, otherwise below, otherwise right side
  if (spaceAbove > tooltipHeight + spacing) {
    // Position above
    tooltipTop = rect.top + scrollY - tooltipHeight - spacing;
    arrowPosition = 'bottom';
  } else if (spaceBelow > tooltipHeight + spacing) {
    // Position below
    tooltipTop = rect.bottom + scrollY + spacing;
    arrowPosition = 'top';
  } else {
    // Position to the right side
    const tooltipLeftPos = rect.right + scrollX + 20;
    tooltip.style.left = tooltipLeftPos + 'px';
    tooltip.style.top = (rect.top + scrollY + rect.height / 2) + 'px';
    tooltip.style.transform = 'translateY(-50%)';
    
    const arrow = tooltip.querySelector('.ai-nav-tooltip-arrow');
    arrow.style.left = '-16px';
    arrow.style.top = '50%';
    arrow.style.transform = 'translateY(-50%)';
    arrow.style.borderTop = '8px solid transparent';
    arrow.style.borderBottom = '8px solid transparent';
    arrow.style.borderLeft = 'none';
    arrow.style.borderRight = '8px solid rgba(31, 41, 55, 0.96)';
    
    tooltip.dataset.elementId = elem.id;
    attachEventListeners(elem);
    return;
  }
  
  tooltip.style.left = centerX + 'px';
  tooltip.style.top = tooltipTop + 'px';
  tooltip.style.transform = 'translateX(-50%)';
  tooltip.id = 'ai-nav-tooltip';
  
  const arrow = tooltip.querySelector('.ai-nav-tooltip-arrow');
  if (arrowPosition === 'bottom') {
    arrow.style.bottom = `-${arrowSize}px`;
    arrow.style.top = 'auto';
    arrow.style.borderTop = `${arrowSize}px solid rgba(31, 41, 55, 0.96)`;
    arrow.style.borderBottom = 'none';
  } else {
    arrow.style.top = `-${arrowSize}px`;
    arrow.style.bottom = 'auto';
    arrow.style.borderBottom = `${arrowSize}px solid rgba(31, 41, 55, 0.96)`;
    arrow.style.borderTop = 'none';
  }
  
  tooltip.dataset.elementId = elem.id;
  
  // Add magnifier hover effect to tooltip
  tooltip.addEventListener('mouseenter', () => {
    magnifier.classList.add('active');
  });
  
  tooltip.addEventListener('mousemove', (e) => {
    const tooltipRect = tooltip.getBoundingClientRect();
    const relX = e.clientX - tooltipRect.left;
    const relY = e.clientY - tooltipRect.top;
    
    // Position magnifier at cursor
    magnifier.style.left = (e.clientX - 210) + 'px';
    magnifier.style.top = (e.clientY - 80) + 'px';
    
    // Calculate zoom offset - show 2x zoom
    const zoomLevel = 2;
    const offsetX = -(relX * zoomLevel - 210);
    const offsetY = -(relY * zoomLevel - 80);
    
    magnifierContent.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoomLevel})`;
    magnifierContent.style.transformOrigin = '0 0';
  });
  
  tooltip.addEventListener('mouseleave', () => {
    magnifier.classList.remove('active');
  });
  
  attachEventListeners(elem);
}

function attachEventListeners(elem) {
  elem.element.addEventListener('click', onElementInteraction, { once: true });
  elem.element.addEventListener('input', onElementInteraction, { once: true });
  elem.element.addEventListener('change', onElementInteraction, { once: true });
  elem.element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      onElementInteraction(e);
    }
  }, { once: true });
}

function removeHighlights() {
  const overlay = document.getElementById('ai-nav-highlight-overlay');
  if (overlay) {
    if (window.gsap) {
      gsap.to(overlay, { 
        scale: 0.9, 
        opacity: 0, 
        duration: 0.3,
        onComplete: () => overlay.remove()
      });
    } else {
      overlay.remove();
    }
  }

  const tooltip = document.getElementById('ai-nav-tooltip');
  if (tooltip) {
    if (window.gsap) {
      gsap.to(tooltip, { 
        scale: 0.9, 
        opacity: 0, 
        duration: 0.3,
        onComplete: () => tooltip.remove()
      });
    } else {
      tooltip.remove();
    }
  }

  const magnifier = document.getElementById('ai-nav-magnifier');
  if (magnifier) {
    if (window.gsap) {
      gsap.to(magnifier, { 
        scale: 0.9, 
        opacity: 0, 
        duration: 0.3,
        onComplete: () => magnifier.remove()
      });
    } else {
      magnifier.remove();
    }
  }
}

async function onElementInteraction(e) {
  console.log('[Element Interaction]', e.type);
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Processing...', true);
  
  state.currentStep++;
  const beforeUrl = window.location.href;
  const beforeDomain = getDomain(beforeUrl);
  await saveState();
  
  const waitTime = e.type === 'input' || e.type === 'keydown' ? 2500 : 1500;
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  const afterUrl = window.location.href;
  const afterDomain = getDomain(afterUrl);
  
  // Update current page and continue navigation regardless of domain change
  state.currentPage = afterUrl;
  await saveState();
  
  console.log(`[Navigation] From ${beforeDomain} to ${afterDomain}`);
  await highlightNextElement();
}

function resetNavigation() {
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  clearActionHistory();
  state.baseDomain = '';
  removeHighlights();
  updateEndJourneyButtonVisibility();
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> Ready to help you navigate');
  clearStoredState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

console.log('[Content Script] Loaded!');