let state = {
  isActive: false,
  goal: '',
  apiKey: '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',
  apiProvider: 'openrouter',
  currentStep: 0,
  steps: [],
  completedElements: new Set(),
  currentPage: window.location.href,
  actionHistory: [],
  baseDomain: new URL(window.location.href).hostname,
  isRecording: false,
  recognition: null,
  shadowRoot: null
};

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
        const savedDomain = getDomain(saved.currentPage || '');
        const currentDomain = getDomain(window.location.href);
        if (savedDomain && currentDomain && savedDomain === currentDomain) {
          state.isActive = saved.isActive || false;
          state.goal = saved.goal || '';
          state.apiKey = saved.apiKey || state.apiKey;
          state.apiProvider = saved.apiProvider || 'openrouter';
          state.currentStep = saved.currentStep || 0;
          state.completedElements = new Set(saved.completedElements || []);
          state.actionHistory = saved.actionHistory || [];
          state.baseDomain = savedDomain;
          state.currentPage = window.location.href;
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
              updateStatus(`Resuming: ${state.goal}`);
            }, 100);
            if (document.readyState === 'complete') {
              resumeNavigation();
            } else {
              window.addEventListener('load', resumeNavigation, { once: true });
            }
          }
        } else {
          await clearStoredState();
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
        savedAt: Date.now()
      };
      await chrome.storage.local.set({ navState: stateToSave });
      console.log('[Content Script] State saved');
    }
  } catch (error) {
    console.error('[State Save Error]', error);
  }
}

async function clearStoredState() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(['navState']);
  }
}

function getElementFromShadow(id) {
  if (!state.shadowRoot) return null;
  return state.shadowRoot.getElementById(id);
}

async function initUI() {
  await loadGSAP();
  await loadState();
  createUIShadowDOM();
  injectPageStyles();
  initSpeechRecognition();
  console.log('[Content Script] UI initialized');
}

function injectPageStyles() {
  if (document.getElementById('ai-nav-page-styles')) return;
  
  // Add Font Awesome to page
  const fontAwesomeLink = document.createElement('link');
  fontAwesomeLink.rel = 'stylesheet';
  fontAwesomeLink.href = chrome.runtime.getURL('fonts/css/all.min.css');
  document.head.appendChild(fontAwesomeLink);
  
  const style = document.createElement('style');
  style.id = 'ai-nav-page-styles';
  style.textContent = `
    .ai-nav-highlight-overlay {
      border: 3px solid #667eea !important;
      border-radius: 12px !important;
      box-shadow: 
        0 0 0 5px rgba(102, 126, 234, 0.15),
        0 0 30px rgba(102, 126, 234, 0.3),
        inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      animation: ai-pulse-overlay 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
      pointer-events: none !important;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%) !important;
      position: absolute !important;
      z-index: 999997 !important;
    }

    @keyframes ai-pulse-overlay {
      0%, 100% {
        box-shadow: 
          0 0 0 5px rgba(102, 126, 234, 0.15),
          0 0 30px rgba(102, 126, 234, 0.3),
          inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      }
      50% {
        box-shadow: 
          0 0 0 8px rgba(102, 126, 234, 0.25),
          0 0 45px rgba(102, 126, 234, 0.5),
          inset 0 0 0 2px rgba(255, 255, 255, 0.7) !important;
      }
    }

    .ai-nav-tooltip {
      background: linear-gradient(135deg, rgba(31, 41, 55, 0.96) 0%, rgba(17, 24, 39, 0.96) 100%) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      color: white !important;
      padding: 14px 18px !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif !important;
      z-index: 999998 !important;
      pointer-events: none !important;
      box-shadow: 
        0 10px 28px rgba(0, 0, 0, 0.25),
        0 0 0 1px rgba(255, 255, 255, 0.08) !important;
      max-width: 220px !important;
      text-align: center !important;
      line-height: 1.5 !important;
      white-space: normal !important;
      word-wrap: break-word !important;
      animation: ai-tooltip-fadein 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      position: absolute !important;
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
      background: linear-gradient(135deg, #a78bfa 0%, #c084fc 100%) !important;
      -webkit-background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      background-clip: text !important;
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
  `;
  document.head.appendChild(style);
  console.log('[Page Styles] Injected highlight and tooltip styles');
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

  // Load Font Awesome from extension resources
  const fontAwesomeLink = document.createElement('link');
  fontAwesomeLink.rel = 'stylesheet';
  fontAwesomeLink.href = chrome.runtime.getURL('fonts/css/all.min.css');
  shadowRoot.appendChild(fontAwesomeLink);

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

    .gido-icon {
      width: 32px !important;
      height: 32px !important;
      object-fit: contain !important;
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
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 100%) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 16px !important;
      box-shadow: 
        0 20px 60px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.4),
        inset 0 -1px 0 rgba(0, 0, 0, 0.05) !important;
      display: none !important;
      flex-direction: column !important;
      z-index: 999999 !important;
      overflow: hidden !important;
    }

    .ai-nav-panel.open {
      display: flex !important;
    }

    .panel-header {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2) !important;
      color: white !important;
      padding: 16px 20px !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
    }

    .panel-header h3 {
      font-size: 16px !important;
      font-weight: 600 !important;
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin: 0 !important;
    }

    .icon {
      width: 1em !important;
      height: 1em !important;
      display: inline-block !important;
      vertical-align: -0.125em !important;
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.2) !important;
      border: none !important;
      color: white !important;
      width: 32px !important;
      height: 32px !important;
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
      background: rgba(255, 255, 255, 0.3) !important;
    }

    .input-section {
      padding: 16px !important;
      display: flex !important;
      gap: 10px !important;
      align-items: center !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2) !important;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(102, 126, 234, 0.05) 100%) !important;
    }

    .input-wrapper {
      flex: 1 !important;
      display: flex !important;
      gap: 8px !important;
      align-items: center !important;
      background: rgba(255, 255, 255, 0.1) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      border-radius: 24px !important;
      padding: 12px 16px !important;
      transition: all 0.2s !important;
    }

    .input-wrapper:focus-within {
      border-color: rgba(255, 255, 255, 0.4) !important;
      background: rgba(255, 255, 255, 0.15) !important;
      box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.2) !important;
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
    }

    .input-field::placeholder {
      color: rgba(0, 0, 0, 0.5) !important;
    }

    .icon-btn {
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      color: #9ca3af !important;
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
      color: #667eea !important;
    }

    .icon-btn.recording {
      color: #ef4444 !important;
      animation: ai-pulse 1.5s ease-in-out infinite !important;
    }

    .send-btn {
      width: 40px !important;
      height: 40px !important;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      border: none !important;
      border-radius: 50% !important;
      cursor: pointer !important;
      color: white !important;
      font-size: 16px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
      flex-shrink: 0 !important;
      padding: 0 !important;
    }

    .send-btn:hover {
      transform: scale(1.05) !important;
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4) !important;
    }

    .send-btn:active {
      transform: scale(0.95) !important;
    }

    .status-box {
      padding: 16px !important;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%) !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      border-top: 1px solid rgba(255, 255, 255, 0.2) !important;
      border-left: 4px solid rgba(102, 126, 234, 0.3) !important;
      min-height: 60px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .status-text {
      font-size: 13px !important;
      color: #4b5563 !important;
      font-weight: 500 !important;
      text-align: center !important;
      line-height: 1.4 !important;
      margin: 0 !important;
    }

    .status-text i {
      margin-right: 6px !important;
      color: #667eea !important;
    }

    .status-text.loading i {
      animation: ai-spin 1s linear infinite !important;
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

    /* TOOLTIP STYLES */
    .ai-nav-highlight-overlay {
      border: 3px solid #667eea !important;
      border-radius: 12px !important;
      box-shadow: 
        0 0 0 5px rgba(102, 126, 234, 0.15),
        0 0 30px rgba(102, 126, 234, 0.3),
        inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      animation: ai-pulse-overlay 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
      pointer-events: none !important;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%) !important;
      position: absolute !important;
      z-index: 999997 !important;
    }

    @keyframes ai-pulse-overlay {
      0%, 100% {
        box-shadow: 
          0 0 0 5px rgba(102, 126, 234, 0.15),
          0 0 30px rgba(102, 126, 234, 0.3),
          inset 0 0 0 2px rgba(255, 255, 255, 0.5) !important;
      }
      50% {
        box-shadow: 
          0 0 0 8px rgba(102, 126, 234, 0.25),
          0 0 45px rgba(102, 126, 234, 0.5),
          inset 0 0 0 2px rgba(255, 255, 255, 0.7) !important;
      }
    }

    .ai-nav-tooltip {
      background: linear-gradient(135deg, rgba(31, 41, 55, 0.96) 0%, rgba(17, 24, 39, 0.96) 100%) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      color: white !important;
      padding: 14px 18px !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      z-index: 999998 !important;
      pointer-events: none !important;
      box-shadow: 
        0 10px 28px rgba(0, 0, 0, 0.25),
        0 0 0 1px rgba(255, 255, 255, 0.08) !important;
      max-width: 220px !important;
      text-align: center !important;
      line-height: 1.5 !important;
      white-space: normal !important;
      word-wrap: break-word !important;
      animation: ai-tooltip-fadein 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      position: absolute !important;
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
      background: linear-gradient(135deg, #a78bfa 0%, #c084fc 100%) !important;
      -webkit-background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      background-clip: text !important;
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
      transform: translateX(-50%) !important;
      width: 0 !important;
      height: 0 !important;
      border-left: 8px solid transparent !important;
      border-right: 8px solid transparent !important;
      pointer-events: none !important;
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
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
          </svg>
          AI Navigator
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
            placeholder="What would you like me to do?"
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
        </div>
        <button class="send-btn" id="aiNavSend">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <polyline points="19 12 12 19 5 12"></polyline>
          </svg>
        </button>
      </div>
      <div class="status-box">
        <div class="status-text" id="aiNavStatus">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          Ready to help you navigate
        </div>
      </div>
    </div>
  `;
  shadowRoot.appendChild(container);

  console.log('[Content Script] UI created');
  setupEventListeners();
  setupTextareaAutoResize();
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
}

function setupTextareaAutoResize() {
  const textarea = getElementFromShadow('aiNavInput');
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 60) + 'px';
  });
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

async function handleSend() {
  if (!state.apiKey) {
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Please set API key');
    return;
  }
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
  state.actionHistory = [];
  state.currentPage = window.location.href;
  state.baseDomain = getDomain(window.location.href);
  await saveState();
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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.apiKey}`,
        'HTTP-Referer': window.location.href
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
      updateStatus('<i class="fas fa-exclamation-circle"></i> API Error');
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('[API Error]', error);
    updateStatus('<i class="fas fa-exclamation-circle"></i> API Error: ' + error.message);
    return null;
  }
}

async function highlightNextElement() {
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

  const historyContext = state.actionHistory.length > 0 
    ? `\nPrevious actions taken:\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : '';

  const prompt = `You are an AI web navigation assistant helping a user accomplish a task. Think step-by-step like a human would navigate a website.

USER'S GOAL: "${state.goal}"

CURRENT CONTEXT:
- Current page URL: ${pageUrl}
- Step number: ${state.currentStep + 1}
${historyContext}

AVAILABLE ELEMENTS ON THIS PAGE:
${elementList}

INSTRUCTIONS:
1. Analyze the current page and available elements carefully
2. Think about what a human would naturally do next to accomplish the goal
3. If you need to search, look for search boxes, search buttons, or search icons
4. If you need to find a category, look for navigation links or category buttons
5. Choose the MOST RELEVANT element that moves closer to the goal
6. If no element seems relevant, respond with "NONE" to indicate the goal may be complete or impossible

RESPONSE FORMAT (respond with ONLY this format):
ELEMENT_ID: elem_X (or NONE if goal is complete/no relevant elements)
ACTION: (click/type/search/select)
INSTRUCTION: (brief instruction for user)
REASONING: (one sentence explaining why this is the logical next step)`;

  const aiResponse = await callAPI(prompt);
  
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
    updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Goal completed successfully!');
    state.isActive = false;
    await saveState();
    return;
  }

  const targetId = elementMatch[1];
  const action = actionMatch ? actionMatch[1].trim().split('\n')[0] : 'click';
  const instruction = instructionMatch ? instructionMatch[1].trim().split('\n')[0] : 'Click this element';
  const reasoning = reasoningMatch ? reasoningMatch[1].trim().split('\n')[0] : '';

  const targetElement = availableElements.find(e => e.id === targetId);

  if (targetElement) {
    state.actionHistory.push(`${action} on "${targetElement.text.substring(0, 100)}" - ${reasoning}`);
    if (state.actionHistory.length > 5) {
      state.actionHistory.shift();
    }
    
    highlightElement(targetElement, instruction, action);
    state.completedElements.add(targetId);
    await saveState();
    updateStatus(`<i class="fas fa-tasks"></i> Step ${state.currentStep + 1}: ${instruction}`);
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
}

async function onElementInteraction(e) {
  console.log('[Element Interaction]', e.type);
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Processing...', true);
  
  state.currentStep++;
  const beforeUrl = window.location.href;
  await saveState();
  
  const waitTime = e.type === 'input' || e.type === 'keydown' ? 2500 : 1500;
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  const afterUrl = window.location.href;
  
  if (beforeUrl === afterUrl) {
    console.log('[Same page] Continuing navigation');
    state.currentPage = afterUrl;
    await saveState();
    await highlightNextElement();
  } else {
    console.log('[Navigation detected] New page will load');
  }
}

function resetNavigation() {
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  state.actionHistory = [];
  removeHighlights();
  updateStatus('<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> Ready to help you navigate');
  clearStoredState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

console.log('[Content Script] Loaded!');