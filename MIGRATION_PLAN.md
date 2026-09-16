# แผนการย้าย OBS ไป Next.js + Express + Prisma/PostgreSQL

สถานะปัจจุบัน (Phase 0-5 ของแผนนี้ทำเสร็จแล้วในรอบนี้): scaffold ของ stack ใหม่ทั้งหมด —
`apps/web` (Next.js), `apps/api` (Express + TypeScript), `packages/db` (Prisma schema ครบ 21
ตาราง), `packages/domain` (พอร์ต pure logic บางส่วน), `docker-compose.yml`, สคริปต์ย้ายข้อมูล
SQLite → Postgres, และ vertical slice แรก (login + dashboard อ่านอย่างเดียว) ที่พิสูจน์ว่า
pipeline ทั้งสาย (Next.js → Express API → Prisma → Postgres, session cookie, Docker networking)
ทำงานได้จริง

ระบบเดิม (`src/`, `public/`, root `package.json`, `data/billing.sqlite`) **ยังคงทำงานตามปกติ
ทุกประการ ไม่ถูกแตะต้อง** และต้องรันคู่กันไปกับ stack ใหม่จนกว่าจะถึงขั้นตอนตัดขาดสุดท้าย
(ดู Phase 5.8 ด้านล่าง) — ห้ามลบ/ปิดระบบเดิมก่อนหน้านั้น **รวมถึงห้ามหยุดรับ n8n/LINE webhook ที่
ระบบเดิมก่อน Phase 5.6 (n8n endpoints + ประตูอนุมัติ LINE) จะพอร์ตเสร็จและทดสอบยิงจริงแล้ว** —
มิฉะนั้นรอบบิลอัตโนมัติของจริงจะหยุดทำงานกลางทาง

**อัปเดตแผน (2026-09-13):** วิจัยรอบใหม่พบว่า Phase 5.5 เดิม ("full frontend parity & cutover"
รวมกันเป็นข้อเดียว) ครอบคลุมงานกว้างเกินไปและมองข้ามจุดเสี่ยงสำคัญ — แยกออกเป็น **Phase 5.5
(frontend parity ล้วนๆ, ไม่รวม cutover)**, **Phase 5.6 (backend/n8n ที่จำเป็นก่อน cutover จริง —
ตัวบล็อกจริง ไม่ใช่แค่ความสมบูรณ์)**, **Phase 5.7 (deferred, ไม่บล็อก cutover)**, และ **Phase 5.8
(cutover mechanics เอง พร้อมกลยุทธ์ข้อมูลที่ตัดสินใจแล้ว)** ดูรายละเอียดแต่ละ phase ด้านล่าง

ทุกโมดูลที่ยังไม่ถูกพอร์ตในรอบนี้ (timesheet/manday, billing cycle, LINE/Gmail/FlowAccount/HRDD/
ABBYY, หน้าเว็บที่เหลือ, งาน admin) ยังคงทำงานอยู่ใน `src/service.js` + `public/app.js` ของระบบเดิม
ตามปกติ — roadmap ด้านล่างคือลำดับที่จะย้ายทีละส่วนในรอบถัดๆไป

## ลำดับความสำคัญ (ตามที่ผู้ใช้ยืนยัน — core billing pipeline ก่อน integration ที่ซับซ้อน)

### Phase 5.1 — Timesheet ingestion & Manday review
- [x] พอร์ต flow ตรวจ/ยืนยัน/ตีกลับ Timesheet (`service.js` — `listTimesheets`,
      `shapeTimesheetRow`, `getTimesheet`, `rejectTimesheet`, `markTimesheetChecked`) เป็น API
      routes ใน `apps/api` (`apps/api/src/lib/timesheetsService.ts`,
      `apps/api/src/routes/timesheets.ts`) — ยืนยันด้วยข้อมูลจริงที่ย้ายมาแล้ว ทั้งกรณีตรวจผ่าน
      และกรณีถูกบล็อกเพราะมีเช็คที่ severity=fail
- [x] พอร์ตหน้ารายละเอียด `timesheet_days` / `leave_days` (แท็บ "รายละเอียด") — หน้า
      `apps/web/src/app/(app)/manday/[id]/page.tsx`; `overtime_days` ยังไม่ได้ขึ้นจอ (ข้อมูลจริง
      ที่มีตอนนี้ไม่มี OT ให้ทดสอบ)
- [x] ต่อ `packages/domain/manday.ts` เข้ากับ route ตรวจ Manday จริง — หน้าจอนี้ยังอ่านค่า
      `computed` ที่คำนวณไว้แล้วจากตอน ingest เดิม ยังไม่มีปุ่ม "คำนวณใหม่" (`recomputeTimesheet` —
      ต้องพอร์ต `getCycleStatus`/`holidayMap` เพิ่มก่อน จึงเลื่อนไปรอบหน้า)
- [ ] พอร์ตหน้าจอ "อัปโหลด Timesheet" (manual entry) จาก `public/app.js` → หน้า Next.js ใหม่
- [ ] ปุ่ม "คำนวณใหม่" (`recomputeTimesheet`) — ต้องพอร์ต `getCycleStatus`/`holidayMap` ก่อน
- [ ] รายงานจับคู่ชื่อ/ตำแหน่ง/เรท (`buildMatchingReport` — `matchEmployee`/`checkPosition`) และ
      การเทียบวันลากับ HRDD (`checkTimesheetAgainstHrdd`) — ตั้งใจข้ามไว้ก่อนในรอบนี้
- [ ] พอร์ตเทสต์ที่เกี่ยวข้องจาก `test/*.test.js` (ดูรายการด้านล่าง)

### Phase 5.2 — Billing cycles
- [x] พอร์ตหน้าจอ cycle detail/preview จาก `public/app.js` — `apps/api/src/lib/cyclesService.ts`
      (`listBillingCycles`, `contractPeriodEmployees`, `previewCycleInvoice`, `buildEmailDraft`
      แบบ template) + หน้า `apps/web/src/app/(app)/billing/page.tsx` และ `billing/[contractId]/
      [period]/page.tsx` — ยืนยันด้วยข้อมูลจริง: พรีวิวใบแจ้งหนี้/ยอดรวม/ร่างอีเมลตรงกับที่คำนวณไว้
      ในหน้าตรวจ Manday ทุกตัวเลข และดึงอีเมลผู้ประสานงานจริงจาก `customers.contact_email` มาใส่
      ในร่างอีเมลถูกต้อง
- [x] พอร์ตหน้ารายการใบแจ้งหนี้ (`listInvoices`) — `apps/web/src/app/(app)/invoices/page.tsx`
      (ข้อมูลจริงตอนนี้มี 0 ใบแจ้งหนี้ — หน้าแสดง empty state ถูกต้อง)
- [x] เชื่อมปุ่ม "อนุมัติและสร้างร่างใน FlowAccount" (`approveCycle`) เป็น action จริงแล้ว —
      `apps/api/src/lib/flowaccountClient.ts` (พอร์ตจาก `src/integrations/flowaccount.js`) +
      `approveCycle`/`saveInvoice` ใน `cyclesService.ts` — ผู้ใช้ยืนยันให้ทดสอบยิง **sandbox จริง**
      และทดสอบสำเร็จ: สร้างเอกสารจริงเลขที่ `BL2026070003` ได้ share link จริงจาก
      FlowAccount, บันทึกใบแจ้งหนี้ + invoice_items, timesheet เปลี่ยนเป็น 'billed', ตัวเลขขึ้นตรงกัน
      ทั้ง 4 หน้า (แดชบอร์ด/ตรวจ Manday/วางบิล/ใบแจ้งหนี้)
- [ ] พอร์ตประตูอนุมัติผ่าน LINE (human-approval gate) — `src/integrations/line.js`
      (`requestCycleApproval`/`decideCycleApproval`/`processLineWebhook`) — เป็นทางเลือกคู่ขนานกับ
      ปุ่มอนุมัติบนเว็บ ไม่ใช่ทางเดียว จึงเลื่อนไปหลังปุ่มอนุมัติบนเว็บ
- [ ] `deleteInvoice` — ต้องมีใบแจ้งหนี้จริงก่อนถึงจะมีอะไรให้ลบ (ตอนนี้ยังไม่มี)
- [ ] พอร์ตเทสต์ที่เกี่ยวข้อง

### Phase 5.3 — AI-assisted intake
- [x] พอร์ต ABBYY Vantage OCR client (`src/extract/abbyy.js`) — `apps/api/src/lib/abbyyClient.ts`,
      เต็มรูปแบบ (client + `mapAbbyyResult` และ helper ทั้งหมด รวมทุก edge case ที่คอมเมนต์ต้นฉบับ
      บันทึกไว้) — **ทดสอบยิงจริงแล้ว** กับไฟล์ PDF จริงจากอีเมลจริง (ดู Gmail intake ด้านล่าง):
      auth/launch/poll/download/mapping ทำงานถูกต้อง รวมถึง edge case ที่ ABBYY ไม่ส่ง field บางตัวมา
      (`period`/`totalWorkDays`) ก็ถูก mapAbbyyResult จับเป็น note/blocker ให้ตรวจสอบถูกต้อง
- [x] พอร์ตหน้าจอ "อัปโหลด Timesheet" ครบทั้ง 4 แท็บ — `apps/web/src/app/(app)/upload/`
      (อัปโหลดไฟล์/ดึงจาก Gmail/กรอกเอง/ประวัติ) — ทุกแท็บทดสอบสำเร็จด้วยข้อมูลจริง: "กรอกเอง" สร้าง
      OBS202675 จริงผ่านทุกขั้นตอน (buildManualSheet → ingestTimesheet → recomputeTimesheet → ขึ้น
      ถูกต้องในหน้าตรวจ Manday); "ดึงจาก Gmail" อ่าน PDF แนบจริงผ่าน ABBYY สำเร็จ 2 ฉบับ — ฉบับแรก
      จับคู่พนักงาน/ตรวจตำแหน่งไม่ตรงถูกต้อง; ฉบับที่สองเจอช่องโหว่ ABBYY เอง (ไม่ส่ง period/workdays)
      ซึ่งระบบ block ให้กรอกเพิ่มถูกต้อง — ระหว่างทดสอบพบบั๊กจริง 2 จุดใน `ReviewCard.tsx` และแก้แล้ว:
      (1) ปุ่มยืนยันเดิม disable ค้างตาม blockers ตอนอ่านไฟล์ครั้งแรก ทำให้แก้ไขช่องแล้วกดยืนยันไม่ได้
      เลย — เอาเงื่อนไขนั้นออก ให้ backend ตรวจซ้ำจริงตอนกดยืนยันแทน (ตรงกับพฤติกรรมต้นฉบับที่ไม่ค้าง
      ปุ่มไว้); (2) ตอนยืนยันแล้ว backend ปฏิเสธจริง (เช่น "ไม่มีสัญญาที่ครอบคลุมรอบ") หน้าจอเดิมเช็คแค่
      `res.ok` (HTTP 200) เลยขึ้น "บันทึกสำเร็จ" ทั้งที่ไม่ได้บันทึกอะไรเลย — แก้ให้เช็ค `timesheetId`
      แทน (ตรงกับ `public/app.js`'s `!r.timesheetId` branch ในต้นฉบับทุกจุด)
- [x] พอร์ต `ingestTimesheet`/`enterTimesheetManually`/`recomputeTimesheet`/`holidayMap`/
      `employeesForMatching` (ปิด item ค้างจาก Phase 5.1 เรื่อง `recomputeTimesheet`) —
      `apps/api/src/lib/{ingestService,masterData}.ts`, เพิ่มใน `timesheetsService.ts`
- [x] พอร์ต `readTimesheetFile`/`confirmTimesheet`/`logAiRead`/`listAiReads`/`getAiRead`/
      `dismissAiRead`/`nextDocumentNo` — `apps/api/src/lib/{uploadService,aiReadsService}.ts`
- [x] พอร์ต Gmail inbox intake (`src/integrations/gmail.js`, แท็บ "ดึงจาก Gmail") —
      `apps/api/src/lib/{gmailClient,gmailService}.ts`, `apps/web/.../upload/GmailTab.tsx` —
      ทดสอบยิงจริงกับบัญชี Gmail จริง (OAuth2 refresh-token): ดึงกล่องขาเข้า, อ่าน PDF แนบผ่าน ABBYY,
      ซ่อน/เลิกซ่อนอีเมล ทำงานถูกต้องครบ — **ตัดส่วน auto-parse อีเมลด้วย local-LLM ออก** (เดิม
      `readApprovalEmail` เช็คสถานะอนุมัติ/เดือนอัตโนมัติแล้ว block ถ้าไม่ตรง) เพราะ local-LLM ยังไม่
      พอร์ต — พอร์ตนี้ส่งอีเมลดิบ (subject/from/body) ให้คนตรวจในหน้ายืนยันแทน (gate เดิม "คนตรวจก่อน
      ยืนยัน" ยังอยู่ครบ); ตัด `createDraft`/`sendMessage`/`findSentMessage` ออกเพราะเป็นของฟีเจอร์ร่าง
      อีเมลวางบิล (Phase 5.2) ไม่ใช่ intake
- [ ] พอร์ต local-LLM vision extraction (`src/llm/*`, `src/extract/timesheet.js`'s 996-line
      multi-page merge + `verifyExtraction`) — ไม่จำเป็นในรอบนี้เพราะ `.env` มี ABBYY credentials
      จริงอยู่แล้ว (ABBYY มาก่อนเสมอตามลำดับความสำคัญเดิม) จึงเป็น fallback ที่ยังไม่ได้ใช้งานจริง —
      ผลคือ local-LLM auto-parse อีเมลอนุมัติก็ยังไม่พอร์ตด้วย (ดูหมายเหตุ Gmail ด้านบน)
- [ ] พอร์ตเทสต์ที่เกี่ยวข้อง (`test/abbyy.test.js`, `test/ingest.test.js`,
      `test/gmailInboxDomain.test.js` เป็นหลัก — ดูรายละเอียดเต็มใน "Regression suite" ท้ายไฟล์)

### Phase 5.4 — Employee self-service & admin screens
- [x] หน้า admin: จัดการผู้ใช้ (users), audit log, ผู้รับแจ้งเตือน, สารบัญ ABBYY Skill, โดเมนอีเมลลูกค้า —
      `apps/api/src/lib/{usersService,auditLogService,notificationRecipientsService,abbyySkillsService,customersService}.ts`,
      `apps/api/src/routes/{users,auditLog,notificationRecipients,abbyySkills,customers,employees}.ts`,
      `apps/web/src/app/(app)/admin/*`, `apps/web/src/app/(app)/abbyy-skills/*` — ทดสอบสำเร็จด้วย
      ข้อมูลจริงที่ migrate มา (3 ผู้ใช้, 2 ผู้รับแจ้งเตือน LINE/อีเมล, 2 ABBYY skill, 3 ลูกค้า) ผ่าน
      ทั้ง UI และ curl ตรง: สร้าง/แก้ role/ลบผู้ใช้จริง (รวม guard ห้ามแก้/ลบ/ปิดใช้งานบัญชีตัวเอง —
      ตรวจทั้ง backend 400 และ UI disabled+title), เพิ่ม/ลบผู้รับแจ้งเตือน (validate อีเมลผิดรูปแบบ
      ถูกต้อง), เพิ่ม/ลบ ABBYY skill (กัน skillId ซ้ำ 409 ถูกต้อง), ตั้ง/ล้างโดเมนอีเมลลูกค้า, role
      gate `/admin` และ `/abbyy-skills` (admin เท่านั้น — ทดสอบด้วยบัญชี role accounting จริง ได้
      หน้า access-denied ถูกต้อง ทั้ง page และ nav item ที่ซ่อนไป)
  - เพิ่ม `requireAdmin`/`requireSuperAdmin` middleware (`apps/api/src/lib/requireRole.ts`) —
    ของเดิมไม่มี role middleware เลยในสแต็กใหม่ ต้องพอร์ตเพิ่มจาก server.js
  - เพิ่มปุ่ม "รีเซ็ตรหัสผ่าน" ให้ admin ในหน้าผู้ใช้ — ของเดิมไม่มี HTTP route นี้ (มีแค่ CLI/
    forgot-password flow) จึงเป็น API/UI ใหม่ที่ยังไม่เคยมีในระบบเดิม แต่ใช้ validation/side-effect
    (≥8 ตัวอักษร, ล้าง session ทั้งหมด, audit `reset_password`) ตรงกับของเดิมทุกจุด
  - ปุ่มลบ (ผู้ใช้/ผู้รับแจ้งเตือน/ABBYY skill) ใช้ `window.confirm()` แทน confirmModal ที่มีสไตล์ของ
    เดิม — ลดสโคปเพราะยังไม่มี modal component ในสแต็กใหม่ ทำงานถูกต้องกับคนใช้จริง (ตรวจสอบ
    ข้อความ/เงื่อนไขตรงกับต้นฉบับ) แค่ทดสอบผ่าน automated browser ไม่ได้ (native dialog บล็อก
    automation) — ทดสอบ backend endpoint ตรงด้วย curl แทนในจุดนั้น
  - เพิ่ม `GET /api/employees` (ของเดิมมีอยู่แล้วแต่สแต็กใหม่ยังไม่เคยพอร์ต) สำหรับ dropdown
    "ผูกพนักงาน" ในหน้าผู้ใช้
- [x] LINE account linking (ผูกบัญชีพนักงาน) + แจ้งปัญหา (support tickets) —
      `apps/api/src/lib/{lineClient,employeeLineLinkService,lineWebhookService,supportTicketsService}.ts`,
      `apps/api/src/routes/{lineWebhook,myLineLink,supportTickets}.ts`,
      `apps/web/src/app/(app)/{my-line-link,tickets}/*` — ทดสอบยิงจริงกับ LINE Messaging API จริง
      (`.env` มี `LINE_CHANNEL_ACCESS_TOKEN`/`LINE_CHANNEL_SECRET`/`LINE_APPROVER_TARGET`/
      `LINE_APPROVER_USER_IDS` อยู่แล้ว) — ยิง webhook เข้า `/api/line/webhook` ตรงๆ ด้วย payload ที่เซ็น
      HMAC-SHA256 จริงด้วย `LINE_CHANNEL_SECRET` (จำลองสิ่งที่ LINE จะส่งมา เพราะ sandbox นี้ไม่มี URL
      สาธารณะให้ LINE ยิง webhook เข้ามาเองได้): (1) ผูกบัญชีจริงด้วยรหัส `LINK-xxxxxx` ที่ขอผ่าน
      `POST /api/my-line-link/start` — ตรวจ `employees.line_user_id` ถูกตั้งจริง + audit
      `link_employee_line` ถูกต้อง (2) เลิกผูกจริงผ่าน `POST /api/my-line-link/unlink` (3) flow
      แจ้งปัญหาเต็มรูปแบบ: "แจ้งปัญหา" → เลือกหมวดผ่าน postback `ticket:start:bug` → พิมพ์รายละเอียด →
      สร้างตั๋ว #2 จริงในฐานข้อมูล และ **ส่ง LINE push แจ้งฝ่ายบัญชีจริง** (ขออนุญาตผู้ใช้ก่อนยิงเพราะ
      เป็นการส่งข้อความหาบุคคลจริง — ผู้ใช้ยืนยันให้ส่งได้) ยืนยันไม่มี `notify_support_ticket_error`
      ในบันทึก แปลว่า push สำเร็จจริง (4) resolve ตั๋วผ่านหน้าเว็บ `/tickets` (admin เท่านั้น, ตรงกับ
      commit `9bd675c` ที่จำกัดจาก accounting ด้วย) — `resolvedBy` บันทึกชื่อ admin ถูกต้อง (5) resolve
      ผ่าน postback `ticket:resolve:` จากคนนอกรายชื่อ `LINE_APPROVER_USER_IDS` ถูกปฏิเสธ (`denied`)
      ถูกต้อง (6) ลายเซ็นปลอมถูกปฏิเสธด้วย 401 ถูกต้อง — ลบ user/ล้าง link ทดสอบออกหมดหลังจบ
  - `listKnownLineUsers()` (ตัวเลือก LINE user ในฟอร์มเพิ่มผู้รับแจ้งเตือน หน้าจัดการระบบ) ตอนนี้ enrich
    `displayName` จริงจาก `LineClient.getProfile()` แล้ว (ปิดช่องว่างที่ทิ้งไว้จาก Phase 5.4's admin
    screens ก่อนหน้า)
  - **ตัดขอบเขตโดยตั้งใจ** — ยังไม่พอร์ตส่วนที่เหลือของ `handleEmployeeLineMessage`/`processLineWebhook`
    ในต้นฉบับ: postback อนุมัติวางบิล (`approve`/`reject:...`, แยกเป็น "ประตูอนุมัติผ่าน LINE" ใน Phase
    5.2 อยู่แล้ว), postback เลือกวิธีส่ง Timesheet (`tsmethod:...`), และคำสั่งพนักงาน "ส่ง Timesheet"/
    "สถานะ"/"สถานะการวางบิล" (ต้องพึ่ง `employeeProgress()`/`pendingSubmissionFor()`/การ์ด flex สถานะ
    ที่ยังไม่พอร์ต) — พนักงานที่ผูกบัญชีแล้วพิมพ์คำสั่งเหล่านี้จะได้ข้อความช่วยเหลือทั่วไปแทน (ไม่เงียบ
    ไปเฉยๆ) แทนที่จะได้การ์ดเฉพาะทาง
  - หน้า "เชื่อมต่อ LINE" (`/my-line-link`) เป็นหน้าเดี่ยวใหม่ ไม่ได้ฝังอยู่ใน "ความคืบหน้าของฉัน" แบบ
    ต้นฉบับ เพราะหน้านั้น (employeeProgress ทั้งหน้า) ยังไม่พอร์ต — เพิ่ม `GET /api/my-line-link/status`
    ใหม่ (ไม่มีในต้นฉบับ ซึ่งเดิมได้สถานะจาก employeeProgress()) เพื่อให้หน้านี้โหลดสถานะผูกบัญชีได้เอง
  - พฤติกรรม "รหัสหมดอายุแล้วไม่มีข้อความตอบกลับเลย" (silent failure) ของต้นฉบับ — คงไว้ตามเดิม
    (ไม่ใช่บั๊กที่ตั้งใจแก้ในรอบนี้ แม้จะรู้ว่าเป็นจุดที่ UX ไม่ดี) เพราะต้นฉบับเองก็ไม่มีเทสต์ครอบคลุมจุดนี้
- [x] เลือกช่องทางส่ง Timesheet (self_obs/self_email/proxy_email/snooze) — `apps/api/src/lib/
      timesheetSubmissionService.ts` (`pendingSubmissionFor`/`overdueTimesheets`/
      `sendOverdueTimesheetReminders`/`timesheetDueDate`), `tsmethod:` postback + `bubble()`
      gradient support + `choiceRow`/`gradientButton`/4 flex builders เพิ่มใน `lineClient.ts`,
      `handleTimesheetMethodPostback` + คำสั่ง "ส่ง Timesheet" เพิ่มใน `lineWebhookService.ts`,
      `POST /api/timesheets/send-overdue-reminders` (public, n8n-facing เหมือนต้นฉบับ) —
      ทดสอบยิงจริงกับ LINE Messaging API จริงทั้งหมด: (1) พิมพ์ "ส่ง Timesheet" → เจอรอบเก่าสุดที่ยัง
      ไม่ส่งจริงถูกต้อง (เมษายน 2569 ของ ปิติกร ชุมภูชนะภัย, ตรงกับ logic "ไม่สนวันครบกำหนด เอาอันเก่า
      สุดของสัญญาแรก") (2) postback `self_obs` สำเร็จ + บันทึก audit ถูกต้อง (3) `snooze` สำเร็จ (แค่
      audit ไม่มี side effect อื่นตรงตามต้นฉบับ) (4) postback จากคนไม่ผูกบัญชี → `not_linked` ถูกต้อง
      ไม่มี side effect (5) `self_email` และ `proxy_email` — **ทั้งสองส่ง LINE push จริงสำเร็จ** หา
      ผู้รับแจ้งเตือนจริงที่ตั้งไว้ (ขออนุญาตผู้ใช้ก่อนยิงเพราะเป็นข้อความหาบุคคลจริง — ยืนยันให้ส่งได้)
      ไม่มี `notify_timesheet_self_email_error`/`notify_timesheet_proxy_error` ในบันทึก แปลว่า push
      สำเร็จจริงทั้งคู่ (6) `send-overdue-reminders` เรียกจริง พบ 16 รอบที่เลยกำหนดจริงถูกต้อง (รวมนับ
      timesheet สถานะ "ตีกลับ" ว่ายังไม่ส่งด้วย ตรงกับต้นฉบับ) ทุกรายการ skip เพราะยังไม่มีพนักงานคนไหน
      ผูกบัญชีไลน์จริงตอนนี้ (ปลอดภัย ไม่มี push เกิดขึ้นจริงในรอบทดสอบนี้) — ลบ user/ล้าง link
      ทดสอบออกหมดหลังจบเหมือนทุกรอบก่อนหน้า
  - เพิ่ม `WEB_BASE_URL` env ใหม่ (แยกจาก `APP_BASE_URL` เดิมที่ยังชี้แอปเก่า) สำหรับลิงก์ "ส่ง
    Timesheet ผ่านระบบ OBS" ในการ์ด LINE ของสแต็กใหม่ — ไม่ใส่ = การ์ดไม่มีปุ่มลิงก์ (เหมือนพฤติกรรม
    ต้นฉบับตอนไม่ตั้ง `APP_BASE_URL`)
  - **ตัดขอบเขตโดยตั้งใจ** — เลือก method ใน LINE ไม่ได้เขียนอะไรลง `timesheets.submission_method`
    เลย ตรงกับต้นฉบับทุกจุด (เป็นแค่ audit log บันทึก "เจตนา" ของพนักงาน คอลัมน์จริงถูกเขียนตอน ingest
    เท่านั้น — ดู `ingestService.ts`)
- [ ] ลงทะเบียนเอง / ลืมรหัสผ่านทางอีเมล / เข้าสู่ระบบด้วย Google — ย้ายไปเป็น Phase 5.5.7 แล้ว
      (ดูรายละเอียดที่นั่น)
- [ ] พอร์ตเทสต์ที่เกี่ยวข้อง (ดู "Regression suite" ท้ายไฟล์)

### Phase 5.5 — Full frontend parity

วิจัยละเอียดแล้ว (2026-09-13) — `public/app.js`'s view router (`RENDER` map, `app.js:5068-5073`) มี
12 view หลัก + 3 sub-view (detail/cycle/execCompanyDetail) = 15 จุด ดังนั้น "13 views" ในแผนเดิมคือ
การนับคร่าวๆ ที่ไม่ตรงเป๊ะ — ใช้รายการย่อยด้านล่างแทน จัดลำดับจาก "ต้นทุนต่ำ/ปลดล็อกของอื่น" ไปหา
"ใหญ่ที่สุด" ตามที่ research เสนอ:

- [x] **5.5.0 Shared UI primitives** — `apps/web/src/components/Overlays.tsx`: `OverlayProvider`
      (mount ที่ root `layout.tsx` ครั้งเดียว ครอบทั้งแอป) + hooks `useToast`/`useConfirm`/
      `usePrompt`/`usePdfPreview` — พอร์ต `toast()`/`confirmModal()`/`promptModal()`/
      `openPdfPreview()` (`app.js:423-536`) ตรงกับต้นฉบับทุกจุด (CSS ก็อปมาจาก `styles.css`'s
      `#tst`/`.modal-*`/`.pdf-*` ตรงๆ ลง `globals.css`, เพิ่มไอคอน `file`/`x`/`chk`/`doc`/`trash`/
      `trash-solid` ที่ยังขาดใน `IconSprite.tsx`) — แทนที่ `window.confirm()`/`window.prompt()` ที่ใช้
      ชั่วคราวในหน้า admin (`UsersTab`/`NotificationRecipientsTab`/`AbbyySkillsClient`) ครบทุกจุดแล้ว
      พร้อมเปลี่ยนข้อความ error/success แบบ inline `&lt;div&gt;` เป็น `toast()` ให้ตรงพฤติกรรมต้นฉบับ
      (ที่ toast ทุกผลลัพธ์ ไม่ใช่แค่ error) ทดสอบผ่านเบราว์เซอร์จริง: เพิ่ม/ลบ ABBYY skill เห็น toast
      สีเขียวถูกต้อง, กล่องยืนยันลบ (ทั้ง ABBYY skill และผู้ใช้) ขึ้นตรงกับดีไซน์ต้นฉบับ (แถบไล่สีฟ้า,
      ไอคอนถังขยะ, ปุ่มยกเลิก/ลบ) และที่สำคัญ **กดผ่าน automated browser ได้จริงแล้ว** (native
      `window.confirm()` เดิมบล็อก automation ไม่ให้ทดสอบ end-to-end ได้ — ปัญหาที่บันทึกไว้ใน Phase
      5.4 ตอนนี้หมดไปแล้ว) — `openPdfPreview`/`usePdfPreview` พอร์ตพร้อมใช้แต่ยังไม่มีหน้าไหนในสแต็ก
      ใหม่แสดงลิงก์ PDF ให้เรียกใช้จริง (รอ 5.5.6 master data)
- [x] **5.5.1 App-shell cross-cutting: pulse/badge + ตัวสลับบริษัท + SSE live refresh** —
      `apps/api/src/lib/{pulseService,activityFeedService}.ts` (`pulse()`/`activityFeed()`/
      `employeeTimesheetFeed()`/`FEED_SHAPE` พอร์ตครบ), `apps/api/src/lib/dashboardService.ts`
      เพิ่ม `getActiveContract`/`setActiveContract`/`deactivateContract` + `status` ใน
      `ContractSummary`, `apps/api/src/lib/events.ts` (`onChange`/`emitChange` ผูกเข้ากับ
      `audit.ts`'s `logAudit()` โดยตรง — ทุก mutation ที่ผ่าน `logAudit` เดิมจะยิง SSE event ให้เอง
      อัตโนมัติทั้งระบบ ไม่ต้องแก้ทีละ service), routes: `pulse.ts`/`contracts.ts`/`stream.ts`/
      `activity.ts` (`/api/activity`, `/api/my-notifications`) — ฝั่งเว็บ `AppShell.tsx` เขียนใหม่
      ทั้งหมด: ตัวสลับบริษัท (`.ctxwrap`/`.ctxpop`/`.ctx-item`), ชิปโหมด FlowAccount (`.env`), ป้ายเลข
      4 จุด (ตรวจ Manday/วางบิล/แจ้งปัญหา/กระดิ่ง) โพลทุก 60 วิ + SSE nudge, `notifRead.ts` (unread
      count จาก localStorage เหมือนต้นฉบับเป๊ะ) — ทดสอบผ่านเบราว์เซอร์จริงด้วยข้อมูลจริง: สลับบริษัท
      ปตท.↔Test Naka จริง เห็นป้ายเลข/กระดิ่งเปลี่ยนตามจริง (badge กรองตาม contract ที่ active ถูกต้อง
      ตรงกับต้นฉบับ), ยิง mutation จริงผ่าน curl (สร้าง/ลบ ABBYY skill ทดสอบ) จากนอกเบราว์เซอร์แล้วเห็น
      "กิจกรรมล่าสุด" ในหน้าแดชบอร์ดที่เปิดค้างไว้อัปเดตเองทันทีโดยไม่ต้องรีเฟรช (พิสูจน์ SSE
      ทำงานจริงปลายทางถึงปลายทาง)
  - **บั๊กที่เจอระหว่างทดสอบและแก้แล้ว**: click-outside ของตัวสลับบริษัท/เมนูบัญชี เดิมใช้ backdrop
    `&lt;div&gt;` เต็มจอที่เป็น sibling ของ `&lt;header&gt;` — แต่ `.topbar` ตั้ง `position:sticky` +
    `z-index` ของตัวเองไว้แล้ว (ทำให้เกิด stacking context ใหม่) ผลคือ backdrop (โปร่งใส มองไม่เห็น)
    ไปบังการคลิกทะลุไปโดนปุ่ม/รายการในป็อปอัพเอง (กดแล้วเหมือนไม่มีอะไรเกิดขึ้น) — แก้โดยเปลี่ยนมาใช้
    `ref` + `document` click-listener เช็ค `.contains()` แทน (ตรงกับกลไกจริงของต้นฉบับ
    `!e.target.closest('.ctxwrap')` พอดี ไม่ใช่แค่ backdrop เดา)
  - **ข้อยกเว้นทางสถาปัตยกรรมที่ตั้งใจ**: SSE (`/api/stream`) ต่อตรงจากเบราว์เซอร์ไป `apps/api`
    (`http://&lt;host&gt;:4301`) โดยตรง ไม่ผ่านพร็อกซี Next.js route handler เหมือน fetch อื่นทั้งหมด
    ในระบบ — ทดสอบแล้วพบว่า Next.js (ทั้งแบบส่ง `upstream.body` ตรงๆ และแบบอ่าน/enqueue เองทีละ
    chunk) ไม่ยอม flush stream ที่ไม่มีวันจบออกไปเลยแม้แต่ byte เดียวจนกว่าจะปิด connection
    (สงสัยเป็นข้อจำกัดของ Next.js standalone server หรือ compression กลาง แต่ลอง `compress: false`
    แล้วก็ยังไม่หาย) — แก้ด้วยการเปิด CORS + credentials ที่ `apps/api` ให้เบราว์เซอร์ต่อ SSE ข้าม
    origin ได้ตรงๆ แทน (พอร์ต 4301 ผูกกับ host เดียวกับเว็บเสมอในดีพลอยแบบ docker-compose นี้)
- [x] **5.5.2 การแจ้งเตือน (notifications)** — `apps/web/src/app/(app)/notifications/{page,
      NotificationsClient}.tsx` — backend พอร์ตไว้ครบแล้วตั้งแต่ 5.5.1 (`activityFeed()`/
      `employeeTimesheetFeed()`/`GET /api/activity`/`GET /api/my-notifications`) หน้านี้แค่เรียกใช้
      + พอร์ต `ago()`/`LEVEL_TONE`/`LEVEL_LABEL`/`openNotification()` deep-link ตรงกับต้นฉบับ
      (`link.view==='detail'` → `/manday/:id`, `'cycle'` → `/billing/:contractId/:period`,
      `'master'` → `/master`, อื่นๆ ที่ยังไม่มีหน้าในสแต็กใหม่ เช่น `myProgress` แค่ทำเป็นอ่านแล้ว) —
      เพิ่ม CSS `.tic`/`.bp-list`/`.bp-*`/`.bp-empty` ก็อปจาก `styles.css` ตรงๆ และไอคอน `info` ที่ยัง
      ขาดใน `IconSprite.tsx` — ทดสอบผ่านเบราว์เซอร์จริงด้วยข้อมูลกิจกรรมจริง 20 รายการ: คลิกรายการ
      "คำนวณ Manday ใหม่" → นำทางไป `/manday/OBS202675` ถูกต้อง + กลับมาหน้าแจ้งเตือนเห็นรายการนั้น
      ถูกทำเครื่องหมายอ่านแล้วจริง (จุดฟ้าหายไป, ตัวนับ "ยังไม่ได้อ่าน" ลดลงถูกต้อง), กด "อ่านแล้ว
      ทั้งหมด" → ครบทุกรายการเปลี่ยนเป็นอ่านแล้วถูกต้อง **และป้ายกระดิ่งบนเมนูข้างหายไปทันทีโดยไม่ต้อง
      รีเฟรชหน้า** (พิสูจน์ event `obs:notifread` ที่เพิ่มใน `notifRead.ts` ทำงานจริง — เพราะ localStorage
      เปลี่ยนไม่ใช่ mutation ฝั่งเซิร์ฟเวอร์ SSE เดิมจาก 5.5.1 จึงไม่รู้เรื่องด้วย ต้องมีช่องทางแยกให้
      `AppShell.tsx` re-render เอง)
- [x] **5.5.3 ภาพรวมทุกบริษัท (execOverview + execCompanyDetail)** — `app.js:4819-4936` (~113 บรรทัด)
      — ยืนยันแล้วว่า backend พอร์ตครบมาตั้งแต่ก่อนหน้านี้ ไม่ต้องแก้ (`GET /api/cycles`,
      `GET /api/cycles/:c/:p/employees`, `GET /api/employees` ตรง shape ที่ต้องการพอดี) งานที่ทำจริง
      คือฝั่ง frontend ล้วนๆ: `apps/web/src/app/(app)/companies/{page,ExecOverviewClient}.tsx` (ภาพรวม
      3 KPI + ตารางบริษัททั้งหมดคลิกได้) และ `companies/[contractId]/{page,CompanyDetailClient}.tsx`
      (รายละเอียดบริษัทเดียว, แท็บเลือกรอบเดือนสไตล์ "pill button" แบบเดียวกับแท็บ Admin/Upload ที่ใช้
      อยู่แล้วในระบบใหม่ — จงใจไม่ใช้ underline `.tabs`/`.tab` แบบต้นฉบับเพื่อความสม่ำเสมอ, 3 KPI ของรอบ
      ที่เลือก, ตารางสถานะ Timesheet รายพนักงาน) — ตรรกะเลือกรอบเริ่มต้น (เดือนปัจจุบันถ้ามี ไม่งั้นเอา
      รอบล่าสุด) พอร์ตตรงจาก `openExecCompany()` และผูกกับ `?period=` query param ผ่าน
      `useSearchParams`/`router.replace` เก็บ role gate ที่ขาดไปจริง (`AppShell.tsx` nav item
      `roles:['admin','executive']` + server-side `requireUser()` check ใน `page.tsx` ทั้งสองไฟล์ ตรง
      กับต้นฉบับที่จำกัดเฉพาะ executive/admin, `app.js:5146`) เพิ่มไอคอน `building`/`money` ใน
      `IconSprite.tsx` (path ตรงจาก `public/index.html:57,31`) — ทดสอบผ่านเบราว์เซอร์จริงด้วยข้อมูลจริง:
      `/companies` แสดง 3 บริษัท/5 พนักงาน/มูลค่าสัญญารวม 1,638,183.58 (วางบิลแล้ว 44,200.00) ถูกต้อง,
      คลิกแถว "บริษัท ปตท. จำกัด (มหาชน)" นำทางไป `/companies/CT-0001` ถูกต้อง (แท็บ "กันยายน 2569" ถูก
      เลือกอัตโนมัติเพราะเป็นเดือนปัจจุบัน, Timesheet 0/1, มูลค่า 0.00, สถานะ "รอ Timesheet", พนักงาน
      "ปิติกร ชุมภูชนะภัย" สถานะ "ยังไม่ได้ส่ง Timesheet"), คลิกแท็บ "สิงหาคม 2569" → ข้อมูลอัปเดตเป็น
      1/1, มูลค่า 47,500.00, สถานะ "รอคนตรวจ", พนักงานสถานะ "ตรวจผ่าน" ถูกต้อง และ URL เปลี่ยนเป็น
      `/companies/CT-0001?period=2026-08` จริง (ยืนยันด้วย `window.location.href`) ไม่มี console error
- [x] **5.5.4 ความคืบหน้าของฉัน (myProgress)** — `app.js:4700-4813` + `employeeProgress()`
      (`service.js:5106-5178`) พอร์ตครบทั้งฝั่ง backend/frontend/LINE:
      - **Backend**: `employeeProgress(employeeId)` ใหม่ใน `dashboardService.ts` (ใช้
        `enumeratePeriods`/`checkStamp`/`STATUS_LABEL`/`thaiMonth` ที่มีอยู่แล้วทั้งหมด ไม่ต้องพอร์ต
        helper เพิ่ม) + `GET /api/my-progress` (route ใหม่ `myProgress.ts`, เฉพาะ role 'user',
        ใช้ `session.employeeId` เสมอไม่รับจาก client) + `GET /api/settings` แบบย่อ (route ใหม่
        `settings.ts`, คืนแค่ `env.hasLine` ที่หน้านี้ต้องใช้ตัดสินใจโชว์ปุ่มเชื่อมต่อไลน์ไหม —
        ส่วนที่เหลือของ settingsSnapshot() เต็มรูปแบบรอ Phase 5.5.5)
      - **Frontend**: `apps/web/src/app/(app)/my-progress/{page,MyProgressClient}.tsx` — การ์ดต่อ
        สัญญา/ต่อรอบเดือน (`.rec`/`.minitab`/`.cardgrid` CSS ก็อปจาก `styles.css` ตรงๆ เพิ่มใหม่ใน
        `globals.css`) **ต่างจากต้นฉบับหนึ่งจุดโดยตั้งใจ**: ต้นฉบับฝัง UI เชื่อมต่อ/เลิกเชื่อมต่อ LINE
        ไว้ในหน้านี้เลย แต่สแต็กใหม่มีหน้า `/my-line-link` แยกต่างหากอยู่ก่อนแล้ว (พอร์ตไว้ตั้งแต่ก่อน
        หน้านี้) หน้านี้จึงโชว์แค่สถานะ + ลิงก์ไปหน้านั้นแทนที่จะสร้างฟอร์มซ้ำสอง
      - **Role gating ที่ตามมาด้วย** (จำเป็นเพื่อให้ role 'user' มีหน้าเริ่มต้นที่ถูกต้องจริง ไม่ใช่แค่มี
        หน้าใหม่เฉยๆ): เพิ่ม `roles` ให้ nav item `/dashboard`/`/upload`/`/manday`/`/billing`/
        `/invoices`/`/master` ใน `AppShell.tsx` ตรงกับตาราง `NAV_VISIBLE`/`isStaff()` เดิมทุกประการ
        + แก้ render ให้ซ่อน label กลุ่ม (`sgrp`) ไปด้วยถ้าไม่มีเมนูลูกเหลือให้เห็นเลย (เดิม hardcode
        `workflowGroupLabel`/`refGroupLabel` แยก ตอนนี้ generic จากรายการเมนูที่กรองแล้ว) + หน้า root
        `page.tsx` และ `dashboard/page.tsx` เพิ่ม redirect ตาม role ให้ตรงกับ `DEFAULT_VIEW` เดิม
        (`user`→`/my-progress`, `executive`→`/companies`, อื่นๆ→`/dashboard`) + `NotificationsClient.tsx`
        เปิด deep-link `link.view==='myProgress'` ที่เคย fallback เป็น "ทำเป็นอ่านแล้วพอ" ให้นำทางจริง
      - **LINE employee-command cluster ที่ตัดสโคปไว้ใน Phase 5.4 ปลดล็อกแล้ว**: เพิ่ม
        `buildEmployeeStatusFlex`/`buildBillingCycleFlex` (+ helper `billingStepRow`/
        `billingCycleBubble`/`BILLING_STEP_STYLE`) ใน `lineClient.ts`, เพิ่ม
        `buildEmployeeStatusFlexInput`/`buildBillingCycleFlexInput`/`buildEmployeeStatusText` (local
        helpers) + คำสั่ง "สถานะ"/"status"/"สรุปรอบวางบิล" และ "สถานะการวางบิล" ใน
        `lineWebhookService.ts`'s `handleEmployeeLineMessage()` (ลำดับเช็คตรงกับต้นฉบับ: หลัง "ส่ง
        Timesheet" ก่อน "แจ้งปัญหา"/"help") + เพิ่ม `myProgressLink()` คู่กับ `uploadLink()` เดิมใน
        `timesheetSubmissionService.ts` (ชี้ไปหน้าเว็บใหม่จริง `/my-progress` ไม่ใช่ `?view=` แบบเดิม)
        + export `SUBMISSION_METHOD_LABEL` จาก `activityFeedService.ts` มาใช้ซ้ำแทนที่จะประกาศซ้ำเป็น
        ครั้งที่ 3
      - **ทดสอบจริงผ่าน Docker + เบราว์เซอร์**: สร้างบัญชี QA ชั่วคราว (`qa.myprogress@example.com`,
        role พนักงาน, ผูกกับ `EMP-0044` ปิติกร ชุมภูชนะภัย ผ่านหน้า Admin → ผู้ใช้จริง ไม่ใช่ SQL ตรง)
        ล็อกอินแล้วยืนยัน: เด้งไป `/my-progress` อัตโนมัติทันทีตาม role (ไม่ใช่ `/dashboard`), เมนูข้าง
        เหลือแค่ "ความคืบหน้าของฉัน"/"การแจ้งเตือน"/"อัปโหลด Timesheet"/"เชื่อมต่อ LINE" ตรงกับ
        `ALLOWED_VIEWS.user` เดิมทุกประการ, การ์ดแสดงครบ 8 รอบเดือนของสัญญาจริง (CT-0001) เรียงล่าสุด
        ก่อนถูกต้อง ครอบคลุมทุกสถานะจริง: ยังไม่ส่ง (ก.ย.-ธ.ค. 69), ตรวจผ่านแล้วรอคนตรวจ Manday (ส.ค. 69,
        ตรงกับ cycle state "รอคนตรวจ" ที่เห็นใน `/companies` ตอน 5.5.3), วางบิลแล้วครบทั้งคนตรวจ/คนอนุมัติ
        (มิ.ย. 69 เลขที่ BL2026070003), ตีกลับให้แก้ไข (พ.ค. 69) — ปุ่ม "เชื่อมต่อไลน์" ชี้ไป
        `/my-line-link` ถูกต้อง, หน้า "การแจ้งเตือน" ของบัญชีนี้กรองเหลือแค่ของตัวเอง 3 รายการ คลิกแล้ว
        นำทางไป `/my-progress` จริง (ยืนยัน `link.view: 'myProgress'` ทำงาน) — แล้วทดสอบคำสั่งไลน์ด้วย
        การจำลอง webhook ตรงเข้า `POST /api/line/webhook` (เซ็น HMAC ด้วย `LINE_CHANNEL_SECRET` จริงจาก
        `.env`, ผูกบัญชีด้วยโค้ดจาก `/api/my-line-link/start` จริง แล้วส่งข้อความ "สถานะ"/
        "สถานะการวางบิล" ด้วย `userId` ปลอมที่ไม่ใช่บัญชีไลน์จริง — ไม่กระทบผู้ใช้จริงเลย): ได้ outcome
        `linked`/`status`/`billing_cycle_status` ถูกต้องครบ และยืนยันแยกอีกชั้นว่า `buildEmployeeStatusFlex`/
        `buildBillingCycleFlex` สร้าง Flex JSON ที่ถูกต้อง (เรียกตรงผ่าน compiled dist ในคอนเทนเนอร์
        ด้วยข้อมูลจริงของ EMP-0044 ไม่ throw) — เคลียร์บัญชี QA/ยกเลิกผูกไลน์ปลอมหลังทดสอบเสร็จแล้ว
- [x] **5.5.5 สารบัญ "ภาพรวม" ของหน้าจัดการระบบ ให้ตรงต้นฉบับเต็มรูปแบบ** — `settingsSnapshot()`
      (`service.js:4844-4868`) + `setFlowAccountConnected` (`service.js:826-847`) พอร์ตครบ:
      - **Backend**: `apps/api/src/lib/settingsService.ts` ใหม่ — `settingsSnapshot()` คืน
        `flowaccount`/`billingRules`/`env` (flowAccountMode, hasFlowAccountCredentials, local LLM
        base URL/โมเดล, hasGmail, gmailQuery, hasLine, lineRecipientCount, appBaseUrl) ครบทุก field
        ที่หน้า "ภาพรวม" ใช้จริง — **ตัดสินใจไม่พอร์ต** field `company`/`emailIngest`/`holidays` ที่
        ต้นฉบับคืนมาด้วย เพราะไม่มี UI ไหนอ่านค่าพวกนี้จริง (แม้แต่ต้นฉบับเอง) ส่วน holidays ผูกกับ
        master-data ที่ยังไม่พอร์ต รอ 5.5.6 — export `SUBMISSION_METHOD_LABEL`-style reuse:
        `DEFAULT_GMAIL_QUERY` จาก `gmailService.ts` มาใช้ซ้ำแทนประกาศใหม่ + `setFlowAccountConnected()`
        เขียน `settings.flowaccount.mode` จริง (`dry-run` ↔ ตาม `FLOWACCOUNT_MODE` ใน `.env`) พร้อม
        `logAudit` — เพิ่ม `GET /api/settings` (เปิดให้ทุก role อ่านได้เหมือนต้นฉบับ ไม่กัน role) และ
        `PATCH /api/settings/flowaccount-connected` (กันด้วย `requireAdmin` ที่มีอยู่แล้ว = admin/
        แผนกบัญชี ตรงกับต้นฉบับ)
      - **Frontend**: เขียน `admin/OverviewTab.tsx` ใหม่ทั้งหมด (เดิมเป็นเวอร์ชันที่ไม่ตรงกับต้นฉบับ
        เลย — โชว์ตัวเลขนับ users/skills/domains แทนที่จะเป็นสถานะการเชื่อมต่อ) เปลี่ยนเป็น 2 การ์ด
        `.g2` grid ตรงต้นฉบับทุกจุด: "การเชื่อมต่อ" (FlowAccount .env/DB จริง + เตือนถ้าไม่ตรงกัน,
        credential, ชนิดเอกสาร, Gmail, LINE+จำนวนผู้รับแจ้งเตือน, ลิงก์ LINE, local LLM base
        url/โมเดล) และ "เงื่อนไขวางบิล" (วันที่ลงเอกสาร, ต้องได้ครบทุกคน, ต้องมีคนกดยืนยัน, ฯลฯ) —
        เพิ่ม CSS `.g2`/`dl.kv` ก็อปจาก `styles.css` ตรงๆ
      - **สวิตช์ FlowAccount บนแถบบน** (`AppShell.tsx`) จากเดิมเป็น `<span>` อ่านอย่างเดียว เปลี่ยนเป็น
        `<button>` กดได้จริง เรียก `confirmModal` (เพิ่มไอคอน `signin` คู่กับ `signout` เดิมใน
        `IconSprite.tsx`) → `PATCH /api/settings/flowaccount-connected` → `toast` + รีเฟรช badge —
        ตรงกับ `el('envChip').addEventListener('click', ...)` เดิมทุกจุด
      - **ช่องว่างที่พบระหว่างทดสอบและแก้ทัน**: `OverviewTab.tsx` fetch `/api/settings` ครั้งเดียวตอน
        mount ไม่รู้เรื่องด้วยเมื่อมีคนกดสวิตช์ FlowAccount จากที่อื่น (ต่างจากต้นฉบับที่ `refreshView()`
        วาดหน้าที่เปิดค้างอยู่ใหม่ทุกครั้งที่มี SSE 'change' event) — แก้ด้วย custom window event
        `SETTINGS_CHANGED_EVENT` ใหม่ (`lib/settingsChanged.ts`, รูปแบบเดียวกับ `NOTIF_READ_EVENT`
        จาก 5.5.2) ที่ `toggleFlowAccount()` ยิงออกมาหลังสำเร็จ ให้ `OverviewTab.tsx` ที่เปิดค้างอยู่
        ดึงข้อมูลใหม่ทันทีโดยไม่ต้องรีเฟรชหน้า
      - **ทดสอบจริงผ่านเบราว์เซอร์ด้วยบัญชี admin จริงของผู้ใช้**: หน้า "ภาพรวม" โชว์ข้อมูลจริงถูกต้อง
        ทุกช่อง (FlowAccount sandbox ทั้ง .env/DB, credential ตั้งค่าแล้ว, Gmail/LINE เชื่อมต่อแล้ว,
        ผู้รับแจ้งเตือน LINE 1 ราย, ลิงก์/local LLM ตาม .env จริง) — กดสวิตช์ FlowAccount บนแถบบน →
        เห็น confirm modal ข้อความ/ไอคอนตรงกับ turningOn/turningOff ทั้งสองทิศทาง → กด "ปิดการเชื่อมต่อ"
        → ชิปเปลี่ยนเป็น "dry-run" ทันที + toast ขึ้น + **หน้า "ภาพรวม" ที่เปิดค้างอยู่แสดงคำเตือน
        "ไม่ตรงกับค่าใน .env" ถูกต้องจริง** (พิสูจน์ทั้ง mismatch-warning branch และปมที่พอร์ตมาใหม่ว่า
        Prisma เขียน settings จริง ไม่ใช่แค่ mock) → กด "เชื่อมต่อ" กลับ → ชิปกลับเป็น "sandbox" +
        การ์ด "ภาพรวม" อัปเดตสดโดยไม่ต้องรีโหลดหน้า (ยืนยัน `SETTINGS_CHANGED_EVENT` ทำงานจริง) →
        เช็คแท็บ "บันทึกระบบ" เห็น `set_flowaccount_connected` โดย actor "Admin" ทั้งสองรายการถูกต้อง
        ครบ — คืนค่า DB กลับเป็น sandbox เหมือนก่อนทดสอบเรียบร้อย ไม่มี console error
- [x] **5.5.6 ข้อมูลหลัก (master data)** — **รายการใหญ่ที่สุด** ~837 บรรทัด FE
      (`renderMaster` + 7 form helper, `app.js:3374-4210`) + ~480 บรรทัดจาก 23 ฟังก์ชันใน
      `service.js` (`createCustomer`/`createContract`/`updateContract`/`deleteContract`/
      `addEmployeeAlias`/`removeEmployeeAlias`/`updateAssignmentRate`/`addHoliday`/`removeHoliday`/
      `createEmployee`/`updateEmployee`/`removeAssignment`/`listHolidays`/`OFFICIAL_THAI_HOLIDAYS`
      ฯลฯ — ดู research เต็มสำหรับ line ref ทั้งหมด) + ~15 route ใหม่ — 3 แท็บ: พนักงาน&ชื่อพ้อง,
      ลูกค้า&สัญญา, วันหยุด — ต้องขยาย `GET /api/employees` ให้ส่ง shape เต็ม (alias, เรท,
      ใบเสนอราคา) ไม่ใช่แค่ `{id,nameTh,customerName}` แบบตอนนี้ — ทำหลัง 5.5.0 (ใช้ modal เยอะ)
      — **พอร์ตครบแล้วทั้งหมด**:
      - **Backend ใหม่**: `apps/api/src/lib/holidaysService.ts` (OFFICIAL_THAI_HOLIDAYS คัดลอกตรงตัว
        ทั้ง 3 ปี/`officialHolidayYears`/`ensureOfficialHolidays`/`listHolidays`/`addHoliday`/
        `removeHoliday`), `contractsMasterService.ts` (`createContract`/`updateContract`/
        `deleteContract` พร้อม cascade cleanup แบบ transaction/`updateContractWhtRate`/
        `listFlowAccountCompanies`), `employeesMasterService.ts` (`listEmployeesFull` แบบหนึ่งแถว
        ต่อหนึ่งอัตราจ้าง ตรงกับ LEFT JOIN เดิม/`createEmployee`/`updateEmployee`/
        `removeAssignment`/`addEmployeeAlias`/`removeEmployeeAlias`/`updateAssignmentRate`) +
        `createCustomer` เพิ่มใน `customersService.ts` เดิม — ทุกฟังก์ชันคง error message/audit
        action name ตรงต้นฉบับทุกตัวอักษร (`nextId()` ใช้ pattern เดียวกับ `abbyySkillsService.ts`)
      - **ขยาย `ContractSummary`/`listContracts()`** ใน `dashboardService.ts` ให้มี field เต็ม
        (contractNo/divisorMode/divisorValue/vatRate/whtRate/abbyySkillId/taxId/billingPlace/
        contactName/contactPhone) แทนที่จะเป็นแค่ชุดย่อยสำหรับการ์ดแดชบอร์ด — ไม่กระทบ consumer เดิม
        (เพิ่ม field ไม่ลบ) เพิ่ม `listDocuments()` ใน `flowaccountClient.ts` (ยังไม่เคยพอร์ต)
      - **`GET /api/employees` แยก shape ด้วย query param** `?shape=full&contractId=` แทนการเปลี่ยน
        endpoint เดิมที่ `UsersTab.tsx` ใช้อยู่แล้ว (ต้องการคนละ semantics: full = หนึ่งแถวต่อหนึ่ง
        อัตราจ้าง อาจซ้ำพนักงานถ้ามีหลายอัตราจ้าง, basic = หนึ่งแถวต่อพนักงานหนึ่งคนสำหรับ dropdown)
      - **Routes ใหม่**: `routes/assignments.ts` (`PATCH`/`DELETE /api/assignments/:id`),
        `routes/holidays.ts`, `routes/flowaccountCompanies.ts` (`GET /api/flowaccount/companies`
        — คงพาธเดิมของต้นฉบับแทนที่จะซ้อนใต้ `/api/contracts`) + ขยาย `employees.ts`/`contracts.ts`/
        `customers.ts` เดิม รวม ~15 route ตรงกับที่แผนประเมินไว้
      - **Frontend**: `apps/web/src/app/(app)/master/{page,MasterDataClient,EmployeesTab,
        CustomersContractsTab,HolidaysTab}.tsx` ใหม่ทั้งหมด — ใช้ตัวสลับแท็บ "pill button" แบบเดียว
        กับ Admin/period tabs อื่น (จงใจต่างจากต้นฉบับที่ใช้ `.tabs`/`.tab` เส้นใต้) ส่วนที่เหลือพอร์ต
        1:1 ทุกฟิลด์/ปุ่ม/ข้อความยืนยัน/toast รวมถึงจุดที่ inline-edit ด้วย local React state แทนการ
        แก้ DOM ตรงๆ (ชื่อพ้อง/ตำแหน่งพ้อง คลิกแท็กเพื่อแก้ไข, เรทต่อเดือน "แก้เรท") — เพิ่ม CSS
        `.selectchip`/`.rowacts`/`.toggle`/`.metabar`/`.frm`/`.fsec`/`.lk`/`.tg.alias-*`/
        `.aliasInput`/`.rateEditRow`/`.rateInput` ก็อปจาก `styles.css` ตรงๆ + ไอคอน `edit`/`signin`
        ที่ยังขาดใน `IconSprite.tsx`
      - **ผลพลอยได้**: พบว่า `AppShell.tsx`'s SSE nudge handler ไม่เคย refresh ตัวสลับบริษัทบนแถบบน
        (`loadContracts()`) เมื่อมีการเปลี่ยนแปลงจากที่อื่น (แค่ badge/`router.refresh()`) — แก้เพิ่ม
        `loadContracts()` เข้าไปใน nudge() ด้วย เป็น fix ทั่วไปที่ครอบคลุมทุกจุดที่แก้สัญญา ไม่ใช่แค่
        หน้านี้
      - **ทดสอบจริงผ่านเบราว์เซอร์ด้วยข้อมูลจริงและ FlowAccount sandbox จริง**: แท็บพนักงาน — เห็น
        EMP-0044 พร้อม alias 2 ชื่อ (ฟ้า) + 1 ตำแหน่ง (เหลือง) ถูกต้อง, เพิ่ม/แก้/ลบชื่อพ้องจริงผ่าน UI
        (พิสูจน์ add→POST, edit→POST ใหม่+DELETE เดิม, remove→confirm+DELETE ทำงานถูกต้อง), แก้เรท
        50,000→50,000 เห็น toast โน้ตข้อความตรงต้นฉบับเป๊ะ, เพิ่มพนักงานทดสอบใหม่ (EMP-0046) สำเร็จ
        แล้วลบออกจากโครงการทำความสะอาดเรียบร้อย — แท็บลูกค้า & สัญญา: เห็นข้อมูลเต็มทั้ง 3 สัญญาจริง
        ครบทุกฟิลด์ (VAT/หัก ณ ที่จ่าย/เครดิต/ผู้ประสานงาน/สถานที่วางบิลฯลฯ), เปิดฟอร์มแก้ไขสัญญาเห็น
        ABBYY skill dropdown จริง (OBS Timesheet-iPassion/OBS Timesheet2) แล้วกดยกเลิกไม่กระทบข้อมูล,
        **ทดสอบดึงข้อมูลจาก FlowAccount จริง**: dropdown "เพิ่มลูกค้าใหม่" โชว์ 7 ใบเสนอราคาจริงจาก
        sandbox, เลือกแล้ว autofill ชื่อ/เลขผู้เสียภาษี/สาขา/ที่อยู่ถูกต้อง + hint "ดึงพนักงาน 1 คน...",
        กดบันทึกจริง → สร้างลูกค้า+สัญญา+พนักงานอัตโนมัติสำเร็จครบ (เห็น 4 บริษัท) → ลบสัญญาทดสอบทิ้ง →
        ยืนยันด้วย SQL ตรงว่าพนักงานที่สร้างมาพร้อมกันถูกลบตาม (orphan cleanup ทำงานถูกต้อง) กลับสู่
        3 สัญญาเดิมสะอาด — แท็บวันหยุด: สลับปี 2568/2569/2570 เห็นวันหยุดทางการ 2569 ครบ 20 รายการตรง
        ข้อมูลที่ก๊อปมา ป้าย "ทุกลูกค้า" ถูกต้อง — network requests ทั้งหมดในรอบทดสอบ 200 OK ไม่มี error
        จริงจากโค้ดที่พอร์ตใหม่เลย (มีแค่ SSE reconnect churn ที่รู้อยู่แล้วจาก 5.5.1)
- [x] **5.5.7 ลงทะเบียนเอง / ลืมรหัสผ่านทางอีเมล / เข้าสู่ระบบด้วย Google** — พอร์ตครบทั้งหมด:
      - **`GmailClient.sendMessage` พอร์ตกลับมาแล้ว** (`gmailClient.ts`) — พร้อม `toBase64Url`/
        `buildMime`/`encodeHeader` ที่ต้องใช้ด้วย เก็บคำเตือนของต้นฉบับไว้ในคอมเมนต์ชัดเจนว่าใช้ได้
        เฉพาะอีเมลรหัสยืนยันลืมรหัสผ่านเท่านั้น ห้ามใช้กับร่างวางบิล/แจ้งอนุมัติ (จุดนั้นต้องรอ
        `createDraft()` เมื่อพอร์ตแล้ว)
      - **Backend**: `apps/api/src/lib/auth.ts` ขยายเพิ่ม `registerUser`/`requestPasswordReset`/
        `verifyResetCode`/`resetPasswordWithToken`/`findOrCreateGoogleUser`/
        `sendPasswordResetCodeEmail` (+ `hashSecret`/`secretMatches`/`findUserByLoginEmail` local
        helpers, `AuthError` class) ทุกฟังก์ชันคง error message/audit action ตรงต้นฉบับทุกตัวอักษร —
        `resetPasswordWithToken` เรียก `resetPassword()` จาก `usersService.ts` ที่มีอยู่แล้วต่อ (ไม่
        เขียนซ้ำ) ใหม่ทั้งไฟล์ `googleOAuth.ts` (ported from src/integrations/googleOAuth.js)
      - **Routes**: ขยาย `routes/auth.ts` เพิ่ม `GET /config`, `POST /register`,
        `POST /forgot-password`, `POST /verify-reset-code`, `POST /reset-password`,
        `GET /google/start`, `GET /google/callback` (สองตัวหลังตอบเป็น redirect 302 ไม่ใช่ JSON)
      - **สถาปัตยกรรม Google OAuth ผ่าน proxy**: ต่างจาก SSE (5.5.1) ที่ต้องให้ browser ต่อตรงข้าม
        origin เพราะ proxy ผ่านไม่ได้ — เคสนี้ตรงข้าม: จงใจให้ browser คุยกับ **apps/web เท่านั้น**
        เสมอ (ไม่ต่อตรงไป apps/api) แล้วให้ Next.js route handler สองตัวใหม่
        (`api/auth/google/{start,callback}/route.ts`) proxy ต่อไป apps/api ด้วย `redirect:'manual'`
        แล้ว relay ทั้ง `Location` และ `Set-Cookie` กลับมาเอง (แบบเดียวกับที่ `api/auth/login/
        route.ts` relay Set-Cookie อยู่แล้ว) — ทำแบบนี้เพื่อให้ session cookie/oauth-state cookie
        ทั้งคู่ scope อยู่ที่ web origin ที่ browser คุยด้วยจริงเสมอ ไม่ใช่ apps/api's origin (ถ้า
        browser ต่อตรงไป apps/api แบบ SSE จะได้ cookie ผิด origin) — ส่ง `x-forwarded-host`/
        `-proto` ไปด้วยให้ `googleRedirectUri()` คำนวณ callback URL ของ **เว็บ** ถูกต้อง (ไม่ใช่
        `api:4301` ภายใน Docker) เมื่อไม่ได้ตั้ง `GOOGLE_REDIRECT_URI` ตรงๆ ใน .env — คอมเมนต์ในโค้ด
        แนะนำให้ตั้งค่านี้ตรงๆเสมอในดีพลอยแบบนี้ (เชื่อถือได้กว่า auto-detect ผ่าน proxy หลายชั้น)
      - **Frontend**: ต่างจากต้นฉบับที่ใช้ hidden-div overlay ทับหน้า login เดียวกันทั้งสามหน้าจอ
        สแต็กใหม่แยกเป็นหน้าจริงตามธรรมเนียม Next.js routing: `/register` (ใหม่), `/forgot-password`
        (ใหม่ — 3 ขั้นตอนในหน้าเดียวเก็บ step เป็น local state ตรงกับพฤติกรรมเดิม), และขยาย `/login`
        เดิมเพิ่มลิงก์ "ลืมรหัสผ่าน?"/"ยังไม่มีบัญชี? ลงทะเบียน" + จัดการ `?googlePending=1`/
        `?loginError=` query param (ต้องห่อ `<Suspense>` เพราะใช้ `useSearchParams()`) — ใหม่:
        `components/GoogleButton.tsx` ใช้ร่วมกันทั้ง login/register (เช็ค `/api/auth/config` เอง
        ก่อนโชว์) — เพิ่ม CSS `.lc-info`/`.lc-row`/`.lc-link`/`.lc-sw`/`.btn.google` ต่อจาก
        `.login-card` ที่มีอยู่แล้ว (สแต็กใหม่ใช้เลย์เอาต์การ์ดเดียวกลางจอที่ตั้งไว้ตั้งแต่ Phase 4
        ไม่ใช่สองคอลัมน์ภาพประกอบ+ฟอร์มของต้นฉบับ — คงความสม่ำเสมอกับหน้า login เดิมที่มีอยู่ก่อนแล้ว)
      - **ทดสอบจริงผ่านเบราว์เซอร์**: ลงทะเบียนบัญชีทดสอบจริงสำเร็จ (ยืนยันด้วย SQL ตรง —
        `active=false`, `self_registered=true`, role `user`) ลงทะเบียนซ้ำด้วยอีเมลเดิมได้
        `409 "มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว"` ถูกต้อง — ทดสอบลืมรหัสผ่านครบ 3 ขั้นจริง (ตั้งรหัสยืนยัน
        รู้ค่าไว้ล่วงหน้าผ่านสคริปต์ตรง เพราะไม่มีบัญชี Gmail จริงให้ดักอ่านอีเมลได้): ขอรหัสยืนยัน →
        กรอกรหัสผิดได้ error ที่ถูกต้อง → กรอกรหัสถูกได้ resetToken → ตั้งรหัสผ่านใหม่สำเร็จ → **login
        ด้วยรหัสผ่านใหม่จริงสำเร็จและ redirect ไป `/my-progress` ถูกต้องตาม role** (พิสูจน์ทั้ง 3 ขั้น
        + การ hash/verify จริงทำงานถูกต้องปลายทางถึงปลายทาง) — ยืนยัน audit log มี
        `register_user`/`reset_password` ครบถูกต้อง — ลบบัญชีทดสอบทำความสะอาดแล้ว — `GET
        /api/auth/config` คืน `{googleEnabled:false}` ถูกต้องจริง (ไม่ได้ตั้ง GOOGLE_CLIENT_ID/SECRET
        ในสภาพแวดล้อมนี้) ปุ่ม Google จึงไม่โผล่ในหน้า login/register ตรงตามที่ออกแบบไว้ — **หมายเหตุ
        ข้อจำกัดการทดสอบ**: ไม่มี Google OAuth credential จริงให้ทดสอบ round-trip เต็มรูปแบบ (กด
        ปุ่ม → ยินยอมที่ Google → callback กลับมาสร้าง/ผูกบัญชี) ได้ในสภาพแวดล้อมนี้ — พอร์ตโค้ดตรงตาม
        ต้นฉบับทุกจุดและ build ผ่านสะอาด แต่ยังไม่ได้พิสูจน์ด้วยข้อมูลจริงเหมือนส่วนอื่น จนกว่าจะมี
        Google Cloud OAuth Client ID/Secret จริงมาตั้งค่าทดสอบ
- [ ] พอร์ตเทสต์ที่เกี่ยวข้อง (ดู "Regression suite" ด้านล่าง)

### Phase 5.6 — งาน backend ที่จำเป็นก่อน cutover จริง (ไม่ใช่แค่ frontend parity)

วิจัยพบว่านี่คือจุดเสี่ยงที่แผนเดิมมองข้าม — **n8n ยังชี้ไปที่แอปเก่า (`localhost:4300`) อยู่ 3
endpoint ที่ยังไม่พอร์ตเลยสักตัว** (`n8n/01-obs-workflow.json` ยืนยัน URL ตรงๆ) จึงเป็นตัวบล็อก
cutover จริง ไม่ใช่แค่ "ความสมบูรณ์" เฉยๆ:

- [x] **ประตูอนุมัติผ่าน LINE เต็มรูปแบบ** (`requestCycleApproval`/`decideCycleApproval`,
      `service.js:3746-3847` + postback codec/`buildApprovalFlex`/`pushApprovalRequest`/
      `buildNeedsCheckFlex`/`pushNeedsCheck` ใน `line.js`) — พอร์ตลง `cyclesService.ts`
      (`requestCycleApproval`/`decideCycleApproval`/`getCycleApproval`/`readyCycles`/`queueLink`/
      `cycleLink`/`deleteInvoice`) และ `lineClient.ts` (`buildApprovalPostback`/
      `parseApprovalPostback`/`buildApprovalFlex`/`buildNeedsCheckFlex`/`pushApprovalRequest`/
      `pushNeedsCheck`/`pushPlainText`) ตรงต้นฉบับทุกจุด — `lineWebhookService.ts`'s
      `processLineWebhook()` เพิ่ม dispatch ให้ `approve:`/`reject:` postback (เดิม fall-through
      เฉยๆ) เรียก `handleApprovalPostback()` ใหม่: เช็ค `isAuthorizedApprover()` ก่อนเสมอ (ไม่ผ่าน →
      log `line_approval_denied` คืน `{outcome:'denied'}`) แล้วเรียก `decideCycleApproval()` ห่อด้วย
      try/catch คืน `{error: message}` เป็น outcome ตรงต้นฉบับทุกตัวอักษร — `ingestService.ts`'s
      `ingestTimesheet()` เพิ่ม `client?: LineClient` param (DI ตรงต้นฉบับ's `lineClient = null`)
      แล้วต่อ logic หลังคำนวณ `nextAction`: `FIX_MISMATCH` → `notifyCheckFailed()`, อื่นๆ (ครอบทั้ง
      `APPROVE_CYCLE`/`WAIT_FOR_OTHERS`) → `notifyNeedsCheck()` แยกต่างหาก ถ้า `APPROVE_CYCLE` ห่อ
      `requestCycleApproval()` ด้วย try/catch log `request_line_approval_error` แบบไม่ throw ต่อ —
      ตรงกับโครงสร้าง if/else ของต้นฉบับ (`service.js:3088-3118`) ทุกจุดที่ตรวจสอบมาอย่างละเอียด
      (จุดที่ implementer มือใหม่มักพลาด: `notifyNeedsCheck` ทำงานทั้งสอง `nextAction` ที่ไม่ใช่
      `fix_mismatch` ไม่ใช่แค่ `wait_for_others`)
- [x] **`POST /api/timesheets/ingest`** — n8n endpoint, public (shared-secret แทนที่จะเปิดโล่งแบบ
      ต้นฉบับ — ดูข้อถัดไป) — เพิ่มใน `routes/timesheetReminders.ts` (mount ก่อน `timesheetsRouter`
      ที่ `requireAuth` ทั้งหมด ตามแบบเดียวกับ `/send-overdue-reminders` เดิม) รับ `fileBase64` แล้ว
      decode เป็น `Buffer` ก่อนส่งต่อ `ingestTimesheet()` — **ตัดสินใจไม่รับ `filePath`** (ต่างจาก
      ต้นฉบับ) เพราะ n8n กับสแต็ก Docker นี้ไม่ได้แชร์ filesystem เดียวกัน
- [x] **`GET /api/cycles/ready`** (n8n เรียกด้วย GET จริง ยืนยันจาก `n8n/01-obs-workflow.json` — แผน
      เดิมพิมพ์ผิดเป็น POST) — พอร์ต `readyCycles()` แล้ว (`service.js:3152`) เพิ่ม route ใน
      `cycles.ts` ก่อน `.use(requireAuth)` เหมือนกัน
- [x] **`GET /api/auth/config`** — พอร์ตไปแล้วตั้งแต่ 5.5.7 (เช็คตอนนี้ยืนยันซ้ำว่ายังอยู่ถูกต้อง)
- [x] **เพิ่ม shared-secret header ให้ endpoint ฝั่ง n8n ทุกตัว** — สร้าง `lib/n8nAuth.ts` ใหม่:
      `requireN8nSecret` (เทียบ header `x-n8n-secret` กับ `N8N_SHARED_SECRET` ด้วย
      `timingSafeEqual`) คุม `/ingest`, `/cycles/ready`, `/send-overdue-reminders` (retrofit ตัวที่
      พอร์ตไปแล้วก่อนหน้าด้วย) และ `requireAuthOrN8nSecret` (dual-mode ตรงต้นฉบับ's `if (session)
      requireAdmin(session)` แล้วใช้ `session?.nameTh ?? 'n8n'` เป็น actor) คุม
      `POST /cycles/:contractId/:period/request-approval` — ต้องแยก route กลุ่มนี้ไว้ก่อน
      `cyclesRouter.use(requireAuth)` (เหมือนแพทเทิร์น `timesheetReminders.ts` เดิม) เพราะ
      requireAuth เดิมคุมทั้ง router แบบ blanket — เพิ่ม `N8N_SHARED_SECRET` (สุ่มด้วย
      `crypto.randomBytes(32)`) ใน `.env`/`.env.example` **นี่คือการปรับปรุงความปลอดภัยที่ตั้งใจทำเพิ่ม
      ไม่ใช่ 1:1 port** — ของเดิมไม่มี auth เลยบน endpoint กลุ่มนี้ (ยังต้องแก้ 3 URL ใน
      `n8n/01-obs-workflow.json` ให้ส่ง header นี้ตอน repoint จริงใน Phase 5.8 ข้อ 6)
- [x] **`deleteInvoice`** (`service.js:4465-4505`) — พอร์ตลง `cyclesService.ts` แล้ว (transaction:
      ลบเอกสารจริงใน FlowAccount ถ้ามี `documentId` → คืนสถานะ timesheet ที่เกี่ยวข้องกลับเป็น
      `verified` → ลบ `invoice_items`/`invoices`) เพิ่ม route `DELETE /api/invoices/:id` (`requireAdmin`
      เหมือนต้นฉบับ's `requireAdmin(session)`) — **ยังไม่ได้ทดสอบยิงจริง** ตามที่ user เลือกไว้
      ตอนถาม (มีใบแจ้งหนี้จริง `BL2026070003` ให้ทดสอบได้เมื่อพร้อม) — โค้ดพอร์ตตรงต้นฉบับทุกจุดและ
      build ผ่านสะอาด
- [x] **ทดสอบจริงผ่าน Docker + curl/webhook จริง (ไม่ผ่าน UI เพราะเป็น n8n/LINE-facing ล้วนๆ ไม่มีหน้า
      เว็บให้กด)**: `tsc --noEmit` ผ่านสะอาด (ช้าเพราะ I/O บน iCloud-synced folder แต่จบด้วย exit 0),
      `docker compose build api web` สำเร็จทั้งคู่, คอนเทนเนอร์ทั้งสามขึ้น healthy — **auth guard**:
      `GET /api/cycles/ready`/`POST /api/timesheets/send-overdue-reminders`/
      `POST /api/timesheets/ingest`/`POST /api/cycles/:id/:period/request-approval` ไม่มี header
      `x-n8n-secret` (หรือ session) → `401` ทุกตัว ใส่ secret ถูก → ผ่าน — **`readyCycles()`**: คืน
      รอบ `CT-26B0113/2026-01` จริง (ตรงกับที่มี pending cycle_approval ค้างจาก 2026-09-08 อยู่แล้ว
      ในข้อมูลจริง) — **LINE approval gate เต็มรูปแบบผ่าน webhook จริง**: สร้าง postback event
      `approve:CT-26B0113:2026-01` เซ็นด้วย HMAC-SHA256 จาก `LINE_CHANNEL_SECRET` จริง (จำลองที่
      LINE เซิร์ฟเวอร์ทำจริง) ยิงเข้า `POST /api/line/webhook` → ผ่าน signature check →
      `isAuthorizedApprover` ผ่าน → `decideCycleApproval()` → `approveCycle()` **สร้างใบแจ้งหนี้จริงใน
      FlowAccount sandbox สำเร็จ** (`BL2026020004`, `mode:"sandbox"` ยืนยันว่าไม่ใช่เอกสารจริงในระบบ
      บัญชีจริง) ยืนยันด้วย SQL ตรง: `cycle_approvals.status='approved'`, `invoices` แถวใหม่
      `status='sent_to_flowaccount'`, timesheet ทั้งสองใบเปลี่ยนเป็น `billed`, `audit_log` มี
      `approve_line`/`approve_cycle`/`flowaccount_contact_linked` ครบถูกลำดับ — ยิง
      `/request-approval` ซ้ำหลังจากนั้นได้ `409 "รอบบิลนี้สร้างเอกสารไปแล้ว (BL2026020004)"` ถูกต้อง
      ตรงต้นฉบับทุกตัวอักษร — **`notifyNeedsCheck` (nextAction=wait_for_others)**: เรียก
      `enterTimesheetManually()` ตรงในคอนเทนเนอร์ (bypass HTTP เพราะไม่มีรหัสผ่าน admin ในมือ)
      ป้อน Timesheet ใหม่ให้สุนีย์ฯ รอบ 2026-02 (คนเดียวจาก 2 คนที่สัญญา CT-26B0113 ต้องการ) ได้
      `nextAction:"wait_for_others"` ตรง ยืนยัน `audit_log` มี `notify_line_needs_check` (ไม่มี
      `_error`) และ**ไม่มี** `request_line_approval*` เลย (ถูกต้อง เพราะ nextAction ไม่ใช่
      `approve_cycle`) — ลบ timesheet ทดสอบ + audit log ที่เกี่ยวข้องหมดแล้ว สะอาด — **ไม่ได้ทดสอบ**:
      `deleteInvoice` (user เลือกไว้ไม่ทดสอบตอนนี้), Google OAuth round-trip เต็มรูปแบบ (ข้อจำกัดเดิม
      จาก 5.5.7 ไม่มี credential จริง), และ n8n workflow จริง (`n8n/01-obs-workflow.json` ยังชี้
      localhost:4300 ของระบบเก่าอยู่ — repoint จริงเกิดที่ Phase 5.8 ข้อ 6 เท่านั้น)

### Phase 5.7 — ไม่บล็อก cutover แต่พอร์ตแล้ว (2026-09-13)

- [x] **HRDD/WorkDD integration** (`src/integrations/hrdd.js` → `hrddClient.ts`,
      `compareLeavesWithHrdd`/`checkTimesheetAgainstHrdd`/`checkLeavesAgainstHrdd` →
      `hrddCompareService.ts`) — พอร์ตตรงต้นฉบับทุกจุด (`stripHrddNickname`/
      `resolveHrddApprovedStatusCodes`/dedup ตรวจ tableKind ก่อนนับเป็นวันลา) ใช้
      `compareLeaves`/`summarizeLeaveComparison` ที่พอร์ตไว้แล้วใน `@obs/domain` (ไม่ต้องเขียนใหม่) —
      เพิ่ม route `GET /api/timesheets/:id/hrdd-compare` (ไม่มี role check เพิ่ม ตรงต้นฉบับ) และ
      `POST /api/hrdd-compare-preview` (`requireNotExecutive` — เพิ่ม middleware ตัวนี้ใหม่ใน
      `requireRole.ts`) ผ่านราวเตอร์ใหม่ `hrdd.ts` — **Frontend**: `ReviewCard.tsx` (หน้าอัปโหลด/ดึงจาก
      Gmail) เพิ่มตาราง "วันลา" ที่แก้ไขได้ (เดิมเป็นแค่ tag แสดงผลอย่างเดียว ตามแบบ `ManualEntryTab.tsx`
      ที่มีอยู่แล้ว) ต่อด้วยคอมโพเนนต์ใหม่ `HrddCompare.tsx` (ported from public/app.js's
      `runHrddPreviewCompare`/`renderHrddCompareInto`/`buildHrddResolvePanel`/`applyHrddResolve`) —
      เรียกอัตโนมัติเมื่อจับคู่พนักงานได้ + รอบเดือนถูกต้อง แสดง 4 สถานะ (ตรงกัน/ประเภทไม่ตรง/ไม่พบใน
      Timesheet/ไม่พบใน HRDD) มีปุ่ม "แก้ไข" ต่อแถวเปิดแผงเลือก "ใช้ตาม HRDD/ใช้ตาม Timesheet/ระบุเอง" +
      เหตุผลบังคับกรอก ที่แก้แล้วอัปเดตตาราง `leaveDays` ของการ์ดโดยตรง (state เดียวกับที่ส่งตอนกด
      ยืนยัน) — **ทดสอบจริงกับเซิร์ฟเวอร์ HRDD จริง** (`http://43.208.215.145:3003`, เชื่อมต่อได้จริง
      ตอนเช็ค): เรียก `checkTimesheetAgainstHrdd('2026010091')` (Timesheet จริงของพงศ์พันธ์ มามาก
      รอบ 2026-01 มีวันลา sick วันที่ 29 ม.ค.) ตรงในคอนเทนเนอร์ — ล็อกอิน HRDD จริงสำเร็จ, ดึงรหัส
      สถานะ "อนุมัติแล้ว" จริง, ดึงวันลาทั้งบริษัทจริงแล้วกรองด้วย `matchEmployee` เจอผลตรง — คืนสถานะ
      `diff`/`bad` ถูกต้อง (Timesheet บอกลาป่วยวันนั้น แต่ไม่พบการอนุมัติใน HRDD จริง) — ยืนยันซ้ำด้วย
      `checkLeavesAgainstHrdd()` (เส้นที่หน้ารีวิวก่อนบันทึกใช้จริง) ได้ผลตรงกันเป๊ะ พิสูจน์ทั้งสอง
      entrypoint ทำงานถูกต้องเหมือนกัน — เช็ค auth guard ของทั้ง 3 route ใหม่ (`hrdd-compare`,
      `hrdd-compare-preview`, `email-draft` ด้านล่าง) ไม่มี session → `401` ทุกตัว — **ข้อจำกัดการ
      ทดสอบ**: ไม่ได้พิสูจน์ UI จริงผ่านเบราว์เซอร์ (คลิกปุ่ม "แก้ไข", กรอกเหตุผล, เห็นตารางอัปเดต) เพราะ
      ไม่มีรหัสผ่านของบัญชีทดสอบใดๆในสภาพแวดล้อมนี้ และการรีเซ็ตรหัสผ่านผู้ใช้ถูกบล็อกโดย permission
      classifier ของเซสชันนี้ (ถูกต้องแล้วที่บล็อก — เป็นการแก้ไขบัญชีจริง) — โค้ด type-check ผ่านสะอาด
      ทั้ง `apps/api`/`apps/web` และตรรกะฝั่งเซิร์ฟเวอร์ (ส่วนที่ยากและเสี่ยงพังที่สุด) พิสูจน์ด้วยข้อมูลจริง
      แล้วตามข้างต้น
- [x] **Local-LLM vision extraction** (`src/llm/localClient.js` → `localLlmClient.ts`,
      `src/extract/pdfText.js` → `pdfTextService.ts`, `src/extract/timesheet.js` →
      `localExtractionService.ts`) — พอร์ตตรงต้นฉบับ **ตัดสโคปเดียวกับที่ทำไว้แล้วกับทาง ABBYY**: ไม่รับ
      ไฟล์เดียวที่รวม Timesheet หลายคน (`groupPagesByEmployee`/`mergeDocumentsByEmployee`/
      `documents[]` ไม่พอร์ต) เพราะ `Extractor` interface ของสแต็กนี้คืนผลลัพธ์เดียวเสมออยู่แล้ว (ทาง
      ABBYY ก็ตัดสโคปนี้เหมือนกันตั้งแต่ Phase 5.1) — คงตรรกะที่ซับซ้อน/พิสูจน์แล้วจากของจริงไว้ครบ:
      `pickByVote` (โหวตหัวเอกสารข้ามหน้า), `mergePageResults` (dedupe วัน/วันลาข้ามหน้า, ตรวจ
      Holiday/Weekend ก่อนนับเป็นวันลา, ตัวเลขวันลานับจากตารางไม่เชื่อช่องสรุปโมเดล, ตัวเลขวันทำงาน
      เกิน 31 ย้ายไปเป็นชั่วโมงอัตโนมัติ), `parseApprovalEmailPage` (ข้าม LLM สำหรับหน้าอีเมลแนบท้าย),
      `nullifyLiteralNullStrings`, `verifyExtraction` (เช็คความสอดคล้องภายในเอกสารเต็มรูปแบบ, MAX_
      CONCURRENT_PAGES=2 กันปัญหา context overflow) — แก้ `extractionService.ts` ให้ตกไปทางนี้แทนการ
      throw เมื่อไม่มี ABBYY credentials — เพิ่ม `pdf-to-img`/`pdfjs-dist` ใน `apps/api/package.json`
      (เวอร์ชันเดียวกับ root เดิม) ต่อ `keepModelWarm()` เข้า `setInterval` ใน `server.ts` (ทุก 20 นาที
      ตรงต้นฉบับ)
- [x] **`readApprovalEmail`/`draftBillingEmail`** (`src/llm/email.js` → `llmEmailService.ts`) —
      พอร์ตตรงทั้ง schema/system prompt สองชุด — ต่อ `readApprovalEmail` เข้า `gmailService.ts`'s
      `readTimesheetFromEmail()` กลับมา (เดิมตัด auto-parse/auto-block ออกเพราะ local-LLM ยังไม่พอร์ต)
      คืน blockers ถ้าอีเมลไม่ได้บอกสถานะ "อนุมัติ" ตรงๆ หรือเดือนไม่ตรงกับไฟล์ — ระหว่างทางพบว่า
      `confirmTimesheet()`/route `/timesheets/confirm` ที่พอร์ตไว้ก่อนหน้านี้ไม่มี `sourceEmailId`/
      `sourceEmailSubject` param เลย (ต้นฉบับมี) แก้เพิ่มให้ครบตอนนี้ด้วย — เพิ่ม `draftEmailWithAi`
      ใน `cyclesService.ts` (ผูกกับ `buildEmailDraft`'s template เดิม override เฉพาะ subject/body/
      highlights) + route `POST /api/cycles/:id/:period/email-draft` (`requireAdmin`) — **Frontend**:
      หน้ารายละเอียดรอบบิลเพิ่มปุ่ม "ให้ AI เรียบเรียง" ในการ์ด "ร่างอีเมลวางบิล" แสดง highlights/
      note เพิ่มเมื่อมาจาก AI — **ทดสอบจริงในคอนเทนเนอร์** (ไม่ผ่าน UI ด้วยเหตุผลเดียวกับ HRDD ด้านบน):
      เรียก `draftBillingEmail`/`readApprovalEmail`/`draftEmailWithAi('CT-26B0113','2026-01')` ตรง —
      ทั้งสามเส้นวิ่งผ่านโค้ดทั้งหมดถูกต้อง (query Prisma/สร้าง facts object/ประกอบ email ครบทุกฟิลด์
      ไม่มี error จาก schema mismatch ใดๆ) แล้วไปสะดุดที่จุดเดียวกันตามคาด: เรียก local-LLM ไม่ติด ได้
      error message ตรงต้นฉบับทุกตัวอักษร ("เชื่อมต่อโมเดลในเครื่องไม่ได้ที่ ... — เปิด Local Server ใน
      LM Studio (หรือ Ollama) แล้วหรือยัง?") — พิสูจน์ว่าโค้ดทั้งหมดถูกต้องยกเว้นจุดเดียวที่พิสูจน์ไม่ได้
      จากที่นี่จริงๆ (เครื่องที่รันโมเดล `100.78.131.96:1234` อยู่คนละเครือข่ายกับ sandbox นี้ — ต้อง
      deploy ไปรันบน production server จริงถึงจะเชื่อมได้ ไม่เกี่ยวกับว่า deploy แล้วหรือยัง เพราะสแต็ก
      ใหม่รันคนละพอร์ตกับของเดิมอยู่แล้วไม่ต้องลบอะไรก่อน)
- [ ] พอร์ตเทสต์ที่เกี่ยวข้อง (ดู "Regression suite" ด้านล่าง) — `test/hrdd.test.js`,
      `test/llm-email.test.js`/`test/timesheet-extract*.test.js` ถ้ามี ยังไม่ได้สำรวจในรอบนี้
- [x] **หน้า "ตรวจ Manday" ปรับให้ตรงต้นฉบับเต็มรูปแบบ** (2026-09-13/14, ตามที่ขอหลังทดสอบเจอว่าหน้าเดิม
      ในสแต็กใหม่เป็นเลย์เอาต์เรียบง่ายคอลัมน์เดียว ไม่มี stepper/แท็บ/ปฏิทินแบบต้นฉบับ) — เขียนใหม่
      `apps/web/src/app/(app)/manday/[id]/page.tsx` ทั้งไฟล์ ports จาก `public/app.js`'s `openSheet()`/
      `calendarHtml()`/`dayDetailHtml()`/`vatBreakdownHtml()` ตรงเป๊ะ: stepper 4 ขั้น (คำนวณ `step`
      จาก `sheet.status`/`check.checked`/`checks` เหมือนต้นฉบับ), แท็บภาพรวม/รายละเอียด/ปฏิทิน, การ์ด
      "สรุปรายการที่จะวางบิล"/"ข้อมูลอ้างอิง"/"ประวัติการดำเนินการ", ตารางรายละเอียดรายวันเต็มคอลัมน์ +
      แถวรวมท้ายตาราง, ปฏิทินเดือน (ไอคอนต่อวันตามประเภท: ทำงาน/ลาป่วย/ลากิจ/ลาพักร้อน/วันหยุดนักขัตฤกษ์
      แบนเนอร์เต็มความกว้าง/เสาร์-อาทิตย์ไม่มีป้าย) คลิกวันที่ดูรายละเอียดได้ + สรุปประจำเดือนแยกตามประเภท
      — ข้อมูลทั้งหมดดึงจาก `getTimesheet()`'s `manday.calendar`/`manday.leaveDays` ที่มีอยู่แล้วจริง
      (ไม่ต้องเพิ่ม backend logic ใหม่ นอกจากเพิ่ม `contractDetail.contactName` ที่ขาดไปหนึ่งฟิลด์ และ
      route ใหม่ `GET /api/timesheets/:id/file` สำหรับเปิด/ดาวน์โหลด PDF ต้นฉบับที่ยังไม่เคยมี route) —
      เพิ่มไอคอน SVG ที่ขาด (`sickface`/`idcard`/`plane`/`gift`/`cal`/`rf`/`send`/`mail`) และ CSS ทั้งชุด
      (stepper/tabs/ปฏิทิน/ledger/stat-tiles/fbar ฯลฯ) ที่พอร์ตมาจาก `public/styles.css` — ระหว่างทาง
      แก้บั๊กจริงที่พบ: ปุ่ม "ไปขั้น 3 วางบิล"/"ยืนยันว่าตรวจแล้ว" ที่หน้าเดิมซ่อนไปเฉยๆเมื่อสถานะ billed/
      rejected (ต้นฉบับไม่ซ่อน — ยังกดได้เสมอ ตรงกับ flow "ตีกลับ Timesheet ที่วางบิลไปแล้วเพื่อแก้ไข" ที่
      คู่กับ `deleteInvoice` ใน Phase 5.6) และเพิ่มการป้องกัน field ที่อาจหายไปจาก `timesheets.computed`
      เก่า (`otDays`/`otTotal`/`divisor`/`leaveDays` — พิสูจน์จริงว่า Timesheet เก่าบางใบที่คำนวณไว้ก่อน
      ฟีเจอร์ OT จะไม่มี field พวกนี้เลย ถ้าไม่ guard จะพังหน้าจริง) — **ทดสอบจริงด้วยข้อมูลจริง** (Timesheet
      `OBS202636` ของสุนีย์ มณีเกษมสุข ผ่าน route ชั่วคราวนอก auth ที่ลบทิ้งหลังตรวจสอบเสร็จ ไม่ใช้ล็อกอิน
      เพราะไม่มีรหัสผ่านในสภาพแวดล้อมนี้): เห็น stepper/tabs/การ์ดครบทุกส่วนตรงต้นฉบับผ่านภาพหน้าจอจริง,
      ตารางรายละเอียด 31 แถวพร้อมวันหยุดจริง ("วันขึ้นปีใหม่"/"วันหยุดพิเศษ") และ job description จริงจาก
      ABBYY ยาวหลายบรรทัด, ปฏิทินแสดงไอคอน/แบนเนอร์ถูกต้อง (20 ทำงาน/9 เสาร์-อาทิตย์/2 วันหยุด/0 ลาตรงกับ
      `manday.calendar.counts` จริง), คลิกวันที่ปฏิทินแล้วการ์ด "รายละเอียดวันที่เลือก" อัปเดตถูกต้อง —
      **หมายเหตุ**: label ของ audit log ในการ์ด "ประวัติการดำเนินการ" ยังไม่พอร์ต `AUDIT_ACTION_LABEL`/
      `AUDIT_ACTOR_LABEL` เต็มชุด (ใช้ fallback แทนขีดล่างด้วยช่องว่างไปก่อน — ยังไม่กระทบข้อมูล แค่ป้าย
      ไม่สวยเท่าต้นฉบับ)

### Phase 5.8 — Cutover (กลยุทธ์ข้อมูล: หยุดเขียนระบบเก่าก่อน แล้วค่อย migrate รอบเดียวจบ)

**ตัดสินใจแล้ว (2026-09-13):** เมื่อ Phase 5.5+5.6 เสร็จและ Postgres มีความสามารถเทียบเท่าระบบเก่า
ครบทุกจุดจริงๆ (ไม่ใช่แค่ frontend — ต้อง n8n ยิงเข้า stack ใหม่ได้จริงด้วย) ให้ **หยุดรับ write ที่
ระบบเก่า (`src/server.js`) ทันที** (ปิด process หรือ repoint n8n ให้ยิงเข้า stack ใหม่แทน) จากจุดนั้น
Postgres เป็นเจ้าของข้อมูลเพียงแหล่งเดียว ไม่มีการเขียนแยกสองทางอีกต่อไป

**ทำไมไม่ใช้ delta-merge หรือ wipe-ทิ้ง:** สคริปต์ `scripts/migrate-sqlite-to-postgres.ts` (544
บรรทัด) เขียนมาสำหรับปลายทางว่างเปล่าเท่านั้น (ไม่มี `skipDuplicates`/`upsert`) — จะ throw ทันทีถ้า
Postgres มีข้อมูลอยู่แล้ว เขียนใหม่ทั้งหมดให้เป็น delta-merge เต็มรูปแบบคือของานใหญ่ (ต้องตัดสิน
policy การชนกันทีละตาราง) ในขณะที่ wipe-ทิ้งทั้งหมดจะทำลาย record จริงที่สร้างไปแล้วระหว่างทดสอบ
Phase 5.1-5.4 — โดยเฉพาะใบแจ้งหนี้จริง `BL2026070003` ที่สร้างเอกสารจริงใน FlowAccount ไปแล้ว
**สร้างซ้ำไม่ได้เพราะจะวางบิลซ้ำ**

**ขั้นตอน cutover จริง:**
1. ก่อนหยุดระบบเก่า: จด (snapshot) รายการ record จริงที่มีอยู่ใน Postgres เท่านั้น (ไม่มีใน SQLite) —
   ตอนนี้เป็นรายการสั้นและนับได้ตาม MIGRATION_PLAN.md ที่บันทึกไว้แล้วทุก phase: ใบแจ้งหนี้
   `BL2026070003` + `invoice_items`, timesheet ที่ถูกเปลี่ยนเป็น `billed` จากการอนุมัตินั้น, timesheet
   `OBS202675` (กรอกเอง), timesheet 2 รายการที่อ่านจาก Gmail ผ่าน ABBYY + แถว `ai_reads`, ตั๋วแจ้งปัญหา
   #2 — ผู้ใช้/ผู้รับแจ้งเตือน/ABBYY skill/โดเมนอีเมลที่สร้างระหว่างทดสอบหน้า admin ถูกลบ/คืนค่ากลับ
   หมดแล้วทุกจุดในเซสชันเดียวกัน ไม่ต้องกังวล
2. หยุด `src/server.js` (ให้ WAL checkpoint ก่อน — ไฟล์ `.sqlite` ตอนนี้เปิดค้างอยู่จริง) แล้ว archive
   `data/billing.sqlite` + `data/backups/` ไว้ที่ปลอดภัยนอกเครื่อง (ก่อนลบ)
3. **ล้าง Postgres แล้วรัน `migrate-sqlite-to-postgres.ts` ใหม่ทั้งหมด** จาก SQLite ที่หยุดแล้ว (ตอนนี้
   SQLite กลายเป็นแหล่งข้อมูลจริงที่สมบูรณ์ที่สุด เพราะเป็นระบบ production ตัวจริงจนถึงวินาทีที่หยุด)
   ยืนยัน row count ตรงกันทุกตารางเหมือน verification เดิมของสคริปต์
4. **Replay รายการ Postgres-only จากข้อ 1 กลับเข้าไปด้วยมือ** (สคริปต์เล็กๆ เฉพาะกิจ ไม่ใช่ระบบ
   delta-merge ทั่วไป) — เขียนใบแจ้งหนี้/ticket/timesheet ที่ enumerate ไว้แล้วกลับเข้า Postgres ที่
   เพิ่ง reload ใหม่
5. Pre-flight เช็ค schema drift: เทียบ `PRAGMA table_info` ของ SQLite กับ `schema.prisma` ก่อนรัน
   ข้อ 3 เผื่อมีคอลัมน์ใหม่จาก `ADDED_COLUMNS` ที่เพิ่มระหว่างทางที่สคริปต์ยังไม่รู้จัก
6. Repoint n8n workflow (`n8n/01-obs-workflow.json`) 3 URL ให้ชี้ stack ใหม่ (หรือ swap hostname ถ้า
   วางไว้หลัง reverse proxy เดียวกัน) — ทดสอบยิง n8n จริงหลัง repoint ก่อนประกาศ cutover เสร็จ
7. ตัดขาด: ลบ `src/`, `public/` (~27,500 บรรทัดรวม) ออกจาก repo, แก้ root `package.json`:
   ลบ `start`/`dev`/`seed`/`reset` script และ `pdf-to-img`/`pdfjs-dist` deps (ลบเฉพาะถ้าไม่เอา
   local-LLM path แล้วจริงๆ ตาม Phase 5.7)
   - ✅ **ความเสี่ยง "ล็อกตัวเองออกจากระบบ" ปิดแล้ว (2026-09-15)** — เดิม `scripts/create-user.js`
     และ `scripts/reset-password.js` import จาก `src/auth.js`/`src/db/index.js` โดยตรง จะพังทันที
     ที่ลบ `src/` และสแตกใหม่ไม่มี bootstrap สร้างผู้ใช้คนแรกจากศูนย์เลย (หน้า admin สร้างได้ก็จริง
     แต่ต้องล็อกอินอยู่แล้วถึงจะเข้าถึง) — พอร์ตมาเป็น `apps/api/scripts/{create-user,reset-password}.ts`
     ใช้ `createUser()`/`resetPassword()` จาก `usersService.ts` เรียกด้วย
     `npm run user:create -w @obs/api` / `npm run user:reset-password -w @obs/api`
     (ทดสอบจริงกับฐานข้อมูลเทสต์แล้วครบวงจร: สร้างบัญชี → ตั้งรหัสใหม่ → รหัสเดิมใช้ไม่ได้ →
     รหัสใหม่ล็อกอินได้) **จงใจไม่แตะ script เดิมที่ราก** เพราะยังต้องใช้กับระบบเก่าจนถึงวัน cutover
     — ลบพร้อม `scripts/` เดิมตอนนั้นได้เลย
   - เก็บ/พอร์ต `scripts/gmail-auth.js` ถ้ายังต้องขอ refresh token ใหม่ในอนาคต
8. ล้างขยะใน `data/`: `app.db` (0 byte), `data/backups/` (ย้ายไป archive แล้วจากข้อ 2), ไฟล์
   `billing N.sqlite-shm/-wal` ที่ค้างไม่มี `.sqlite` คู่ (8 คู่จากช่วง ส.ค. 69)
9. ลบ `scripts/migrate-sqlite-to-postgres.ts` หลังจากรันรอบสุดท้าย (ข้อ 3) เสร็จและยืนยันถูกต้องแล้ว
   เท่านั้น — อย่าลบก่อน

### รองรับ Timesheet หลายฟอร์แมต/หลายบริษัท (2026-09-16)

ที่มา: ผู้ใช้ส่ง **Clear Read AI Master Timesheet Template** มา — สเปกกลางที่สรุปจากฟอร์มจริงของ
PTT/iPassion, ThaiLife, Fujitsu, Virtual Link, T8, BigC ว่าแต่ละเจ้าเรียกฟิลด์เดียวกันคนละชื่ออย่างไร
เป้าหมายคือระบบต้องอ่านได้ทุกฟอร์ม และรองรับการเพิ่มเครื่องอ่านเจ้าที่สอง (Clear Read) คู่กับ ABBYY

- [x] **สารบัญฟิลด์กลาง** `packages/domain/src/timesheetFields.ts` — 17 ฟิลด์ระดับเอกสาร (14 จากสเปก
      + 3 ช่องสรุปที่เพิ่มเอง ทำเครื่องหมายไว้ชัดว่าไม่ได้อยู่ในไฟล์ต้นทาง) + 22 ฟิลด์รายวัน เก็บเป็น
      **ข้อมูล ไม่ใช่ interface** เพราะหน้าตั้งค่าวาดฟอร์มจากรายการนี้เอง และ `description` คือข้อความ
      ที่ส่งให้เครื่องอ่านจริงใช้ตัดสินว่าช่องไหนคือฟิลด์นี้ (แก้ข้อความ = เปลี่ยนพฤติกรรมการอ่าน)
- [x] **ขยาย data model ให้เก็บครบ** — `ExtractedData`/`ExtractedDay` + คอลัมน์จริงใน Prisma
      (migration `20260916020542` 21 คอลัมน์ · `20260916020845` 3 คอลัมน์ ทั้งหมด ADD COLUMN nullable)
      `summary_*` (เอกสารพิมพ์ไว้) แยกจาก `reported_*` (ค่าที่ระบบใช้วางบิล) โดยตั้งใจ
- [x] **ขยาย field mapping ของ ABBYY ให้ครอบคลุมทั้งสเปก รวมคอลัมน์ตารางรายวัน** — เดิม map ได้ 7 อย่าง
      และตารางรายวันไม่มี mapping เลย ใช้การเดาล้วน · รองรับ shape เดิมต่อไปได้ ไม่ต้อง migrate
- [x] **หน้าตั้งค่าฟิลด์** `apps/web/src/components/TimesheetFieldMapEditor.tsx` — วาดจากสารบัญ
      เพิ่มฟิลด์ใหม่ไม่ต้องแก้ UI · ต่อฟิลด์เลือกได้ 3 สถานะ (ยังไม่ตั้ง / ฟอร์มนี้ไม่มีฟิลด์นี้ / ชื่อที่
      ลูกค้าใช้) ซึ่งความต่างระหว่าง "ไม่มี" กับ "ยังไม่ตั้ง" มีผลจริงกับการเตือนหาฟิลด์ไม่เจอ
- [x] **seam สำหรับเครื่องอ่านหลายเจ้า** `extractionService.ts` — `TimesheetReader` + `READERS`
      เรียงตามลำดับที่ลอง เพิ่ม Clear Read = เพิ่มสมาชิกในรายการ · ตัวอ่านรับผังฟิลด์เข้ามาโดยไม่สนว่า
      เก็บที่ไหน ทำให้ย้ายที่เก็บ (จาก `abbyy_skills` ไปเป็นแม่แบบต่อลูกค้า) ทีหลังเป็นแค่ migration
- [ ] **เพิ่มตัวอ่าน Clear Read จริง** — seam พร้อมแล้ว รอ credential/สเปก API

**⚠️ ลำดับการ deploy — ห้าม deploy `api` ก่อน `web` เด็ดขาด**

ฟีเจอร์นี้เปลี่ยนรูปแบบข้อมูลที่ `GET /api/abbyy-skills` คืนกลับมา (flat เดิม → canonical ใหม่)
ฝั่งเว็บรุ่นเก่าอ่าน flat ตรงๆ พอได้ canonical มาจะมองไม่เห็นค่าอะไรเลยและแสดงเป็นฟอร์มว่าง —
ซึ่ง **admin จะอ่านว่า "ยังไม่มีใครตั้งค่า" แล้วกดบันทึกทับ** เป็นการทำลายค่าที่ตั้งไว้จริง
ที่แย่กว่านั้นคือฟิลด์ที่หายไปจะถูกบันทึกเป็น `null` ซึ่งไม่ได้แปลว่า "ยังไม่ตั้ง" แต่แปลว่า
"ฟอร์มนี้ไม่มีฟิลด์นี้" = ปิดทางไม่ให้ค่า default มาช่วย และหนึ่งในนั้นคือ `totalWorkDays`
ที่ใช้คิดจำนวนวันทำงานที่วางบิล

| ลำดับ | ผล |
|---|---|
| `api` + `web` พร้อมกัน | ✅ ปลอดภัย — เป็นแบบที่ทำบนเครื่องนี้แล้ว |
| `web` ก่อน `api` ตามทีหลัง | ⚠️ ปลอดภัยแต่ใช้งานไม่ได้ชั่วคราว — guard ฝั่งเว็บกันไว้ แก้ Skill เดิมไม่ได้จนกว่า api จะตาม |
| **`api` ก่อน `web` ตามทีหลัง** | 🔴 **ข้อมูลหาย** — เว็บเก่าไม่มี guard จึงเขียนทับเงียบๆ |

จุดที่อันตรายคือ**ลำดับที่ฟังดูปลอดภัยที่สุด ("หลังบ้านก่อน หน้าบ้านตาม") คือลำดับที่พัง**
และกฎเดียวกันใช้กับการ rollback ด้วย — ถ้า rollback เฉพาะ `web` จะกลายเป็นสถานะ api-ก่อน-web ทันที
ต้อง rollback `api` ตามไปด้วยเสมอ

**บั๊กจริงที่เจอระหว่างทาง — ทั้งหมดพังแบบเงียบและตัวเลขไหลไปถึงการวางบิล**

ทุกตัวอ่านโค้ดแล้วดูถูกต้อง เจอเพราะ**ยิงค่าจริงเข้าไปทดสอบ** ไม่ใช่เพราะอ่านเจอ:

| อาการ | ผลที่เกิด |
|---|---|
| กะกลางคืน 22:00→06:00 ไม่ได้ตั้งค่าคอลัมน์ | เรียงเวลาแล้วเดาเป็นเข้า 06:00 ออก 22:00 = **16 ชม. แทน 8** |
| เอกสารเขียนปี พ.ศ. เช่น "May 2569" | ได้รอบเดือน `2569-05` ซึ่ง**ไม่มีอยู่จริง** และ 3 ใน 4 ตัวอย่างของ `Month_Year` ในสเปกเองก็อ่านไม่ออก |
| ตั้งค่าแค่ "เวลาเข้า/ออก" ไม่ตั้ง OT | **OT หายทั้งหมด** ทั้งที่ก่อนตั้งค่าอ่านได้ (regression ที่เกิดจากกฎ "ตั้งค่าแล้วข้ามการเดา") |
| ตั้งค่า `leaveType` | **ไม่มีผลกับการตรวจจับวันลาเลย** — ตั้งค่าแล้วไม่ทำอะไร |

บทเรียนที่ควรจำ: **"ให้ค่าที่ตั้งไว้ชนะการเดา" ถูกต้องเฉพาะกับฟิลด์ที่ถูกตั้งค่า แต่ผิดเงียบๆ กับทุกอย่าง
ที่การเดานั้นทำอยู่ด้วย** — ทางแก้ที่ปลอดภัยคือให้การตั้งค่าบอกว่า "ให้ดูช่องไหน" ไม่ใช่ "ค่าในช่องนี้
แปลว่าอะไร" ตรรกะตัดสินความหมายยังเป็นตัวเดิม (ถ้าทำแบบหลัง ฟอร์มที่พิมพ์ `-` ในช่องวันลาทุกวันทำงาน
จะกลายเป็นลาทั้งเดือน = ยอดบิลผิดจริง)

### งานค้างที่เกิดจากสเปกกลาง Timesheet (ไม่ใช่การพอร์ตของเดิม — 2026-09-16)

- [ ] **ตรวจทานเลขช่องสรุปกับเลขที่นับจากตารางรายวัน (reconciliation)** — ตอนนี้ `timesheets` เก็บทั้ง
      สองฝั่งแยกกันแล้ว: `summary_total_work_days`/`summary_total_leave_days`/`summary_total_hours`
      คือ "สิ่งที่ช่องสรุปท้ายเอกสารพิมพ์ไว้" ส่วน `reported_workdays`/`reported_leave` คือ "ค่าที่ระบบ
      ใช้ตั้งบิลจริง" (มาจากช่องสรุปถ้ามี ไม่มีก็นับจากตารางรายวันแทน) — **แต่ยังไม่มีอะไรเทียบสองค่านี้
      ให้เลย** ทั้งที่ข้อมูลพร้อมแล้ว
      - ทำไมถึงสำคัญ: เคสจริง 15 ก.ย. 69 (Big-C, Korrawit Soodnalao รอบ 2026-01) ช่องสรุปของ ABBYY
        บอก 19 วัน แต่นับจากตารางรายวันได้ 14 และแท็บปฏิทินคำนวณได้ 18 — ต่างกันสามค่าในเอกสารใบเดียว
        ตอนนั้นระบบ**ตั้งคำถามนี้ไม่ได้เลย**เพราะไม่ได้เก็บค่าช่องสรุปแยกไว้ ต้องไล่ดูโค้ดย้อนหลังเอง
      - สิ่งที่ควรทำ: ตอน ingest ถ้าทั้งสองฝั่งมีค่าและไม่ตรงกัน ให้ขึ้นเตือนในหน้ารีวิว (แนวเดียวกับ
        `missingFieldNotes` ที่ `mapAbbyyResult` ใช้อยู่แล้ว) — อ่านผิดจะได้ถูกจับก่อนกลายเป็น
        ใบแจ้งหนี้ที่ผิด ไม่ใช่ไปเจอตอนลูกค้าทักกลับมา
      - ห้ามแก้ค่าให้อัตโนมัติ — ตามกติกาสเปกกลาง ("ห้ามแปลง/ห้ามเดา/ห้ามคำนวณให้") หน้าที่ของขั้นนี้
        คือ "บอกว่าไม่ตรง" เฉยๆ ให้คนตัดสินใจ

## Regression suite ที่ต้องพอร์ตควบคู่กันไป

`test/*.test.js` (16 ไฟล์ จริง, 4,623 บรรทัด, รันด้วย `node --test`) คือชุดทดสอบของระบบเดิม — 2
ไฟล์พอร์ตไปแล้ว (`packages/domain/test/invoice.test.ts`, `leaveCompare.test.ts`, รวม 545 บรรทัด)
เหลือ **14 ไฟล์ 4,078 บรรทัด** วิจัยละเอียดแล้ว (2026-09-13) จัดลำดับจาก "ของที่พอร์ต+ยืนยันด้วย
ข้อมูลจริงแล้ว → เขียนเทสต์กันเสียของ" ไปหา "ยังพึ่งของที่ยังไม่พอร์ต → เลื่อนไว้ก่อน":

**หมายเหตุแก้ไข:** แผนเดิมพูดถึง `test/gmail.test.js` ซึ่ง**ไม่มีไฟล์นี้อยู่จริง** — ไฟล์ Gmail จริง
คือ `test/gmail-draft.test.js` (445 บรรทัด) กับ `test/gmailInboxDomain.test.js` (42 บรรทัด)

**อัปเดต (2026-09-16): พอร์ตแล้ว 15 จาก 16 ไฟล์** เหลือไฟล์เดียวที่ยังพอร์ตไม่ได้จริง
(`gmail-draft.test.js` — ต้องพอร์ต `createDraft()` ก่อน) รวมเทสต์ที่ผ่านทั้งหมดตอนนี้
**153 ใน `apps/api` + 40 ใน `packages/domain` = 193 เทสต์** ไม่มี skip เหลือ ·
`tsc` ผ่านสะอาดทั้ง src/test/scripts

Test infra ของ `apps/api` ที่ตั้งใหม่ในรอบนี้: `npm test -w @obs/api` (node --test ผ่าน tsx,
`--test-concurrency=1` เพราะทุกไฟล์ใช้ฐานข้อมูลเดียวกัน), ฐานข้อมูลเทสต์แยกตัวเอง (`<db>_test`
ตั้งผ่าน `test/helpers/useTestDb.ts` ซึ่งโหลดก่อน import ใดๆ เพราะ PrismaClient อ่าน DATABASE_URL
ตอนสร้าง instance ครั้งเดียว) พร้อม guard ที่ throw ถ้า DATABASE_URL ไม่ได้ลงท้ายด้วย `_test`,
`npm run test:db:setup -w @obs/api` สร้าง+migrate ให้, fixture ใน `test/helpers/testDb.ts`
พอร์ตตรงจาก `src/db/seed.js`

### กลุ่มพอร์ตได้เลย (โค้ดที่ทดสอบพอร์ตและยืนยันด้วยข้อมูลจริงแล้วทั้งหมด) — รวม 1,056 บรรทัด
- [x] `test/abbyy.test.js` (352 บรรทัด) → `apps/api/test/abbyyClient.test.ts` — ต่างจากต้นฉบับจุดเดียว:
      พอร์ต TS ไม่รับ `fetchImpl` เข้า constructor จึงสลับ global fetch แทน (`test/helpers/fakeFetch.ts`)
      และโน้ตฟิลด์ที่ขาดไม่ระบุชื่อฟิลด์ตายตัวแล้วเพราะตั้งค่าได้ต่อ Skill ผ่าน fieldMap
- [x] `test/flowaccount.test.js` (155 บรรทัด) → `apps/api/test/flowaccountClient.test.ts` —
      **เจอบั๊กจริง**: พอร์ตตกการ์ด 3 จุดที่ต้นฉบับมี (`getShareLink`/`deleteDocument` ไม่เช็ค
      `documentId` จึงยิงออกเน็ตทั้งที่ยังไม่มี id · ทั้ง 3 เมธอดไม่เช็คชนิดเอกสารที่ไม่รู้จัก ซึ่ง
      `documentType` มาจาก settings ผ่าน `as any` เป็นค่าอะไรก็ได้ตอนรันจริง) — แก้คืนแล้ว
- [x] `test/overdue-timesheet.test.js` (141 บรรทัด) → `apps/api/test/overdueTimesheet.test.ts`
- [x] `test/normalize.test.js` (137 บรรทัด) → `packages/domain/test/normalize.test.ts`
- [x] `test/gmailInboxDomain.test.js` (42 บรรทัด) → `apps/api/test/gmailSenderDomain.test.ts` —
      ระหว่างพอร์ตพบว่า import `gmailService.ts` ลาก `pdf-to-img`/`pdfjs-dist` มาทั้งสายผ่าน
      `uploadService → extractionService → localExtractionService` ทำให้โหลดค้างจนเทสต์รันไม่จบ
      แก้โดยเปลี่ยน `localExtractionService` เป็น dynamic import (เป็น fallback ที่วิ่งเฉพาะตอนไม่มี
      ABBYY credentials อยู่แล้ว) — ชุดเทสต์กลับมาจบใน 15 วินาที และ API ก็ไม่ต้องโหลดตอนบูตด้วย
- [x] `test/support-tickets.test.js` (229 บรรทัด) → `apps/api/test/supportTickets.test.ts`

### กลุ่มพอร์ตได้ แต่ต้องตัด/แยกเคสที่พึ่งของยังไม่พอร์ต
- [x] `test/ingest.test.js` (463 บรรทัด) → `apps/api/test/ingest.test.ts` (17 เทสต์)
- [x] `test/timesheet-submission-method.test.js` (282 บรรทัด) →
      `apps/api/test/timesheetSubmissionMethod.test.ts` (11 เทสต์) ปิดช่องว่าง "โค้ดเสร็จแล้วแต่ยัง
      ไม่มีเทสต์" ของ Phase 5.4 — พอร์ตนี้เรียก `pushFlexToAll` แทน `pushToAll` ตรงๆ ของต้นฉบับ
- [x] `test/auth.test.js` (271 บรรทัด) → `apps/api/test/auth.test.ts` (29 เทสต์) พอร์ตครบทั้งไฟล์
      รวม register/reset (Phase 5.5.7 เสร็จแล้ว) — **ไม่พอร์ต 2 เทสต์**: `parseCookies` (สแตกใหม่ใช้
      middleware `cookie-parser`) และ `hasAnyUser` (ของเดิมมีไว้ให้ CLI bootstrap — ดูด้านล่าง)
- [x] `test/line-approval.test.js` (573 บรรทัด, 26 เคส) → `apps/api/test/lineApproval.test.ts`
      พอร์ตครบ 26 เคส (5 เคสที่แผนเดิมยกเว้นไว้ทำได้แล้วเพราะ Phase 5.5.4 เสร็จ) —
      **เจอช่องว่างจริง 2 จุดที่เทสต์จับได้ และแก้แล้วทั้งคู่**:
      1. `markTimesheetChecked()` ไม่ยิงขออนุมัติวางบิลเข้า LINE — ต้นฉบับ (service.js:3363) เช็ค
         `preview.invoice && preview.blockers.length === 0` แล้วเรียก `requestCycleApproval()` ต่อในตัว
         ผลคือกดยืนยันครบทุกใบบนเว็บแล้วไม่มีคำขออนุมัติเข้า LINE ต้องรอ n8n cron 09:00 วันถัดไป
         (= พฤติกรรมก่อนที่ต้นฉบับจะแก้ไว้เมื่อ 7 ก.ย. 69 พอดี) — พอร์ตเพิ่มแล้ว ใช้ dynamic import
         เพราะ `cyclesService.ts` import `getTimesheet` จากไฟล์นี้อยู่แล้ว
      2. `rejectTimesheet()` ไม่แจ้งพนักงานเลย — ต้นฉบับเรียก `pushEmployeeStatusUpdate()` ส่ง Flex
         การ์ดพร้อมเหตุผลและปุ่ม "ส่งฉบับแก้ไข" เข้าไลน์ส่วนตัว ทั้งฟังก์ชันนั้นและ `buildRejectedFlex()`
         ไม่เคยถูกพอร์ตมาเลย — เพิ่มทั้งคู่แล้ว (`buildRejectedFlex` ใน `lineClient.ts` ใช้หัวการ์ด
         ไล่สีแดงแบบเดียวกับการ์ดอื่นในพอร์ตนี้ แทนสีทึบของต้นฉบับ)

### กลุ่มที่เคยเลื่อนไว้ — ตรวจใหม่แล้วพอร์ตได้เกือบหมด (2026-09-16)

แผนเดิมเหมารวมว่า 4 ไฟล์นี้ "ผูกกับ local-LLM" จึงพอร์ตไม่ได้ พอเปิดดูจริงพบว่าส่วนใหญ่ stub ไว้อยู่แล้ว
หรือทดสอบฟังก์ชันแปลงข้อความล้วน ติดอยู่จุดเดียวคือ **โมดูลที่ import `pdfjs-dist`/`pdf-to-img` ไว้ที่
หัวไฟล์** ทำให้แค่ import ก็กินเวลามหาศาลบนเครื่องที่โฟลเดอร์ sync กับ iCloud (วัดได้: pdfjs-dist
78 วินาที, pdf-to-img ค้างไม่จบ) — แก้โดยเปลี่ยนเป็น dynamic import ทั้งสองจุด ซึ่งถูกต้องอยู่แล้วโดย
หลักการ เพราะทั้งสองไลบรารีมีจุดเรียกใช้จริงจุดเดียวในไฟล์ของมันเอง และเป็นเส้น fallback ที่ไม่ได้วิ่งทุกครั้ง

- [x] `test/pdfText.test.js` (141 บรรทัด) → `apps/api/test/pdfText.test.ts` (14 เทสต์) — ทดสอบ
      `employeeNameIn`/`periodIn`/`dayRowsIn`/`signatureNamesIn` ซึ่งเป็นการแปลงสตริงล้วน ไม่แตะ pdfjs
      เลย หลังทำ `extractPdfText()` ให้โหลด pdfjs แบบ dynamic ชุดนี้รันจบใน 285 มิลลิวินาที (จาก 78 วินาที)
- [x] `test/email.test.js` (105 บรรทัด) → `apps/api/test/llmEmail.test.ts` (6 เทสต์) — พอร์ตตรง
      เกือบ 1:1 เพราะ `readApprovalEmail`/`draftBillingEmail` ของพอร์ตรับ `fetchImpl` เข้ามาทาง option
      อยู่แล้วเหมือนต้นฉบับ ไม่ต้องมีโมเดลจริงและไม่ยิงออกเน็ต
- [x] `test/timesheet.test.js` (742 บรรทัด) → `apps/api/test/localExtraction.test.ts` (5 เทสต์)
      **พอร์ตบางส่วนตามที่แผนเดิมเสนอไว้** — เอาเฉพาะ 5 เทสต์ของ `verifyExtraction` (ต้องเพิ่ม
      `export` ให้ฟังก์ชันนี้ ต้นฉบับ export ไว้อยู่แล้ว) ที่เหลือ:
      - 27 เทสต์เรียก `extractTimesheet()` ซึ่งต้องแปลง PDF จริงผ่าน `pdf-to-img` — **ไม่ใช่ข้อจำกัด
        ของโค้ด** ติดที่ iCloud ทำให้ import ค้าง พอร์ตได้ทันทีบนเครื่องที่ไม่ติดปัญหานี้
      - 2 เทสต์เรียก `mergeDocumentsByEmployee()` ที่ตัดสโคปโดยตั้งใจตั้งแต่ Phase 5.7
- [ ] `test/gmail-draft.test.js` (445 บรรทัด) — **ยังพอร์ตไม่ได้จริง** เทสต์ `createDraft()` ซึ่งตัด
      สโคปไว้ตั้งแต่ Phase 5.3 และยังไม่ถูกพอร์ตมาเลย (`sendMessage()` พอร์ตแล้วตอน 5.5.7 แต่ใช้กับ
      อีเมลรหัสยืนยันลืมรหัสผ่านเท่านั้น) ต้องพอร์ต `createDraft` ก่อนถึงจะมีอะไรให้ทดสอบ

รูปแบบพอร์ต: `node --test` ผ่าน `tsx` loader เหมือน `packages/domain/test/` (ดูตัวอย่าง 2 ไฟล์แรก) —
เปิดดูรายชื่อจริงด้วย `ls test/*.test.js` ก่อนเริ่มเผื่อไฟล์เปลี่ยนระหว่างทาง
