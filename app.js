// UI controller (CP1–CP3)
import { openDB, Repo } from './db.js';
import { parseAmount, formatBaht, monthKey, shiftMonth, todayISO, monthLabel, dayLabel, summarize, groupByDate } from './logic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TITLES = { home: 'ภาพรวม', list: 'รายการ', add: 'เพิ่มรายการ', cat: 'หมวดหมู่', more: 'แผน / OT' };

const S = { month: monthKey(todayISO()), view: 'home', kind: 'out', catKind: 'out', catId: null, editing: null, renaming: null, confirmDel: null, cats: [] };
let repo;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2200);
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
  if (S.view === 'add') return renderChips();
  if (S.view === 'cat') return renderCats();
}

async function renderHome() {
  const s = summarize(await repo.listTransactions(S.month));
  $('s-bal').textContent = `฿ ${s.balance < 0 ? '−' : ''}${formatBaht(Math.abs(s.balance))}`;
  $('s-in').textContent = formatBaht(s.income);
  $('s-out').textContent = formatBaht(s.expense);
}

async function renderList() {
  const f = $('f-filter'), cur = f.value;
  f.innerHTML = '<option value="">ทั้งหมด</option>' + ['out', 'in'].map((k) =>
    `<optgroup label="${k === 'out' ? 'รายจ่าย' : 'รายรับ'}">` +
    S.cats.filter((c) => c.kind === k).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</optgroup>').join('');
  f.value = S.cats.some((c) => c.id === cur) ? cur : '';
  let txs = await repo.listTransactions(S.month);
  if (f.value) txs = txs.filter((t) => t.categoryId === f.value);
  const byId = Object.fromEntries(S.cats.map((c) => [c.id, c]));
  $('txlist').innerHTML = txs.length ? groupByDate(txs).map((g) => `<div class="day">${dayLabel(g.date)}</div>` + g.items.map((t) => {
    const name = byId[t.categoryId]?.name ?? '—';
    return `<button class="tx" data-id="${t.id}"><div class="ic">${esc([...name][0] || '?')}</div>
      <div class="mid"><div>${esc(t.note || name)}</div><div class="muted">${esc(name)}</div></div>
      <div class="num ${t.kind === 'in' ? 'amt-in' : 'amt-out'}" style="font-weight:600">${t.kind === 'in' ? '+' : '−'}${formatBaht(t.amount)}</div></button>`;
  }).join('')).join('')
    : `<div class="empty"><b>ยังไม่มีรายการใน ${monthLabel(S.month)}</b><span>กด + เพื่อเพิ่มรายการแรก</span></div>`;
}

function renderChips() {
  const list = S.cats.filter((c) => c.kind === S.kind);
  if (!list.some((c) => c.id === S.catId)) S.catId = null;
  $('chips').innerHTML = list.length
    ? list.map((c) => `<button type="button" class="chip${c.id === S.catId ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')
    : `<span class="muted">ยังไม่มีหมวด${S.kind === 'out' ? 'รายจ่าย' : 'รายรับ'} — <a href="#" id="go-cat">ไปเพิ่มที่หน้าหมวดหมู่</a></span>`;
  document.querySelectorAll('#kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.kind));
  const ed = !!S.editing;
  $('f-editacts').hidden = !ed;
  $('f-save').textContent = ed ? 'บันทึกการแก้ไข' : 'บันทึก';
  $('f-delok').hidden = true; $('f-del').hidden = false;
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

function resetForm() {
  S.editing = null; S.catId = null;
  $('f-amt').value = ''; $('f-note').value = ''; $('f-date').value = todayISO(); $('f-err').textContent = '';
}

async function openEdit(id) {
  const t = await repo.getTransaction(id);
  if (!t) return;
  S.editing = t; S.kind = t.kind; S.catId = t.categoryId;
  $('f-amt').value = (t.amount / 100).toFixed(2); $('f-date').value = t.date; $('f-note').value = t.note; $('f-err').textContent = '';
  go('add');
}

function bind() {
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.go === 'add' && S.editing) resetForm();
    go(b.dataset.go);
  }));
  $('m-prev').onclick = () => { S.month = shiftMonth(S.month, -1); render(); };
  $('m-next').onclick = () => { S.month = shiftMonth(S.month, 1); render(); };
  $('f-filter').onchange = renderList;
  $('txlist').addEventListener('click', (e) => { const b = e.target.closest('.tx'); if (b) openEdit(b.dataset.id); });

  $('kind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.kind = b.dataset.k; renderChips(); });
  $('chips').addEventListener('click', (e) => {
    if (e.target.id === 'go-cat') { e.preventDefault(); S.catKind = S.kind; return go('cat'); }
    const b = e.target.closest('.chip'); if (!b) return; S.catId = b.dataset.id; renderChips();
  });
  $('slip').addEventListener('click', () => toast('อ่านสลิปอัตโนมัติจะเปิดใช้ใน CP4'));
  $('txform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseAmount($('f-amt').value);
    if (amount === null) return ($('f-err').textContent = 'จำนวนเงินไม่ถูกต้อง (ตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง)');
    try {
      const base = S.editing || {};
      await repo.saveTransaction({ ...base, kind: S.kind, amount, date: $('f-date').value, categoryId: S.catId, note: $('f-note').value });
      const wasEdit = !!S.editing;
      S.month = monthKey($('f-date').value);
      resetForm();
      toast(wasEdit ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกแล้ว');
      go(wasEdit ? 'list' : 'add');
    } catch (err) { $('f-err').textContent = err.message; }
  });
  $('f-cancel').onclick = () => { resetForm(); go('list'); };
  $('f-del').onclick = () => { $('f-del').hidden = true; $('f-delok').hidden = false; };
  $('f-delok').onclick = async () => { await repo.deleteTransaction(S.editing.id); resetForm(); toast('ลบรายการแล้ว'); go('list'); };

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

async function init() {
  try {
    repo = new Repo(await openDB());
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
