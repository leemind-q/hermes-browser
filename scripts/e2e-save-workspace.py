#!/usr/bin/env python3
import json, time, urllib.request, websocket, sys
PORT=19222

def target():
    targets=json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json').read())
    return [t for t in targets if 'chrome.html' in t.get('url','')][0]

def main():
    t=target(); ws=websocket.create_connection(t['webSocketDebuggerUrl'], timeout=15, suppress_origin=True)
    mid=0
    def ev(expr):
        nonlocal mid
        mid+=1
        ws.send(json.dumps({'id':mid,'method':'Runtime.evaluate','params':{'expression':expr,'returnByValue':True}}))
        while True:
            r=json.loads(ws.recv())
            if r.get('id')==mid:
                res=r.get('result',{}).get('result',{})
                if 'exceptionDetails' in r.get('result',{}): print('EXCEPTION', r['result']['exceptionDetails'])
                return res.get('value')
    # Make sure save button is visible by pinning sidebar if needed
    ev("if (!state.leftPinned) document.getElementById('leftPinBtn').click()")
    time.sleep(.2)
    before=ev("document.getElementById('saveWorkspaceBtn').className")
    ev("document.getElementById('saveWorkspaceBtn').click()")
    time.sleep(.25)
    during=ev("document.getElementById('saveWorkspaceBtn').className")
    toast_during=ev("document.getElementById('saveToast')?.textContent")
    time.sleep(1.0)
    after=ev("document.getElementById('saveWorkspaceBtn').className")
    toast_after=ev("document.getElementById('saveToast')?.textContent")
    meta=ev("document.getElementById('workspaceMeta')?.textContent")
    print(json.dumps({'before':before,'during':during,'after':after,'toast_during':toast_during,'toast_after':toast_after,'meta':meta}, ensure_ascii=False, indent=2))
    ok = ('saved' in (during or '') or 'saved' in (after or '') or '저장 완료' in (toast_after or '') or '저장됨' in (meta or ''))
    print('SAVE_E2E', 'PASS' if ok else 'FAIL')
    ws.close()
    sys.exit(0 if ok else 1)
if __name__=='__main__': main()
