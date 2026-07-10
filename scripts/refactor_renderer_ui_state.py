from pathlib import Path

root = Path(__file__).resolve().parents[1]
renderer_p = root / 'src' / 'renderer.js'
html_p = root / 'src' / 'chrome.html'
preload_p = root / 'src' / 'preload.js'

r = renderer_p.read_text(encoding='utf-8')
h = html_p.read_text(encoding='utf-8')
p = preload_p.read_text(encoding='utf-8')

def rep(s, old, new, label):
    if old not in s:
        raise SystemExit(f'MISSING {label}')
    return s.replace(old, new, 1)

# Preload diagnostics
p = rep(p, """  diag: {
    webview: () => ipcRenderer.invoke('diag:webview'),
  },""", """  diag: {
    webview: () => ipcRenderer.invoke('diag:webview'),
    state: () => ipcRenderer.invoke('diag:state'),
    repairTabs: () => ipcRenderer.invoke('diag:repairTabs'),
  },""", 'preload diag')

# Renderer state additions
r = rep(r, """  settingsPopoverOpen: false, readModeEnabled: false, darkModeEnabled: false,
  modePerms: { label: '브라우저 실행', desc: '낮은 위험 자동 실행 · 중간 이상 승인 요청 · 실시간 표시.', canAct: true },
  goalEditing: false, tabContexts: [],
};""", """  settingsPopoverOpen: false, readModeEnabled: false, darkModeEnabled: false,
  modePerms: { label: '브라우저 실행', desc: '낮은 위험 자동 실행 · 중간 이상 승인 요청 · 실시간 표시.', canAct: true },
  goalEditing: false, tabContexts: [],
  leftPinned: false, leftHoverOpen: false, sidebarCloseTimer: null,
  actionLogOpen: false, actionLogCleanup: null,
  progressMessageEl: null, attachments: [], voiceActive: false,
};""", 'state additions')

# Bind events replacements/additions
r = rep(r, """  $('leftToggle').addEventListener('click', toggleLeftPanel);
  $('railExpand')?.addEventListener('click', toggleLeftPanel);""", """  $('leftToggle').addEventListener('click', toggleLeftPin);
  $('leftPinBtn')?.addEventListener('click', toggleLeftPin);
  $('railExpand')?.addEventListener('click', openFloatingLeftPanel);
  setupFloatingSidebar();""", 'left handlers')
r = rep(r, """  $('voiceBtn')?.addEventListener('click', toggleVoiceInput);
  $('fileBtn')?.addEventListener('click', () => $('fileInput')?.click());
  $('fileInput')?.addEventListener('change', handleFileAttach);
  $('inlineAIToggle')?.addEventListener('click', toggleInlineAI);""", """  $('toolBtn')?.addEventListener('click', toggleToolPopover);
  $('toolFileBtn')?.addEventListener('click', () => chooseAttachment('file'));
  $('toolImageBtn')?.addEventListener('click', () => chooseAttachment('image'));
  $('toolPdfBtn')?.addEventListener('click', () => chooseAttachment('pdf'));
  $('toolVoiceBtn')?.addEventListener('click', () => { closeToolPopover(); toggleVoiceInput(); });
  $('voiceBtn')?.addEventListener('click', toggleVoiceInput);
  $('fileBtn')?.addEventListener('click', () => $('fileInput')?.click());
  $('fileInput')?.addEventListener('change', handleFileAttach);
  $('inlineAIToggle')?.addEventListener('click', toggleInlineAI);""", 'tool handlers')

# Global ESC closes action/tool popovers
r = rep(r, """  if (e.key === 'Escape') {
    if (SettingsPopover.isOpen()) { e.preventDefault(); SettingsPopover.close(); return; }
    hideFindBar();
    return;
  }""", """  if (e.key === 'Escape') {
    if (closeActionLog()) { e.preventDefault(); return; }
    if (closeToolPopover()) { e.preventDefault(); return; }
    if (SettingsPopover.isOpen()) { e.preventDefault(); SettingsPopover.close(); return; }
    hideFindBar();
    return;
  }""", 'esc popovers')

# Browser state now controls layout classes from registry/prefs
r = rep(r, """function onBrowserState(s) {
  if (!s || !Array.isArray(s.tabs)) return;
  state.browser = s;
  $('addressInput').value = s.activeUrl || '';
  $('pagePill').textContent = s.activeTitle ? s.activeTitle.slice(0, 34) : '대기';
  renderTabs(s.tabs || [], s.activeTabId);
}""", """function onBrowserState(s) {
  if (!s || !Array.isArray(s.tabs)) return;
  state.browser = s;
  state.leftPinned = !!s.leftPinned;
  applyLeftSidebarState();
  $('addressInput').value = s.activeUrl || '';
  $('pagePill').textContent = s.activeTitle ? s.activeTitle.slice(0, 34) : '대기';
  renderTabs(s.tabs || [], s.activeTabId);
  if (s.diagnostics && !s.diagnostics.ok) log('diag', `state mismatch: ${s.diagnostics.issues.join(', ')}`, 'warn');
}""", 'onBrowserState')

# groupTabs registry-safe: no recursion ambiguity, active tab visible in collapsed group handled in render
r = rep(r, """function groupTabs(tabs) {
  const agentTabs = (tabs || []).filter(t => t.agentOwned);
  const normalTabs = (tabs || []).filter(t => !t.agentOwned);
  const custom = state.tabGroups || [];
  if (agentTabs.length) return [{ name: 'Agent Tabs', tabs: agentTabs }, ...groupTabs(normalTabs)];
  if (custom.length) {
    const assigned = new Set();
    const groups = custom.map(g => {
      const matched = normalTabs.filter(t => (g.tabIds || []).includes(t.id) || domainOf(t.url) === g.domain);
      matched.forEach(t => assigned.add(t.id));
      return { name: g.name, tabs: matched };
    }).filter(g => g.tabs.length);
    const rest = normalTabs.filter(t => !assigned.has(t.id));
    if (rest.length) groups.push({ name: 'Ungrouped', tabs: rest });
    return groups;
  }
  const map = new Map();
  normalTabs.forEach(tab => { const key = domainOf(tab.url) || 'Workspace'; if (!map.has(key)) map.set(key, []); map.get(key).push(tab); });
  return [...map.entries()].map(([name, gt]) => ({ name, tabs: gt }));
}""", """function groupTabs(tabs) {
  const live = dedupeTabs(tabs || []);
  const groups = [];
  const assigned = new Set();
  const agentTabs = live.filter(t => t.createdBy === 'ai' || t.agentOwned);
  if (agentTabs.length) {
    groups.push({ name: 'Agent Tabs', tabs: agentTabs });
    agentTabs.forEach(t => assigned.add(t.id));
  }
  for (const g of (state.tabGroups || [])) {
    const matched = live.filter(t => !assigned.has(t.id) && ((g.tabIds || []).includes(t.id) || (g.domain && domainOf(t.url) === g.domain)));
    if (matched.length) {
      matched.forEach(t => assigned.add(t.id));
      groups.push({ name: g.name, tabs: matched });
    }
  }
  const rest = live.filter(t => !assigned.has(t.id));
  const domainMap = new Map();
  rest.forEach(tab => {
    const key = tab.groupId || domainOf(tab.url) || 'Workspace';
    if (!domainMap.has(key)) domainMap.set(key, []);
    domainMap.get(key).push(tab);
  });
  for (const [name, gt] of domainMap.entries()) groups.push({ name, tabs: gt });
  return groups;
}
function dedupeTabs(tabs) {
  const seenId = new Set();
  const seenWc = new Set();
  return tabs.filter(t => {
    if (!t || seenId.has(t.id)) return false;
    if (t.webContentsId && seenWc.has(t.webContentsId)) return false;
    seenId.add(t.id);
    if (t.webContentsId) seenWc.add(t.webContentsId);
    return !!t.webContentsId;
  });
}""", 'groupTabs')

# Render collapsed active tab: adjust condition
r = rep(r, """    if (!state.collapsedGroups.has(group.name)) {
      group.tabs.forEach(tab => {""", """    const collapsed = state.collapsedGroups.has(group.name);
    const visibleGroupTabs = collapsed ? group.tabs.filter(t => t.id === activeId) : group.tabs;
    if (visibleGroupTabs.length) {
      visibleGroupTabs.forEach(tab => {""", 'collapsed active visible')

# LLM progress messaging replacements
r = rep(r, """    addMessage('thinking', '생각 중');""", """    upsertProgress('검색 계획을 세우는 중');""", 'thinking progress')
r = rep(r, """    clearThinking();
    const actionData = parseActionFromResponse(text);""", """    clearThinking();
    const actionData = parseActionFromResponse(text);""", 'noop clear')
r = rep(r, """    addMessage('assistant', stripActionMarkers(text) || `실행: ${actionData.action} ${JSON.stringify(actionData.params || {}).slice(0, 80)}`);
    log('agent', `${actionData.action} ${JSON.stringify(actionData.params || {})}`);
    const result = await action(actionData.action, actionData.params || {});""", """    upsertProgress(progressLabelForAction(actionData.action, searchQueries.length, sourcesRead.length));
    log('agent', `${actionData.action} ${JSON.stringify(actionData.params || {})}`);
    const result = await action(actionData.action, { ...(actionData.params || {}), createdBy: actionData.action === 'searchWeb' || actionData.action === 'search' ? 'ai' : (actionData.params || {}).createdBy });""", 'agent verbose')
r = r.replace("""          const topResults = searchResults.slice(0, 10).map((r, i) => `${i+1}. ${r.title}\\n   URL: ${r.url}\\n   ${r.snippet || ''}`).join('\\n');
          addMessage('assistant', `📄 검색 결과 ${searchResults.length}건:\\n${topResults}`);""", """          upsertProgress(`검색 중 · 결과 ${searchResults.length}개 확인`);
          log('search-results', searchResults.slice(0, 10).map((r, i) => `${i+1}. ${r.title} ${r.url}`).join(' | '));""")
r = rep(r, """      sourcesRead.push({ url: result.url, title: state.context?.title || '' });""", """      sourcesRead.push({ url: result.url, title: state.context?.title || '', tabId: result.tabId });
      upsertProgress(`확인 중 · 출처 ${sourcesRead.length}/${sc.maxPagesToRead}`);""", 'sources progress')
r = rep(r, """  addMessage('assistant', '최대 실행 횟수 완료. 필요하면 추가 요청해주세요.');""", """  upsertProgress('작업 완료 · 최대 실행 횟수 도달');""", 'max done')

# Save workspace extended
r = rep(r, """    const result = await window.hermes.workspace.save(name, goal, JSON.stringify(state.planSteps || []));""", """    const result = await window.hermes.workspace.save(name, goal, state.planSteps || [], { tabGroups: state.tabGroups, sources: state.sources || [], chat: collectChatTranscript() });""", 'workspace save args')
r = r.replace("""      addMessage('assistant', `✅ Workspace 저장됨: ${result.name}\\n탭 ${result.tabs?.length || 0}개, Goal: ${goal}`);""", """      addMessage('assistant', `✅ Workspace 저장됨: ${result.name}\\n탭 ${result.tabs?.length || 0}개 · ${result.path || ''}`);""")

# Replace UI helper panel/action functions
r = rep(r, """function toggleLeftPanel() {
  const app = $('app'); const panel = $('leftPanel');
  panel.classList.toggle('collapsed'); app.classList.toggle('left-collapsed');
  window.hermes.browser.toggleLeftPanel();
}
function toggleRightPanel() {
  const app = $('app'); const panel = $('rightPanel');
  panel.classList.toggle('collapsed'); app.classList.toggle('right-collapsed');
  window.hermes.browser.toggleRightPanel();
}""", """function applyLeftSidebarState() {
  const app = $('app'); const panel = $('leftPanel'); const pin = $('leftPinBtn');
  if (!app || !panel) return;
  app.classList.toggle('left-collapsed', !state.leftPinned);
  app.classList.toggle('left-floating-open', !state.leftPinned && state.leftHoverOpen);
  panel.classList.toggle('collapsed', !state.leftPinned);
  if (pin) { pin.classList.toggle('active', state.leftPinned); pin.textContent = state.leftPinned ? '고정됨' : '핀'; }
}
async function toggleLeftPin() {
  state.leftPinned = !state.leftPinned;
  state.leftHoverOpen = false;
  applyLeftSidebarState();
  await window.hermes.browser.toggleLeftPanel(state.leftPinned);
}
function openFloatingLeftPanel() {
  if (state.leftPinned) return;
  clearTimeout(state.sidebarCloseTimer);
  state.leftHoverOpen = true;
  applyLeftSidebarState();
}
function scheduleCloseFloatingLeftPanel() {
  if (state.leftPinned) return;
  clearTimeout(state.sidebarCloseTimer);
  state.sidebarCloseTimer = setTimeout(() => {
    if (state.actionLogOpen || isAnySheetOpen() || $('toolPopover')?.classList.contains('visible')) return;
    state.leftHoverOpen = false;
    applyLeftSidebarState();
  }, 220);
}
function setupFloatingSidebar() {
  const rail = $('leftRail'); const panel = $('leftPanel');
  rail?.addEventListener('mouseenter', openFloatingLeftPanel);
  panel?.addEventListener('mouseenter', () => { clearTimeout(state.sidebarCloseTimer); });
  panel?.addEventListener('mouseleave', scheduleCloseFloatingLeftPanel);
}
function toggleRightPanel() {
  const app = $('app'); const panel = $('rightPanel');
  panel.classList.toggle('collapsed'); app.classList.toggle('right-collapsed');
  window.hermes.browser.toggleRightPanel();
}
function isAnySheetOpen() { return [...document.querySelectorAll('.side-sheet.visible,.settings-popover.visible')].length > 0; }""", 'left panel funcs')

# Replace action log popover lifecycle
r = rep(r, """function toggleActionLog() {
  const pop = $('actionLogPopover');
  if (!pop) return;
  if (pop.classList.contains('visible')) { pop.classList.remove('visible'); return; }
  window.hermes.agent.getActionLog().then(entries => {""", """function toggleActionLog(e) {
  e?.stopPropagation?.();
  const pop = $('actionLogPopover');
  if (!pop) return;
  if (state.actionLogOpen) { closeActionLog(); return; }
  closeToolPopover();
  SettingsPopover.close();
  window.hermes.agent.getActionLog().then(entries => {""", 'actionlog open')
r = rep(r, """    pop.classList.add('visible');
  }).catch(() => {});
}""", """    pop.classList.add('visible');
    state.actionLogOpen = true;
    const onDoc = (ev) => { if (!pop.contains(ev.target) && ev.target !== $('logBtn')) closeActionLog(); };
    const onEsc = (ev) => { if (ev.key === 'Escape') closeActionLog(); };
    setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
    document.addEventListener('keydown', onEsc);
    state.actionLogCleanup = () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onEsc); };
  }).catch(() => {});
}
function closeActionLog() {
  const pop = $('actionLogPopover');
  if (!pop || !state.actionLogOpen) return false;
  pop.classList.remove('visible');
  state.actionLogOpen = false;
  state.actionLogCleanup?.();
  state.actionLogCleanup = null;
  return true;
}""", 'actionlog close')

# Add message/progress helpers around addMessage
r = rep(r, """function addMessage(role, text) {
  const div = document.createElement('div'); div.className = `msg ${role}`; div.textContent = text;
  $('messages').appendChild(div); div.scrollIntoView({ block: 'end' });
}
function clearThinking() {
  const msgs = $('messages').children; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].classList.contains('thinking')) msgs[i].remove(); }
}""", """function addMessage(role, text) {
  const div = document.createElement('div'); div.className = `msg ${role}`; div.textContent = text;
  $('messages').appendChild(div); div.scrollIntoView({ block: 'end' });
  if (role !== 'thinking') state.progressMessageEl = null;
}
function upsertProgress(text) {
  const box = $('messages');
  if (!state.progressMessageEl || !box.contains(state.progressMessageEl)) {
    state.progressMessageEl = document.createElement('div');
    state.progressMessageEl.className = 'msg assistant progress';
    box.appendChild(state.progressMessageEl);
  }
  state.progressMessageEl.textContent = text;
  state.progressMessageEl.scrollIntoView({ block: 'end' });
}
function progressLabelForAction(actionName, queryCount, sourceCount) {
  if (actionName === 'searchWeb' || actionName === 'search') return `검색 중 · 관련 검색어 ${queryCount + 1}개 확인`;
  if (actionName === 'openTab' || actionName === 'navigate') return `페이지 확인 중 · 출처 ${sourceCount + 1}개 후보`;
  if (actionName === 'inspectPage') return '현재 페이지를 읽는 중';
  if (actionName === 'click' || actionName === 'fill' || actionName === 'type') return '브라우저 작업 실행 중';
  return '작업 진행 중';
}
function clearThinking() {
  const msgs = $('messages').children; for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].classList.contains('thinking')) msgs[i].remove(); }
}""", 'message helpers')

# Add composer/tool helpers before Bookmarks
insert = r'''
function toggleToolPopover(e) {
  e?.stopPropagation?.();
  const pop = $('toolPopover');
  if (!pop) return;
  if (pop.classList.contains('visible')) { closeToolPopover(); return; }
  closeActionLog();
  pop.classList.add('visible');
  const onDoc = (ev) => { if (!pop.contains(ev.target) && ev.target !== $('toolBtn')) closeToolPopover(); };
  const onEsc = (ev) => { if (ev.key === 'Escape') closeToolPopover(); };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  document.addEventListener('keydown', onEsc, { once: true });
  pop._cleanup = () => document.removeEventListener('pointerdown', onDoc);
}
function closeToolPopover() {
  const pop = $('toolPopover');
  if (!pop || !pop.classList.contains('visible')) return false;
  pop.classList.remove('visible');
  pop._cleanup?.();
  return true;
}
function chooseAttachment(kind) {
  const input = $('fileInput');
  if (!input) return;
  input.accept = kind === 'image' ? 'image/*' : kind === 'pdf' ? 'application/pdf' : '';
  closeToolPopover();
  input.click();
}
function renderAttachmentChips() {
  const row = $('attachmentRow');
  if (!row) return;
  row.replaceChildren();
  row.classList.toggle('visible', state.attachments.length > 0 || state.voiceActive);
  state.attachments.forEach((file, index) => {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    chip.textContent = file.name || `file-${index + 1}`;
    const rm = document.createElement('button');
    rm.textContent = '×';
    rm.addEventListener('click', () => { state.attachments.splice(index, 1); renderAttachmentChips(); });
    chip.appendChild(rm);
    row.appendChild(chip);
  });
  if (state.voiceActive) {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip voice';
    chip.textContent = '음성 입력 중';
    row.appendChild(chip);
  }
}
function collectChatTranscript() {
  return [...$('messages').querySelectorAll('.msg')].slice(-40).map(m => ({ role: m.classList.contains('user') ? 'user' : 'assistant', text: m.textContent }));
}
'''
r = r.replace("// === Bookmarks ===", insert + "\n// === Bookmarks ===", 1)

# Patch handleFileAttach / voice if exists
if "function handleFileAttach" in r:
    start = r.index("function handleFileAttach")
    end = r.index("function toggleInlineAI", start)
    replacement = r'''function handleFileAttach(e) {
  const files = [...(e.target.files || [])];
  state.attachments = files.map(f => ({ name: f.name, size: f.size, type: f.type, path: f.path }));
  renderAttachmentChips();
  log('file', `${state.attachments.length}개 첨부`);
}
function toggleVoiceInput() {
  state.voiceActive = !state.voiceActive;
  renderAttachmentChips();
  log('voice', state.voiceActive ? 'listening' : 'stopped');
}
'''
    r = r[:start] + replacement + r[end:]

# autoResize larger
r = rep(r, """function autoResizePrompt() { const t = $('promptInput'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 92) + 'px'; }""", """function autoResizePrompt() { const t = $('promptInput'); t.style.height = 'auto'; t.style.height = Math.min(Math.max(t.scrollHeight, 54), 132) + 'px'; }""", 'auto resize')

# HTML CSS: floating sidebar and composer
h = rep(h, """    .app.left-collapsed .left-rail { display: flex; }""", """    .app.left-collapsed .left-rail { display: flex; }
    .app.left-floating-open .left.collapsed { width: var(--left); opacity: 1; pointer-events: auto; overflow-y: auto; z-index: 80; }
    .app.left-floating-open .left-rail { opacity: .35; }
    .left-pin.active { color: var(--accent); background: var(--accent-soft); }""", 'floating css')

h = rep(h, """    .msg.thinking { align-self: flex-start; background: rgba(255,255,255,.3); border: 1px dashed rgba(0,0,0,.08); color: var(--faint); }
    .msg.thinking::after { content: "..."; animation: pulse 1s ease-in-out infinite; }
    .hidden-utility { display: none !important; }""", """    .msg.thinking { align-self: flex-start; background: rgba(255,255,255,.3); border: 1px dashed rgba(0,0,0,.08); color: var(--faint); }
    .msg.thinking::after { content: "..."; animation: pulse 1s ease-in-out infinite; }
    .msg.progress { background: rgba(91,108,255,.08); border: 1px solid rgba(91,108,255,.12); color: var(--accent); font-weight: 600; }
    .hidden-utility { display: none !important; }""", 'progress css')

h = rep(h, """    .input-wrap { display: flex; gap: 4px; align-items: flex-end; padding: 4px 6px; border-radius: var(--sb-radius); background: rgba(255,255,255,.55); border: 1px solid rgba(0,0,0,.05); box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
    #promptInput { flex: 1; min-height: 36px; max-height: 100px; resize: none; outline: 0; border: 0; background: transparent; color: var(--ink); font-size: var(--sb-body); line-height: 1.4; }
    .input-btn { width: 20px; height: 20px; border-radius: 4px; background: transparent; color: var(--faint); font-size: 12px; flex: 0 0 auto; display: grid; place-items: center; transition: background .18s, color .18s; }
    .input-btn:hover { background: var(--accent-soft); color: var(--accent); }
    #sendBtn, #stopBtn { width: 24px; height: 24px; border-radius: 999px; font-weight: 700; transition: transform .18s var(--ease-spring), opacity .18s; display: grid; place-items: center; }
    #sendBtn { color: white; background: var(--accent); box-shadow: 0 1px 4px rgba(91,108,255,.2), inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.08); }
""", """    .attachment-row { display: none; gap: 4px; flex-wrap: wrap; margin-bottom: 5px; }
    .attachment-row.visible { display: flex; }
    .attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 6px; border-radius: 999px; background: rgba(91,108,255,.08); color: var(--accent); font-size: var(--sb-muted); font-weight: 600; }
    .attachment-chip.voice { color: var(--warn); background: rgba(245,158,11,.09); }
    .attachment-chip button { width: 14px; height: 14px; border-radius: 50%; background: transparent; color: currentColor; }
    .input-wrap { position: relative; display: grid; grid-template-columns: 24px 1fr 36px; gap: 6px; align-items: stretch; padding: 6px; border-radius: var(--sb-radius); background: rgba(255,255,255,.55); border: 1px solid rgba(0,0,0,.05); box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
    #promptInput { width: 100%; min-width: 0; min-height: 54px; max-height: 132px; resize: none; outline: 0; border: 0; background: transparent; color: var(--ink); font-size: var(--sb-body); line-height: 1.45; overflow-y: auto; }
    .input-btn { width: 22px; height: 22px; border-radius: 5px; background: transparent; color: var(--faint); font-size: 12px; flex: 0 0 auto; display: grid; place-items: center; transition: background .18s, color .18s; align-self: end; }
    .input-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tool-popover { position: absolute; left: 0; bottom: calc(100% + 6px); width: 132px; display: none; flex-direction: column; gap: 2px; padding: 6px; border-radius: var(--sb-radius); background: var(--glass-pop-bg); border: 1px solid var(--glass-edge-light); backdrop-filter: var(--glass-pop-blur); box-shadow: var(--glass-pop-shadow); z-index: 130; }
    .tool-popover.visible { display: flex; animation: popoverIn .18s var(--ease); }
    .tool-popover button { text-align: left; padding: 5px 7px; border-radius: 5px; background: transparent; color: var(--muted); font-size: var(--sb-muted); font-weight: 600; }
    .tool-popover button:hover { background: var(--accent-soft); color: var(--accent); }
    #sendBtn, #stopBtn { width: 36px; min-height: 54px; border-radius: 10px; font-weight: 700; transition: transform .18s var(--ease-spring), opacity .18s; display: grid; place-items: center; align-self: stretch; }
    #sendBtn { color: white; background: var(--accent); box-shadow: 0 1px 4px rgba(91,108,255,.2), inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.08); }
""", 'composer css')

# HTML pin and composer structure
h = rep(h, """        <span class="workspace-meta" id="workspaceMeta" title="">페이지 추적 중</span>
        <button class="mini-btn" id="saveWorkspaceBtn" title="Workspace 저장" style="margin-left:auto;flex:0 0 auto">💾</button>""", """        <span class="workspace-meta" id="workspaceMeta" title="">페이지 추적 중</span>
        <button class="mini-btn left-pin" id="leftPinBtn" title="사이드바 고정" style="margin-left:auto;flex:0 0 auto">핀</button>
        <button class="mini-btn" id="saveWorkspaceBtn" title="Workspace 저장" style="flex:0 0 auto">💾</button>""", 'pin button')

h = rep(h, """        <div class="input-wrap"><textarea id="promptInput" placeholder="목표 입력 · @으로 컨텍스트 연결"></textarea><input type="file" id="fileInput" style="display:none" /><button class="input-btn" id="fileBtn" title="파일 첨부">📎</button><button class="input-btn" id="voiceBtn" title="음성 입력">🎤</button><button class="input-btn" id="inlineAIToggle" title="인라인 AI">Aa</button><button id="stopBtn">■</button><button id="sendBtn">➜</button></div>""", """        <div class="attachment-row" id="attachmentRow"></div>
        <div class="input-wrap"><button class="input-btn" id="toolBtn" title="도구">＋</button><div class="tool-popover" id="toolPopover"><button id="toolFileBtn">파일 첨부</button><button id="toolImageBtn">이미지 첨부</button><button id="toolPdfBtn">PDF 첨부</button><button id="toolVoiceBtn">음성 입력</button></div><textarea id="promptInput" placeholder="목표 입력 · @으로 컨텍스트 연결"></textarea><input type="file" id="fileInput" style="display:none" /><button class="input-btn" id="fileBtn" title="파일 첨부" style="display:none">📎</button><button class="input-btn" id="voiceBtn" title="음성 입력" style="display:none">🎤</button><button class="input-btn" id="inlineAIToggle" title="인라인 AI" style="display:none">Aa</button><button id="stopBtn">■</button><button id="sendBtn">➜</button></div>""", 'composer html')

renderer_p.write_text(r, encoding='utf-8')
html_p.write_text(h, encoding='utf-8')
preload_p.write_text(p, encoding='utf-8')
print('patched renderer/html/preload')
