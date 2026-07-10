#!/usr/bin/env python3
import os, re
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(p):
    with open(p, 'r', encoding='utf-8') as f: return f.read()

def write(p, s):
    with open(p, 'w', encoding='utf-8') as f: f.write(s)

# --- main.js: single instance lock + cache-safe switches + workspace save robust return ---
main = os.path.join(PROJECT, 'main.js')
code = read(main)

# Add app switches and single instance lock after requires
needle = "const fs = require('fs');\n"
insert = """const fs = require('fs');

// Prevent multiple Electron instances from racing over Chromium Cache / Service Worker DB.
// This is the root cause of cache_util_win.cc / service_worker_storage DB lock errors seen during tests.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
"""
if "requestSingleInstanceLock" not in code:
    code = code.replace(needle, insert, 1)

# Ensure app.whenReady only runs when lock acquired
code = code.replace("app.whenReady().then(createWindow);", "if (gotSingleInstanceLock) app.whenReady().then(createWindow);")

# Patch workspace:save handler for guaranteed ok/error fields if current handler lacks catch
m = re.search(r"ipcMain\.handle\('workspace:save',[\s\S]*?\n\}\);", code)
if m:
    old = m.group(0)
    # only replace if not already robust with explicit catch near handler
    new = r"""ipcMain.handle('workspace:save', (_e, name, goal, planResult, extra = {}) => {
  try {
    const dir = userDataPath('workspaces');
    ensureDir(dir);
    const existingId = extra?.id || null;
    const id = existingId || `workspace_${Date.now()}`;
    const ws = {
      id,
      name: String(name || goal || 'Workspace').slice(0, 120),
      goal: String(goal || ''),
      plan: Array.isArray(planResult) ? planResult : [],
      currentGoal: String(goal || ''),
      tabs: tabSnapshot(),
      tabGroups: Array.isArray(extra?.tabGroups) ? extra.tabGroups : [],
      activeTabId,
      sources: Array.isArray(extra?.sources) ? extra.sources : [],
      chat: Array.isArray(extra?.chat) ? extra.chat.slice(-80) : [],
      notes: String(extra?.notes || ''),
      memory: extra?.memory || {},
      createdAt: extra?.createdAt || nowIso(),
      updatedAt: nowIso(),
      savedAt: nowIso(),
      schemaVersion: 2,
    };
    const file = path.join(dir, `${id}.json`);
    atomicWriteJson(file, ws);
    return { ok: true, id, name: ws.name, path: file, tabs: ws.tabs, savedAt: ws.savedAt };
  } catch (e) {
    console.error('[workspace:save]', e);
    return { ok: false, error: e.message || String(e) };
  }
});"""
    code = code[:m.start()] + new + code[m.end():]

write(main, code)
print('✓ main.js patched')

# --- renderer.js: save button state + toast fully wired ---
r = os.path.join(PROJECT, 'src', 'renderer.js')
js = read(r)

old = """async function saveWorkspace() {
  const goal = $('currentGoal')?.textContent || '';
  const name = goal.slice(0, 40) || `Workspace ${new Date().toLocaleDateString('ko-KR')}`;
  try {
    const result = await window.hermes.workspace.save(name, goal, state.planSteps || [], { tabGroups: state.tabGroups, sources: state.sources || [], chat: collectChatTranscript() });
    if (result?.ok) {
      log('workspace', `저장됨: ${result.name}`);
      addMessage('assistant', `✅ Workspace 저장됨: ${result.name}\n탭 ${result.tabs?.length || 0}개 · ${result.path || ''}`);
    }
  } catch (e) { log('workspace', e.message, 'error'); }
}"""
new = """async function saveWorkspace() {
  const btn = $('saveWorkspaceBtn');
  const goal = $('currentGoal')?.textContent || '';
  const name = goal.slice(0, 40) || `Workspace ${new Date().toLocaleDateString('ko-KR')}`;
  const setBtn = (status, title) => {
    if (!btn) return;
    btn.classList.remove('saving', 'saved', 'error', 'no-change');
    if (status) btn.classList.add(status);
    if (title) { btn.setAttribute('title', title); btn.setAttribute('data-tooltip', title); }
  };
  setBtn('saving', '저장 중');
  showSaveToast('Workspace 저장 중…', 'saving');
  try {
    const result = await window.hermes.workspace.save(name, goal, state.planSteps || [], { tabGroups: state.tabGroups, sources: state.sources || [], chat: collectChatTranscript() });
    if (result?.ok) {
      setBtn('saved', '저장 완료');
      showSaveToast('Workspace 저장 완료', 'success');
      log('workspace', `저장됨: ${result.name || name}`);
      const meta = $('workspaceMeta');
      if (meta) meta.textContent = `저장됨 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
      setTimeout(() => setBtn('', 'Workspace 저장'), 1800);
      return result;
    }
    throw new Error(result?.error || '저장 실패');
  } catch (e) {
    setBtn('error', '저장 실패');
    showSaveToast(`저장 실패 · ${e.message}`, 'error');
    log('workspace', e.message, 'error');
    setTimeout(() => setBtn('', 'Workspace 저장'), 2400);
    return { ok: false, error: e.message };
  }
}"""
if old in js:
    js = js.replace(old, new)
else:
    print('! saveWorkspace exact block not found')

write(r, js)
print('✓ renderer.js patched')

# --- chrome.html: save button icon should not reuse pin; use disk-like glyph with stable box ---
h = os.path.join(PROJECT, 'src', 'chrome.html')
html = read(h)
html = html.replace('<button class="mini-btn save-btn" id="saveWorkspaceBtn" title="Workspace 저장" data-tooltip="Workspace 저장"><svg class="ui-icon"><use href="#i-pin"></use></svg></button>', '<button class="mini-btn save-btn" id="saveWorkspaceBtn" title="Workspace 저장" data-tooltip="Workspace 저장" aria-label="Workspace 저장">💾</button>')
# no-change visual class
if '.save-btn.no-change' not in html:
    html = html.replace('.save-btn.error { color: var(--danger); background: rgba(239,68,68,.06); border-color: rgba(239,68,68,.1); }', '.save-btn.error { color: var(--danger); background: rgba(239,68,68,.06); border-color: rgba(239,68,68,.1); }\n    .save-btn.no-change { color: var(--faint); background: rgba(0,0,0,.025); }')
write(h, html)
print('✓ chrome.html patched')
