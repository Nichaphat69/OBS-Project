/**
 * ตัวเชื่อม S3 แบบเล็กที่สุดเท่าที่ระบบนี้ใช้จริง — PUT / GET / DELETE ออบเจ็กต์ทีละตัว เท่านั้น
 *
 * เขียนเองไม่ใช้ `@aws-sdk/client-s3` ด้วยเหตุผลเดียวกับที่ abbyyClient/flowaccountClient เขียนเอง คือ
 * ที่ต้องใช้จริงมีแค่สามคำสั่ง แต่ SDK ลากมาเป็นร้อยเมกะไบต์ และเครื่อง production มีแรม 1.9 GB
 * ที่แชร์กับระบบอื่นอยู่ — ตอน `npm ci` ในขั้น build เคยไม่พอมาแล้ว
 *
 * ลายเซ็นเป็น AWS Signature V4 ตามสเปกของ AWS เป๊ะ จึงใช้ได้กับทั้ง Garage (ที่ใช้อยู่บนเครื่อง)
 * และ Amazon S3 จริงโดยเปลี่ยนแค่ STORAGE_ENDPOINT/STORAGE_REGION
 */
import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const TIMEOUT_MS = 30_000;

export class StorageError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

export function hasStorageCredentials(): boolean {
  return Boolean(process.env.STORAGE_ENDPOINT && process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY);
}

const sha256hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/**
 * เข้ารหัสชื่อ key ตามกฎของ AWS ไม่ใช่ของ encodeURIComponent — ต่างกันสองเรื่องที่ทำให้ลายเซ็นไม่ตรง
 * ถ้าใช้ตัวมาตรฐาน: `!'()*` ต้องถูกเข้ารหัสด้วย ส่วน `/` ที่คั่นโฟลเดอร์ต้องปล่อยไว้
 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function signedHeadersFor(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string>,
  query: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const endpoint = process.env.STORAGE_ENDPOINT!;
  const bucket = process.env.STORAGE_BUCKET || 'obs-files';
  const region = process.env.STORAGE_REGION || 'garage';
  const accessKey = process.env.STORAGE_ACCESS_KEY!;
  const secretKey = process.env.STORAGE_SECRET_KEY!;

  const base = new URL(endpoint);
  const path = key ? `/${bucket}/${encodeKey(key)}` : `/${bucket}`;
  // ต้องเรียงชื่อพารามิเตอร์ตามตัวอักษรและเข้ารหัสทั้งชื่อและค่า ไม่งั้นลายเซ็นไม่ตรง
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');
  const url = `${base.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(payload);

  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };

  // ต้องเรียงชื่อ header ตามตัวอักษร และตัดช่องว่างหัวท้ายของค่า ไม่งั้นลายเซ็นไม่ตรง
  const sortedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = sortedNames.map((h) => `${h}:${String(headers[h] ?? '').trim()}\n`).join('');
  const signedHeaderList = sortedNames.join(';');

  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaderList, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const signingKey = ['aws4_request'].reduce(
    (k, part) => hmac(k, part),
    hmac(hmac(hmac(Buffer.from(`AWS4${secretKey}`, 'utf8'), dateStamp), region), SERVICE),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization =
    `${ALGORITHM} Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`;

  return { url, headers };
}

async function send(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  const { url, headers } = signedHeadersFor(method, key, payload, extraHeaders, query);
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, bytes: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  const res = await send('PUT', key, bytes, { 'content-type': contentType });
  if (!res.ok) throw new StorageError(`เก็บไฟล์ลง storage ไม่สำเร็จ (${res.status}) ${await res.text()}`, res.status);
}

/** คืน null เมื่อไม่มีออบเจ็กต์นั้น (404) — ให้ผู้เรียกไปอ่านจากคอลัมน์เดิมแทนได้ */
export async function getObject(key: string): Promise<Buffer | null> {
  const res = await send('GET', key, Buffer.alloc(0));
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageError(`อ่านไฟล์จาก storage ไม่สำเร็จ (${res.status})`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const res = await send('DELETE', key, Buffer.alloc(0));
  if (!res.ok && res.status !== 404) {
    throw new StorageError(`ลบไฟล์จาก storage ไม่สำเร็จ (${res.status})`, res.status);
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (v: string) => v.replace(/&(amp|lt|gt|quot|apos);/g, (_m, e: string) => XML_ENTITIES[e]);

export interface StoredObject {
  key: string;
  size: number;
}

/**
 * ไล่รายชื่อออบเจ็กต์ทั้งถัง — ใช้ ListObjectsV2 และตามหน้าต่อไปให้เองจนครบ
 *
 * แกะ XML ด้วย regex ไม่ใช่ตัว parser เต็มรูปแบบ เพราะคำตอบของ ListObjectsV2 มีโครงตายตัวและ
 * ระบบนี้ต้องการแค่สองช่อง — ไม่คุ้มที่จะลากไลบรารี XML เข้ามาเพื่อเท่านี้ (ค่า Key ที่มีอักขระพิเศษ
 * ถูก escape มาในรูป &amp; ฯลฯ จึงต้องแปลงกลับ ไม่งั้นชื่อไฟล์ที่มี & จะเพี้ยน)
 */
export async function listObjects(prefix = ''): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
    if (prefix) query.prefix = prefix;
    if (token) query['continuation-token'] = token;

    const res = await send('GET', '', Buffer.alloc(0), {}, query);
    if (!res.ok) throw new StorageError(`ไล่รายชื่อไฟล์ใน storage ไม่สำเร็จ (${res.status})`, res.status);
    const xml = await res.text();

    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
      if (!key) continue;
      out.push({ key: unescapeXml(key), size: Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0) });
    }

    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null)
      : null;
  } while (token);
  return out;
}
