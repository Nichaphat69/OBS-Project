# n8n Workflow — ต่อกับระบบ OBS

แบ่งหน้าที่กันแบบนี้: **n8n ทำงานที่ต้องรอเหตุการณ์และตั้งเวลา · OBS ทำงานที่ต้องคำนวณเงิน**
กฎธุรกิจทั้งหมด (ปฏิทิน วันลา ส่วนลด VAT หัก ณ ที่จ่าย) อยู่ใน OBS และมี unit test คุม 24 ข้อ
n8n จึงไม่ต้องรู้กฎเลย แค่ส่งไฟล์เข้าไปแล้วอ่านค่า `nextAction` ที่ระบบตอบกลับ

| Phase เดิม | ใครทำ |
|---|---|
| 1 · จับอีเมล ดึงไฟล์แนบ | **n8n** |
| 1 · อ่านไฟล์ด้วย AI + บันทึก | OBS (`/api/timesheets/ingest`) |
| 2 · ตรวจ Manday ทั้งหมด | OBS |
| 3 · สร้างเอกสารใน FlowAccount | OBS (`/api/cycles/.../approve`) |
| 4 · ร่างอีเมล | OBS |
| ตั้งเวลาตรวจรายวัน | **n8n** |

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `01-ingest-timesheet.json` | จับอีเมลแจ้งอนุมัติ → ส่งไฟล์เข้า OBS → แตกทางตาม `nextAction` |
| `02-daily-billing-check.json` | ทุกวันทำการ 09:00 ถามว่ารอบไหนพร้อมวางบิล แล้วสร้างร่าง |

---

## ขั้นตอนติดตั้ง

### 1. เปิด OBS ให้ n8n เรียกถึง

```bash
npm start          # http://localhost:4300
```

ต้องมี `ANTHROPIC_API_KEY` ใน `.env` เพราะ `/ingest` ต้องเรียก Claude อ่าน PDF

ถ้า n8n รันใน Docker จะเรียก `localhost` ของเครื่อง host ไม่ได้ ให้ใช้
`http://host.docker.internal:4300` แทน

### 2. ตั้งตัวแปรใน n8n

Settings → Variables → เพิ่ม

| ตัวแปร | ค่า |
|---|---|
| `OBS_BASE_URL` | `http://localhost:4300` |

### 3. Import workflow

Workflows → Import from File → เลือกไฟล์ `.json` ทั้งสองไฟล์

### 4. ตั้ง credential และปรับ node

- **Gmail Trigger** — ต้องผูก credential Gmail (OAuth2) และปรับ `q` ให้ตรงหัวข้ออีเมลจริงของระบบ TLI
- **แจ้งทีมให้เข้าไปแก้ / แจ้งทีมว่าติดอะไรอยู่** — ตอนนี้เป็น NoOp เปล่า ให้แทนด้วย Slack / Line / Email node ที่ทีมใช้

> ⚠️ พารามิเตอร์ของ node บางตัวอาจต้องปรับในหน้า n8n เพราะรูปแบบต่างกันตามเวอร์ชัน
> โครง workflow กับ HTTP call ถูกต้องแน่นอน แต่ควรกด Execute ทีละ node ดูครั้งแรก

---

## API ที่ n8n เรียก

### `POST /api/timesheets/ingest`

รับไฟล์เข้าระบบครบวงจร — อ่านด้วย Claude → จับคู่พนักงาน → บันทึก → คำนวณ Manday

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
| `approve_cycle` | ครบทุกคนในสัญญาและตรวจผ่าน | เรียก `/approve` ได้เลย |
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

### `POST /api/cycles/:contractId/:period/approve`

สร้างร่างใบแจ้งหนี้ใน FlowAccount + ร่างอีเมล **ไม่ส่งอีเมลออก**

ถ้ายังมีอะไรค้างจะได้ `409` พร้อม `blockers` บอกเหตุผล

### โหมด Manual ปิดทางนี้ไว้อยู่

ตอนนี้ระบบตั้งเป็นโหมด Manual (`billing_rules.requireHumanCheck = true`)
รอบบิลที่ยังไม่มีคนกดยืนยันผลตรวจจะ **ไม่โผล่ใน `/cycles/ready`** และ `/approve` จะตอบ 409
workflow ตัวที่ 2 จึงยังไม่ทำอะไรจนกว่าจะตั้งค่าเป็น `false`

ดู [../docs/manual-vs-auto.md](../docs/manual-vs-auto.md) ว่าสองโหมดต่างกันตรงไหน

---

## ทดสอบก่อนต่อ n8n จริง

```bash
# 1. ทดสอบ pipeline ทั้งหมดโดยไม่ต้องมี API key (ใช้ตัวอ่านไฟล์ปลอม)
npm test

# 2. ทดสอบ ingest ด้วยไฟล์จริง (ต้องมี ANTHROPIC_API_KEY)
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
| กดอนุมัติรอบบิล | ตกลงกันไว้ว่าต้องมีคนตรวจก่อนออกเอกสาร — เอา node approve ออกจาก workflow 2 ถ้าต้องการให้คนกดเองทุกครั้ง |
| เซ็นเอกสาร | ทำใน FlowAccount |
| กดส่งอีเมลหาลูกค้า | ระบบสร้างร่างให้ แต่ไม่ส่ง |
| นำเอกสารไปวางบิลที่อาคารลูกค้า | งานของเจ้าหน้าที่ |
