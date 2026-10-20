# Video Call 1-on-1 (Next.js 14 + PeerJS)

Video call P2P 1-on-1 murni frontend: tanpa backend, tanpa database. Video/audio mengalir langsung antar browser (WebRTC); signaling memakai cloud PeerJS gratis; STUN gratis Google.

## Setup

```bash
npx create-next-app@14 vc --ts --app --no-tailwind --eslint --no-src-dir --import-alias "@/*"
cd vc
npm install peerjs
npm run dev
```

(Repo ini sudah berisi semua file; cukup `npm install` lalu `npm run dev`, buka http://localhost:3000.)

## Cara tes

- **Satu laptop:** buka `http://localhost:3000` di tab 1, salin link, buka di tab 2 (atau jendela incognito).
- **Di HP:** kamera hanya jalan di HTTPS (atau localhost), jadi `http://IP-lokal:3000` **tidak** akan berfungsi. Deploy ke Vercel, atau jalankan `ngrok http 3000` dan pakai URL `https://` yang diberikan.

## Menambah TURN (opsional)

Jika koneksi langsung diblokir jaringan (NAT ketat, kantor, data seluler), tambahkan TURN. Buat `.env.local`:

```
NEXT_PUBLIC_TURN_URL=turn:turn.contoh.com:3478
NEXT_PUBLIC_TURN_USERNAME=user
NEXT_PUBLIC_TURN_CREDENTIAL=pass
```

Restart `npm run dev`. TURN hanya ditambahkan jika ketiga variabel terisi.

> Variabel `NEXT_PUBLIC_` ikut terkirim ke browser dan terlihat siapa saja. Oke untuk testing; untuk produksi gunakan kredensial sementara yang dibuat oleh server.
