/**
 * เรียกโมเดลภาษาที่รันในเครื่องผ่าน endpoint แบบ OpenAI-compatible
 * (LM Studio และ Ollama ต่างก็เปิด endpoint รูปแบบนี้ที่ POST {base}/chat/completions
 * จึงใช้โค้ดชุดเดียวกันได้กับทั้งคู่ แค่เปลี่ยน LOCAL_LLM_BASE_URL)
 *
 * ใช้ร่วมกันระหว่าง src/extract/timesheet.js (งาน vision — อ่าน PDF)
 * และ src/llm/email.js (งานข้อความล้วน — ร่าง/อ่านอีเมล)
 *
 * ใช้ response_format แบบ json_schema (มาตรฐานเดียวกับ OpenAI structured outputs) ให้
 * เซิร์ฟเวอร์บังคับโครงสร้างให้ตรง schema เป๊ะ — ทดสอบกับ LM Studio จริงแล้วว่ารองรับ
 * (⚠️ ต่างจาก response_format แบบ json_object เฉยๆ ที่ LM Studio "ไม่รองรับ" ปฏิเสธด้วย 400 ทันที)
 * ยังตรวจคีย์ที่จำเป็นซ้ำด้วยโค้ดอีกชั้นเป็นเกราะสำรอง เผื่อรันกับ backend อื่นที่ไม่บังคับ schema จริง
 */

export function localLlmBaseUrl() {
  return process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:1234/v1';
}

/** โมเดลข้อความล้วน — ใช้ร่าง/อ่านอีเมล */
export function localTextModel() {
  return process.env.LOCAL_LLM_MODEL ?? 'gemma-2-2b-it';
}

/** โมเดลที่รับภาพได้ — ใช้อ่าน PDF Timesheet (Gemma 2B ธรรมดาเป็น text-only ทำไม่ได้) */
export function localVisionModel() {
  return process.env.LOCAL_LLM_VISION_MODEL ?? 'gemma-3-4b-it';
}

/**
 * @param {object} args
 * @param {string} args.model
 * @param {string} args.system
 * @param {string|Array} args.userContent  string = ข้อความล้วน, Array = OpenAI content blocks (ใช้ตอนส่งภาพ)
 * @param {object} args.schema  JSON schema ที่ต้องการ — ฝังลง system prompt + ใช้ตรวจคีย์ที่ต้องมี
 * @param {number} [args.maxTokens]
 * @param {typeof fetch} [args.fetchImpl]  ใช้แทนตอนเทสต์เท่านั้น
 */
export async function callLocalJSON({
  model, system, userContent, schema, maxTokens = 4000, fetchImpl = fetch,
}) {
  const baseUrl = localLlmBaseUrl();

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', strict: true, schema },
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        `เชื่อมต่อโมเดลในเครื่องไม่ได้ที่ ${baseUrl} — ` +
        `เปิด Local Server ใน LM Studio (หรือ Ollama) แล้วหรือยัง? (${error.message})`,
      ),
      { status: 502 },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`โมเดลในเครื่องตอบผิดพลาด (${res.status}): ${text.slice(0, 300)}`),
      { status: 502 },
    );
  }

  const body = await res.json();
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error('โมเดลในเครื่องไม่คืนข้อความกลับมา');

  if (choice?.finish_reason === 'length') {
    throw new Error('ผลลัพธ์จากโมเดลถูกตัดเพราะยาวเกิน max_tokens — เพิ่มค่าแล้วลองใหม่');
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`โมเดลในเครื่องตอบไม่เป็น JSON ที่ถูกต้อง: ${String(content).slice(0, 300)}`);
  }

  const missing = (schema.required ?? []).filter((key) => !(key in (data ?? {})));
  if (missing.length) {
    throw new Error(`โมเดลในเครื่องตอบไม่ครบ ขาดคีย์: ${missing.join(', ')}`);
  }

  return { data, model: `local:${model}`, usage: body.usage ?? null };
}
