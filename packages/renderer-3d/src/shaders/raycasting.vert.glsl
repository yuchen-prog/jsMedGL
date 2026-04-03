// Raycasting vertex Shader - Full-screen quad
// Outputs screen-space position and ray direction for fragment shader

attribute vec2 a_position;

uniform mat4 u_inverseViewMatrix;
uniform vec3 u_cameraPosition;

varying vec3 v_rayOrigin;
varying vec3 v_rayDir;

void main() {
  // Screen position in [-1, 1]
  vec2 ndc = a_position;

  // Convert to texture space direction using inverse view matrix
  // Build ray direction from camera through this pixel
  float fovScale = tan(0.785398); // ~45 degree half FOV

  float aspect = 1.0; // Will be overridden by uniform if needed

  // Get camera basis vectors from inverse view matrix
  vec3 right = vec3(u_inverseViewMatrix[0][0], u_inverseViewMatrix[1][0], u_inverseViewMatrix[2][0]);
  vec3 up = vec3(u_inverseViewMatrix[0][1], u_inverseViewMatrix[1][1], u_inverseViewMatrix[2][1]);
  vec3 forward = vec3(-u_inverseViewMatrix[0][2], -u_inverseViewMatrix[1][2], -u_inverseViewMatrix[2][2]);

  // Compute ray direction
  vec3 dir = normalize(forward + right * ndc.x * aspect * fovScale + up * ndc.y * fovScale);

  v_rayOrigin = u_cameraPosition;
  v_rayDir = dir;

  gl_Position = vec4(a_position, 0.0, 1.0);
}
