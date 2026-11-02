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
