// popup.js — popup UI logic
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const resultEl = document.getElementById('result');

// Check connection on load
async function checkConnection() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });
    if (response.ok) {
      statusEl.classList.remove('disconnected');
      statusEl.classList.add('connected');
      statusText.textContent = '연결됨';
    } else {
      statusEl.classList.remove('connected');
      statusEl.classList.add('disconnected');
      statusText.textContent = '오프라인';
    }
  } catch (e) {
    statusEl.classList.add('disconnected');
    statusText.textContent = '오류';
  }
}

// Call a tool via background
async function callTool(name, args = {}) {
  resultEl.style.display = 'block';
  resultEl.textContent = 'Loading...';
  try {
    const response = await chrome.runtime.sendMessage({ action: 'callTool', name, args });
    if (response.ok) {
      resultEl.textContent = JSON.stringify(response.result, null, 2);
    } else {
      resultEl.textContent = 'Error: ' + (response.error || JSON.stringify(response));
    }
  } catch (e) {
    resultEl.textContent = 'Error: ' + e.message;
  }
}

// Wire up quick action buttons
document.querySelectorAll('.quick-action').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'cowork_list') {
      callTool(action, { path: 'C:\\Users\\qqwer\\Hermes-Workspace\\demo-circuits' });
    } else if (action === 'cowork_git_status') {
      callTool(action, { path: '.' });
    } else {
      callTool(action);
    }
  });
});

checkConnection();