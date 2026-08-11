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
 * ปิงโมเดล vision เบาๆเป็นระยะ กันไม่ให้ LM Studio ปลดโมเดลออกจากหน่วยความจำตาม TTL ที่ไม่ได้ใช้งาน
 * (เจอจริงบนเซิร์ฟเวอร์ที่ใช้ LM Studio ร่วมกับระบบอื่น — ตั้ง jitModelTTL ไว้ 1 ชม. ถ้าไม่มีใครเรียกเลย
 * ในชั่วโมงนั้นโมเดลจะหลุด พอมาเรียกใหม่ต้องโหลดจากดิสก์ใหม่ ~30+ วินาที)
 *
 * ไม่แก้ที่ config ของ LM Studio (เครื่องนั้นใช้ร่วมกับระบบอื่น ไม่อยากไปยุ่ง) แก้จากฝั่งเราเอง
 * แทน — ส่ง request เล็กๆไปเป็นระยะให้โมเดลเห็นว่ามีการใช้งานอยู่ตลอด ผิดพลาดได้ก็แค่ log เงียบๆ
 * ไม่ throw เพราะนี่เป็นแค่งาน optimize ไม่ใช่งานที่ต้องรอผลจริง
 */
export async function keepModelWarm({ fetchImpl = fetch } = {}) {
  try {
    await callOnce({
      model: localVisionModel(),
      system: 'You are a health check. Reply with the JSON schema given.',
      userContent: 'ping',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      maxTokens: 30,
      fetchImpl,
    });
  } catch (error) {
    console.error(`[keepModelWarm] ปิงโมเดลไม่สำเร็จ (ไม่กระทบการทำงานหลัก): ${error.message}`);
  }
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
/* ต่อโมเดลไม่ติด/โมเดลตอบ 5xx เป็นอาการชั่วคราว — LM Studio สะดุดตอนสลับโมเดลหรือ
   หน่วยความจำเต็มชั่วขณะ แล้วกลับมาเองภายในไม่กี่วินาที ไม่ใช่ของเสียถาวร
   เจอจริงตอนอ่านไฟล์ 8 หน้า: หน้า 1, 2, 7 หลุดด้วย "fetch failed" ทั้งที่หน้าอื่นอ่านได้ปกติ
   ซึ่งทำให้ข้อมูลขาดไปครึ่งเอกสารโดยที่ผลลัพธ์ยังดู "อ่านสำเร็จ" */
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

/* ไม่มี timeout เดิมมาก่อน — ตอน dev เครื่อง LLM มีงานเดียวคือ OBS ช้าสุดก็แค่รอนาน
   แต่บนเซิร์ฟเวอร์จริง LM Studio ตัวนี้ใช้ร่วมกับงาน vision ของอีกระบบ (BSCP) ถ้ามันแน่น/ค้าง
   fetch() เปล่าๆจะรอเงียบไปเรื่อยๆไม่มีวันตัดสาย ปุ่ม "กำลังอ่าน" ค้างค้างชั่วนิรันดร์โดยไม่มี error ให้เห็นเลย
   ตั้งไว้ยาวเพราะภาพต่อหน้าจริงวัดได้ ~54 วินาที ไม่อยากตัดกลางคันตอนโมเดลกำลังทำงานอยู่จริงๆ */
const REQUEST_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function callLocalJSON(args) {
  let last;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(args);
    } catch (error) {
      last = error;
      // ลองซ้ำเฉพาะที่เป็นปัญหาการเชื่อมต่อ/ฝั่งเซิร์ฟเวอร์ ไม่ใช่คำตอบที่ผิดรูปแบบ
      if (!error.retryable || attempt === RETRY_ATTEMPTS) throw error;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw last;
}

async function callOnce({
  model, system, userContent, schema, maxTokens = 4000, fetchImpl = fetch,
}) {
  const baseUrl = localLlmBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', strict: true, schema },
        },
        /* โมเดลบางตัว (เช่น Gemma 3n) มีขั้น "คิดก่อนตอบ" ในตัว ซึ่งกับอินพุตยาวๆ
           มีโอกาสวนซ้ำคำเดิมไม่เลิกจนโควตาคำตอบหมดก่อนได้ตอบ JSON จริง (วัดแล้วว่าเกิดขึ้นจริง)
           ปิดขั้นนี้ตัดปัญหาทั้งสองอย่าง — เร็วขึ้น ~2-3 เท่า และไม่มีทางวนซ้ำ
           ฟิลด์นี้ไม่มีผลกับโมเดลที่ไม่รองรับ (เซิร์ฟเวอร์ปกติจะข้าม flag ที่ไม่รู้จักไปเฉยๆ) */
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(
        new Error(
          `โมเดลในเครื่องไม่ตอบภายใน ${REQUEST_TIMEOUT_MS / 1000} วินาที ที่ ${baseUrl} — ` +
          `เครื่องอาจกำลังทำงานหนัก (เช่นมีระบบอื่นแย่งใช้อยู่) หรือค้าง ลองใหม่อีกครั้ง`,
        ),
        { status: 504, retryable: true },
      );
    }
    throw Object.assign(
      new Error(
        `เชื่อมต่อโมเดลในเครื่องไม่ได้ที่ ${baseUrl} — ` +
        `เปิด Local Server ใน LM Studio (หรือ Ollama) แล้วหรือยัง? (${error.message})`,
      ),
      { status: 502, retryable: true },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`โมเดลในเครื่องตอบผิดพลาด (${res.status}): ${text.slice(0, 300)}`),
      { status: 502, retryable: res.status >= 500 },
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
