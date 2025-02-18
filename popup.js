console.log('Popup opened');
// Quản lý state trong một object
const recorderState = {
  isRecording: false,
  steps: []
};

// Khởi tạo các event listeners khi DOM đã sẵn sàng
document.addEventListener('DOMContentLoaded', async () => {
  const button = document.getElementById('startStop');
  const status = document.getElementById('status');
  const exportBtn = document.getElementById('export');

  // Lấy steps đã lưu từ background
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STEPS' });
    if (response && response.steps) {
      recorderState.steps = response.steps;
      displaySteps();
      exportBtn.disabled = recorderState.steps.length === 0;
    }
  } catch (error) {
    console.error('Error getting saved steps:', error);
  }

  // Thêm event listener cho nút Start/Stop
  button.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active tab found');
      }

      // Kiểm tra xem tab có cho phép content script không
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => true,
        });
      } catch (error) {
        throw new Error('Cannot access this page. Try another page.');
      }

      if (!recorderState.isRecording) {
        // Bắt đầu ghi
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'START_RECORDING',
          tabId: tab.id
        });

        if (response && response.success) {
          recorderState.isRecording = true;
          button.textContent = 'Stop Recording';
          status.textContent = 'Recording...';
          status.className = 'recording';
          exportBtn.disabled = true;
        } else {
          throw new Error(response?.error || 'Failed to start recording');
        }
      } else {
        // Dừng ghi
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'STOP_RECORDING'
        });

        if (response && response.success) {
          recorderState.isRecording = false;
          button.textContent = 'Start Recording';
          status.textContent = 'Recording stopped';
          status.className = 'success';

          if (response.steps && response.steps.length > 0) {
            recorderState.steps = response.steps;
            displaySteps();
            exportBtn.disabled = false;
          }
        } else {
          throw new Error(response?.error || 'Failed to stop recording');
        }
      }
    } catch (error) {
      console.error('Recording error:', error);
      status.textContent = `Error: ${error.message}`;
      status.className = 'error';
      recorderState.isRecording = false;
      button.textContent = 'Start Recording';
      exportBtn.disabled = true;
    }
  });

  exportBtn.addEventListener('click', async () => {
    if (recorderState.steps.length === 0) {
      status.textContent = 'No steps to export';
      status.className = 'error';
      return;
    }

    try {
      const html = generateSlideshow(recorderState.steps);
      await downloadHTML(html, 'tutorial.html');
      status.textContent = 'Export successful!';
      status.className = 'success';
    } catch (error) {
      console.error('Export error:', error);
      status.textContent = `Export error: ${error.message}`;
      status.className = 'error';
    }
  });
});

function displaySteps() {
  const container = document.getElementById('steps');
  container.innerHTML = '';

  if (!recorderState.steps || recorderState.steps.length === 0) {
    container.innerHTML = '<div class="no-steps">No step recorded!</div>';
    return;
  }

  recorderState.steps.forEach((step, index) => {
    const stepElement = document.createElement('div');
    stepElement.className = 'step';

    const info = document.createElement('div');
    info.className = 'step-info';
    info.innerHTML = `
      <div class="step-header">
        <strong>Bước ${index + 1}</strong>
        <button class="delete-btn" title="Xóa bước này">×</button>
      </div>
      <p class="step-url"><span>URL:</span> ${step.url || 'N/A'}</p>
      <p class="step-events"><span>Sự kiện:</span> ${step.events?.map(e => e.type).join(', ') || 'Không có'}</p>
    `;

    if (step.screenshot) {
      const img = document.createElement('img');
      img.src = step.screenshot;
      img.alt = `Ảnh chụp bước ${index + 1}`;
      img.className = 'step-screenshot';
      img.loading = 'lazy';
      stepElement.appendChild(img);
    }

    const deleteBtn = info.querySelector('.delete-btn');
    deleteBtn.onclick = () => {
      recorderState.steps.splice(index, 1);
      displaySteps();
      document.getElementById('export').disabled = recorderState.steps.length === 0;
    };

    container.appendChild(stepElement);
  });
}

function generateSlideshow(steps) {
  return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Hướng dẫn từng bước</title>
      <style>
        body { 
          font-family: 'Segoe UI', Roboto, sans-serif; 
          margin: 20px; 
          line-height: 1.6;
          background: #f5f5f5;
        }
        .slide { 
          display: none; 
          max-width: 800px; 
          margin: 0 auto; 
          padding: 20px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .slide.active { display: block; }
        .navigation { 
          text-align: center; 
          margin: 20px; 
          position: fixed; 
          bottom: 0; 
          left: 0; 
          right: 0; 
          background: rgba(255,255,255,0.95);
          padding: 15px;
          box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
        }
        .slide img { 
          max-width: 100%; 
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .events { margin-top: 20px; }
        .event { 
          padding: 10px; 
          background: #f8f9fa; 
          margin: 8px 0; 
          border-radius: 6px;
          border-left: 4px solid #007bff;
        }
        button { 
          padding: 12px 24px; 
          margin: 0 8px; 
          cursor: pointer; 
          border: none; 
          background: #007bff; 
          color: white; 
          border-radius: 6px;
          font-weight: 500;
          transition: background 0.2s;
        }
        button:hover { background: #0056b3; }
        .counter { 
          display: inline-block; 
          min-width: 80px;
          font-weight: 500;
          color: #444;
        }
        h2 { color: #2c3e50; }
        h3 { color: #34495e; }
      </style>
    </head>
    <body>
      ${steps.map((step, index) => `
        <div class="slide" id="slide-${index}">
          <h2>Step ${index + 1}</h2>
          <p><strong>URL:</strong> ${step.url || 'N/A'}</p>
          ${step.screenshot ? `<img src="${step.screenshot}" alt="Step ${index + 1} screenshot">` : ''}
          <div class="events">
            <h3>Events:</h3>
            ${step.events?.map(event => `
              <div class="event">
                ${event.type} on ${event.target.tagName?.toLowerCase() || 'unknown'}
                ${event.target.id ? `#${event.target.id}` : ''}
                ${event.target.className ? `.${event.target.className}` : ''}
                ${event.target.textContent ? `: "${event.target.textContent}"` : ''}
              </div>
            `).join('') || 'No events recorded'}
          </div>
        </div>
      `).join('')}
      
      <div class="navigation">
        <button onclick="prevSlide()">Previous</button>
        <span class="counter" id="slideCounter"></span>
        <button onclick="nextSlide()">Next</button>
      </div>
      
      <script>
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide');
        
        function updateCounter() {
          document.getElementById('slideCounter').textContent = 
            \`\${currentSlide + 1} / \${slides.length}\`;
        }
        
        function showSlide(n) {
          slides.forEach(slide => slide.classList.remove('active'));
          currentSlide = (n + slides.length) % slides.length;
          slides[currentSlide].classList.add('active');
          updateCounter();
        }
        
        function nextSlide() { showSlide(currentSlide + 1); }
        function prevSlide() { showSlide(currentSlide - 1); }
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') nextSlide();
          if (e.key === 'ArrowLeft') prevSlide();
        });
        
        showSlide(0);
      </script>
    </body>
    </html>`;
}

async function downloadHTML(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
  document.getElementById('status').textContent = `Error: ${msg}`;
  document.getElementById('status').className = 'error';
  console.error('Popup error:', error);
  return false;
};