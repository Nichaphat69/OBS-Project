/**
 * Frontend ของระบบวางบิล Outsource — vanilla ES module ไม่มี build step
 * ทุกหน้าดึงข้อมูลจริงจาก /api
 */

const api = async (path, options) => {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? `เรียก ${path} ไม่สำเร็จ`);
    error.blockers = data.blockers;
    throw error;
  }
  return data;
};

const el = (id) => document.getElementById(id);
const main = el('main');

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (value) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const int = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US'));

const icon = (name, cls = 'i sm') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

/**
 * แปลงเวลาที่เก็บในฐานข้อมูลให้เป็น Date
 *
 * ค่าที่ SQLite เขียนเองไม่มีเครื่องหมายเขตเวลากำกับ แต่เป็น **UTC** เสมอ
 * ถ้าปล่อยให้ JS เดาเอง มันจะตีเป็นเวลาท้องถิ่น แล้วเวลาจะเพี้ยนไป 7 ชั่วโมง
 * (เคยทำให้กระดิ่งขึ้นว่า "7 ชั่วโมงที่แล้ว" ทั้งที่เพิ่งกดไปเมื่อครู่)
 * ของใหม่เขียน Z กำกับแล้ว บรรทัดนี้จึงมีไว้รองรับข้อมูลเก่าที่ยังไม่มี
 */
const toDate = (iso) => {
  if (!iso) return null;
  let norm = String(iso).includes('T') ? String(iso) : String(iso).replace(' ', 'T');
  if (norm.length === 10) norm += 'T00:00:00';           // วันที่ล้วน = ไม่มีเวลา ไม่ต้องแปลงเขต
  else if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(norm)) norm += 'Z';
  const d = new Date(norm);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dt = (iso) => {
  const d = toDate(iso);
  if (!d) return iso ? String(iso) : '—';
  return d.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const THAI_M_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * '2026-01' → '1–31 ม.ค. 2569'
 * ใช้แสดงบนหน้าจอเท่านั้น — description ที่ส่งเข้า FlowAccount ยังเป็นวันที่เต็ม
 */
const compactPeriod = (period) => {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `1–${last} ${THAI_M_SHORT[m - 1]} ${y + 543}`;
};

const dateOnly = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
};

function toast(message, isError = false) {
  const node = el('tst');
  node.textContent = message;
  node.classList.toggle('err', isError);
  node.classList.add('on');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('on'), isError ? 8000 : 6000);
}

// ─────────────────────────────────────────────────────────────

const state = {
  view: 'dash', detailId: null, tab: 1,
  queueFilter: 'action', queueSearch: '', queuePage: 1,
  queueSort: 'urgent', expanded: null,
  cycleFilter: 'all',
  masterTab: 1, uploadTab: 1,
  /* ผลที่ AI อ่านจากไฟล์ที่เพิ่งอัปโหลด — ยังไม่ได้บันทึกลงฐานข้อมูล
     อยู่ในหน่วยความจำหน้าจอจนกว่าคนจะกดยืนยัน รีเฟรชแล้วหาย ซึ่งถูกต้อง
     เพราะสิ่งที่ AI อ่านมายังไม่ใช่ข้อมูลของระบบจนกว่าจะมีคนรับรอง */
  read: null,
};

const STATUS_CLASS = {
  verified: 'ok', mismatch: 'cr', billed: 'ok', rejected: 'mu',
  received: 'pr', extracted: 'pr', approved: 'ok',
};

const CYCLE_STATE_CLASS = {
  awaiting: 'pr', partial: 'wn', mismatch: 'cr', checking: 'wn', ready: 'ok', billed: 'ok',
};

/* ══ แดชบอร์ด — หน้าเดียวที่ไม่ใช่ขั้นตอนงาน ═══════════════
   ไว้ดูภาพรวมว่าตอนนี้เงินอยู่ตรงไหนของ process และมีอะไรค้างที่ขั้นไหน
   ทุกตัวเลขมาจากสถานะจริงในระบบ — ไม่มีเรื่องการรับชำระ เพราะระบบไม่ได้บันทึกการรับเงิน */

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'สวัสดีตอนเช้า';
  if (h < 17) return 'สวัสดีตอนบ่าย';
  return 'สวัสดีตอนเย็น';
}

function trendPill(value, label) {
  if (value === null || value === undefined) return '<span class="pill flat">ยังเทียบไม่ได้</span>';
  const up = value >= 0;
  return `<span class="pill ${up ? 'up' : 'down'}" title="เทียบ${esc(label ?? 'เดือนก่อน')}">
    ${up ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%</span>`;
}

/** กราฟแท่ง planned vs billed/pending — วาดด้วย CSS ไม่ใช้ไลบรารี */
function chartHtml(series) {
  if (!series.length) return '<div class="empty">ยังไม่มีข้อมูล</div>';
  const max = Math.max(...series.map((s) => Math.max(s.planned, s.billed, s.pending))) || 1;

  return `
  <div class="chart">
    ${series.map((s) => {
      const actual = s.billed || s.pending;
      const isPending = !s.billed && s.pending > 0;
      const planH = Math.max((s.planned / max) * 100, 4);
      const fillH = actual ? Math.max((actual / s.planned) * 100, 5) : 0;
      return `
      <div class="col ${actual ? 'on' : ''}">
        <div class="stack">
          <div class="plan" style="height:${planH}%">
            ${actual ? `<div class="fill ${isPending ? 'pend' : ''}" style="height:${fillH}%">
              <span class="cap">${money(actual)}</span></div>` : ''}
          </div>
        </div>
        <span class="xl">${esc(s.monthShort)}</span>
      </div>`;
    }).join('')}
  </div>
  <div class="chart-legend">
    <span><i style="background:linear-gradient(180deg,#2FA2EC,var(--brand-d))"></i> วางบิลแล้ว</span>
    <span><i class="fill pend" style="border:1px solid var(--bline)"></i> ตรวจผ่าน ยังไม่วางบิล</span>
    <span><i style="background:var(--hair);border:1px dashed var(--rule)"></i> เรทตามสัญญา</span>
  </div>`;
}

const SPLIT_LABEL = {
  billed: 'วางบิลแล้ว', ready: 'รออนุมัติ', checking: 'รอคนตรวจ',
  mismatch: 'ข้อมูลไม่ตรง', partial: 'ได้ไม่ครบ', awaiting: 'รอ Timesheet',
};
const SPLIT_COLOR = {
  billed: 'var(--ok)', ready: 'var(--brand)', checking: 'var(--wn)',
  mismatch: 'var(--cr)', partial: 'var(--tint2)', awaiting: 'var(--rule)',
};
const STEP_TAG = { 1: 'ขั้น 1', 2: 'ขั้น 2', 3: 'ขั้น 3' };

async function renderDashboard() {
  const data = await api('/dashboard');
  const contract = data.contracts[0];
  const cycles = data.cycles;

  const dist = {};
  for (const c of cycles) dist[c.state] = (dist[c.state] ?? 0) + 1;
  const order = ['billed', 'ready', 'checking', 'mismatch', 'partial', 'awaiting'];

  main.innerHTML = `
  <div class="page">
    <div class="greet">
      <div>
        <span class="hi">${greeting()}</span>
        <h1>ภาพรวมการวางบิล</h1>
        <p class="sub2">${contract
          ? `${esc(contract.customerName)} · ${esc(contract.projectName)} · ใบว่าจ้าง ${esc(contract.poNo)}`
          : 'ยังไม่มีสัญญาในระบบ'}</p>
      </div>
      <div class="tools">
        <span class="datechip">${icon('cal')} ข้อมูล ณ ${dateOnly(data.today)}</span>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi ${data.counts.waitingCheck ? 'w' : 'g'} act" data-go="queue" role="button" tabindex="0">
        <div class="kh"><span class="ic">${icon('clock')}</span><span class="kl">ขั้น 2 · รอคนตรวจ</span></div>
        <span class="kv">${int(data.counts.waitingCheck)}<small>ใบ</small></span>
        <span class="kf">${data.counts.waitingCheck
          ? `มูลค่า ${money(data.waitingCheckValue)} บาท · กดเพื่อไปตรวจ`
          : 'ตรวจและยืนยันครบทุกใบแล้ว'}</span>
      </div>

      <div class="kpi ${data.counts.readyToBill ? 'w' : 'g'} act" data-go="cycles" role="button" tabindex="0">
        <div class="kh"><span class="ic">${icon('send')}</span><span class="kl">ขั้น 3 · ยืนยันแล้ว รอวางบิล</span></div>
        <span class="kv">${int(data.counts.readyToBill)}<small>ใบ</small></span>
        <span class="kf">${data.counts.readyToBill
          ? `มูลค่า ${money(data.readyValue)} บาท · กดเพื่อไปอนุมัติ`
          : 'ไม่มีใบที่รอวางบิล'}</span>
      </div>

      <div class="kpi a">
        <div class="kh"><span class="ic">${icon('money')}</span><span class="kl">วางบิลแล้ว</span>
          ${trendPill(data.trends.billed, data.trends.previousPeriodLabel)}</div>
        <span class="kv">${money(data.billedAmount)}</span>
        <span class="kf">${int(data.invoiceCount)} ใบ · ${data.trends.latestPeriodLabel
          ? `รอบล่าสุด ${esc(data.trends.latestPeriodLabel)}`
          : 'ยังไม่มีใบที่สร้าง'}</span>
      </div>
    </div>

    <div class="mosaic c2">
      <div class="card">
        <div class="hd"><h3>มูลค่าวางบิลรายเดือน</h3>
          <span class="rt">เทียบกับเรทตามสัญญา ${money(contract?.monthlyTotal)} บาท/เดือน</span></div>
        <div class="bd">${chartHtml(data.series)}</div>
      </div>

      <div class="card">
        <div class="hd"><h3>สถานะรอบบิล</h3><span class="rt">${cycles.length} รอบตามสัญญา</span></div>
        <div class="bd">
          <div class="split">
            ${order.filter((k) => dist[k]).map((k) =>
              `<span style="flex:${dist[k]};background:${SPLIT_COLOR[k]}"
                     title="${SPLIT_LABEL[k]} ${dist[k]}"></span>`).join('')}
          </div>
          <ul class="legend-rows">
            ${order.map((k) => `
              <li><i style="background:${SPLIT_COLOR[k]}"></i>
                <span>${SPLIT_LABEL[k]}</span><b>${int(dist[k] ?? 0)}</b></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>

    <div class="mosaic c3">
      <div class="card">
        <div class="hd"><h3>งานที่ต้องทำ</h3><span class="rt">${data.tasks.length} เรื่อง</span></div>
        <div class="bd">
          <ul class="tasks">${data.tasks.slice(0, 6).map((n, i) => `
            <li>
              <span class="tic ${n.level === 'critical' ? 'cr' : n.level === 'warn' ? 'wn' : 'info'}">
                ${icon(n.level === 'info' ? 'info' : 'alt')}</span>
              <span><span class="tt">${esc(STEP_TAG[n.step] ?? '')} · ${esc(n.title)}</span>
                <span class="td">${esc(n.detail)}</span></span>
              <button class="go" data-task="${i}">เปิด</button>
            </li>`).join('') || '<li class="empty">ไม่มีงานค้าง</li>'}</ul>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>ความคืบหน้าสัญญา</h3><span class="rt">${esc(contract?.poNo ?? '')}</span></div>
        <div class="bd">
          ${contract ? `
          <div class="pair" style="gap:20px">
            <div><span class="pl">มูลค่าสัญญา</span><span class="pv">${money(contract.contractValue)}</span></div>
            <div><span class="pl">คงเหลือ</span><span class="pv c">${money(contract.remainingValue)}</span></div>
          </div>
          <div class="bar"><span style="width:${contract.progress}%"></span></div>
          <div class="progline">
            <span>${dateOnly(contract.startDate)}</span>
            <span><b>${contract.progress}%</b> · ${contract.monthsBilled}/${contract.monthsTotal} รอบ</span>
            <span>${dateOnly(contract.endDate)}</span>
          </div>
          <ul class="legend-rows" style="margin-top:16px">
            <li><i style="background:var(--brand)"></i><span>พนักงานในสัญญา</span><b>${int(contract.headcount)} คน</b></li>
            <li><i style="background:var(--tint2)"></i><span>เครดิต</span><b>${int(contract.creditDays)} วัน</b></li>
            <li><i style="background:var(--tint2)"></i><span>ส่วนลดวันลารวม</span><b>${money(data.leaveDeduction)}</b></li>
          </ul>` : '<div class="empty">ยังไม่มีสัญญา</div>'}
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>ล่าสุดในระบบ</h3></div>
        <div class="bd">
          <ul class="acts-l">${data.recentAudit.slice(0, 7).map((a) => `
            <li><span class="tx">${esc(AUDIT_TH[a.action] ?? a.action)}<small>${esc(a.actor)}${
              a.entity_id ? ` · ${esc(a.entity_id)}` : ''}</small></span>
              <span class="tm">${dt(a.at)}</span></li>`).join('') || '<li class="empty">ยังไม่มีบันทึก</li>'}</ul>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h3>รอบบิลตามสัญญา</h3>
        <span class="rt">กางทุกเดือนตามช่วงสัญญา · คลิกแถวเพื่อเปิดรอบบิล</span></div>
      <div class="bd flush"><div class="tw"><table style="min-width:820px">
        <thead><tr>
          <th>รอบบิล</th><th style="width:150px">Timesheet</th>
          <th style="width:180px">สถานะ</th><th style="width:230px">กำหนดเวลา</th>
          <th class="r" style="width:140px">มูลค่า</th>
        </tr></thead>
        <tbody>${(contract?.periods ?? []).map((c) => cycleRow(c)).join('')
          || '<tr><td colspan="5" class="empty">ยังไม่มีสัญญาในระบบ</td></tr>'}</tbody>
      </table></div></div>
    </div>

    <div class="note">${icon('info')}<span>
      <strong>ตัวเลขในหน้านี้บอกอะไรไม่ได้บ้าง</strong> —
      ระบบไม่ได้บันทึกการรับเงิน "วางบิลแล้ว" จึงแปลว่าสร้างเอกสารใน FlowAccount แล้ว
      ไม่ได้แปลว่าลูกค้าจ่ายแล้ว · ส่วนลดวันลาคิดจากเรทเดือนหารด้วยตัวหารในสัญญา (ตั้งไว้ 20)
      ซึ่งยังยืนยันไม่ได้ว่าเป็นค่าคงที่หรือวันทำงานจริงของแต่ละเดือน
    </span></div>
  </div>`;

  bindRows();
  main.querySelectorAll('[data-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const link = data.tasks[Number(btn.dataset.task)]?.link;
      if (!link) return;
      if (link.view === 'detail') openSheet(link.id);
      else openCycle(link.contractId, link.period);
    });
  });
}

/** ชื่อการกระทำในบันทึก — เก็บเป็นภาษาอังกฤษใน DB แต่หน้าจอควรอ่านออก */
const AUDIT_TH = {
  read_timesheet_file: 'AI อ่านไฟล์ Timesheet',
  extract_timesheet: 'AI อ่านไฟล์ Timesheet',
  ingest_timesheet: 'รับ Timesheet เข้าระบบ',
  ingest_timesheet_replaced: 'รับ Timesheet ฉบับแก้ไข',
  recompute_manday: 'คำนวณ Manday ใหม่',
  human_checked: 'คนยืนยันผลตรวจ',
  reject_timesheet: 'ตีกลับ Timesheet',
  approve_cycle: 'อนุมัติวางบิล',
  draft_email_llm: 'AI ร่างอีเมล',
  invoice_email_sent: 'บันทึกว่าส่งเมลแล้ว',
  add_employee_alias: 'เพิ่มชื่อพ้อง',
  update_assignment_rate: 'แก้เรทค่าบริการ',
  add_holiday: 'เพิ่มวันหยุด',
  seed: 'ใส่ข้อมูลตั้งต้น',
};

function bindRows() {
  main.querySelectorAll('[data-cycle]').forEach((row) => {
    row.addEventListener('click', () => {
      const [contractId, period] = row.dataset.cycle.split('|');
      openCycle(contractId, period);
    });
  });
  main.querySelectorAll('[data-go]').forEach((node) => {
    const go = () => setNav(node.dataset.go);
    node.addEventListener('click', go);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

/** แถวรอบบิลตามสัญญา */
function cycleRow(c, { showCustomer = false } = {}) {
  const urgent = c.overdueToBill || c.overduePayment;
  return `
  <tr class="rw ${urgent ? 'urgent' : ''}" data-cycle="${esc(c.contractId)}|${esc(c.period)}">
    <td><span class="docid">${esc(c.periodLabel)}</span>
        <span class="sub">${showCustomer ? `${esc(c.customerName)} · ` : ''}${esc(c.poNo)}</span></td>
    <td class="n">${c.received} / ${c.expected}
        ${c.missing.length
          ? `<span class="sub" title="${esc(c.missing.join(', '))}">รอ ${esc(c.missing.map(firstName).join(', '))}</span>`
          : c.uncheckedCount
            ? `<span class="sub">รอคนยืนยัน ${int(c.uncheckedCount)} ใบ</span>`
            : ''}</td>
    <td><span class="st ${CYCLE_STATE_CLASS[c.state]}">${esc(c.stateLabel)}</span>
        ${c.invoiceNo ? `<span class="sub">${esc(c.invoiceNo)}</span>` : ''}</td>
    <td>${c.state === 'billed'
        ? (c.overduePayment
            ? `<span class="tg cr">เกินกำหนด</span><span class="sub">ครบ ${dateOnly(c.dueDate)}</span>`
            : `<span class="sub" style="margin:0">ครบกำหนด ${dateOnly(c.dueDate)}</span>`)
        : (c.overdueToBill
            ? `<span class="tg wn">เลยกำหนดวางบิล</span><span class="sub">ควรวางบิล ${dateOnly(c.expectedBillDate)}</span>`
            : `<span class="sub" style="margin:0">ควรวางบิล ${dateOnly(c.expectedBillDate)}</span>`)}</td>
    <td class="r n">${money(c.value)}</td>
  </tr>`;
}



/* โหมด manual: ใบที่เครื่องตรวจผ่านแล้วแต่ยังไม่มีคนกดยืนยัน ก็ยังเป็นงานค้างของคน
   ต่างจากโหมด auto ที่ใบตรวจผ่านไหลไปเองโดยไม่ต้องมีใครแตะ */
const needsHuman = (t) =>
  ['mismatch', 'received', 'extracted'].includes(t.status) ||
  (t.status === 'verified' && !t.check?.checked);

const QUEUE_FILTERS = {
  action: { label: 'ต้องตรวจ', test: needsHuman },
  checked: { label: 'ยืนยันแล้ว', test: (t) => t.check?.checked && t.status !== 'billed' },
  all: { label: 'ทั้งหมด', test: () => true },
  billed: { label: 'วางบิลแล้ว', test: (t) => t.status === 'billed' },
  rejected: { label: 'ตีกลับ', test: (t) => t.status === 'rejected' },
};

/** อักษรย่อจากชื่อ — ใช้เป็นตราหน้าการ์ด */
function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] ?? '') + (parts[1][0] ?? '');
  return (parts[0] ?? '?').slice(0, 2);
}

const AVA_TONE = { verified: 'g', mismatch: 'c', billed: 'g', rejected: '', received: '', extracted: '' };
const PAGE_SIZE = 6;

/** ชื่อต้นของคนไทย — ใช้ในคอลัมน์แคบที่ใส่ชื่อเต็มไม่พอ */
function firstName(full) {
  return String(full ?? '').trim().split(/\s+/)[0];
}

/** การ์ด Timesheet — มีตารางย่อยสรุปการคำนวณในตัว */
function sheetCard(t) {
  const flagged = t.status === 'mismatch';
  const failures = (t.checks ?? []).filter((c) => c.severity === 'fail');

  return `
  <div class="rec ${flagged ? 'flag' : ''}" data-sheet="${esc(t.id)}">
    <div class="rec-hd">
      <span class="ava ${AVA_TONE[t.status] ?? ''}">${esc(initials(t.employee.nameTh))}</span>
      <span>
        <span class="nm2">${esc(t.employee.nameTh)}</span>
        <span class="mt2">${esc(t.employee.invoicePosition ?? '—')}</span>
      </span>
      <span class="rt2">
        <span class="st ${STATUS_CLASS[t.status] ?? 'mu'}">${esc(t.statusLabel)}</span>
      </span>
    </div>

    <div class="rec-tags">
      <span class="tag">${esc(t.periodLabel)}</span>
      <span class="tag">เลขที่ ${esc(t.id)}</span>
      ${t.reportedLeave ? `<span class="tag lv">ลา ${int(t.reportedLeave)} วัน</span>` : ''}
      ${t.check?.checked ? `<span class="tag ok">${icon('chk')} ยืนยันแล้ว</span>` : ''}
      ${t.check?.stale ? '<span class="tag lv">ยอดเปลี่ยน ต้องยืนยันใหม่</span>' : ''}
      ${t.invoiceNo ? `<span class="tag ok">${esc(t.invoiceNo)}</span>` : ''}
    </div>
    <div class="rec-when">รับเมื่อ ${dt(t.receivedAt)}</div>

    <div class="minitab">
      <div class="mh2"><span>รายการคำนวณ</span><span class="q">จำนวน</span><span class="p">บาท</span></div>
      <div class="mr">
        <span class="lb2">เรทค่าบริการต่อเดือน</span>
        <span class="q">1 เดือน</span>
        <span class="p">${money(t.employee.monthlyRate)}</span>
      </div>
      <div class="mr">
        <span class="lb2">วันทำงานที่วางบิลได้<small>ตาม Timesheet ${int(t.reportedWorkDays)} วัน</small></span>
        <span class="q">${int(t.payableDays)} วัน</span>
        <span class="p">—</span>
      </div>
      ${t.reportedLeave
        ? `<div class="mr neg">
             <span class="lb2">ส่วนลดวันลา<small>ลา ${int(t.reportedLeave)} วัน</small></span>
             <span class="q">${int(t.reportedLeave)} วัน</span>
             <span class="p">−${money(t.discount)}</span>
           </div>`
        : `<div class="mr"><span class="lb2">ส่วนลดวันลา<small>ไม่มีวันลา</small></span>
             <span class="q">0 วัน</span><span class="p">—</span></div>`}
    </div>

    <div class="rec-total">
      <span class="tl">ยอดที่วางบิลได้</span>
      <span class="tv">${money(t.lineAmount)}</span>
    </div>

    ${failures.length
      ? `<div class="note cr" style="margin:0">${icon('alt')}<span>${esc(failures.map((f) => f.title).join(' · '))}</span></div>`
      : t.statusReason
        ? `<div class="note wn" style="margin:0">${icon('alt')}<span>${esc(t.statusReason)}</span></div>`
        : t.status === 'verified' && !t.check?.checked
          ? `<div class="note wn" style="margin:0">${icon('alt')}<span>
              เครื่องตรวจผ่านแล้ว แต่ยังไม่มีคนกดยืนยัน — รอบบิลนี้จะยังอนุมัติไม่ได้</span></div>`
          : ''}

    <div class="rec-acts ${t.status === 'billed' ? 'one' : ''}">
      <button class="btn pri" data-open="${esc(t.id)}">${icon('file')} เปิดตรวจ</button>
      ${t.status === 'billed' ? '' : `<button class="btn dgr" data-reject="${esc(t.id)}">ตีกลับ</button>`}
    </div>
  </div>`;
}

function matchesSearch(t, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  return [
    t.id, t.employee.nameTh, t.employee.nameEn, t.employee.invoicePosition,
    t.rawPosition, t.periodLabel, t.period, t.invoiceNo, t.statusLabel,
  ].some((v) => String(v ?? '').toLowerCase().includes(q));
}

const SORTS = {
  recent: { label: 'รับล่าสุด', cmp: (a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)) },
  amount: { label: 'ยอดสูงสุด', cmp: (a, b) => (b.lineAmount ?? 0) - (a.lineAmount ?? 0) },
  urgent: { label: 'ต้องแก้ก่อน', cmp: (a, b) => URGENCY[a.status] - URGENCY[b.status] },
  name: { label: 'ชื่อพนักงาน', cmp: (a, b) => a.employee.nameTh.localeCompare(b.employee.nameTh, 'th') },
  period: { label: 'รอบบิล', cmp: (a, b) => String(b.period).localeCompare(String(a.period)) },
};
const URGENCY = { mismatch: 0, verified: 1, received: 2, extracted: 3, rejected: 4, billed: 5, approved: 2 };


async function renderQueue() {
  const sheets = await api('/timesheets');

  const byFilter = sheets.filter(QUEUE_FILTERS[state.queueFilter].test);
  const found = byFilter
    .filter((t) => matchesSearch(t, state.queueSearch))
    .sort(SORTS[state.queueSort].cmp);

  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  if (state.queuePage > pages) state.queuePage = 1;
  const start = (state.queuePage - 1) * PAGE_SIZE;
  const shown = found.slice(start, start + PAGE_SIZE);

  main.innerHTML = `
  <div class="page">
    <h1 class="sr-only">กล่องงาน</h1>

    <div class="card">
      <div class="filterbar">
        <div class="pills">
          ${Object.entries(QUEUE_FILTERS).map(([key, f]) => `
            <button class="pbtn ${state.queueFilter === key ? 'on' : ''}" data-filter="${key}">
              ${f.label}<span class="c">${byFilter === null ? 0 : sheets.filter(f.test).length}</span></button>`).join('')}
        </div>
        <div class="gap"></div>
        <span class="selectwrap">
          <span class="lb3">เรียงตาม</span>
          <span class="selectchip">
            <select id="qSort">
              ${Object.entries(SORTS).map(([key, s]) =>
                `<option value="${key}" ${state.queueSort === key ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
            ${icon('cd')}
          </span>
        </span>
        <label class="searchbox">
          ${icon('srch')}
          <input type="search" id="qSearch" placeholder="ค้นหาชื่อ เลขเอกสาร ตำแหน่ง รอบบิล…"
                 value="${esc(state.queueSearch)}" autocomplete="off">
        </label>
        <button class="iconbtn ${state.queueSearch ? 'on' : ''}" id="clearSearch"
                title="${state.queueSearch ? 'ล้างคำค้น' : 'ตัวกรอง'}">
          ${icon(state.queueSearch ? 'cl' : 'flt')}
        </button>
      </div>

      ${shown.length
        ? `<div class="cardgrid">${shown.map(sheetCard).join('')}</div>`
        : `<div class="empty">${icon('inbox', 'i')}<div>${state.queueSearch
            ? `ไม่พบรายการที่ตรงกับ "${esc(state.queueSearch)}"`
            : state.queueFilter === 'action'
              ? 'ไม่มีใบที่รอตรวจ — ทุกใบมีคนยืนยันแล้ว ไปต่อที่ขั้น 3 วางบิล'
              : 'ไม่มีรายการในหมวดนี้'}</div></div>`}

      <div class="pager">
        <span class="info">${found.length
          ? `แสดง ${start + 1}–${Math.min(start + PAGE_SIZE, found.length)} จาก ${found.length} รายการ`
          : 'ไม่มีรายการ'}${state.queueSearch ? ` · กรองจาก ${byFilter.length} รายการ` : ''}</span>
        <div class="gap"></div>
        <div class="pgn">
          <button data-page="${state.queuePage - 1}" ${state.queuePage === 1 ? 'disabled' : ''}
                  aria-label="ก่อนหน้า">${icon('cl')}</button>
          ${Array.from({ length: pages }, (_, i) => `
            <button data-page="${i + 1}" class="${state.queuePage === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}
          <button data-page="${state.queuePage + 1}" ${state.queuePage === pages ? 'disabled' : ''}
                  aria-label="ถัดไป">${icon('cr')}</button>
        </div>
      </div>
    </div>
  </div>`;

  main.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.queueFilter = btn.dataset.filter;
      state.queuePage = 1;
      renderQueue();
    });
  });

  main.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (page < 1 || page > pages) return;
      state.queuePage = page;
      renderQueue();
    });
  });

  // ค้นหาแบบพิมพ์แล้วกรองทันที รักษาตำแหน่งเคอร์เซอร์ไว้
  const search = el('qSearch');
  search.addEventListener('input', () => {
    state.queueSearch = search.value;
    state.queuePage = 1;
    clearTimeout(search._t);
    search._t = setTimeout(async () => {
      await renderQueue();
      const next = el('qSearch');
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }, 220);
  });

  el('clearSearch').addEventListener('click', () => {
    if (!state.queueSearch) return;
    state.queueSearch = '';
    state.queuePage = 1;
    renderQueue();
  });

  el('qSort').addEventListener('change', (e) => {
    state.queueSort = e.target.value;
    state.queuePage = 1;
    renderQueue();
  });

  // คลิกแถวเพื่อกาง/พับรายละเอียด
  main.querySelectorAll('[data-row]').forEach((row) => {
    row.addEventListener('click', () => {
      state.expanded = state.expanded === row.dataset.row ? null : row.dataset.row;
      renderQueue();
    });
  });

  main.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSheet(btn.dataset.open); });
  });

  main.querySelectorAll('[data-recompute]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const r = await api(`/timesheets/${encodeURIComponent(btn.dataset.recompute)}/recompute`, { method: 'POST' });
        toast(`คำนวณใหม่แล้ว — วางบิลได้ ${r.payableDays} วัน ส่วนลด ${money(r.discount)} บาท`);
        renderQueue();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reason = prompt('เหตุผลที่ตีกลับให้แก้ Timesheet:');
      if (!reason) return;
      try {
        await api(`/timesheets/${encodeURIComponent(btn.dataset.reject)}/reject`, {
          method: 'POST', body: JSON.stringify({ reason }),
        });
        toast('ตีกลับเรียบร้อย');
        renderQueue();
      } catch (error) { toast(error.message, true); }
    });
  });
}

// ── รายละเอียด Timesheet ────────────────────────────────────

const SEV_TAG = { pass: 'ok', warn: 'wn', fail: 'cr' };
const SEV_LABEL = { pass: 'ผ่าน', warn: 'ทักไว้', fail: 'ไม่ผ่าน' };
const DOW = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const KIND_LABEL = { workday: 'ทำงาน', weekend: null, holiday: null, leave: 'ลา' };

function calendarHtml(manday) {
  if (!manday?.calendar) return '<div class="empty">ยังไม่ได้คำนวณ</div>';
  const { days, counts } = manday.calendar;
  // ปฏิทินเริ่มวันจันทร์: getUTCDay() 0=อาทิตย์ → คอลัมน์ 6
  const firstCol = (days[0].dayOfWeek + 6) % 7;
  const leaveByDate = new Map(manday.leaveDays.map((l) => [l.date, l.type]));
  const LEAVE_TH = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', unpaid: 'ลาไม่รับค่าจ้าง' };

  const cells = [
    ...Array.from({ length: firstCol }, () => '<div class="cl vd"></div>'),
    ...days.map((d) => {
      const label = d.kind === 'leave'
        ? (LEAVE_TH[leaveByDate.get(d.date)] ?? 'ลา')
        : d.kind === 'holiday' ? d.label
        : d.kind === 'weekend' ? (d.dayOfWeek === 6 ? 'เสาร์' : 'อาทิตย์')
        : KIND_LABEL[d.kind];
      return `<div class="cl ${d.kind}"><span class="dn">${d.day}</span>
        ${label ? `<span class="dl">${esc(label)}</span>` : ''}</div>`;
    }),
  ];

  return `
    <div class="cal">
      ${DOW.map((d) => `<div class="dw">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="lgd">
      <span><i style="background:#fff;border-color:var(--rule)"></i> ทำงาน <b>${counts.workday}</b> วัน</span>
      <span><i style="background:var(--lvb);border-color:var(--lvl)"></i> ลา <b>${counts.leave}</b> วัน</span>
      <span><i style="background:var(--tint);border-color:var(--bline)"></i> วันหยุด <b>${counts.holiday}</b> วัน</span>
      <span><i style="background:var(--snk)"></i> เสาร์–อาทิตย์ <b>${counts.weekend}</b> วัน</span>
    </div>`;
}

/**
 * ผลการจับคู่กับฐานข้อมูล + ทางแก้ตรงจุดที่เจอปัญหา
 *
 * เดิมหน้านี้บอกได้แค่ว่า "ไม่พบ" แล้วจบ คนต้องไปเรียกโปรแกรมเมอร์มาเพิ่มชื่อพ้อง
 * ปุ่มเพิ่มชื่อพ้องจึงอยู่ตรงนี้ — ที่เดียวกับที่คนเห็นปัญหา ไม่ต้องไปหาหน้าอื่น
 */
function matchingHtml(m, sheet) {
  const row = (label, value, ok, needsConfirm, reason, fix = '') => `
    <li><span class="l">${label}<small>${esc(reason)}</small>${fix}</span>
      <span class="tg ${ok ? (needsConfirm ? 'wn' : 'ok') : 'cr'}">${esc(value)}</span></li>`;

  /* เสนอเพิ่มชื่อพ้องเมื่อจับคู่ไม่ได้ หรือจับคู่ได้แบบใกล้เคียงที่ต้องยืนยัน
     ถ้าตรงเป๊ะอยู่แล้วไม่ต้องเสนอ จะรบกวนเปล่าๆ */
  const empId = sheet?.employee?.id;
  const nameFix = (!m.name.ok || m.name.needsConfirm) && empId && m.name.raw
    ? `<button class="lk fixa" data-alias-kind="name" data-alias="${esc(m.name.raw)}"
         data-emp="${esc(empId)}">+ เพิ่ม "${esc(m.name.raw)}" เป็นชื่อพ้องของ ${esc(sheet.employee.nameTh)}</button>`
    : '';
  const posFix = !m.position.ok && empId && sheet?.rawPosition
    ? `<button class="lk fixa" data-alias-kind="position" data-alias="${esc(sheet.rawPosition)}"
         data-emp="${esc(empId)}">+ เพิ่ม "${esc(sheet.rawPosition)}" เป็นตำแหน่งพ้อง</button>`
    : '';

  return `<ul class="cks">
    ${row('ชื่อพนักงาน',
        m.name.ok ? (m.name.needsConfirm ? 'ต้องยืนยัน' : 'จับคู่ได้') : 'ไม่พบ',
        m.name.ok, m.name.needsConfirm,
        `"${m.name.raw}" → ${m.name.matchedTo ?? 'ไม่พบ'} · ${m.name.reason}`, nameFix)}
    ${row('ตำแหน่ง', m.position.ok ? 'ตรง' : 'ต่างกัน', m.position.ok, false, m.position.reason, posFix)}
    ${row('เรทค่าบริการ', m.rate.ok ? 'ตรง' : 'ไม่ตรง', m.rate.ok, false,
        `${money(m.rate.fromContract)} บาท/เดือน · ${m.rate.reason}`)}
  </ul>`;
}

/** ผูกปุ่มเพิ่มชื่อพ้อง — เพิ่มแล้วคำนวณใหม่ทันที ให้เห็นผลในคลิกเดียว */
function bindAliasFix(sheetId) {
  main.querySelectorAll('.fixa').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/employees/${encodeURIComponent(btn.dataset.emp)}/aliases`, {
          method: 'POST',
          body: JSON.stringify({ kind: btn.dataset.aliasKind, alias: btn.dataset.alias }),
        });
        await api(`/timesheets/${encodeURIComponent(sheetId)}/recompute`, { method: 'POST' });
        toast(`เพิ่มชื่อพ้อง "${btn.dataset.alias}" และคำนวณใหม่แล้ว`);
        openSheet(sheetId);
      } catch (error) {
        btn.disabled = false;
        toast(error.message, true);
      }
    });
  });
}

async function openSheet(id) {
  state.view = 'detail';
  state.detailId = id;
  state.tab = 1;
  markTab('detail');

  main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  syncBadges();
  const sheet = await api(`/timesheets/${encodeURIComponent(id)}`);
  const manday = sheet.manday;
  const failures = (manday?.checks ?? []).filter((c) => c.severity === 'fail');
  const warnings = (manday?.checks ?? []).filter((c) => c.severity === 'warn');
  const step = sheet.status === 'billed' ? 4
    : failures.length || !sheet.check?.checked ? 2
    : 3;

  main.innerHTML = `
  <div class="page">
    <button class="back" id="backBtn">${icon('cl')} กลับไปกล่องงาน</button>

    <div class="phd">
      <div>
        <span class="ey">Timesheet ${esc(sheet.id)} · รอบบิล ${esc(sheet.periodLabel)}</span>
        <h1>${esc(sheet.employee.nameTh)} — ${esc(sheet.employee.invoicePosition ?? '')}</h1>
        <p>${esc(sheet.contract.customerName)} · โครงการ ${esc(sheet.contract.projectName)}
           · ใบว่าจ้าง ${esc(sheet.contract.poNo)} · สัญญา ${esc(sheet.contract.contractNo ?? '—')}</p>
      </div>
      <div class="acts">
        <button class="btn" id="recomputeBtn">${icon('rf')} คำนวณใหม่</button>
      </div>
    </div>

    <div class="prog">
      <div class="pstep dn"><span class="cir">${icon('chk')}</span><span class="pl">อัปโหลด · AI อ่านไฟล์</span></div>
      <div class="pline dn"></div>
      <div class="pstep ${step >= 3 ? 'dn' : 'cu'}"><span class="cir">${step >= 3 ? icon('chk') : '2'}</span><span class="pl">ตรวจ Manday · คนยืนยัน</span></div>
      <div class="pline ${step >= 3 ? 'dn' : ''}"></div>
      <div class="pstep ${step === 3 ? 'cu' : step > 3 ? 'dn' : ''}"><span class="cir">${step > 3 ? icon('chk') : '3'}</span><span class="pl">วางบิล FlowAccount</span></div>
      <div class="pline ${step > 3 ? 'dn' : ''}"></div>
      <div class="pstep ${step === 4 ? 'cu' : ''}"><span class="cir">4</span><span class="pl">ร่างอีเมลถึงลูกค้า</span></div>
    </div>

    <div class="tabs" role="tablist">
      ${['ภาพรวม', 'ไฟล์ต้นทาง', 'คำนวณ Manday', 'ผลตรวจสอบ'].map((t, i) =>
        `<button class="tab ${state.tab === i + 1 ? 'on' : ''}" data-tab="${i + 1}">${t}</button>`).join('')}
    </div>

    <!-- ภาพรวม -->
    <div class="tp ${state.tab === 1 ? 'on' : ''}" data-pane="1">
      <div class="g3">
        <div>
          <div class="card">
            <div class="hd"><h3>สรุปรายการที่จะวางบิล</h3></div>
            <div class="bd flush"><table class="ldg"><tbody>
              <tr><td>เรทค่าบริการต่อเดือนตามใบว่าจ้าง</td><td class="r">${money(manday?.monthlyRate)}</td></tr>
              <tr><td>วันทำงานของเดือน<span class="sub">หักเสาร์–อาทิตย์ และวันหยุดแล้ว</span></td><td class="r">${int(manday?.standardWorkingDays)} วัน</td></tr>
              <tr><td>ทำงานจริงตาม Timesheet</td><td class="r">${int(sheet.reportedWorkDays)} วัน</td></tr>
              <tr><td>วันลา</td><td class="r">${int(manday?.leaveCount)} วัน</td></tr>
              <tr><td>อัตราต่อวัน<span class="sub">${money(manday?.monthlyRate)} ÷ ${int(manday?.divisor?.applied)}</span></td><td class="r">${money(manday?.dailyRate)}</td></tr>
              <tr class="res"><td>ส่วนลดวันลา</td><td class="r">−${money(manday?.discount)}</td></tr>
            </tbody></table></div>
            <div class="bd">
              <div class="tot">
                <div class="t py"><span>ยอดของรายการนี้</span><span class="v">${money(manday?.lineAmount)}</span></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="hd"><h3>การจับคู่กับฐานข้อมูล</h3>
              <span class="rt">ตำแหน่งบนใบแจ้งหนี้ใช้ค่าจากฐานข้อมูล ไม่ใช่จาก Timesheet</span></div>
            <div class="bd">${matchingHtml(sheet.matching, sheet)}</div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="hd"><h3>ข้อมูลอ้างอิง</h3></div>
            <div class="bd"><dl class="kv">
              <dt>ลูกค้า</dt><dd>${esc(sheet.contract.customerName)}</dd>
              <dt>เลขผู้เสียภาษี</dt><dd class="n">${esc(sheet.contract.taxId ?? '—')}</dd>
              <dt>ใบว่าจ้าง</dt><dd class="n">${esc(sheet.contract.poNo)}</dd>
              <dt>สัญญา</dt><dd class="n">${esc(sheet.contract.contractNo ?? '—')}</dd>
              <dt>ใบเสนอราคา</dt><dd class="n">${esc(sheet.employee.quotationNo ?? '—')}</dd>
              <dt>ช่วงสัญญา</dt><dd>${dateOnly(sheet.contract.startDate)} – ${dateOnly(sheet.contract.endDate)}</dd>
              <dt>เครดิต</dt><dd>${int(sheet.contract.creditDays)} วัน</dd>
              <dt>ตัวหารอัตราต่อวัน</dt><dd>${sheet.contract.divisorMode === 'fixed'
                  ? `คงที่ ${int(sheet.contract.divisorValue)}` : 'วันทำงานจริงของเดือน'}</dd>
              <dt>ผู้ประสานงาน</dt><dd>${esc(sheet.contract.contactName ?? '—')}</dd>
            </dl></div>
          </div>

          <div class="card">
            <div class="hd"><h3>ประวัติการดำเนินการ</h3></div>
            <div class="bd"><ul class="acts-l">
              <li><span class="tx">รับเข้าระบบ<small>${esc(sheet.sourceFile ?? sheet.sourceEmailId ?? '—')}</small></span>
                <span class="tm">${dt(sheet.receivedAt)}</span></li>
              <li><span class="tx">ลูกค้าอนุมัติ Timesheet<small>${esc(sheet.approvedBy ?? '—')}</small></span>
                <span class="tm">${dateOnly(sheet.approvedAt)}</span></li>
              ${sheet.audit.map((a) => `
                <li><span class="tx">${esc(a.action)}<small>${esc(a.actor)}</small></span>
                  <span class="tm">${dt(a.at)}</span></li>`).join('')}
            </ul></div>
          </div>
        </div>
      </div>
    </div>

    <!-- อีเมล & Timesheet -->
    <div class="tp ${state.tab === 2 ? 'on' : ''}" data-pane="2">
      <div class="card">
        <div class="hd"><h3>ที่มาของข้อมูล</h3></div>
        <div class="bd">
          <dl class="kv" style="margin-bottom:16px">
            <dt>ไฟล์ที่อัปโหลด</dt><dd>${esc(sheet.sourceFile ?? '—')}</dd>
            <dt>อ้างอิงอีเมล</dt><dd class="n">${esc(sheet.sourceEmailId ?? 'ไม่ได้ระบุ')}</dd>
            <dt>ชื่อที่เขียนในไฟล์</dt><dd>${esc(sheet.rawEmployeeName ?? '—')}</dd>
            <dt>ตำแหน่งที่เขียนในไฟล์</dt><dd>${esc(sheet.rawPosition ?? '—')}</dd>
            <dt>Total Work days</dt><dd class="n">${int(sheet.reportedWorkDays)}</dd>
            <dt>Leave / Sick (days)</dt><dd class="n">${int(sheet.reportedLeave)}</dd>
          </dl>
          <div class="files">
            <span class="file"><span class="pd">PDF</span> ${esc(sheet.sourceFile ?? 'ไม่มีไฟล์')}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>ป้ายกำกับรายวันที่อ่านได้</h3>
          <span class="rt">เฉพาะวันที่ไม่ใช่วันทำงานปกติ</span></div>
        <div class="bd flush"><div class="tw"><table style="min-width:520px">
          <thead><tr><th>วันที่</th><th>ป้ายกำกับ</th><th>เวลาเข้า–ออก</th></tr></thead>
          <tbody>${sheet.dayLabels.length
            ? sheet.dayLabels.map((d) => `<tr><td class="n">${esc(d.date)}</td><td>${esc(d.label ?? '—')}</td>
                <td class="n">${d.time_in ? `${esc(d.time_in)} – ${esc(d.time_out ?? '')}` : '—'}</td></tr>`).join('')
            : '<tr><td colspan="3" class="empty">ไม่มีข้อมูล</td></tr>'}</tbody>
        </table></div></div>
      </div>

      ${sheet.extraction ? `<div class="card">
        <div class="hd"><h3>ผลการอ่านไฟล์ดิบ</h3></div>
        <div class="bd"><pre class="code">${esc(JSON.stringify(sheet.extraction, null, 2))}</pre></div>
      </div>` : ''}
    </div>

    <!-- คำนวณ Manday -->
    <div class="tp ${state.tab === 3 ? 'on' : ''}" data-pane="3">
      <div class="card">
        <div class="hd"><h3>ปฏิทิน ${esc(sheet.periodLabel)}</h3>
          <span class="rt">คำนวณจากปฏิทินวันหยุดในระบบ</span></div>
        <div class="bd">${calendarHtml(manday)}</div>
      </div>

      <div class="card">
        <div class="hd"><h3>หมายเหตุที่จะขึ้นบนใบแจ้งหนี้</h3></div>
        <div class="bd">${manday?.remarkLines?.length
          ? `<div class="rmk">${esc(manday.remarkLines.join('\n'))}</div>`
          : '<div class="empty">ไม่มีวันลา จึงไม่มีหมายเหตุ</div>'}</div>
      </div>
    </div>

    <!-- ผลตรวจสอบ -->
    <div class="tp ${state.tab === 4 ? 'on' : ''}" data-pane="4">
      <div class="card">
        <div class="hd"><h3>ผลการตรวจสอบอัตโนมัติ</h3>
          <span class="rt">ผ่าน ${(manday?.checks ?? []).filter((c) => c.severity === 'pass').length}
            · ทักไว้ ${warnings.length} · ไม่ผ่าน ${failures.length}</span></div>
        <div class="bd"><ul class="cks">
          ${(manday?.checks ?? []).map((c) => `
            <li><span class="l">${esc(c.title)}<small>${esc(c.detail)}</small></span>
              <span class="tg ${SEV_TAG[c.severity]}">${SEV_LABEL[c.severity]}</span></li>`).join('')
            || '<li class="empty">ยังไม่ได้คำนวณ</li>'}
        </ul></div>
      </div>
    </div>

    <div class="fbar">
      <span class="sx">${failures.length
        ? `<b>ยังยืนยันไม่ได้</b> — ${esc(failures.map((f) => f.title).join(' · '))}`
        : sheet.status === 'billed'
          ? `<b>วางบิลแล้ว</b> — ${esc(sheet.invoiceNo ?? '')}`
          : sheet.check?.checked
            ? `<b>ยืนยันแล้ว</b> — ${esc(sheet.check.by ?? '')} · ${dt(sheet.check.at)}`
            : sheet.check?.stale
              ? '<b>ยอดเปลี่ยนหลังยืนยันไปแล้ว</b> — อ่านตัวเลขชุดใหม่แล้วยืนยันอีกครั้ง'
              : '<b>เครื่องตรวจผ่าน</b> — อ่านแล้วกดยืนยันเพื่อให้รอบบิลนี้อนุมัติได้'}</span>
      <div class="gap"></div>
      <button class="btn dgr" id="rejectBtn">ตีกลับให้แก้ Timesheet</button>
      ${sheet.status === 'billed' || sheet.check?.checked
        ? `<button class="btn pri" id="toCycleBtn">${icon('send')} ไปขั้น 3 วางบิล</button>`
        : `<button class="btn pri" id="checkBtn" ${failures.length ? 'disabled' : ''}>
             ${icon('chk')} ยืนยันว่าตรวจแล้ว</button>`}
    </div>
  </div>`;

  el('backBtn').addEventListener('click', () => setNav('queue'));
  bindAliasFix(id);
  main.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = Number(btn.dataset.tab);
      main.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === btn));
      main.querySelectorAll('[data-pane]').forEach((p) =>
        p.classList.toggle('on', Number(p.dataset.pane) === state.tab));
    });
  });

  el('recomputeBtn').addEventListener('click', async () => {
    try {
      const result = await api(`/timesheets/${encodeURIComponent(id)}/recompute`, { method: 'POST' });
      toast(`คำนวณใหม่แล้ว — วันที่วางบิลได้ ${result.payableDays} วัน ส่วนลด ${money(result.discount)} บาท`);
      openSheet(id);
    } catch (error) { toast(error.message, true); }
  });

  el('rejectBtn').addEventListener('click', async () => {
    const reason = prompt('เหตุผลที่ตีกลับให้แก้ Timesheet:');
    if (!reason) return;
    try {
      await api(`/timesheets/${encodeURIComponent(id)}/reject`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      toast('ตีกลับเรียบร้อย');
      setNav('queue');
    } catch (error) { toast(error.message, true); }
  });

  el('toCycleBtn')?.addEventListener('click', () =>
    openCycle(sheet.contract.id, sheet.period));

  /* ประตูของขั้นที่ 2 — ตราที่ประทับผูกกับยอดชุดที่คนเพิ่งเห็นบนจอนี้
     ถ้ายอดเปลี่ยนทีหลัง ตราหมดอายุเองและปุ่มนี้กลับมาให้กดใหม่ */
  el('checkBtn')?.addEventListener('click', async () => {
    const btn = el('checkBtn');
    btn.disabled = true;
    try {
      await api(`/timesheets/${encodeURIComponent(id)}/check`, { method: 'POST' });
      toast(`ยืนยันแล้ว — ${sheet.employee.nameTh} รอบ ${sheet.periodLabel} พร้อมเข้ารอบบิล`);
      openSheet(id);
      syncBadges();
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}

// ── รอบบิล ──────────────────────────────────────────────────

const CYCLE_FILTERS = {
  ready: { label: 'พร้อมอนุมัติ', test: (c) => c.state === 'ready' },
  all: { label: 'ทุกรอบ', test: () => true },
  todo: { label: 'ยังไม่จบ', test: (c) => c.state !== 'billed' },
  chase: { label: 'รอ Timesheet', test: (c) => c.state === 'awaiting' || c.state === 'partial' },
  billed: { label: 'วางบิลแล้ว', test: (c) => c.state === 'billed' },
};

async function renderCycles() {
  const data = await api('/cycles');

  const all = data.cycles.slice().sort((a, b) => a.period.localeCompare(b.period));
  const filtered = all.filter(CYCLE_FILTERS[state.cycleFilter].test);

  main.innerHTML = `
  <div class="page">
    <h1 class="sr-only">รอบบิล</h1>

    ${data.contracts.map((ct) => `
      <div class="card">
        <div class="hd">
          <h3>${esc(ct.poNo)} — ${esc(ct.customerName)}</h3>
          <span class="rt">${esc(ct.projectName)} · ${dateOnly(ct.startDate)} – ${dateOnly(ct.endDate)}</span>
        </div>
        <div class="bd" style="padding-bottom:0">
          <div class="pair">
            <div><span class="pl">มูลค่าสัญญา</span><span class="pv">${money(ct.contractValue)}<small>บาท</small></span></div>
            <div><span class="pl">วางบิลแล้ว</span><span class="pv a">${money(ct.billedValue)}<small>บาท</small></span></div>
            <div><span class="pl">คงเหลือ</span><span class="pv c">${money(ct.remainingValue)}<small>บาท</small></span></div>
            <div><span class="pl">รอบบิล</span><span class="pv">${ct.monthsBilled} / ${ct.monthsTotal}<small>เดือน</small></span></div>
          </div>
          <div class="bar"><span style="width:${ct.progress}%"></span></div>
          <div class="progline" style="padding-bottom:18px">
            <span>${dateOnly(ct.startDate)}</span>
            <span><b>${ct.progress}%</b> ของสัญญา</span>
            <span>${dateOnly(ct.endDate)}</span>
          </div>
        </div>
      </div>`).join('')}

    <div class="card">
      <div class="tbar">
        <div class="seg">
          ${Object.entries(CYCLE_FILTERS).map(([key, f]) => `
            <button data-cfilter="${key}" class="${state.cycleFilter === key ? 'on' : ''}">
              ${f.label} <span class="c">${all.filter(f.test).length}</span></button>`).join('')}
        </div>
        <div class="gap"></div>
        <span class="meta">แสดง ${filtered.length} จาก ${all.length} รอบ</span>
      </div>
      <div class="tw"><table style="min-width:940px">
        <thead><tr>
          <th>รอบบิล</th><th style="width:200px">Timesheet</th>
          <th style="width:180px">สถานะ</th><th style="width:230px">กำหนดเวลา</th>
          <th class="r" style="width:140px">มูลค่า</th>
        </tr></thead>
        <tbody>${filtered.map((c) => cycleRow(c, { showCustomer: data.contracts.length > 1 })).join('')
          || '<tr><td colspan="5" class="empty">ไม่มีรอบบิลในหมวดนี้</td></tr>'}</tbody>
      </table></div>
    </div>
  </div>`;

  main.querySelectorAll('[data-cfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cycleFilter = btn.dataset.cfilter;
      renderCycles();
    });
  });
  main.querySelectorAll('[data-cycle]').forEach((row) => {
    row.addEventListener('click', () => {
      const [contractId, period] = row.dataset.cycle.split('|');
      openCycle(contractId, period);
      syncBadges();
    });
  });
}

async function openCycle(contractId, period) {
  state.view = 'cycle';
  markTab('cycle');

  main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  const data = await api(`/cycles/${encodeURIComponent(contractId)}/${period}`);

  if (!data.invoice) {
    main.innerHTML = `<div class="page">
      <button class="back" id="backBtn">${icon('cl')} กลับ</button>
      <div class="card"><div class="empty">${icon('cal', 'i')}
        <div>${esc(data.blockers.join(' · '))}</div></div></div></div>`;
    el('backBtn').addEventListener('click', () => setNav('cycles'));
    return;
  }

  const inv = data.invoice;
  const t = inv.totals;
  const billed = data.existing?.status === 'sent_to_flowaccount';

  const entryCard = (entry) => {
    const m = entry.manday;
    return `
    <div class="rec">
      <div class="rec-hd">
        <span class="ava">${esc(initials(entry.employee.nameTh))}</span>
        <span>
          <span class="nm2">${esc(entry.employee.invoicePosition)}</span>
          <span class="mt2">${esc(entry.employee.nameTh)} · ${esc(entry.employee.quotationNo ?? '')}</span>
        </span>
        <span class="rt2"><span class="st ${m.discount ? 'wn' : 'ok'}">
          ${m.payableDays} / ${m.standardWorkingDays} วัน</span></span>
      </div>
      <div class="minitab">
        <div class="mh2"><span>รายการคำนวณ</span><span class="q">จำนวน</span><span class="p">บาท</span></div>
        <div class="mr">
          <span class="lb2">เรทค่าบริการต่อเดือน</span>
          <span class="q">1 เดือน</span><span class="p">${money(m.monthlyRate)}</span>
        </div>
        ${m.leaveCount ? `<div class="mr neg">
          <span class="lb2">ส่วนลดวันลา<small>${money(m.dailyRate)} × ${m.leaveCount} วัน</small></span>
          <span class="q">${m.leaveCount} วัน</span><span class="p">−${money(m.discount)}</span>
        </div>` : `<div class="mr">
          <span class="lb2">ส่วนลดวันลา<small>ไม่มีวันลา</small></span>
          <span class="q">0 วัน</span><span class="p">—</span>
        </div>`}
      </div>
      <div class="rec-total">
        <span class="tl">ยอดของรายการนี้</span>
        <span class="tv">${money(m.lineAmount)}</span>
      </div>
      <div class="rec-acts one">
        <button class="btn" data-open="${esc(entry.timesheetId)}">${icon('file')} ดู Timesheet</button>
      </div>
    </div>`;
  };

  main.innerHTML = `
  <div class="page">
    <button class="back" id="backBtn">${icon('cl')} กลับหน้ารอบบิล</button>

    <div class="greet">
      <div>
        <span class="hi">รอบบิล ${esc(data.periodLabel)}</span>
        <h1>${esc(data.contract.customer_name)}</h1>
        <p class="sub2">โครงการ ${esc(data.contract.project_name)} · Timesheet ${data.cycle.received}/${data.cycle.expected} คน</p>
      </div>
      <div class="tools">
        <span class="datechip">${icon('cal')} วางบิล ${dateOnly(inv.documentDate)}</span>
        <span class="datechip">${icon('clock')} ครบกำหนด ${dateOnly(inv.dueDate)}</span>
      </div>
    </div>

    ${data.blockers.length ? `<div class="note cr">${icon('alt')}<span>
      <strong>ยังวางบิลไม่ได้</strong><br>${data.blockers.map(esc).join('<br>')}</span></div>` : ''}
    ${data.warnings.length ? `<div class="note wn">${icon('alt')}<span>
      <strong>ข้อควรทราบ ${data.warnings.length} ข้อ</strong><br>
      ${data.warnings.map((w) => `${esc(w.employee)}: ${esc(w.detail)}`).join('<br>')}</span></div>` : ''}

    <div class="split2">
      <!-- ซ้าย: รายการในรอบบิล -->
      <div>
        <div class="card">
          <div class="hd"><h3>รายการในรอบบิล</h3>
            <span class="rt">${data.entries.length} คน · ประกอบเป็นใบแจ้งหนี้ใบเดียว</span></div>
          <div class="cardgrid" style="grid-template-columns:1fr">
            ${data.entries.map(entryCard).join('')}
          </div>
        </div>

        <div class="tabs" role="tablist">
          ${['ข้อมูลที่ส่งเข้า FlowAccount', 'ร่างอีเมล'].map((label, i) =>
            `<button class="tab ${i === 0 ? 'on' : ''}" data-ctab="${i + 1}">${label}</button>`).join('')}
        </div>

        <div class="tp on" data-cpane="1">
          <div class="card">
            <div class="hd"><h3>Payload ที่จะยิงเข้า API</h3>
              <span class="rt">ต้องเทียบชื่อฟิลด์กับ API docs ก่อนใช้จริง</span></div>
            <div class="bd"><pre class="code">${esc(JSON.stringify(data.payload, null, 2))}</pre></div>
          </div>
        </div>

        <div class="tp" data-cpane="2">
          <div class="card">
            <div class="hd"><h3>ร่างอีเมลวางบิล</h3>
              <span class="rt">${data.emailDraft.source === 'llm' ? 'AI เรียบเรียง' : 'ร่างจาก template'}</span></div>
            <div class="bd">
              <div class="mailacts">
                <button class="btn sm" id="aiDraftBtn">${icon('rf')} ให้ AI เรียบเรียงใหม่</button>
                <button class="btn sm" id="copyMailBtn">${icon('doc')} คัดลอกร่าง</button>
                <button class="btn sm" id="openMailBtn">${icon('mail')} เปิดในโปรแกรมอีเมล</button>
              </div>
              ${data.emailDraft.highlights?.length ? `<div class="note info">${icon('info')}<span>
                <strong>ข้อสังเกตจาก AI</strong><br>${data.emailDraft.highlights.map(esc).join('<br>')}
              </span></div>` : ''}
              <div class="cmp">
                <div class="f"><span class="l">ถึง</span><span id="mailTo">${esc(data.emailDraft.to)}</span></div>
                <div class="f"><span class="l">สำเนา</span><span>${esc(data.emailDraft.cc)}</span></div>
                <div class="f sj"><span class="l">เรื่อง</span><span id="mailSubject">${esc(data.emailDraft.subject)}</span></div>
                <div class="lt" id="mailBody">${esc(data.emailDraft.body)}</div>
                <div class="en">
                  <span class="ey" style="margin-bottom:8px">เอกสารแนบ (ต้องแนบเองตอนส่ง)</span>
                  <div class="files">${data.emailDraft.attachments.map((a) =>
                    `<span class="file"><span class="pd">PDF</span> ${esc(a)}</span>`).join('')}</div>
                </div>
              </div>
              <div class="note">${icon('info')}<span>${esc(data.emailDraft.note)}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ขวา: ใบแจ้งหนี้ค้างไว้ตลอด -->
      <div class="sticky">
        <div class="card">
          <div class="hd"><h3>ใบแจ้งหนี้ที่จะสร้าง</h3>
            <span class="rt">${billed
              ? `สร้างแล้ว — ${esc(data.existing.document_no)}`
              : 'เลขเอกสารจะได้จาก FlowAccount'}</span></div>
          ${billed ? `<div class="bd sendbar">${data.existing.email_sent_at
            ? `<span class="tg ok">${icon('chk')} ส่งเมลแล้ว</span>
               <span class="sub" style="margin:0">${esc(data.existing.email_sent_by ?? '')}
                 · ${dt(data.existing.email_sent_at)}</span>`
            : `<span class="sub" style="margin:0">ระบบไม่ส่งเมลเอง — ก๊อปร่างด้านซ้ายไปส่งจาก Gmail
                 ของคุณ แล้วกดปิดงานที่นี่</span>
               <button class="btn pri sm" id="sentBtn" data-inv="${esc(data.existing.id)}">
                 ${icon('send')} บันทึกว่าส่งเมลแล้ว</button>`}</div>` : ''}
        <div class="bd">
          <div class="doc">
            <div class="dh">
              <div>
                <span class="tg ${billed ? 'ok' : 'wn'}" style="margin-bottom:6px">${billed ? 'สร้างร่างแล้ว' : 'ร่าง · Draft'}</span>
                <div class="cs">${esc(inv.customer.name)}</div>
                <div class="ti">เลขประจำตัวผู้เสียภาษี ${esc(inv.customer.taxId)} · ${esc(inv.customer.branch ?? '')}</div>
              </div>
              <dl class="kv">
                <dt>วันที่เอกสาร</dt><dd>${dateOnly(inv.documentDate)}</dd>
                <dt>เครดิต</dt><dd>${int(inv.creditDays)} วัน · ครบ ${dateOnly(inv.dueDate)}</dd>
                <dt>Reference</dt><dd><span class="tg mu">เว้นว่างตามใบจริง</span></dd>
              </dl>
            </div>
            <div class="tw"><table style="min-width:0">
              <thead><tr><th style="width:34px">#</th><th>รายการ</th>
                <th class="r" style="width:96px">ส่วนลด</th><th class="r" style="width:112px">จำนวนเงิน</th></tr></thead>
              <tbody>${inv.items.map((i) => `
                <tr><td class="n">${i.seq}</td>
                  <td><span class="nm">${esc(i.name)}</span>
                    <span class="sub">${esc(i.employeeName)} · ${esc(compactPeriod(inv.period))}</span>
                    <span class="sub">${i.quantity} ${esc(i.unitName)} × ${money(i.pricePerUnit)}</span></td>
                  <td class="r n" style="${i.discount ? 'color:var(--cr)' : 'color:var(--fnt)'}">${i.discount ? '−' + money(i.discount) : '—'}</td>
                  <td class="r n">${money(i.amount)}</td></tr>`).join('')}</tbody>
            </table></div>
            <div class="dfoot">
              <div class="tot">
                <div class="t"><span>รวมเป็นเงิน</span><span class="v">${money(t.total)}</span></div>
                <div class="t mi"><span>ส่วนลด</span><span class="v">−${money(t.discountTotal)}</span></div>
                <div class="t rl"><span>รวมหลังหักส่วนลด</span><span class="v">${money(t.totalAfterDiscount)}</span></div>
                <div class="t"><span>ภาษีมูลค่าเพิ่ม ${Math.round(t.vatRate * 100)}%</span><span class="v">${money(t.vat)}</span></div>
                <div class="t gr"><span>รวมทั้งสิ้น</span><span class="v">${money(t.grandTotal)}</span></div>
                <div class="t mi"><span>หักภาษี ณ ที่จ่าย ${Math.round(t.whtRate * 100)}%</span><span class="v">−${money(t.withholdingTax)}</span></div>
                <div class="t py"><span>ยอดรับชำระ</span><span class="v">${money(t.paymentAmount)}</span></div>
              </div>
              ${inv.remark ? `<div class="rmk"><span class="ey">หมายเหตุ</span>${esc(inv.remark)}</div>` : ''}
              <div class="note">${icon('info')}<span>
                ภาษีหัก ณ ที่จ่ายคิดจากยอดหลังหักส่วนลดก่อน VAT
                (${money(t.totalAfterDiscount)} × ${Math.round(t.whtRate * 100)}% = ${money(t.withholdingTax)})
                ตามที่ใบแจ้งหนี้ตัวอย่างทำ ไม่ใช่คิดจากยอดรวมทั้งสิ้น
              </span></div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <div class="fbar">
      <span class="sx" id="cycleStatus">${billed
        ? `<b>สร้างร่างใน FlowAccount แล้ว</b> — ${esc(data.existing.document_no)}`
        : data.blockers.length
          ? `<b>ยังอนุมัติไม่ได้</b> — ${data.blockers.length} ข้อ`
          : `<b>พร้อมอนุมัติ</b> — ทักไว้ ${data.warnings.length} ข้อ`}</span>
      <div class="gap"></div>
      <button class="btn pri" id="approveBtn" ${billed || data.blockers.length ? 'disabled' : ''}>
        ${icon('send')} อนุมัติและสร้างร่างใน FlowAccount</button>
    </div>
  </div>`;

  el('backBtn').addEventListener('click', () => setNav('cycles'));
  main.querySelectorAll('[data-ctab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.ctab);
      main.querySelectorAll('[data-ctab]').forEach((b) => b.classList.toggle('on', b === btn));
      main.querySelectorAll('[data-cpane]').forEach((p) =>
        p.classList.toggle('on', Number(p.dataset.cpane) === n));
    });
  });
  main.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openSheet(btn.dataset.open));
  });

  const approveBtn = el('approveBtn');
  approveBtn?.addEventListener('click', async () => {
    approveBtn.disabled = true;
    approveBtn.textContent = 'กำลังส่งเข้า FlowAccount…';
    try {
      const result = await api(`/cycles/${encodeURIComponent(contractId)}/${period}/approve`, {
        method: 'POST',
      });
      toast(
        `สร้างร่างใบแจ้งหนี้ ${result.documentNo} ใน FlowAccount แล้ว` +
        (result.mode === 'dry-run' ? ' (โหมด dry-run — ยังไม่เรียก API จริง)' : '') +
        ' · ร่างอีเมลรออยู่ในระบบ ยังไม่ส่งออก',
      );
      openCycle(contractId, period);
      syncBadges();
    } catch (error) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = `${icon('send')} อนุมัติและสร้างร่างใน FlowAccount`;
      toast(error.message, true);
    }
  });

  /* ขั้นที่ 4 — ระบบไม่ต่อกล่องเมลใคร คนคัดลอกร่างไปส่งจาก Gmail ของตัวเอง
     สามปุ่มนี้คือทั้งหมดที่ระบบช่วยได้โดยไม่แตะสิทธิ์ส่งอีเมลแทนคน */
  el('aiDraftBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'AI กำลังเรียบเรียง…';
    try {
      await api(`/cycles/${encodeURIComponent(contractId)}/${period}/email-draft`, { method: 'POST' });
      toast('AI ร่างอีเมลใหม่แล้ว — อ่านทวนก่อนคัดลอกไปส่ง');
      openCycle(contractId, period);
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = `${icon('rf')} ให้ AI เรียบเรียงใหม่`;
      toast(error.message, true);
    }
  });

  el('copyMailBtn')?.addEventListener('click', async () => {
    const text = `เรื่อง: ${data.emailDraft.subject}\n\n${data.emailDraft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('คัดลอกร่างอีเมลแล้ว — วางในกล่องเมลได้เลย');
    } catch {
      toast('คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องร่างแล้วคัดลอกเอง', true);
    }
  });

  el('openMailBtn')?.addEventListener('click', () => {
    const to = data.contract.contact_email ?? '';
    const url = `mailto:${encodeURIComponent(to)}`
      + `?subject=${encodeURIComponent(data.emailDraft.subject)}`
      + `&body=${encodeURIComponent(data.emailDraft.body)}`;
    window.open(url, '_blank');
    if (!to) toast('ยังไม่มีอีเมลผู้ประสานงานในระบบ — ใส่ผู้รับเองในโปรแกรมเมล');
  });

  /* ปิดงาน — ขั้นสุดท้ายของรอบบิล ระบบไม่ส่งเมลเอง คนส่งแล้วมายืนยันที่นี่
     ถ้าไม่มีขั้นนี้ รอบบิลจะค้างที่ "สร้างร่างแล้ว" ตลอดไป ไม่รู้ว่าอันไหนจบ */
  el('sentBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api(`/invoices/${encodeURIComponent(btn.dataset.inv)}/sent`, { method: 'POST' });
      toast(`ปิดงานแล้ว — บันทึกว่า ${r.sentBy} ส่งเมล ${r.documentNo ?? ''} เรียบร้อย`);
      openCycle(contractId, period);
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}


/* ══ ขั้นที่ 1 — อัปโหลด Timesheet ══════════════════════════
   โหมด auto: อีเมลเข้า → n8n ดึงไฟล์ → ยิง /ingest → บันทึกทันที
   โหมด manual (หน้านี้): คนโหลดไฟล์จากเมลเอง → อัปโหลด → AI อ่านให้ดู →
   คนตรวจ/แก้สิ่งที่อ่านได้ → กดยืนยัน จึงบันทึก

   จุดต่างที่สำคัญคือ "ยังไม่บันทึกจนกว่าคนจะเห็น" — อีกสามขั้นที่เหลือเหมือนกันทุกอย่าง */

const LEAVE_OPTIONS = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'อื่นๆ' };

/** อ่านไฟล์เป็น base64 โดยไม่มีส่วนหัว data: */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

async function renderUpload() {
  const [contracts, sheets, settings] = await Promise.all([
    api('/contracts'), api('/timesheets'), api('/settings'),
  ]);
  const ct = contracts[0];
  const used = sheets.map((s) => s.id);
  const hasKey = settings.env.hasAnthropicKey;
  const read = state.read;

  main.innerHTML = `
  <div class="page">
    <div class="phd">
      <div><span class="ey">ขั้นที่ 1 จาก 4</span><h1>อัปโหลด Timesheet</h1>
        <p>โหลดไฟล์จากอีเมลแจ้งอนุมัติของลูกค้ามาไว้ในเครื่อง แล้วอัปโหลดที่นี่ —
           AI จะอ่านให้ดูก่อน ยังไม่บันทึกจนกว่าคุณจะกดยืนยัน</p></div>
    </div>

    ${hasKey ? '' : `<div class="note wn">${icon('alt')}<span>
      <strong>ยังไม่ได้ตั้ง ANTHROPIC_API_KEY</strong> — อัปโหลดไฟล์แล้ว AI จะอ่านไม่ได้
      ใส่ค่าในไฟล์ <code>.env</code> แล้วรันเซิร์ฟเวอร์ใหม่ · ระหว่างนี้ใช้แท็บ "กรอกเอง" แทนได้
    </span></div>`}

    <div class="tabs" role="tablist">
      <button class="tab ${state.uploadTab === 1 ? 'on' : ''}" data-utab="1">อัปโหลดไฟล์ (AI อ่าน)</button>
      <button class="tab ${state.uploadTab === 3 ? 'on' : ''}" data-utab="3">ดึงจาก Gmail
        ${settings.env.hasGmail ? '' : '<span class="tg mu">ยังไม่ต่อ</span>'}</button>
      <button class="tab ${state.uploadTab === 2 ? 'on' : ''}" data-utab="2">กรอกเอง (ไม่ใช้ AI)</button>
    </div>

    <!-- ── ดึงจาก Gmail ── -->
    <div class="tp ${state.uploadTab === 3 ? 'on' : ''}" data-upane="3">
      ${settings.env.hasGmail ? `
        <div class="card">
          <div class="hd"><h3>อีเมลแจ้งอนุมัติ Timesheet</h3>
            <span class="rt" id="gmailAcct">กำลังเชื่อมต่อ…</span></div>
          <div class="bd">
            <div class="mailacts">
              <button class="btn sm" id="gmailRefresh">${icon('rf')} ดึงรายการเมล</button>
              <span class="sub" style="margin:0">ค้นด้วย: <code>${esc(settings.env.gmailQuery)}</code></span>
            </div>
            <div id="gmailList"><div class="empty">กด "ดึงรายการเมล" เพื่อดูอีเมลในกล่อง</div></div>
          </div>
        </div>` : `
        <div class="card"><div class="bd">
          <div class="note wn">${icon('alt')}<span>
            <strong>ยังไม่ได้เชื่อมต่อ Gmail</strong> — ทำครั้งเดียวจบ ใช้บัญชี Google ของคุณเองได้
          </span></div>
          <ol class="steps">
            <li>เปิด <b>console.cloud.google.com</b> → สร้างโปรเจกต์ใหม่</li>
            <li><b>APIs &amp; Services → Library</b> → ค้น "Gmail API" → กด <b>Enable</b></li>
            <li><b>OAuth consent screen</b> → External → ใส่ชื่อแอปกับอีเมล →
                <b>Test users</b> เพิ่มอีเมลตัวเองเข้าไปด้วย</li>
            <li><b>Credentials → Create credentials → OAuth client ID</b> → Web application<br>
                Authorized redirect URI: <code>http://localhost:4399/oauth/callback</code></li>
            <li>ก๊อป Client ID/Secret ใส่ไฟล์ <code>.env</code> แล้วรัน <code>npm run gmail:auth</code></li>
            <li>เอา <code>GMAIL_REFRESH_TOKEN</code> ที่ได้ใส่ <code>.env</code> → รันเซิร์ฟเวอร์ใหม่</li>
          </ol>
          <div class="note info">${icon('info')}<span>
            สิทธิ์ที่ขอคือ <b>อ่านเมล</b> กับ <b>สร้างร่าง</b> — ในโค้ดไม่มีคำสั่งส่งอีเมลอยู่เลย
            ร่างที่สร้างจะไปอยู่ในกล่อง Drafts ให้คุณกดส่งเอง
          </span></div>
        </div></div>`}
    </div>

    <!-- ── อัปโหลดไฟล์ ── -->
    <div class="tp ${state.uploadTab === 1 ? 'on' : ''}" data-upane="1">
      <div class="split2">
        <div>
          <div class="card">
            <div class="hd"><h3>เลือกไฟล์ Timesheet</h3><span class="rt">PDF ที่ลูกค้าอนุมัติแล้ว</span></div>
            <div class="bd">
              <label class="drop" id="dropZone">
                <input type="file" id="fileInput" accept="application/pdf" hidden>
                ${icon('file', 'i')}
                <b id="dropName">ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์</b>
                <span>รับเฉพาะ PDF · ไม่เกิน 8 MB</span>
              </label>
              <div class="frm two" style="margin-top:16px">
                <label>เลขที่เอกสาร
                  <input id="uDoc" type="text" placeholder="เช่น 2026020101" autocomplete="off"
                         value="${esc(read?.documentNo ?? '')}">
                  <small>เลขบนใบ Timesheet หรือในอีเมลแจ้งอนุมัติ</small>
                </label>
                <label>รอบเดือนที่คาดไว้ (ถ้ารู้)
                  <input id="uPeriod" type="month">
                  <small>ใส่ไว้เพื่อให้ระบบทักถ้าไฟล์เป็นคนละเดือน</small>
                </label>
              </div>
            </div>
            <div class="ft">
              <button class="btn pri" id="readBtn" disabled>${icon('srch')} ให้ AI อ่านไฟล์นี้</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="hd"><h3>สัญญาที่จะใช้อ้างอิง</h3></div>
          <div class="bd">
            ${ct ? `<dl class="kv">
              <dt>ลูกค้า</dt><dd>${esc(ct.customer_name)}</dd>
              <dt>ใบว่าจ้าง</dt><dd class="n">${esc(ct.po_no)}</dd>
              <dt>ช่วงสัญญา</dt><dd>${dateOnly(ct.start_date)} – ${dateOnly(ct.end_date)}</dd>
              <dt>พนักงานในสัญญา</dt><dd>${int(ct.headcount)} คน</dd>
            </dl>` : '<div class="empty">ยังไม่มีสัญญาในระบบ</div>'}
            <div class="note info">${icon('info')}<span>
              เรทค่าบริการและตำแหน่งที่ขึ้นบนใบแจ้งหนี้มาจากฐานข้อมูลเสมอ
              ไม่ได้มาจากสิ่งที่เขียนในไฟล์ Timesheet
            </span></div>
            ${used.length ? `<div class="note wn">${icon('alt')}<span>
              เลขเอกสารที่มีในระบบแล้ว: ${used.map(esc).join(' · ')}
              — ใช้เลขเดิมคือเขียนทับใบนั้นและคำนวณใหม่
            </span></div>` : ''}
          </div>
        </div>
      </div>

    </div>

    <!-- ── กรอกเอง ── -->
    <div class="tp ${state.uploadTab === 2 ? 'on' : ''}" data-upane="2">
      <div class="split2">
        <div class="card">
          <div class="hd"><h3>ข้อมูลจากใบ Timesheet</h3>
            <span class="rt">ตารางรายวันระบบสร้างจากปฏิทินให้เอง</span></div>
          <div class="bd">
            <div class="frm">
              <label>เลขที่เอกสาร
                <input id="eDoc" type="text" placeholder="เช่น 2026020101" autocomplete="off">
              </label>
              <label>รอบเดือน<input id="ePeriod" type="month"></label>
              <label>ชื่อพนักงาน <b>ตามที่เขียนในใบ</b>
                <input id="eName" type="text" placeholder="เช่น Pongpun Mamak" autocomplete="off">
              </label>
              <label>ตำแหน่ง <b>ตามที่เขียนในใบ</b>
                <input id="ePos" type="text" placeholder="เช่น Java Programmer" autocomplete="off">
              </label>
              <label>ผู้อนุมัติฝั่งลูกค้า
                <input id="eBy" type="text" value="Project Manager (TLI)" autocomplete="off">
              </label>
              <label>วันที่ลูกค้าอนุมัติ<input id="eAt" type="date"></label>
            </div>
            <div class="fsec">
              <div class="fsec-h"><b>วันลา</b><button class="btn sm" id="eAddLeave">+ เพิ่มวันลา</button></div>
              <div id="eLeaves"></div>
              <small class="fhint">ไม่มีวันลาก็เว้นว่างไว้</small>
            </div>
          </div>
          <div class="ft"><button class="btn pri" id="eSave">${icon('chk')} บันทึกเข้าระบบ</button></div>
        </div>
        <div class="card">
          <div class="hd"><h3>ใช้เมื่อไหร่</h3></div>
          <div class="bd"><div class="note info">${icon('info')}<span>
            ทางนี้ไว้ใช้ตอนไม่มี API key หรือไฟล์อ่านไม่ออก (สแกนเอียง ลายเซ็นทับตาราง)
            ผลลัพธ์ที่ได้ผ่านการตรวจ Manday ชุดเดียวกับทางที่ AI อ่าน ต่างกันแค่ที่มาของข้อมูล
          </span></div></div>
        </div>
      </div>
    </div>

    <!-- ผลที่ AI อ่านได้ — อยู่นอกแท็บ เพราะมาได้จากทั้งอัปโหลดไฟล์และดึงจาก Gmail -->
    ${read ? readResultHtml(read) : ''}
  </div>`;

  main.querySelectorAll('[data-utab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.uploadTab = Number(btn.dataset.utab);
      renderUpload();
    });
  });

  bindUploadTab();
  bindGmailTab();
  bindManualTab(contracts);
}

/* ── ขั้นที่ 1 ทางที่สอง: เลือกอีเมลจากกล่องแล้วให้ AI อ่านทั้งฉบับ ──
   ต่างจากอัปโหลดไฟล์ตรงที่ได้เนื้ออีเมลมาด้วย → เลขที่เอกสารกับสถานะ "อนุมัติ"
   ระบบอ่านเองได้ ไม่ต้องให้คนพิมพ์ และคนยังเป็นคนกดเลือกว่าจะเอาฉบับไหนเข้าระบบ */
function bindGmailTab() {
  const refresh = el('gmailRefresh');
  if (!refresh) return;

  const load = async () => {
    refresh.disabled = true;
    el('gmailList').innerHTML = '<div class="loading">กำลังดึงรายการเมล…</div>';
    try {
      const inbox = await api('/gmail/inbox');
      el('gmailAcct').textContent = `กล่องของ ${inbox.account}`;
      el('gmailList').innerHTML = inbox.messages.length
        ? `<ul class="maillist">${inbox.messages.map((m) => `
            <li class="${m.alreadyIngested ? 'done' : ''}">
              <span class="mi">
                <span class="ms">${esc(m.subject)}</span>
                <span class="mf">${esc(m.from)} · ${dt(m.receivedAt)}</span>
                <span class="mq">${esc(m.snippet.slice(0, 110))}</span>
                <span class="files">${m.attachments.map((a) =>
                  `<span class="file"><span class="pd">PDF</span> ${esc(a.filename)}</span>`).join('')}</span>
              </span>
              ${m.alreadyIngested
                ? '<span class="tg ok">เอาเข้าระบบแล้ว</span>'
                : `<button class="btn sm pri" data-mail="${esc(m.id)}"
                     data-att="${esc(m.attachments[0]?.attachmentId ?? '')}">
                     ${icon('srch')} ให้ AI อ่าน</button>`}
            </li>`).join('')}</ul>`
        : `<div class="empty">${icon('mail', 'i')}<div>ไม่พบอีเมลที่ตรงกับคำค้น —
            แก้คำค้นได้ที่ <code>GMAIL_QUERY</code> ในไฟล์ .env</div></div>`;

      el('gmailList').querySelectorAll('[data-mail]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'AI กำลังอ่านเมลและไฟล์แนบ…';
          try {
            const result = await api('/gmail/read', {
              method: 'POST',
              body: JSON.stringify({
                messageId: btn.dataset.mail,
                attachmentId: btn.dataset.att || null,
              }),
            });
            state.read = result;
            toast(`อ่านเสร็จ — ${result.data.employeeName ?? ''} รอบ ${result.data.period ?? ''}`);
            renderUpload();
          } catch (error) {
            btn.disabled = false;
            btn.innerHTML = `${icon('srch')} ให้ AI อ่าน`;
            toast(error.message, true);
          }
        });
      });
    } catch (error) {
      el('gmailList').innerHTML = `<div class="note cr">${icon('alt')}<span>${esc(error.message)}</span></div>`;
    } finally {
      refresh.disabled = false;
    }
  };

  refresh.addEventListener('click', load);
}

/** ผลที่ AI อ่านได้ — แก้ได้ทุกช่องก่อนกดยืนยัน */
function readResultHtml(read) {
  const d = read.data;
  const blocked = read.blockers.length > 0;

  return `
  <div class="card">
    <div class="hd"><h3>สิ่งที่ AI อ่านได้${read.email ? 'จากอีเมลและไฟล์แนบ' : 'จากไฟล์'}</h3>
      <span class="rt">${esc(read.model)} · ยังไม่บันทึก แก้ได้ก่อนกดยืนยัน</span></div>
    <div class="bd">
      ${read.email ? `<div class="cmp" style="margin-bottom:16px">
        <div class="f"><span class="l">จาก</span><span>${esc(read.email.from)}</span></div>
        <div class="f sj"><span class="l">เรื่อง</span><span>${esc(read.email.subject)}</span></div>
        <div class="f"><span class="l">สถานะในเมล</span>
          <span><span class="tg ${read.email.meta.approvalStatus?.includes('ไม่อนุมัติ') ? 'cr'
            : read.email.meta.approvalStatus?.includes('อนุมัติ') ? 'ok' : 'wn'}">
            ${esc(read.email.meta.approvalStatus ?? 'ไม่พบสถานะในเมล')}</span></span></div>
        <div class="f"><span class="l">เลขที่เอกสารในเมล</span>
          <span class="n">${esc(read.email.meta.documentNo ?? '— ไม่พบ ต้องกรอกเอง')}</span></div>
      </div>` : ''}
      ${blocked ? `<div class="note cr">${icon('alt')}<span>
        <strong>ยังบันทึกไม่ได้ ${read.blockers.length} ข้อ</strong><br>
        ${read.blockers.map(esc).join('<br>')}</span></div>` : ''}
      ${read.verification.issues.filter((i) => i.severity === 'warn').length
        ? `<div class="note wn">${icon('alt')}<span><strong>ทักไว้</strong><br>
            ${read.verification.issues.filter((i) => i.severity === 'warn')
              .map((i) => esc(i.message)).join('<br>')}</span></div>` : ''}

      <div class="g2">
        <div class="frm">
          <label>ชื่อพนักงานตามที่เขียนในไฟล์
            <input id="rName" type="text" value="${esc(d.employeeName ?? '')}">
            <small>${read.matching.employee
              ? `จับคู่ได้กับ ${esc(read.matching.employee.nameTh)} (${esc(read.matching.kind)})`
              : 'จับคู่กับพนักงานในระบบไม่ได้'}</small>
          </label>
          <label>ตำแหน่งตามที่เขียนในไฟล์
            <input id="rPos" type="text" value="${esc(d.position ?? '')}">
            <small>${read.matching.employee
              ? `ตำแหน่งที่จะขึ้นบิลคือ ${esc(read.matching.employee.invoicePosition)} (จากฐานข้อมูล)`
              : '—'}</small>
          </label>
          <label>รอบเดือน<input id="rPeriod" type="month" value="${esc(d.period ?? '')}"></label>
        </div>
        <div class="frm">
          <label>วันทำงานที่ระบุท้ายตาราง
            <input id="rWork" type="number" min="0" max="31" value="${int(d.totalWorkDays)}">
          </label>
          <label>วันลาที่ระบุท้ายตาราง
            <input id="rLeave" type="number" min="0" max="31" value="${int(d.totalLeaveDays)}">
          </label>
          <label>ผู้อนุมัติฝั่งลูกค้า
            <input id="rBy" type="text" value="${esc(read.approvedBy ?? 'Project Manager (TLI)')}">
            ${read.approvedAt ? `<small>อีเมลระบุวันที่อนุมัติ ${dateOnly(read.approvedAt)}</small>` : ''}
          </label>
        </div>
      </div>

      <div class="fsec">
        <div class="fsec-h"><b>วันลาที่อ่านได้</b>
          <span class="rt">${(d.leaveDays ?? []).length} รายการ — ตัวเลขนี้คือตัวที่ใช้หักส่วนลด</span></div>
        ${(d.leaveDays ?? []).length
          ? `<div class="tw"><table style="min-width:420px">
              <thead><tr><th>วันที่</th><th>ประเภท</th><th>ป้ายในไฟล์</th></tr></thead>
              <tbody>${d.leaveDays.map((l) => `<tr>
                <td class="n">${esc(l.date)}</td>
                <td>${esc(LEAVE_OPTIONS[l.type] ?? l.type)}</td>
                <td>${esc(l.rawLabel ?? '—')}</td></tr>`).join('')}</tbody>
            </table></div>`
          : '<div class="empty">ไม่พบวันลาในไฟล์นี้</div>'}
      </div>

      <div class="fsec">
        <div class="fsec-h"><b>ลายเซ็น</b></div>
        <ul class="cks">
          <li><span class="l">พนักงานเซ็น</span>
            <span class="tg ${d.signedByEmployee ? 'ok' : 'wn'}">${d.signedByEmployee ? 'พบ' : 'ไม่พบ'}</span></li>
          <li><span class="l">ผู้อนุมัติฝั่งลูกค้าเซ็น<small>ไม่พบ = ยังวางบิลไม่ได้</small></span>
            <span class="tg ${d.signedByProjectManager ? 'ok' : 'cr'}">${d.signedByProjectManager ? 'พบ' : 'ไม่พบ'}</span></li>
        </ul>
      </div>

      <details class="raw"><summary>ดู JSON ดิบที่ AI อ่านออกมา</summary>
        <pre class="code">${esc(JSON.stringify(d, null, 2))}</pre></details>
    </div>
    <div class="ft">
      <span class="sub" style="margin:0">กดยืนยันแล้วระบบจะจับคู่พนักงาน คำนวณ Manday
        และส่งใบนี้เข้าขั้นที่ 2</span>
      <div class="gap"></div>
      <button class="btn" id="discardBtn">ทิ้งผลนี้</button>
      <button class="btn pri" id="confirmBtn" ${blocked ? 'disabled' : ''}>
        ${icon('chk')} ยืนยันและบันทึกเข้าระบบ</button>
    </div>
  </div>`;
}

function bindUploadTab() {
  const input = el('fileInput');
  const zone = el('dropZone');
  if (!input) return;

  let picked = null;

  const take = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('รับเฉพาะไฟล์ PDF', true); return; }
    if (file.size > 8_000_000) { toast('ไฟล์ใหญ่เกิน 8 MB', true); return; }
    picked = file;
    el('dropName').textContent = file.name;
    zone.classList.add('has');
    el('readBtn').disabled = false;
  };

  input.addEventListener('change', () => take(input.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    take(e.dataTransfer.files[0]);
  });

  el('readBtn').addEventListener('click', async () => {
    if (!picked) return;
    const btn = el('readBtn');
    btn.disabled = true;
    btn.textContent = 'AI กำลังอ่านไฟล์… (ราว 20–40 วินาที)';
    try {
      const result = await api('/timesheets/read', {
        method: 'POST',
        body: JSON.stringify({
          fileBase64: await fileToBase64(picked),
          fileName: picked.name,
          expectedPeriod: el('uPeriod').value || null,
        }),
      });
      state.read = { ...result, documentNo: el('uDoc').value.trim() };
      toast(`อ่านไฟล์เสร็จ — ${result.data.employeeName ?? ''} รอบ ${result.data.period ?? ''}`);
      renderUpload();
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = `${icon('srch')} ให้ AI อ่านไฟล์นี้`;
      toast(error.message, true);
    }
  });

  el('discardBtn')?.addEventListener('click', () => {
    state.read = null;
    renderUpload();
  });

  el('confirmBtn')?.addEventListener('click', async () => {
    const btn = el('confirmBtn');
    const documentNo = el('uDoc').value.trim();
    if (!documentNo) { toast('ต้องกรอกเลขที่เอกสารก่อนบันทึก', true); return; }

    btn.disabled = true;
    const edited = {
      ...state.read.data,
      employeeName: el('rName').value.trim(),
      position: el('rPos').value.trim(),
      period: el('rPeriod').value,
      totalWorkDays: Number(el('rWork').value),
      totalLeaveDays: Number(el('rLeave').value),
    };

    try {
      const r = await api('/timesheets/confirm', {
        method: 'POST',
        body: JSON.stringify({
          documentNo,
          extraction: edited,
          fileName: state.read.fileName,
          readModel: state.read.model,
          approvedBy: el('rBy').value.trim() || null,
          // มาจาก Gmail ก็ผูกเลขอีเมลไว้ด้วย จะได้รู้ว่าใบนี้มาจากเมลฉบับไหน
          sourceEmailId: state.read.sourceEmailId ?? null,
          approvedAt: state.read.approvedAt ?? null,
        }),
      });
      state.read = null;
      if (r.nextAction === 'needs_match') { toast(r.reason, true); renderUpload(); return; }
      toast(`บันทึกแล้ว — ${r.status} · วางบิลได้ ${r.manday?.payableDays ?? '–'} วัน · ไปตรวจต่อได้เลย`);
      openSheet(r.timesheetId);
      syncBadges();
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}

function bindManualTab(contracts) {
  if (!el('eSave')) return;
  addLeaveRow();
  el('eAddLeave').addEventListener('click', addLeaveRow);

  el('eSave').addEventListener('click', async () => {
    const leaveDays = [...document.querySelectorAll('.lrow')]
      .map((r) => ({ date: r.querySelector('.ldate').value, type: r.querySelector('.ltype').value }))
      .filter((l) => l.date);

    const btn = el('eSave');
    btn.disabled = true;
    try {
      const r = await api('/timesheets/manual', {
        method: 'POST',
        body: JSON.stringify({
          documentNo: el('eDoc').value.trim(),
          employeeName: el('eName').value.trim(),
          position: el('ePos').value.trim(),
          period: el('ePeriod').value,
          leaveDays,
          approvedBy: el('eBy').value.trim() || null,
          approvedAt: el('eAt').value || null,
          customerId: contracts[0]?.customer_id ?? null,
        }),
      });
      // endpoint คืนคีย์ชื่อ timesheetId ไม่ใช่ id — เคยพลาดตรงนี้จนเกิด uncaught error
      toast(`บันทึกแล้ว — ${r.status} · วางบิลได้ ${r.manday?.payableDays ?? '–'} วัน`);
      openSheet(r.timesheetId);
    } catch (error) {
      btn.disabled = false;
      toast(error.message, true);
    }
  });
}

/** แถววันลา — เพิ่มได้เรื่อยๆ ลบทีละแถวได้ */
function addLeaveRow() {
  const box = el('eLeaves');
  const row = document.createElement('div');
  row.className = 'lrow';
  row.innerHTML = `
    <input type="date" class="ldate">
    <select class="ltype">
      ${Object.entries(LEAVE_OPTIONS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
    </select>
    <button class="btn sm dgr lrm">ลบ</button>`;
  row.querySelector('.lrm').addEventListener('click', () => row.remove());
  box.appendChild(row);
}

/* ══ ข้อมูลหลัก — รวมสามหน้าเดิมไว้ในหน้าเดียว ═══════════════
   ไม่ใช่ขั้นตอนการทำงาน แต่เป็นที่แก้เมื่อขั้นที่ 2 บอกว่าจับคู่ไม่ได้หรือเรทไม่ตรง
   ถ้าไม่มีหน้านี้ พนักงานคนใหม่เข้ามาทีต้องเรียกโปรแกรมเมอร์มาแก้ฐานข้อมูล */

async function renderMaster() {
  const [employees, contracts, settings] = await Promise.all([
    api('/employees'), api('/contracts'), api('/settings'),
  ]);
  const tab = state.masterTab;

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">อ้างอิง</span><h1>ข้อมูลหลัก</h1>
      <p>ฐานข้อมูลที่ทั้ง 3 ขั้นใช้ร่วมกัน — จับคู่ชื่อ · หาเรทค่าบริการ · นับวันทำงานของเดือน</p></div></div>

    <div class="tabs" role="tablist">
      ${['พนักงาน & ชื่อพ้อง', 'ลูกค้า & สัญญา', 'วันหยุด & การเชื่อมต่อ'].map((t, i) =>
        `<button class="tab ${tab === i + 1 ? 'on' : ''}" data-mtab2="${i + 1}">${t}</button>`).join('')}
    </div>

    <div class="tp ${tab === 1 ? 'on' : ''}" data-mpane="1">
      <div class="card"><div class="tw"><table>
        <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ชื่อพ้องที่ยอมรับ</th>
          <th>ตำแหน่งบนใบแจ้งหนี้</th><th class="r">เรท/เดือน</th><th>ลูกค้า</th></tr></thead>
        <tbody>${employees.map((e) => `
          <tr><td class="n">${esc(e.id)}</td>
            <td><span class="nm">${esc(e.name_th)}</span><span class="sub">${esc(e.name_en ?? '')}</span></td>
            <td>${[
                ...e.nameAliases.map((a) => ({ ...a, kind: 'name' })),
                ...e.positionAliases.map((a) => ({ ...a, kind: 'position' })),
              ].map((a) =>
                `<span class="tg mu alias" title="${esc(a.source ?? '')}">${esc(a.alias)}<button
                   class="ax" data-emp="${esc(e.id)}" data-kind="${a.kind}"
                   data-alias="${esc(a.alias)}" title="ลบชื่อพ้องนี้">×</button></span>`).join(' ') || '—'}
              <div class="arow">
                <button class="lk addal" data-emp="${esc(e.id)}" data-kind="name">+ ชื่อพ้อง</button>
                <button class="lk addal" data-emp="${esc(e.id)}" data-kind="position">+ ตำแหน่งพ้อง</button>
              </div></td>
            <td>${esc(e.invoice_position)}</td>
            <td class="r n">${money(e.monthly_rate)}
              ${e.assignment_id ? `<button class="lk edrate" data-asg="${esc(e.assignment_id)}"
                data-rate="${e.monthly_rate}" data-name="${esc(e.name_th)}">แก้เรท</button>` : ''}</td>
            <td>${esc(e.customer_name ?? '—')}<span class="sub">${esc(e.quotation_no ?? '')}</span></td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="note">${icon('info')}<span>
        <strong>ทำไมต้องมีชื่อพ้อง</strong> — เอกสารแต่ละใบเขียนชื่อคนและตำแหน่งไม่เหมือนกัน
        (ใบว่าจ้าง "Dev" · ใบเสนอราคา "Developer" · Timesheet "Java Programmer")
        ระบบเทียบผ่านตารางนี้ ไม่ใช่เทียบข้อความตรงตัว
      </span></div>
    </div>

    <div class="tp ${tab === 2 ? 'on' : ''}" data-mpane="2">
      ${contracts.map((c) => `
        <div class="card">
          <div class="hd"><h3>${esc(c.po_no)} — ${esc(c.project_name)}</h3>
            <span class="rt">${esc(c.status)}</span></div>
          <div class="bd"><div class="g2">
            <dl class="kv">
              <dt>ลูกค้า</dt><dd>${esc(c.customer_name)}</dd>
              <dt>เลขผู้เสียภาษี</dt><dd class="n">${esc(c.tax_id)}</dd>
              <dt>เลขที่สัญญา</dt><dd class="n">${esc(c.contract_no ?? '—')}</dd>
              <dt>ช่วงสัญญา</dt><dd>${dateOnly(c.start_date)} – ${dateOnly(c.end_date)}</dd>
              <dt>จำนวนคน</dt><dd class="n">${int(c.headcount)} คน</dd>
            </dl>
            <dl class="kv">
              <dt>ยอดต่อเดือน</dt><dd class="n">${money(c.monthly_total)} บาท</dd>
              <dt>ตัวหารอัตราต่อวัน</dt><dd>${c.divisor_mode === 'fixed'
                  ? `คงที่ ${int(c.divisor_value)}` : 'วันทำงานจริงของเดือน'}</dd>
              <dt>VAT</dt><dd class="n">${Math.round(c.vat_rate * 100)}%</dd>
              <dt>หัก ณ ที่จ่าย</dt><dd class="n">${Math.round(c.wht_rate * 100)}%</dd>
              <dt>เครดิต</dt><dd class="n">${int(c.credit_days)} วัน</dd>
              <dt>ผู้ประสานงาน</dt><dd>${esc(c.contact_name ?? '—')} ${esc(c.contact_phone ?? '')}</dd>
            </dl>
          </div>
          ${c.billing_place ? `<div class="note" style="margin-top:16px">${icon('info')}<span>
            <strong>สถานที่วางบิล</strong> ${esc(c.billing_place)}</span></div>` : ''}
          </div>
        </div>`).join('')}
    </div>

    <div class="tp ${tab === 3 ? 'on' : ''}" data-mpane="3">
      <div class="g2">
        <div class="card">
          <div class="hd"><h3>การเชื่อมต่อ</h3></div>
          <div class="bd"><dl class="kv">
            <dt>FlowAccount</dt><dd><span class="tg ${settings.env.flowAccountMode === 'dry-run' ? 'wn' : 'ok'}">${esc(settings.env.flowAccountMode)}</span></dd>
            <dt>Credential</dt><dd>${settings.env.hasFlowAccountCredentials
                ? '<span class="tg ok">ตั้งค่าแล้ว</span>' : '<span class="tg wn">ยังไม่ตั้ง</span>'}</dd>
            <dt>ชนิดเอกสาร</dt><dd>${esc(settings.flowaccount?.documentType ?? '—')}</dd>
            <dt>Claude API</dt><dd>${settings.env.hasAnthropicKey
                ? '<span class="tg ok">พร้อมใช้</span>' : '<span class="tg wn">ยังไม่ตั้ง ANTHROPIC_API_KEY</span>'}</dd>
            <dt>โมเดล</dt><dd class="n">${esc(settings.env.claudeModel)}</dd>
          </dl></div>
        </div>
        <div class="card">
          <div class="hd"><h3>เงื่อนไขวางบิล</h3></div>
          <div class="bd"><dl class="kv">
            <dt>วันที่ลงเอกสาร</dt><dd>วันที่ ${int(settings.billingRules?.billOnDayOfNextMonth)} ของเดือนถัดไป</dd>
            <dt>ต้องได้ครบทุกคน</dt><dd>${settings.billingRules?.requireAllTimesheets ? 'ใช่' : 'ไม่'}</dd>
            <dt>ต้องมีคนกดยืนยัน</dt><dd><span class="tg ${settings.billingRules?.requireHumanCheck === false ? 'mu' : 'ok'}">
              ${settings.billingRules?.requireHumanCheck === false ? 'ไม่ (โหมด auto)' : 'ใช่ (โหมด manual)'}</span></dd>
            <dt>ส่งอีเมลอัตโนมัติ</dt><dd><span class="tg ok">ไม่ส่ง — สร้างร่างเท่านั้น</span></dd>
          </dl>
          <div class="note info">${icon('info')}<span>
            สลับเป็นโหมด auto ได้ด้วยการตั้ง <code>billing_rules.requireHumanCheck = false</code>
            แล้วขั้นที่ 1 กับ 2 จะไหลเองจาก n8n โดยไม่มีคนคั่น
          </span></div></div>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>ปฏิทินวันหยุด</h3>
          <span class="rt">ใช้คำนวณวันทำงานมาตรฐานของแต่ละเดือน</span></div>
        <div class="bd">
          <div class="hadd">
            <input type="date" id="hDate">
            <input type="text" id="hName" placeholder="ชื่อวันหยุด" autocomplete="off">
            <button class="btn sm pri" id="hAdd">+ เพิ่มวันหยุด</button>
          </div>
          <small class="fhint">แก้ปฏิทินแล้วต้องสั่งคำนวณ Timesheet ของเดือนนั้นใหม่
            จำนวนวันทำงานจึงจะเปลี่ยนตาม (และตราที่คนเคยกดยืนยันจะหมดอายุเอง)</small>
        </div>
        <div class="bd flush"><div class="tw"><table style="min-width:520px">
          <thead><tr><th style="width:140px">วันที่</th><th>ชื่อวันหยุด</th><th>ขอบเขต</th>
            <th style="width:60px"></th></tr></thead>
          <tbody>${settings.holidays.map((h) => `
            <tr><td class="n">${dateOnly(h.date)}</td><td>${esc(h.name)}</td>
              <td>${h.customer_id ? esc(h.customer_id) : '<span class="tg mu">ทุกลูกค้า</span>'}</td>
              <td><button class="lk hrm" data-date="${esc(h.date)}"
                data-cus="${esc(h.customer_id ?? '')}">ลบ</button></td></tr>`).join('')}</tbody>
        </table></div></div>
      </div>
    </div>
  </div>`;

  main.querySelectorAll('[data-mtab2]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.masterTab = Number(btn.dataset.mtab2);
      renderMaster();
    });
  });

  /* เพิ่ม/ลบชื่อพ้องและแก้เรท — ใช้ prompt เพราะเป็นเครื่องมือหลังบ้านของคนไม่กี่คน
     ไม่คุ้มกับการทำ modal เต็มรูปแบบ และ prompt บล็อกจนกดเสร็จ ไม่มีสถานะครึ่งๆ */
  main.querySelectorAll('.addal').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind;
      const alias = prompt(`เพิ่ม${kind === 'name' ? 'ชื่อพ้องของพนักงาน' : 'ชื่อตำแหน่งพ้อง'} (ตามที่เขียนในเอกสารจริง):`);
      if (!alias?.trim()) return;
      try {
        await api(`/employees/${encodeURIComponent(btn.dataset.emp)}/aliases`, {
          method: 'POST', body: JSON.stringify({ kind, alias }),
        });
        toast(`เพิ่ม "${alias.trim()}" แล้ว`);
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('.ax').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบชื่อพ้อง "${btn.dataset.alias}" ?`)) return;
      try {
        const q = new URLSearchParams({ kind: btn.dataset.kind, alias: btn.dataset.alias });
        await api(`/employees/${encodeURIComponent(btn.dataset.emp)}/aliases?${q}`, { method: 'DELETE' });
        toast('ลบแล้ว');
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  main.querySelectorAll('.edrate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = prompt(`เรทต่อเดือนของ ${btn.dataset.name} (บาท):`, btn.dataset.rate);
      if (next === null) return;
      try {
        const r = await api(`/assignments/${encodeURIComponent(btn.dataset.asg)}`, {
          method: 'PATCH', body: JSON.stringify({ monthlyRate: next }),
        });
        toast(`${r.employeeName}: ${money(r.from)} → ${money(r.to)} · ${r.note}`);
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });

  el('hAdd')?.addEventListener('click', async () => {
    const date = el('hDate').value;
    const name = el('hName').value.trim();
    if (!date || !name) { toast('ต้องกรอกทั้งวันที่และชื่อวันหยุด', true); return; }
    try {
      await api('/holidays', { method: 'POST', body: JSON.stringify({ date, name }) });
      toast(`เพิ่มวันหยุด ${dateOnly(date)} — ${name}`);
      renderMaster();
    } catch (error) { toast(error.message, true); }
  });

  main.querySelectorAll('.hrm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบวันหยุดวันที่ ${dateOnly(btn.dataset.date)} ?`)) return;
      try {
        const q = new URLSearchParams({ date: btn.dataset.date });
        if (btn.dataset.cus) q.set('customerId', btn.dataset.cus);
        await api(`/holidays?${q}`, { method: 'DELETE' });
        toast('ลบแล้ว');
        renderMaster();
      } catch (error) { toast(error.message, true); }
    });
  });
}

/* ══ ทะเบียนใบแจ้งหนี้ ══════════════════════════════════════
   ไว้กางยอด VAT / หัก ณ ที่จ่าย ของหลายรอบเทียบกันในตารางเดียว
   ซึ่งหน้ารอบบิลทำไม่ได้เพราะดูได้ทีละรอบ
   หมายเหตุ: นี่คือ "สิ่งที่เราส่งเข้าไป" ไม่ใช่สถานะล่าสุดใน FlowAccount */
async function renderInvoices() {
  const invoices = await api('/invoices');
  const sum = (k) => invoices
    .filter((i) => i.status === 'sent_to_flowaccount')
    .reduce((s, i) => s + (i[k] ?? 0), 0);

  main.innerHTML = `
  <div class="page">
    <div class="phd"><div><span class="ey">เอกสาร</span><h1>ใบแจ้งหนี้</h1>
      <p>เอกสารที่ระบบสร้างเข้า FlowAccount — กางยอดภาษีของทุกรอบไว้เทียบกัน</p></div></div>

    <div class="card"><div class="tw"><table style="min-width:960px">
      <thead><tr><th>เลขที่เอกสาร</th><th>รอบบิล</th><th>ลูกค้า</th>
        <th class="r">หลังส่วนลด</th><th class="r">VAT</th><th class="r">หัก ณ ที่จ่าย</th>
        <th class="r">ยอดรับชำระ</th><th style="width:150px">สถานะ</th></tr></thead>
      <tbody>${invoices.length ? invoices.map((i) => `
        <tr class="rw" data-cycle="${esc(i.contract_id)}|${esc(i.period)}">
          <td><span class="docid">${esc(i.document_no ?? '—')}</span>
              <span class="sub">${dateOnly(i.document_date)}</span></td>
          <td>${esc(i.periodLabel)}</td>
          <td>${esc(i.customer_name)}<span class="sub">${esc(i.po_no)}</span></td>
          <td class="r n">${money(i.total_after_discount)}</td>
          <td class="r n">${money(i.vat)}</td>
          <td class="r n" style="color:var(--cr)">−${money(i.withholding_tax)}</td>
          <td class="r n" style="font-weight:700;color:var(--brand-d)">${money(i.payment_amount)}</td>
          <td><span class="st ${i.status === 'sent_to_flowaccount' ? 'ok' : i.status === 'failed' ? 'cr' : 'wn'}">
            ${i.status === 'sent_to_flowaccount' ? 'สร้างร่างแล้ว' : i.status === 'failed' ? 'ส่งไม่สำเร็จ' : 'ร่าง'}</span>
            ${i.response?.mode === 'dry-run' ? '<span class="sub">dry-run</span>' : ''}
            ${i.email_sent_at ? `<span class="sub">ส่งเมลแล้ว ${dt(i.email_sent_at)}</span>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="8" class="empty">ยังไม่มีใบแจ้งหนี้ — สร้างได้ที่ขั้น 3</td></tr>'}</tbody>
      ${invoices.length ? `<tfoot><tr>
        <td colspan="3" style="font-weight:600">รวมที่สร้างเข้า FlowAccount แล้ว</td>
        <td class="r n">${money(sum('total_after_discount'))}</td>
        <td class="r n">${money(sum('vat'))}</td>
        <td class="r n" style="color:var(--cr)">−${money(sum('withholding_tax'))}</td>
        <td class="r n" style="font-weight:700;color:var(--brand-d)">${money(sum('payment_amount'))}</td>
        <td></td></tr></tfoot>` : ''}
    </table></div></div>

    <div class="note">${icon('info')}<span>
      <strong>ตารางนี้คือสิ่งที่ระบบส่งเข้าไป ไม่ใช่สถานะล่าสุดใน FlowAccount</strong> —
      ถ้ามีคนไปแก้หรืออนุมัติเอกสารในระบบบัญชี ตารางนี้จะไม่รู้
      และไม่มีข้อมูลการรับชำระเงิน เพราะระบบนี้ไม่ได้บันทึกส่วนนั้น · คลิกแถวเพื่อเปิดรอบบิล
    </span></div>
  </div>`;

  bindRows();
}

const RENDER = {
  dash: renderDashboard,
  upload: renderUpload, queue: renderQueue, cycles: renderCycles,
  invoices: renderInvoices, master: renderMaster,
};

/** แท็บที่ควรถูกไฮไลต์เมื่ออยู่ในหน้าย่อย */
const PARENT_TAB = { detail: 'queue', cycle: 'cycles' };

function markTab(view) {
  const active = PARENT_TAB[view] ?? view;
  document.querySelectorAll('.mtab').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === active));
}

function setNav(view) {
  state.view = view;
  markTab(view);
  render();
}

/* ── ป้ายตัวเลขสด ─────────────────────────────────────────────
   ป้ายบนเมนูขั้นที่ 2 และ 3 บอกว่ามีงานค้างกี่ชิ้นในขั้นนั้น
   คนใช้ไม่ควรต้องกดรีเฟรชเพื่อรู้ว่ามีของใหม่ จึงถาม /pulse เป็นจังหวะ
   เขียนป้ายจากที่นี่ที่เดียว หน้าอื่นไม่ต้องเขียนเอง เลขจะได้ตรงกันทุกหน้า */

/* เซิร์ฟเวอร์เป็นฝ่ายบอกเองผ่าน /api/stream ป้ายจึงขึ้นแทบทันทีที่มีของใหม่
   การถามเป็นจังหวะยังเก็บไว้ห่างๆ เป็นตัวกันพลาด เผื่อข่าวหลุดตอนสายขาด */
const PULSE_MS = 60_000;
let pulseTimer = null;
let nudgeTimer = null;
let changeStream = null;

async function syncBadges() {
  let p;
  try { p = await api('/pulse'); } catch { return; }   // ป้ายพลาดไม่ควรทำให้หน้าพัง

  const queue = el('queueBadge');
  queue.textContent = int(p.needsAction);
  queue.classList.toggle('zero', p.needsAction === 0);

  const cycle = el('cycleBadge');
  cycle.textContent = int(p.readyToApprove);
  cycle.classList.toggle('zero', p.readyToApprove === 0);

  paintBell(p.feed);
  if (!el('bellPop').hidden) renderBellPop(p.feed);   // แผงเปิดอยู่ก็เห็นของใหม่ทันที

  const chip = el('envChip');
  chip.className = `env ${p.flowAccountMode === 'dry-run' ? 'dry' : 'live'}`;
  chip.innerHTML = `<i></i> FlowAccount: ${esc(p.flowAccountMode)}`;

  const mode = el('modeChip');
  mode.className = `env mode ${p.manualMode ? 'dry' : 'live'}`;
  mode.innerHTML = `<i></i> โหมด ${p.manualMode ? 'Manual — คนกดเอง' : 'Auto'}`;

  /* ชื่อบนแถบบนต้องเป็นชื่อเดียวกับที่ audit log บันทึก ไม่ใช่ป้ายตกแต่ง */
  const unknown = p.actor === 'ยังไม่ได้ระบุผู้ใช้';
  el('actorName').textContent = p.actor;
  el('actorAvatar').textContent = unknown ? '?' : initials(p.actor);
  el('actorRole').textContent = unknown ? 'ตั้ง ACTOR ใน .env' : 'ผู้ใช้ระบบ';
}

/* หนึ่งการกระทำมักบันทึกหลายเหตุการณ์ติดกัน (เช่นอนุมัติรอบบิล)
   รอให้ข่าวชุดนั้นมาครบก่อนแล้วถามครั้งเดียว ไม่ใช่ถามทุกข่าว */
function nudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { syncBadges(); refreshView(); }, 200);
}

/* ข้อมูลเปลี่ยนแล้วหน้าที่กำลังดูอยู่ต้องตามให้ทันเอง จึงไม่ต้องมีปุ่มให้กดรีเฟรช
   ข้ามถ้ากำลังพิมพ์อยู่ในหน้า เพราะการวาดใหม่จะดึงโฟกัสและตำแหน่งเคอร์เซอร์ไป
   ข้ามหน้ารายละเอียดกับหน้ารอบบิลด้วย เพราะคนกำลังอ่านเอกสารใบนั้นอยู่
   ไม่ควรถูกวาดใหม่คาตา — ปุ่มในหน้านั้นวาดใหม่เองอยู่แล้วเมื่อกดสั่งงาน */
function refreshView() {
  const focused = document.activeElement;
  if (focused && main.contains(focused) && focused.matches('input, textarea, select')) return;
  // หน้าอัปโหลดเป็นฟอร์มที่มีไฟล์ที่เลือกไว้ค้างอยู่ วาดใหม่ทีไฟล์หลุด
  if (state.view === 'upload') return;
  if (RENDER[state.view]) render({ silent: true });
}

function startPulse() {
  clearInterval(pulseTimer);
  pulseTimer = setInterval(() => { syncBadges(); refreshView(); }, PULSE_MS);
}

/* EventSource ต่อสายกลับให้เองเมื่อสายหลุดหรือเซิร์ฟเวอร์รีสตาร์ต
   จึงไม่ต้องเขียนตรรกะต่อใหม่เอง และสายที่ต่อกลับได้ก็จะถามยอดล่าสุดทันที */
function listenForChanges() {
  changeStream?.close();
  changeStream = new EventSource('/api/stream');
  changeStream.addEventListener('change', nudge);
  changeStream.addEventListener('open', () => syncBadges());   // ตามยอดที่อาจพลาดไปช่วงสายขาด
}

/* แท็บที่ถูกซ่อนไว้ไม่ต้องถามเซิร์ฟเวอร์ทิ้งเปล่าๆ กลับมาดูค่อยถามทันทีทีเดียว */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(pulseTimer);
  else { syncBadges(); refreshView(); startPulse(); }
});

/**
 * วาดหน้าที่กำลังดูอยู่ใหม่
 * silent = วาดทับไปเลยโดยไม่ขึ้น "กำลังโหลด" และไม่เลื่อนกลับขึ้นบนสุด
 * ใช้ตอนข้อมูลเปลี่ยนเองจากข้างนอก ไม่ใช่ตอนคนกดเปลี่ยนหน้า
 */
async function render({ silent = false } = {}) {
  if (!silent) main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  syncBadges();
  try {
    await RENDER[state.view]();
  } catch (error) {
    main.innerHTML = `<div class="page"><div class="card"><div class="empty">
      ${icon('alt', 'i')}<div>${esc(error.message)}</div></div></div></div>`;
    toast(error.message, true);
  }
  if (!silent) window.scrollTo({ top: 0 });
}

document.querySelectorAll('.mtab').forEach((btn) => {
  btn.addEventListener('click', () => setNav(btn.dataset.view));
});

/* ── ย่อ/กางเมนูข้าง ─────────────────────────────────────────
   หน้าที่กว้างอย่างหน้าอนุมัติรอบบิล (สองคอลัมน์ + ใบแจ้งหนี้) ได้ที่คืนมา 192px
   จำสถานะไว้ใน localStorage เพราะเป็นความชอบของคนใช้ ไม่ใช่ข้อมูลของระบบ
   ตอนหุบยังอ่านออกว่าอยู่ขั้นไหน — เลขขั้นอยู่มุมไอคอน และมี tooltip กำกับทุกปุ่ม */
const SIDE_KEY = 'obs.sideCollapsed';

function applySideState(collapsed) {
  document.body.classList.toggle('side-collapsed', collapsed);
  const btn = el('sideToggle');
  btn.setAttribute('aria-pressed', String(collapsed));
  btn.title = collapsed ? 'กางเมนู' : 'ย่อเมนู';
  btn.setAttribute('aria-label', btn.title);
}

el('sideToggle').addEventListener('click', () => {
  const collapsed = !document.body.classList.contains('side-collapsed');
  localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0');
  applySideState(collapsed);
});


/* ── กระดิ่งแจ้งเตือน ────────────────────────────────────────
   ตอบคำถาม "อะไรเพิ่งเกิดขึ้น" จาก audit_log พร้อมนับอ่าน/ไม่อ่าน
   ต่างจากการ์ด "งานที่ต้องทำ" บนแดชบอร์ดที่ตอบ "อะไรยังค้าง" — คนละคำถาม
   ป้ายเลขมาจาก /pulse ที่หน้าจอถามอยู่แล้ว ไม่ได้ยิงถามเพิ่ม */

const READ_KEY = 'obs.notifRead';
const READ_CAP = 500;   // เก็บเท่าที่จำเป็น ไม่ให้ localStorage บวม

const LEVEL_TONE = { critical: 'cr', warn: 'wn', ok: 'ok', info: 'info' };
const LEVEL_LABEL = { critical: 'ผิดพลาด', warn: 'ตีกลับ', ok: 'สำเร็จ', info: '' };

function readIds() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')); }
  catch { return new Set(); }
}

function saveReadIds(set) {
  const keep = [...set].sort((a, b) => b - a).slice(0, READ_CAP);
  localStorage.setItem(READ_KEY, JSON.stringify(keep));
}

function markRead(ids) {
  const set = readIds();
  ids.forEach((i) => set.add(i));
  saveReadIds(set);
}

/** เวลาแบบอ่านง่าย — ใกล้ๆ บอกเป็นนาที ไกลแล้วบอกเป็นวันที่ */
function ago(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  if (!d) return String(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'เมื่อวาน';
  if (day < 7) return `${day} วันที่แล้ว`;
  return dateOnly(iso);
}

function closeBell() {
  el('bellPop').hidden = true;
  el('bellBtn').setAttribute('aria-expanded', 'false');
}

/** ป้ายบนกระดิ่ง = จำนวนรายการที่ยังไม่ได้กดอ่าน */
function paintBell(feed) {
  const read = readIds();
  const unread = feed.items.filter((i) => !read.has(i.id)).length;
  const dot = el('bellCount');
  dot.hidden = unread === 0;
  dot.textContent = unread > 9 ? '9+' : unread;
  el('bellBtn').title = unread ? `${unread} เรื่องที่ยังไม่ได้อ่าน` : 'อ่านครบแล้ว';
}

function renderBellPop(feed) {
  const read = readIds();
  const unreadCount = feed.items.filter((i) => !read.has(i.id)).length;

  el('bellPop').innerHTML = `
    <div class="bp-hd">
      <b>การแจ้งเตือน</b>
      <span>${unreadCount ? `ยังไม่ได้อ่าน ${int(unreadCount)} เรื่อง` : 'อ่านครบแล้ว'}</span>
    </div>
    ${feed.items.length
      ? `<ul class="bp-list">${feed.items.map((n, i) => `
          <li><button data-bnotif="${i}" class="${read.has(n.id) ? '' : 'unread'}">
            <span class="tic ${LEVEL_TONE[n.level] ?? 'info'}">
              ${icon(n.level === 'critical' || n.level === 'warn' ? 'alt' : n.level === 'ok' ? 'chk' : 'info')}</span>
            <span class="bp-tx">
              <span class="bp-t">${esc(n.title)}</span>
              <span class="bp-d">${esc(n.detail)}</span>
              <span class="bp-m">${esc(ago(n.at))} · โดย ${esc(n.by)}</span>
            </span>
            ${LEVEL_LABEL[n.level]
              ? `<span class="tg ${LEVEL_TONE[n.level]}">${LEVEL_LABEL[n.level]}</span>` : ''}
          </button></li>`).join('')}</ul>
         <div class="bp-ft">
           ${unreadCount ? '<button class="lk" id="bellAll">อ่านแล้วทั้งหมด</button>' : ''}
         </div>`
      : '<div class="bp-empty">ยังไม่มีเหตุการณ์ในระบบ</div>'}`;

  el('bellPop').querySelectorAll('[data-bnotif]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = feed.items[Number(btn.dataset.bnotif)];
      markRead([item.id]);          // อ่านทีละรายการ ป้ายลดลงทีละหนึ่ง
      paintBell(feed);
      if (item.link) { closeBell(); openNotification(item); }
      else renderBellPop(feed);     // รายการที่ไม่มีที่ให้ไป แค่ทำเป็นอ่านแล้ว
    });
  });
  el('bellAll')?.addEventListener('click', () => {
    markRead(feed.items.map((i) => i.id));
    paintBell(feed);
    renderBellPop(feed);
  });
}

el('bellBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const pop = el('bellPop');
  if (!pop.hidden) { closeBell(); return; }
  try {
    const feed = await api('/activity?limit=25');
    /* ทาสีป้ายจากชุดข้อมูลเดียวกับที่กำลังจะแสดงในแผง
       ไม่มีบรรทัดนี้ ป้ายจะค้างเลขเก่าจนถึงรอบถามถัดไป (60 วินาที)
       คนจึงเห็น "แจ้งเตือน 6" แล้วกดเข้าไปเจอแผงว่าง */
    paintBell(feed);
    renderBellPop(feed);            // เปิดดูเฉยๆ ไม่นับว่าอ่าน ต้องกดรายการเอง
    pop.hidden = false;
    el('bellBtn').setAttribute('aria-expanded', 'true');
  } catch (error) { toast(error.message, true); }
});

document.addEventListener('click', (e) => {
  if (!el('bellPop').hidden && !e.target.closest('.bellwrap')) closeBell();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBell();
});

(async function boot() {
  applySideState(localStorage.getItem(SIDE_KEY) === '1');

  el('mastDate').textContent = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  render();          // render() เรียก syncBadges() ให้ป้ายขึ้นรอบแรกอยู่แล้ว
  listenForChanges();
  startPulse();
})();
