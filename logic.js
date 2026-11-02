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

// ---------------- CP12 backup ----------------
export const BACKUP_FORMAT = 2;
const STORES = ['categories', 'transactions', 'budgets', 'moves'];
export const STORES_V3 = ['recurring', 'otHours', 'plans'];
export const META_KEYS = ['settings', 'holidays', 'planLinks'];

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `money-backup-${now.getFullYear() + 543}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

// Returns { error } or { counts, exportedAt }
export function checkBackup(obj) {
  if (!obj || obj.app !== 'money-app' || typeof obj.data !== 'object') return { error: 'ไม่ใช่ไฟล์สำรองของแอพนี้' };
  if (obj.format > BACKUP_FORMAT) return { error: 'ไฟล์มาจากแอพเวอร์ชันใหม่กว่า ให้อัปเดตแอพก่อน' };
  for (const s of STORES) if (!Array.isArray(obj.data[s])) return { error: `ไฟล์ไม่สมบูรณ์ (ไม่มี ${s})` };
  for (const s of STORES_V3) if (obj.data[s] !== undefined && !Array.isArray(obj.data[s])) return { error: `ไฟล์ไม่สมบูรณ์ (${s})` };
  const d = obj.data;
  const catIds = new Set(d.categories.map((c) => c.id));
  if (d.categories.some((c) => !c.id || !KINDS.includes(c.kind) || !c.name)) return { error: 'ข้อมูลหมวดในไฟล์เสีย' };
  if (d.transactions.some((t) => !t.id || !Number.isSafeInteger(t.amount) || !isValidISODate(t.date) || !catIds.has(t.categoryId))) return { error: 'ข้อมูลรายการในไฟล์เสีย' };
  if (d.moves.some((m) => !m.id || !MOVE_TYPES.includes(m.type) || !Number.isSafeInteger(m.amount) || !catIds.has(m.fromId) || !catIds.has(m.toId))) return { error: 'ข้อมูลยืม-คืนในไฟล์เสีย' };
  if (d.budgets.some((b) => !b.key || !/^\d{4}-\d{2}$/.test(b.month) || !catIds.has(b.categoryId))) return { error: 'ข้อมูลงบในไฟล์เสีย' };
  return {
    exportedAt: obj.exportedAt,
    counts: { categories: d.categories.length, transactions: d.transactions.length, moves: d.moves.length, budgetMonths: new Set(d.budgets.map((b) => b.month)).size, recurring: (d.recurring || []).length },
  };
}

// ---------------- ชุด 3: CP8–CP11 ----------------
export const DEFAULT_SETTINGS = { baseRate: 13750, wdMul: 1.5, hdMul1: 1, hdHours: 8, hdMul2: 3, cycleStart: 16, payDay: 26, dueWarnDays: 3 };
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dowOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const dowLabel = (iso) => TH_DOW[dowOf(iso)];
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Pay date of a month: payDay (clipped); Sat → Fri, Sun → Fri
export function payDate(month, s = DEFAULT_SETTINGS) {
  const [y, m] = month.split('-').map(Number);
  const iso = isoOf(y, m, Math.min(s.payDay, daysIn(y, m)));
  const w = dowOf(iso);
  return w === 6 ? addDays(iso, -1) : w === 0 ? addDays(iso, -2) : iso;
}

// OT cycle paid in `month`: (cycleStart of previous month) .. (cycleStart-1 of this month)
export function otCycle(month, s = DEFAULT_SETTINGS) {
  const prev = shiftMonth(month, -1);
  const [py, pm] = prev.split('-').map(Number), [y, m] = month.split('-').map(Number);
  return { start: isoOf(py, pm, Math.min(s.cycleStart, daysIn(py, pm))), end: addDays(isoOf(y, m, Math.min(s.cycleStart, daysIn(y, m))), -1) };
}

export const isHolidayLike = (iso, holidays = []) => { const w = dowOf(iso); return w === 0 || w === 6 || holidays.includes(iso); };

// hours: { 'YYYY-MM-DD': number }. Returns satang totals.
export function otPay(month, hours, s = DEFAULT_SETTINGS, holidays = []) {
  const { start, end } = otCycle(month, s);
  let wdH = 0, hd1H = 0, hd2H = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const h = Number(hours[d] || 0);
    if (!h) continue;
    if (isHolidayLike(d, holidays)) { hd1H += Math.min(h, s.hdHours); hd2H += Math.max(0, h - s.hdHours); } else wdH += h;
  }
  const wd = Math.round(wdH * s.baseRate * s.wdMul), hd1 = Math.round(hd1H * s.baseRate * s.hdMul1), hd2 = Math.round(hd2H * s.baseRate * s.hdMul2);
  return { start, end, wdH, hd1H, hd2H, wd, hd1, hd2, hours: wdH + hd1H + hd2H, total: wd + hd1 + hd2 };
}

export function validateOtHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0 || n > 24) return 'ชั่วโมงต้องอยู่ระหว่าง 0–24';
  if (Math.round(n * 4) !== n * 4) return 'ใส่ชั่วโมงทีละ 0.25 (15 นาที)';
  return null;
}

export function validateSettings(s) {
  if (!Number.isSafeInteger(s.baseRate) || s.baseRate <= 0) return 'อัตราฐานต้องมากกว่า 0';
  for (const k of ['wdMul', 'hdMul1', 'hdMul2']) if (!(s[k] > 0 && s[k] <= 10)) return 'ตัวคูณต้องอยู่ระหว่าง 0–10';
  if (!(s.hdHours >= 0 && s.hdHours <= 24)) return 'ชั่วโมงแรกของวันหยุดต้องอยู่ระหว่าง 0–24';
  if (!(Number.isInteger(s.cycleStart) && s.cycleStart >= 1 && s.cycleStart <= 28)) return 'วันเริ่มรอบต้องเป็น 1–28';
  if (!(Number.isInteger(s.payDay) && s.payDay >= 1 && s.payDay <= 31)) return 'วันเงินออกต้องเป็น 1–31';
  if (!(Number.isInteger(s.dueWarnDays) && s.dueWarnDays >= 0 && s.dueWarnDays <= 15)) return 'วันเตือนต้องเป็น 0–15';
  return null;
}

// ---- CP8/CP9 recurring (fixed + installment)
// item: { id, name, categoryId, dueDay, mode:'fixed'|'installment', amount, schedule:{'YYYY-MM':satang}, startMonth, autoPay }
export function recurringAmount(item, month) {
  if (month < item.startMonth) return 0;
  if (item.mode === 'installment') return item.schedule?.[month] || 0;
  return item.amount || 0;
}
export function dueDate(item, month) {
  const [y, m] = month.split('-').map(Number);
  return isoOf(y, m, Math.min(item.dueDay, daysIn(y, m)));
}
export function installmentEnd(item) {
  const ms = Object.keys(item.schedule || {}).filter((k) => item.schedule[k] > 0).sort();
  return ms.length ? ms[ms.length - 1] : null;
}
export function validateRecurring(it, categories = []) {
  if (!normalizeName(it.name)) return 'กรุณาใส่ชื่อ';
  if (String(it.name).length > 40) return 'ชื่อยาวเกิน 40 ตัวอักษร';
  const c = categories.find((x) => x.id === it.categoryId);
  if (!c || c.kind !== 'out') return 'กรุณาเลือกหมวดรายจ่าย';
  if (!(Number.isInteger(it.dueDay) && it.dueDay >= 1 && it.dueDay <= 31)) return 'วันครบกำหนดต้องเป็น 1–31';
  if (!/^\d{4}-\d{2}$/.test(it.startMonth || '')) return 'เดือนเริ่มไม่ถูกต้อง';
  if (it.mode === 'fixed') { if (!Number.isSafeInteger(it.amount) || it.amount <= 0) return 'จำนวนเงินต้องมากกว่า 0'; }
  else if (it.mode === 'installment') {
    const v = Object.values(it.schedule || {});
    if (!v.some((x) => x > 0)) return 'ใส่ยอดผ่อนอย่างน้อย 1 เดือน';
    if (v.some((x) => !Number.isSafeInteger(x) || x < 0)) return 'ยอดผ่อนไม่ถูกต้อง';
  } else return 'ประเภทไม่ถูกต้อง';
  return null;
}

/** Status of each recurring item for `month`: amount, due, paid tx (if any), warn state relative to `today`. */
export function recurringStatus(items, txs, month, today, warnDays = 3) {
  return items.map((it) => {
    const amount = recurringAmount(it, month);
    const due = dueDate(it, month);
    const paidTx = txs.find((t) => t.recurringId === it.id && t.recurringMonth === month) || null;
    const daysLeft = Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
    const state = !amount ? 'none' : paidTx ? 'paid' : daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'soon' : 'upcoming';
    return { item: it, amount, due, paidTx, daysLeft, state };
  }).filter((r) => r.amount > 0 || r.paidTx);
}

/** Auto-pay: transactions to create for items with autoPay whose due date ≤ today and not yet paid (from startMonth to today's month). */
export function autoPayDue(items, txs, today) {
  const out = [], cur = monthKey(today);
  for (const it of items) {
    if (!it.autoPay) continue;
    for (let m = it.startMonth; m <= cur; m = shiftMonth(m, 1)) {
      const amount = recurringAmount(it, m), due = dueDate(it, m);
      if (!amount || due > today) continue;
      if (txs.some((t) => t.recurringId === it.id && t.recurringMonth === m)) continue;
      out.push({ kind: 'out', amount, date: due, categoryId: it.categoryId, note: it.name, source: 'auto', recurringId: it.id, recurringMonth: m });
    }
  }
  return out;
}

// ---- CP10 income plan
// plans: [{ month, salary|null, other }] ; salary copies forward; links: { salaryCatId, otCatId }
export function effectiveSalary(plans, month) {
  let best = null;
  for (const p of plans) if (p.month <= month && p.salary != null && (!best || p.month > best.month)) best = p;
  return best ? best.salary : 0;
}
export function incomePlan({ month, plans, links = {}, txs, items, hours, settings = DEFAULT_SETTINGS, holidays = [] }) {
  const salary = effectiveSalary(plans, month);
  const other = plans.find((p) => p.month === month)?.other || 0;
  const ot = otPay(month, hours, settings, holidays);
  const planTotal = salary + ot.total + other;
  const inc = txs.filter((t) => t.kind === 'in' && monthKey(t.date) === month);
  const sum = (f) => inc.filter(f).reduce((a, t) => a + t.amount, 0);
  const actSalary = links.salaryCatId ? sum((t) => t.categoryId === links.salaryCatId) : 0;
  const actOt = links.otCatId ? sum((t) => t.categoryId === links.otCatId) : 0;
  const actTotal = sum(() => true);
  const fixedTotal = items.reduce((a, it) => a + recurringAmount(it, month), 0);
  return {
    month, payDate: payDate(month, settings), salary, other, ot, planTotal, fixedTotal,
    remaining: planTotal - fixedTotal,
    actual: { salary: actSalary, ot: actOt, other: actTotal - actSalary - actOt, total: actTotal },
    toCome: Math.max(0, planTotal - actTotal),
  };
}
