export type Account = { key: string; name: string; peerId: string };

// Akun demo tetap (tanpa password, tanpa backend). peerId dibuat unik agar
// tidak bentrok dengan pengguna lain di server PeerJS publik.
export const ACCOUNTS: Account[] = [
  { key: "andi", name: "Andi", peerId: "vctest-hs2903-andi" },
  { key: "budi", name: "Budi", peerId: "vctest-hs2903-budi" },
];
