// IndexedDB repository. Data stays on this device only.
import { newId, normalizeName, validateCategory, validateTransaction, validateMove, canDeleteMove } from './logic.js';

export const DB_NAME = 'money-app';
export const DB_VERSION = 2;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function openDB(idb = globalThis.indexedDB, name = DB_NAME) {
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
    };
    r.onsuccess = () => res(r.result);
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
}
