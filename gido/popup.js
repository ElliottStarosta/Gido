const API_KEY = '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';

document.addEventListener('DOMContentLoaded', () => {
  const goalInput = document.getElementById('goalInput');
  const startBtn = document.getElementById('startBtn');
  const resetBtn = document.getElementById('resetBtn');
  const setupPhase = document.getElementById('setupPhase');
  const navigationPhase = document.getElementById('navigationPhase');
  const errorMessage = document.getElementById('errorMessage');

  startBtn.addEventListener('click', async () => {
    const goal = goalInput.value.trim();

    if (!goal) {
      showError('Please enter what you want to do');
      return;
    }

    setupPhase.classList.add('hidden');
    navigationPhase.classList.remove('hidden');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'startNavigation',
        goal,
        apiKey: API_KEY
      });
    });
  });

  resetBtn.addEventListener('click', () => {
    setupPhase.classList.remove('hidden');
    navigationPhase.classList.add('hidden');
    goalInput.value = '';
    errorMessage.classList.add('hidden');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'reset' });
    });
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStep') {
      document.getElementById('stepTitle').textContent = request.stepTitle;
      document.getElementById('stepDescription').textContent = request.stepDescription;
      document.getElementById('highlightBox').textContent = request.elementInfo;
    }

    if (request.action === 'showError') {
      showError(request.message);
    }

    if (request.action === 'completed') {
      document.getElementById('stepTitle').textContent = '✓ Done!';
      document.getElementById('stepDescription').textContent = request.message;
      document.getElementById('nextBtn').disabled = true;
    }
  });

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
    setTimeout(() => {
      errorMessage.classList.add('hidden');
    }, 5000);
  }
});