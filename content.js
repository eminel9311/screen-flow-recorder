// Đảm bảo script chỉ được khởi tạo một lần
if (!window.screenFlowRecorder) {
  window.screenFlowRecorder = {
    isRecording: false,
    steps: [],
    currentStep: null,
    lastEventTime: 0,
    TIME_THRESHOLD: 3000,
    eventTypes: ['click', 'input', 'change', 'submit']
  };
}

// Khởi tạo step mới với screenshot
async function createNewStep() {
  const screenshot = await captureScreenshot();
  return {
    timestamp: Date.now(),
    events: [],
    screenshot: screenshot,
    url: window.location.href
  };
}

// Cải thiện hàm chụp screenshot
async function captureScreenshot() {
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getDisplayMedia({
        preferCurrentTab: true,
        video: { displaySurface: "browser" }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Screenshot timeout')), 10000)
      )
    ]);

    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    return new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        video.play()
          .then(() => {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            stream.getTracks().forEach(track => track.stop());
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          })
          .catch(reject);
      };
      video.srcObject = stream;

      // Thêm timeout cho video loading
      setTimeout(() => {
        stream.getTracks().forEach(track => track.stop());
        reject(new Error('Video loading timeout'));
      }, 5000);
    });
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  }
}

// Xử lý sự kiện được cải thiện
async function handleEvent(event) {
  if (!window.screenFlowRecorder.isRecording) return;

  const now = Date.now();
  const timeSinceLastEvent = now - window.screenFlowRecorder.lastEventTime;

  try {
    // Tạo step mới nếu cần
    if (!window.screenFlowRecorder.currentStep ||
      timeSinceLastEvent > window.screenFlowRecorder.TIME_THRESHOLD ||
      window.screenFlowRecorder.currentStep.url !== window.location.href) {

      if (window.screenFlowRecorder.currentStep) {
        window.screenFlowRecorder.steps.push(window.screenFlowRecorder.currentStep);
      }
      window.screenFlowRecorder.currentStep = await createNewStep();
    }

    // Lọc và lưu thông tin event cần thiết
    const eventData = {
      type: event.type,
      target: {
        tagName: event.target.tagName,
        className: event.target.className,
        id: event.target.id,
        value: event.target.tagName.toLowerCase() === 'input' ? event.target.value : undefined,
        textContent: event.target.textContent?.trim().substring(0, 100)
      },
      timestamp: now
    };

    window.screenFlowRecorder.currentStep.events.push(eventData);
    window.screenFlowRecorder.lastEventTime = now;

    // Gửi update đến background
    await chrome.runtime.sendMessage({
      type: 'UPDATE_STEPS',
      steps: window.screenFlowRecorder.steps
    });
  } catch (error) {
    console.error('Error handling event:', error);
  }
}

// Lắng nghe các sự kiện
window.screenFlowRecorder.eventTypes.forEach(eventType => {
  document.addEventListener(eventType, handleEvent, true);
});

// Xử lý message từ popup được cải thiện
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleMessage = async () => {
    try {
      if (message.type === 'START_RECORDING') {
        window.screenFlowRecorder.isRecording = true;
        window.screenFlowRecorder.steps.length = 0;
        window.screenFlowRecorder.currentStep = await createNewStep();
        return { success: true };
      }
      else if (message.type === 'STOP_RECORDING') {
        window.screenFlowRecorder.isRecording = false;
        if (window.screenFlowRecorder.currentStep) {
          window.screenFlowRecorder.steps.push(window.screenFlowRecorder.currentStep);
        }
        return { success: true, steps: window.screenFlowRecorder.steps };
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return { success: false, error: error.message };
    }
  };

  // Xử lý bất đồng bộ đúng cách
  handleMessage().then(response => sendResponse(response));
  return true; // Giữ kết nối để xử lý bất đồng bộ
});

// window.onerror = function (msg, url, lineNo, columnNo, error) {
//   console.error('Content script error:', {
//     message: msg,
//     url: url,
//     line: lineNo,
//     column: columnNo,
//     error: error
//   });
//   return false;
// };