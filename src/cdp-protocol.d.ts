// src/cdp-protocol.d.ts — Type-safe bindings for the Chrome DevTools Protocol
// methods we actually use in Hermes Browser.
//
// Why a hand-written .d.ts instead of pulling in chrome-remote-interface?
//   - It's just type info — no runtime dependency.
//   - We only declare the ~30 methods we call, not all 1,000+ CDP methods.
//   - VS Code intellisense + JSDoc gives us autocomplete/parameter hints even
//     in plain `.js` files (no TypeScript compilation required).
//
// Usage:
//   /** @type {import('./cdp-protocol').WebContentsLike} */
//   const wc = view.webContents;
//   const text = await wc.executeJavaScript('document.body.innerText');
//
// This file is consumed at EDIT time only — it has no runtime presence.
// Affects only intellisense; no behavior change at runtime.

/**
 * @typedef {Object} DomRect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} BoundingClientRect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} left
 */

/**
 * @typedef {Object} InputKeyEvent
 * @property {'keyDown' | 'keyUp' | 'char'} type
 * @property {string} [keyCode]
 * @property {string} [key]
 * @property {string} [code]
 * @property {number} [windowsVirtualKeyCode]
 * @property {number} [nativeVirtualKeyCode]
 * @property {number} [modifiers]
 * @property {boolean} [autoRepeat]
 * @property {boolean} [isKeypad]
 * @property {boolean} [isSystemKey]
 * @property {number} [text]
 * @property {number} [unmodifiedText]
 */

/**
 * @typedef {Object} ImageDataURL
 * @property {string} dataUrl  PNG data URL like "data:image/png;base64,..."
 */

/**
 * @typedef {Object} ExecuteJsResult
 * Result of executeJavaScript — can be any JSON-serializable value the page returns.
 * Common shapes we use: string (innerText), boolean (ok), { ok, error, text, rect }, [links, ...]
 */

/**
 * The subset of Electron's webContents API we actually call from agent/.
 * Kept narrow on purpose — if we add a new method here, we're declaring
 * "this is a CDP / webContents boundary, please be careful with it".
 * @typedef {Object} WebContentsLike
 * @property {(url: string) => Promise<void>} loadURL
 * @property {() => void} reload
 * @property {() => string} getURL
 * @property {(code: string, userGesture?: boolean) => Promise<ExecuteJsResult>} executeJavaScript
 * @property {(event: InputKeyEvent) => void} sendInputEvent
 * @property {() => Promise<{ toDataURL: () => string }>} capturePage
 * @property {(factor: number) => void} setZoomFactor
 * @property {() => number} getZoomFactor
 * @property {(url: string) => void} setUserAgent
 * @property {() => void} openDevTools
 * @property {() => void} closeDevTools
 * @property {() => string} getTitle
 * @property {() => boolean} isLoading
 * @property {() => void} stop
 * @property {(offset: number) => Promise<string>} getPageTitle  // not real, demo of intent
 */

/**
 * The subset of WebContentsView we use for browser control primitives.
 * @typedef {Object} ViewLike
 * @property {WebContentsLike} webContents
 * @property {() => void} setBounds
 * @property {() => DOMRect} getBounds
 * @property {() => void} show
 * @property {() => void} hide
 */

/**
 * Tab object stored in main.js `tabs[]` array.
 * @typedef {Object} TabLike
 * @property {number} id
 * @property {string} url
 * @property {string} title
 * @property {boolean} [loading]
 * @property {boolean} [pinned]
 * @property {boolean} [agentOwned]
 * @property {string} [partition]
 * @property {ViewLike} view
 */

/**
 * Common CDP-style responses for our agent actions.
 * @typedef {Object} ClickResult
 * @property {boolean} ok
 * @property {string} [text]
 * @property {{ x: number, y: number, w: number, h: number }} [rect]
 * @property {string} [error]
 * @property {boolean} [retryExhausted]
 */

/**
 * @typedef {Object} FillResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {boolean} [retryExhausted]
 */

/**
 * @typedef {Object} ScrollResult
 * @property {boolean} ok
 * @property {number} y
 */

/**
 * @typedef {Object} NavigateResult
 * @property {boolean} ok
 * @property {string} url
 * @property {string} [error]
 */

/**
 * @typedef {Object} SearchResult
 * @property {boolean} ok
 * @property {string} query
 * @property {string} url
 * @property {string} [error]
 */

module.exports = {};