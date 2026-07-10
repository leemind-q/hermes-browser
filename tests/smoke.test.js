// Miraecle smoke test — checks all 4 source files for V5 features
const fs = require('fs');
const path = require('path');
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const files = {
  html: fs.readFileSync(path.join(__dirname, '..', 'src', 'chrome.html'), 'utf8'),
  renderer: fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8'),
  preload: fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8'),
  main: fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'),
};
const { html, renderer, preload, main } = files;
// Files for assertion (main.js is now ~537 lines; agent logic moved to src/agent/)
const agentAll = ['mode.js', 'safety.js', 'plan.js', 'approval.js', 'persistence.js', 'extraction.js', 'actions.js', 'index.js']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'agent', f), 'utf8')).join('\n');


// File validity
assert(html.includes('Miraecle'), 'brand must be Miraecle');
assert(renderer.includes('DOMContentLoaded'), 'renderer must bind init');
assert(preload.includes('contextBridge'), 'preload must use contextBridge');
assert(main.includes('createWindow'), 'main must create window');

// UI layout
assert(html.includes('floating-panel'), 'sidebars must be floating');
assert(html.includes('browser-frame'), 'rounded browser frame');
assert(main.includes('setBorderRadius'), 'native WebContentsView border radius API');
assert(!html.includes('corner-mask'), 'corner-mask hack must be removed');
assert(html.includes('inline-approval'), 'inline approval in chat area');
assert(html.includes('autoApproveToggle'), 'auto-approve toggle in settings');
assert(html.includes('virtual-cursor'), 'virtual cursor element');
assert(html.includes('Inter'), 'Inter font');
assert(html.includes('Plus+Jakarta+Sans'), 'Jakarta font');
assert(html.includes('--left: 144px'), 'left panel compact 144px');
assert(html.includes('--right: 248px'), 'right panel compact 248px');
assert(!html.includes('readModeBtn'), 'reading mode moved out of toolbar');
assert(html.includes('nav-group'), 'nav-group separated from address');
assert(html.includes('tool-group'), 'tool-group separated from address');
assert(html.includes('top-actions'), 'new tab/settings isolated no-drag action group');
assert(html.includes('settings-popover'), 'settings must use anchored popover');
assert(html.includes('settingsQuickList'), 'settings quick menu container');
assert(html.includes('settingsDisplayList'), 'settings display menu container');
assert(html.includes('settingsDataList'), 'settings data menu container');
assert(html.includes('icon-sprite'), 'unified SVG icon sprite');
assert(html.includes('ui-icon'), 'unified SVG icon class');
assert(!/[🔍📖🌙🍪⬇⏱⚙📌📍]/u.test(html), 'toolbar must not use emoji icons');
assert(!/[📌📍⏳]/u.test(renderer), 'tab UI must not use emoji pin/loading');
assert(preload.includes('pinTab'), 'pin tab IPC');
assert(preload.includes('toggleReadMode'), 'read mode IPC');
assert(main.includes('pinTab'), 'pin tab handler');
assert(main.includes('toggleReadMode'), 'read mode handler');
assert(renderer.includes('SettingsPopover'), 'settings popover component');
assert(renderer.includes('pinBtn'), 'pin button in tab render');
assert(renderer.includes('settingsDisplayList'), 'display settings binding');
assert(renderer.includes('menuConfig'), 'settings menu array config');
assert(!html.includes('darkModeBtn'), 'dark mode moved into settings popover');
assert(!html.includes('zoomInBtn') && !html.includes('zoomOutBtn'), 'zoom toolbar buttons removed');
assert(preload.includes('toggleDarkMode'), 'dark mode IPC');
assert(preload.includes('dismissCookieConsent'), 'cookie IPC');
assert(preload.includes('saveSession'), 'session save IPC');
assert(preload.includes('restoreSession'), 'session restore IPC');
assert(main.includes('toggleDarkMode'), 'dark mode handler');
assert(main.includes('dismissCookieConsent'), 'cookie handler');
assert(main.includes('saveSession'), 'session save handler');
assert(main.includes('session.json'), 'session persistence');
assert(html.includes('.18s ease-out'), 'Arc-like fast animation');
assert(!html.includes('settingsModal'), 'settings side sheet removed');
assert(html.includes('mentionBar'), '@mention bar must exist');
assert(html.includes('--glass-bg'), 'glass material token missing');
assert(html.includes('--glass-edge-light'), 'glass edge light token missing');
assert(html.includes('--glass-inner-highlight'), 'glass inner highlight token missing');
assert(html.includes('--glass-refraction-cyan'), 'glass refraction cyan token missing');
assert(html.includes('--glass-refraction-violet'), 'glass refraction violet token missing');
assert(html.includes('--glass-pop-blur'), 'popover glass blur token missing');
assert(html.includes('--radius-app-shell'), 'radius-app-shell token missing');
assert(html.includes('--radius-browser-bezel'), 'radius-browser-bezel token missing');
assert(html.includes('--radius-webview'), 'radius-webview token missing');
assert(html.includes('--radius-sidebar'), 'radius-sidebar token missing');
assert(html.includes('--radius-card'), 'radius-card token missing');
assert(html.includes('--radius-control'), 'radius-control token missing');
assert(html.includes('--glass-edge-light'), 'glass edge light token missing');
assert(html.includes('--glass-edge-dark'), 'glass edge dark token missing');
assert(html.includes('--glass-bg-strong'), 'glass bg strong token missing');
assert(html.includes('--glass-inner-shadow'), 'glass inner shadow token missing');
assert(html.includes('--rail-w'), 'rail width token missing');
assert(html.includes('left-rail'), 'left rail element missing');

// Browser basics
assert(html.includes('findBtn'), 'find-in-page button');
assert(!html.includes('zoomInBtn') && !html.includes('zoomOutBtn'), 'zoom buttons removed');
assert(!html.includes('downloadsBtn'), 'downloads moved to settings popover');
assert(!html.includes('historyBtn'), 'history moved to settings popover');
assert(!html.includes('printBtn'), 'print moved to settings popover');
assert(html.includes('leftToggle'), 'left panel toggle');
assert(html.includes('rightToggle'), 'right panel toggle');
assert(html.includes('favToggle'), 'favorites toggle');

// Plan
assert(html.includes('planToggle'), 'plan toggle');
assert(html.includes('plan-card:not(.expanded) .plan { display: none; }'), 'plan collapsed must hide all steps');

// Animations
assert(html.includes('slideUpFade'), 'message slide up');
assert(html.includes('scaleOut'), 'exit animation');
assert(html.includes('scaleIn'), 'scale in');
assert(html.includes('scaleOut'), 'scale out');
assert(html.includes('panelSlideRightOut'), 'side sheet close animation');
assert(html.includes('popoverIn'), 'popover open animation');
assert(html.includes('popoverOut'), 'popover close animation');

// Panel toggle — no transform conflict
assert(!html.includes('transform: translateY(-50%);'), 'toggle must not use conflicting transform');

// Preload API
assert(preload.includes('findInPage'), 'findInPage');
assert(preload.includes('toggleLeftPanel'), 'toggle left');
assert(preload.includes('toggleRightPanel'), 'toggle right');
assert(!preload.includes('browser:zoom'), 'old zoom IPC removed'); // zoom is now under 'zoom:' namespace
assert(preload.includes('getDownloads'), 'downloads');
assert(preload.includes('getHistory'), 'history');
assert(preload.includes('print'), 'print');
assert(preload.includes('viewSource'), 'view source');
assert(preload.includes('devTools'), 'dev tools');
assert(preload.includes('reorderTabs'), 'tab reorder');
assert(preload.includes('onDownloadUpdated'), 'download events');
assert(preload.includes('onLayoutState'), 'layout events');

// Renderer — AI Agent
assert(renderer.includes('runLLMAgent'), 'LLM agent pipeline');
assert(renderer.includes('callOpenAICompatible'), 'API call function');
assert(renderer.includes('parseActionFromResponse'), 'action parsing from LLM');
assert(renderer.includes('actionHistory'), 'loop detection');
assert(renderer.includes('MAX_FAILURES'), 'failure threshold');
assert(renderer.includes('MAX_STEPS'), 'max steps limit');
assert(renderer.includes('appendEpisodeMemory'), 'auto memory');
assert(renderer.includes('hideSheet'), 'animated sheet hide');
assert(renderer.includes('handleGlobalShortcuts'), 'keyboard shortcuts');
assert(renderer.includes('SettingsPopover') && renderer.includes('outsideCleanup'), 'settings popover outside-click cleanup');
assert(renderer.includes("e.key === 'Escape'"), 'ESC closes popover');
assert(renderer.includes('renderMentionBar'), '@mention UI');
assert(renderer.includes('draggable = true'), 'tab drag');
assert(renderer.includes('collapsedGroups'), 'tab group collapse');

// Main — IPC
assert(main.includes('findInPage'), 'find in page');
assert(!main.includes('browser:zoom'), 'old zoom handler removed'); // zoom handlers now under 'zoom:' namespace
assert(main.includes('will-download'), 'downloads');
assert(main.includes('toggleLeftPanel'), 'left panel IPC');
assert(main.includes('toggleRightPanel'), 'right panel IPC');
assert(agentAll.includes('searchWeb') || main.includes('searchWeb'), 'search web action');
assert(main.includes('browser:viewSource'), 'view source');
assert(main.includes('browser:devTools'), 'devtools');
assert(main.includes('browser:reorderTabs'), 'tab reorder');

// === Phase 1: Agentic features ===
assert(agentAll.includes('MODE_PERMISSIONS'), 'mode permissions system');
assert(agentAll.includes('ACTION_RISK'), 'action risk classification');
assert(agentAll.includes('createStructuredAction'), 'structured action objects');
assert(agentAll.includes('detectInjection'), 'prompt injection detection');
assert(agentAll.includes('INJECTION_PATTERNS'), 'injection patterns list');
assert(agentAll.includes('PlanState') || agentAll.includes('updatePlanState'), 'plan state management');
assert(agentAll.includes('setStepStatus') || agentAll.includes('setPlanStepStatus'), 'plan step status updates');
assert(agentAll.includes('extractTabContext'), 'per-tab context extraction');
assert(agentAll.includes('getAllTabContexts'), 'all tab contexts');
assert(agentAll.includes('getMultiTabContexts'), 'multi-tab deep contexts');
assert(main.includes('agent:setMode'), 'agent setMode IPC');
assert(main.includes('agent:getPlan'), 'agent getPlan IPC');
assert(main.includes('agent:setPlan'), 'agent setPlan IPC');
assert(main.includes('agent:pausePlan'), 'agent pausePlan IPC');
assert(main.includes('agent:checkInjection'), 'injection check IPC');
assert(main.includes('browser:getTabContext'), 'tab context IPC');
assert(main.includes('browser:getAllTabContexts'), 'all tab contexts IPC');
assert(main.includes('browser:getMultiTabContexts'), 'multi-tab contexts IPC');
assert(agentAll.includes('loginRequired') || main.includes('loginRequired'), 'login form detection');
assert(agentAll.includes('hasCaptcha') || main.includes('hasCaptcha'), 'captcha detection');
assert(agentAll.includes('hasCookieBanner') || main.includes('hasCookieBanner'), 'cookie banner detection');
assert(preload.includes('agent:'), 'agent API in preload');
assert(preload.includes('multiTab'), 'multiTab API in preload');
assert(preload.includes('onPlanState'), 'plan state event');
assert(preload.includes('onModeChanged'), 'mode changed event');
assert(preload.includes('onInjectionWarning'), 'injection warning event');
assert(renderer.includes('onPlanState'), 'renderer plan state handler');
assert(renderer.includes('onModeChanged'), 'renderer mode changed handler');
assert(renderer.includes('onInjectionWarning'), 'renderer injection warning handler');
assert(renderer.includes('renderPlanFromState'), 'plan render from state');
assert(renderer.includes('updateModeBadge'), 'mode badge update');
assert(renderer.includes('toggleGoalEdit'), 'goal edit toggle');
assert(renderer.includes('summarizePage'), 'page summary function');
assert(renderer.includes('startResearch'), 'research function');
assert(renderer.includes('checkInjection'), 'renderer injection check');
assert(html.includes('modeBadge'), 'mode badge element');
assert(html.includes('goalEditInput'), 'goal edit input element');
assert(html.includes('data-action="summary"'), 'summary button action');
assert(html.includes('data-action="research"'), 'research button action');
assert(html.includes('step-controls'), 'plan step controls CSS');
assert(html.includes('step-btn'), 'plan step button CSS');
assert(html.includes('step.failed'), 'failed step CSS');
assert(html.includes('step.approval'), 'approval step CSS');

// === Phase 2: Action agent ===
assert(agentAll.includes('clickElement'), 'enhanced click with retry');
assert(agentAll.includes('fillElement'), 'enhanced fill with retry');
assert(agentAll.includes('highlightElement'), 'element highlight');
assert(agentAll.includes('findElementByText'), 'text-based element finder');
assert(agentAll.includes('findElementByRef'), 'ref-based element finder');
assert(agentAll.includes('retryExhausted'), 'retry exhaustion flag');
assert(agentAll.includes('riskLevel') || main.includes('riskLevel'), 'risk level in approval');
assert(agentAll.includes('reversible') || main.includes('reversible'), 'reversibility flag in action log');
assert(main.includes('agent:pause'), 'pause IPC');
assert(main.includes('agent:resume'), 'resume IPC');
assert(main.includes('agent:undoAction'), 'undo IPC');
assert(main.includes('agent:getActionLog'), 'action log IPC');
assert(preload.includes('pause'), 'pause in preload');
assert(preload.includes('resume'), 'resume in preload');
assert(preload.includes('undoAction'), 'undoAction in preload');
assert(preload.includes('getActionLog'), 'getActionLog in preload');
assert(renderer.includes('pauseAgent'), 'pauseAgent function');
assert(renderer.includes('resumeAgent'), 'resumeAgent function');
assert(renderer.includes('toggleActionLog'), 'action log toggle');
assert(renderer.includes('updateExecBar'), 'exec bar updater');
assert(renderer.includes('risk-${'), 'risk-colored approval template');
assert(renderer.includes('risk-${'), 'risk-colored approval high');
assert(html.includes('exec-bar'), 'execution bar CSS');
assert(html.includes('execBar'), 'execution bar element');
assert(html.includes('pauseBtn'), 'pause button');
assert(html.includes('resumeBtn'), 'resume button');
assert(html.includes('logBtn'), 'log button');
assert(html.includes('action-log-popover'), 'action log popover CSS');
assert(html.includes('actionLogPopover'), 'action log popover element');
assert(html.includes('actionLogList'), 'action log list element');
assert(html.includes('risk-low'), 'risk-low CSS');
assert(html.includes('risk-medium'), 'risk-medium CSS');
assert(html.includes('risk-high'), 'risk-high CSS');
assert(html.includes('log-undo'), 'undo button CSS');

// === Phase 3: Workspace, auto-grouping, research ===
assert(main.includes('workspace:save'), 'workspace save IPC');
assert(main.includes('workspace:list'), 'workspace list IPC');
assert(main.includes('workspace:restore'), 'workspace restore IPC');
assert(main.includes('workspace:delete'), 'workspace delete IPC');
assert(main.includes('browser:autoGroupTabs'), 'auto group tabs IPC');
assert(main.includes('research:openResult'), 'research result IPC');
assert(main.includes('autoGroupTabs'), 'auto grouping function');
assert(preload.includes('workspace'), 'workspace API in preload');
assert(preload.includes('research'), 'research API in preload');
assert(preload.includes('autoGroupTabs'), 'autoGroupTabs in preload');
assert(renderer.includes('saveWorkspace'), 'saveWorkspace function');
assert(renderer.includes('restoreWorkspace'), 'restoreWorkspace function');
assert(renderer.includes('listWorkspaces'), 'listWorkspaces function');
assert(renderer.includes('deleteWorkspace'), 'deleteWorkspace function');
assert(renderer.includes('autoGroupTabs'), 'auto group in renderer');
assert(html.includes('saveWorkspaceBtn'), 'save workspace button');
assert(html.includes('Workspace'), 'workspace section');

// === Phase 4: Session memory + Skills ===
assert(main.includes('memory:getSession'), 'session memory get IPC');
assert(main.includes('memory:addSession'), 'session memory add IPC');
assert(main.includes('memory:removeSession'), 'session memory remove IPC');
assert(main.includes('memory:clearSession'), 'session memory clear IPC');
assert(main.includes('skill:save'), 'skill save IPC');
assert(main.includes('skill:list'), 'skill list IPC');
assert(main.includes('skill:get'), 'skill get IPC');
assert(main.includes('skill:delete'), 'skill delete IPC');
assert(main.includes('skill:updateResult'), 'skill updateResult IPC');
assert(preload.includes('sessionMemory'), 'sessionMemory API in preload');
assert(preload.includes('skill'), 'skill API in preload');
assert(renderer.includes('createSkillFromPrompt'), 'skill creation from prompt');
assert(renderer.includes('runSkill'), 'runSkill function');
assert(renderer.includes('listSkills'), 'listSkills function');
assert(renderer.includes('deleteSkill'), 'deleteSkill function');
assert(renderer.includes('sessionMemory'), 'session memory in renderer');
assert(html.includes('data-type="session"'), 'session memory row');

// === Phase 5: Voice, file, inline AI ===
assert(main.includes('browser:injectInlineAI'), 'inline AI injection IPC');
assert(main.includes('browser:removeInlineAI'), 'inline AI removal IPC');
assert(main.includes('file:readContent'), 'file read IPC');
assert(main.includes('hermes-ai-menu'), 'inline AI menu in page');
assert(main.includes('hermes-ai-btn'), 'inline AI buttons');
assert(preload.includes('inlineAI'), 'inlineAI API in preload');
assert(preload.includes('file'), 'file API in preload');
assert(renderer.includes('toggleVoiceInput'), 'voice input function');
assert(renderer.includes('handleFileAttach'), 'file attach handler');
assert(renderer.includes('toggleInlineAI'), 'inline AI toggle');
assert(renderer.includes('SpeechRecognition'), 'Web Speech API');
assert(html.includes('voiceBtn'), 'voice button');
assert(html.includes('fileBtn'), 'file button');
assert(html.includes('fileInput'), 'file input element');
assert(html.includes('inlineAIToggle'), 'inline AI toggle button');

// === Search Pipeline + Zoom + UA ===
assert(main.includes('DESKTOP_UA'), 'desktop user agent constant');
assert(main.includes('setUserAgent'), 'user agent set on tabs');
assert(agentAll.includes('extractSearchResults'), 'search result extraction');
assert(agentAll.includes('readPageContent'), 'page content reading');
assert(main.includes('search:extractResults'), 'search extract IPC');
assert(main.includes('search:readPage'), 'search read page IPC');
assert(main.includes('search:readUrl'), 'search read URL IPC');
assert(main.includes('zoom:set'), 'zoom set IPC');
assert(main.includes('zoom:get'), 'zoom get IPC');
assert(main.includes('zoom:setDomain'), 'zoom set domain IPC');
assert(main.includes('zoom:reset'), 'zoom reset IPC');
assert(main.includes('zoom:autoFit'), 'zoom auto-fit IPC');
assert(main.includes('diag:webview'), 'diagnostics IPC');
assert(main.includes('domainZoom'), 'domain zoom storage');
assert(main.includes('maximize'), 'maximize event handler');
assert(preload.includes('search'), 'search API in preload');
assert(preload.includes('zoom'), 'zoom API in preload');
assert(preload.includes('diag'), 'diag API in preload');
assert(renderer.includes('searchMode'), 'search mode in renderer');
assert(renderer.includes('searchConfig'), 'search config in renderer');
assert(renderer.includes('searchQueries'), 'search query tracking');
assert(renderer.includes('sourcesRead'), 'source tracking');
assert(renderer.includes('Never search with just one query'), 'multi-query instruction');
assert(renderer.includes('searchModeSelect'), 'search mode select event');
assert(renderer.includes('zoom.reset'), 'zoom reset shortcut');
assert(renderer.includes('zoom.set'), 'zoom set shortcut');
assert(html.includes('searchModeSelect'), 'search mode select element');
assert(html.includes('search-mode-select'), 'search mode CSS');

console.log('smoke ok');
