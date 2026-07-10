from pathlib import Path
root = Path(__file__).resolve().parents[1]
main = root/'main.js'
preload = root/'src/preload.js'
renderer = root/'src/renderer.js'
html = root/'src/chrome.html'
test = root/'tests/smoke.test.js'

s = main.read_text(encoding='utf-8')
old = "let findInPageActive = null;\n"
new = """let findInPageActive = null;
let agentTabIds = new Set();

function readJsonFile(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function encryptJson(data) {
  const json = JSON.stringify(data || []);
  if (!safeStorage.isEncryptionAvailable()) return Buffer.from(json, 'utf8');
  return safeStorage.encryptString(json);
}
function decryptJson(buffer, fallback) {
  try {
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : Buffer.from(buffer).toString('utf8');
    return JSON.parse(text);
  } catch { return fallback; }
}
function vaultPath() { return userDataPath('credentials-vault.enc'); }
function readCredentialVault() {
  const file = vaultPath();
  if (!fs.existsSync(file)) return [];
  return decryptJson(fs.readFileSync(file), []);
}
function writeCredentialVault(items) { fs.writeFileSync(vaultPath(), encryptJson(items)); }
function publicCredential(item) {
  return {
    id: item.id, site: item.site || '', username: item.username || '', note: item.note || '',
    createdAt: item.createdAt, updatedAt: item.updatedAt, hasPassword: !!item.password,
  };
}
function taskHistoryPath() { return userDataPath('task-history.json'); }
function readTaskHistory() { return readJsonFile(taskHistoryPath(), []); }
function writeTaskHistory(items) { writeJsonFile(taskHistoryPath(), items.slice(0, 100)); }
function recordTaskArtifact(entry) {
  const items = readTaskHistory();
  const item = {
    id: entry.id || `task_${Date.now()}`,
    title: String(entry.title || entry.goal || 'Untitled task').slice(0, 140),
    goal: String(entry.goal || '').slice(0, 1000),
    status: entry.status || 'completed',
    summary: String(entry.summary || '').slice(0, 4000),
    sources: Array.isArray(entry.sources) ? entry.sources.slice(0, 20) : [],
    tabIds: Array.isArray(entry.tabIds) ? entry.tabIds.slice(0, 30) : [],
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = items.findIndex(t => t.id === item.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...item };
  else items.unshift(item);
  writeTaskHistory(items);
  send('task-history-updated', item);
  return item;
}
"""
if new not in s:
    s = s.replace(old, new)

s = s.replace("function createTab(url = 'https://www.google.com', activate = true) {", "function createTab(url = 'https://www.google.com', activate = true, meta = {}) {")
s = s.replace("const tab = { id, url: normalizeUrl(url), title: 'New Tab', loading: false, domain: '', view };", "const tab = { id, url: normalizeUrl(url), title: 'New Tab', loading: false, domain: '', agentOwned: !!meta.agentOwned, workspaceId: meta.workspaceId || '', view };\n  if (tab.agentOwned) agentTabIds.add(id);")
s = s.replace("domain: t.domain || domainOf(t.url),", "domain: t.domain || domainOf(t.url),\n  agentOwned: !!t.agentOwned,")
s = s.replace("const tab = createTab(params.url || 'https://www.google.com', true);", "const tab = createTab(params.url || 'https://www.google.com', true, { agentOwned: true });")
s = s.replace("createTab(dataUri, true);\n  return { ok: true };", "const tab = createTab(dataUri, true, { agentOwned: true });\n  recordTaskArtifact({ title: title || 'Research artifact', goal: title || '', status: 'artifact', summary: htmlContent || '', tabIds: [tab.id] });\n  return { ok: true, tabId: tab.id };")
marker = "ipcMain.handle('settings:get', () => {"
insert = """// === Credential Vault + Task/Artifact History ===
ipcMain.handle('vault:list', () => readCredentialVault().map(publicCredential));
ipcMain.handle('vault:save', (_e, item) => {
  const list = readCredentialVault();
  const now = new Date().toISOString();
  const id = item.id || `cred_${Date.now()}`;
  const clean = {
    id, site: String(item.site || '').trim(), username: String(item.username || '').trim(),
    password: String(item.password || ''), note: String(item.note || '').trim(),
    createdAt: item.createdAt || now, updatedAt: now,
  };
  if (!clean.site) return { ok: false, error: 'site required' };
  const idx = list.findIndex(v => v.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...clean, password: clean.password || list[idx].password || '' };
  else list.unshift(clean);
  writeCredentialVault(list.slice(0, 200));
  return { ok: true, item: publicCredential(clean), encryptionAvailable: safeStorage.isEncryptionAvailable() };
});
ipcMain.handle('vault:getSecret', (_e, id) => {
  const item = readCredentialVault().find(v => v.id === id);
  if (!item) return { ok: false, error: 'credential not found' };
  return { ok: true, password: item.password || '', username: item.username || '', site: item.site || '' };
});
ipcMain.handle('vault:delete', (_e, id) => { writeCredentialVault(readCredentialVault().filter(v => v.id !== id)); return { ok: true }; });
ipcMain.handle('vault:status', () => ({ ok: true, encryptionAvailable: safeStorage.isEncryptionAvailable(), count: readCredentialVault().length }));
ipcMain.handle('taskHistory:list', () => readTaskHistory());
ipcMain.handle('taskHistory:add', (_e, entry) => ({ ok: true, item: recordTaskArtifact(entry || {}) }));
ipcMain.handle('taskHistory:clear', () => { writeTaskHistory([]); return { ok: true }; });
ipcMain.handle('browser:markAgentTab', (_e, id, owned = true) => {
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) return { ok: false };
  tab.agentOwned = !!owned;
  if (owned) agentTabIds.add(tab.id); else agentTabIds.delete(tab.id);
  notifyAll();
  return { ok: true, id: tab.id, agentOwned: tab.agentOwned };
});

"""
if insert not in s:
    s = s.replace(marker, insert + marker)
main.write_text(s, encoding='utf-8')

p = preload.read_text(encoding='utf-8')
p = p.replace("pinTab: (id) => ipcRenderer.invoke('browser:pinTab', id),", "pinTab: (id) => ipcRenderer.invoke('browser:pinTab', id),\n    markAgentTab: (id, owned) => ipcRenderer.invoke('browser:markAgentTab', id, owned),")
p = p.replace("settings: {\n    get: () => ipcRenderer.invoke('settings:get'),", "vault: {\n    list: () => ipcRenderer.invoke('vault:list'),\n    save: (item) => ipcRenderer.invoke('vault:save', item),\n    getSecret: (id) => ipcRenderer.invoke('vault:getSecret', id),\n    delete: (id) => ipcRenderer.invoke('vault:delete', id),\n    status: () => ipcRenderer.invoke('vault:status'),\n  },\n  taskHistory: {\n    list: () => ipcRenderer.invoke('taskHistory:list'),\n    add: (entry) => ipcRenderer.invoke('taskHistory:add', entry),\n    clear: () => ipcRenderer.invoke('taskHistory:clear'),\n  },\n  settings: {\n    get: () => ipcRenderer.invoke('settings:get'),")
p = p.replace("onInjectionWarning: (cb) => on('injection-warning', cb),", "onInjectionWarning: (cb) => on('injection-warning', cb),\n    onTaskHistoryUpdated: (cb) => on('task-history-updated', cb),")
preload.write_text(p, encoding='utf-8')

h = html.read_text(encoding='utf-8')
css_marker = "    .settings-item.active .switch::before { transform: translateX(12px); }\n"
css_insert = """    .settings-item.active .switch::before { transform: translateX(12px); }
    .compact-list { display: grid; gap: 8px; max-height: 360px; overflow: auto; padding-right: 2px; }
    .vault-item, .task-item { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.32); border: 1px solid rgba(0,0,0,.045); display: grid; gap: 4px; }
    .vault-title, .task-title { font-size: var(--fs-sm); font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-meta, .task-meta { font-size: var(--fs-xs); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-actions, .task-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 3px; }
    .agent-tab-pill { color: var(--accent); font-size: 10px; font-weight: 900; margin-left: 4px; }
"""
if css_insert not in h:
    h = h.replace(css_marker, css_insert)
modal_marker = "  <div class=\"side-sheet\" id=\"downloadsModal\"><div class=\"sheet-card\">"
modal_insert = """
  <div class="side-sheet" id="vaultModal"><div class="sheet-card">
    <h2>Credential Vault</h2>
    <div class="field"><label>Site / Domain</label><input id="vaultSite" placeholder="example.com" /></div>
    <div class="field"><label>Username</label><input id="vaultUser" placeholder="아이디 또는 이메일" /></div>
    <div class="field"><label>Password</label><input id="vaultPass" type="password" placeholder="저장할 비밀번호" /></div>
    <div class="field"><label>Note</label><input id="vaultNote" placeholder="용도 / 주의사항" /></div>
    <div class="compact-list" id="vaultList"></div>
    <div class="sheet-actions"><button class="secondary" id="vaultCancel">닫기</button><button class="primary" id="vaultSave">암호화 저장</button></div>
  </div></div>

  <div class="side-sheet" id="tasksModal"><div class="sheet-card">
    <h2>Task Artifacts</h2>
    <div class="compact-list" id="taskHistoryList"></div>
    <div class="sheet-actions"><button class="danger-btn" id="clearTasksBtn">전체 삭제</button><button class="secondary" id="tasksCancel">닫기</button></div>
  </div></div>

"""
if modal_insert not in h:
    h = h.replace(modal_marker, modal_insert + modal_marker)
html.write_text(h, encoding='utf-8')

r = renderer.read_text(encoding='utf-8')
r = r.replace("bookmarks: [], tabGroups: [], collapsedGroups: new Set(), selectedMentions: [], favoritesExpanded: false,", "bookmarks: [], tabGroups: [], collapsedGroups: new Set(), selectedMentions: [], favoritesExpanded: false, taskRunId: null, taskStartedAt: null,")
r = r.replace("window.hermes.events.onInjectionWarning(onInjectionWarning);", "window.hermes.events.onInjectionWarning(onInjectionWarning);\n    window.hermes.events.onTaskHistoryUpdated?.(() => { if ($('tasksModal')?.classList.contains('visible')) openTaskHistory(); });")
r = r.replace("$('historyCancel').addEventListener('click', () => hideSheet('historyModal'));", "$('historyCancel').addEventListener('click', () => hideSheet('historyModal'));\n  $('vaultCancel')?.addEventListener('click', () => hideSheet('vaultModal'));\n  $('vaultSave')?.addEventListener('click', saveVaultItem);\n  $('tasksCancel')?.addEventListener('click', () => hideSheet('tasksModal'));\n  $('clearTasksBtn')?.addEventListener('click', clearTaskHistory);")
r = r.replace("const url = document.createElement('div'); url.className = 'tab-url'; url.textContent = tab.url || '';", "const url = document.createElement('div'); url.className = 'tab-url'; url.textContent = tab.url || '';\n        if (tab.agentOwned) { const pill = document.createElement('span'); pill.className = 'agent-tab-pill'; pill.textContent = 'AI'; title.appendChild(pill); }")
r = r.replace("function groupTabs(tabs) {\n  const custom = state.tabGroups || [];", "function groupTabs(tabs) {\n  const agentTabs = (tabs || []).filter(t => t.agentOwned);\n  const normalTabs = (tabs || []).filter(t => !t.agentOwned);\n  const custom = state.tabGroups || [];\n  if (agentTabs.length) return [{ name: 'Agent Tabs', tabs: agentTabs }, ...groupTabs(normalTabs)];")
r = r.replace("const matched = tabs.filter(t =>", "const matched = normalTabs.filter(t =>")
r = r.replace("const rest = tabs.filter(t =>", "const rest = normalTabs.filter(t =>")
r = r.replace("tabs.forEach(tab =>", "normalTabs.forEach(tab =>")
r = r.replace("state.selectedMentions = mentions;\n  input.value", "state.selectedMentions = mentions;\n  state.taskRunId = `task_${Date.now()}`; state.taskStartedAt = new Date().toISOString();\n  input.value")
r = r.replace("await runAgent(text);", "await runAgent(text);\n  try { await window.hermes.taskHistory.add({ id: state.taskRunId, title: text, goal: text, status: state.stopRequested ? 'stopped' : 'completed', summary: 'Agent run finished. See chat and action log for details.', tabIds: (state.browser.tabs || []).filter(t => t.agentOwned).map(t => t.id), createdAt: state.taskStartedAt }); } catch {}")
settings_marker = "function openHistory() {"
extra_funcs = r'''
async function openVault() {
  await renderVaultList();
  showSheet('vaultModal');
}
async function renderVaultList() {
  const list = $('vaultList'); if (!list) return;
  list.replaceChildren();
  let items = [];
  try { items = await window.hermes.vault.list(); } catch {}
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'task-meta'; empty.textContent = '저장된 credential 없음'; list.appendChild(empty); return;
  }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'vault-item';
    const title = document.createElement('div'); title.className = 'vault-title'; title.textContent = item.site || 'site';
    const meta = document.createElement('div'); meta.className = 'vault-meta'; meta.textContent = `${item.username || 'no user'} · ${item.hasPassword ? 'password saved' : 'no password'} · ${new Date(item.updatedAt || item.createdAt).toLocaleString('ko-KR')}`;
    const actions = document.createElement('div'); actions.className = 'vault-actions';
    const fill = document.createElement('button'); fill.className = 'mini-btn'; fill.textContent = '입력'; fill.title = '현재 페이지 폼에 username/password 입력';
    fill.addEventListener('click', async () => {
      const secret = await window.hermes.vault.getSecret(item.id);
      if (!secret?.ok) return log('vault', secret?.error || 'load failed', 'error');
      await window.hermes.browser.action('fill', { selector: 'input[type="email"],input[name*="user"],input[name*="id"],input[type="text"]', text: secret.username });
      if (secret.password) await window.hermes.browser.action('fill', { selector: 'input[type="password"]', text: secret.password });
      log('vault', `filled ${item.site}`);
    });
    const del = document.createElement('button'); del.className = 'mini-btn'; del.textContent = '삭제';
    del.addEventListener('click', async () => { await window.hermes.vault.delete(item.id); renderVaultList(); });
    actions.append(fill, del); row.append(title, meta, actions); list.appendChild(row);
  });
}
async function saveVaultItem() {
  const item = { site: $('vaultSite').value, username: $('vaultUser').value, password: $('vaultPass').value, note: $('vaultNote').value };
  const res = await window.hermes.vault.save(item).catch(e => ({ ok: false, error: e.message }));
  if (!res?.ok) { log('vault', res?.error || 'save failed', 'error'); return; }
  ['vaultSite','vaultUser','vaultPass','vaultNote'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  log('vault', res.encryptionAvailable ? 'encrypted save' : 'saved (OS encryption unavailable)');
  renderVaultList();
}
async function openTaskHistory() {
  const list = $('taskHistoryList'); if (!list) return;
  list.replaceChildren();
  let items = [];
  try { items = await window.hermes.taskHistory.list(); } catch {}
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'task-meta'; empty.textContent = '아직 저장된 작업 결과 없음'; list.appendChild(empty); }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'task-item';
    const title = document.createElement('div'); title.className = 'task-title'; title.textContent = item.title || item.goal || 'Task';
    const meta = document.createElement('div'); meta.className = 'task-meta'; meta.textContent = `${item.status || 'done'} · ${(item.tabIds || []).length} tabs · ${new Date(item.updatedAt || item.createdAt).toLocaleString('ko-KR')}`;
    const summary = document.createElement('div'); summary.className = 'task-meta'; summary.textContent = (item.summary || '').replace(/<[^>]+>/g, '').slice(0, 180);
    row.append(title, meta, summary); list.appendChild(row);
  });
  showSheet('tasksModal');
}
async function clearTaskHistory() { await window.hermes.taskHistory.clear(); openTaskHistory(); log('tasks', 'cleared'); }
'''
if extra_funcs not in r:
    r = r.replace(settings_marker, extra_funcs + "\n" + settings_marker)
r = r.replace("{ group: 'data', key: 'history', icon: 'i-history', label: '방문 기록', status: '⌘H', run: () => openHistory() },", "{ group: 'data', key: 'history', icon: 'i-history', label: '방문 기록', status: '⌘H', run: () => openHistory() },\n      { group: 'data', key: 'vault', icon: 'i-lock', label: 'Credential Vault', status: 'encrypted', run: () => openVault() },\n      { group: 'data', key: 'tasks', icon: 'i-list', label: 'Task Artifacts', status: 'results', run: () => openTaskHistory() },")
renderer.write_text(r, encoding='utf-8')

ts = test.read_text(encoding='utf-8')
add = """
assert(main.includes('credentials-vault.enc'), 'credential vault encrypted storage');
assert(main.includes('vault:list') && preload.includes('vault:'), 'credential vault IPC');
assert(main.includes('task-history.json') && preload.includes('taskHistory'), 'task artifact history IPC');
assert(main.includes('browser:markAgentTab') && renderer.includes('Agent Tabs'), 'agent tab marking and grouping');
assert(html.includes('vaultModal') && html.includes('tasksModal'), 'vault and task history UI sheets');
"""
if add not in ts:
    ts = ts.replace("console.log('smoke ok');", add + "\nconsole.log('smoke ok');")
test.write_text(ts, encoding='utf-8')
print('patched aside gap features')
