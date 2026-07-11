// src/agent/cowork.js — V12 Cowork: Files + Browser + AI 통합
//
// BrowserOS Cowork의 강화 버전. 로컬 파일 시스템과 AI 에이전트 통합.
// BLDC 회로 데이터, BOM, datasheet, Gerber, CAD 자동 context.

const fs = require('fs').promises;
const fsSync = require('fs');
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

    // V13: Performance cache — listDir/stalk bypass for repeated calls
    this._dirCache = new Map(); // dir → { mtime, entries, ts }
    this._statCache = new Map(); // path → { stat, ts }
    this._cacheTTL = 3000; // 3 seconds
  }

  _isCacheValid(entry) {
    return entry && (Date.now() - entry.ts) < this._cacheTTL;
  }

  _statCached(p) {
    const cached = this._statCache.get(p);
    if (this._isCacheValid(cached)) return cached.stat;
    return null;
  }

  async listDir(args) {
    const { dir = '.', pattern, includeHidden = false, noCache = false } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      // V13: cache check
      const cached = this._dirCache.get(absDir);
      let entries;
      if (this._isCacheValid(cached) && !noCache) {
        entries = cached.entries;
      } else {
        entries = await fs.readdir(absDir, { withFileTypes: true });
        this._dirCache.set(absDir, { entries, ts: Date.now() });
      }
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
      return { ok: true, dir, count: results.length, items: results.slice(0, this.maxResults), cached: !noCache && !!cached };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Invalidate cache (call when files change) */
  invalidateCache(path) {
    if (path) {
      this._dirCache.delete(path);
      this._statCache.delete(path);
    } else {
      this._dirCache.clear();
      this._statCache.clear();
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
      // V13: collect file paths first (concurrent), then read in batches
      const filePaths = [];
      async function walk(dir) {
        if (filePaths.length >= maxResults * 10) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (filePaths.length >= maxResults * 10) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!excludeDirs.has(entry.name)) await walk(fullPath);
          } else if (entry.isFile()) {
            if (includeRe && !includeRe.test(entry.name)) continue;
            if (excludeRe && excludeRe.test(entry.name)) continue;
            // Quick size filter via stat cache
            try {
              let stat = self._statCached(fullPath);
              if (!stat) {
                stat = await fs.stat(fullPath);
                self._statCache.set(fullPath, { stat, ts: Date.now() });
              }
              if (stat.size > 5 * 1024 * 1024) continue;
            } catch { continue; }
            filePaths.push(fullPath);
          }
        }
      }
      await walk(absDir);

      // Concurrent reads in batches of 8 (limit fs handles)
      const BATCH = 8;
      for (let i = 0; i < filePaths.length && matches.length < maxResults; i += BATCH) {
        const batch = filePaths.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (fullPath) => {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const hits = [];
            for (let j = 0; j < lines.length; j++) {
              if (re.test(lines[j])) {
                hits.push({
                  file: path.relative(self.workspaceRoot, fullPath),
                  line: j + 1,
                  content: lines[j].slice(0, 200),
                });
                if (hits.length >= maxResults) break;
              }
            }
            return hits;
          } catch { return []; }
        }));
        for (const r of results) {
          for (const m of r) {
            matches.push(m);
            if (matches.length >= maxResults) break;
          }
          if (matches.length >= maxResults) break;
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

  // ============================================================
  // V14: Cowork v2 — Real-time watch + diff + replace
  // ============================================================

  /** Watch a directory for file changes (returns watcher handle) */
  async watch(args) {
    const { path: dir, pattern, ignored = ['node_modules', '.git'] } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      // Use fs.watch with debounce for performance
      const debounceMap = new Map(); // filename -> timer
      const events = [];
      // using fsSync
      const watcher = fsSync.watch(absDir, { recursive: true, persistent: false }, (eventType, filename) => {
        if (!filename) return;
        if (pattern && !new RegExp(pattern.replace(/\*/g, '.*'), 'i').test(filename)) return;
        if (ignored.some(ig => filename.includes(ig))) return;
        // Debounce per-file (1 event / 200ms)
        if (debounceMap.has(filename)) clearTimeout(debounceMap.get(filename));
        debounceMap.set(filename, setTimeout(() => {
          events.push({
            type: eventType,
            file: filename,
            fullPath: require('path').join(absDir, filename),
            time: new Date().toISOString(),
          });
          if (events.length > 1000) events.shift();
        }, 200));
      });
      // Store watcher for later close
      if (!this._watchers) this._watchers = new Map();
      const watcherId = 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this._watchers.set(watcherId, { watcher, events, dir });
      // Auto-cleanup after 10 minutes
      setTimeout(() => {
        try { watcher.close(); } catch {}
        this._watchers?.delete(watcherId);
      }, 600000);
      return { ok: true, watcherId, dir, pattern: pattern || null, ttl: 600 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Read last N lines of file (real-time tail) */
  async readTail(args) {
    const { path: filePath, lines = 50 } = args || {};
    const absPath = this._safePath(filePath);
    if (!absPath) return { ok: false, error: 'unsafe path' };
    try {
      // Set up tail watcher if not exists
      const content = await require('fs').promises.readFile(absPath, 'utf8');
      const allLines = content.split('\n');
      const tail = allLines.slice(-lines).join('\n');
      // Cache last-read position for incremental updates
      if (!this._tails) this._tails = new Map();
      this._tails.set(absPath, { size: content.length, lines: allLines.length });
      return { ok: true, path: filePath, lines: tail.split('\n').length, content: tail };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Diff two files (unified diff style) */
  async diff(args) {
    const { path: file1, path2: file2, context = 3 } = args || {};
    const a1 = this._safePath(file1);
    const a2 = this._safePath(file2);
    if (!a1 || !a2) return { ok: false, error: 'unsafe path' };
    try {
      const [c1, c2] = await Promise.all([
        require('fs').promises.readFile(a1, 'utf8'),
        require('fs').promises.readFile(a2, 'utf8'),
      ]);
      const l1 = c1.split('\n');
      const l2 = c2.split('\n');
      // Simple LCS-based diff (line by line)
      const diff = [];
      const maxLen = Math.max(l1.length, l2.length);
      let same = 0, added = 0, removed = 0;
      const lcs = this._lcs(l1, l2);
      let p1 = 0, p2 = 0, pLcs = 0;
      while (p1 < l1.length || p2 < l2.length) {
        if (pLcs < lcs.length && l1[p1] === lcs[pLcs] && l2[p2] === lcs[pLcs]) {
          // Common line
          if (diff.length === 0 || diff[diff.length - 1].type !== 'same') {
            diff.push({ type: 'same', lines: [] });
          }
          diff[diff.length - 1].lines.push({ left: l1[p1], right: l2[p2] });
          same++;
          p1++; p2++; pLcs++;
        } else if (pLcs < lcs.length && l1[p1] !== lcs[pLcs]) {
          // Left-only line (removed from left to reach common)
          if (diff.length === 0 || diff[diff.length - 1].type !== 'removed') {
            diff.push({ type: 'removed', lines: [] });
          }
          diff[diff.length - 1].lines.push({ left: l1[p1], right: null });
          removed++;
          p1++;
        } else if (pLcs < lcs.length && l2[p2] !== lcs[pLcs]) {
          // Right-only line (added)
          if (diff.length === 0 || diff[diff.length - 1].type !== 'added') {
            diff.push({ type: 'added', lines: [] });
          }
          diff[diff.length - 1].lines.push({ left: null, right: l2[p2] });
          added++;
          p2++;
        } else {
          break;
        }
      }
      // Flatten for readability
      const flat = [];
      diff.forEach(group => {
        group.lines.forEach(line => flat.push({
          type: group.type,
          text: line.left || line.right,
        }));
      });
      return { ok: true, left: file1, right: file2, same, added, removed, hunks: diff.length, diff: flat.slice(0, 500) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Longest common subsequence (for diff) */
  _lcs(a, b) {
    const m = a.length, n = b.length;
    if (m === 0 || n === 0) return [];
    // Memory-efficient: only need last 2 rows
    const dp = Array(n + 1).fill(0);
    const prev = Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cur = a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], dp[j - 1]);
        dp[j - 1] = prev[j];
        dp[j] = cur;
      }
      for (let j = 0; j <= n; j++) { prev[j] = dp[j]; dp[j] = 0; }
    }
    // Reconstruct path (approximate — only for small files)
    if (m * n > 100000) return []; // skip reconstruction for huge files
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) { lcs.unshift(a[i - 1]); i--; j--; }
      else if (prev[j] >= dp[j - 1]) j--;
      else i--;
    }
    return lcs;
  }

  /** V15: List all active watchers */
  watchList() {
    const list = [];
    if (this._watchers) {
      for (const [id, w] of this._watchers) {
        list.push({
          watcherId: id,
          dir: w.dir,
          eventCount: w.events.length,
          lastEvent: w.events[w.events.length - 1] || null,
          ttl: 'auto-cleanup 10min',
        });
      }
    }
    return { ok: true, watchers: list };
  }

  /** V15: Unsubscribe a watcher */
  watchUnsubscribe(args) {
    const { watcherId } = args || {};
    if (!watcherId) return { ok: false, error: 'watcherId required' };
    if (!this._watchers?.has(watcherId)) return { ok: false, error: 'watcher not found', watcherId };
    const entry = this._watchers.get(watcherId);
    try { entry.watcher.close(); } catch {}
    this._watchers.delete(watcherId);
    return { ok: true, watcherId, eventsDelivered: entry.events.length };
  }

  /** V15: Get recent events for a watcher (polling fallback for SSE) */
  watchEvents(args) {
    const { watcherId, since = 0 } = args || {};
    if (!watcherId) return { ok: false, error: 'watcherId required' };
    if (!this._watchers?.has(watcherId)) return { ok: false, error: 'watcher not found' };
    const entry = this._watchers.get(watcherId);
    const events = entry.events.slice(since);
    return { ok: true, watcherId, dir: entry.dir, total: entry.events.length, events };
  }

  /** V15: Search + replace across files (V16: --backup, --exclude, maxFiles up to 200) */
  async searchReplace(args) {
    const {
      path: dir,
      pattern,
      replacement,
      glob = '*.{txt,md,json,csv,ts,js,gd}',
      maxFiles = 200,
      pretend = true,
      backup = false,
      exclude = ['node_modules', '.git', 'dist'],
      writeOnly = false,
    } = args || {};
    if (!pattern || !replacement) return { ok: false, error: 'pattern and replacement required' };
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const re = new RegExp(pattern, 'g');
      const matches = [];
      const self = this;
      const globRe = new RegExp('^' + glob.replace(/\*/g, '.*').replace(/\./g, '\\.').replace(/\{([a-z,]+)\}/g, '$1') + '$', 'i');
      const filePaths = [];
      const globCheck = this._globMatch.bind(this);
      async function walk(dir) {
        if (filePaths.length >= maxFiles) return;
        let entries;
        try { entries = await require('fs').promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (filePaths.length >= maxFiles) return;
          const fullPath = require('path').join(dir, entry.name);
          if (entry.isDirectory() && !exclude.includes(entry.name)) {
            await walk(fullPath);
          } else if (entry.isFile() && globCheck(entry.name, glob)) {
            filePaths.push(fullPath);
          }
        }
      }
      await walk(absDir);
      // Phase 1: preview (always done)
      for (const fp of filePaths) {
        try {
          const content = await require('fs').promises.readFile(fp, 'utf8');
          const rel = require('path').relative(self.workspaceRoot, fp);
          const hits = [...content.matchAll(re)];
          if (hits.length > 0) {
            matches.push({ file: rel, hits: hits.length, preview: hits.slice(0, 3).map(m => ({ line: content.substr(0, m.index).split('\n').length, text: m[0].slice(0, 80) })) });
          }
        } catch {}
      }
      // Phase 2: apply replacements (only if !pretend)
      const applied = [];
      const backups = [];
      const diffs = [];
      if (!pretend) {
        for (const fp of filePaths) {
          try {
            const content = await require('fs').promises.readFile(fp, 'utf8');
            const newContent = content.replace(re, replacement);
            if (newContent !== content) {
              const relPath = require('path').relative(self.workspaceRoot, fp);
              const hits = [...content.matchAll(re)].length;
              // Backup if requested
              if (backup) {
                const backupPath = fp + '.bak';
                await require('fs').promises.copyFile(fp, backupPath);
                backups.push(backupPath);
              }
              if (!writeOnly) {
                applied.push({ file: relPath, hits, bytesChanged: newContent.length - content.length });
              }
              // Diff preview: first 200 chars before + after
              diffs.push({
                file: relPath,
                hits,
                before: content.slice(0, 200),
                after: newContent.slice(0, 200),
                sizeBefore: content.length,
                sizeAfter: newContent.length,
              });
              await require('fs').promises.writeFile(fp, newContent, 'utf8');
            }
          } catch {}
        }
        self.invalidateCache();
      }
      return {
        ok: true,
        mode: pretend ? 'preview' : 'apply',
        filesScanned: filePaths.length,
        matches,
        applied: writeOnly ? [] : applied,
        diffs: writeOnly ? [] : diffs,
        backupCount: backups.length,
        backupPaths: writeOnly ? [] : backups,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ============================================================
  // V17: Cowork v5 — Multi-agent concurrency primitives
  // ============================================================

  /** Acquire a file lock (advisory lock) — returns lock token or null */
  async acquireLock(args) {
    const { path: filePath, ttl = 30000, wait = false } = args || {};
    if (!filePath) return { ok: false, error: 'path required' };
    const absPath = this._safePath(filePath);
    if (!absPath) return { ok: false, error: 'unsafe path' };
    if (!this._locks) this._locks = new Map(); // filePath → { token, expires, agentId }
    const now = Date.now();
    const existing = this._locks.get(absPath);
    if (existing && existing.expires > now) {
      if (!wait) return { ok: false, error: 'locked', lockedBy: existing.agentId, expiresIn: existing.expires - now };
      // Wait up to 3s
      await new Promise(r => setTimeout(r, Math.min(3000, existing.expires - now)));
      return this.acquireLock(args);
    }
    const token = 'lock_' + Math.random().toString(36).slice(2, 10);
    this._locks.set(absPath, { token, expires: now + ttl, agentId: args.agentId || 'unknown' });
    return { ok: true, token, file: filePath, ttl, expiresAt: now + ttl };
  }

  /** Release a lock by token */
  releaseLock(args) {
    const { path: filePath, token } = args || {};
    if (!filePath || !token) return { ok: false, error: 'path and token required' };
    const absPath = this._safePath(filePath);
    if (!absPath) return { ok: false, error: 'unsafe path' };
    const existing = this._locks.get(absPath);
    if (!existing) return { ok: false, error: 'not locked' };
    if (existing.token !== token) return { ok: false, error: 'token mismatch' };
    this._locks.delete(absPath);
    return { ok: true, file: filePath };
  }

  /** List all current locks */
  listLocks() {
    const locks = [];
    if (this._locks) {
      const now = Date.now();
      for (const [path, lock] of this._locks) {
        if (lock.expires > now) {
          locks.push({ path, token: lock.token, agentId: lock.agentId, expiresAt: lock.expires, expiresIn: lock.expires - now });
        } else {
          this._locks.delete(path); // GC expired
        }
      }
    }
    return { ok: true, locks, count: locks.length };
  }

  /** Acquire a named lease (semaphore-style, multi-key) */
  async acquireLease(args) {
    const { leaseName, ttl = 60000, agentId = 'unknown' } = args || {};
    if (!leaseName) return { ok: false, error: 'leaseName required' };
    if (!this._leases) this._leases = new Map(); // leaseName → { agentId, expires }
    const now = Date.now();
    const existing = this._leases.get(leaseName);
    if (existing && existing.expires > now) {
      return { ok: false, error: 'lease held', holder: existing.agentId, expiresIn: existing.expires - now };
    }
    this._leases.set(leaseName, { agentId, expires: now + ttl });
    return { ok: true, leaseName, agentId, ttl, expiresAt: now + ttl };
  }

  /** Release a lease */
  releaseLease(args) {
    const { leaseName, agentId } = args || {};
    if (!leaseName) return { ok: false, error: 'leaseName required' };
    if (!this._leases?.has(leaseName)) return { ok: false, error: 'lease not held' };
    const existing = this._leases.get(leaseName);
    if (agentId && existing.agentId !== agentId) return { ok: false, error: 'not owner' };
    this._leases.delete(leaseName);
    return { ok: true, leaseName };
  }

  /** Enqueue a task for an agent */
  enqueueTask(args) {
    const { agentId, task, priority = 0 } = args || {};
    if (!agentId || !task) return { ok: false, error: 'agentId and task required' };
    if (!this._taskQueue) this._taskQueue = []; // [{agentId, task, priority, enqueuedAt, id}]
    const taskId = 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._taskQueue.push({ id: taskId, agentId, task, priority, enqueuedAt: Date.now() });
    return { ok: true, taskId, queueSize: this._taskQueue.length };
  }

  /** Dequeue next task for an agent (priority sorted, oldest first within same priority) */
  dequeueTask(args) {
    const { agentId, max = 1 } = args || {};
    if (!this._taskQueue || this._taskQueue.length === 0) return { ok: true, tasks: [] };
    const eligible = this._taskQueue
      .filter(t => !agentId || t.agentId === agentId || t.agentId === '*')
      .sort((a, b) => (b.priority - a.priority) || (a.enqueuedAt - b.enqueuedAt))
      .slice(0, max);
    // Remove from queue
    this._taskQueue = this._taskQueue.filter(t => !eligible.includes(t));
    return { ok: true, tasks: eligible, remaining: this._taskQueue.length };
  }

  /** Set/Get shared state key (cross-agent coordination) */
  setSharedState(args) {
    const { key, value, agentId = 'unknown' } = args || {};
    if (!key) return { ok: false, error: 'key required' };
    if (!this._sharedState) this._sharedState = new Map();
    this._sharedState.set(key, { value, agentId, updatedAt: Date.now() });
    return { ok: true, key };
  }

  getSharedState(args) {
    const { key } = args || {};
    if (!this._sharedState) return { ok: true, value: null };
    if (key) {
      const entry = this._sharedState.get(key);
      return { ok: true, key, value: entry?.value, agentId: entry?.agentId, updatedAt: entry?.updatedAt };
    }
    // Return all
    const all = {};
    for (const [k, v] of this._sharedState) all[k] = { ...v };
    return { ok: true, count: Object.keys(all).length, state: all };
  }

  /** Simple glob match: *.txt → /\.txt$/, *.{txt,md} → /\.(txt|md)$/ */
  _globMatch(name, glob) {
    if (!glob || glob === '*') return true;
    // Convert glob → regex
    const re = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\{([a-z,/]+)\}/gi, (_, p) => '(' + p.split(',').join('|') + ')');
    return new RegExp('^' + re + '$', 'i').test(name);
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