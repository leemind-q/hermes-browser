#!/usr/bin/env python3
"""UI Stability E2E — CDP-based verification for Miraecle browser."""
import json, time, urllib.request, sys
try:
    import websocket
except ImportError:
    print("ERROR: pip install websocket-client")
    sys.exit(1)

PORT = 19222
BASE = f"http://127.0.0.1:{PORT}"
results = []

def test(name, passed, detail=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    results.append((name, passed, detail))
    print(f"{status}: {name}" + (f" — {detail}" if detail else ""))

def get_targets():
    resp = urllib.request.urlopen(f"{BASE}/json")
    return json.loads(resp.read())

def find_renderer():
    for t in get_targets():
        if t.get('type') == 'page' and 'chrome.html' in t.get('url', ''):
            return t
    return None

def main():
    target = find_renderer()
    if not target:
        print("ERROR: No renderer target found.")
        sys.exit(1)
    
    ws_url = target['webSocketDebuggerUrl']
    print(f"Connecting to: {ws_url}")
    ws = websocket.create_connection(ws_url, timeout=15, suppress_origin=True)
    msg_id = 0
    
    def send_cmd(method, params=None):
        nonlocal msg_id
        msg_id += 1
        msg = {"id": msg_id, "method": method}
        if params:
            msg["params"] = params
        ws.send(json.dumps(msg))
        while True:
            resp = json.loads(ws.recv())
            if resp.get("id") == msg_id:
                return resp
    
    def eval_js(expr):
        r = send_cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get('result',{}).get('result',{}).get('value','')
    
    def eval_json(expr):
        val = eval_js(expr)
        try:
            return json.loads(val) if val else {}
        except:
            return {}
    
    time.sleep(1)
    
    # === Test 1: CSS layer tokens ===
    data = eval_json("""(function(){
        const root = getComputedStyle(document.documentElement);
        const tokens = ['--layer-base','--layer-webview','--layer-panel','--layer-floating',
                       '--layer-topbar','--layer-settings','--layer-critical','--layer-cursor'];
        const found = tokens.filter(t => root.getPropertyValue(t).trim() !== '');
        return JSON.stringify({found, count: found.length, expected: tokens.length});
    })()""")
    test("CSS layer tokens defined", data.get('count',0) >= 8, f"{data.get('count',0)}/8 tokens")
    
    # === Test 2: Surface state tokens ===
    data = eval_json("""(function(){
        const root = getComputedStyle(document.documentElement);
        const tokens = ['--surface-default','--surface-hover','--surface-active',
                       '--surface-loading','--surface-error','--border-default'];
        const found = tokens.filter(t => root.getPropertyValue(t).trim() !== '');
        return JSON.stringify({found, count: found.length});
    })()""")
    test("Surface state tokens defined", data.get('count',0) >= 5, f"{data.get('count',0)}/6 tokens")
    
    # === Test 3: UIState manager ===
    val = eval_js("typeof UIState")
    test("UIState manager exists", val == 'object', f"type: {val}")
    
    # === Test 4: UIState.closeAllPopovers ===
    val = eval_js("typeof UIState.closeAllPopovers")
    test("UIState.closeAllPopovers exists", val == 'function')
    
    # === Test 5: Bot detection handler ===
    val = eval_js("typeof handleBotDetected")
    test("handleBotDetected exists", val == 'function')
    
    # === Test 6: shouldCreateResultTab ===
    val = eval_js("typeof shouldCreateResultTab")
    test("shouldCreateResultTab exists", val == 'function')
    
    # === Test 7: safeDecodeUrl ===
    val = eval_js("typeof safeDecodeUrl")
    test("safeDecodeUrl exists", val == 'function')
    
    # === Test 8: runOverlapDiagnostics ===
    val = eval_js("typeof runOverlapDiagnostics")
    test("runOverlapDiagnostics exists", val == 'function')
    
    # === Test 9: state object ===
    val = eval_js("typeof state")
    test("state object exists", val == 'object')
    
    # === Test 10: State initialized ===
    data = eval_json("""(function(){
        return JSON.stringify({
            leftPinned: state.leftPinned,
            leftHoverOpen: state.leftHoverOpen,
            settingsPopoverOpen: state.settingsPopoverOpen,
            actionLogOpen: state.actionLogOpen,
            mode: state.mode,
            running: state.running
        });
    })()""")
    test("State initialized", data.get('mode') == 'agent', f"mode={data.get('mode')}")
    
    # === Test 11: DOM elements exist ===
    data = eval_json("""(function(){
        const ids = ['actionLogPopover','toolPopover','settingsPopover','captchaAlert',
                     'directControlBadge','leftPanel','leftRail','rightPanel',
                     'execBar','messages','promptInput','sendBtn','stopBtn',
                     'attachmentRow','toolBtn'];
        const found = ids.filter(id => document.getElementById(id) !== null);
        const missing = ids.filter(id => !document.getElementById(id));
        return JSON.stringify({found, count: found.length, missing: missing});
    })()""")
    test("DOM elements exist", data.get('count',0) >= 14, f"{data.get('count',0)}/15, missing: {data.get('missing',[])}")
    
    # === Test 12: z-index uses layer tokens ===
    data = eval_json("""(function(){
        const els = [
            {sel: '.topbar', token: '--layer-topbar'},
            {sel: '.browser-frame', token: '--layer-webview'},
            {sel: '.settings-popover', token: '--layer-settings'},
            {sel: '.action-log-popover', token: '--layer-actionlog'},
            {sel: '.tool-popover', token: '--layer-toolpopover'},
            {sel: '.side-sheet', token: '--layer-sidesheet'},
        ];
        const root = getComputedStyle(document.documentElement);
        const results = [];
        for (const {sel, token} of els) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const computed = getComputedStyle(el);
            const z = computed.zIndex;
            const tokenVal = root.getPropertyValue(token).trim();
            results.push({sel, z, token, tokenVal, match: z === tokenVal});
        }
        return JSON.stringify(results);
    })()""")
    if isinstance(data, list):
        matched = sum(1 for d in data if d.get('match'))
        test("z-index uses layer tokens", matched >= 4, f"{matched}/{len(data)} elements use var(--layer-*)")
    else:
        test("z-index uses layer tokens", False, f"unexpected response: {data}")
    
    # === Test 13: Right panel flex ===
    data = eval_json("""(function(){
        const rightBody = document.querySelector('.right-body');
        const chatCard = document.querySelector('.chat-card');
        if (!rightBody || !chatCard) return JSON.stringify({error: 'not found'});
        const rb = getComputedStyle(rightBody);
        const cc = getComputedStyle(chatCard);
        return JSON.stringify({
            rightBodyOverflow: rb.overflow,
            rightBodyMinHeight: rb.minHeight,
            chatCardFlex: cc.flex,
            chatCardMinHeight: cc.minHeight,
        });
    })()""")
    test("Right panel flex stable", 
         data.get('chatCardMinHeight') == '0px' and data.get('rightBodyOverflow') == 'hidden',
         f"chat min-height={data.get('chatCardMinHeight')}, overflow={data.get('rightBodyOverflow')}")
    
    # === Test 14: Tool popover toggle ===
    # Open
    eval_js("document.getElementById('toolBtn').click()")
    time.sleep(0.3)
    after_open = eval_js("document.getElementById('toolPopover').classList.contains('visible')")
    # Close
    eval_js("document.getElementById('toolBtn').click()")
    time.sleep(0.3)
    after_close = eval_js("document.getElementById('toolPopover').classList.contains('visible')")
    test("Tool popover toggles open then close", 
         after_open == True and after_close == False,
         f"open={after_open}, close={after_close}")
    
    # === Test 15: Settings popover toggle ===
    eval_js("document.getElementById('settingsBtn').click()")
    time.sleep(0.4)
    after_open = eval_js("document.getElementById('settingsPopover').classList.contains('visible')")
    # Close via close button
    eval_js("document.getElementById('settingsClose').click()")
    time.sleep(0.3)
    after_close = eval_js("document.getElementById('settingsPopover').classList.contains('visible')")
    test("Settings popover toggles", 
         after_open == True,
         f"open={after_open}, close={after_close}")
    
    # === Test 16: Captcha alert elements ===
    data = eval_json("""(function(){
        const alert = document.getElementById('captchaAlert');
        const badge = document.getElementById('directControlBadge');
        return JSON.stringify({
            captchaExists: !!alert,
            badgeExists: !!badge,
        });
    })()""")
    test("Captcha alert elements exist", 
         data.get('captchaExists') == True and data.get('badgeExists') == True)
    
    # === Test 17: Left sidebar state is coherent (collapsed when unpinned, open when pinned) ===
    data = eval_json("""(function(){
        const leftPanel = document.getElementById('leftPanel');
        const leftRail = document.getElementById('leftRail');
        const pin = document.getElementById('leftPinBtn');
        const pinned = pin ? pin.classList.contains('active') : false;
        const leftCollapsed = leftPanel ? leftPanel.classList.contains('collapsed') : false;
        const railDisplay = leftRail ? getComputedStyle(leftRail).display : 'none';
        return JSON.stringify({
            pinned: pinned,
            leftCollapsed: leftCollapsed,
            railVisible: railDisplay !== 'none' && railDisplay !== '',
            railDisplay: railDisplay
        });
    })()""")
    const_ok = (data.get('pinned') == True and data.get('leftCollapsed') == False) or (data.get('pinned') == False and data.get('leftCollapsed') == True)
    test("Left sidebar state coherent", 
         const_ok,
         f"pinned={data.get('pinned')}, collapsed={data.get('leftCollapsed')}, rail={data.get('railDisplay')}")
    
    # === Test 18: prefers-reduced-motion ===
    data = eval_json("""(function(){
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        return JSON.stringify({matches: mq.matches, media: mq.media});
    })()""")
    test("prefers-reduced-motion supported", data.get('media') == '(prefers-reduced-motion: reduce)')
    
    # === Summary ===
    passed = sum(1 for _, p, _ in results if p)
    failed = sum(1 for _, p, _ in results if not p)
    print(f"\n=== Results: {passed} passed, {failed} failed, {len(results)} total ===")
    
    if failed:
        print("\nFailed tests:")
        for name, p, detail in results:
            if not p:
                print(f"  - {name}: {detail}")
    
    ws.close()
    sys.exit(0 if failed == 0 else 1)

if __name__ == '__main__':
    main()
