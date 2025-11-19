// background.js - Keeps the popup available on all websites
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('[Background] Page loaded:', tab.url);
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateStep') {
    // Relay to popup if it's open
    chrome.runtime.sendMessage(request).catch(() => {
      // Popup not open, ignore
    });
  }
});