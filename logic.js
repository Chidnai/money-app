// Pure logic (no DOM, no storage). Amounts are integer satang.

export function parseAmount(input) {
  const s = String(input ?? '').replace(/[,\s฿]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [b, f = ''] = s.split('.');
  const v = Number(b) * 100 + Number((f + '00').slice(0, 2));
  return v > 0 && Number.isSafeInteger(v) ? v : null;
}

export function formatBaht(satang, { decimals = 'auto' } = {}) {
  const n = (satang || 0) / 100;
  const frac = decimals === 'auto' ? (satang % 100 ? 2 : 0) : decimals;
  return n.toLocaleString('th-TH', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

export const monthKey = (isoDate) => String(isoDate).slice(0, 7);

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${TH_MONTHS[m - 1]} ${y + 543}`;
}
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${String(y + 543).slice(2)}`;
}

export function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const KINDS = ['in', 'out'];

export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

export function validateCategory({ kind, name }, existing = [], selfId = null) {
  const n = normalizeName(name);
  if (!KINDS.includes(kind)) return 'ประเภทหมวดไม่ถูกต้อง';
  if (!n) return 'กรุณาใส่ชื่อหมวด';
  if (n.length > 40) return 'ชื่อหมวดยาวเกิน 40 ตัวอักษร';
  const dup = existing.some((c) => c.kind === kind && c.id !== selfId && c.name.toLowerCase() === n.toLowerCase());
  if (dup) return 'มีหมวดชื่อนี้อยู่แล้ว';
  return null;
}

export function validateTransaction(tx, categories = []) {
  if (!KINDS.includes(tx.kind)) return 'ประเภทรายการไม่ถูกต้อง';
  if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0';
  if (!isValidISODate(tx.date)) return 'วันที่ไม่ถูกต้อง';
  const cat = categories.find((c) => c.id === tx.categoryId);
  if (!cat) return 'กรุณาเลือกหมวดหมู่';
  if (cat.kind !== tx.kind) return 'หมวดไม่ตรงกับประเภทรายการ';
  if (String(tx.note ?? '').length > 200) return 'หมายเหตุยาวเกิน 200 ตัวอักษร';
  return null;
}

export function summarize(txs) {
  let income = 0, expense = 0;
  for (const t of txs) t.kind === 'in' ? (income += t.amount) : (expense += t.amount);
  return { income, expense, balance: income - expense };
}

// newest date first; within a day, newest created first
export function groupByDate(txs) {
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const out = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else out.push({ date: t.date, items: [t] });
  }
  return out;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------------- CP5–CP7 ----------------
export const MOVE_TYPES = ['borrow', 'repay', 'shift'];
export const MOVE_LABEL = { borrow: 'ยืม', repay: 'คืน', shift: 'ย้ายงบ' };

export function tierOf(pct) {
  if (pct >= 100) return 'over';
  if (pct >= 80) return 'alert';
  if (pct >= 60) return 'warn';
  return 'ok';
}
export const TIER_LABEL = { ok: 'ปลอดภัย', warn: 'ระวัง', alert: 'ใกล้เกิน', over: 'เกินงบ' };

// Effective budget = latest record with month <= target (copy-forward). amount null = explicitly "no budget".
export function effectiveBudget(budgets, categoryId, month) {
  let best = null;
  for (const b of budgets) if (b.categoryId === categoryId && b.month <= month && (!best || b.month > best.month)) best = b;
  return best ? best.amount : null;
}

// Outstanding debts: borrow(from A → to B) means B owes A; repay(from B → to A) reduces it. shift creates no debt.
export function outstandingDebts(moves, excludeId = null) {
  const m = new Map();
  for (const mv of moves) {
    if (mv.id === excludeId) continue;
    if (mv.type === 'borrow') { const k = `${mv.toId}|${mv.fromId}`; m.set(k, (m.get(k) || 0) + mv.amount); }
    else if (mv.type === 'repay') { const k = `${mv.fromId}|${mv.toId}`; m.set(k, (m.get(k) || 0) - mv.amount); }
  }
  return [...m].filter(([, v]) => v > 0).map(([k, amount]) => { const [debtorId, creditorId] = k.split('|'); return { debtorId, creditorId, amount }; });
}

// Net debt debtor→creditor (may be negative if data inconsistent)
export function pairNet(moves, debtorId, creditorId, excludeId = null) {
  let n = 0;
  for (const m of moves) {
    if (m.id === excludeId) continue;
    if (m.type === 'borrow' && m.toId === debtorId && m.fromId === creditorId) n += m.amount;
    if (m.type === 'repay' && m.fromId === debtorId && m.toId === creditorId) n -= m.amount;
  }
  return n;
}

export function validateMove(mv, categories = [], moves = []) {
  if (!MOVE_TYPES.includes(mv.type)) return 'ประเภทการยืม-คืนไม่ถูกต้อง';
  if (!Number.isSafeInteger(mv.amount) || mv.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0';
  if (!isValidISODate(mv.date)) return 'วันที่ไม่ถูกต้อง';
  const from = categories.find((c) => c.id === mv.fromId), to = categories.find((c) => c.id === mv.toId);
  if (!from || !to) return 'กรุณาเลือกหมวดต้นทางและปลายทาง';
  if (from.kind !== 'out' || to.kind !== 'out') return 'ยืม-คืนได้เฉพาะหมวดรายจ่าย';
  if (mv.fromId === mv.toId) return 'หมวดต้นทางและปลายทางต้องต่างกัน';
  if (String(mv.note ?? '').length > 200) return 'หมายเหตุยาวเกิน 200 ตัวอักษร';
  if (mv.type === 'repay') {
    const owed = outstandingDebts(moves, mv.id).find((d) => d.debtorId === mv.fromId && d.creditorId === mv.toId)?.amount || 0;
    if (owed <= 0) return 'ไม่มียอดค้างคืนระหว่างสองหมวดนี้';
    if (mv.amount > owed) return `คืนได้ไม่เกินยอดค้าง ${formatBaht(owed)} บาท`;
  }
  if (mv.type === 'borrow' && pairNet(moves, mv.toId, mv.fromId, mv.id) + mv.amount < 0) return 'ยอดยืมน้อยกว่ายอดที่คืนไปแล้ว';
  // editing an existing borrow/repay must not break other pair balances
  const old = moves.find((m) => m.id === mv.id);
  if (old && old.type === 'borrow' && (old.fromId !== mv.fromId || old.toId !== mv.toId || mv.type !== 'borrow')
      && pairNet(moves, old.toId, old.fromId, old.id) < 0) return 'มีรายการคืนของยอดยืมนี้อยู่ ให้ลบรายการคืนก่อน';
  return null;
}

/**
 * Budget status per expense category for `month`.
 * avail = budget + carry + movedIn − movedOut ; left = avail − used ; carry(next) = left.
 * Months where a category has no budget: no %/colour and carry resets to 0.
 */
export function budgetStatus({ categories, budgets, txs, moves, month }) {
  const cats = categories.filter((c) => c.kind === 'out');
  const months = [...budgets.map((b) => b.month), ...txs.map((t) => monthKey(t.date)), ...moves.map((m) => monthKey(m.date))].filter((m) => m <= month);
  let cur = months.length ? months.reduce((a, b) => (a < b ? a : b)) : month;
  const usedBy = new Map(), inBy = new Map(), outBy = new Map();
  const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
  for (const t of txs) if (t.kind === 'out') add(usedBy, `${monthKey(t.date)}|${t.categoryId}`, t.amount);
  for (const m of moves) { const mk = monthKey(m.date); add(inBy, `${mk}|${m.toId}`, m.amount); add(outBy, `${mk}|${m.fromId}`, m.amount); }
  const carry = new Map();
  let result = [];
  for (;;) {
    result = cats.map((c) => {
      const k = `${cur}|${c.id}`;
      const budget = effectiveBudget(budgets, c.id, cur);
      const used = usedBy.get(k) || 0, movedIn = inBy.get(k) || 0, movedOut = outBy.get(k) || 0;
      if (budget === null) { carry.set(c.id, 0); return { categoryId: c.id, name: c.name, budget: null, carry: 0, movedIn, movedOut, used, avail: null, left: null, pct: null, tier: null }; }
      const cIn = carry.get(c.id) || 0;
      const avail = budget + cIn + movedIn - movedOut, left = avail - used;
      carry.set(c.id, left);
      const ratio = avail > 0 ? (used / avail) * 100 : (left < 0 ? 100 : 0);
      const pct = Math.floor(ratio * 10) / 10; // 1 decimal, never rounds up into the next tier
      return { categoryId: c.id, name: c.name, budget, carry: cIn, movedIn, movedOut, used, avail, left, pct, tier: tierOf(ratio) };
    });
    if (cur >= month) break;
    cur = shiftMonth(cur, 1);
  }
  return result;
}

export function canDeleteMove(moves, id) {
  const m = moves.find((x) => x.id === id);
  if (m && m.type === 'borrow' && pairNet(moves, m.toId, m.fromId, id) < 0) return 'มีรายการคืนของยอดยืมนี้อยู่ ให้ลบรายการคืนก่อน';
  return null;
}

export function monthlySeries(txs, endMonth, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(endMonth, -i);
    out.push({ month: m, ...summarize(txs.filter((t) => monthKey(t.date) === m)) });
  }
  return out;
}
