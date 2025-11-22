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
  recognition: null
};

// Load GSAP
const gsapScript = document.createElement('script');
gsapScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js';
document.head.appendChild(gsapScript);

// Get domain from URL
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Check if we're still on the same domain
function isSameDomain(url1, url2) {
  return getDomain(url1) === getDomain(url2);
}

// Add ping listener for background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'active' });
    return true;
  }
  
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
  
  return true;
});

// Load state from chrome.storage on init
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
          
          console.log('[Content Script] State restored from same domain:', {
            domain: currentDomain,
            goal: state.goal,
            step: state.currentStep,
            completedCount: state.completedElements.size,
            isActive: state.isActive
          });
          
          state.currentPage = window.location.href;
          await saveState();
          
          if (state.isActive && state.goal) {
            console.log('[Content Script] Task is active, will resume navigation');
            
            setTimeout(() => {
              const panel = document.getElementById('aiNavPanel');
              const fab = document.getElementById('aiNavFab');
              if (panel && fab && window.gsap) {
                gsap.to(fab, { scale: 0, opacity: 0, duration: 0.3, display: 'none' });
                gsap.to(panel, { scale: 1, opacity: 1, duration: 0.4, display: 'block', ease: 'back.out(1.7)' });
              }
              updateStatus(`Resuming: ${state.goal} (Step ${state.currentStep + 1})`);
            }, 100);
            
            if (document.readyState === 'complete') {
              resumeNavigation();
            } else {
              window.addEventListener('load', resumeNavigation, { once: true });
            }
          }
        } else {
          console.log('[Content Script] Different domain detected, resetting state');
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
      console.log('[Content Script] State saved:', {
        step: state.currentStep,
        completedCount: state.completedElements.size,
        page: state.currentPage
      });
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

// Initialize UI
async function initUI() {
  await loadState();
  createUI();
  initSpeechRecognition();
  console.log('[Content Script] UI initialized');
}

function createUI() {
  if (document.getElementById('ai-nav-container')) {
    console.log('[Content Script] UI already exists');
    return;
  }

  const container = document.createElement('div');
  container.id = 'ai-nav-container';
  container.className = 'ai-nav-container';
  container.innerHTML = `
    <button class="ai-nav-fab" id="aiNavFab">
      <span>🤖</span>
    </button>
    
    <div class="ai-nav-panel" id="aiNavPanel">
      <div class="ai-nav-header">
        <h3>AI Navigator</h3>
        <button class="ai-nav-close" id="aiNavClose">×</button>
      </div>

      <div class="ai-nav-main-view">
        <div class="ai-nav-input-box">
          <div class="ai-nav-input-wrapper">
            <textarea 
              class="ai-nav-input" 
              id="aiNavInput" 
              placeholder="What would you like me to do?"
              rows="1"
            ></textarea>
            <button class="ai-nav-mic-btn" id="aiNavMic" title="Voice input">
              🎤
            </button>
            <div class="ai-nav-audio-visualizer" id="audioVisualizer">
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
              <div class="ai-nav-audio-bar"></div>
            </div>
          </div>
          <button class="ai-nav-send" id="aiNavSend" title="Send">
            <span>→</span>
          </button>
        </div>
        <div class="ai-nav-status" id="aiNavStatus">Ready to help you navigate</div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  console.log('[Content Script] UI created successfully');

  setupEventListeners();
  setupTextareaAutoResize();
}

function setupEventListeners() {
  const fab = document.getElementById('aiNavFab');
  const closeBtn = document.getElementById('aiNavClose');
  
  fab.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  document.getElementById('aiNavSend').addEventListener('click', handleSend);
  document.getElementById('aiNavInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  document.getElementById('aiNavMic').addEventListener('click', toggleSpeechRecognition);
}

function setupTextareaAutoResize() {
  const textarea = document.getElementById('aiNavInput');
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
}

function openPanel() {
  const panel = document.getElementById('aiNavPanel');
  const fab = document.getElementById('aiNavFab');
  
  if (window.gsap) {
    gsap.to(fab, { 
      scale: 0, 
      rotate: 180, 
      opacity: 0, 
      duration: 0.3,
      onComplete: () => fab.style.display = 'none'
    });
    
    panel.style.display = 'block';
    gsap.fromTo(panel, 
      { scale: 0.8, opacity: 0, y: 20 },
      { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.7)' }
    );
  } else {
    panel.style.display = 'block';
    fab.style.display = 'none';
  }
  
  setTimeout(() => {
    document.getElementById('aiNavInput').focus();
  }, 300);
}

function closePanel() {
  const panel = document.getElementById('aiNavPanel');
  const fab = document.getElementById('aiNavFab');
  
  if (window.gsap) {
    gsap.to(panel, { 
      scale: 0.8, 
      opacity: 0, 
      y: 20, 
      duration: 0.3,
      onComplete: () => panel.style.display = 'none'
    });
    
    fab.style.display = 'flex';
    gsap.fromTo(fab,
      { scale: 0, rotate: -180, opacity: 0 },
      { scale: 1, rotate: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
    );
  } else {
    panel.style.display = 'none';
    fab.style.display = 'flex';
  }
}

async function handleSend() {
  if (!state.apiKey) {
    updateStatus('❌ Please set API key');
    return;
  }
  const goal = document.getElementById('aiNavInput').value.trim();
  if (goal) {
    document.getElementById('aiNavInput').value = '';
    document.getElementById('aiNavInput').style.height = 'auto';
    
    // Animate send button
    if (window.gsap) {
      gsap.to('#aiNavSend', { scale: 0.8, duration: 0.1, yoyo: true, repeat: 1 });
    }
    
    await startNavigation(goal);
  }
}

// Speech Recognition
function initSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
      console.log('[Speech] Recognition started');
      state.isRecording = true;
      const micBtn = document.getElementById('aiNavMic');
      const visualizer = document.getElementById('audioVisualizer');
      
      micBtn.classList.add('recording');
      visualizer.classList.add('active');
      
      if (window.gsap) {
        gsap.to(micBtn, { scale: 1.2, duration: 0.3, ease: 'back.out(1.7)' });
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

      const input = document.getElementById('aiNavInput');
      if (finalTranscript) {
        input.value = finalTranscript.trim();
        input.dispatchEvent(new Event('input'));
      } else if (interimTranscript) {
        input.value = interimTranscript;
      }
    };

    state.recognition.onerror = (event) => {
      console.error('[Speech] Error:', event.error);
      stopRecording();
      if (event.error === 'no-speech') {
        updateStatus('No speech detected. Try again.');
      } else {
        updateStatus(`Error: ${event.error}`);
      }
    };

    state.recognition.onend = () => {
      console.log('[Speech] Recognition ended');
      stopRecording();
    };
  } else {
    console.log('[Speech] Recognition not supported');
  }
}

function toggleSpeechRecognition() {
  if (!state.recognition) {
    updateStatus('Speech recognition not supported in your browser');
    return;
  }

  if (state.isRecording) {
    state.recognition.stop();
  } else {
    document.getElementById('aiNavInput').value = '';
    state.recognition.start();
  }
}

function stopRecording() {
  state.isRecording = false;
  const micBtn = document.getElementById('aiNavMic');
  const visualizer = document.getElementById('audioVisualizer');
  
  micBtn.classList.remove('recording');
  visualizer.classList.remove('active');
  
  if (window.gsap) {
    gsap.to(micBtn, { scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
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
  updateStatus('🧠 Planning your journey...', true);
  
  // Animate status
  if (window.gsap) {
    gsap.fromTo('#aiNavStatus', 
      { scale: 0.95, opacity: 0.8 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
    );
  }
  
  await highlightNextElement();
}

async function getPageElements() {
  const elements = [];
  const selectors = [
    'button', 'a', 'input', 'select', 'textarea', 
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]'
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

      const text = (
        el.textContent || el.value || el.placeholder || 
        el.getAttribute('aria-label') || el.getAttribute('title') ||
        el.getAttribute('alt') || ''
      ).trim();
      
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
        model: 'kwaipilot/kat-coder-pro:free',
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
    updateStatus('Error getting AI response');
    return;
  }

  console.log('[AI Response]', aiResponse);

  const elementMatch = aiResponse.match(/ELEMENT_ID:\s*(elem_\d+|NONE)/i);
  const actionMatch = aiResponse.match(/ACTION:\s*(.+)/i);
  const instructionMatch = aiResponse.match(/INSTRUCTION:\s*(.+)/i);
  const reasoningMatch = aiResponse.match(/REASONING:\s*(.+)/i);

  if (!elementMatch || elementMatch[1] === 'NONE') {
    updateStatus('✅ Goal completed successfully!');
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
    updateStatus(`Step ${state.currentStep + 1}: ${instruction}`);
  } else {
    updateStatus('Element not found, retrying...');
    setTimeout(() => highlightNextElement(), 1000);
  }
}

function highlightElement(elem, instruction, action) {
  removeHighlights();

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

  // Animate overlay with GSAP
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

  const tooltipHeight = 80;
  const spacing = 12;
  
  let tooltipTop = rect.top + scrollY - tooltipHeight - spacing;
  let arrowPosition = 'bottom';
  
  if (rect.top < tooltipHeight + spacing + 20) {
    tooltipTop = rect.bottom + scrollY + spacing;
    arrowPosition = 'top';
  }
  
  tooltip.style.position = 'absolute';
  tooltip.style.left = (rect.left + scrollX + rect.width / 2) + 'px';
  tooltip.style.top = tooltipTop + 'px';
  tooltip.style.transform = 'translateX(-50%)';
  tooltip.id = 'ai-nav-tooltip';
  
  const arrow = tooltip.querySelector('.ai-nav-tooltip-arrow');
  if (arrowPosition === 'bottom') {
    arrow.style.bottom = '-8px';
    arrow.style.top = 'auto';
    arrow.style.borderTop = '8px solid rgba(17, 24, 39, 0.98)';
    arrow.style.borderBottom = 'none';
  } else {
    arrow.style.top = '-8px';
    arrow.style.bottom = 'auto';
    arrow.style.borderBottom = '8px solid rgba(17, 24, 39, 0.98)';
    arrow.style.borderTop = 'none';
  }

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
  updateStatus('⏳ Processing action...', true);
  
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
    console.log('[Navigation detected] New page will load, state saved');
  }
}

function resetNavigation() {
  state.isActive = false;
  state.goal = '';
  state.currentStep = 0;
  state.completedElements.clear();
  state.actionHistory = [];
  removeHighlights();
  updateStatus('Ready to help you navigate');
  
  clearStoredState();
}

function updateStatus(text, loading = false) {
  const status = document.getElementById('aiNavStatus');
  if (status) {
    status.textContent = text;
    
    if (loading) {
      status.classList.add('loading');
    } else {
      status.classList.remove('loading');
    }
    
    if (window.gsap) {
      gsap.fromTo(status,
        { y: -5, opacity: 0.8 },
        { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.7)' }
      );
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

console.log('[Content Script] Loaded and waiting for DOM!');