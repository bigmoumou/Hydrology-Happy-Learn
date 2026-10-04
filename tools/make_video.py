"""把一個單元的投影片做成教學影片：旁白（edge-tts）→ 時間軸 → 逐格擷取 → 配樂混音 → MP4＋字幕

用法（在 opus-video 環境；需先啟動本機網站 serve.bat 或 hydro-site）：
  bash ~/.claude/skills/opus-video/scripts/ov python tools/make_video.py production/ch01/u1-1 [--fps 30] [--cues 0-5] [--tts-only]

輸出（都在單元的 production 資料夾）：
  tts/NN.mp3、tts/NN.json      每一句旁白與句子時間點（有快取，文字不變就不重做）
  timeline.json                每一句的開始、說話、結束時間
  audio/narration.wav、audio/music.wav、audio/mix.wav
  out/<unit>.mp4、out/<unit>.vtt、out/poster.jpg

畫面時間怎麼控制：頁面載入時注入「虛擬時鐘」，接管 requestAnimationFrame 與 performance.now；
每一格只往前推 1/fps 秒，再把所有 CSS 動畫／轉場、SVG 動畫對到同一個時間，然後截圖。
所以畫面只由時間決定，跟電腦快慢無關，可以重拍任一段。
"""
import argparse, asyncio, hashlib, json, math, os, subprocess, sys, time, wave
import numpy as np

SR = 48000
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))

VIRTUAL_CLOCK = r"""
(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let virtual = false, vt = 0, q = new Map(), nextId = 1e9;
  window.requestAnimationFrame = (cb) => { if (!virtual) return realRAF(cb); const id = nextId++; q.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { if (id >= 1e9) q.delete(id); else realCancel(id); };
  performance.now = () => (virtual ? vt : realNow());
  const born = new WeakMap();
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) { born.set(a, vt); a.pause(); }
      a.currentTime = vt - born.get(a);
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.querySelector('animate, animateMotion, animateTransform')) { svg.pauseAnimations(); svg.setCurrentTime(vt / 1000); }
    }
  }
  window.__vt = {
    start() { virtual = true; vt = Math.ceil(realNow()); syncAnimations(); },
    step(ms) {
      vt += ms;
      const cbs = [...q.values()]; q.clear();
      for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } }
      syncAnimations();
    },
    sync: syncAnimations,
    get now() { return vt; },
  };
})();
"""


def movavg(a, k):
    """快速移動平均（累積和），長度不變"""
    k = max(1, int(k))
    c = np.cumsum(np.concatenate([np.zeros(1, np.float64), a.astype(np.float64)]))
    out = (c[k:] - c[:-k]) / k
    pad = len(a) - len(out)
    return np.concatenate([np.full(pad // 2, out[0]), out, np.full(pad - pad // 2, out[-1])]).astype(np.float32)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def ffprobe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def write_wav(path, sig, ch=1):
    sig = np.clip(sig, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((sig * 32767).astype("<i2").tobytes())


# ---------------- 1. 旁白 ----------------
async def tts_one(text, voice, rate, mp3, meta):
    import edge_tts
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="SentenceBoundary")
    sents = []
    with open(mp3, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] in ("SentenceBoundary", "WordBoundary"):
                sents.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "text": ch["text"]})
    json.dump({"text": text, "sentences": sents}, open(meta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def make_tts(prod, script):
    os.makedirs(os.path.join(prod, "tts"), exist_ok=True)
    out = []
    for n, c in enumerate(script["cues"]):
        key = hashlib.sha1(f'{script["voice"]}|{script["rate"]}|{c["text"]}'.encode()).hexdigest()[:10]
        mp3 = os.path.join(prod, "tts", f"{n:02d}_{key}.mp3")
        meta = mp3[:-4] + ".json"
        if not os.path.exists(mp3) or not os.path.exists(meta):
            for attempt in range(4):
                try:
                    asyncio.run(tts_one(c["text"], script["voice"], script["rate"], mp3, meta)); break
                except Exception as e:
                    print(f"  tts retry {n}: {e}", file=sys.stderr); time.sleep(2 + attempt * 2)
            else:
                raise SystemExit(f"TTS failed for cue {n}")
            print(f"  tts {n:02d} ok")
        out.append((mp3, json.load(open(meta, encoding="utf-8"))))
    return out


# ---------------- 2. 時間軸 ----------------
def build_timeline(script, tts):
    t = 0.6
    tl = []
    prev_slide = None
    for n, (c, (mp3, meta)) in enumerate(zip(script["cues"], tts)):
        dur = ffprobe_duration(mp3)
        slide_change = c["slide"] != prev_slide
        lead = c.get("lead", 0.9 if slide_change else 0.35)
        go = t
        speak = go + lead
        end = speak + dur
        nxt = end + c.get("hold", 0.0) + (0.55 if n + 1 < len(script["cues"]) and script["cues"][n + 1]["slide"] != c["slide"] else 0.3)
        tl.append({"n": n, "slide": c["slide"], "frag": c["frag"], "go": round(go, 3), "speak": round(speak, 3), "end": round(end, 3),
                   "next": round(nxt, 3), "dur": round(dur, 3), "act": c.get("act"), "mp3": mp3, "text": c["text"], "sentences": meta["sentences"]})
        t = nxt
        prev_slide = c["slide"]
    return tl, t + 0.8


def subtitles(tl):
    """把每句旁白切成適合一行的字幕段（按標點，超過 24 字再切）；時間依句子邊界與字數比例分配"""
    import re
    segs = []
    for c in tl:
        sents = c["sentences"] or [{"t": 0, "d": c["dur"], "text": c["text"]}]
        for s in sents:
            parts = [p for p in re.split(r"(?<=[，、；：。？！])", s["text"]) if p.strip()]
            lines, cur = [], ""
            for p in parts:
                if len(cur) + len(p) > 24 and cur:
                    lines.append(cur); cur = p
                else:
                    cur += p
            if cur: lines.append(cur)
            total = sum(len(l) for l in lines) or 1
            t0 = c["speak"] + s["t"]
            for l in lines:
                d = s["d"] * len(l) / total
                segs.append({"start": t0, "end": t0 + d, "text": l.rstrip("，、；：。")})
                t0 += d
    # 讓相鄰字幕銜接、最短 0.9 秒
    for k in range(len(segs) - 1):
        if segs[k + 1]["start"] - segs[k]["end"] < 0.35:
            segs[k]["end"] = segs[k + 1]["start"]
    return segs


def vtt_time(t):
    h, r = divmod(t, 3600); m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


# ---------------- 3. 聲音 ----------------
def synth_music(dur, seed=3):
    """柔和的環境配樂：慢速和弦墊音＋輕微的水聲，四個和弦循環"""
    rng = np.random.default_rng(seed)
    n = int(dur * SR); x = np.arange(n) / SR
    chords = [[220.0, 277.18, 329.63, 440.0], [196.0, 246.94, 293.66, 392.0], [174.61, 220.0, 261.63, 349.23], [196.0, 246.94, 329.63, 392.0]]
    bar = 8.0
    out = np.zeros(n, np.float32)
    for k in range(int(math.ceil(dur / bar)) + 1):
        ch = chords[k % 4]
        s0 = int((k * bar - 1.5) * SR); s1 = int(((k + 1) * bar + 1.5) * SR)
        a, b = max(0, s0), min(n, s1)
        if a >= b: continue
        tt = x[a:b]
        env = np.clip((tt - (k * bar - 1.5)) / 2.5, 0, 1) * np.clip(((k + 1) * bar + 1.5 - tt) / 2.5, 0, 1)
        sig = np.zeros(b - a)
        for i, f in enumerate(ch):
            det = 1 + (i - 1.5) * 0.0012
            sig += np.sin(2 * np.pi * f * det * tt + i) * (0.5 if i else 0.7) + 0.18 * np.sin(2 * np.pi * f * 2 * tt + i * 2)
        out[a:b] += (sig * env * 0.06).astype(np.float32)
    # 輕水聲：濾波的雜訊，慢慢起伏
    wn = rng.standard_normal(n).astype(np.float32)
    low = movavg(wn, 400)
    water = (wn - low) * 0.012 * (0.6 + 0.4 * np.sin(2 * np.pi * x / 11.0))
    hp = movavg(water, 6)
    out += hp.astype(np.float32)
    fade = np.clip(x / 3.0, 0, 1) * np.clip((dur - x) / 4.0, 0, 1)
    return out * fade


def lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    import re
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", out)
    return float(m[-1]) if m else None


def make_audio(prod, tl, total):
    os.makedirs(os.path.join(prod, "audio"), exist_ok=True)
    n = int(total * SR)
    nar = np.zeros(n, np.float32)
    for c in tl:
        s = decode(c["mp3"])
        a = int(c["speak"] * SR)
        b = min(n, a + len(s))
        nar[a:b] += s[: b - a]
    music = synth_music(total)
    # 說話時配樂壓低（ducking）
    env = movavg((np.abs(nar) > 0.01).astype(np.float32), 0.25 * SR)
    env = np.clip(env * 3, 0, 1)
    duck = 1 - 0.55 * movavg(env, 0.6 * SR)
    p_n, p_m = os.path.join(prod, "audio", "narration.wav"), os.path.join(prod, "audio", "music.wav")
    write_wav(p_n, nar); write_wav(p_m, music * duck)
    # 旁白 -16 LUFS、配樂 -33 LUFS
    ln, lm = lufs(p_n), lufs(p_m)
    gn, gm = 10 ** ((-16 - ln) / 20), 10 ** ((-33 - lm) / 20)
    mix = nar * gn + music * duck * gm
    pk = np.max(np.abs(mix))
    if pk > 0.89: mix *= 0.89 / pk
    p = os.path.join(prod, "audio", "mix.wav")
    write_wav(p, mix)
    print(f"  audio: narration {ln:.1f}→-16 LUFS, music {lm:.1f}→-33 LUFS, mix {lufs(p):.1f} LUFS")
    return p


# ---------------- 4. 擷取 ----------------
def capture(prod, script, tl, total, segs, fps, base, out_mp4, t_from=0.0, t_to=None, size=(1920, 1080), dsf=1.5, out_size=(2560, 1440)):
    from playwright.sync_api import sync_playwright
    t_to = total if t_to is None else min(total, t_to)
    W, H = size
    args = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
                           "-vf", f"scale={out_size[0]}:{out_size[1]}:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-x264-params", "aq-mode=3", "-pix_fmt", "yuv420p", "-r", str(fps), out_mp4], stdin=subprocess.PIPE)
    with sync_playwright() as p:
        try:
            br = p.chromium.launch(headless=True, args=args, channel="chrome")
        except Exception:
            br = p.chromium.launch(headless=True, args=args)
        pg = br.new_page(viewport={"width": W, "height": H}, device_scale_factor=dsf)
        pg.add_init_script(VIRTUAL_CLOCK)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        first = tl[0]
        pg.goto(f"{base}{script['page']}?capture#/{first['slide']}")
        pg.wait_for_function("window.__ready === true", timeout=240000)
        pg.evaluate("document.fonts.ready.then(() => true)")
        pg.evaluate("""() => { const d = document.createElement('div'); d.className = 'capsub'; document.querySelector('.deck__stage').appendChild(d); }""")
        time.sleep(1.0)
        pg.evaluate("window.__vt.start()")
        step = 1000.0 / fps
        n0, n1 = int(round(t_from * fps)), int(round(t_to * fps))
        ci = 0           # 下一個要觸發的 cue
        acts = []        # 進行中的滑桿動畫
        lab_now = {}
        si = 0
        t_start = time.time()
        for fr in range(0, n1):
            t = fr / fps
            # 觸發 cue
            while ci < len(tl) and tl[ci]["go"] <= t + 1e-6:
                c = tl[ci]
                pg.evaluate(f"(() => {{ const d = window.deck; if (d.i !== {c['slide'] - 1} || d.f !== {c['frag']}) d.go({c['slide'] - 1}, {c['frag']}); }})()")
                if c.get("act") and "quiz" in c["act"]:
                    pg.evaluate(f"window.quizReveal({c['act']['quiz']})")
                if c.get("act") and "call" in c["act"]:
                    pg.evaluate("([f, a]) => window.unitActs[f](...a)", [c["act"]["call"], c["act"].get("args", [])])
                if c.get("act") and "lab" in c["act"]:
                    lab_now = {}
                    cur = pg.evaluate("window.lab.params")
                    for k, v in c["act"]["lab"].items():
                        acts.append({"k": k, "a": cur[k], "b": v, "t0": c["speak"] + 0.3, "t1": c["speak"] + 2.6})
                ci += 1
            for a in list(acts):
                u = min(1.0, max(0.0, (t - a["t0"]) / (a["t1"] - a["t0"])))
                u = u * u * (3 - 2 * u)
                v = a["a"] + (a["b"] - a["a"]) * u
                v = round(v * 2) / 2 if a["k"] == "tr" else round(v)
                if lab_now.get(a["k"]) != v:
                    pg.evaluate(f"window.lab.set('{a['k']}', {v})")
                    lab_now[a["k"]] = v
                if u >= 1: acts.remove(a)
            # 字幕
            while si < len(segs) and segs[si]["end"] <= t: si += 1
            sub = segs[si]["text"] if si < len(segs) and segs[si]["start"] <= t < segs[si]["end"] else ""
            pg.evaluate("(s) => { const e = document.querySelector('.capsub'); if (e.textContent !== s) e.textContent = s; e.classList.toggle('is-on', !!s); }", sub)
            pg.evaluate(f"window.__vt.step({step})")
            if fr >= n0:
                ff.stdin.write(pg.screenshot(type="jpeg", quality=95))
                done = fr - n0 + 1
                if done % (fps * 10) == 0:
                    el = time.time() - t_start
                    print(f"  frame {done}/{n1 - n0}  ({el / done * 1000:.0f} ms/frame, eta {(n1 - n0 - done) * el / done / 60:.1f} min)", flush=True)
        if errs:
            print("page errors:", errs[:5], file=sys.stderr)
        br.close()
    ff.stdin.close(); ff.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prod")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--base", default="http://127.0.0.1:8790/")
    ap.add_argument("--from", dest="t_from", type=float, default=0.0)
    ap.add_argument("--to", dest="t_to", type=float, default=None)
    ap.add_argument("--tts-only", action="store_true")
    ap.add_argument("--name", default=None)
    a = ap.parse_args()
    prod = os.path.join(ROOT, a.prod) if not os.path.isabs(a.prod) else a.prod
    script = json.load(open(os.path.join(prod, "script.json"), encoding="utf-8"))
    print("1/4 旁白", flush=True)
    tts = make_tts(prod, script)
    tl, total = build_timeline(script, tts)
    segs = subtitles(tl)
    json.dump({"total": total, "cues": tl}, open(os.path.join(prod, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  總長 {total:.1f} 秒（{total / 60:.1f} 分）")
    os.makedirs(os.path.join(prod, "out"), exist_ok=True)
    name = a.name or script["unit"].split()[0]
    with open(os.path.join(prod, "out", f"{name}.vtt"), "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for k, s in enumerate(segs):
            f.write(f"{k + 1}\n{vtt_time(s['start'])} --> {vtt_time(s['end'])}\n{s['text']}\n\n")
    if a.tts_only:
        return
    print("2/4 聲音", flush=True)
    mix = make_audio(prod, tl, total)
    print("3/4 擷取畫面", flush=True)
    silent = os.path.join(prod, "out", f"{name}_video.mp4")
    capture(prod, script, tl, total, segs, a.fps, a.base, silent, a.t_from, a.t_to)
    print("4/4 合成", flush=True)
    final = os.path.join(prod, "out", f"{name}.mp4")
    t0 = a.t_from
    t1 = total if a.t_to is None else min(total, a.t_to)
    run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-ss", f"{t0}", "-t", f"{t1 - t0}", "-i", mix,
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final])
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0.0, min(3.0, t1 - t0 - 0.1))}", "-i", final, "-frames:v", "1", "-q:v", "3", os.path.join(prod, "out", "poster.jpg")])
    os.remove(silent)
    print("完成：", final)


if __name__ == "__main__":
    main()
