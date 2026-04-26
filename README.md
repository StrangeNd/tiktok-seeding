# TikTok Seeding Platform

Bộ công cụ quản lý / nuôi tài khoản TikTok Việt Nam và cung cấp dịch vụ seeding (mắt live, comment, tim, click giỏ hàng, view video) trên hạ tầng **7 máy dual-Xeon + GPM antidetect browser**.

> Đây là tài liệu khung (skeleton). Code thật sẽ được build theo các phase trong `docs/PLAN.md`.

---

## Tài nguyên hiện có

| Loại | Cấu hình |
|---|---|
| Server | 7 × Dual Xeon, mỗi máy chạy ổn định **60 tab Chrome** → tổng **420 profile concurrent** |
| Network | 3 dải IP công cộng độc lập |
| Antidetect | GPM Login + GPM Automate + GPM Runtime (×7 license) |
| Proxy | (chưa có — sẽ bổ sung mix DC + Residential VN) |
| Account pool | (chưa có — module reg + farm sẽ tự xây) |

## Mục tiêu sản phẩm

1. **Quản lý profile/account** TikTok VN tập trung (master) trên 7 máy.
2. **Nuôi acc tự động** (warmup hằng ngày: scroll FYP, like, follow, watch).
3. **Nhận order seeding**: mắt live, comment live, tim, click sản phẩm, view video.
4. **Reg account tự động** khi pool cạn.
5. **Dashboard** theo dõi: queue, success rate, acc health, tồn kho.

## Cấu trúc repo

```
tiktok-seeding/
├── docs/                      # Tài liệu thiết kế (đọc trước khi code)
│   ├── PLAN.md                # Roadmap + scope đầy đủ
│   ├── ARCHITECTURE.md        # Kiến trúc kỹ thuật
│   ├── MODULES.md             # Breakdown từng module
│   ├── SCHEMA.md              # DB schema
│   └── OPERATIONS.md          # Deploy + vận hành 7 máy
├── packages/
│   ├── shared/                # Type, util, constant dùng chung
│   ├── gpm-client/            # Wrapper GPM Runtime API
│   └── tiktok-actions/        # Thư viện action TikTok (live view, like, comment...)
├── apps/
│   ├── master/                # Orchestrator: API + queue + DB
│   ├── worker/                # Agent chạy trên từng máy, pull job → automate
│   └── dashboard/             # Web UI quản lý (Next.js)
└── scripts/                   # Tool vặt: seed DB, import acc, health-check
```

## Bắt đầu

Đọc theo thứ tự:

1. `docs/PLAN.md` — bức tranh tổng + roadmap.
2. `docs/ARCHITECTURE.md` — luồng dữ liệu + tích hợp GPM.
3. `docs/MODULES.md` — chi tiết từng module.
4. `docs/SCHEMA.md` — DB schema.
5. `docs/OPERATIONS.md` — vận hành cluster.

## Disclaimer

Dự án phục vụ mục đích nghiên cứu vận hành infrastructure automation. Người sử dụng tự chịu trách nhiệm tuân thủ ToS của các nền tảng.
