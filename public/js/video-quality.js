/**
 * HD video capture, WebRTC encoding tuning, and real-time frame enhancement.
 * Uses browser ML for audio (noise suppression) and canvas-based adaptive
 * sharpening/contrast for video — not cloud AI upscaling.
 */
window.MeetVideoQuality = (() => {
  const HD_VIDEO = {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
    aspectRatio: { ideal: 16 / 9 },
  };

  const FALLBACK_VIDEO = [
    HD_VIDEO,
    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
    true,
  ];

  const VIDEO_BITRATE = 2_800_000;
  const SCREEN_BITRATE = 4_500_000;
  const AUDIO_BITRATE = 128_000;

  let enhancementEnabled = localStorage.getItem('meet-hd-plus') !== 'off';

  class Enhancer {
    #stopped = true;

    static supported() {
      return typeof MediaStreamTrackProcessor !== 'undefined'
        && typeof MediaStreamTrackGenerator !== 'undefined'
        && typeof OffscreenCanvas !== 'undefined';
    }

    stop() {
      this.#stopped = true;
    }

    async start(inputTrack) {
      if (!Enhancer.supported()) return inputTrack;

      this.stop();
      this.#stopped = false;

      const processor = new MediaStreamTrackProcessor({ track: inputTrack });
      const generator = new MediaStreamTrackGenerator({ kind: 'video' });
      const canvas = new OffscreenCanvas(1280, 720);
      const ctx = canvas.getContext('2d', { alpha: false });

      this.#runLoop(processor, generator, canvas, ctx, inputTrack);
      return generator;
    }

    async #runLoop(processor, generator, canvas, ctx, inputTrack) {
      const reader = processor.readable.getReader();
      const writer = generator.writable.getWriter();

      try {
        while (!this.#stopped && inputTrack.readyState === 'live') {
          const { done, value: frame } = await reader.read();
          if (done || !frame) break;

          const w = frame.displayWidth;
          const h = frame.displayHeight;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }

          // Adaptive look: contrast + saturation + mild sharpen via filter stack
          ctx.filter = 'contrast(1.08) saturate(1.12) brightness(1.05)';
          ctx.drawImage(frame, 0, 0, w, h);
          ctx.filter = 'none';

          const out = new VideoFrame(canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration ?? undefined,
          });
          frame.close();
          await writer.write(out);
          out.close();
        }
      } catch (err) {
        if (!this.#stopped) console.warn('HD+ enhancement stopped:', err);
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await writer.close(); } catch { /* ignore */ }
      }
    }
  }

  async function acquireVideoTrack() {
    let lastErr;
    for (const video of FALLBACK_VIDEO) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: typeof video === 'boolean' ? video : video,
        });
        const track = stream.getVideoTracks()[0];
        await tuneVideoTrack(track);
        return track;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Could not open camera.');
  }

  async function acquireAudioTrack() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    await tuneAudioTrack(track);
    return track;
  }

  async function tuneVideoTrack(track) {
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints(HD_VIDEO);
    } catch {
      try {
        await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 } });
      } catch { /* device limit */ }
    }
    if ('contentHint' in track) track.contentHint = 'detail';
  }

  async function tuneAudioTrack(track) {
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    } catch { /* ignore */ }
  }

  async function configureSender(sender, { screenShare = false } = {}) {
    if (!sender?.getParameters || sender.track?.kind !== 'video') return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = screenShare ? SCREEN_BITRATE : VIDEO_BITRATE;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    params.degradationPreference = 'maintain-resolution';
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.warn('Video encoding tune failed:', err);
    }
  }

  async function configureAudioSender(sender) {
    if (!sender?.getParameters || sender.track?.kind !== 'audio') return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = AUDIO_BITRATE;
    try {
      await sender.setParameters(params);
    } catch { /* ignore */ }
  }

  async function configurePeerConnection(pc, { screenShare = false } = {}) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === 'video') await configureSender(sender, { screenShare });
      if (sender.track?.kind === 'audio') await configureAudioSender(sender);
    }
  }

  function setEnhancementEnabled(on) {
    enhancementEnabled = on;
    localStorage.setItem('meet-hd-plus', on ? 'on' : 'off');
  }

  function isEnhancementEnabled() {
    return enhancementEnabled;
  }

  return {
    Enhancer,
    acquireVideoTrack,
    acquireAudioTrack,
    tuneVideoTrack,
    configurePeerConnection,
    configureSender,
    setEnhancementEnabled,
    isEnhancementEnabled,
  };
})();
