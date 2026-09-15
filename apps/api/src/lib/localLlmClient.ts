/**
 * เรียกโมเดลภาษาที่รันในเครื่อง (LM Studio/Ollama) ผ่าน endpoint แบบ OpenAI-compatible — ported from
 * src/llm/localClient.js.
 *
 * ใช้ร่วมกันระหว่าง extractionService.ts (งาน vision — ทางสำรองเมื่อไม่ได้ตั้งค่า ABBYY) และ
 * llmEmailService.ts (งานข้อความล้วน — ร่าง/อ่านอีเมล)
 *
 * ใช้ response_format แบบ json_schema (มาตรฐานเดียวกับ OpenAI structured outputs) ให้เซิร์ฟเวอร์บังคับ
 * โครงสร้างให้ตรง schema เป๊ะ — ยังตรวจคีย์ที่จำเป็นซ้ำด้วยโค้ดอีกชั้นเป็นเกราะสำรอง
 *
 * หมายเหตุการพอร์ต (Phase 5.7): พอร์ตแบบ code-complete แต่ยังไม่ได้พิสูจน์ด้วยข้อมูลจริงในสภาพแวดล้อม
 * นี้ — เครื่องที่รันโมเดล (LOCAL_LLM_BASE_URL) เชื่อมต่อจากเซสชันนี้ไม่ได้ (คนละเครือข่ายกับ production
 * server ที่รันโมเดลจริงอยู่) ต้อง deploy ไปรันบนเครื่อง production จริงก่อนถึงจะทดสอบ end-to-end ได้
 */

export function localLlmBaseUrl(): string {
  return process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:1234/v1';
}

/** โมเดลข้อความล้วน — ใช้ร่าง/อ่านอีเมล */
export function localTextModel(): string {
  return process.env.LOCAL_LLM_MODEL ?? 'gemma-2-2b-it';
}

/** โมเดลที่รับภาพได้ — ใช้อ่าน PDF Timesheet (โมเดลข้อความล้วนธรรมดาทำไม่ได้) */
export function localVisionModel(): string {
  return process.env.LOCAL_LLM_VISION_MODEL ?? 'gemma-3-4b-it';
}

/**
 * ปิงโมเดล vision เบาๆเป็นระยะ กันไม่ให้ LM Studio ปลดโมเดลออกจากหน่วยความจำตาม TTL ที่ไม่ได้ใช้งาน —
 * ไม่แก้ config ของ LM Studio (เครื่องนั้นใช้ร่วมกับระบบอื่น) ส่ง request เล็กๆไปเป็นระยะแทน ผิดพลาดได้
 * ก็แค่ log เงียบๆ ไม่ throw เพราะเป็นแค่งาน optimize
 */
export async function keepModelWarm({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  try {
    await callOnce({
      model: localVisionModel(),
      system: 'You are a health check. Reply with the JSON schema given.',
      userContent: 'ping',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      maxTokens: 30,
      fetchImpl,
    });
  } catch (error: any) {
    console.error(`[keepModelWarm] ปิงโมเดลไม่สำเร็จ (ไม่กระทบการทำงานหลัก): ${error.message}`);
  }
}

export interface LocalLlmCallArgs {
  model: string;
  system: string;
  userContent: string | Array<Record<string, unknown>>;
  schema: Record<string, unknown> & { required?: string[] };
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface LocalLlmResult {
  data: any;
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/* ต่อโมเดลไม่ติด/โมเดลตอบ 5xx เป็นอาการชั่วคราว — ลองใหม่ 3 ครั้งเฉพาะข้อผิดพลาดที่ retryable */
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

export async function callLocalJSON(args: LocalLlmCallArgs): Promise<LocalLlmResult> {
  let last: any;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(args);
    } catch (error: any) {
      last = error;
      if (!error.retryable || attempt === RETRY_ATTEMPTS) throw error;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw last;
}

async function callOnce({
  model, system, userContent, schema, maxTokens = 4000, fetchImpl = fetch,
}: LocalLlmCallArgs): Promise<LocalLlmResult> {
  const baseUrl = localLlmBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
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
        // ปิดขั้น "คิดก่อนตอบ" ของโมเดลบางตัว (เช่น Gemma 3n) — กับอินพุตยาวมีโอกาสวนซ้ำคำเดิมไม่เลิก
        // จนโควตาคำตอบหมดก่อนได้ตอบ JSON จริง ปิดขั้นนี้เร็วขึ้นและไม่มีทางวนซ้ำ
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw Object.assign(
        new Error(`โมเดล AI ไม่ตอบภายใน ${REQUEST_TIMEOUT_MS / 1000} วินาที ที่ ${baseUrl} — ลองใหม่อีกครั้ง`),
        { status: 504, retryable: true },
      );
    }
    throw Object.assign(
      new Error(`เชื่อมต่อโมเดลในเครื่องไม่ได้ที่ ${baseUrl} — เปิด Local Server ใน LM Studio (หรือ Ollama) แล้วหรือยัง? (${error.message})`),
      { status: 502, retryable: true },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // "Context size has been exceeded" มาเป็น HTTP 400 แต่จริงๆเป็นอาการชั่วคราว — ต้อง retryable ด้วย
    const transientOverload = /context size has been exceeded/i.test(text);
    throw Object.assign(
      new Error(`โมเดล AI ตอบผิดพลาด (${res.status}): ${text.slice(0, 300)}`),
      { status: 502, retryable: res.status >= 500 || transientOverload },
    );
  }

  const body: any = await res.json();
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw Object.assign(new Error('โมเดล AI ไม่คืนข้อความกลับมา'), { retryable: true });
  }

  if (choice?.finish_reason === 'length') {
    throw new Error('ผลลัพธ์จากโมเดลถูกตัดเพราะยาวเกิน max_tokens — เพิ่มค่าแล้วลองใหม่');
  }

  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`โมเดล AI ตอบไม่เป็น JSON ที่ถูกต้อง: ${String(content).slice(0, 300)}`);
  }

  const missing = (schema.required ?? []).filter((key) => !(key in (data ?? {})));
  if (missing.length) {
    throw new Error(`โมเดล AI ตอบไม่ครบ ขาดคีย์: ${missing.join(', ')}`);
  }

  return { data, model: `local:${model}`, usage: body.usage ?? null };
}
