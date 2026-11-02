// UI controller (CP1–CP3, CP5–CP7)
import { openDB, Repo } from './db.js';
import {
  parseAmount, formatBaht, monthKey, shiftMonth, todayISO, monthLabel, dayLabel, summarize, groupByDate,
  budgetStatus, outstandingDebts, monthlySeries, effectiveBudget, pairNet, TIER_LABEL, MOVE_LABEL,
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

const S = { month: monthKey(todayISO()), view: 'home', kind: 'out', mtype: 'borrow', catKind: 'out', catId: null, editing: null, renaming: null, confirmDel: null, cats: [] };
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
}

const catName = (id) => S.cats.find((c) => c.id === id)?.name ?? '—';
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + formatBaht(Math.abs(n));

// ---------- HOME (CP5–CP7)
async function renderHome() {
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
  S.editing = null; S.catId = null;
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
      const txIn = { ...common, kind: S.kind, categoryId: S.catId };
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
