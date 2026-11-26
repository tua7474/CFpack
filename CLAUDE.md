@AGENTS.md

# Deploy

โปรเจกต์ deploy บน **Railway** (https://cf-production-6234.up.railway.app)

## วิธี deploy
```
git push origin main
```
Railway เชื่อมกับ GitHub repo `tua7474/CFpack` — push แล้ว deploy อัตโนมัติ ไม่ต้องทำอะไรเพิ่ม

## หมายเหตุ
- สามารถใช้ `railway up` จาก CLI ได้เช่นกัน แต่ให้ใช้ `git push` เป็นหลัก
- ไม่ต้อง run build ก่อน Railway จัดการให้เอง
