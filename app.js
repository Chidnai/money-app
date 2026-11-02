// UI controller (CP1–CP3, CP5–CP7)
import { openDB, Repo } from './db.js';
import {
  parseAmount, formatBaht, monthKey, shiftMonth, todayISO, monthLabel, dayLabel, summarize, groupByDate,
  budgetStatus, outstandingDebts, monthlySeries, effectiveBudget, pairNet, TIER_LABEL, MOVE_LABEL, backupFileName, checkBackup,
  payDate, otPay, otCycle, dowLabel, addDays, isHolidayLike, recurringStatus, recurringAmount, autoPayDue, installmentEnd, incomePlan,
} from './logic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TITLES = { home: 'ภาพรวม', list: 'รายการ', add: 'เพิ่มรายการ', cat: 'หมวดหมู่', more: 'แผน / OT', bud: 'ตั้งงบ' };
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MOVE_TEXT = {
  borrow: ['ยืมจากหมวด (ใช้ได้ลดลง)', 'ไปให้หมวด (ใช้ได้เพิ่มขึ้น)', 'ยอดนี้จะค้างคืนจนกว่าจะบันทึกคืน', 'บันทึกการยืม'],
  repay: ['หมวดที่คืน (ใช้ได้ลดลง)', 'คืนให้หมวด (ใช้ได้เพิ่มขึ้น)', 'คืนได้ไม่เกินยอดที่ค้าง · คืนบางส่วนได้', 'บันทึกการคืน'],
  shift: ['ย้ายงบจากหมวด', 'ไปหมวด', 'ย้ายถาวร ไม่เกิดยอดค้างคืน', 'บันทึกการย้ายงบ'],
};

const S = { sub: 'plan', fxEdit: null, fxMode: 'fixed', otDay: null, recLink: null, month: monthKey(todayISO()), view: 'home', kind: 'out', mtype: 'borrow', catKind: 'out', catId: null, editing: null, renaming: null, confirmDel: null, cats: [] };
let repo;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2400);
}

function go(view) {
  S.view = view;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.v !== view));
  $('ttl').textContent = view === 'add' && S.editing ? 'แก้ไขรายการ' : TITLES[view];
  window.scrollTo(0, 0);
  render();
}

async function render() {
  S.cats = await repo.listCategories();
  $('m-label').textContent = monthLabel(S.month);
  if (S.view === 'home') return renderHome();
  if (S.view === 'list') return renderList();
  if (S.view === 'add') return renderForm();
  if (S.view === 'cat') return renderCats();
  if (S.view === 'bud') return renderBudgetForm();
  if (S.view === 'more') return renderMore();
}

// ---------- ชุด 3 helpers
const dLabel = (iso) => `${dowLabel(iso)} ${dayLabel(iso)}`;
const bahtIn = (v) => (v === '' || v == null ? null : parseAmount(String(v)));
const numIn = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(/,/g, '')));
async function runAutoPay() {
  const [items, txs] = await Promise.all([repo.listRecurring(), repo.listTransactions()]);
  const todo = autoPayDue(items, txs, todayISO());
  for (const t of todo) { try { await repo.saveTransaction(t); } catch { /* category removed etc. */ } }
  if (todo.length) toast(`หักรายจ่ายประจำอัตโนมัติ ${todo.length} รายการ`);
}
async function renderDue(el, compact) {
  const today = todayISO(), m = monthKey(today);
  const [items, txs, st] = await Promise.all([repo.listRecurring(), repo.listTransactions(), repo.getSettings()]);
  const rows = [...recurringStatus(items, txs, shiftMonth(m, -1), today, st.dueWarnDays), ...recurringStatus(items, txs, m, today, st.dueWarnDays)]
    .filter((r) => r.state === 'soon' || r.state === 'overdue');
  if (!rows.length) { el.innerHTML = ''; return; }
  const over = rows.some((r) => r.state === 'overdue');
  el.innerHTML = `<div class="panel" style="display:flex;gap:10px;align-items:center;border-color:var(--${over ? 'over' : 'alert'});background:var(--${over ? 'over' : 'alert'}-bg)">
    <div style="flex:1;min-width:0"><b>${over ? 'เลยกำหนดจ่าย' : 'ใกล้ครบกำหนดจ่าย'} ${rows.length} รายการ</b>
    <div class="muted">${rows.map((r) => `${esc(r.item.name)} ${formatBaht(r.amount)} (${dLabel(r.due)})`).join(' · ')}</div></div>
    ${compact ? '<button class="btn small" type="button" data-gofix="1">ดู</button>' : ''}</div>`;
}

async function renderMore() {
  document.querySelectorAll('#subtabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === S.sub));
  document.querySelectorAll('[data-sub]').forEach((d) => (d.hidden = d.dataset.sub !== S.sub));
  $('ttl').textContent = { plan: 'แผนรายรับ', ot: 'ปฏิทิน OT', fix: 'รายจ่ายประจำ', set: 'ตั้งค่า' }[S.sub];
  if (S.sub === 'plan') return renderPlan();
  if (S.sub === 'ot') return renderOt();
  if (S.sub === 'fix') return renderFix();
  if (S.sub === 'set') { await renderSettings(); return renderBackup(); }
}

// ---------- CP10 plan
async function planCtx() {
  const [plans, links, txs, items, hours, settings, holidays] = await Promise.all([repo.listPlans(), repo.getPlanLinks(), repo.listTransactions(),
    repo.listRecurring(), repo.getOtHours(), repo.getSettings(), repo.getHolidays()]);
  return { plans, links, txs, items, hours, settings, holidays };
}
async function renderPlan() {
  const ctx = await planCtx();
  const p = incomePlan({ month: S.month, ...ctx });
  $('pl-sum').innerHTML = `<div class="lbl">คงเหลือตามแผน ${monthLabel(S.month)} (รายรับตามแผน − รายจ่ายประจำ)</div>
    <div class="big num">฿ ${p.remaining < 0 ? '−' : ''}${formatBaht(Math.abs(p.remaining))}</div>
    <div class="grid"><div>รายรับตามแผน<b class="num">${formatBaht(p.planTotal)}</b></div><div>รายจ่ายประจำ<b class="num">${formatBaht(p.fixedTotal)}</b></div><div>เงินออก<b>${dLabel(p.payDate)}</b></div></div>`;
  const cyc = otCycle(S.month, ctx.settings);
  $('pl-lines').innerHTML = `<div class="row"><h2>รายรับ: แผน vs จริง</h2></div>
    <form class="cat" id="pl-salform" novalidate><div class="mid">เงินเดือน<div class="muted">ใช้ยอดนี้ต่อทุกเดือนจนกว่าจะแก้ · จริง ${formatBaht(p.actual.salary)}</div></div>
      <input id="pl-sal" class="num" inputmode="decimal" value="${p.salary ? p.salary / 100 : ''}" placeholder="0" style="width:110px;text-align:right" aria-label="เงินเดือนตามแผน"></form>
    <div class="cat"><div class="mid">OT รอบ ${dayLabel(cyc.start)} – ${dayLabel(cyc.end)}<div class="muted">จากปฏิทิน OT (${p.ot.hours} ชม.) · จริง ${formatBaht(p.actual.ot)}</div></div><div class="num">${formatBaht(p.ot.total)}</div></div>
    <form class="cat" id="pl-othform" novalidate><div class="mid">อื่นๆ<div class="muted">กรอกเอง · จริง ${formatBaht(p.actual.other)}</div></div>
      <input id="pl-oth" class="num" inputmode="decimal" value="${p.other ? p.other / 100 : ''}" placeholder="0" style="width:110px;text-align:right" aria-label="รายรับอื่นตามแผน"></form>
    <div class="debt" style="border-top:1px solid var(--line);padding-top:8px"><span>ได้จริงแล้ว</span><span class="num">${formatBaht(p.actual.total)}</span></div>
    <div class="debt"><b>ยังจะได้อีก</b><b class="num" style="color:var(--ok)">+${formatBaht(p.toCome)}</b></div>
    ${!ctx.links.salaryCatId ? '<p class="muted" style="margin:0">ผูกหมวดรายรับ "เงินเดือน"/"OT" ได้ที่แท็บตั้งค่า เพื่อแยกยอดจริง</p>' : ''}
    <div class="err" id="pl-err"></div>`;
  const months = [0, 1, 2, 3].map((i) => shiftMonth(S.month, i)).map((m) => incomePlan({ month: m, ...ctx }));
  const td = (v, b) => `<td style="text-align:right;padding:4px 6px;white-space:nowrap">${b ? '<b>' : ''}${v}${b ? '</b>' : ''}</td>`;
  const fm = (n) => `${n < 0 ? '−' : ''}${formatBaht(Math.abs(Math.round(n / 100) * 100))}`;
  $('pl-ahead').innerHTML = `<table class="num" style="border-collapse:collapse;width:100%;font-size:13px">
    <tr class="muted"><td></td>${months.map((x) => td(monthLabel(x.month).split(' ')[0])).join('')}</tr>
    <tr><td>รายรับ</td>${months.map((x) => td(fm(x.planTotal))).join('')}</tr>
    <tr><td>ประจำ/ผ่อน</td>${months.map((x) => td(fm(x.fixedTotal))).join('')}</tr>
    <tr><td><b>คงเหลือ</b></td>${months.map((x) => td(fm(x.remaining), true)).join('')}</tr>
    <tr class="muted"><td>เงินออก</td>${months.map((x) => td(`${dowLabel(x.payDate)} ${Number(x.payDate.slice(8))}`)).join('')}</tr></table>
    ${months.slice(1).some((x) => !x.ot.hours) ? '<p class="muted" style="margin:6px 0 0">เดือนที่ยังไม่กรอกปฏิทิน OT จะนับ OT = 0</p>' : ''}`;
}

// ---------- CP11 OT calendar
async function renderOt() {
  const [hours, st, hols] = await Promise.all([repo.getOtHours(), repo.getSettings(), repo.getHolidays()]);
  const r = otPay(S.month, hours, st, hols);
  const rate = st.baseRate / 100;
  $('ot-sum').innerHTML = `<div class="row"><h2>รอบ ${dayLabel(r.start)} – ${dayLabel(r.end)}</h2><span class="muted">จ่าย ${dLabel(payDate(S.month, st))}</span></div>
    <div class="debt"><span>วันปกติ ${r.wdH} ชม. × ${st.wdMul}</span><span class="num">${formatBaht(r.wd, { decimals: 2 })}</span></div>
    <div class="debt"><span>วันหยุด ${st.hdHours} ชม.แรก ${r.hd1H} ชม. × ${st.hdMul1}</span><span class="num">${formatBaht(r.hd1, { decimals: 2 })}</span></div>
    <div class="debt"><span>วันหยุด ชม.ที่ ${st.hdHours + 1}+ ${r.hd2H} ชม. × ${st.hdMul2}</span><span class="num">${formatBaht(r.hd2, { decimals: 2 })}</span></div>
    <div class="debt" style="border-top:1px solid var(--line);padding-top:6px"><b>รวม ${r.hours} ชม.</b><b class="num">฿ ${formatBaht(r.total, { decimals: 2 })}</b></div>
    <span class="muted" style="font-size:12px">อัตราฐาน ${rate.toLocaleString('th-TH')} บ./ชม.</span>`;
  let html = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => `<div class="muted" style="text-align:center;font-size:12px">${d}</div>`).join('');
  const lead = new Date(r.start + 'T00:00:00').getDay();
  for (let i = 0; i < lead; i++) html += '<div></div>';
  for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
    const hol = hols.includes(d), we = isHolidayLike(d, []), h = hours[d];
    const c = hol ? 'var(--over)' : we ? 'var(--alert)' : 'var(--line)';
    html += `<button type="button" data-day="${d}" style="border:${S.otDay === d ? 2 : 1}px solid ${S.otDay === d ? 'var(--accent)' : c};border-radius:8px;background:${h ? 'var(--accent-soft)' : 'var(--surface)'};color:var(--fg);padding:4px 0;font:inherit;min-height:48px;display:grid;justify-items:center;align-content:center;cursor:pointer">
      <span style="font-size:12px;color:${hol || we ? c : 'var(--muted)'}">${Number(d.slice(8))}</span><b style="font-size:13px">${h ?? ''}</b></button>`;
  }
  $('ot-cal').innerHTML = html;
  const f = $('ot-edit');
  f.hidden = !S.otDay || S.otDay < r.start || S.otDay > r.end;
  if (!f.hidden) {
    $('ot-day').textContent = `${dLabel(S.otDay)}${hols.includes(S.otDay) ? ' · วันหยุดบริษัท' : isHolidayLike(S.otDay, []) ? ' · เสาร์-อาทิตย์' : ''}`;
    $('ot-h').value = hours[S.otDay] ?? '';
    $('ot-hol').textContent = hols.includes(S.otDay) ? 'ยกเลิกวันหยุด' : 'ตั้งเป็นวันหยุด';
    $('ot-err').textContent = '';
  }
}

// ---------- CP8/CP9 recurring
async function renderFix() {
  await runAutoPay();
  await renderDue($('fx-warn'), false);
  const [items, txs] = await Promise.all([repo.listRecurring(), repo.listTransactions()]);
  const st = recurringStatus(items, txs, S.month, todayISO(), (await repo.getSettings()).dueWarnDays);
  const byId = Object.fromEntries(st.map((r) => [r.item.id, r]));
  $('fx-list').innerHTML = items.length ? items.map((it) => {
    const r = byId[it.id];
    const end = it.mode === 'installment' ? installmentEnd(it) : null;
    const sub = `ทุกวันที่ ${it.dueDay} · ${it.mode === 'fixed' ? 'คงที่' : `ผ่อน${end ? ' ถึง ' + monthLabel(end) : ''}`}${it.autoPay ? ' · หักอัตโนมัติ' : ''}`;
    let right = '<span class="muted">ไม่มียอดเดือนนี้</span>';
    if (r) {
      const tag = r.state === 'paid' ? `<span class="tag" style="color:var(--ok);border-color:var(--ok)">${r.paidTx.source === 'auto' ? 'หักอัตโนมัติแล้ว' : 'จ่ายแล้ว'}</span>`
        : r.state === 'overdue' ? `<button class="icon-btn" data-pay="${it.id}" style="color:var(--over);border-color:var(--over)">เลยกำหนด · จ่ายแล้ว</button>`
        : r.state === 'soon' ? `<button class="icon-btn" data-pay="${it.id}" style="color:var(--alert);border-color:var(--alert)">จ่ายแล้ว</button>`
        : `<button class="icon-btn" data-pay="${it.id}">จ่ายแล้ว</button>`;
      right = `<div class="num">${formatBaht(r.amount)}</div>${tag}`;
    }
    return `<div class="cat"><button type="button" class="ic" data-edit="${it.id}" style="border:0;cursor:pointer" aria-label="แก้ไข ${esc(it.name)}">${it.dueDay}</button>
      <div class="mid" data-edit="${it.id}" style="cursor:pointer">${esc(it.name)}<div class="muted">${sub}</div></div><div style="text-align:right;display:grid;gap:4px;justify-items:end">${right}</div></div>`;
  }).join('') : '<div class="empty"><b>ยังไม่มีรายจ่ายประจำ</b><span>เพิ่มค่ารถ ค่าเน็ต หรือรายการผ่อน</span></div>';
}

function schedInputs(it) {
  const start = $('fx-start').value || S.month, out = [];
  for (let i = 0; i < 12; i++) {
    const m = shiftMonth(start, i), v = it?.schedule?.[m];
    out.push(`<label style="font-size:12px">${monthLabel(m)}<input class="num" data-sm="${m}" inputmode="decimal" value="${v ? v / 100 : ''}" placeholder="0" aria-label="ยอดผ่อน ${monthLabel(m)}"></label>`);
  }
  $('fx-sched').innerHTML = out.join('');
}
function setFxMode(m) {
  S.fxMode = m;
  document.querySelectorAll('#fx-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  $('fx-amtbox').hidden = m !== 'fixed'; $('fx-sched').hidden = m !== 'installment';
}
async function openFxForm(id) {
  const items = await repo.listRecurring();
  const it = items.find((x) => x.id === id) || null;
  S.fxEdit = it;
  $('fx-cat').innerHTML = '<option value="">— เลือก —</option>' + S.cats.filter((c) => c.kind === 'out').map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('fx-title').textContent = it ? `แก้ไข: ${it.name}` : 'เพิ่มรายจ่ายประจำ';
  $('fx-name').value = it?.name || ''; $('fx-cat').value = it?.categoryId || '';
  $('fx-day').value = it?.dueDay || ''; $('fx-start').value = it?.startMonth || S.month;
  $('fx-amt').value = it?.amount ? it.amount / 100 : ''; $('fx-auto').checked = it ? it.autoPay : true;
  setFxMode(it?.mode || 'fixed'); schedInputs(it);
  $('fx-del').hidden = !it; $('fx-delok').hidden = true; $('fx-err').textContent = '';
  $('fx-form').hidden = false; $('fx-form').scrollIntoView({ block: 'start' });
}

// ---------- settings
async function renderSettings() {
  const [st, links, hols] = await Promise.all([repo.getSettings(), repo.getPlanLinks(), repo.getHolidays()]);
  $('st-rate').value = st.baseRate / 100; $('st-wd').value = st.wdMul; $('st-h1').value = st.hdMul1; $('st-hh').value = st.hdHours;
  $('st-h2').value = st.hdMul2; $('st-cs').value = st.cycleStart; $('st-pd').value = st.payDay; $('st-warn').value = st.dueWarnDays;
  const opts = '<option value="">— ไม่ผูก —</option>' + S.cats.filter((c) => c.kind === 'in').map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('st-sal').innerHTML = opts; $('st-ot').innerHTML = opts;
  $('st-sal').value = links.salaryCatId || ''; $('st-ot').value = links.otCatId || '';
  $('st-hols').innerHTML = hols.length ? hols.map((d) => `<div class="debt"><span>${dLabel(d)}</span><button class="icon-btn" type="button" data-unhol="${d}">ลบ</button></div>`).join('') : '<span class="muted">ยังไม่มีวันหยุด</span>';
  $('st-err').textContent = '';
}

// ---------- BACKUP (CP12)
const fmtStamp = (iso) => { const d = new Date(iso); return isNaN(d) ? '—' : `${d.getDate()} ${TH_SHORT[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const countText = (c) => `หมวด ${c.categories} · รายการ ${c.transactions} · ยืม-คืน ${c.moves} · งบ ${c.budgetMonths} เดือน · ประจำ ${c.recurring || 0}`;
let pendingRestore = null;
async function renderBackup() {
  const last = await repo.getMeta('lastBackupAt');
  if (last) { const days = Math.floor((Date.now() - new Date(last)) / 864e5); $('bk-last').textContent = `${fmtStamp(last)} · ${days ? days + ' วันก่อน' : 'วันนี้'}`; }
  const chk = checkBackup(await repo.exportAll());
  $('bk-count').textContent = chk.counts ? countText(chk.counts) : '';
}
async function doBackup() {
  const data = await repo.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = backupFileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  await repo.setMeta('lastBackupAt', data.exportedAt);
  toast(`สำรองแล้ว: ${a.download}`);
  renderBackup();
}
async function pickRestore(file) {
  $('bk-err').textContent = ''; $('bk-confirm').hidden = true; pendingRestore = null;
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { $('bk-err').textContent = 'อ่านไฟล์ไม่ได้ (ไม่ใช่ไฟล์ .json ที่ถูกต้อง)'; return; }
  const chk = checkBackup(obj);
  if (chk.error) { $('bk-err').textContent = chk.error; return; }
  pendingRestore = obj;
  $('bk-confirm').innerHTML = `<h2>ยืนยันกู้คืน?</h2>
    <div class="debt"><span>ไฟล์</span><b style="min-width:0;overflow-wrap:anywhere">${esc(file.name)}</b></div>
    <div class="debt"><span>สำรองเมื่อ</span><span>${fmtStamp(chk.exportedAt)}</span></div>
    <div class="debt"><span>ในไฟล์</span><span>${countText(chk.counts)}</span></div>
    <p style="margin:0;color:var(--over)">ข้อมูลปัจจุบันในเครื่องทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์</p>
    <button class="btn danger" type="button" id="bk-ok">ยืนยันแทนที่ข้อมูล</button>
    <button class="btn ghost" type="button" id="bk-cancel">ยกเลิก</button>`;
  $('bk-confirm').hidden = false;
}

const catName = (id) => S.cats.find((c) => c.id === id)?.name ?? '—';
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + formatBaht(Math.abs(n));

// ---------- HOME (CP5–CP7)
async function renderHome() {
  await runAutoPay();
  await renderDue($('home-due'), true);
  const [allTx, budgets, moves] = await Promise.all([repo.listTransactions(), repo.listBudgets(), repo.listMoves()]);
  const s = summarize(allTx.filter((t) => monthKey(t.date) === S.month));
  $('s-bal').textContent = `฿ ${s.balance < 0 ? '−' : ''}${formatBaht(Math.abs(s.balance))}`;
  $('s-in').textContent = formatBaht(s.income);
  $('s-out').textContent = formatBaht(s.expense);

  const st = budgetStatus({ categories: S.cats, budgets, txs: allTx, moves, month: S.month });
  $('budgets').innerHTML = st.length ? st.map((b) => {
    if (b.budget === null) return `<div class="bud" style="--c:var(--line)"><div class="row"><span class="name">${esc(b.name)}</span><span class="muted">ไม่ได้ตั้งงบ</span></div>
      <div class="row muted"><span class="num">ใช้ไป ${formatBaht(b.used)}</span></div></div>`;
    const parts = [`งบ ${formatBaht(b.budget)}`];
    if (b.carry) parts.push(`ทบ ${sign(b.carry)}`);
    const net = b.movedIn - b.movedOut;
    if (net) parts.push(`${net > 0 ? 'รับยืม/ย้ายมา' : 'ให้ยืม/ย้ายออก'} ${sign(net)}`);
    return `<div class="bud t-${b.tier}"><div class="row"><span class="name">${esc(b.name)}</span><span class="pill">${b.pct.toFixed(1)}% · ${TIER_LABEL[b.tier]}</span></div>
      <div class="bar"><i style="width:${Math.min(Math.max(b.pct, 0), 100)}%"></i></div>
      <div class="row muted"><span class="num">${formatBaht(b.used)} / ${b.avail < 0 ? '−' : ''}${formatBaht(Math.abs(b.avail))}</span>
        <span class="num" style="color:${b.left < 0 ? 'var(--over)' : 'inherit'}">${b.left < 0 ? 'เกิน' : 'เหลือ'} ${formatBaht(Math.abs(b.left))}</span></div>
      <div class="row" style="align-items:center"><span class="muted" style="font-size:12px">${parts.join(' · ')}</span>
        ${b.pct >= 80 ? `<button class="icon-btn" data-borrow="${b.categoryId}" style="color:var(--accent);border-color:var(--accent)">ยืมงบ</button>` : ''}</div></div>`;
  }).join('') : `<div class="empty"><b>ยังไม่มีหมวดรายจ่าย</b><span>เพิ่มหมวดที่หน้าหมวดหมู่ แล้วกด "ตั้งงบ"</span></div>`;

  const debts = outstandingDebts(moves);
  const total = debts.reduce((a, d) => a + d.amount, 0);
  $('debtbox').innerHTML = `<div class="row"><h2>ยอดค้างคืน</h2><span class="num" style="color:${total ? 'var(--over)' : 'var(--muted)'};font-weight:700">฿ ${formatBaht(total)}</span></div>` +
    (debts.length ? debts.map((d) => `<div class="debt"><span>${esc(catName(d.debtorId))} → คืน ${esc(catName(d.creditorId))}</span>
      <span style="display:flex;gap:8px;align-items:center"><span class="num">${formatBaht(d.amount)}</span>
      <button class="icon-btn" data-repay="${d.debtorId}|${d.creditorId}|${d.amount}">คืน</button></span></div>`).join('')
      : '<span class="muted">ไม่มียอดค้าง</span>');

  renderChart(monthlySeries(allTx, S.month));
}

function renderChart(series) {
  const peak = Math.max(0, ...series.flatMap((s) => [s.income, s.expense]));
  if (!peak) { $('chart').innerHTML = '<span class="muted">ยังไม่มีรายรับ-รายจ่ายใน 6 เดือนนี้</span>'; return; }
  const W = 340, H = 170, base = 140, top = 14, max = peak;
  const slot = W / series.length, bw = Math.min(18, slot / 2 - 4);
  const h = (v) => Math.round(((base - top) * v) / max);
  const bars = series.map((s, i) => {
    const x = i * slot + slot / 2;
    const [y, m] = s.month.split('-').map(Number);
    return `<rect x="${x - bw - 1}" y="${base - h(s.income)}" width="${bw}" height="${h(s.income)}" rx="2" fill="var(--ok)"><title>รายรับ ${formatBaht(s.income)}</title></rect>
      <rect x="${x + 1}" y="${base - h(s.expense)}" width="${bw}" height="${h(s.expense)}" rx="2" fill="var(--accent)"><title>รายจ่าย ${formatBaht(s.expense)}</title></rect>
      <text x="${x}" y="${base + 16}" text-anchor="middle" font-size="11" fill="var(--muted)" font-weight="${s.month === S.month ? 700 : 400}">${TH_SHORT[m - 1]}</text>`;
  }).join('');
  const maxLbl = `<text x="0" y="${top - 3}" font-size="10" fill="var(--muted)">สูงสุด ${formatBaht(max)}</text>`;
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟรายรับรายจ่าย 6 เดือน" style="width:100%">
    <line x1="0" y1="${top}" x2="${W}" y2="${top}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--line)"/>${maxLbl}${bars}</svg>`;
}

// ---------- BUDGET FORM (CP5)
async function renderBudgetForm() {
  const budgets = await repo.listBudgets();
  const list = S.cats.filter((c) => c.kind === 'out');
  $('b-save').textContent = `บันทึกงบ ${monthLabel(S.month)}`;
  $('budlist').innerHTML = list.length ? list.map((c) => {
    const eff = effectiveBudget(budgets, c.id, S.month);
    return `<div class="cat"><div class="ic">${esc([...c.name][0])}</div><div class="mid">${esc(c.name)}</div>
      <input class="num" inputmode="decimal" data-cid="${c.id}" data-orig="${eff ?? ''}" value="${eff === null ? '' : (eff / 100).toString()}" placeholder="ไม่ตั้ง" style="width:120px;text-align:right" aria-label="งบ ${esc(c.name)}"></div>`;
  }).join('') : `<div class="empty"><b>ยังไม่มีหมวดรายจ่าย</b><span>เพิ่มหมวดที่หน้าหมวดหมู่ก่อน</span></div>`;
  $('b-err').textContent = '';
}

// ---------- LIST
async function renderList() {
  const f = $('f-filter'), cur = f.value;
  f.innerHTML = '<option value="">ทั้งหมด</option>' + ['out', 'in'].map((k) =>
    `<optgroup label="${k === 'out' ? 'รายจ่าย' : 'รายรับ'}">` +
    S.cats.filter((c) => c.kind === k).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</optgroup>').join('');
  f.value = S.cats.some((c) => c.id === cur) ? cur : '';
  const [txs0, mv0, allMv] = await Promise.all([repo.listTransactions(S.month), repo.listMoves(S.month), repo.listMoves()]);
  const debtTag = (t) => {
    if (t.type === 'shift') return '';
    const [debtor, creditor] = t.type === 'borrow' ? [t.toId, t.fromId] : [t.fromId, t.toId];
    const net = pairNet(allMv, debtor, creditor);
    return net <= 0 ? '<span class="tag" style="color:var(--ok);border-color:var(--ok)">คืนครบแล้ว</span>'
      : `<span class="tag" style="color:var(--over);border-color:var(--over)">ค้าง ${formatBaht(net)}</span>`;
  };
  let items = [...txs0.map((t) => ({ ...t, _t: 'tx' })), ...mv0.map((m) => ({ ...m, _t: 'mv' }))];
  if (f.value) items = items.filter((t) => t.categoryId === f.value || t.fromId === f.value || t.toId === f.value);
  const src = (s) => `<span class="tag">${s && s !== 'manual' ? esc(s) : 'กรอกเอง'}</span>`;
  $('txlist').innerHTML = items.length ? groupByDate(items).map((g) => `<div class="day">${dayLabel(g.date)}</div>` + g.items.map((t) => {
    if (t._t === 'mv') {
      const verb = t.type === 'borrow' ? `ยืม ${esc(catName(t.fromId))}` : t.type === 'repay' ? `คืน ${esc(catName(t.toId))}` : `ย้ายงบ → ${esc(catName(t.toId))}`;
      const who = t.type === 'borrow' ? catName(t.toId) : catName(t.fromId);
      return `<button class="tx" data-mv="${t.id}"><div class="ic">⇄</div>
        <div class="mid"><div>${esc(who)} ${verb}</div><div class="muted">${MOVE_LABEL[t.type]}${t.note ? ' · ' + esc(t.note) : ''}${debtTag(t)}${src(t.source)}</div></div>
        <div class="num" style="font-weight:600;color:var(--muted)">${formatBaht(t.amount)}</div></button>`;
    }
    const name = catName(t.categoryId);
    return `<button class="tx" data-id="${t.id}"><div class="ic">${esc([...name][0] || '?')}</div>
      <div class="mid"><div>${esc(t.note || name)}</div><div class="muted">${esc(name)}${src(t.source)}</div></div>
      <div class="num ${t.kind === 'in' ? 'amt-in' : 'amt-out'}" style="font-weight:600">${t.kind === 'in' ? '+' : '−'}${formatBaht(t.amount)}</div></button>`;
  }).join('')).join('')
    : `<div class="empty"><b>ยังไม่มีรายการใน ${monthLabel(S.month)}</b><span>กด + เพื่อเพิ่มรายการแรก</span></div>`;
}

// ---------- ADD / EDIT FORM
function renderForm() {
  document.querySelectorAll('#kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.kind));
  const isMove = S.kind === 'move';
  $('catbox').hidden = isMove; $('movebox').hidden = !isMove;
  if (isMove) renderMoveFields(); else renderChips();
  const ed = !!S.editing;
  $('f-editacts').hidden = !ed;
  $('f-save').textContent = ed ? 'บันทึกการแก้ไข' : isMove ? MOVE_TEXT[S.mtype][3] : 'บันทึก';
  $('f-delok').hidden = true; $('f-del').hidden = false;
}

function renderChips() {
  const list = S.cats.filter((c) => c.kind === S.kind);
  if (!list.some((c) => c.id === S.catId)) S.catId = null;
  $('chips').innerHTML = list.length
    ? list.map((c) => `<button type="button" class="chip${c.id === S.catId ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')
    : `<span class="muted">ยังไม่มีหมวด${S.kind === 'out' ? 'รายจ่าย' : 'รายรับ'} — <a href="#" id="go-cat">ไปเพิ่มที่หน้าหมวดหมู่</a></span>`;
}

function renderMoveFields(pre = {}) {
  document.querySelectorAll('#mtype .chip').forEach((b) => b.classList.toggle('on', b.dataset.m === S.mtype));
  const [lf, lt, hint] = MOVE_TEXT[S.mtype];
  $('l-from').textContent = lf; $('l-to').textContent = lt; $('m-hint').textContent = hint;
  const opts = '<option value="">— เลือก —</option>' + S.cats.filter((c) => c.kind === 'out').map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const keepF = pre.fromId ?? $('m-from').value, keepT = pre.toId ?? $('m-to').value;
  $('m-from').innerHTML = opts; $('m-to').innerHTML = opts;
  $('m-from').value = keepF || ''; $('m-to').value = keepT || '';
}

function resetForm() {
  S.editing = null; S.catId = null; S.recLink = null;
  $('f-amt').value = ''; $('f-note').value = ''; $('f-date').value = todayISO(); $('f-err').textContent = '';
  $('m-from').value = ''; $('m-to').value = '';
}

async function openEdit(id) {
  const t = await repo.getTransaction(id);
  if (!t) return;
  S.editing = { ...t, _t: 'tx' }; S.kind = t.kind; S.catId = t.categoryId;
  $('f-amt').value = (t.amount / 100).toFixed(2); $('f-date').value = t.date; $('f-note').value = t.note; $('f-err').textContent = '';
  go('add');
}

async function openEditMove(id) {
  const m = await repo.getMove(id);
  if (!m) return;
  S.editing = { ...m, _t: 'mv' }; S.kind = 'move'; S.mtype = m.type;
  $('f-amt').value = (m.amount / 100).toFixed(2); $('f-date').value = m.date; $('f-note').value = m.note; $('f-err').textContent = '';
  S.cats = await repo.listCategories();
  renderMoveFields({ fromId: m.fromId, toId: m.toId });
  go('add');
}

function startMove(type, pre) {
  resetForm(); S.kind = 'move'; S.mtype = type;
  if (pre.amount) $('f-amt').value = (pre.amount / 100).toString();
  go('add');
  renderMoveFields(pre);
}

function bind() {
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.go === 'add' && S.editing) resetForm();
    go(b.dataset.go);
  }));
  $('m-prev').onclick = () => { S.month = shiftMonth(S.month, -1); render(); };
  $('m-next').onclick = () => { S.month = shiftMonth(S.month, 1); render(); };
  $('f-filter').onchange = renderList;
  $('txlist').addEventListener('click', (e) => {
    const b = e.target.closest('.tx'); if (!b) return;
    b.dataset.mv ? openEditMove(b.dataset.mv) : openEdit(b.dataset.id);
  });

  // home shortcuts
  $('go-bud').onclick = () => go('bud');
  $('b-back').onclick = () => go('home');
  document.querySelector('[data-v="home"]').addEventListener('click', (e) => {
    const br = e.target.closest('[data-borrow]');
    if (br) { startMove('borrow', { toId: br.dataset.borrow }); toast(`ตั้งปลายทางเป็น "${catName(br.dataset.borrow)}" แล้ว เลือกหมวดที่จะยืม`); return; }
    const rp = e.target.closest('[data-repay]');
    if (rp) { const [fromId, toId, amt] = rp.dataset.repay.split('|'); startMove('repay', { fromId, toId, amount: Number(amt) }); toast('เติมยอดค้างให้แล้ว แก้เป็นคืนบางส่วนได้'); }
  });

  // budget form
  $('budform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const entries = [];
    for (const inp of document.querySelectorAll('#budlist input[data-cid]')) {
      const raw = inp.value.trim();
      let amount = null;
      if (raw) { amount = raw === '0' ? 0 : parseAmount(raw); if (amount === null) { $('b-err').textContent = `งบ "${catName(inp.dataset.cid)}" ไม่ถูกต้อง`; return; } }
      const orig = inp.dataset.orig === '' ? null : Number(inp.dataset.orig);
      if (amount !== orig) entries.push({ categoryId: inp.dataset.cid, amount });
    }
    if (entries.length) await repo.setBudgets(S.month, entries);
    toast(entries.length ? `บันทึกงบ ${monthLabel(S.month)} แล้ว` : 'ไม่มีการเปลี่ยนแปลง');
    go('home');
  });

  // add form
  $('kind').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.kind = b.dataset.k; renderForm();
  });
  $('mtype').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.mtype = b.dataset.m; renderForm(); });
  $('chips').addEventListener('click', (e) => {
    if (e.target.id === 'go-cat') { e.preventDefault(); S.catKind = S.kind; return go('cat'); }
    const b = e.target.closest('.chip'); if (!b) return; S.catId = b.dataset.id; renderChips();
  });
  $('slip').addEventListener('click', () => toast('อ่านสลิปอัตโนมัติจะเปิดใช้ใน CP4'));
  $('txform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseAmount($('f-amt').value);
    if (amount === null) return ($('f-err').textContent = 'จำนวนเงินไม่ถูกต้อง (ตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง)');
    const base = S.editing || {};
    const common = { amount, date: $('f-date').value, note: $('f-note').value };
    try {
      const mvIn = { ...common, type: S.mtype, fromId: $('m-from').value, toId: $('m-to').value };
      const txIn = { ...common, kind: S.kind, categoryId: S.catId, ...(S.recLink && !S.editing ? S.recLink : {}) };
      if (S.editing?._t === 'tx' && S.kind === 'move') await repo.convertTxToMove(S.editing, mvIn);
      else if (S.editing?._t === 'mv' && S.kind !== 'move') await repo.convertMoveToTx(S.editing, txIn);
      else if (S.kind === 'move') await repo.saveMove({ ...base, ...mvIn });
      else await repo.saveTransaction({ ...base, ...txIn });
      const wasEdit = !!S.editing, wasMove = S.kind === 'move';
      S.month = monthKey($('f-date').value);
      resetForm();
      toast(wasEdit ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกแล้ว');
      if (wasMove && !wasEdit) S.kind = 'out';
      go(wasEdit ? 'list' : wasMove ? 'home' : 'add');
    } catch (err) { $('f-err').textContent = err.message; }
  });
  $('f-cancel').onclick = () => { resetForm(); S.kind = 'out'; go('list'); };
  $('f-del').onclick = () => { $('f-del').hidden = true; $('f-delok').hidden = false; };
  $('f-delok').onclick = async () => {
    try {
      if (S.editing._t === 'mv') await repo.deleteMove(S.editing.id); else await repo.deleteTransaction(S.editing.id);
      resetForm(); S.kind = 'out'; toast('ลบรายการแล้ว'); go('list');
    } catch (err) { $('f-err').textContent = err.message; $('f-delok').hidden = true; $('f-del').hidden = false; }
  };

  // ชุด 3
  $('subtabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.sub = b.dataset.t; S.fxEdit = null; $('fx-form').hidden = true; renderMore(); });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-gofix]')) { S.sub = 'fix'; go('more'); } });
  // plan inputs (save on change)
  $('pl-lines').addEventListener('change', async (e) => {
    const v = e.target.value.trim(), amt = v === '' ? 0 : parseAmount(v);
    if (amt === null && v !== '0') { $('pl-err').textContent = 'จำนวนเงินไม่ถูกต้อง'; return; }
    if (e.target.id === 'pl-sal') await repo.savePlan(S.month, { salary: amt || 0 });
    if (e.target.id === 'pl-oth') await repo.savePlan(S.month, { other: amt || 0 });
    toast('บันทึกแผนแล้ว'); renderPlan();
  });
  $('pl-lines').addEventListener('submit', (e) => { e.preventDefault(); e.target.querySelector('input')?.blur(); });
  // OT
  $('ot-cal').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; S.otDay = b.dataset.day; renderOt().then(() => $('ot-h').focus()); });
  $('ot-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await repo.setOtHours(S.otDay, $('ot-h').value.trim() === '' ? 0 : numIn($('ot-h').value)); S.otDay = null; renderOt(); }
    catch (err) { $('ot-err').textContent = err.message; }
  });
  $('ot-hol').onclick = async () => { await repo.toggleHoliday(S.otDay); renderOt(); };
  $('ot-close').onclick = () => { S.otDay = null; renderOt(); };
  // recurring
  $('fx-new').onclick = () => openFxForm(null);
  $('fx-list').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) return openFxForm(ed.dataset.edit);
    const pay = e.target.closest('[data-pay]'); if (!pay) return;
    const it = (await repo.listRecurring()).find((x) => x.id === pay.dataset.pay);
    resetForm();
    S.kind = 'out'; S.catId = it.categoryId; S.recLink = { recurringId: it.id, recurringMonth: S.month };
    $('f-amt').value = recurringAmount(it, S.month) / 100; $('f-note').value = it.name;
    const today = todayISO(); $('f-date').value = monthKey(today) === S.month ? today : `${S.month}-${String(Math.min(it.dueDay, 28)).padStart(2, '0')}`;
    go('add'); toast(`เติมข้อมูล "${it.name}" ให้แล้ว แนบสลิปได้ แล้วกดบันทึก`);
  });
  $('fx-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFxMode(b.dataset.m); });
  $('fx-start').addEventListener('change', () => schedInputs(S.fxEdit));
  $('fx-cancel').onclick = () => { $('fx-form').hidden = true; S.fxEdit = null; };
  $('fx-del').onclick = () => { $('fx-del').hidden = true; $('fx-delok').hidden = false; };
  $('fx-delok').onclick = async () => { await repo.deleteRecurring(S.fxEdit.id); $('fx-form').hidden = true; S.fxEdit = null; toast('ลบแล้ว (รายการที่จ่ายไปแล้วยังอยู่)'); renderFix(); };
  $('fx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const schedule = {};
    for (const inp of document.querySelectorAll('#fx-sched input[data-sm]')) {
      const v = inp.value.trim(); if (!v) continue;
      const a = parseAmount(v); if (a === null) { $('fx-err').textContent = `ยอด ${monthLabel(inp.dataset.sm)} ไม่ถูกต้อง`; return; }
      schedule[inp.dataset.sm] = a;
    }
    try {
      await repo.saveRecurring({ ...(S.fxEdit || {}), name: $('fx-name').value, categoryId: $('fx-cat').value, dueDay: numIn($('fx-day').value),
        startMonth: $('fx-start').value, mode: S.fxMode, amount: S.fxMode === 'fixed' ? bahtIn($('fx-amt').value) : null, schedule, autoPay: $('fx-auto').checked });
      $('fx-form').hidden = true; S.fxEdit = null; toast('บันทึกแล้ว'); renderFix();
    } catch (err) { $('fx-err').textContent = err.message; }
  });
  // settings
  $('st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rate = bahtIn($('st-rate').value);
    try {
      await repo.saveSettings({ baseRate: rate ?? 0, wdMul: numIn($('st-wd').value), hdMul1: numIn($('st-h1').value), hdHours: numIn($('st-hh').value),
        hdMul2: numIn($('st-h2').value), cycleStart: numIn($('st-cs').value), payDay: numIn($('st-pd').value), dueWarnDays: numIn($('st-warn').value) });
      toast('บันทึกตั้งค่าแล้ว'); renderSettings();
    } catch (err) { $('st-err').textContent = err.message; }
  });
  const saveLinks = async () => { await repo.setPlanLinks({ salaryCatId: $('st-sal').value || null, otCatId: $('st-ot').value || null }); toast('บันทึกแล้ว'); };
  $('st-sal').onchange = saveLinks; $('st-ot').onchange = saveLinks;
  $('st-holform').addEventListener('submit', async (e) => { e.preventDefault(); const d = $('st-hol').value; if (!d) return; if (!(await repo.getHolidays()).includes(d)) await repo.toggleHoliday(d); $('st-hol').value = ''; renderSettings(); });
  $('st-hols').addEventListener('click', async (e) => { const b = e.target.closest('[data-unhol]'); if (!b) return; await repo.toggleHoliday(b.dataset.unhol); renderSettings(); });

  // backup
  $('bk-save').onclick = () => doBackup().catch((e) => ($('bk-err').textContent = 'สำรองไม่สำเร็จ: ' + e.message));
  $('bk-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pickRestore(f); };
  $('bk-confirm').addEventListener('click', async (e) => {
    if (e.target.id === 'bk-cancel') { pendingRestore = null; $('bk-confirm').hidden = true; return; }
    if (e.target.id !== 'bk-ok' || !pendingRestore) return;
    try { await repo.importAll(pendingRestore); pendingRestore = null; $('bk-confirm').hidden = true; resetForm(); S.kind = 'out'; toast('กู้คืนข้อมูลแล้ว'); go('home'); }
    catch (err) { $('bk-err').textContent = 'กู้คืนไม่สำเร็จ: ' + err.message; }
  });

  // categories
  $('catkind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.catKind = b.dataset.k; S.renaming = S.confirmDel = null; $('c-err').textContent = ''; renderCats(); });
  $('catform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await repo.addCategory(S.catKind, $('f-newcat').value); $('f-newcat').value = ''; $('c-err').textContent = ''; toast('เพิ่มหมวดแล้ว'); render(); }
    catch (err) { $('c-err').textContent = err.message; }
  });
  $('catlist').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const { act, id } = b.dataset; $('c-err').textContent = '';
    if (act === 'rename') { S.renaming = id; S.confirmDel = null; }
    else if (act === 'del') { S.confirmDel = id; S.renaming = null; }
    else if (act === 'cancel') { S.renaming = S.confirmDel = null; }
    else if (act === 'del-ok') {
      S.confirmDel = null;
      try { await repo.deleteCategory(id); toast('ลบหมวดแล้ว'); } catch (err) { $('c-err').textContent = err.message; }
    }
    render();
  });
  $('catlist').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await repo.renameCategory(e.target.dataset.id, $('f-rename').value); S.renaming = null; toast('แก้ชื่อแล้ว'); render(); }
    catch (err) { $('c-err').textContent = err.message; }
  });
}

function renderCats() {
  document.querySelectorAll('#catkind button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.catKind));
  const list = S.cats.filter((c) => c.kind === S.catKind);
  $('catlist').innerHTML = list.length ? list.map((c) => {
    if (S.renaming === c.id) return `<form class="cat" data-id="${c.id}" data-act="rename-form"><input id="f-rename" value="${esc(c.name)}" maxlength="40" style="flex:1;min-width:0">
      <div class="acts"><button class="icon-btn" type="submit">บันทึก</button><button class="icon-btn" type="button" data-act="cancel">ยกเลิก</button></div></form>`;
    if (S.confirmDel === c.id) return `<div class="cat"><div class="mid">ลบ “${esc(c.name)}”?</div>
      <div class="acts"><button class="icon-btn del" data-act="del-ok" data-id="${c.id}">ยืนยันลบ</button><button class="icon-btn" data-act="cancel">ยกเลิก</button></div></div>`;
    return `<div class="cat"><div class="ic">${esc([...c.name][0])}</div><div class="mid">${esc(c.name)}</div>
      <div class="acts"><button class="icon-btn" data-act="rename" data-id="${c.id}">แก้ชื่อ</button><button class="icon-btn" data-act="del" data-id="${c.id}">ลบ</button></div></div>`;
  }).join('') : `<div class="empty"><b>ยังไม่มีหมวด${S.catKind === 'out' ? 'รายจ่าย' : 'รายรับ'}</b><span>ตั้งชื่อหมวดแรกด้านล่าง</span></div>`;
  if (S.renaming) $('f-rename')?.focus();
}

async function init() {
  try {
    const db = await openDB(undefined, undefined, () => {
      document.querySelector('main').insertAdjacentHTML('afterbegin', '<div class="panel" style="border-color:var(--over);color:var(--over)">มีแอพนี้เปิดค้างอยู่ในแท็บอื่น (เช่น Chrome) — ปิดแท็บนั้นแล้วเปิดแอพใหม่</div>');
    });
    repo = new Repo(db);
  } catch (e) {
    document.querySelector('main').innerHTML = `<div class="empty"><b>เปิดที่เก็บข้อมูลบนเครื่องไม่ได้</b><span>${esc(e.message || e)}</span></div>`;
    return;
  }
  try {
    const ok = await navigator.storage?.persist?.();
    $('persist').textContent = ok ? 'ข้อมูลถูกเก็บแบบถาวรบนเครื่องนี้' : 'ระบบยังไม่อนุญาตเก็บข้อมูลแบบถาวร — ติดตั้งแอพลงหน้าจอเพื่อลดความเสี่ยงข้อมูลหาย';
  } catch { /* optional */ }
  resetForm(); bind(); render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
