// src/agent/cowork.js — V12 Cowork: Files + Browser + AI 통합
//
// BrowserOS Cowork의 강화 버전. 로컬 파일 시스템과 AI 에이전트 통합.
// BLDC 회로 데이터, BOM, datasheet, Gerber, CAD 자동 context.

const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class CoworkService {
  constructor({ workspaceRoot, maxFileSize = 5 * 1024 * 1024, maxResults = 100 }) {
    this.workspaceRoot = workspaceRoot || process.cwd();
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
      const flags = ignoreCase ? '-irEn' : '-rEn';
      const args2 = [flags, '--include=*', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build'];
      if (includePattern) args2.push(`--include=${includePattern}`);
      if (excludePattern) args2.push(`--exclude=${excludePattern}`);
      args2.push(pattern);
      args2.push(absDir);
      const { stdout, stderr } = await execFileAsync('grep', args2, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
      const lines = stdout.split('\n').filter(Boolean).slice(0, maxResults);
      const matches = lines.map(l => {
        const m = l.match(/^(.+?):(\d+):(.*)$/);
        if (m) return { file: path.relative(this.workspaceRoot, m[1]), line: parseInt(m[2]), content: m[3] };
        return { raw: l };
      });
      return { ok: true, pattern, count: matches.length, matches, truncated: lines.length === maxResults };
    } catch (e) {
      // grep returns 1 when no match found — treat as ok with empty result
      if (e.code === 1) return { ok: true, pattern, count: 0, matches: [] };
      return { ok: false, error: e.message };
    }
  }

  async searchFiles(args) {
    const { path: searchDir = '.', namePattern, contentPattern, recursive = true, maxResults = 50 } = args || {};
    const absDir = this._safePath(searchDir);
    if (!absDir) return { ok: false, error: 'unsafe path' };
    if (!namePattern && !contentPattern) return { ok: false, error: 'namePattern or contentPattern required' };
    try {
      let results = [];
      if (namePattern) {
        // Use find for name matching
        const { stdout } = await execFileAsync('find', [
          absDir,
          recursive ? '' : '-maxdepth', recursive ? '' : '1',
          ...(recursive ? [] : ['-maxdepth', '1']),
          '-type', 'f',
          '-name', namePattern,
        ], { maxBuffer: 10 * 1024 * 1024 });
        results = stdout.split('\n').filter(Boolean).map(p => ({
          path: path.relative(this.workspaceRoot, p),
          size: null,
          matchType: 'name',
        }));
      }
      if (contentPattern) {
        const grepres = await this.grepFiles({ path: searchDir, pattern: contentPattern, maxResults });
        if (grepres.ok) {
          for (const m of grepres.matches) {
            if (m.file) results.push({ path: m.file, line: m.line, content: m.content, matchType: 'content' });
          }
        }
      }
      // Dedup by path
      const seen = new Set();
      const deduped = [];
      for (const r of results) {
        if (!seen.has(r.path)) { seen.add(r.path); deduped.push(r); }
      }
      return { ok: true, count: deduped.length, results: deduped.slice(0, maxResults) };
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
    const abs = path.isAbsolute(p) ? p : path.resolve(this.workspaceRoot, p);
    const normalized = path.normalize(abs);
    // Allow common safe paths (workspaces, projects, tmp)
    const allowed = [
      this.workspaceRoot,
      path.normalize(this.workspaceRoot),
      process.cwd(),
      '/tmp', '/home/taewoo',
      '/home/taewoo/projects',
      '/home/taewoo/projects/hermes-browser',
      '/mnt/c/Users/qqwer',
      '/mnt/c/Users/qqwer/Desktop/Hermes',
      '/mnt/c/Users/qqwer/Hermes-Workspace',
      '/mnt/c/Users/qqwer/Desktop',
    ];
    const ok = allowed.some(root => {
      const r = path.normalize(root);
      return normalized.startsWith(r) || r.startsWith(normalized);
    });
    if (!ok) return null;
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