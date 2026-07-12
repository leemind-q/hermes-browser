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

  /** V18: Search + replace across files with autoLock (atomic bulk edit) */
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
      autoLock = true, // V18: acquire lock per file before write
      lockTtl = 30000, // V18: lock TTL (ms)
      atomic = false, // V18: rollback all changes if any write fails
      agentId = 'search-replace',
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
      // Phase 2: apply replacements (V18: with autoLock + atomic + changeSummary)
      const applied = [];
      const backups = [];
      const diffs = [];
      const locksAcquired = []; // V18: track locks for release/rollback
      let linesAdded = 0, linesRemoved = 0;
      const failures = [];
      let aborted = false;

      // Helper: rollback all already-applied writes (atomic mode)
      const rollback = async () => {
        if (!atomic) return;
        for (let i = applied.length - 1; i >= 0; i--) {
          const a = applied[i];
          try {
            // Restore from backup if exists
            if (backup) {
              const backupPath = require('path').join(self.workspaceRoot, a.file) + '.bak';
              await require('fs').promises.copyFile(backupPath, require('path').join(self.workspaceRoot, a.file));
            }
          } catch {}
        }
      };

      if (!pretend) {
        for (const fp of filePaths) {
          if (aborted) break;
          let lockToken = null;
          try {
            // V18: acquire lock if requested
            if (autoLock) {
              const lockResult = await this.acquireLock({ path: fp.replace(self.workspaceRoot + require('path').sep, ''), agentId, ttl: lockTtl });
              if (!lockResult.ok) {
                failures.push({ file: fp, error: 'lock failed: ' + lockResult.error });
                if (atomic) { aborted = true; break; }
                continue;
              }
              lockToken = lockResult.token;
              locksAcquired.push({ file: fp, token: lockToken });
            }
            const content = await require('fs').promises.readFile(fp, 'utf8');
            const newContent = content.replace(re, replacement);
            if (newContent !== content) {
              const relPath = require('path').relative(self.workspaceRoot, fp);
              const hits = [...content.matchAll(re)].length;
              // Line count delta
              const oldLines = content.split('\n').length;
              const newLines = newContent.split('\n').length;
              if (newLines > oldLines) linesAdded += newLines - oldLines;
              else if (newLines < oldLines) linesRemoved += oldLines - newLines;
              // Backup if requested
              if (backup) {
                const backupPath = fp + '.bak';
                await require('fs').promises.copyFile(fp, backupPath);
                backups.push(backupPath);
              }
              if (!writeOnly) {
                applied.push({ file: relPath, hits, bytesChanged: newContent.length - content.length });
              }
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
          } catch (e) {
            failures.push({ file: fp, error: e.message });
            if (atomic) { aborted = true; break; }
          } finally {
            // V18: release lock if held
            if (lockToken) {
              this.releaseLock({ path: fp.replace(self.workspaceRoot + require('path').sep, ''), token: lockToken });
            }
          }
        }
        self.invalidateCache();
      }

      return {
        ok: !aborted,
        mode: pretend ? 'preview' : 'apply',
        atomic,
        filesScanned: filePaths.length,
        filesChanged: applied.length,
        matches,
        applied: writeOnly ? [] : applied,
        diffs: writeOnly ? [] : diffs,
        backupCount: backups.length,
        backupPaths: writeOnly ? [] : backups,
        locksAcquired: locksAcquired.length,
        failures,
        changeSummary: {
          linesAdded,
          linesRemoved,
          filesTouched: applied.length,
        },
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

  // ============================================================
  // V18: Cowork v6 — Git integration (child_process exec git)
  // ============================================================

  /** Git status in a directory (or whole workspace) — V18.1: WSL path auto-detect */
  async gitStatus(args) {
    const { path: dir = '.', short = true } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const { execFile } = require('child_process');
      const util = require('util');
      const exec = util.promisify(execFile);
      // V18.1: Convert Windows-style path to WSL for git execution
      const gitCwd = this._toWSLPath(absDir);
      const gitBin = process.platform === 'win32' ? 'git' : '/usr/bin/git';
      const { stdout } = await exec(gitBin, ['status', short ? '--short' : '--porcelain'], { cwd: gitCwd, timeout: 10000 });
      const lines = stdout.split('\n').filter(l => l.trim());
      const items = lines.map(line => {
        const status = line.substring(0, 2);
        const file = line.substring(3).trim();
        let s = { raw: status, file };
        if (status[0] !== ' ' && status[0] !== '?') s.staged = status[0];
        if (status[1] !== ' ' && status[1] !== '?') s.unstaged = status[1];
        if (status[0] === '?' || status[1] === '?') s.untracked = true;
        return s;
      });
      return { ok: true, dir, count: items.length, items };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Git log (last N commits) */
  async gitLog(args) {
    const { path: dir = '.', limit = 10, branch = 'HEAD', format = '%H|%h|%an|%ae|%ad|%s' } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const { execFile } = require('child_process');
      const util = require('util');
      const exec = util.promisify(execFile);
      const { stdout } = await exec('git', ['log', `-n`, String(limit), branch, `--pretty=format:${format}`], { cwd: this._toWSLPath(absDir), timeout: 10000 });
      const lines = stdout.split('\n').filter(l => l.trim());
      const commits = lines.map(line => {
        const [hash, shortHash, author, email, date, ...subjectParts] = line.split('|');
        return { hash, shortHash, author, email, date, subject: subjectParts.join('|') };
      });
      return { ok: true, dir, branch, count: commits.length, commits };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Git diff (staged or unstaged) */
  async gitDiff(args) {
    const { path: dir = '.', staged = false, file, limit = 5000 } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const { execFile } = require('child_process');
      const util = require('util');
      const exec = util.promisify(execFile);
      const gitArgs = ['diff', '--no-color'];
      if (staged) gitArgs.push('--staged');
      if (file) gitArgs.push('--', file);
      const { stdout } = await exec('git', gitArgs, { cwd: absDir, timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
      const diff = stdout.slice(0, limit);
      const lines = diff.split('\n');
      const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
      return { ok: true, dir, staged, file, diff, lines: lines.length, additions, deletions, truncated: stdout.length > limit };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Git blame (line-by-line author) */
  async gitBlame(args) {
    const { path: file, dir = '.', startLine, endLine } = args || {};
    if (!file) return { ok: false, error: 'path required' };
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const { execFile } = require('child_process');
      const util = require('util');
      const exec = util.promisify(execFile);
      const gitArgs = ['blame', '--line-porcelain'];
      if (startLine && endLine) gitArgs.push(`-L`, `${startLine},${endLine}`);
      gitArgs.push('--', file);
      const { stdout } = await exec('git', gitArgs, { cwd: absDir, timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
      // Parse porcelain: <hash> <orig-line> <final-line> [count]
      // followed by author, author-mail, author-time, author-tz, summary, previous, filename
      const lines = stdout.split('\n');
      const entries = [];
      let current = null;
      for (const line of lines) {
        if (line.match(/^[0-9a-f]{40}/)) {
          if (current) entries.push(current);
          const parts = line.split(' ');
          current = { hash: parts[0], origLine: parts[1], finalLine: parts[2] };
        } else if (current) {
          if (line.startsWith('author ')) current.author = line.substring(7);
          else if (line.startsWith('author-mail ')) current.email = line.substring(12).replace(/[<>]/g, '');
          else if (line.startsWith('author-time ')) current.timestamp = parseInt(line.substring(12)) * 1000;
          else if (line.startsWith('summary ')) current.summary = line.substring(8);
        }
      }
      if (current) entries.push(current);
      return { ok: true, file, dir, count: entries.length, entries: entries.slice(0, 500) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Git show (commit details) */
  async gitShow(args) {
    const { commit = 'HEAD', dir = '.', stat = true } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const { execFile } = require('child_process');
      const util = require('util');
      const exec = util.promisify(execFile);
      const gitArgs = ['show', '--no-color'];
      if (stat) gitArgs.push('--stat');
      gitArgs.push(commit);
      const { stdout } = await exec('git', gitArgs, { cwd: absDir, timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
      return { ok: true, dir, commit, output: stdout.slice(0, 20000) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** V18.1: Convert Windows path (C:\...) to WSL path (/mnt/c/...) */
  _toWSLPath(p) {
    if (!p) return p;
    // Already WSL
    if (p.startsWith('/')) return p;
    // Windows drive letter
    const m = p.match(/^([A-Za-z]):[\\/](.+)/);
    if (m) return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
    return p;
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

  // V19: Git workflow
  async gitCommit(args) {
    const { message, dir = '.', files = [], all = false, amend = false } = args || {};
    if (!message) return { ok: false, error: 'message required' };
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      if (files && files.length > 0) await this._gitExec(['add', ...files], cwd);
      else if (all) await this._gitExec(['add', '-A'], cwd);
      const gargs = ['commit', '-m', message];
      if (amend) gargs.push('--amend');
      await this._gitExec(gargs, cwd);
      const { stdout: hashOut } = await this._gitExec(['rev-parse', 'HEAD'], cwd);
      const { stdout: logOut } = await this._gitExec(['log', '-1', '--pretty=format:%h|%s'], cwd);
      const [sh, sj] = logOut.trim().split('|');
      return { ok: true, dir, hash: hashOut.trim(), shortHash: sh, subject: sj, message, amend };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitPush(args) {
    const { dir = '.', remote = 'origin', branch, force = false } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      const gargs = ['push'];
      if (force) gargs.push('--force');
      gargs.push(remote);
      if (branch) gargs.push(branch);
      const { stdout, stderr } = await this._gitExec(gargs, cwd);
      return { ok: true, dir, remote, branch, force, output: stdout || stderr };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitPull(args) {
    const { dir = '.', remote = 'origin', branch, rebase = false } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      const gargs = ['pull'];
      if (rebase) gargs.push('--rebase');
      gargs.push(remote);
      if (branch) gargs.push(branch);
      const { stdout, stderr } = await this._gitExec(gargs, cwd);
      return { ok: true, dir, remote, branch, rebase, output: stdout || stderr };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitBranch(args) {
    const { dir = '.', action = 'list', name, remote = false, force = false } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      if (action === 'list') {
        const gargs = ['branch'];
        if (remote) gargs.push('-a');
        const { stdout } = await this._gitExec(gargs, cwd);
        const branches = stdout.split('\n').filter(b => typeof b === 'string' && b.trim()).map(b => ({
          name: b.replace(/^[*\s]+/, '').trim(), current: b.startsWith('*'), remote: (typeof b === 'string' ? b.trim() : '').startsWith('remotes/'),
        }));
        return { ok: true, dir, branches, count: branches.length };
      } else if (action === 'create') {
        if (!name) return { ok: false, error: 'name required' };
        const { stdout } = await this._gitExec(['checkout', '-b', name], cwd);
        return { ok: true, dir, action: 'create', name, output: stdout };
      } else if (action === 'delete') {
        if (!name) return { ok: false, error: 'name required' };
        const gargs = ['branch', force ? '-D' : '-d', name];
        const { stdout } = await this._gitExec(gargs, cwd);
        return { ok: true, dir, action: 'delete', name, force, output: stdout };
      }
      return { ok: false, error: 'unknown action: ' + action };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitCheckout(args) {
    const { dir = '.', branch, create = false, file } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    if (!branch && !file) return { ok: false, error: 'branch or file required' };
    try {
      const cwd = this._toWSLPath(absDir);
      const gargs = ['checkout'];
      if (branch && create) gargs.push('-b', branch);
      else if (branch) gargs.push(branch);
      else if (file) gargs.push('--', file);
      const { stdout, stderr } = await this._gitExec(gargs, cwd);
      const { stdout: brOut } = await this._gitExec(['branch', '--show-current'], cwd);
      return { ok: true, dir, branch: brOut.trim() || null, create, file, output: stdout || stderr };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  // V20: Git workflow patterns
  async gitAutoCommit(args) {
    const { message, dir = '.', files = [] } = args || {};
    if (!message) return { ok: false, error: 'message required' };
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      if (files && files.length > 0) await this._gitExec(['add', ...files], cwd);
      const { stdout: stOut } = await this._gitExec(['status', '--short'], cwd);
      if (!stOut.trim()) return { ok: true, committed: false, reason: 'nothing to commit', dir };
      await this._gitExec(['commit', '-m', message], cwd);
      const { stdout: hashOut } = await this._gitExec(['rev-parse', 'HEAD'], cwd);
      const { stdout: logOut } = await this._gitExec(['log', '-1', '--pretty=format:%h|%s'], cwd);
      const [sh, sj] = logOut.trim().split('|');
      return { ok: true, committed: true, dir, hash: hashOut.trim(), shortHash: sh, subject: sj, message, filesChanged: stOut.trim().split('\n').length };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitSync(args) {
    const { dir = '.', remote = 'origin', branch, rebase = true } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      const { stdout: cb } = await this._gitExec(['branch', '--show-current'], cwd);
      const target = (branch || cb.trim());
      if (!target) return { ok: false, error: 'no branch' };
      const pull = await this._gitExec(['pull', rebase ? '--rebase' : '', remote, target].filter(Boolean), cwd);
      const push = await this._gitExec(['push', remote, target], cwd);
      return { ok: true, dir, remote, branch: target, pull: pull.stdout || pull.stderr, push: push.stdout || push.stderr };
    } catch (e) { return { ok: false, error: e.message, stderr: e.stderr }; }
  }

  async gitReleaseNotes(args) {
    const { dir = '.', limit = 10, fromRef, toRef = 'HEAD', format = 'md' } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      const range = fromRef ? (fromRef + '..' + toRef) : ('-' + limit);
      const { stdout } = await this._gitExec(['log', range, '--pretty=format:%H|%h|%an|%ae|%ad|%s', '--date=short'], cwd);
      const commits = stdout.split('\n').filter(l => l.trim()).map(line => {
        const [hash, shortHash, author, email, date, ...sp] = line.split('|');
        return { hash, shortHash, author, email, date, subject: sp.join('|') };
      });
      const r = fromRef ? (fromRef + '..' + toRef) : ('last ' + limit);
      if (format === 'json') return { ok: true, dir, range: r, commits };
      const lines = ['# Release Notes', '', 'Range: `' + r + '`', ''];
      for (const c of commits) lines.push('- `' + c.shortHash + '` ' + c.subject + ' (' + c.author + ', ' + c.date + ')');
      lines.push('', 'Total: ' + commits.length + ' commits');
      return { ok: true, dir, range: r, count: commits.length, notes: lines.join('\n') };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async gitDiffStat(args) {
    const { dir = '.', staged = false, file, fromRef, toRef } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      const gargs = ['diff', '--numstat', '--no-color'];
      if (staged) gargs.push('--staged');
      if (fromRef && toRef) gargs.push(fromRef, toRef);
      if (file) gargs.push('--', file);
      const { stdout } = await this._gitExec(gargs, cwd);
      const files = stdout.split('\n').filter(l => l.trim()).map(line => {
        const parts = line.split('\t');
        return { file: parts[2] || '', additions: parts[0] === '-' ? 0 : parseInt(parts[0]), deletions: parts[1] === '-' ? 0 : parseInt(parts[1]), binary: parts[0] === '-' || parts[1] === '-' };
      });
      return { ok: true, dir, files, count: files.length, totalAdditions: files.reduce((s, f) => s + f.additions, 0), totalDeletions: files.reduce((s, f) => s + f.deletions, 0) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async gitChangelog(args) {
    const { dir = '.', fromTag, toRef = 'HEAD' } = args || {};
    const absDir = this._safePath(dir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    try {
      const cwd = this._toWSLPath(absDir);
      let from = fromTag;
      if (!from) {
        try { const { stdout } = await this._gitExec(['describe', '--tags', '--abbrev=0', toRef], cwd); from = stdout.trim(); }
        catch (e) { const { stdout } = await this._gitExec(['rev-list', '--max-parents=0', 'HEAD'], cwd); from = stdout.trim().split('\n')[0]; }
      }
      const nr = await this.gitReleaseNotes({ dir: absDir, fromRef: from, toRef, format: 'md' });
      const ds = await this.gitDiffStat({ dir: absDir, fromRef: from, toRef });
      return { ok: true, dir, from, to: toRef, range: from + '..' + toRef, notes: nr.notes, stats: { files: ds.count, additions: ds.totalAdditions, deletions: ds.totalDeletions } };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async _gitExec(args, cwd) {
    const { execFile } = require('child_process');
    const exec = require('util').promisify(execFile);
    try {
      return await exec('git', args, { cwd, timeout: 30000, shell: true, env: Object.assign({}, process.env, { PATH: process.env.PATH + ':/usr/local/bin:/usr/bin:/mnt/c/Program Files/Git/cmd' }) });
    } catch (e1) {
      try { return await exec('/usr/bin/git', args, { cwd, timeout: 30000 }); } catch (e2) {
        return await exec('git.exe', args, { cwd, timeout: 30000, shell: true });
      }
    }
  }


  // V22: YouTube transcript via Python youtube-transcript-api
  async youtubeTranscript(args) {
    const { url, languages = 'ko,en', maxChars = 8000 } = args || {};
    if (!url) return { ok: false, error: 'url required' };
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
    if (!m) return { ok: false, error: 'invalid YouTube URL' };
    const videoId = m[1];
    try {
      const { spawn } = require('child_process');
      const pyScript = `from youtube_transcript_api import YouTubeTranscriptApi; import json; api = YouTubeTranscriptApi(); t = api.fetch('${videoId}', languages='${languages}'.split(',')); print(json.dumps({"segments":[{"text":s.text,"start":s.start,"duration":s.duration} for s in t[:200]], "video_id": "${videoId}"}))`;
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('python3', ['-c', pyScript]);
        let stdout = '', stderr = '';
        proc.stdout.on('data', (d) => stdout += d);
        proc.stderr.on('data', (d) => stderr += d);
        proc.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
        setTimeout(() => proc.kill(), 30000);
      });
      const data = JSON.parse(result);
      const fullText = data.segments.map(s => s.text).join(' ');
      return { ok: true, url, videoId, languages: languages.split(','), segmentCount: data.segments.length, fullText: fullText.slice(0, maxChars), totalChars: fullText.length };
    } catch (e) { return { ok: false, error: e.message, videoId }; }
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


  _gitBin() {
    const candidates = ['git', '/usr/bin/git', '/usr/local/bin/git', 'git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'];
    for (const c of candidates) {
      try { if (c.includes('/') || c.includes('\\')) require('fs').accessSync(c); return c; } catch {}
    }
    return 'git';
  }

}

module.exports = { CoworkService };