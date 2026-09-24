# Uptime watchdog (แจ้งเตือนผ่าน LINE ถ้า web/api ล่ม)

เช็ค `http://localhost:3000/login` (web) และ `http://localhost:4301/api/health` (api) ทุก 2 นาที
ถ้าตัวไหนตอบไม่ 200 ติดต่อกัน ส่ง LINE push แจ้งไปที่ `LINE_APPROVER_TARGET` ใน `.env` — พอกลับมาปกติ
จะส่งแจ้งอีกครั้งว่าหายแล้ว (ไม่สแปมซ้ำทุก 2 นาทีตอนยังล่มอยู่)

**ข้อจำกัด:** รันอยู่บนเครื่องเดียวกับที่ตรวจ — ถ้าทั้งเครื่อง/เครือข่ายล่ม จะแจ้งเตือนไม่ได้ ดักได้แค่เคส
container พังแต่เครื่องยังไม่ตาย (เคสที่เจอบ่อยสุด) แนะนำสมัคร UptimeRobot (ฟรี) เสริมอีกชั้นสำหรับดัก
เคสเครื่องดับทั้งเครื่อง — แค่สร้าง monitor ชนิด HTTP ชี้ไปที่ URL production จริง ไม่ต้องติดตั้งอะไรเพิ่ม

## ติดตั้งบนเซิร์ฟเวอร์ (ครั้งเดียว)

```bash
sudo cp scripts/monitoring/obs-uptime-check.service /etc/systemd/system/
sudo cp scripts/monitoring/obs-uptime-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obs-uptime-check.timer

# เช็คว่าทำงานจริง
sudo systemctl status obs-uptime-check.timer
sudo journalctl -u obs-uptime-check.service -n 20
```

ต้องมี `LINE_CHANNEL_ACCESS_TOKEN` และ `LINE_APPROVER_TARGET` ตั้งไว้ใน `.env` ของสแต็กแล้ว (ตัวแปร
เดิมที่ระบบมีอยู่แล้ว ไม่ต้องเพิ่มใหม่) — ถ้ายังไม่มี `LINE_APPROVER_TARGET` script จะ log เฉยๆ ไม่ error
