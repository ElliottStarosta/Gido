let state = {
  isActive: false,
  goal: '',
  apiKey: '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',
  apiProvider: 'openrouter',
  currentStep: 0,
  steps: [],
  completedElements: new Set(),
  currentPage: window.location.href,
  actionHistory: []
};

// Load state from chrome.storage on init
async function loadState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(['navState']);
      if (result.navState) {
        const saved = result.navState;
        state.isActive = saved.isActive || false;
        state.goal = saved.goal || '';
        state.apiKey = saved.apiKey || state.apiKey;
        state.apiProvider = saved.apiProvider || 'openrouter';
        state.currentStep = saved.currentStep || 0;
        state.completedElements = new Set(saved.completedElements || []);
        state.currentPage = saved.currentPage || window.location.href;
        state.actionHistory = saved.actionHistory || [];
        
        console.log('[Content Script] State loaded:', state);
        
        // If navigation was active, resume it after a short delay
        if (state.isActive && state.goal) {
          console.log('[Content Script] Resuming navigation...');
          setTimeout(async () => {
            updateStatus(`Resuming: ${state.goal}`);
            await highlightNextElement();
          }, 1000);
        }
      }
    }
  } catch (error) {
    console.error('[State Load Error]', error);
  }
}

// Save state to chrome.storage
async function saveState() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        navState: {
          isActive: state.isActive,
          goal: state.goal,
          apiKey: state.apiKey,
          apiProvider: state.apiProvider,
          currentStep: state.currentStep,
          completedElements: Array.from(state.completedElements),
          currentPage: state.currentPage,
          actionHistory: state.actionHistory
        }
      });
      console.log('[Content Script] State saved');
    }
  } catch (error) {
    console.error('[State Save Error]', error);
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startNavigation') {
    state.goal = request.goal;
    state.apiKey = request.apiKey;
    state.apiProvider = request.apiProvider || 'openrouter';
    
    console.log('[Content Script] Received goal and API key from popup');
    startNavigation(request.goal);
    sendResponse({ status: 'Navigation started' });
  }

  if (request.action === 'reset') {
    resetNavigation();
    sendResponse({ status: 'Reset complete' });
  }
});

// Initialize UI
async function initUI() {
  // Load saved state first
  await loadState();
  
  // Create UI immediately
  createUI();
  
  console.log('[Content Script] UI initialized');
}

function createUI() {
  // Check if UI already exists
  if (document.getElementById('ai-nav-container')) {
    console.log('[Content Script] UI already exists');
    return;
  }

  const container = document.createElement('div');
  container.id = 'ai-nav-container';
  container.className = 'ai-nav-container';
  container.innerHTML = `
    <button class="ai-nav-fab" id="aiNavFab">
      🤖
    </button>
    
    <div class="ai-nav-panel" id="aiNavPanel">
      <div class="ai-nav-header">
        <h3>AI Navigator</h3>
        <button class="ai-nav-close" id="aiNavClose">×</button>
      </div>

      <div class="ai-nav-main-view">
        <div class="ai-nav-input-box">
          <input 
            type="text" 
            class="ai-nav-input" 
            id="aiNavInput" 
            placeholder="What do you want to do?"
          />
          <button class="ai-nav-send" id="aiNavSend">→</button>
        </div>
        <div class="ai-nav-status" id="aiNavStatus">Ready</div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  console.log('[Content Script] UI created successfully');

  // Event listeners
  const fab = document.getElementById('aiNavFab');
  const panel = document.getElementById('aiNavPanel');
  const closeBtn = document.getElementById('aiNavClose');
  
  fab.addEventListener('click', () => {
    openPanel();
  });

  closeBtn.addEventListener('click', () => {
    closePanel();
  });

  document.getElementById('aiNavSend').addEventListener('click', async () => {
    if (!state.apiKey) {
      updateStatus('❌ Please set API key');
      return;
    }
    const goal = document.getElementById('aiNavInput').value.trim();
    if (goal) {
      document.getElementById('aiNavInput').value = '';
      await startNavigation(goal);
    }
  });

  document.getElementById('aiNavInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('aiNavSend').click();
    }
  });
}

function openPanel() {
  const panel = document.getElementById('aiNavPanel');
  const fab = document.getElementById('aiNavFab');
  
  panel.style.display = 'block';
  fab.style.display = 'none';
  
  setTimeout(() => {
    document.getElementById('aiNavInput').focus();
  }, 100);
}

function closePanel() {
  const panel = document.getElementById('aiNavPanel');
  const fab = document.getElementById('aiNavFab');
  
  panel.style.display = 'none';
  fab.style.display = 'flex';
}

async function startNavigation(goal) {
  state.goal = goal;
  state.isActive = true;
  state.currentStep = 0;
  state.steps = [];
  state.completedElements.clear();
  state.actionHistory = [];

  await saveState();
  updateStatus('Planning steps...');
  await highlightNextElement();
}

async function getPageElements() {
  const elements = [];
  const selectors = [
    'button', 
    'a', 
    'input', 
    'select', 
    'textarea', 
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]'
  ];
  let id = 0;

  const container = document.getElementById('ai-nav-container');
  
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (container?.contains(el)) return;
      
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      // Get comprehensive text information
      const text = (
        el.textContent || 
        el.value || 
        el.placeholder || 
        el.getAttribute('aria-label') || 
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        ''
      ).trim();
      
      // Get additional context
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
  if (state.apiProvider === 'openrouter') {
    return await callOpenRouter(prompt);
  } else if (state.apiProvider === 'gemini') {
    return await callGemini(prompt);
  }
}

async function callOpenRouter(prompt) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.apiKey}`,
        'HTTP-Referer': window.location.href
      },
      body: JSON.stringify({
model: 'kwaipilot/kat-coder-pro:free',        messages: [{ role: 'user', content: prompt }],
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[API Error]', error);
      updateStatus('API Error: ' + error.error?.message);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('[API Error]', error);
    updateStatus('API Error: ' + error.message);
    return null;
  }
}

async function callGemini(prompt) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${state.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.2 }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('[API Error]', error);
      updateStatus('API Error: ' + error.error?.message);
      return null;
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('[API Error]', error);
    updateStatus('API Error: ' + error.message);
    return null;
  }
}

async function highlightNextElement() {
  const elements = await getPageElements();
  const pageUrl = window.location.href;
  
  // Filter out completed elements
  const availableElements = elements.filter(e => !state.completedElements.has(e.id));
  
  // Create detailed element list with more context
  const elementList = availableElements
    .slice(0, 10000) // Show more elements
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

  // Build action history for context
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
    updateStatus('Error getting AI response');
    return;
  }

  console.log('[AI Response]', aiResponse);

  const elementMatch = aiResponse.match(/ELEMENT_ID:\s*(elem_\d+|NONE)/i);
  const actionMatch = aiResponse.match(/ACTION:\s*(.+)/i);
  const instructionMatch = aiResponse.match(/INSTRUCTION:\s*(.+)/i);
  const reasoningMatch = aiResponse.match(/REASONING:\s*(.+)/i);

  if (!elementMatch || elementMatch[1] === 'NONE') {
    updateStatus('Goal completed! ✓');
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
    // Add to action history
    state.actionHistory.push(`${action} on "${targetElement.text.substring(0, 100)}" - ${reasoning}`);
    if (state.actionHistory.length > 5) {
      state.actionHistory.shift(); // Keep only last 5 actions
    }
    
    highlightElement(targetElement, instruction, action);
    state.completedElements.add(targetId);
    await saveState();
    updateStatus(`Step ${state.currentStep + 1}: ${instruction}`);
  } else {
    updateStatus('Element not found, retrying...');
    state.completedElements.clear(); // Reset if element not found
    setTimeout(() => highlightNextElement(), 1000);
  }
}

function highlightElement(elem, instruction, action) {
  removeHighlights();

  // Create overlay instead of modifying element directly
  const overlay = document.createElement('div');
  overlay.className = 'ai-nav-highlight-overlay';
  overlay.id = 'ai-nav-highlight-overlay';
  
  const rect = elem.element.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  
  overlay.style.position = 'absolute';
  overlay.style.left = (rect.left + scrollX) + 'px';
  overlay.style.top = (rect.top + scrollY) + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '999997';
  
  document.body.appendChild(overlay);

  // Scroll element into view
  elem.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Create improved tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'ai-nav-tooltip';
  tooltip.innerHTML = `
    <div class="ai-nav-tooltip-action">${action.toUpperCase()}</div>
    <div class="ai-nav-tooltip-instruction">${instruction}</div>
    <div class="ai-nav-tooltip-arrow"></div>
  `;
  document.body.appendChild(tooltip);

  // Position tooltip
  const tooltipHeight = 80;
  const spacing = 12;
  
  let tooltipTop = rect.top + scrollY - tooltipHeight - spacing;
  let arrowPosition = 'bottom';
  
  // If tooltip would go off top of screen, show it below
  if (rect.top < tooltipHeight + spacing + 20) {
    tooltipTop = rect.bottom + scrollY + spacing;
    arrowPosition = 'top';
  }
  
  tooltip.style.position = 'absolute';
  tooltip.style.left = (rect.left + scrollX + rect.width / 2) + 'px';
  tooltip.style.top = tooltipTop + 'px';
  tooltip.style.transform = 'translateX(-50%)';
  tooltip.id = 'ai-nav-tooltip';
  
  // Position arrow
  const arrow = tooltip.querySelector('.ai-nav-tooltip-arrow');
  if (arrowPosition === 'bottom') {
    arrow.style.bottom = '-6px';
    arrow.style.top = 'auto';
    arrow.style.borderTop = '6px solid rgba(17, 24, 39, 0.95)';
    arrow.style.borderBottom = 'none';
  } else {
    arrow.style.top = '-6px';
    arrow.style.bottom = 'auto';
    arrow.style.borderBottom = '6px solid rgba(17, 24, 39, 0.95)';
    arrow.style.borderTop = 'none';
  }

  // Listen for interactions
  elem.element.addEventListener('click', onElementInteraction, { once: true });
  elem.element.addEventListener('input', onElementInteraction, { once: true });
  elem.element.addEventListener('change', onElementInteraction, { once: true });
  elem.element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      onElementInteraction(e);
    }
  }, { once: true });
  
  tooltip.dataset.elementId = elem.id;
}

function removeHighlights() {
  // Remove overlay instead of modifying elements
  const overlay = document.getElementById('ai-nav-highlight-overlay');
  if (overlay) {
    overlay.remove();
  }

  const tooltip = document.getElementById('ai-nav-tooltip');
  if (tooltip) {
    tooltip.remove();
  }
}

async function onElementInteraction(e) {
  console.log('[Element Interaction]', e.type);
  updateStatus('Processing...');
  
  const waitTime = e.type === 'input' || e.type === 'keydown' ? 2500 : 1500;
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  state.currentStep++;
  
  if (window.location.href !== state.currentPage) {
    state.currentPage = window.location.href;
    state.completedElements.clear();
    console.log('[Page Changed] Resetting completed elements');
  }

  await saveState();
  await highlightNextElement();
}

function resetNavigation() {
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  state.actionHistory = [];
  removeHighlights();
  updateStatus('Ready');
  
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(['navState']);
  }
}

function updateStatus(text) {
  const status = document.getElementById('aiNavStatus');
  if (status) {
    status.textContent = text;
  }
}

// Wait for DOM to be ready before initializing UI
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

console.log('[Content Script] Loaded and waiting for DOM');