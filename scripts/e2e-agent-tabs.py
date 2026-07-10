#!/usr/bin/env python3
"""E2E: verify createResultTab creates an agent-owned tab shown in AGENT TABS group."""
import requests, json, time, sys

def main():
    base = 'http://127.0.0.1:19222'
    pages = json.loads(requests.get(f'{base}/json/list').text)
    chrome_target = next((p for p in pages if p.get('type') == 'page' and 'chrome.html' in p.get('url', '')), None)
    if not chrome_target:
        print('FAIL: no chrome.html page target'); sys.exit(1)
    ws_url = chrome_target['webSocketDebuggerUrl']
    try:
        import websocket
    except ImportError:
        print('FAIL: websocket-client not installed'); sys.exit(1)
    ws = websocket.create_connection(ws_url)
    req_id = 0
    def call(method, params=None):
        nonlocal req_id
        req_id += 1
        payload = {'id': req_id, 'method': method, 'params': params or {}}
        ws.send(json.dumps(payload))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == req_id:
                return msg

    call('Runtime.enable')
    time.sleep(0.5)

    expr = """
    (async () => {
      try {
        const r = await window.hermes.research.createResultTab({ title: 'E2E Agent Result', htmlContent: '<html><body><h1>Agent Result</h1></body></html>' });
        return JSON.stringify(r);
      } catch (e) {
        return 'ERR:' + e.message;
      }
    })()
    """
    res = call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    val = res.get('result', {}).get('value', '')
    print('createResultTab result:', val)

    time.sleep(1.2)
    expr2 = """
    (() => {
      const groups = Array.from(document.querySelectorAll('.group-title span'));
      return JSON.stringify(groups.map(g => g.textContent));
    })()
    """
    res2 = call('Runtime.evaluate', {'expression': expr2, 'returnByValue': True})
    texts = json.loads(res2.get('result', {}).get('value', '[]') or '[]')
    print('group titles:', texts)
    has_agent = any('AGENT TABS' in (str(t) or '').upper() for t in texts)
    print('PASS' if has_agent else 'FAIL')
    ws.close()
    sys.exit(0 if has_agent else 1)

if __name__ == '__main__':
    main()
