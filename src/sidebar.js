
// ============ DAY18: Right Sidebar Controller ============
class SidebarController {
  constructor() {
    this.sidebar = document.getElementById('v18Sidebar');
    this.content = document.getElementById('v18SidebarContent');
    this.toggle = document.getElementById('v18ToggleSidebar');
    this.currentTab = 'spaces';
    this.isOpen = false;
    this.attachHandlers();
    this.renderTab('spaces');
    console.log('[DAY18] SidebarController ready');
  }

  attachHandlers() {
    document.querySelectorAll('.v18-sidebar-tab').forEach(tab => {
      tab.onclick = () => this.switchTab(tab.dataset.tab);
    });
    if (this.toggle) {
      this.toggle.onclick = () => this.toggleSidebar();
    }
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const tabIdx = parseInt(e.key) - 1;
        const tabs = document.querySelectorAll('.v18-sidebar-tab');
        if (tabs[tabIdx]) {
          this.open();
          this.switchTab(tabs[tabIdx].dataset.tab);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '9') {
        e.preventDefault();
        this.toggleSidebar();
      }
    });
  }

  toggleSidebar() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.sidebar) this.sidebar.classList.add('open');
    document.body.classList.add('v18-sidebar-open');
    this.isOpen = true;
    this.renderTab(this.currentTab);
  }

  close() {
    if (this.sidebar) this.sidebar.classList.remove('open');
    document.body.classList.remove('v18-sidebar-open');
    this.isOpen = false;
  }

  switchTab(tabKey) {
    this.currentTab = tabKey;
    document.querySelectorAll('.v18-sidebar-tab').forEach(t => {
      if (t.dataset.tab === tabKey) t.classList.add('active');
      else t.classList.remove('active');
    });
    this.renderTab(tabKey);
  }

  renderTab(tabKey) {
    if (!this.content) return;
    switch (tabKey) {
      case 'spaces': this.renderSpaces(); break;
      case 'skills': this.renderSkills(); break;
      case 'memories': this.renderMemories(); break;
      case 'history': this.renderHistory(); break;
      case 'notes': this.renderNotes(); break;
      case 'clips': this.renderClips(); break;
      case 'boosts': this.renderBoosts(); break;
      case 'easels': this.renderEasels(); break;
      case 'livefolders': this.renderLiveFolders(); break;
      case 'brief': this.renderBrief(); break;
      case 'atc': this.renderATC(); break;
      case 'tabgroups': this.renderTabGroups(); break;
      case 'pause': this.renderPause(); break;
      case 'instantlinks': this.renderInstantLinks(); break;
      case 'synthesis': this.renderSynthesis(); break;
      case 'decks': this.renderDecks(); break;
    }
  }

  renderSpaces() {
    if (!window.spacesManager) { this.content.innerHTML = '<div class="v18-empty">SpacesManager 미초기화</div>'; return; }
    const spaces = window.spacesManager.getAllSpaces();
    const current = window.spacesManager.currentSpace;
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">Spaces</span><button class="v18-panel-action" onclick="window.sidebarController.open(); window.showV22Toast && showV22Toast('새 Space 추가 (Premium)', 'info')">+ 추가</button></div>` + 
      spaces.map(s => {
        const isActive = s.key === current;
        const accent = s.color || '#3b82f6';
        return `<div class="v18-item" style="border-left: 3px solid ${accent}; ${isActive ? 'background: var(--gold-soft);' : ''}" onclick="window.spacesManager.switchSpace('${s.key}'); window.sidebarController.renderSpaces()"><div class="v18-item-title">${s.icon} ${s.name}${isActive ? ' (active)' : ''}</div><div class="v18-item-meta">${s.description || ''}</div></div>`;
      }).join('') +
      `<div style="margin-top:12px; padding:8px; background:var(--gold-soft); border-radius:var(--r-sm); font-size:11px;">💡 <kbd>Cmd+1</kbd>으로 빠르게 전환</div>`;
  }

  renderSkills() {
    if (!window.skillsManager) { this.content.innerHTML = '<div class="v18-empty">SkillsManager 미초기화</div>'; return; }
    const skills = window.skillsManager.list();
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">⚡ Skills (8)</span><button class="v18-panel-action" onclick="window.showV22Toast && showV22Toast('Cmd+K → /skill 입력으로 실행', 'info')">⌨ 실행</button></div>` +
      skills.map(s => `<div class="v18-item" onclick="window.skillsManager.execute('${s.command}').then(() => window.sidebarController.renderSkills());"><div class="v18-item-title">${s.icon} ${s.name}</div><div class="v18-item-meta">${s.command} · ${s.category}</div><div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">${s.description}</div></div>`).join('');
  }

  renderMemories() {
    if (!window.browserMemories) { this.content.innerHTML = '<div class="v18-empty">BrowserMemories 미초기화</div>'; return; }
    const recent = window.browserMemories.getRecent(20);
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">🧠 Memories</span><button class="v18-panel-action" onclick="window.browserMemories.clear(); window.sidebarController.renderMemories()">Clear</button></div>` +
      (recent.length === 0 ? '<div class="v18-empty">방문 기록이 없습니다</div>' :
        recent.map(m => `<div class="v18-item" onclick="window.aiOmnibox && window.aiOmnibox.navigate('${m.url}')"><div class="v18-item-title">${(m.title || m.url).substring(0, 50)}</div><div class="v18-item-meta">${m.domain} · ${m.space}</div></div>`).join(''));
  }

  renderHistory() {
    if (!window.betterHistory) { this.content.innerHTML = '<div class="v18-empty">BetterHistory 미초기화</div>'; return; }
    const cats = window.betterHistory.getCategories();
    const recent = window.betterHistory.search('').slice(0, 15);
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">📜 History</span><button class="v18-panel-action" onclick="window.betterHistory.clear(); window.sidebarController.renderHistory()">Clear</button></div><div style="margin-bottom:12px; padding:8px; background:var(--gold-soft); border-radius:var(--r-sm); font-size:11px;"><b>Categories:</b> ${cats.map(c => c[0] + '(' + c[1] + ')').join(', ')}</div>` +
      (recent.length === 0 ? '<div class="v18-empty">방문 기록이 없습니다</div>' :
        recent.map(h => `<div class="v18-item" onclick="window.aiOmnibox && window.aiOmnibox.navigate('${h.url}')"><div class="v18-item-title">${(h.title || h.url).substring(0, 50)}</div><div class="v18-item-meta">${h.category} · ${h.domain}</div></div>`).join(''));
  }

  renderNotes() {
    if (!window.notesManager) { this.content.innerHTML = '<div class="v18-empty">NotesManager 미초기화</div>'; return; }
    const notes = window.notesManager.notes;
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">📝 Notes</span><button class="v18-panel-action" onclick="const n = window.notesManager.create('New Note', ''); window.sidebarController.renderNotes()">+ 새 노트</button></div>` +
      (notes.length === 0 ? '<div class="v18-empty">노트가 없습니다</div>' :
        notes.slice(0, 20).map(n => `<div class="v18-item"><div class="v18-item-title">${(n.title || 'Untitled').substring(0, 50)}</div><div class="v18-item-meta">${(n.tags || []).join(', ') || 'no tags'}</div><div style="font-size:11px; color:var(--text-secondary); margin-top:4px; max-height:60px; overflow:hidden;">${(n.content || '').substring(0, 100)}</div></div>`).join(''));
  }

  renderClips() {
    if (!window.webClipper) { this.content.innerHTML = '<div class="v18-empty">WebClipper 미초기화</div>'; return; }
    const clips = window.webClipper.clips.slice().reverse().slice(0, 20);
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">✂ Clips</span><button class="v18-panel-action" onclick="window.webClipper.clipSelection(); window.sidebarController.renderClips()">+ 선택 텍스트</button></div>` +
      (clips.length === 0 ? '<div class="v18-empty">클립이 없습니다. 텍스트 선택 후 <kbd>Cmd+Shift+S</kbd></div>' :
        clips.map(c => `<div class="v18-item"><div class="v18-item-title">${(c.title || 'Untitled').substring(0, 40)}</div><div class="v18-item-meta">${(c.tags || []).join(', ')}</div><div style="font-size:11px; color:var(--text-secondary); margin-top:4px; max-height:60px; overflow:hidden;">${(c.text || '').substring(0, 100)}</div></div>`).join(''));
  }

  renderBoosts() {
    if (!window.boostsManager) { this.content.innerHTML = '<div class="v18-empty">BoostsManager 미초기화</div>'; return; }
    const boosts = window.boostsManager.boosts;
    const presets = window.boostsManager.getPresets();
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">🎨 Boosts</span><button class="v18-panel-action" onclick="window.boostsManager.applyPreset(window.boostsManager.getPresets()[0]); window.sidebarController.renderBoosts()">+ Preset</button></div>` +
      (boosts.length === 0 ? '<div class="v18-empty">Boost 없음</div>' :
        boosts.map(b => `<div class="v18-item"><div class="v18-item-title">${b.name}</div><div class="v18-item-meta">${b.domain} · ${b.enabled ? 'ON' : 'OFF'}</div><button onclick="window.boostsManager.toggle('${b.id}'); window.sidebarController.renderBoosts()" style="font-size:10px; padding:2px 6px; margin-top:4px;">Toggle</button></div>`).join('')) +
      `<div style="margin-top:12px; padding:8px; background:var(--bg-elevated); border-radius:var(--r-sm); font-size:11px;"><b>Presets:</b><br>${presets.map(p => '• ' + p.name + ' (' + (p.domain || 'all') + ')').join('<br>')}</div>`;
  }

  renderEasels() {
    if (!window.easelManager) { this.content.innerHTML = '<div class="v18-empty">EaselManager 미초기화</div>'; return; }
    const easels = window.easelManager.easels;
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">🖼 Easels</span><button class="v18-panel-action" onclick="window.easelManager.captureCurrentPage(window.easelManager.create('Capture').id); window.sidebarController.renderEasels()">📷 캡처</button></div>` +
      (easels.length === 0 ? '<div class="v18-empty">Easel 없음</div>' :
        easels.map(e => `<div class="v18-item"><div class="v18-item-title">${e.name}</div><div class="v18-item-meta">${e.items.length}개 항목</div></div>`).join(''));
  }

  renderLiveFolders() {
    if (!window.liveFoldersManager) { this.content.innerHTML = '<div class="v18-empty">LiveFoldersManager 미초기화</div>'; return; }
    const folders = window.liveFoldersManager.folders;
    const presets = window.liveFoldersManager.getPresets();
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">📡 Live Folders</span><button class="v18-panel-action" onclick="window.liveFoldersManager.create(window.liveFoldersManager.getPresets()[0].name, window.liveFoldersManager.getPresets()[0].source, 'rss'); window.sidebarController.renderLiveFolders()">+ RSS</button></div>` +
      (folders.length === 0 ? '<div class="v18-empty">Folder 없음</div>' :
        folders.map(f => `<div class="v18-item" onclick="window.liveFoldersManager.fetchFolder('${f.id}').then(() => window.sidebarController.renderLiveFolders())"><div class="v18-item-title">📡 ${f.name}</div><div class="v18-item-meta">${f.items.length}개 · ${f.type}</div></div>`).join('')) +
      `<div style="margin-top:12px; padding:8px; background:var(--bg-elevated); border-radius:var(--r-sm); font-size:11px;"><b>Available:</b><br>${presets.slice(0, 6).map(p => '• ' + p.name).join('<br>')}</div>`;
  }

  renderBrief() {
    if (!window.morningBriefManager) { this.content.innerHTML = '<div class="v18-empty">MorningBriefManager 미초기화</div>'; return; }
    const brief = window.morningBriefManager.lastBrief;
    if (!brief) { this.content.innerHTML = '<div class="v18-empty">Brief 생성 중...</div>'; return; }
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">☀ Morning Brief</span><button class="v18-panel-action" onclick="window.morningBriefManager.generateBrief().then(() => window.sidebarController.renderBrief())">새로고침</button></div>` +
      `<div class="v18-item"><div class="v18-item-title">${brief.greeting}</div><div class="v18-item-meta">${brief.summary.eventsCount} meetings · ${brief.summary.unreadEmails} unread · ${brief.summary.tasksToday} tasks</div></div>` +
      `<div style="font-weight:700; margin: 8px 0 4px; font-size:11px;">📅 Events</div>` +
      brief.events.map(e => `<div class="v18-item"><div class="v18-item-title">${e.start}-${e.end} ${e.title}</div></div>`).join('') +
      `<div style="font-weight:700; margin: 8px 0 4px; font-size:11px;">✉ Emails (${brief.emails.filter(e => e.unread).length} unread)</div>` +
      brief.emails.slice(0, 5).map(em => `<div class="v18-item"><div class="v18-item-title">${em.subject}</div><div class="v18-item-meta">${em.from}</div></div>`).join('') +
      `<div style="font-weight:700; margin: 8px 0 4px; font-size:11px;">📋 Tasks</div>` +
      brief.tasks.slice(0, 5).map(t => `<div class="v18-item"><div class="v18-item-title">${t.title}</div><div class="v18-item-meta">${t.priority} · ${t.due}</div></div>`).join('') +
      (brief.insights && brief.insights.length > 0 ? `<div style="margin-top:12px; padding:8px; background:var(--gold-soft); border-radius:var(--r-sm); font-size:11px;">${brief.insights.map(i => '💡 ' + i).join('<br>')}</div>` : '');
  }

  renderATC() {
    if (!window.atcManager) { this.content.innerHTML = '<div class="v18-empty">ATC 미초기화</div>'; return; }
    const routes = window.atcManager.routes;
    const presets = window.atcManager.getPresets();
    this.content.innerHTML = `<div class="v18-panel-header"><span class="v18-panel-title">✈ ATC Routes</span><button class="v18-panel-action" onclick="window.showV22Toast && showV22Toast('새 라우트 추가 UI는 다음 업데이트', 'info')">+ 라우트</button></div>` +
      (routes.length === 0 ? '<div class="v18-empty">라우트 없음</div>' :
        routes.map(r => `<div class="v18-item"><div class="v18-item-title">${r.pattern}</div><div class="v18-item-meta">→ ${r.spaceKey}</div></div>`).join('')) +
      `<div style="margin-top:12px; padding:8px; background:var(--bg-elevated); border-radius:var(--r-sm); font-size:11px;"><b>Presets:</b><br>${presets.map(p => '• ' + p.pattern + ' → ' + p.spaceKey).join('<br>')}</div>`;
  }
}

let sidebarController;
window.sidebarController = null;

function initV18Sidebar() {
  sidebarController = new SidebarController();
  window.sidebarController = sidebarController;
  console.log('[DAY18] Sidebar ready - 11 tabs');
}

window.initV18Sidebar = initV18Sidebar;
window.SidebarController = SidebarController;
console.log('[DAY18] SidebarController module ready');
