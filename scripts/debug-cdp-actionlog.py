import json, urllib.request, websocket, time
pages=json.loads(urllib.request.urlopen('http://127.0.0.1:9333/json').read().decode())
url=next(p['webSocketDebuggerUrl'] for p in pages if p.get('title') == 'Miraecle' or p.get('url','').endswith('/src/chrome.html'))
ws=websocket.create_connection(url, timeout=5, suppress_origin=True)
i=0
def call(method, params=None):
 global i
 i+=1; ws.send(json.dumps({'id':i,'method':method,'params':params or {}}))
 while True:
  d=json.loads(ws.recv())
  if d.get('id')==i: return d

def ev(expr):
 return call('Runtime.evaluate', {'expression':expr,'awaitPromise':True,'returnByValue':True,'userGesture':True})
print(json.dumps(ev("(() => ({hasLogBtn:!!document.getElementById('logBtn'), display:getComputedStyle(document.getElementById('execBar')).display, onclick:document.getElementById('logBtn').onclick, hasHermes:!!window.hermes, hasGetActionLog:!!window.hermes?.agent?.getActionLog, popClass:document.getElementById('actionLogPopover').className}))()"), ensure_ascii=False, indent=2))
print(json.dumps(ev("window.hermes.agent.getActionLog().then(v=>({ok:true,len:v.length})).catch(e=>({ok:false,msg:e.message}))"), ensure_ascii=False, indent=2))
print(json.dumps(ev("toggleActionLog.toString().slice(0,500)"), ensure_ascii=False, indent=2))
print(json.dumps(ev("(() => { toggleActionLog({stopPropagation(){}}); return new Promise(resolve=>setTimeout(()=>resolve({cls:document.getElementById('actionLogPopover').className, open:state.actionLogOpen, list:document.getElementById('actionLogList').innerText}), 500)); })()"), ensure_ascii=False, indent=2))
