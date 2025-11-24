chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // When page finishes loading
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      // Check if there's an active task
      const { navState } = await chrome.storage.local.get(['navState']);
      
      if (navState && navState.isActive) {
        const savedDomain = new URL(navState.currentPage || '').hostname;
        const currentDomain = new URL(tab.url).hostname;
        
        // If still on same domain, ensure content script is running
        if (savedDomain === currentDomain) {
          console.log('[Background] Ensuring content script is active on new page');
          
          // Try to ping the content script
          try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            console.log('[Background] Content script already active');
          } catch (error) {
            // Content script not responding, inject it
            console.log('[Background] Re-injecting content script');
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content.js']
            });
            
            await chrome.scripting.insertCSS({
              target: { tabId: tabId },
              files: ['content.css']
            });
          }
        }
      }
    } catch (error) {
      console.error('[Background] Error:', error);
    }
  }
});

// Keep service worker alive
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'keepAlive') {
    sendResponse({ status: 'alive' });
  }
  return true;
});

console.log('[Background] Service worker loaded');