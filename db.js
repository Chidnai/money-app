// IndexedDB repository. Data stays on this device only.
import { newId, normalizeName, validateCategory, validateTransaction, validateMove, canDeleteMove, checkBackup, BACKUP_FORMAT, STORES_V3, META_KEYS, validateRecurring, validateSettings, validateOtHours, normalizeName as nn, DEFAULT_SETTINGS } from './logic.js';

export const DB_NAME = 'money-app';
export const DB_VERSION = 3;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function openDB(idb = globalThis.indexedDB, name = DB_NAME, onBlocked = null) {
  return new Promise((res, rej) => {
    const r = idb.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('categories')) d.createObjectStore('categories', { keyPath: 'id' }).createIndex('kind', 'kind');
      if (!d.objectStoreNames.contains('transactions')) {
        const s = d.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('categoryId', 'categoryId');
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      // v2: budgets (key = month|categoryId, amount null = no budget) + moves (borrow/repay/shift)
      if (!d.objectStoreNames.contains('budgets')) d.createObjectStore('budgets', { keyPath: 'key' }).createIndex('month', 'month');
      if (!d.objectStoreNames.contains('moves')) {
        const s = d.createObjectStore('moves', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      // v3: recurring expenses/installments, OT hours per day, monthly income plans
      if (!d.objectStoreNames.contains('recurring')) d.createObjectStore('recurring', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('otHours')) d.createObjectStore('otHours', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('plans')) d.createObjectStore('plans', { keyPath: 'month' });
    };
    r.onblocked = () => onBlocked?.();
    r.onsuccess = () => {
      const db = r.result;
      // release this connection when a newer app version needs to upgrade the database
      db.onversionchange = () => { db.close(); if (typeof location !== 'undefined') location.reload(); };
      res(db);
    };
    r.onerror = () => rej(r.error);
  });
}

export class Repo {
  constructor(db) { this.db = db; }
  store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); }

  // ---- categories
  async listCategories(kind) {
    const all = await req(this.store('categories').getAll());
    return all.filter((c) => !kind || c.kind === kind).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'th'));
  }
  async addCategory(kind, name) {
    const all = await this.listCategories();
    const err = validateCategory({ kind, name }, all);
    if (err) throw new Error(err);
    const order = all.filter((c) => c.kind === kind).reduce((m, c) => Math.max(m, c.order), -1) + 1;
    const cat = { id: newId(), kind, name: normalizeName(name), order, createdAt: Date.now() };
    await req(this.store('categories', 'readwrite').add(cat));
    return cat;
  }
  async renameCategory(id, name) {
    const all = await this.listCategories();
    const cat = all.find((c) => c.id === id);
    if (!cat) throw new Error('ไม่พบหมวดนี้');
    const err = validateCategory({ kind: cat.kind, name }, all, id);
    if (err) throw new Error(err);
    const upd = { ...cat, name: normalizeName(name) };
    await req(this.store('categories', 'readwrite').put(upd));
    return upd;
  }
  async countByCategory(id) {
    return req(this.store('transactions').index('categoryId').count(id));
  }
  async deleteCategory(id) {
    const moves = await this.listMoves();
    const nm = moves.filter((m) => m.fromId === id || m.toId === id).length;
    const n = (await this.countByCategory(id)) + nm;
    if (n > 0) throw new Error(`หมวดนี้มี ${n} รายการ จึงลบไม่ได้`);
    await req(this.store('categories', 'readwrite').delete(id));
  }

  // ---- transactions
  async listTransactions(month) {
    const range = month ? IDBKeyRange.bound(`${month}-01`, `${month}-31`) : undefined;
    return req(this.store('transactions').index('date').getAll(range));
  }
  async getTransaction(id) { return req(this.store('transactions').get(id)); }
  async saveTransaction(input) {
    const cats = await this.listCategories();
    const tx = {
      id: input.id || newId(),
      kind: input.kind, amount: input.amount, date: input.date,
      categoryId: input.categoryId, note: String(input.note ?? '').trim(),
      source: input.source || 'manual',
      createdAt: input.createdAt || Date.now(), updatedAt: Date.now(),
    };
    if (input.recurringId) { tx.recurringId = input.recurringId; tx.recurringMonth = input.recurringMonth; }
    const err = validateTransaction(tx, cats);
    if (err) throw new Error(err);
    await req(this.store('transactions', 'readwrite').put(tx));
    return tx;
  }
  async deleteTransaction(id) { await req(this.store('transactions', 'readwrite').delete(id)); }

  // ---- budgets
  async listBudgets() { return req(this.store('budgets').getAll()); }
  async setBudgets(month, entries) {
    // entries: [{categoryId, amount|null}] — writes explicit records for this month
    const st = this.store('budgets', 'readwrite');
    await Promise.all(entries.map((e) => req(st.put({ key: `${month}|${e.categoryId}`, month, categoryId: e.categoryId, amount: e.amount }))));
  }

  // ---- moves (borrow / repay / shift)
  async listMoves(month) {
    const range = month ? IDBKeyRange.bound(`${month}-01`, `${month}-31`) : undefined;
    return req(this.store('moves').index('date').getAll(range));
  }
  async getMove(id) { return req(this.store('moves').get(id)); }
  async saveMove(input) {
    const [cats, moves] = await Promise.all([this.listCategories(), this.listMoves()]);
    const mv = {
      id: input.id || newId(), type: input.type, fromId: input.fromId, toId: input.toId,
      amount: input.amount, date: input.date, note: String(input.note ?? '').trim(),
      source: input.source || 'manual', createdAt: input.createdAt || Date.now(), updatedAt: Date.now(),
    };
    const err = validateMove(mv, cats, moves);
    if (err) throw new Error(err);
    await req(this.store('moves', 'readwrite').put(mv));
    return mv;
  }
  async deleteMove(id) {
    const err = canDeleteMove(await this.listMoves(), id);
    if (err) throw new Error(err);
    await req(this.store('moves', 'readwrite').delete(id));
  }
  async listAllTransactions() { return this.listTransactions(); }

  // ---- convert between รายการ (tx) and ยืม-คืน (move), atomically
  async convertTxToMove(oldTx, input) {
    const [cats, moves] = await Promise.all([this.listCategories(), this.listMoves()]);
    const mv = { id: newId(), type: input.type, fromId: input.fromId, toId: input.toId, amount: input.amount, date: input.date,
      note: String(input.note ?? '').trim(), source: oldTx.source || 'manual', createdAt: oldTx.createdAt || Date.now(), updatedAt: Date.now() };
    const err = validateMove(mv, cats, moves);
    if (err) throw new Error(err);
    await this.swap('transactions', oldTx.id, 'moves', mv);
    return mv;
  }
  async convertMoveToTx(oldMv, input) {
    const [cats, moves] = await Promise.all([this.listCategories(), this.listMoves()]);
    const block = canDeleteMove(moves, oldMv.id);
    if (block) throw new Error(block);
    const tx = { id: newId(), kind: input.kind, amount: input.amount, date: input.date, categoryId: input.categoryId,
      note: String(input.note ?? '').trim(), source: oldMv.source || 'manual', createdAt: oldMv.createdAt || Date.now(), updatedAt: Date.now() };
    const err = validateTransaction(tx, cats);
    if (err) throw new Error(err);
    await this.swap('moves', oldMv.id, 'transactions', tx);
    return tx;
  }
  swap(delStore, delId, putStore, rec) {
    return new Promise((res, rej) => {
      const t = this.db.transaction([delStore, putStore], 'readwrite');
      t.objectStore(delStore).delete(delId);
      t.objectStore(putStore).put(rec);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }

  // ---- CP12 backup / restore
  async getMeta(key) { return (await req(this.store('meta').get(key)))?.value ?? null; }
  async setMeta(key, value) { await req(this.store('meta', 'readwrite').put({ key, value })); }
  async exportAll() {
    const names = ['categories', 'transactions', 'budgets', 'moves', ...STORES_V3];
    const t = this.db.transaction([...names, 'meta'], 'readonly');
    const data = {};
    await Promise.all(names.map(async (n) => { data[n] = await req(t.objectStore(n).getAll()); }));
    data.meta = (await req(t.objectStore('meta').getAll())).filter((m) => META_KEYS.includes(m.key));
    return { app: 'money-app', format: BACKUP_FORMAT, dbVersion: DB_VERSION, exportedAt: new Date().toISOString(), data };
  }
  async importAll(obj) {
    const chk = checkBackup(obj);
    if (chk.error) throw new Error(chk.error);
    const names = ['categories', 'transactions', 'budgets', 'moves', ...STORES_V3];
    await new Promise((res, rej) => {
      const t = this.db.transaction([...names, 'meta'], 'readwrite');
      for (const n of names) { const st = t.objectStore(n); st.clear(); for (const r of obj.data[n] || []) st.put(r); }
      const mt = t.objectStore('meta');
      for (const k of META_KEYS) mt.delete(k);
      for (const m of obj.data.meta || []) if (META_KEYS.includes(m.key)) mt.put(m);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
    return chk;
  }

  // ---- ชุด 3
  async getSettings() { return { ...DEFAULT_SETTINGS, ...((await this.getMeta('settings')) || {}) }; }
  async saveSettings(s) { const err = validateSettings(s); if (err) throw new Error(err); await this.setMeta('settings', s); }
  async getHolidays() { return ((await this.getMeta('holidays')) || []).slice().sort(); }
  async toggleHoliday(iso) {
    const h = new Set(await this.getHolidays());
    h.has(iso) ? h.delete(iso) : h.add(iso);
    await this.setMeta('holidays', [...h].sort());
  }
  async getPlanLinks() { return (await this.getMeta('planLinks')) || {}; }
  async setPlanLinks(l) { await this.setMeta('planLinks', l); }

  async listRecurring() { return (await req(this.store('recurring').getAll())).sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name, 'th')); }
  async saveRecurring(input) {
    const cats = await this.listCategories();
    const it = { id: input.id || newId(), name: nn(input.name), categoryId: input.categoryId, dueDay: input.dueDay, mode: input.mode,
      amount: input.mode === 'fixed' ? input.amount : null, schedule: input.mode === 'installment' ? input.schedule : {},
      startMonth: input.startMonth, autoPay: !!input.autoPay, createdAt: input.createdAt || Date.now() };
    const err = validateRecurring(it, cats);
    if (err) throw new Error(err);
    await req(this.store('recurring', 'readwrite').put(it));
    return it;
  }
  async deleteRecurring(id) { await req(this.store('recurring', 'readwrite').delete(id)); }

  async getOtHours() { const all = await req(this.store('otHours').getAll()); return Object.fromEntries(all.map((r) => [r.date, r.hours])); }
  async setOtHours(date, hours) {
    const err = validateOtHours(hours); if (err) throw new Error(err);
    const st = this.store('otHours', 'readwrite');
    await req(Number(hours) ? st.put({ date, hours: Number(hours) }) : st.delete(date));
  }

  async listPlans() { return req(this.store('plans').getAll()); }
  async savePlan(month, patch) {
    const cur = (await req(this.store('plans').get(month))) || { month, salary: null, other: 0 };
    await req(this.store('plans', 'readwrite').put({ ...cur, ...patch, month }));
  }
}
