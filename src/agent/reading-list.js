// src/agent/reading-list.js — Offline-capable reading list
//
// Stores articles with optional HTML snapshot for offline access.
// Persists to userDataPath/reading-list/items.json.
// Snapshots stored alongside as <id>.html.
//
// Designed for:
//   - "Save for later" workflow
//   - Offline access during commute / travel
//   - Headline + URL capture for quick triage

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ReadingList {
  constructor({ userDataPath }) {
    this.dir = path.join(userDataPath, 'reading-list');
    this.itemsPath = path.join(this.dir, 'items.json');
    this.items = [];
    this._loaded = false;
  }

  async load() {
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
      const raw = await fs.promises.readFile(this.itemsPath, 'utf8');
      this.items = JSON.parse(raw);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.items = [];
    }
    this._loaded = true;
    return this.items;
  }

  async save() {
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.writeFile(
      this.itemsPath,
      JSON.stringify(this.items, null, 2)
    );
  }

  _newId() {
    return 'r-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  }

  /**
   * Add an article. Optional html snapshot for offline.
   * @param {object} entry - { url, title, html?, description?, tags? }
   * @returns {object} the added item
   */
  async add(entry) {
    if (!entry?.url) throw new Error('url required');
    // De-dupe by URL
    const existing = this.items.find(i => i.url === entry.url);
    if (existing) {
      // Update metadata from new entry (so callers can use add() as upsert)
      if (entry.title) existing.title = entry.title;
      if (entry.description !== undefined) existing.description = entry.description;
      if (Array.isArray(entry.tags) && entry.tags.length) existing.tags = entry.tags;
      // Update snapshot if newer html provided
      if (entry.html && entry.html !== existing.htmlRef) {
        await this._writeSnapshot(existing.id, entry.html);
        existing.htmlRef = existing.id + '.html';
      }
      existing.updatedAt = new Date().toISOString();
      await this.save();
      return existing;
    }
    const id = this._newId();
    const item = {
      id,
      url: entry.url,
      title: entry.title || entry.url,
      description: entry.description || '',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      addedAt: new Date().toISOString(),
      read: false,
      readAt: null,
      htmlRef: null,
    };
    if (entry.html) {
      await this._writeSnapshot(id, entry.html);
      item.htmlRef = id + '.html';
    }
    this.items.unshift(item);  // newest first
    await this.save();
    return item;
  }

  async _writeSnapshot(id, html) {
    const snapPath = path.join(this.dir, id + '.html');
    await fs.promises.writeFile(snapPath, html, 'utf8');
  }

  async remove(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    const item = this.items[idx];
    this.items.splice(idx, 1);
    // Remove snapshot file if exists
    if (item.htmlRef) {
      try {
        await fs.promises.unlink(path.join(this.dir, item.htmlRef));
      } catch (e) { /* ignore */ }
    }
    await this.save();
    return true;
  }

  markRead(id, read = true) {
    const item = this.items.find(i => i.id === id);
    if (!item) return null;
    item.read = read;
    item.readAt = read ? new Date().toISOString() : null;
    // Save async — fire and forget (caller doesn't await)
    this.save().catch(e => console.error('[reading-list] save failed:', e.message));
    return item;
  }

  list({ unreadOnly = false, tag = null } = {}) {
    return this.items.filter(i => {
      if (unreadOnly && i.read) return false;
      if (tag && !i.tags.includes(tag)) return false;
      return true;
    });
  }

  async getSnapshot(id) {
    const item = this.items.find(i => i.id === id);
    if (!item || !item.htmlRef) return null;
    try {
      return await fs.promises.readFile(path.join(this.dir, item.htmlRef), 'utf8');
    } catch (e) {
      return null;
    }
  }

  /**
   * Resolve a file:// URL pointing at the offline snapshot, suitable for
   * loading in a tab. Returns null if no snapshot.
   */
  getOfflineUrl(id) {
    const item = this.items.find(i => i.id === id);
    if (!item || !item.htmlRef) return null;
    return 'file://' + path.join(this.dir, item.htmlRef);
  }

  /**
   * Cleanup entries older than maxAgeDays that have been read.
   * Returns number removed.
   */
  async cleanup({ maxAgeDays = 30, keepUnread = true } = {}) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const before = this.items.length;
    const toRemove = [];
    this.items = this.items.filter(i => {
      const isOld = new Date(i.addedAt).getTime() < cutoff;
      const isRead = i.read;
      const shouldRemove = isOld && (isRead || !keepUnread);
      if (shouldRemove) toRemove.push(i);
      return !shouldRemove;
    });
    // Remove snapshot files
    for (const item of toRemove) {
      if (item.htmlRef) {
        try {
          await fs.promises.unlink(path.join(this.dir, item.htmlRef));
        } catch (e) { /* ignore */ }
      }
    }
    if (toRemove.length > 0) await this.save();
    return before - this.items.length;
  }
}

module.exports = { ReadingList };