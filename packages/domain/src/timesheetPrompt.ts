/**
 * คำสั่งกลางสำหรับเครื่องอ่าน Timesheet — Clear Read AI Master Timesheet Prompt V4
 *
 * ที่มา: ไฟล์ Clear_Read_Timesheet_Master_AI_Prompt_V4_FINAL.txt ที่เจ้าของระบบส่งมา 17 ก.ย. 69
 * คู่กับ Clear_Read_AI_Master_Timesheet_Template_V4_FINAL.docx หมวด 8 ("COPY-READY MASTER AI PROMPT")
 * ซึ่งเขียนกำกับไว้เองว่า prompt นี้ต้องวาง "ก่อนคำสั่งสกัดข้อมูล และถือว่าสำคัญกว่าถ้อยคำในเอกสารต้นทาง"
 *
 * ทำไมอยู่ใน @obs/domain ไม่ใช่ในตัวอ่านเจ้าใดเจ้าหนึ่ง:
 * เครื่องอ่านสามเจ้ารับคำสั่งคนละทางกัน แต่ต้องได้กติกาชุดเดียวกัน ไม่งั้นเอกสารใบเดียวกันจะให้ผลต่างกัน
 *   - โมเดลในเครื่อง  ต่อ prompt นี้เข้ากับ system prompt ตรงๆ (มีผลทันที)
 *   - Clear Read      คำสั่งอยู่ใน schema_json ของแม่แบบฝั่งผู้ให้บริการ ไม่ได้ส่งไปกับ request
 *                     (`/agent/read` รับแค่ template_id/project_id/image_file) — ข้อความชุดนี้จึงมีไว้
 *                     ให้เทียบและคัดลอกไปวางในแม่แบบ หรือให้ระบบพุชขึ้นไปผ่าน `/update/template`
 *   - ABBYY Vantage   ทำงานด้วย Skill ที่เทรนไว้ ไม่รับ prompt — ใช้ชุดนี้เป็นเกณฑ์ตอนตั้งค่า fieldMap
 *
 * ⚠️ ข้อความนี้เปลี่ยนพฤติกรรมการอ่านจริง ไม่ใช่คอมเมนต์ — แก้แล้วผลการอ่านเปลี่ยน
 */

/** เวอร์ชันของสเปก ใช้บอกผู้ใช้ว่าแม่แบบฝั่งผู้ให้บริการตรงกับที่ระบบคาดไว้หรือยัง */
export const TIMESHEET_PROMPT_VERSION = 'V4';

export const TIMESHEET_MASTER_PROMPT = `CLEAR READ AI — MASTER TIMESHEET EXTRACTION PROMPT V4

CORE RULE
Every field name in the schema must be unique. Never create, reference, or output two fields with the same field name, even if they belong to different levels or tables. Field scope must be distinguished by the field name itself.

HOURS FIELD RULE
1. Daily_Total_Hours = total working duration for ONE specific daily Timesheet row.
2. Monthly_Total_Hours = total working hours for the ENTIRE reporting month or reporting period, explicitly shown in a summary/total section.
3. Never use the field name Total_Hours. It is intentionally replaced by two unique fields above.
4. Daily source labels such as Total, Working Hrs., Duration as hour, Time Used, or equivalent map to Daily_Total_Hours only when the value belongs to one date/row.
5. Monthly/period source labels such as Total Hours, Total Duration, Monthly Total, or equivalent map to Monthly_Total_Hours only when the value belongs to the summary/period level.
6. Never copy the same daily value into Monthly_Total_Hours. Never copy a monthly/period total into Daily_Total_Hours.
7. Do not calculate Monthly_Total_Hours by summing daily values unless downstream processing explicitly requires calculation.

SITE FIELD RULE
1. Document_Site is the only document/header-level site field.
2. Daily_Site is the only daily-row site field.
3. Do not use the field name Site anywhere in the schema because field names must be globally unique.
4. Place, Location, Office, Branch, Customer Site, or similar source labels map to Document_Site or Daily_Site according to their scope.
5. Work_Location is reserved for working arrangement such as WFH, Remote, On-site, or Office and is not a physical site.

LEAVE / SICK FIELD RULE
1. Total_Leave_Sick_Days = one combined source field such as "Leave / Sick (days)" or "Leave/Sick days".
2. Total_Leave_Days = separate total leave days when the source explicitly provides it.
3. Total_Sick_Days = separate sick-leave days when the source explicitly provides it.
4. Do not copy one combined Leave/Sick value into both Total_Leave_Days and Total_Sick_Days.

OTHER SEMANTIC MAPPING RULES
- Normal In / In / IN / Clock In / Start Time -> Time_In
- Normal Out / Out / OUT / Clock Out / End Time -> Time_Out
- Normal / Regular Hours / Base Hours / daily Base Duration -> Normal_Hours
- OT / OverTime / Overtime Hours -> OT_Hours only when clearly overtime
- Daily Total / Working Hrs. / Duration as hour -> Daily_Total_Hours when daily
- Total OT / OT Total / OverTime total -> Total_OT_Hours when monthly/period total
- Total Duration (monthly/period) -> Monthly_Total_Hours when it represents the same total-hours concept
- Base Duration (monthly) -> Total_Normal_Hours when it represents regular/base monthly hours
- Leave / Sick (days) -> Total_Leave_Sick_Days
- Total Leave / Leave days -> Total_Leave_Days
- Sick Leave days / Total Sick -> Total_Sick_Days
- Place -> Daily_Site when it is a physical location in a daily row
- Remote / WFH / On-site / Office arrangement -> Work_Location
- Approver / Approved By / Approver Name -> Approved_By_Name
- Resource Signature / Employee Signature -> Employee_Signature_Name when signer is the recorded employee/resource
- Details -> Job_Description only when Details is the work-detail field

ROW INTEGRITY
Keep every daily source row intact. Values from the same source row must stay together, especially Date, Day, Project, time, hours, Job Description, location, leave/status, and references. Do not merge rows, split rows incorrectly, shift values between rows, or reorder rows.

DESCRIPTION RULES
Job_Description must preserve the complete source text exactly, including Thai/English, punctuation, line breaks, URLs, PR links, ticket IDs and multiple activities. Do not summarize, translate, shorten or rewrite it. If the source has one combined Job Description / Remark cell, keep the whole cell in Job_Description and do not duplicate it into Remarks.

SOURCE FIDELITY
Preserve original values. Do not translate, summarize, rewrite, truncate, normalize, or invent information. If a field is absent or not explicitly shown, leave it empty. Do not infer leave from blank hours.

SCOPE CHECK BEFORE MAPPING
Before assigning any value, determine whether it belongs to:
- document/header level
- one daily Timesheet row
- monthly/reporting-period summary
- signature/approval level
Then select the unique canonical field for that scope.

QUALITY CHECK BEFORE RETURNING DATA
1. Every daily row from the source is represented.
2. Date/Day alignment is correct for each row.
3. Time In/Out are not swapped.
4. Daily_Total_Hours is not confused with Monthly_Total_Hours.
5. OT is only captured where explicitly identified.
6. Leave/Sick summary values are not duplicated across combined and separate fields.
7. Job_Description text is complete and not summarized.
8. Daily_Site and Work_Location are not mixed.
9. URLs and ticket IDs are preserved.
10. Empty source fields remain empty.`;

/**
 * ชื่อฟิลด์ที่ V4 สั่งห้ามใช้ พร้อมชื่อที่ต้องใช้แทน — ใช้ทั้งตอนเทสสารบัญและตอนเตือนคนตั้งค่า
 * ทั้งสองตัวคือชื่อที่เคยถูกใช้ซ้ำสองระดับ ซึ่งเป็นเหตุผลที่ V4 ออกกติกา CORE RULE ขึ้นมา
 */
export const FORBIDDEN_FIELD_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Total_Hours: 'Daily_Total_Hours (ระดับแถว) หรือ Monthly_Total_Hours (ช่องสรุป)',
  Site: 'Document_Site (ระดับเอกสาร) หรือ Daily_Site (ระดับแถว)',
});
