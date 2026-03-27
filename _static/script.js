// WebGL warped fBM shader rendering
(function() {
if (window.__c7loInitialized) return;
window.__c7loInitialized = true;

// Touch device detection — hide custom cursor
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch-device');
}

// Show FPS counter only if ?fps is in URL
var fpsDisplay = document.getElementById('fps');
if (new URLSearchParams(window.location.search).has('fps')) {
  fpsDisplay.classList.add('visible');
}

var canvas = document.getElementById('canvas');
var gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
if (!gl) {
  console.error('WebGL not supported');
  return;
}

// ─── Quality settings ───
var QUALITY_LEVELS = ['low', 'medium', 'high'];
var QUALITY_SETTINGS = {
  low:    { scale: 0.3,  lowDpiScale: 0.51 },
  medium: { scale: 0.5,  lowDpiScale: 0.85 },
  high:   { scale: 0.75, lowDpiScale: 1.0  }
};
var LOW_DPI_THRESHOLD = 1.5;
var currentQuality = 'high';

// Adaptive quality
var AUTO_QUALITY_FPS_LOW = 28;
var AUTO_QUALITY_FPS_HIGH = 55;
var AUTO_QUALITY_SAMPLE_TIME = 2000;
var AUTO_QUALITY_COOLDOWN = 4000;
var autoQualityFpsHistory = [];
var lastQualityChangeTime = 0;

// ─── Shaders ───

var vertexShaderSource = [
  'attribute vec2 position;',
  'void main() {',
  '  gl_Position = vec4(position, 0.0, 1.0);',
  '}'
].join('\n');

// Warped fBM shader by trinketMage (https://www.shadertoy.com/view/tdG3Rd)
// Adapted for WebGL 1.0 with mouse interaction and click ripples
var fragmentShaderSource = [
  'precision highp float;',
  'uniform vec2 iResolution;',
  'uniform float iTime;',
  'uniform vec2 iMouse;',
  'uniform vec4 u_ripples[10];',
  'uniform int u_rippleCount;',
  '',
  'float colormap_red(float x) {',
  '  if (x < 0.0) {',
  '    return 54.0 / 255.0;',
  '  } else if (x < 20049.0 / 82979.0) {',
  '    return (829.79 * x + 54.51) / 255.0;',
  '  } else {',
  '    return 1.0;',
  '  }',
  '}',
  '',
  'float colormap_green(float x) {',
  '  if (x < 20049.0 / 82979.0) {',
  '    return 0.0;',
  '  } else if (x < 327013.0 / 810990.0) {',
  '    return (8546482679670.0 / 10875673217.0 * x - 2064961390770.0 / 10875673217.0) / 255.0;',
  '  } else if (x <= 1.0) {',
  '    return (103806720.0 / 483977.0 * x + 19607415.0 / 483977.0) / 255.0;',
  '  } else {',
  '    return 1.0;',
  '  }',
  '}',
  '',
  'float colormap_blue(float x) {',
  '  if (x < 0.0) {',
  '    return 54.0 / 255.0;',
  '  } else if (x < 7249.0 / 82979.0) {',
  '    return (829.79 * x + 54.51) / 255.0;',
  '  } else if (x < 20049.0 / 82979.0) {',
  '    return 127.0 / 255.0;',
  '  } else if (x < 327013.0 / 810990.0) {',
  '    return (792.02249341361393720147485376583 * x - 64.364790735602331034989206222672) / 255.0;',
  '  } else {',
  '    return 1.0;',
  '  }',
  '}',
  '',
  'vec4 colormap(float x) {',
  '  return vec4(colormap_red(x), colormap_green(x), colormap_blue(x), 1.0);',
  '}',
  '',
  'float rand(vec2 n) {',
  '  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);',
  '}',
  '',
  'float noise(vec2 p) {',
  '  vec2 ip = floor(p);',
  '  vec2 u = fract(p);',
  '  u = u * u * (3.0 - 2.0 * u);',
  '  float res = mix(',
  '    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),',
  '    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);',
  '  return res * res;',
  '}',
  '',
  'const mat2 mtx = mat2(0.80, 0.60, -0.60, 0.80);',
  '',
  'float fbm(vec2 p) {',
  '  float f = 0.0;',
  '  f += 0.500000 * noise(p + iTime); p = mtx * p * 2.02;',
  '  f += 0.031250 * noise(p);          p = mtx * p * 2.01;',
  '  f += 0.250000 * noise(p);          p = mtx * p * 2.03;',
  '  f += 0.125000 * noise(p);          p = mtx * p * 2.01;',
  '  f += 0.062500 * noise(p);          p = mtx * p * 2.04;',
  '  f += 0.015625 * noise(p + sin(iTime));',
  '  return f / 0.96875;',
  '}',
  '',
  'float pattern(in vec2 p) {',
  '  return fbm(p + fbm(p + fbm(p)));',
  '}',
  '',
  'vec2 rippleDistort(vec2 uv) {',
  '  vec2 offset = vec2(0.0);',
  '  for (int i = 0; i < 10; i++) {',
  '    if (i >= u_rippleCount) break;',
  '    vec2 center = u_ripples[i].xy;',
  '    float birthTime = u_ripples[i].z;',
  '    float amp = u_ripples[i].w;',
  '    float age = iTime - birthTime;',
  '    float radius = age * 0.15;',
  '    float dist = length(uv - center);',
  '    float wave = sin((dist - radius) * 60.0);',
  '    float envelope = amp * exp(-age * 1.2)',
  '                        * exp(-abs(dist - radius) * 5.0);',
  '    offset += normalize(uv - center + 0.001) * wave * envelope;',
  '  }',
  '  return offset;',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / iResolution.x;',
  '',
  '  vec2 mouseUV = iMouse / iResolution.x;',
  '  vec2 toMouse = mouseUV - uv;',
  '  float mouseDist = length(toMouse);',
  '  float mouseInfluence = 0.35 * exp(-mouseDist * mouseDist * 8.0);',
  '  uv += toMouse * mouseInfluence;',
  '',
  '  uv += rippleDistort(uv);',
  '',
  '  float shade = pattern(uv);',
  '  gl_FragColor = vec4(colormap(shade).rgb, 1.0);',
  '}'
].join('\n');

var ditherVertexSource = [
  'attribute vec2 a_position;',
  'attribute vec2 a_texCoord;',
  'varying vec2 v_texCoord;',
  'void main() {',
  '  gl_Position = vec4(a_position, 0.0, 1.0);',
  '  v_texCoord = a_texCoord;',
  '}'
].join('\n');

var ditherFragmentSource = [
  'precision highp float;',
  'uniform sampler2D u_image;',
  'uniform vec2 u_resolution;',
  'uniform float u_time;',
  'uniform float u_noiseScale;',
  'uniform float u_bw;',
  'varying vec2 v_texCoord;',
  '',
  '#define INTENSITY 0.4',
  '#define SPEED 1.5',
  '#define MEAN 0.0',
  '#define VARIANCE 0.75',
  '',
  'float gaussian(float z, float u, float o) {',
  '  return (1.0 / (o * sqrt(2.0 * 3.1415))) * exp(-(((z - u) * (z - u)) / (2.0 * (o * o))));',
  '}',
  '',
  'void main() {',
  '  vec4 color = texture2D(u_image, v_texCoord);',
  '  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));',
  '  float t = u_time * SPEED;',
  '  vec2 uv = gl_FragCoord.xy * u_noiseScale / u_resolution;',
  '  float seed = dot(uv, vec2(12.9898, 78.233));',
  '  float n = fract(sin(seed) * 43758.5453 + t);',
  '  n = gaussian(n, MEAN, VARIANCE * VARIANCE);',
  '',
  '  vec3 grainBW = vec3(n) * (1.0 - vec3(gray));',
  '  float grayGrained = clamp(gray + grainBW.r * INTENSITY, 0.0, 1.0);',
  '  vec3 dark  = vec3(0.235);',
  '  vec3 light = vec3(0.836);',
  '  vec3 bwResult = mix(dark, light, grayGrained);',
  '',
  '  vec3 grainColor = vec3(n) * (1.0 - color.rgb);',
  '  vec3 colorResult = color.rgb + grainColor * INTENSITY * 0.3;',
  '',
  '  gl_FragColor = vec4(mix(colorResult, bwResult, u_bw), 1.0);',
  '}'
].join('\n');

// ─── Shader helpers ───
function createShader(gl, type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vs, fs) {
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ─── Build programs ───
var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
var fragShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
var program = createProgram(gl, vertexShader, fragShader);

var positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,  1, -1,  -1, 1,
  -1,  1,  1, -1,   1, 1
]), gl.STATIC_DRAW);

var positionLocation = gl.getAttribLocation(program, 'position');
var resolutionLocation = gl.getUniformLocation(program, 'iResolution');
var timeLocation = gl.getUniformLocation(program, 'iTime');
var mouseLocation = gl.getUniformLocation(program, 'iMouse');
var ripplesLocation = gl.getUniformLocation(program, 'u_ripples');
var rippleCountLocation = gl.getUniformLocation(program, 'u_rippleCount');

var ditherVS = createShader(gl, gl.VERTEX_SHADER, ditherVertexSource);
var ditherFS = createShader(gl, gl.FRAGMENT_SHADER, ditherFragmentSource);
var ditherProgram = createProgram(gl, ditherVS, ditherFS);

var ditherPositionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, ditherPositionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
var ditherPositionLocation = gl.getAttribLocation(ditherProgram, 'a_position');

var ditherTexCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, ditherTexCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
var ditherTexCoordLocation = gl.getAttribLocation(ditherProgram, 'a_texCoord');

var ditherResolutionLocation = gl.getUniformLocation(ditherProgram, 'u_resolution');
var ditherImageLocation = gl.getUniformLocation(ditherProgram, 'u_image');
var ditherTimeLocation = gl.getUniformLocation(ditherProgram, 'u_time');
var ditherNoiseScaleLocation = gl.getUniformLocation(ditherProgram, 'u_noiseScale');
var ditherBwLocation = gl.getUniformLocation(ditherProgram, 'u_bw');

// ─── Framebuffer ───
var framebuffer = null;
var renderTexture = null;
var fbWidth = 0;
var fbHeight = 0;

function setupFramebuffer(width, height) {
  if (framebuffer && fbWidth === width && fbHeight === height) return;
  if (framebuffer) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(renderTexture);
  }
  fbWidth = width;
  fbHeight = height;
  renderTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, renderTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── Resize ───
function resize() {
  var width = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  var height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  var isLowDpi = window.devicePixelRatio < LOW_DPI_THRESHOLD;
  var settings = QUALITY_SETTINGS[currentQuality];
  var scale = isLowDpi ? settings.lowDpiScale : settings.scale;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.width = Math.round(width * window.devicePixelRatio * scale);
  canvas.height = Math.round(height * window.devicePixelRatio * scale);
  setupFramebuffer(canvas.width, canvas.height);
}

window.addEventListener('resize', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}
resize();

// ─── Adaptive quality ───
function setQuality(quality) {
  if (quality === currentQuality) return;
  currentQuality = quality;
  resize();
  lastQualityChangeTime = performance.now();
}

function updateAutoQuality(time, fps) {
  autoQualityFpsHistory.push({ time: time, fps: fps });
  var cutoff = time - AUTO_QUALITY_SAMPLE_TIME;
  while (autoQualityFpsHistory.length > 0 && autoQualityFpsHistory[0].time < cutoff) {
    autoQualityFpsHistory.shift();
  }
  if (autoQualityFpsHistory.length < 3) return;
  if (time - lastQualityChangeTime < AUTO_QUALITY_COOLDOWN) return;
  var sum = 0;
  for (var i = 0; i < autoQualityFpsHistory.length; i++) sum += autoQualityFpsHistory[i].fps;
  var avgFps = sum / autoQualityFpsHistory.length;
  var idx = QUALITY_LEVELS.indexOf(currentQuality);
  if (avgFps < AUTO_QUALITY_FPS_LOW && idx > 0) {
    setQuality(QUALITY_LEVELS[idx - 1]);
    autoQualityFpsHistory = [];
  } else if (avgFps > AUTO_QUALITY_FPS_HIGH && idx < QUALITY_LEVELS.length - 1) {
    setQuality(QUALITY_LEVELS[idx + 1]);
    autoQualityFpsHistory = [];
  }
}

// ─── Theme toggle (B&W ↔ Color) ───
var BW_STORAGE_KEY = 'c7lo-theme-bw';
var themeToggle = document.getElementById('theme-toggle');

function loadBwPreference() {
  try {
    var stored = localStorage.getItem(BW_STORAGE_KEY);
    if (stored === 'false') return false;
  } catch (e) {}
  return false; // default to Color
}

var isBW = loadBwPreference();
var bwBlend = isBW ? 1.0 : 0.0;
var bwTarget = bwBlend;
var BW_FADE_SPEED = 3.0;

function updateToggleLabel() {
  var valueSpan = themeToggle.querySelector('.value');
  if (valueSpan) {
    valueSpan.textContent = isBW ? 'COLOR' : 'B&W';
  }
}

themeToggle.addEventListener('click', function() {
  isBW = !isBW;
  bwTarget = isBW ? 1.0 : 0.0;
  updateToggleLabel();
  try { localStorage.setItem(BW_STORAGE_KEY, String(isBW)); } catch (e) {}
});

updateToggleLabel();

// ─── Mouse tracking ───
var mouseX = 0, mouseY = 0;
var smoothMouseX = 0, smoothMouseY = 0;
var MOUSE_SMOOTH = 0.08;

window.addEventListener('mousemove', function(e) {
  var rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) / rect.width * canvas.width;
  mouseY = (1 - (e.clientY - rect.top) / rect.height) * canvas.height;
});

// ─── Ripple system ───
var MAX_RIPPLES = 10;
var ripples = [];

canvas.addEventListener('click', function(e) {
  var rect = canvas.getBoundingClientRect();
  var x = (e.clientX - rect.left) / rect.width;
  var y = (1 - (e.clientY - rect.top) / rect.height) * (canvas.height / canvas.width);
  ripples.push({ x: x, y: y, time: performance.now() * 0.001 + daySeed, amplitude: 0.06 });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
});

function getRippleUniforms() {
  var data = new Float32Array(MAX_RIPPLES * 4);
  for (var i = 0; i < ripples.length; i++) {
    data[i * 4 + 0] = ripples[i].x;
    data[i * 4 + 1] = ripples[i].y;
    data[i * 4 + 2] = ripples[i].time;
    data[i * 4 + 3] = ripples[i].amplitude;
  }
  return data;
}

// ─── Welcome-back ripple ───
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    setTimeout(function() {
      var aspect = canvas.height / canvas.width;
      ripples.push({ x: 0.5, y: 0.5 * aspect, time: performance.now() * 0.001 + daySeed, amplitude: 0.25 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }, 100);
  }
});

// ─── Secret word trigger ───
(function() {
  var secret = 'garden';
  var buffer = '';
  window.addEventListener('keydown', function(e) {
    if (e.key.length !== 1) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    buffer += e.key.toLowerCase();
    if (buffer.length > secret.length) buffer = buffer.slice(-secret.length);
    if (buffer === secret) {
      buffer = '';
      var now = performance.now() * 0.001 + daySeed;
      var aspect = canvas.height / canvas.width;
      for (var i = 0; i < 5; i++) {
        var angle = (i / 5) * Math.PI * 2;
        var r = 0.08;
        ripples.push({
          x: 0.5 + Math.cos(angle) * r,
          y: 0.5 * aspect + Math.sin(angle) * r,
          time: now + i * 0.05,
          amplitude: 0.08
        });
      }
      while (ripples.length > MAX_RIPPLES) ripples.shift();
    }
  });
})();

// ─── Daily shader seed ───
var today = new Date();
var daySeed = ((today.getFullYear() * 366 + today.getMonth() * 31 + today.getDate()) * 17.31) % 1000;

// ─── FPS tracking ───
var frameCount = 0;
var lastFpsUpdate = 0;
var shaderReady = false;

// ─── Render loop ───
function render(time) {
  frameCount++;
  if (time - lastFpsUpdate >= 1000) {
    var fps = frameCount;
    fpsDisplay.textContent = 'FPS: ' + fps + ' | ' + canvas.width + 'x' + canvas.height + ' | Quality: ' + currentQuality;
    updateAutoQuality(time, fps);
    frameCount = 0;
    lastFpsUpdate = time;
  }

  var t = time * 0.001 + daySeed;

  smoothMouseX += (mouseX - smoothMouseX) * MOUSE_SMOOTH;
  smoothMouseY += (mouseY - smoothMouseY) * MOUSE_SMOOTH;

  // Pass 1: Render shader to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.enableVertexAttribArray(positionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(timeLocation, t);
  gl.uniform2f(mouseLocation, smoothMouseX, smoothMouseY);
  gl.uniform4fv(ripplesLocation, getRippleUniforms());
  gl.uniform1i(rippleCountLocation, ripples.length);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Pass 2: Dither post-process to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(ditherProgram);
  gl.enableVertexAttribArray(ditherPositionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherPositionBuffer);
  gl.vertexAttribPointer(ditherPositionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(ditherTexCoordLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherTexCoordBuffer);
  gl.vertexAttribPointer(ditherTexCoordLocation, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderTexture);
  gl.uniform1i(ditherImageLocation, 0);
  gl.uniform2f(ditherResolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(ditherTimeLocation, t);
  var noiseScale = window.devicePixelRatio < LOW_DPI_THRESHOLD ? 1.7 : 1.0;
  gl.uniform1f(ditherNoiseScaleLocation, noiseScale);

  // Animate B&W blend
  var dt = 1.0 / 60.0;
  if (bwBlend < bwTarget) {
    bwBlend = Math.min(bwBlend + BW_FADE_SPEED * dt, bwTarget);
  } else if (bwBlend > bwTarget) {
    bwBlend = Math.max(bwBlend - BW_FADE_SPEED * dt, bwTarget);
  }
  gl.uniform1f(ditherBwLocation, bwBlend);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (!shaderReady && program) {
    shaderReady = true;
    canvas.classList.add('shader-ready');
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
})();

// ─── Custom cursor ───
(function() {
  var dot = document.getElementById('cursor-dot');
  var ring = document.getElementById('cursor-ring');
  if (!dot || !ring) return;

  // Skip on touch devices
  if (document.body.classList.contains('touch-device')) return;

  var cx = -100, cy = -100;
  var rx = -100, ry = -100;
  var prevCx = -100, prevCy = -100;
  var lastTime = 0;
  var smoothing = 18; // higher = snappier ring follow

  window.addEventListener('mousemove', function(e) {
    cx = e.clientX;
    cy = e.clientY;
  });

  window.addEventListener('mousedown', function() {
    ring.classList.add('is-clicking');
  });
  window.addEventListener('mouseup', function() {
    ring.classList.remove('is-clicking');
  });

  document.addEventListener('mouseleave', function() {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });
  document.addEventListener('mouseenter', function() {
    dot.style.opacity = '1';
    ring.style.opacity = '1';
  });

  function tick(now) {
    var dt = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;
    var t = 1 - Math.exp(-smoothing * dt);

    dot.style.left = cx + 'px';
    dot.style.top = cy + 'px';

    rx += (cx - rx) * t;
    ry += (cy - ry) * t;
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';

    var vx = cx - prevCx;
    var vy = cy - prevCy;
    var speed = Math.sqrt(vx * vx + vy * vy);
    var stretch = Math.min(speed * 0.02, 0.3);
    var angle = Math.atan2(vy, vx) * 180 / Math.PI;
    ring.style.transform = 'translate(-50%,-50%) rotate(' + angle + 'deg) scaleX(' + (1 + stretch) + ') scaleY(' + (1 - stretch * 0.3) + ')';

    prevCx = cx;
    prevCy = cy;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// ─── Canvas snapshot (press S to save) ───
(function() {
  var canvas = document.getElementById('canvas');
  if (!canvas) return;
  window.addEventListener('keydown', function(e) {
    if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var link = document.createElement('a');
      link.download = 'c7lo-' + Date.now() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  });
})();


// ─── 404 typing effect ───
(function() {
  var el = document.querySelector('.page[data-page-type="404"] .error-text');
  if (!el) return;
  var html = el.innerHTML;
  el.innerHTML = '';
  var parts = html.match(/(<[^>]+>|[^<]+)/g) || [];
  var chars = [];
  parts.forEach(function(part) {
    if (part.charAt(0) === '<') {
      chars.push({ type: 'tag', value: part });
    } else {
      for (var i = 0; i < part.length; i++) {
        chars.push({ type: 'char', value: part[i] });
      }
    }
  });
  // Find where "yet" starts for dramatic pause
  var plainText = '';
  chars.forEach(function(c) { if (c.type === 'char') plainText += c.value; });
  var yetStart = plainText.indexOf('yet');
  var charIndex = 0;
  var i = 0;
  var output = '';
  function typeNext() {
    if (i >= chars.length) {
      // Show home link after typing completes
      var homeLink = document.getElementById('error-home');
      if (homeLink) setTimeout(function() { homeLink.classList.add('visible'); }, 800);
      return;
    }
    var c = chars[i++];
    output += c.value;
    el.innerHTML = output;
    if (c.type === 'tag') {
      typeNext();
    } else {
      var delay = 40 + Math.random() * 30;
      // Slow down on "yet"
      if (charIndex >= yetStart && charIndex < yetStart + 3) {
        delay = 250 + Math.random() * 100;
      }
      // Pause after "here" before the dash
      if (charIndex === yetStart - 4) {
        delay = 1200;
      }
      charIndex++;
      setTimeout(typeNext, delay);
    }
  }
  setTimeout(typeNext, 1500);
})();

// ─── Tab title when inactive ───
(function() {
  var originalTitle = document.title;
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      originalTitle = document.title;
      document.title = '· · ·';
    } else {
      document.title = originalTitle;
    }
  });
})();

// ─── Footnote scroll fix (scroll within .content-card instead of window) ───
(function() {
  function initFootnotes() {
    document.querySelectorAll('.content-card a[href^="#"]').forEach(function(link) {
      link.addEventListener('click', function(e) {
        var target = document.getElementById(link.getAttribute('href').slice(1));
        var card = link.closest('.content-card');
        if (target && card) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }
  initFootnotes();
  document.addEventListener('c7lo:pageReady', initFootnotes);
})();

// ─── Abbreviation tooltips (swap title → data-tip to suppress native tooltip) ───
(function() {
  function swapAbbrTitles() {
    document.querySelectorAll('abbr[title]').forEach(function(el) {
      el.setAttribute('data-tip', el.getAttribute('title'));
      el.removeAttribute('title');
    });
  }
  swapAbbrTitles();
  document.addEventListener('c7lo:pageReady', swapAbbrTitles);
})();

// ─── Nav active state ───
(function() {
  function updateActiveNav() {
    var path = window.location.pathname;
    document.querySelectorAll('.top-nav .nav-link').forEach(function(link) {
      var href = link.getAttribute('href');
      if (href === '/posts/feed.rss') return;
      var isActive = href === '/' ? path === '/' : path.startsWith(href);
      link.classList.toggle('active', isActive);
    });
  }
  updateActiveNav();
  document.addEventListener('c7lo:pageReady', updateActiveNav);
})();

// ─── Backdrop dismiss: click on canvas (outside card) → go home ───
(function() {
  var canvas = document.getElementById('canvas');
  if (!canvas) return;
  canvas.addEventListener('click', function() {
    var closeBtn = document.querySelector('.content-card .close-btn');
    if (closeBtn) {
      closeBtn.click();
    }
  });
})();
