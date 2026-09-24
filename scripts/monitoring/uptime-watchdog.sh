#!/usr/bin/env bash
# เฝ้าดู web/api ของ OBS (ระบบใหม่) — เจ้าของระบบสั่ง 24 ก.ย. 69 ("ไม่มีระบบแจ้งเตือนถ้า container/
# เซิร์ฟเวอร์ล่ม") รันเป็น systemd timer ทุก 2 นาที (ดู obs-uptime-check.timer/.service ในโฟลเดอร์นี้)
#
# ⚠️ ข้อจำกัดที่ต้องรู้ไว้: สคริปต์นี้รันอยู่บนเครื่องเดียวกับที่ตรวจสอบ — ถ้าเครื่อง/เครือข่ายทั้งเครื่องล่ม
# (ไม่ใช่แค่ container) สคริปต์นี้ก็รันไม่ได้เหมือนกัน จึงแจ้งเตือนไม่ได้ในเคสนั้น เป็นการดักจับเฉพาะ
# "container พังแต่เครื่องยังไม่ตาย" (เคสที่เจอบ่อยที่สุดจริง) ถ้าอยากได้ตัวเฝ้าจากภายนอกเครื่องจริงๆ
# (ดักได้แม้เครื่องดับทั้งเครื่อง) ควรสมัครบริการฟรีอย่าง UptimeRobot/Better Stack เสริมอีกชั้นหนึ่ง
#
# อ่านค่าจาก .env ของสแต็กใหม่ตรงๆ (ตัวแปรเดิมที่ระบบมีอยู่แล้ว ไม่ต้องเพิ่มตัวแปรใหม่):
#   LINE_CHANNEL_ACCESS_TOKEN, LINE_APPROVER_TARGET (fallback เดียวกับ lineApproverTargets()
#   ใน notificationRecipientsService.ts — ใช้ตัวนี้เพราะไม่ต้องพึ่ง DB เลย ถ้า Postgres ก็ล่มไปด้วย
#   จะได้ยังแจ้งเตือนได้)
set -euo pipefail

ENV_FILE="${OBS_ENV_FILE:-/opt/outsource-auto-new/.env}"
STATE_DIR="${OBS_STATE_DIR:-/var/tmp/obs-uptime}"
WEB_URL="${OBS_WEB_URL:-http://localhost:3000/login}"
API_URL="${OBS_API_URL:-http://localhost:4301/api/health}"

mkdir -p "$STATE_DIR"

# ดึงเฉพาะ 2 ค่าที่ต้องใช้จาก .env แบบไม่ source ทั้งไฟล์ (กันตัวแปรอื่นใน .env ที่มี syntax แปลกๆ
# ทำให้ script พังไปด้วย)
line_token=$(grep -E '^LINE_CHANNEL_ACCESS_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)
line_target=$(grep -E '^LINE_APPROVER_TARGET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)

send_line() {
  local message="$1"
  if [ -z "$line_token" ] || [ -z "$line_target" ]; then
    echo "[uptime-watchdog] ไม่มี LINE_CHANNEL_ACCESS_TOKEN/LINE_APPROVER_TARGET ใน .env — ข้ามการแจ้งเตือน (log ไว้เฉยๆ): $message" >&2
    return
  fi
  curl -s -X POST https://api.line.me/v2/bot/message/push \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${line_token}" \
    -d "{\"to\":\"${line_target}\",\"messages\":[{\"type\":\"text\",\"text\":\"${message}\"}]}" \
    > /dev/null || true
}

check_one() {
  local name="$1" url="$2"
  local state_file="${STATE_DIR}/${name}.state"
  local prev="ok"
  [ -f "$state_file" ] && prev=$(cat "$state_file")

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$url" || echo "000")

  if [ "$code" = "200" ]; then
    if [ "$prev" = "down" ]; then
      send_line "✅ OBS: ${name} กลับมาทำงานปกติแล้ว ($(date '+%Y-%m-%d %H:%M:%S'))"
    fi
    echo "ok" > "$state_file"
  else
    if [ "$prev" = "ok" ]; then
      send_line "🔴 OBS: ${name} ไม่ตอบสนอง (HTTP ${code}) — เช็คด่วน! ($(date '+%Y-%m-%d %H:%M:%S'))"
    fi
    echo "down" > "$state_file"
  fi
}

check_one "web" "$WEB_URL"
check_one "api" "$API_URL"
