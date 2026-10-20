"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import { buildIceServers, mediaErrorMessage, peerErrorMessage } from "@/lib/call";

type Status = "starting" | "waiting" | "connecting" | "in-call" | "ended" | "error";

const TITLES: Record<Status, string> = {
  starting: "Menyiapkan panggilan",
  waiting: "Menunggu lawan bicara",
  connecting: "Menghubungkan…",
  "in-call": "Sedang berbicara",
  ended: "Panggilan selesai",
  error: "Terjadi masalah",
};

export default function VideoCall() {
  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState("Meminta izin kamera dan mikrofon…");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(true);
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const joinId = new URLSearchParams(window.location.search).get("join");
    const host = !joinId;
    setIsHost(host);

    const clearConnectTimer = () => {
      if (connectTimer.current) {
        clearTimeout(connectTimer.current);
        connectTimer.current = null;
      }
    };

    const clearDisconnectTimer = () => {
      if (disconnectTimer.current) {
        clearTimeout(disconnectTimer.current);
        disconnectTimer.current = null;
      }
    };

    // Hanya mengakhiri panggilan yang sedang aktif.
    const endCall = (call: MediaConnection, msg: string) => {
      if (callRef.current !== call) return;
      callRef.current = null;
      clearDisconnectTimer();
      clearConnectTimer();
      try {
        call.close();
      } catch {}
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      if (host) {
        setStatus("waiting");
        setMessage(`${msg} Link Anda masih aktif — bagikan lagi untuk memulai panggilan baru.`);
      } else {
        setStatus("ended");
        setMessage(msg);
      }
    };

    const attach = (call: MediaConnection) => {
      callRef.current = call;
      setStatus("connecting");
      setMessage("Menyambungkan video dan suara…");

      clearConnectTimer();
      connectTimer.current = setTimeout(() => {
        endCall(call, "Tidak ada respons. Lawan bicara mungkin sedang dalam panggilan lain atau jaringan memblokir koneksi.");
      }, 20000);

      call.on("stream", (remote) => {
        if (callRef.current !== call) return;
        clearConnectTimer();
        if (remoteVideo.current) {
          remoteVideo.current.srcObject = remote;
          remoteVideo.current.play().catch(() => {});
        }
        setStatus("in-call");
        setMessage("Terhubung.");
      });
      call.on("close", () => endCall(call, "Panggilan selesai."));
      call.on("error", () => endCall(call, "Terjadi kesalahan pada panggilan."));

      const pc = call.peerConnection;
      if (pc) {
        pc.addEventListener("iceconnectionstatechange", () => {
          if (callRef.current !== call) return;
          const state = pc.iceConnectionState;
          if (state !== "disconnected") clearDisconnectTimer();
          if (state === "failed") {
            endCall(call, "Koneksi gagal. Jaringan Anda atau lawan bicara mungkin memblokir koneksi langsung.");
          } else if (state === "closed") {
            endCall(call, "Panggilan selesai.");
          } else if (state === "disconnected") {
            clearDisconnectTimer();
            disconnectTimer.current = setTimeout(() => {
              if (callRef.current === call && pc.iceConnectionState === "disconnected") {
                endCall(call, "Lawan bicara terputus.");
              }
            }, 5000);
          }
        });
      }
    };

    const fail = (msg: string) => {
      if (cancelled) return;
      setStatus("error");
      setMessage(msg);
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

      const peer = new PeerCtor({ config: { iceServers: buildIceServers() } });
      peerRef.current = peer;

      peer.on("open", (id) => {
        if (cancelled) return;
        if (host) {
          setLink(`${window.location.origin}/?join=${id}`);
          setStatus("waiting");
          setMessage("Bagikan link di bawah ke lawan bicara. Panggilan dimulai otomatis saat mereka membukanya.");
        } else {
          setStatus("connecting");
          setMessage("Menghubungi host…");
          attach(peer.call(joinId, stream));
        }
      });

      if (host) {
        peer.on("call", (incoming) => {
          if (cancelled) return;
          if (callRef.current) {
            incoming.close(); // hanya 1-on-1
            return;
          }
          incoming.answer(stream);
          attach(incoming);
        });
      }

      peer.on("disconnected", () => {
        if (!cancelled && !peer.destroyed) peer.reconnect();
      });
      peer.on("error", (err) => fail(peerErrorMessage(err.type)));
    })();

    return () => {
      cancelled = true;
      clearDisconnectTimer();
      clearConnectTimer();
      if (copyTimer.current) clearTimeout(copyTimer.current);
      const call = callRef.current;
      callRef.current = null;
      try {
        call?.close();
      } catch {}
      peerRef.current?.destroy();
      peerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleTrack = useCallback((kind: "audio" | "video") => {
    const tracks = kind === "audio" ? streamRef.current?.getAudioTracks() : streamRef.current?.getVideoTracks();
    if (!tracks?.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = enabled));
    (kind === "audio" ? setMicOff : setCamOff)(!enabled);
  }, []);

  const hangUp = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    // close() memicu event "close" yang menjalankan endCall; pastikan UI ikut berubah.
    call.close();
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [link]);

  const showCard = status !== "in-call";
  const hasStream = status === "waiting" || status === "connecting" || status === "in-call";

  return (
    <main className="app">
      <video ref={remoteVideo} className="remote" autoPlay playsInline />

      {showCard && (
        <div className={`overlay ${status === "connecting" || status === "waiting" ? "" : "dim"}`}>
          <div className={`card ${status === "error" ? "error" : ""}`}>
            <h1>{TITLES[status]}</h1>
            <p aria-live="polite">{message}</p>
            {status === "waiting" && isHost && link && (
              <div className="linkbox">
                <code title={link}>{link}</code>
                <button type="button" className="btn primary" onClick={copyLink}>
                  {copied ? "Tersalin" : "Salin link"}
                </button>
              </div>
            )}
            {(status === "ended" || status === "error") && (
              <button type="button" className="btn primary" onClick={() => window.location.reload()}>
                {status === "ended" ? "Coba lagi" : "Muat ulang"}
              </button>
            )}
          </div>
        </div>
      )}
      {!showCard && (
        <p className="sr-only" aria-live="polite">
          {TITLES[status]}. {message}
        </p>
      )}

      <video
        ref={localVideo}
        className="local"
        autoPlay
        muted
        playsInline
        style={{ display: hasStream ? "block" : "none" }}
      />

      {hasStream && (
        <div className="controls">
          <button type="button" className="btn" aria-pressed={micOff} onClick={() => toggleTrack("audio")}>
            {micOff ? "Nyalakan mic" : "Matikan mic"}
          </button>
          <button type="button" className="btn" aria-pressed={camOff} onClick={() => toggleTrack("video")}>
            {camOff ? "Nyalakan kamera" : "Matikan kamera"}
          </button>
          {status !== "waiting" && (
            <button type="button" className="btn end" onClick={hangUp}>
              Akhiri panggilan
            </button>
          )}
        </div>
      )}
    </main>
  );
}
