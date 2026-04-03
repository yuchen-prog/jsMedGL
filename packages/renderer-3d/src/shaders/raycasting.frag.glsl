// Raycasting Fragment Shader - GPU volume rendering
// Implements: standard compositing, MIP, MinIP, average, gradient lighting (Phong)

precision highp float;

// Volume texture (3D)
uniform sampler3D u_volumeTexture;

// Transfer function LUTs
uniform sampler2D u_colorLUT;    // 256x1 RGB
uniform sampler2D u_opacityLUT;  // 256x1 R

// Ray parameters (computed in vertex shader)
varying vec3 v_rayOrigin;
varying vec3 v_rayDir;

// Window / Level
uniform float u_window;
uniform float u_level;

// Rendering config
uniform int u_compositingMode;   // 0=standard, 1=MIP, 2=MinIP, 3=Average
uniform float u_stepSize;
uniform int u_maxSteps;
uniform bool u_gradientLighting;
uniform vec3 u_lightDir;

// Constants
const vec3 BOX_MIN = vec3(0.0);
const vec3 BOX_MAX = vec3(1.0);
const float EPSILON = 0.001;

// ============================================
// Ray-Box Intersection (Slab Method)
// ============================================
vec2 intersectBox(vec3 rayOrigin, vec3 rayDir) {
  vec3 invDir = 1.0 / rayDir;
  vec3 t0 = (BOX_MIN - rayOrigin) * invDir;
  vec3 t1 = (BOX_MAX - rayOrigin) * invDir;
  vec3 tNear = min(t0, t1);
  vec3 tFar = max(t0, t1);
  float tN = max(max(tNear.x, tNear.y), tNear.z);
  float tF = min(min(tFar.x, tFar.y), tFar.z);
  return vec2(tN, tF);
}

// ============================================
// Gradient Computation (Central Difference)
// Only used when u_gradientLighting is true
// and u_compositingMode == 0 (standard)
// ============================================
vec3 computeGradient(vec3 pos) {
  float step = 0.002; // texture space epsilon
  float left  = texture(u_volumeTexture, pos - vec3(step, 0.0, 0.0)).r;
  float right = texture(u_volumeTexture, pos + vec3(step, 0.0, 0.0)).r;
  float down  = texture(u_volumeTexture, pos - vec3(0.0, step, 0.0)).r;
  float up    = texture(u_volumeTexture, pos + vec3(0.0, step, 0.0)).r;
  float back  = texture(u_volumeTexture, pos - vec3(0.0, 0.0, step)).r;
  float front = texture(u_volumeTexture, pos + vec3(0.0, 0.0, step)).r;
  return vec3(right - left, up - down, front - back);
}

// ============================================
// Phong Lighting (Simplified)
// ============================================
vec3 applyLighting(vec3 color, vec3 gradient) {
  vec3 normal = -normalize(gradient);
  float diffuse = max(dot(normal, normalize(u_lightDir)), 0.0);
  return color * (0.3 + 0.7 * diffuse);
}

// ============================================
// Main
// ============================================
void main() {
  vec3 rayDir = normalize(v_rayDir);
  vec3 rayOrigin = v_rayOrigin;

  // 1. Ray-box intersection
  vec2 hit = intersectBox(rayOrigin, rayDir);
  float tNear = hit.x;
  float tFar = hit.y;

  // No intersection
  if (tNear > tFar || tFar < 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Clamp tNear to 0 if camera is inside the box
  tNear = max(tNear, 0.0);

  // 2. Compute ray entry/exit points
  vec3 entryPoint = rayOrigin + rayDir * tNear;
  vec3 exitPoint = rayOrigin + rayDir * tFar;
  float rayLength = distance(entryPoint, exitPoint);

  float numSteps = min(rayLength / u_stepSize, float(u_maxSteps));
  if (numSteps < 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec3 step = rayDir * u_stepSize;
  vec3 currentPos = entryPoint;

  // Accumulators
  vec4 accumulated = vec4(0.0);
  float maxIntensity = 0.0;
  float minIntensity = 1.0;
  float sumIntensity = 0.0;
  int actualSteps = 0;

  bool enableLighting = u_gradientLighting && u_compositingMode == 0;

  // 3. Ray marching loop
  for (int i = 0; i < 512; i++) {
    if (float(i) >= numSteps) break;

    // Sample volume
    float intensity = texture(u_volumeTexture, currentPos).r;

    // Window/Level mapping
    float windowed = (intensity - u_level) / u_window + 0.5;
    windowed = clamp(windowed, 0.0, 1.0);

    // MIP / MinIP / Average accumulation
    if (intensity > maxIntensity) maxIntensity = intensity;
    if (intensity < minIntensity) minIntensity = intensity;
    sumIntensity += intensity;
    actualSteps++;

    // Standard compositing (front-to-back)
    if (u_compositingMode == 0) {
      // Color lookup from transfer function
      vec3 color = texture(u_colorLUT, vec2(windowed, 0.5)).rgb;
      float opacity = texture(u_opacityLUT, vec2(windowed, 0.5)).r;

      // Gradient lighting (6 extra texture samples)
      if (enableLighting && opacity > 0.01) {
        vec3 gradient = computeGradient(currentPos);
        if (length(gradient) > 0.001) {
          color = applyLighting(color, gradient);
        }
      }

      // Front-to-back compositing
      accumulated.rgb += color * opacity * (1.0 - accumulated.a);
      accumulated.a += opacity * (1.0 - accumulated.a);

      // Early ray termination
      if (accumulated.a > 0.99) break;
    }

    currentPos += step;
  }

  // 4. Final output based on compositing mode
  if (u_compositingMode == 1) {
    // MIP
    float w = (maxIntensity - u_level) / u_window + 0.5;
    w = clamp(w, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else if (u_compositingMode == 2) {
    // MinIP
    float w = (minIntensity - u_level) / u_window + 0.5;
    w = clamp(w, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else if (u_compositingMode == 3) {
    // Average
    float avg = sumIntensity / max(float(actualSteps), 1.0);
    float w = (avg - u_level) / u_window + 0.5;
    w = clamp(w, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else {
    // Standard compositing
    gl_FragColor = accumulated;
  }
}
