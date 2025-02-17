console.log('Background script loaded');

// Quản lý state trong background
const backgroundState = {
  // Lưu ID của tab đang recording
  recordingTabId: null,

  // Object chứa các phương thức thao tác với storage
  storage: {
    // Lấy danh sách steps đã lưu
    async getSteps() {
      const data = await chrome.storage.local.get('recordedSteps');
      return data.recordedSteps || [];
    },

    // Lưu danh sách steps mới
    async setSteps(steps) {
      await chrome.storage.local.set({ recordedSteps: steps });
    }
  }
};

// Khởi tạo extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed');
  await backgroundState.storage.setSteps([]);
});

// Xử lý khi tab bị đóng hoặc reload
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === backgroundState.recordingTabId) {
    backgroundState.recordingTabId = null;
    // Thông báo cho popup về việc dừng recording
    const views = chrome.runtime.getViews({ type: 'popup' });
    views.forEach(view => {
      view.postMessage({ type: 'RECORDING_STOPPED' }, '*');
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId === backgroundState.recordingTabId) {
    // Reinject content script
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).catch(console.error);
  }
});

// Xử lý messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleMessage = async () => {
    try {
      // Kiểm tra origin của message
      if (!sender.origin && !sender.url) {
        throw new Error('Invalid message origin');
      }

      switch (message.type) {
        case 'START_RECORDING':
          backgroundState.recordingTabId = message.tabId;
          sendResponse({ success: true });
          break;

        case 'STOP_RECORDING':
          backgroundState.recordingTabId = null;
          sendResponse({ success: true });
          break;

        case 'UPDATE_STEPS':
          // Validate và sanitize steps trước khi lưu
          if (!Array.isArray(message.steps)) {
            throw new Error('Invalid steps format');
          }

          // Kiểm tra kích thước của steps
          const totalSize = new Blob([JSON.stringify(message.steps)]).size;
          if (totalSize > 5242880) { // 5MB limit
            throw new Error('Steps data too large');
          }

          await backgroundState.storage.setSteps(message.steps);
          sendResponse({ success: true });
          break;

        case 'GET_STEPS':
          const steps = await backgroundState.storage.getSteps();
          sendResponse({ success: true, steps });
          break;

        case 'CLEAR_STEPS':
          await backgroundState.storage.setSteps([]);
          sendResponse({ success: true });
          break;
        // Thêm case này vào switch statement trong background.js
        case 'CAPTURE_SCREENSHOT':
          try {
            // Chụp màn hình của tab đang active
            const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
            if (!tab || !tab.id) {
              throw new Error('No active tab found');
            }

            const dataUrl = await chrome.tabs.captureVisibleTab(
              tab.windowId,
              { format: 'jpeg', quality: 80 }
            );

            if (chrome.runtime.lastError) {
              throw new Error(chrome.runtime.lastError.message);
            }

            sendResponse({ success: true, screenshot: dataUrl });
          } catch (error) {
            console.error('Screenshot capture error:', error);
            sendResponse({
              success: false,
              error: `Screenshot capture failed: ${error.message}`
            });
          }
          break;

        default:
          throw new Error('Unknown message type');
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({
        success: false,
        error: error.message || 'Unknown error'
      });
    }
  };

  // Xử lý async
  handleMessage().catch(error => {
    console.error('Async error:', error);
    sendResponse({
      success: false,
      error: error.message || 'Unknown error'
    });
  });

  return true; // Giữ kết nối cho async response
});

// Utility functions
function sanitizeSteps(steps) {
  return steps.map(step => ({
    ...step,
    url: sanitizeURL(step.url),
    events: step.events.map(event => ({
      ...event,
      target: {
        tagName: sanitizeString(event.target.tagName),
        className: sanitizeString(event.target.className),
        id: sanitizeString(event.target.id),
        value: sanitizeString(event.target.value),
        textContent: sanitizeString(event.target.textContent)
      }
    }))
  }));
}

function sanitizeURL(url) {
  try {
    return new URL(url).toString();
  } catch {
    return '';
  }
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.slice(0, 1000); // Limit string length
}

// Performance monitoring
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'performance-monitor') {
    port.onMessage.addListener(async message => {
      if (message.type === 'GET_MEMORY_USAGE') {
        const usage = await chrome.system.memory.getInfo();
        port.postMessage({ type: 'MEMORY_USAGE', data: usage });
      }
    });
  }
});

// Error reporting
function reportError(error, context) {
  console.error(`Error in ${context}:`, error);
  // Có thể thêm logic gửi error về server ở đây
}

// Cleanup khi extension bị disable hoặc uninstall
chrome.runtime.onSuspend.addListener(async () => {
  try {
    await backgroundState.storage.setSteps([]);
    backgroundState.recordingTabId = null;
  } catch (error) {
    reportError(error, 'cleanup');
  }
});