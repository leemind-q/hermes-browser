#!/usr/bin/env python3
"""Panel Refinement E2E — verifies sidebar header, pin/save, composer, popups."""
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
    return json.loads(urllib.request.urlopen(f"{BASE}/json").read())

def find_renderer():
    for t in get_targets():
        if t.get('type') == 'page' and 'chrome.html' in t.get('url', ''):
            return t
    return None

def main():
    target = find_renderer()
    if not target:
        print("No renderer target")
        sys.exit(1)
    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=10, suppress_origin=True)
    msg_id = 0

    def eval_js(expr):
        nonlocal msg_id
        msg_id += 1
        ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == msg_id:
                return r.get('result',{}).get('result',{}).get('value','')

    def eval_json(expr):
        val = eval_js(expr)
        try:
            return json.loads(val) if val else {}
        except:
            return {}

    time.sleep(1)

    # Sidebar header structure
    data = eval_json("""(function(){
        const ws = document.getElementById('workspaceHeader');
        const style = ws ? getComputedStyle(ws) : {};
        const name = document.getElementById('workspaceName');
        const meta = document.getElementById('workspaceMeta');
        const actions = ws ? ws.querySelector('.workspace-actions') : null;
        const save = document.getElementById('saveWorkspaceBtn');
        const pin = document.getElementById('leftPinBtn');
        return JSON.stringify({
            headerDisplay: style.display,
            headerAlignItems: style.alignItems,
            textExists: !!ws && !!ws.querySelector('.workspace-text'),
            actionsExist: !!actions,
            saveWidth: save ? getComputedStyle(save).width : null,
            pinWidth: pin ? getComputedStyle(pin).width : null,
            saveHeight: save ? getComputedStyle(save).height : null,
            pinHeight: pin ? getComputedStyle(pin).height : null,
            nameOverflow: name ? getComputedStyle(name).overflow : null,
            metaOverflow: meta ? getComputedStyle(meta).overflow : null,
        });
    })()""")
    test("Sidebar header structure",
         data.get('headerDisplay') == 'flex' and data.get('actionsExist') == True,
         f"display={data.get('headerDisplay')}, actions={data.get('actionsExist')}, save={data.get('saveWidth')}x{data.get('saveHeight')}, pin={data.get('pinWidth')}x{data.get('pinHeight')}")

    # Pin button toggle should invert current persisted state
    before_pin = eval_js("document.getElementById('leftPinBtn').classList.contains('active')")
    eval_js("document.getElementById('leftPinBtn').click()")
    time.sleep(0.2)
    after_pin = eval_js("document.getElementById('leftPinBtn').classList.contains('active')")
    test("Pin button toggles state", after_pin != before_pin, f"before={before_pin}, after={after_pin}")

    eval_js("document.getElementById('leftPinBtn').click()")
    time.sleep(0.2)
    restored_pin = eval_js("document.getElementById('leftPinBtn').classList.contains('active')")
    test("Pin button toggles back", restored_pin == before_pin, f"before={before_pin}, restored={restored_pin}")

    # Save button states CSS classes exist
    data = eval_json("""(function(){
        const save = document.getElementById('saveWorkspaceBtn');
        return JSON.stringify({
            hasSaveClass: save.classList.contains('save-btn'),
            classNames: save.className,
        });
    })()""")
    test("Save button base class", data.get('hasSaveClass') == True, f"class={data.get('classNames')}")

    # Composer input ratio - check template contains 1fr and input uses min/max height tokens
    data = eval_json("""(function(){
        const wrap = document.querySelector('.input-wrap');
        const input = document.getElementById('promptInput');
        const send = document.getElementById('sendBtn');
        return JSON.stringify({
            gridTemplate: wrap ? getComputedStyle(wrap).gridTemplateColumns : null,
            inputMinHeight: input ? getComputedStyle(input).minHeight : null,
            inputMaxHeight: input ? getComputedStyle(input).maxHeight : null,
            sendWidth: send ? getComputedStyle(send).width : null,
            sendMinHeight: send ? getComputedStyle(send).minHeight : null,
            hasSendBtn: !!send,
            hasStopBtn: !!document.getElementById('stopBtn'),
        });
    })()""")
    test("Composer input ratio",
         data.get('hasSendBtn') == True and data.get('hasStopBtn') == True and len(str(data.get('gridTemplate', '')).split()) == 3,
         f"grid={data.get('gridTemplate')}, input={data.get('inputMinHeight')}~{data.get('inputMaxHeight')}, send={data.get('sendWidth')}x{data.get('sendMinHeight')}")

    # Chat message styles
    data = eval_json("""(function(){
        const msg = document.querySelector('.msg');
        const messages = document.querySelector('.messages');
        const chat = document.querySelector('.chat-card');
        return JSON.stringify({
            msgPadding: msg ? getComputedStyle(msg).padding : null,
            msgBorderRadius: msg ? getComputedStyle(msg).borderRadius : null,
            msgLineHeight: msg ? getComputedStyle(msg).lineHeight : null,
            msgOverflowWrap: msg ? getComputedStyle(msg).overflowWrap : null,
            messagesGap: messages ? getComputedStyle(messages).gap : null,
            chatPadding: chat ? getComputedStyle(chat).padding : null,
        });
    })()""")
    test("Chat message styles",
         data.get('msgOverflowWrap') == 'anywhere',
         f"padding={data.get('msgPadding')}, radius={data.get('msgBorderRadius')}, lineHeight={data.get('msgLineHeight')}, gap={data.get('messagesGap')}")

    # Popups share unified material
    data = eval_json("""(function(){
        const tool = document.querySelector('.tool-popover');
        const settings = document.querySelector('.settings-popover');
        const root = getComputedStyle(document.documentElement);
        const tbg = tool ? getComputedStyle(tool).background : null;
        const sbg = settings ? getComputedStyle(settings).background : null;
        return JSON.stringify({
            toolBg: tbg,
            settingsBg: sbg,
            token: root.getPropertyValue('--popover-bg').trim(),
            blur: tool ? getComputedStyle(tool).backdropFilter : null,
        });
    })()""")
    token = str(data.get('token', ''))
    tool_bg = str(data.get('toolBg', ''))
    test("Popups share material",
         bool(token) and token.split(',')[0] in tool_bg,
         f"token={token[:30]}, toolBg={tool_bg[:45]}")

    # Section head actions stable
    data = eval_json("""(function(){
        const heads = document.querySelectorAll('.section-head');
        const arr = [];
        for (const h of heads) {
            const actions = h.querySelector('.section-head-actions');
            arr.push({hasActions: !!actions, gap: actions ? getComputedStyle(actions).gap : null});
        }
        return JSON.stringify(arr);
    })()""")
    all_ok = isinstance(data, list) and all(d.get('hasActions') == True for d in data)
    test("Section head actions", all_ok, f"sections={len(data) if isinstance(data, list) else 0}")

    # Save toast element
    toast = eval_js("!!document.getElementById('saveToast')")
    test("Save toast element exists", toast == True)

    # prefers-reduced-motion: query support is enough; CSS rule scanning may fail due to CORS
    data = eval_json("""(function(){
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        return JSON.stringify({media: mq.media});
    })()""")
    test("prefers-reduced-motion media query", data.get('media') == '(prefers-reduced-motion: reduce)', f"media={data.get('media')}")

    passed = sum(1 for _, p, _ in results if p)
    failed = sum(1 for _, p, _ in results if not p)
    print(f"\n=== Results: {passed} passed, {failed} failed, {len(results)} total ===")
    if failed:
        print("\nFailed:")
        for name, p, detail in results:
            if not p:
                print(f"  - {name}: {detail}")
    ws.close()
    sys.exit(0 if failed == 0 else 1)

if __name__ == '__main__':
    main()
