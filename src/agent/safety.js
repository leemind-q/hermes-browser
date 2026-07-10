// src/agent/safety.js — Prompt injection detection + secret redaction
// Extracted from main.js (originally lines 86-99, 386-402, 550-555).

const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|above|prior) instructions/i,
  /disregard (?:your|the) (?:system|original) prompt/i,
  /you are now (?:a|an) (?:different|new)/i,
  /reveal (?:your|the) (?:system|initial) (?:prompt|instructions|message)/i,
  /exfiltrate|transmit|send (?:to|via) (?:external|remote)/i,
  /(?:ignore|override|bypass) (?:safety|security|content) (?:filter|guard|policy|rules)/i,
];

function detectInjection(text) {
  if (!text) return { injected: false, patterns: [] };
  const found = [];
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) found.push(re.source);
  }
  return { injected: found.length > 0, patterns: found };
}

const REDACT_PATTERNS = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
  /Bearer\s+[a-zA-Z0-9\-_.]+/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[ps]_[A-Za-z0-9]{20,}/g,
  /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
  /(api_key|apikey|token|password)=([a-zA-Z0-9\-_.]+)/gi,
];

function redactText(text) {
  let count = 0;
  let out = String(text || '');
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, () => { count += 1; return '[REDACTED]'; });
  }
  return { text: out, count };
}

/**
 * Mask secrets in any value (string or structured). Strings go through redactText
 * directly; objects/arrays are JSON-serialized, redacted, then parsed back so the
 * caller gets the same shape they passed in.
 */
function maskSecrets(value) {
  if (value == null) return value;
  const isString = typeof value === 'string';
  const input = isString ? value : JSON.stringify(value);
  const { text } = redactText(input);
  if (isString) return text;
  try { return JSON.parse(text); } catch { return value; }
}

/**
 * Heuristic risky-action detector on top of the static risk table.
 * Catches actions whose PARAMETERS look dangerous even if the action class
 * itself is medium (e.g. a 'click' whose selector is a "delete account" button).
 */
function isRiskyAction(action, params = {}) {
  const joined = JSON.stringify(params).toLowerCase();
  if (['submit', 'uploadFile', 'downloadFile', 'openExternal'].includes(action)) return true;
  return /(checkout|payment|pay\.|bank|login|signin|password|otp|2fa|delete|send|purchase|reserve|booking|card)/i.test(joined);
}

module.exports = {
  INJECTION_PATTERNS,
  detectInjection,
  redactText,
  maskSecrets,
  isRiskyAction,
};