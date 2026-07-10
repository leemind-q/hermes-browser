import json
import time
import urllib.request
import websocket

CDP = 'http://127.0.0.1:9333/json'

def get_ws_url():
    pages = json.loads(urllib.request.urlopen(CDP, timeout=2).read().decode())
    for p in pages:
        if p.get('url','').endswith('/src/chrome.html') or p.get('title') == 'Miraecle':
            return p['webSocketDebuggerUrl']
    raise RuntimeError('Miraecle renderer target not found')

class CDPClient:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.i = 0
    def call(self, method, params=None):
        self.i += 1
        msg = {'id': self.i, 'method': method, 'params': params or {}}
        self.ws.send(json.dumps(msg))
        while True:
            data = json.loads(self.ws.recv())
            if data.get('id') == self.i:
                if 'error' in data:
                    raise RuntimeError(data['error'])
                return data.get('result')
    # Dev-only E2E harness: sends controlled test snippets to Electron renderer via CDP Runtime.evaluate.
    # Not used by the application and never evaluates page/user content.
    def eval(self, expr, await_promise=True):
        res = self.call('Runtime.evaluate', {
            'expression': expr,
            'awaitPromise': await_promise,
            'returnByValue': True,
            'userGesture': True,
        })
        if 'exceptionDetails' in res:
            raise RuntimeError(res['exceptionDetails'])
        return res.get('result', {}).get('value')

c = CDPClient(get_ws_url())
c.call('Runtime.enable')
time.sleep(1)

results = []
def check(name, expr, pred=lambda v: bool(v)):
    v = c.eval(expr)
    ok = pred(v)
    results.append((name, ok, v))
    if not ok:
        raise AssertionError(f'{name} failed: {v!r}')
    return v

# Initial registry must be internally consistent.
check('renderer init complete', "!!window.hermes && !!document.getElementById('app')")
initial = check('diag initial ok', "window.hermes.diag.state()", lambda v: v and v.get('ok') and v.get('tabCount') == v.get('webContentsCount'))

# Hamburger/action log lifecycle: open, same-button close, outside click, ESC.
c.eval("(() => { closeActionLog?.(); const b=document.getElementById('execBar'); b.className='exec-bar running'; b.style.display='flex'; })()")
check('hamburger open', "(() => { document.getElementById('logBtn').dispatchEvent(new MouseEvent('click', {bubbles:true})); return new Promise(resolve => setTimeout(() => resolve(document.getElementById('actionLogPopover').classList.contains('visible')), 160)); })()")
check('hamburger same-button close', "(() => { document.getElementById('logBtn').click(); return new Promise(resolve => setTimeout(() => resolve(!document.getElementById('actionLogPopover').classList.contains('visible')), 80)); })()")
check('hamburger outside close', "(() => { document.getElementById('logBtn').click(); return new Promise(resolve => setTimeout(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); setTimeout(() => resolve(!document.getElementById('actionLogPopover').classList.contains('visible')), 80); }, 120)); })()")
check('hamburger esc close', "(() => { document.getElementById('logBtn').click(); return new Promise(resolve => setTimeout(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); setTimeout(() => resolve(!document.getElementById('actionLogPopover').classList.contains('visible')), 80); }, 120)); })()")

# Floating sidebar default/hover/pin.
check('left default collapsed unless pinned', "(() => { const app=document.getElementById('app'); return app.classList.contains('left-collapsed') || document.getElementById('leftPinBtn').classList.contains('active'); })()")
check('left hover floating open', "(() => { document.getElementById('leftRail').dispatchEvent(new MouseEvent('mouseenter', {bubbles:true})); return document.getElementById('app').classList.contains('left-floating-open'); })()")
time.sleep(0.35)
check('left hover auto close', "(() => { document.getElementById('leftPanel').dispatchEvent(new MouseEvent('mouseleave', {bubbles:true})); return new Promise(resolve => setTimeout(() => resolve(!document.getElementById('app').classList.contains('left-floating-open')), 280)); })()")
check('left pin on', "(() => { document.getElementById('leftPinBtn').click(); return new Promise(resolve => setTimeout(() => resolve(!document.getElementById('app').classList.contains('left-collapsed')), 120)); })()")
check('left pin off', "(() => { document.getElementById('leftPinBtn').click(); return new Promise(resolve => setTimeout(() => resolve(document.getElementById('app').classList.contains('left-collapsed')), 120)); })()")

# Composer layout width and tool popover.
check('composer textarea expanded', "(() => { const t=document.getElementById('promptInput').getBoundingClientRect(); const s=document.getElementById('sendBtn').getBoundingClientRect(); return {textarea:t.width, send:s.width, sendHeight:s.height}; })()", lambda v: v['textarea'] >= 130 and 32 <= v['send'] <= 40 and v['sendHeight'] >= 50)
check('tool popover toggle', "(() => { document.getElementById('toolBtn').click(); const a=document.getElementById('toolPopover').classList.contains('visible'); document.getElementById('toolBtn').click(); const b=!document.getElementById('toolPopover').classList.contains('visible'); return a && b; })()")

# Registry: new tabs create real webContents, switch/close remain 1:1.
before = c.eval("window.hermes.diag.state()")
check('create two tabs 1:1', "(async () => { await window.hermes.browser.newTab('https://example.com'); await window.hermes.browser.newTab('https://example.org'); await new Promise(r=>setTimeout(r,800)); return window.hermes.diag.state(); })()", lambda v: v.get('ok') and v.get('tabCount') == before['tabCount'] + 2 and v.get('tabCount') == v.get('webContentsCount'))
check('switch active tab matches visible view', "(async () => { const d=await window.hermes.diag.state(); const first=d.tabs[0].id; await window.hermes.browser.switchTab(first); await new Promise(r=>setTimeout(r,200)); return window.hermes.diag.state(); })()", lambda v: v.get('ok') and sum(1 for t in v['tabs'] if t['isActive']) == 1 and v['activeTabId'] == v['tabs'][0]['id'])
check('close tab removes webContents', "(async () => { const d=await window.hermes.diag.state(); const closeId=d.tabs[d.tabs.length-1].id; await window.hermes.browser.closeTab(closeId); await new Promise(r=>setTimeout(r,300)); return window.hermes.diag.state(); })()", lambda v: v.get('ok') and v.get('tabCount') == v.get('webContentsCount'))

# Search must show real browser tab and mark AI-created registry tab.
check('search creates visible ai tab', "(async () => { const before=await window.hermes.diag.state(); const r=await window.hermes.browser.action('searchWeb', {query:'Miraecle browser state registry test', engine:'google', createdBy:'ai'}); await new Promise(res=>setTimeout(res,1000)); const d=await window.hermes.diag.state(); return {ok:r.ok && d.ok, result:r, diag:d, before:before.tabCount}; })()", lambda v: v['ok'] and v['diag']['tabCount'] == v['before'] + 1 and any(t['createdBy']=='ai' and t['isActive'] for t in v['diag']['tabs']))

# Workspace save writes a file and restore keeps registry coherent.
ws = check('workspace save real path', "(async () => { const r=await window.hermes.workspace.save('E2E State Registry', 'E2E Goal', ['검색 계획','자료 수집'], {tabGroups:[], sources:[], chat:[]}); return r; })()", lambda v: v and v.get('ok') and v.get('path') and v.get('tabs'))
check('workspace restore coherent', f"(async () => {{ const r=await window.hermes.workspace.restore('{ws['id']}'); await new Promise(res=>setTimeout(res,800)); const d=await window.hermes.diag.state(); return {{restore:r, diag:d}}; }})()", lambda v: v['restore'].get('ok') and v['diag'].get('ok') and v['diag']['tabCount'] == v['diag']['webContentsCount'])

print(json.dumps({'ok': True, 'checks': [{'name': n, 'ok': ok, 'value': val} for n, ok, val in results]}, ensure_ascii=False, indent=2))
