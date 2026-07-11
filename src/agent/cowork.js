// src/agent/cowork.js — V12 Cowork: Files + Browser + AI 통합
//
// BrowserOS Cowork의 강화 버전. 로컬 파일 시스템과 AI 에이전트 통합.
// BLDC 회로 데이터, BOM, datasheet, Gerber, CAD 자동 context.

const fs = require('fs').promises;
const path = require('path');

class CoworkService {
  constructor({ workspaceRoot, maxFileSize = 5 * 1024 * 1024, maxResults = 100 }) {
    this.workspaceRoot = (() => {
      // Convert Windows-style workspaceRoot (C:\Users\...) to WSL (/mnt/c/Users/...)
      if (typeof workspaceRoot === 'string' && /^[A-Z]:\\/.test(workspaceRoot)) {
        const m = workspaceRoot.match(/^([A-Z]):\\(.+)/);
        if (m) return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
      }
      const result = workspaceRoot || process.cwd();
      console.log('[CoworkService] workspaceRoot resolved to:', result, 'from input:', workspaceRoot);
      return result;
    })();
    this.maxFileSize = maxFileSize;
    this.maxResults = maxResults;
    // File extension → MIME hints for AI consumption
    this.textExtensions = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini', '.cfg', '.conf', '.sh', '.bash', '.js', '.ts', '.py', '.gd', '.cpp', '.c', '.h', '.hpp', '.rs', '.go', '.java', '.html', '.css', '.sql']);
    this.binaryExtensions = new Set(['.pdf', '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.gerber', '.gbr', '.drl', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico']);
  }

  async listDir(args) {
    const { dir = '.', pattern, includeHidden = false } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      let results = entries
        .filter(e => includeHidden || !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          path: path.relative(this.workspaceRoot, path.join(absDir, e.name)),
          type: e.isDirectory() ? 'dir' : 'file',
          size: e.isFile() ? null : null,
          ext: e.isFile() ? path.extname(e.name).toLowerCase() : null,
        }));
      if (pattern) {
        const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
        results = results.filter(r => re.test(r.name));
      }
      return { ok: true, dir, count: results.length, items: results.slice(0, this.maxResults) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async readFile(args) {
    const { path: filePath, maxBytes = 100000, offset = 0 } = args || {};
    const absPath = this._safePath(filePath);
    if (!absPath) return { ok: false, error: 'unsafe path' };
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) return { ok: false, error: 'not a file' };
      if (stat.size > this.maxFileSize) return { ok: false, error: `file too large (${stat.size} > ${this.maxFileSize} bytes)` };
      const ext = path.extname(filePath).toLowerCase();
      // Binary file detection
      if (this.binaryExtensions.has(ext)) {
        return { ok: true, path: filePath, size: stat.size, type: 'binary', ext, hint: `binary file (${ext}), cannot read as text. Use specialized tool if needed.` };
      }
      // Text file with offset/limit
      const fd = await fs.open(absPath, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(maxBytes, stat.size - offset));
        await fd.read(buffer, 0, buffer.length, offset);
        return {
          ok: true,
          path: filePath,
          size: stat.size,
          type: 'text',
          ext,
          offset,
          bytesRead: buffer.length,
          content: buffer.toString('utf8'),
          truncated: offset + buffer.length < stat.size,
        };
      } finally {
        await fd.close();
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async grepFiles(args) {
    const { path: searchDir = '.', pattern, ignoreCase = true, includePattern, excludePattern, maxResults = 50 } = args || {};
    if (!pattern) return { ok: false, error: 'pattern required' };
    const absDir = this._safePath(searchDir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const re = new RegExp(pattern, ignoreCase ? 'i' : '');
      const matches = [];
      const excludeDirs = new Set(['node_modules', '.git', 'dist', 'build']);
      const includeRe = includePattern ? new RegExp(includePattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i') : null;
      const excludeRe = excludePattern ? new RegExp(excludePattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i') : null;

      const self = this;
      async function walk(dir) {
        if (matches.length >= maxResults) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!excludeDirs.has(entry.name)) await walk(fullPath);
          } else if (entry.isFile()) {
            if (includeRe && !includeRe.test(entry.name)) continue;
            if (excludeRe && excludeRe.test(entry.name)) continue;
            let stat;
            try { stat = await fs.stat(fullPath); } catch { continue; }
            if (stat.size > 5 * 1024 * 1024) continue;
            try {
              const content = await fs.readFile(fullPath, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) {
                  matches.push({
                    file: path.relative(self.workspaceRoot, fullPath),
                    line: i + 1,
                    content: lines[i].slice(0, 200),
                  });
                  if (matches.length >= maxResults) return;
                }
              }
            } catch { /* skip binary */ }
          }
        }
      }
      try {
        await walk(absDir);
      } catch (e) {
        return { ok: false, error: 'walk failed: ' + e.message };
      }
      return { ok: true, pattern, count: matches.length, matches, truncated: matches.length >= maxResults };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async searchFiles(args) {
    const { path: searchDir = '.', namePattern, contentPattern, recursive = true, maxResults = 50 } = args || {};
    const absDir = this._safePath(searchDir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    if (!namePattern && !contentPattern) return { ok: false, error: 'namePattern or contentPattern required' };
    try {
      const nameRe = namePattern ? new RegExp(namePattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i') : null;
      const contentRe = contentPattern ? new RegExp(contentPattern, 'i') : null;
      const results = [];
      const seen = new Set();
      const excludeDirs = new Set(['node_modules', '.git', 'dist', 'build']);
      const self = this;
      const maxDepth = recursive ? 10 : 1;

      async function walk(dir, depth = 0) {
        if (results.length >= maxResults || depth > maxDepth) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (results.length >= maxResults) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!excludeDirs.has(entry.name)) await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            // Name match
            if (nameRe && nameRe.test(entry.name)) {
              const rel = path.relative(self.workspaceRoot, fullPath);
              if (!seen.has(rel)) { seen.add(rel); results.push({ path: rel, matchType: 'name' }); }
            }
            // Content match
            if (contentRe && results.length < maxResults) {
              try {
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                  if (contentRe.test(lines[i])) {
                    const rel = path.relative(self.workspaceRoot, fullPath);
                    const key = rel + ':' + i;
                    if (!seen.has(key)) {
                      seen.add(key);
                      results.push({ path: rel, line: i + 1, content: lines[i].slice(0, 200), matchType: 'content' });
                    }
                  }
                }
              } catch { /* skip binary */ }
            }
          }
        }
      }
      await walk(absDir);
      return { ok: true, count: results.length, results: results.slice(0, maxResults) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async fileStat(args) {
    const { path: filePath } = args || {};
    const absPath = this._safePath(filePath);
    if (!absPath) return { ok: false, error: 'unsafe path' };
    try {
      const stat = await fs.stat(absPath);
      return {
        ok: true,
        path: filePath,
        size: stat.size,
        isFile: stat.isFile(),
        isDir: stat.isDirectory(),
        mtime: stat.mtime.toISOString(),
        ctime: stat.ctime.toISOString(),
        ext: path.extname(filePath).toLowerCase(),
        mime: this._guessMime(filePath),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _safePath(p) {
    if (!p) return null;
    let normalized = String(p);
    // Replace Windows backslashes with forward slashes
    normalized = normalized.split(String.fromCharCode(92)).join('/');
    // Detect Windows drive prefix (C:/...) and convert to /mnt/c/...
    if (normalized.length >= 3 && normalized[0] >= 'A' && normalized[0] <= 'Z' && normalized[1] === ':' && normalized[2] === '/') {
      const drive = normalized[0].toLowerCase();
      const rest = normalized.slice(3);
      normalized = '/mnt/' + drive + '/' + rest;
    }
    if (!normalized.startsWith('/')) {
      while (normalized.startsWith('./')) normalized = normalized.slice(2);
      const wsRoot = String(this.workspaceRoot).split(String.fromCharCode(92)).join('/').replace(/\/$/, '');
      normalized = wsRoot + '/' + normalized;
    }
    // Manual WSL normalize (path.normalize on Electron would convert / to \ due to Windows mode)
    {
      const parts = normalized.split('/').filter(p => p && p !== '.');
      const stack = [];
      for (const p of parts) {
        if (p === '..') stack.pop();
        else stack.push(p);
      }
      normalized = '/' + stack.join('/');
    }
    const allowed = [
      '/tmp',
      '/home/taewoo',
      '/home/taewoo/projects',
      '/home/taewoo/projects/hermes-browser',
      '/mnt/c/Users/qqwer',
      '/mnt/c/Users/qqwer/Desktop',
      '/mnt/c/Users/qqwer/Desktop/Hermes',
      '/mnt/c/Users/qqwer/Hermes-Workspace',
    ];
    const ok = allowed.some(root => normalized.startsWith(root));
    if (!ok) return null;
    // Convert /mnt/<drive>/... to <Drive>:\\... for Windows fs operations
    const wm = normalized.match(/^\/mnt\/([a-z])\/(.+)/);
    if (wm) return wm[1].toUpperCase() + ':\\\\' + wm[2].split('/').join('\\\\');
    return normalized;
  }

  _guessMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
      '.gd': 'text/x-gdscript',
      '.cpp': 'text/x-c++src',
      '.c': 'text/x-csrc',
      '.h': 'text/x-chdr',
      '.gerber': 'application/x-gerber',
      '.gbr': 'application/x-gerber',
      '.drl': 'text/x-excellon',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };
    return map[ext] || 'application/octet-stream';
  }
}

module.exports = { CoworkService };