"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";
import { ACCOUNTS, type Account } from "@/lib/accounts";
import { buildIceServers, mediaErrorMessage, peerErrorMessage } from "@/lib/call";

type Status = "starting" | "idle" | "calling" | "incoming" | "connecting" | "in-call" | "error";
type MsgType = "ring" | "accept" | "reject" | "cancel" | "busy" | "bye";

export default function AccountCall({ as }: { as?: string }) {
  const me = ACCOUNTS.find((a) => a.key === as);
  if (!me) return <Picker />;
  const other = ACCOUNTS.find((a) => a.key !== me.key)!;
  return <CallScreen me={me} other={other} />;
}

function Picker() {
  return (
    <main className="app">
      <div className="overlay">
        <div className="card">
          <h1>Masuk sebagai</h1>
          <p>Pilih akun demo. Buka akun yang berbeda di dua browser/perangkat, lalu telepon satu sama lain.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {ACCOUNTS.map((a) => (
              <a key={a.key} className="btn primary" href={`/akun?as=${a.key}`}>
                {a.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

type Actions = { call: () => void; accept: () => void; reject: () => void; cancel: () => void; hangup: () => void };

function CallScreen({ me, other }: { me: Account; other: Account }) {
  const [status, setStatus] = useState<Status>("starting");
  const [notice, setNotice] = useState("");
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const phaseRef = useRef<Status>("starting");
  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const ctrlRef = useRef<DataConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const actionsRef = useRef<Actions | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let iceTimer: ReturnType<typeof setTimeout> | null = null;

    const go = (s: Status) => {
      phaseRef.current = s;
      setStatus(s);
    };
    const clearTimers = () => {
      if (ringTimer) clearTimeout(ringTimer);
      if (connectTimer) clearTimeout(connectTimer);
      if (iceTimer) clearTimeout(iceTimer);
      ringTimer = connectTimer = iceTimer = null;
    };
    const send = (t: MsgType) => {
      const c = ctrlRef.current;
      if (c?.open) c.send({ t });
    };

    // Mengakhiri apa pun yang sedang berjalan dan kembali ke status idle.
    const finish = (msg: string, notify?: MsgType) => {
      if (notify) send(notify);
      clearTimers();
      const call = callRef.current;
      const ctrl = ctrlRef.current;
      callRef.current = null;
      ctrlRef.current = null;
      try {
        call?.close();
      } catch {}
      if (ctrl) {
        setTimeout(() => {
          try {
            ctrl.close();
          } catch {}
        }, 400); // beri waktu pesan terkirim
      }
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      setNotice(msg);
      go("idle");
    };

    const fail = (msg: string) => {
      if (cancelled) return;
      clearTimers();
      setNotice(msg);
      go("error");
    };

    const startConnectTimer = () => {
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (phaseRef.current === "connecting")
          finish("Gagal menyambungkan. Jaringan mungkin memblokir koneksi langsung.", "bye");
      }, 20000);
    };

    const attach = (call: MediaConnection) => {
      callRef.current = call;
      call.on("stream", (remote) => {
        if (callRef.current !== call) return;
        if (connectTimer) clearTimeout(connectTimer);
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remote;
          remoteVideo.current.play().catch(() => {});
        }
        go("in-call");
      });
      call.on("close", () => {
        if (callRef.current === call) finish("Panggilan selesai.", "bye");
      });
      call.on("error", () => {
        if (callRef.current === call) finish("Terjadi kesalahan pada panggilan.", "bye");
      });
      const pc = call.peerConnection;
      pc?.addEventListener("iceconnectionstatechange", () => {
        if (callRef.current !== call) return;
        const state = pc.iceConnectionState;
        if (state !== "disconnected" && iceTimer) {
          clearTimeout(iceTimer);
          iceTimer = null;
        }
        if (state === "failed") {
          finish("Koneksi gagal. Jaringan mungkin memblokir koneksi langsung.", "bye");
        } else if (state === "closed") {
          finish("Panggilan selesai.");
        } else if (state === "disconnected") {
          if (iceTimer) clearTimeout(iceTimer);
          iceTimer = setTimeout(() => {
            if (callRef.current === call && pc.iceConnectionState === "disconnected") {
              finish(`${other.name} terputus.`);
            }
          }, 5000);
        }
      });
    };

    const bindCtrl = (conn: DataConnection, stream: MediaStream, peer: Peer) => {
      conn.on("data", (d) => {
        if (ctrlRef.current !== conn) return;
        const t = (d as { t?: MsgType }).t;
        const phase = phaseRef.current;
        if (t === "ring" && phase === "idle") {
          go("incoming");
          setNotice("");
        } else if (t === "accept" && phase === "calling") {
          if (ringTimer) clearTimeout(ringTimer);
          go("connecting");
          startConnectTimer();
          attach(peer.call(other.peerId, stream));
        } else if (t === "reject") finish(`${other.name} menolak panggilan.`);
        else if (t === "busy") finish(`${other.name} sedang dalam panggilan lain.`);
        else if (t === "cancel") finish(`Panggilan dari ${other.name} dibatalkan.`);
        else if (t === "bye") finish(`${other.name} mengakhiri panggilan.`);
      });
      conn.on("close", () => {
        if (ctrlRef.current !== conn) return;
        finish(phaseRef.current === "in-call" ? `${other.name} terputus.` : `${other.name} membatalkan panggilan.`);
      });
      conn.on("error", () => {
        if (ctrlRef.current === conn) finish("Koneksi ke lawan bicara bermasalah.");
      });
    };

    const createPeer = (PeerCtor: typeof Peer, stream: MediaStream, attempt: number) => {
      const peer = new PeerCtor(me.peerId, { config: { iceServers: buildIceServers() } });
      peerRef.current = peer;

      peer.on("open", () => {
        if (cancelled) return;
        setNotice("");
        go("idle");
      });

      peer.on("connection", (conn) => {
        if (cancelled) return;
        if (conn.peer !== other.peerId || ctrlRef.current || phaseRef.current !== "idle") {
          conn.on("open", () => {
            conn.send({ t: "busy" });
            setTimeout(() => conn.close(), 500);
          });
          return;
        }
        ctrlRef.current = conn;
        bindCtrl(conn, stream, peer);
      });

      peer.on("call", (call) => {
        if (cancelled) return;
        if (phaseRef.current !== "connecting" || callRef.current || ctrlRef.current?.peer !== call.peer) {
          call.close();
          return;
        }
        call.answer(stream);
        attach(call);
      });

      peer.on("disconnected", () => {
        if (!cancelled && !peer.destroyed) peer.reconnect();
      });

      peer.on("error", (err) => {
        if (cancelled) return;
        if (err.type === "unavailable-id") {
          // Bisa berarti sisa sesi lama (Strict Mode / muat ulang) atau memang dipakai di tempat lain.
          peer.destroy();
          if (attempt < 4) {
            retryTimer = setTimeout(() => !cancelled && createPeer(PeerCtor, stream, attempt + 1), 1500);
          } else fail(peerErrorMessage("unavailable-id"));
          return;
        }
        if (err.type === "peer-unavailable") {
          if (phaseRef.current === "calling")
            finish(`${other.name} sedang offline. Minta ${other.name} membuka halaman akunnya dulu.`);
          return;
        }
        fail(peerErrorMessage(err.type));
      });

      actionsRef.current = {
        call: () => {
          if (phaseRef.current !== "idle") return;
          setNotice("");
          const conn = peer.connect(other.peerId, { reliable: true });
          ctrlRef.current = conn;
          bindCtrl(conn, stream, peer);
          go("calling");
          conn.on("open", () => {
            if (ctrlRef.current === conn) conn.send({ t: "ring" });
          });
          ringTimer = setTimeout(() => {
            if (phaseRef.current === "calling") finish(`${other.name} tidak menjawab.`, "cancel");
          }, 30000);
        },
        accept: () => {
          if (phaseRef.current !== "incoming") return;
          go("connecting"); // set dulu agar panggilan masuk dari peer tidak ditolak
          send("accept");
          startConnectTimer();
        },
        reject: () => finish("Panggilan ditolak.", "reject"),
        cancel: () => finish("Panggilan dibatalkan.", "cancel"),
        hangup: () => finish("Panggilan diakhiri.", "bye"),
      };
    };

    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (err) {
        fail(mediaErrorMessage(err));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      let PeerCtor: typeof Peer;
      try {
        PeerCtor = (await import("peerjs")).default;
      } catch {
        fail(peerErrorMessage("browser-incompatible"));
        return;
      }
      if (cancelled) return;
      createPeer(PeerCtor, stream, 0);
    })();

    return () => {
      cancelled = true;
      clearTimers();
      if (retryTimer) clearTimeout(retryTimer);
      try {
        callRef.current?.close();
        ctrlRef.current?.close();
      } catch {}
      callRef.current = null;
      ctrlRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      actionsRef.current = null;
    };
  }, [me, other]);

  const toggleTrack = useCallback((kind: "audio" | "video") => {
    const tracks = kind === "audio" ? streamRef.current?.getAudioTracks() : streamRef.current?.getVideoTracks();
    if (!tracks?.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = enabled));
    (kind === "audio" ? setMicOff : setCamOff)(!enabled);
  }, []);

  const act = (k: keyof Actions) => () => actionsRef.current?.[k]();

  const card = (() => {
    switch (status) {
      case "starting":
        return { title: "Menyiapkan akun", text: "Meminta izin kamera dan mikrofon, lalu masuk sebagai " + me.name + "…" };
      case "idle":
        return {
          title: `Halo, ${me.name}`,
          text: notice || `Kamu online. Tekan tombol di bawah untuk menelepon ${other.name}.`,
        };
      case "calling":
        return { title: `Memanggil ${other.name}…`, text: `Menunggu ${other.name} menjawab.` };
      case "incoming":
        return { title: `${other.name} menelepon`, text: "Terima panggilan ini?" };
      case "connecting":
        return { title: "Menghubungkan…", text: "Menyambungkan video dan suara." };
      case "error":
        return { title: "Terjadi masalah", text: notice };
      default:
        return null;
    }
  })();

  const inCallUI = status === "connecting" || status === "in-call";

  return (
    <main className="app">
      <video ref={remoteVideo} className="remote" autoPlay playsInline />

      {card && (
        <div className="overlay">
          <div className={`card ${status === "error" ? "error" : ""}`}>
            <h1>{card.title}</h1>
            <p aria-live="polite">{card.text}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {status === "idle" && (
                <>
                  <button type="button" className="btn primary" onClick={act("call")}>
                    Telepon {other.name}
                  </button>
                  <a className="btn" href="/akun">
                    Ganti akun
                  </a>
                </>
              )}
              {status === "calling" && (
                <button type="button" className="btn end" onClick={act("cancel")}>
                  Batalkan
                </button>
              )}
              {status === "incoming" && (
                <>
                  <button type="button" className="btn primary" onClick={act("accept")}>
                    Terima
                  </button>
                  <button type="button" className="btn end" onClick={act("reject")}>
                    Tolak
                  </button>
                </>
              )}
              {status === "error" && (
                <button type="button" className="btn primary" onClick={() => window.location.reload()}>
                  Muat ulang
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {status === "in-call" && (
        <p className="sr-only" aria-live="polite">
          Sedang berbicara dengan {other.name}.
        </p>
      )}

      <video
        ref={localVideo}
        className="local"
        autoPlay
        muted
        playsInline
        style={{ display: status === "starting" || status === "error" ? "none" : "block" }}
      />

      {inCallUI && (
        <div className="controls">
          <button type="button" className="btn" aria-pressed={micOff} onClick={() => toggleTrack("audio")}>
            {micOff ? "Nyalakan mic" : "Matikan mic"}
          </button>
          <button type="button" className="btn" aria-pressed={camOff} onClick={() => toggleTrack("video")}>
            {camOff ? "Nyalakan kamera" : "Matikan kamera"}
          </button>
          <button type="button" className="btn end" onClick={act("hangup")}>
            Akhiri panggilan
          </button>
        </div>
      )}
    </main>
  );
}
