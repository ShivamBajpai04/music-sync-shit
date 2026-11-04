// The scenery is a known texture: refract it directly without blurring the DOM.
// Draw only on layout/input changes, so the remote has no idle animation loop.
export function installGlass(element: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-lens';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return;
  const vertex = `attribute vec2 position; void main() { gl_Position = vec4(position, 0., 1.); }`;
  const fragment = `
    precision highp float;
    uniform sampler2D scenery;
    uniform vec2 size, origin, viewport, imageSize, light;
    uniform float pixelRatio, radius;
    float shape(vec2 p) {
      vec2 q = abs(p - size * .5) - (size * .5 - radius);
      return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - radius;
    }
    vec3 sampleScene(vec2 p) {
      vec2 extent = imageSize * max(viewport.x / imageSize.x, viewport.y / imageSize.y);
      return texture2D(scenery, (p - (viewport - extent) * .5) / extent).rgb;
    }
    void main() {
      vec2 p = vec2(gl_FragCoord.x, size.y * pixelRatio - gl_FragCoord.y) / pixelRatio;
      float d = shape(p);
      vec2 n = normalize(vec2(shape(p + vec2(.5, 0.)) - shape(p - vec2(.5, 0.)),
                              shape(p + vec2(0., .5)) - shape(p - vec2(0., .5))) + vec2(.00001));
      float edge = exp(-max(-d, 0.) / 9.);
      vec2 bent = origin + p + n * (edge * 16.);
      vec3 color = sampleScene(bent);
      color.r = sampleScene(bent + n * edge * .7).r;
      color.b = sampleScene(bent - n * edge * .7).b;
      // Local dimming preserves bright labels while retaining crisp image detail.
      color *= .74;
      vec2 direction = normalize(light - p);
      float reflection = pow(max(dot(n, direction), 0.), 5.);
      float rim = exp(-abs(d + 1.2) / 1.2);
      color += vec3(.7, .83, 1.) * edge * reflection * .22;
      color += vec3(1.) * rim * (.16 + reflection * .6);
      gl_FragColor = vec4(color, 1. - smoothstep(-.8, .2, d));
    }`;
  function shader(type: number, source: string) {
    const result = gl!.createShader(type)!;
    gl!.shaderSource(result, source);
    gl!.compileShader(result);
    if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS)) {
      gl!.deleteShader(result);
      return null;
    }
    return result;
  }
  const vs = shader(gl.VERTEX_SHADER, vertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['size', 'origin', 'viewport', 'imageSize', 'light', 'pixelRatio', 'radius'].map(name => [name, gl.getUniformLocation(program, name)]));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const image = new Image();
  let ready = false;
  let frame = 0;
  let pointer: { x: number; y: number } | null = null;
  function draw() {
    frame = 0;
    if (!ready || gl!.isContextLost()) return;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    const width = Math.round(bounds.width * ratio);
    const height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl!.viewport(0, 0, width, height);
    gl!.uniform2f(uniforms.size, bounds.width, bounds.height);
    gl!.uniform2f(uniforms.origin, bounds.left, bounds.top);
    gl!.uniform2f(uniforms.viewport, innerWidth, innerHeight);
    gl!.uniform2f(uniforms.imageSize, image.naturalWidth, image.naturalHeight);
    gl!.uniform2f(uniforms.light, pointer?.x ?? -60, pointer?.y ?? -100);
    gl!.uniform1f(uniforms.pixelRatio, ratio);
    gl!.uniform1f(uniforms.radius, parseFloat(getComputedStyle(element).borderRadius));
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  image.onload = () => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    ready = true;
    element.prepend(canvas);
    element.classList.add('has-lens');
    schedule();
  };
  image.src = new URL('assets/sky-flowers.webp', location.href).href;
  new ResizeObserver(schedule).observe(element);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  element.addEventListener('pointermove', event => {
    if (reducedMotion.matches) return;
    const bounds = element.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    schedule();
  });
  element.addEventListener('pointerleave', () => { pointer = null; schedule(); });
  canvas.addEventListener('webglcontextlost', () => element.classList.remove('has-lens'));
}
