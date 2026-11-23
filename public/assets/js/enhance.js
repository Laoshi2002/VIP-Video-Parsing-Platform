// 播放页实时画质增强：WebGL unsharp mask 锐化 + 轻微对比度提升
// 目的：采集源码率普遍只有 0.8~3Mbps，画面发糊；在不换源的前提下提升清晰度观感
(function () {
  'use strict';

  const VS = 'attribute vec2 aPos; varying vec2 vUv;\n' +
    'void main(){ vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }';

  const FS = 'precision mediump float; varying vec2 vUv;\n' +
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform float uAmount; uniform float uContrast;\n' +
    'void main(){\n' +
    '  vec3 c = texture2D(uTex, vUv).rgb;\n' +
    '  vec3 n = texture2D(uTex, vUv + vec2(uTexel.x, 0.0)).rgb\n' +
    '         + texture2D(uTex, vUv - vec2(uTexel.x, 0.0)).rgb\n' +
    '         + texture2D(uTex, vUv + vec2(0.0, uTexel.y)).rgb\n' +
    '         + texture2D(uTex, vUv - vec2(0.0, uTexel.y)).rgb;\n' +
    '  n *= 0.25;\n' +
    '  vec3 s = c + (c - n) * uAmount;\n' +
    '  s = (s - 0.5) * uContrast + 0.5;\n' +
    '  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);\n' +
    '}';

  const AMOUNT = 0.55;   // 锐化强度
  const CONTRAST = 1.06; // 对比度
  const MAX_W = 1920;    // 增强纹理宽度上限，控制 GPU 开销

  let gl, prog, tex, canvas, videoEl, uTexel, uAmount, uContrast;
  let running = false, frameCb = 0, rafId = 0;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }

  function initGl() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return false;
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    uTexel = gl.getUniformLocation(prog, 'uTexel');
    uAmount = gl.getUniformLocation(prog, 'uAmount');
    uContrast = gl.getUniformLocation(prog, 'uContrast');
    gl.uniform1f(uAmount, AMOUNT);
    gl.uniform1f(uContrast, CONTRAST);
    return true;
  }

  // 画布按视频原始宽高比居中适配（letterbox），避免竖屏/宽银幕片源被拉伸变形
  function syncSize() {
    const cw = videoEl.clientWidth, ch = videoEl.clientHeight;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!cw || !ch || !vw || !vh) return false;
    // 与 <video> 默认 object-fit:contain 的行为对齐
    const scale = Math.min(cw / vw, ch / vh);
    const dw = Math.round(vw * scale), dh = Math.round(vh * scale);
    canvas.style.width = dw + 'px';
    canvas.style.height = dh + 'px';
    canvas.style.left = Math.round((cw - dw) / 2) + 'px';
    canvas.style.top = Math.round((ch - dh) / 2) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = Math.round(dw * dpr), h = Math.round(dh * dpr);
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uTexel, 1 / w, 1 / h);
    }
    return true;
  }

  function draw() {
    if (!gl || !videoEl || videoEl.readyState < 2) return;
    if (!videoEl.videoWidth) return;
    if (!syncSize()) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoEl);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function stop() {
    running = false;
    if (frameCb && videoEl && videoEl.cancelVideoFrameCallback) {
      try { videoEl.cancelVideoFrameCallback(frameCb); } catch { /* 忽略 */ }
    }
    frameCb = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function loop() {
    if (!running) return;
    try {
      draw();
    } catch {
      // 跨域污染等情况：放弃增强，露出原始视频
      destroyCanvas();
      return;
    }
    if (videoEl && videoEl.requestVideoFrameCallback) {
      frameCb = videoEl.requestVideoFrameCallback(loop);
    } else {
      rafId = requestAnimationFrame(loop);
    }
  }

  function start() {
    if (running) return;
    running = true;
    loop();
  }

  function destroyCanvas() {
    stop();
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (gl) { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); }
    gl = prog = tex = canvas = null;
    uTexel = uAmount = uContrast = null;
  }

  function attach(video) {
    if (!video) return;
    if (videoEl === video && canvas && canvas.parentNode) {
      // 同一 video（切集场景）只需确保循环在跑
      if (!video.paused) start();
      return;
    }
    detach();
    videoEl = video;
    canvas = document.createElement('canvas');
    canvas.className = 'enh-layer';
    if (!initGl()) { canvas = null; gl = null; return; }
    video.parentNode.insertBefore(canvas, video.nextSibling);

    // 仅播放中处理，暂停/结束时停掉循环省性能
    video.addEventListener('play', start);
    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    video.addEventListener('emptied', stop);
    video.addEventListener('resize', () => { if (gl) syncSize(); });
    if (!video.paused) start();
  }

  function detach() {
    if (videoEl) {
      videoEl.removeEventListener('play', start);
      videoEl.removeEventListener('playing', start);
      videoEl.removeEventListener('pause', stop);
      videoEl.removeEventListener('ended', stop);
      videoEl.removeEventListener('emptied', stop);
    }
    destroyCanvas();
    videoEl = null;
  }

  window.VphEnhance = { attach, detach };
})();
