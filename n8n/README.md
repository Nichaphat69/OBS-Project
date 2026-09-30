# n8n Workflow — ต่อกับระบบ OBS

แบ่งหน้าที่กันแบบนี้: **n8n ทำงานที่ต้องรอเหตุการณ์และตั้งเวลา · OBS ทำงานที่ต้องคำนวณเงิน**
กฎธุรกิจทั้งหมด (ปฏิทิน วันลา ส่วนลด VAT หัก ณ ที่จ่าย) อยู่ใน OBS และมี unit test คุม 24 ข้อ
n8n จึงไม่ต้องรู้กฎเลย แค่ส่งไฟล์เข้าไปแล้วอ่านค่า `nextAction` ที่ระบบตอบกลับ

| Phase เดิม | ใครทำ |
|---|---|
| 1 · จับอีเมล ดึงไฟล์แนบ | **n8n** |
| 1 · รับไฟล์มาเก็บรอ | OBS (`/api/timesheets/receive-email`) — **ไม่อ่าน** (30 ก.ย. 69) |
| 1 · อ่านไฟล์ด้วย AI | คนกดปุ่มในแท็บ "ดึงจาก Gmail" ของ OBS (`/api/gmail/read`) — `/ingest` เดิมยังอยู่แต่ workflow ไม่เรียกแล้ว |
| 2 · ตรวจ Manday ทั้งหมด | OBS |
| 4.2 · ขออนุมัติก่อนสร้างเอกสาร | OBS ส่งเข้า LINE (`/api/cycles/.../request-approval`) — n8n **ไม่เรียก** `/approve` ตรงๆ อีกแล้ว |
| 3 · สร้างเอกสารใน FlowAccount | OBS หลังคนกด "อนุมัติ" ใน LINE (`/api/line/webhook` → `approveCycle()`) |
| 4 · ร่างอีเมล | OBS |
| ตั้งเวลาตรวจรายวัน | **n8n** |

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `01-obs-workflow.json` | workflow เดียว มี 2 trigger คนละจุดกัน (n8n รองรับหลาย trigger ในไฟล์เดียว) — **Gmail Trigger**: จับอีเมลแจ้งอนุมัติ → ส่งไฟล์เข้า OBS → แตกทางตาม `nextAction` · **Schedule Trigger**: ทุกวันทำการ 09:00 ถามว่ารอบไหนพร้อมวางบิล แล้วสร้างร่าง — รวมเป็นไฟล์เดียว 4 ส.ค. 69 เพื่อกด Activate ได้ที่เดียว (เดิมแยก `01-ingest-timesheet.json` / `02-daily-billing-check.json`) |

---

## ขั้นตอนติดตั้ง

### 1. เปิด OBS ให้ n8n เรียกถึง

```bash
npm start          # http://localhost:4300
```

ต้องเปิด Local Server ใน LM Studio/Ollama ไว้ก่อน เพราะ `/ingest` ต้องเรียกโมเดล vision ในเครื่องมาอ่าน PDF

ถ้า n8n รันใน Docker จะเรียก `localhost` ของเครื่อง host ไม่ได้ ให้ใช้
`http://host.docker.internal:4300` แทน

### 2. URL ของ OBS

โหนด HTTP Request ทุกตัวใน workflow เขียน URL ตรงเป็น `http://localhost:4300` ไว้แล้ว (แก้ 4 ส.ค. 69 —
เดิมใช้ `{{ $vars.OBS_BASE_URL }}` แต่ฟีเจอร์ Variables เป็นของแพ็กเกจเสียเงินใน n8n รุ่นใหม่ จึงเขียนตรง
ง่ายกว่า) **ถ้า n8n กับ OBS ไม่ได้อยู่เครื่องเดียวกัน หรือ n8n รันใน Docker ต้องแก้ URL ในแต่ละโหนดเอง**
(Docker เรียก `localhost` ของเครื่อง host ไม่ได้ ต้องใช้ `http://host.docker.internal:4300` แทน)

### 3. Import workflow

Workflows → Import from File → เลือก `01-obs-workflow.json`

### 4. ตั้ง credential และปรับ node

- **Gmail Trigger** — **ตัดสินใจไม่ผูก credential 4 ส.ค. 69** เพราะ OBS เชื่อมต่อ Gmail เองแล้ว (หน้า
  "ดึงจาก Gmail" ในขั้นอัปโหลด Timesheet) คนกดดึงเมลเองจากหน้าเว็บแทนได้ครบ ไม่ต้องมี trigger อัตโนมัติซ้ำ
  อีกจุด — โหนดนี้ปล่อยไว้เฉยๆ บน canvas ได้ ขึ้น error "Node does not have any credentials set" ตอนกด
  Execute เป็นเรื่องปกติ ถ้าวันหลังอยากเปิดใช้จริงต้องสร้าง Gmail OAuth client แยกสำหรับ n8n (คนละตัวกับที่
  OBS ใช้ใน `.env`) แล้วผูก credential ในหน้า n8n เอง + ปรับ `q` ให้ตรงหัวข้ออีเมลจริงของระบบ TLI
- **แจ้งทีมให้เข้าไปแก้** — เป็น NoOp เปล่าไว้เฉยๆ ไม่ต้องแทนอะไร เพราะ OBS แจ้ง LINE เองอยู่แล้วตอนเรียก
  `/api/timesheets/ingest` (ดู `notifyCheckFailed()` ใน `src/service.js` — ข้อ 2.6 ทำแล้ว 4 ส.ค. 69)
- **แจ้งทีมว่าติดอะไรอยู่** — ยังเป็น NoOp เปล่าจริง ให้แทนด้วย Slack / Line / Email node ที่ทีมใช้ (จุดนี้คนละจุดกับ
  ข้อ 2.6 — เป็นการแจ้งตอนรอบบิลที่ควรพร้อมแล้วแต่ยังติด blocker อื่นอยู่ ยังไม่มีใครทำ)
- **LINE (ขั้น 4.2)** — ไม่ต้องตั้งอะไรใน n8n เพราะ OBS รับ webhook เอง แต่ต้องตั้งที่ฝั่ง LINE
  Developers Console กับไฟล์ `.env` ของ OBS:
  1. สร้าง Messaging API channel → คัดลอก Channel access token + Channel secret ลง
     `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET`
  2. ตั้ง Webhook URL เป็น `https://<โดเมนที่เข้าถึง OBS ได้จริง>/api/line/webhook` (ต้องเป็น HTTPS
     ที่ LINE ยิงเข้ามาได้ — ngrok ก็ใช้ได้ตอนทดสอบ)
  3. เพิ่มบัญชี/กลุ่มที่จะให้อนุมัติเป็นเพื่อนกับ channel แล้วใส่ userId/groupId ใน
     `LINE_APPROVER_TARGET`
  4. ใส่ userId ของคนที่มีสิทธิ์กดอนุมัติจริงใน `LINE_APPROVER_USER_IDS` (คั่นด้วยจุลภาค) —
     ไม่ใส่ = ปิดรับทุกคน หา userId ได้จาก `event.source.userId` ในล็อกครั้งแรกที่มีคนกดปุ่ม

> ⚠️ พารามิเตอร์ของ node บางตัวอาจต้องปรับในหน้า n8n เพราะรูปแบบต่างกันตามเวอร์ชัน
> โครง workflow กับ HTTP call ถูกต้องแน่นอน แต่ควรกด Execute ทีละ node ดูครั้งแรก

---

## API ที่ n8n เรียก

### `POST /api/timesheets/receive-email`

(30 ก.ย. 69) สายอีเมลของ workflow เรียกตัวนี้ตัวเดียว — เก็บ PDF + หัวเรื่อง/ผู้ส่ง/เนื้ออีเมลไว้ในตาราง `inbound_emails`
**ไม่เรียกโมเดล** ให้โผล่ในแท็บ "ดึงจาก Gmail" รอคนกดอ่าน · body: `sourceEmailId`, `fileName`, `fileBase64`,
`subject`, `from`, `bodyText`, `receivedAt` · ส่งซ้ำได้ (ตอบ `duplicate: true`) · ไม่ใช่ PDF ตอบ 422
OBS ไม่ได้อ่านกล่องเมลเอง — Gmail Trigger ใน n8n ผูกกับกล่อง `obs@` ที่พี่ๆ บัญชี forward เฉพาะอีเมล Timesheet เข้ามา

### `POST /api/timesheets/ingest`

*(workflow ไม่ได้เรียกแล้วตั้งแต่ 30 ก.ย. 69 — เก็บไว้ใช้ทดสอบ/เรียกตรง)*

รับไฟล์เข้าระบบครบวงจร — อ่านด้วยโมเดล vision ในเครื่อง → จับคู่พนักงาน → บันทึก → คำนวณ Manday

ใช้ `documentNo` เป็น primary key **ยิงซ้ำได้ ไม่เกิดข้อมูลซ้ำ** (ระบบเขียนทับ ยกเว้นที่วางบิลไปแล้ว)

```json
{
  "documentNo": "2026020101",
  "fileBase64": "JVBERi0xLjQK...",
  "fileName": "Timesheet-Pongpun_022026.pdf",
  "sourceEmailId": "18f2a...",
  "receivedAt": "2026-03-01T08:40:00+07:00",
  "approvedBy": "Project Manager (TLI)",
  "expectedPeriod": "2026-02"
}
```

ส่ง `filePath` แทน `fileBase64` ได้ถ้า n8n อยู่เครื่องเดียวกับ OBS

**คำตอบ — ดูที่ `nextAction` เป็นหลัก**

| `nextAction` | ความหมาย | n8n ควรทำอะไร |
|---|---|---|
| `approve_cycle` | ครบทุกคนในสัญญาและตรวจผ่าน | เรียก `/request-approval` (**ไม่ใช่** `/approve`) — ให้คนกดใน LINE ก่อน |
| `wait_for_others` | ตรวจผ่านแต่ยังไม่ครบทุกคน | ไม่ทำอะไร รอ Timesheet คนที่เหลือ |
| `fix_mismatch` | ตรวจไม่ผ่าน — ดู `failures` | แจ้งทีมให้เข้าไปแก้ในหน้าเว็บ |
| `needs_match` | จับคู่พนักงานไม่ได้ — **ไม่ได้บันทึก** | แจ้งทีมให้ไปเพิ่มชื่อพ้อง |
| `already_billed` | รอบนี้วางบิลไปแล้ว | ข้าม |

ตัวอย่างคำตอบ
```json
{
  "timesheetId": "2026020101",
  "created": true,
  "nextAction": "wait_for_others",
  "status": "verified",
  "contractId": "CT-26B0113",
  "period": "2026-02",
  "employee": { "id": "EMP-0042", "nameTh": "พงศ์พันธ์ มามาก", "position": "Developer" },
  "matching": {
    "name": { "raw": "Pongpun Mamak", "kind": "exact", "reason": "ตรงกับชื่อในฐานข้อมูล" },
    "position": { "raw": "Java Programmer", "ok": true }
  },
  "manday": {
    "standardWorkingDays": 20, "payableDays": 19, "leaveCount": 1,
    "dailyRate": 2647.2, "discount": 2647.2, "lineAmount": 50296.73
  },
  "failures": [],
  "warnings": ["ตัวหารยังยืนยันไม่ได้"],
  "cycle": { "received": 1, "expected": 2, "complete": false, "missing": ["สุนีย์ มณีเกษมสุข"] }
}
```

### `GET /api/cycles/ready`

ถามว่ารอบไหนพร้อมวางบิล — ระบบคำนวณเงื่อนไขให้แล้ว

```json
{
  "today": "2026-07-28",
  "count": 1,
  "cycles": [{
    "contractId": "CT-26B0113", "period": "2026-02", "periodLabel": "กุมภาพันธ์ 2569",
    "customerName": "บริษัท ไทยประกันชีวิต จำกัด (มหาชน)", "poNo": "26/B0113",
    "headcount": 2, "expectedBillDate": "2026-03-02", "overdueToBill": true,
    "paymentAmount": 180665.4, "blockers": [], "canApprove": true
  }]
}
```

### `POST /api/cycles/:contractId/:period/request-approval`

**ขั้น 4.2 — ประตูมนุษย์จริงก่อนสร้างร่าง** ส่ง Flex Message สรุปรอบบิล (ลูกค้า โครงการ จำนวนคน
ยอดรับชำระ) พร้อมปุ่ม "อนุมัติ"/"ตีกลับ" เข้า LINE ตาม `LINE_APPROVER_TARGET` — **ยังไม่สร้าง
เอกสารใดๆ ที่นี่** ยิงซ้ำได้ ถ้ายังมีคำขอ `pending` ค้างอยู่จะไม่ส่งซ้ำ

ถ้ายังมีอะไรค้างจะได้ `409` พร้อม `blockers` บอกเหตุผล เช่นเดียวกับ `/approve`

### `POST /api/line/webhook`

ตั้งเป็น Webhook URL ของ LINE Messaging API channel — **OBS รับ webhook นี้เอง ไม่ผ่าน n8n**
เพราะ OBS มีเซิร์ฟเวอร์ HTTP ของตัวเองอยู่แล้ว และตรวจลายเซ็น HMAC ของ LINE ในไฟล์เดียวกัน
(`src/integrations/line.js`) ตรวจสองชั้นก่อนเชื่อ:

1. ลายเซ็น `X-Line-Signature` — ยืนยันว่าข้อความมาจาก LINE จริง
2. `userId` ของคนกดต้องอยู่ใน `LINE_APPROVER_USER_IDS` — กันคนอื่นในแชทเดียวกันกดแทน

กดปุ่ม "อนุมัติ" → เรียก `approveCycle()` ตัวเดิม (สร้างร่างใน FlowAccount) ให้ทันที
กดปุ่ม "ตีกลับ" → บันทึกว่า rejected ไม่สร้างเอกสารอะไร

ทดสอบตอนที่ยังไม่มีเครื่อง public HTTPS ได้ด้วย `npm test` (ดูหัวข้อทดสอบด้านล่าง) หรือ ngrok
ชี้เข้า `localhost:4300/api/line/webhook`

### `POST /api/cycles/:contractId/:period/approve`

สร้างร่างใบแจ้งหนี้ใน FlowAccount + ร่างอีเมล **ไม่ส่งอีเมลออก** — เรียกตรงได้จากหน้าเว็บ (คนนั่งกด
เองถือเป็นประตูมนุษย์อยู่แล้ว) แต่ **ห้ามให้ n8n เรียก endpoint นี้ตรงๆ อีก** ต้องผ่าน
`/request-approval` เท่านั้น ไม่งั้นย้อนกลับไปเป็นปัญหาเดิม (ดู "ปัญหาเชิงโครงสร้าง" ใน
[../docs/checklist.md](../docs/checklist.md))

ถ้ายังมีอะไรค้างจะได้ `409` พร้อม `blockers` บอกเหตุผล

### โหมด Manual ปิดทางนี้ไว้อยู่

ตอนนี้ระบบตั้งเป็นโหมด Manual (`billing_rules.requireHumanCheck = true`)
รอบบิลที่ยังไม่มีคนกดยืนยันผลตรวจจะ **ไม่โผล่ใน `/cycles/ready`** และ `/request-approval` จะตอบ 409
workflow ตัวที่ 2 จึงยังไม่ทำอะไรจนกว่าจะตั้งค่าเป็น `false`

ดู [../docs/manual-vs-auto.md](../docs/manual-vs-auto.md) ว่าสองโหมดต่างกันตรงไหน

---

## ทดสอบก่อนต่อ n8n จริง

```bash
# 1. ทดสอบ pipeline ทั้งหมดโดยไม่ต้องมี API key (ใช้ตัวอ่านไฟล์ปลอม)
npm test

# 2. ทดสอบ ingest ด้วยไฟล์จริง (ต้องเปิด Local Server ใน LM Studio/Ollama ไว้ก่อน)
curl -s -X POST localhost:4300/api/timesheets/ingest \
  -H 'Content-Type: application/json' \
  -d "{\"documentNo\":\"TEST-001\",\"filePath\":\"$(pwd)/docs/Timesheet-Pongpun_012026.pdf\",\"expectedPeriod\":\"2026-01\"}" | jq

# 3. ดูว่ารอบไหนพร้อมวางบิล
curl -s localhost:4300/api/cycles/ready | jq
```

---

## สิ่งที่ยังต้องทำเองอยู่ (ตั้งใจให้เป็นแบบนี้)

| งาน | ทำไมไม่อัตโนมัติ |
|---|---|
| กดอนุมัติรอบบิล | ตกลงกันไว้ว่าต้องมีคนตรวจก่อนออกเอกสาร — ตอนนี้เป็นปุ่ม "อนุมัติ"/"ตีกลับ" ใน LINE (ขั้น 4.2) ไม่ใช่ workflow 2 อีกแล้ว |
| เซ็นเอกสาร | ทำใน FlowAccount |
| กดส่งอีเมลหาลูกค้า | ระบบสร้างร่างให้ แต่ไม่ส่ง |
| นำเอกสารไปวางบิลที่อาคารลูกค้า | งานของเจ้าหน้าที่ |
