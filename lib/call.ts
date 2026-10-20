export function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const url = process.env.NEXT_PUBLIC_TURN_URL;
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (url && username && credential) servers.push({ urls: url, username, credential });
  return servers;
}

export function mediaErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError")
    return "Izin kamera dan mikrofon ditolak. Aktifkan lewat ikon di address bar, lalu muat ulang halaman.";
  if (name === "NotFoundError") return "Kamera atau mikrofon tidak ditemukan. Pastikan perangkat terpasang.";
  return "Tidak bisa mengakses kamera/mikrofon. Mungkin sedang dipakai aplikasi lain — tutup aplikasi itu lalu muat ulang.";
}

export function peerErrorMessage(type: string): string {
  switch (type) {
    case "peer-unavailable":
      return "Link sudah tidak aktif. Minta link baru ke lawan bicara.";
    case "unavailable-id":
      return "Akun ini sedang dipakai di tab atau perangkat lain. Tutup yang lain lalu muat ulang.";
    case "browser-incompatible":
      return "Browser tidak mendukung video call. Gunakan Chrome, Safari, atau Firefox versi terbaru.";
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":
      return "Server penghubung tidak bisa dihubungi. Periksa koneksi internet Anda lalu coba lagi.";
    default:
      return "Terjadi kesalahan koneksi. Muat ulang halaman lalu coba lagi.";
  }
}
