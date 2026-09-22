import * as T from 'three';

// Shared, static density texture: one 64 KiB channel, generated once. The haze
// adds no particles, simulation updates, depth target or postprocessing pass.
function densityTexture() {
  const size = 256, data = new Uint8Array(size * size);
  const lattice = (x, y, period) => {
    const key = Math.imul((x + period) % period + 17, 374761393) ^
      Math.imul((y + period) % period + 37, 668265263);
    let hash = Math.imul(key ^ (key >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x, y, period) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(lattice(ix, iy, period), lattice(ix + 1, iy, period), u),
      T.MathUtils.lerp(lattice(ix, iy + 1, period), lattice(ix + 1, iy + 1, period), u), v);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let value = 0, weight = .56;
    for (let octave = 0; octave < 4; octave++) {
      const period = 4 * (1 << octave);
      value += noise(x / size * period, y / size * period, period) * weight;
      weight *= .5;
    }
    data[y * size + x] = Math.round(T.MathUtils.clamp(value / 1.05, 0, 1) * 255);
  }
  const texture = new T.DataTexture(data, size, size, T.RedFormat);
  texture.name = 'yard-mist-density';
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const densityGLSL = `
  uniform sampler2D yardMistDensity;
  uniform vec3 yardMistColor;
  uniform float yardMistStrength;
  varying vec3 vYardMistPosition;
  float yardMistCloud(vec2 p) {
    float broad = texture2D(yardMistDensity, p * vec2(.006, .009) + vec2(.13, .42)).r;
    float wisps = texture2D(yardMistDensity, p * vec2(.014, .005) + vec2(.61, .07)).r;
    return smoothstep(.18, .82, broad * .72 + wisps * .28);
  }
  float yardMistBanks(vec2 p) {
    float left = exp(-pow((p.x + 42. + p.y * .18) / 22., 2.));
    float right = exp(-pow((p.x - 43. + p.y * .24) / 26., 2.));
    return clamp(left + right, 0., 1.);
  }
`;

/** Art-directed background atmosphere; opt in scenery materials only. */
export function createYardAtmosphereView(scene, { strength = .5, color = 0x1e303e } = {}) {
  const texture = densityTexture();
  const uniforms = {
    yardMistDensity: { value: texture },
    yardMistColor: { value: new T.Color(color) },
    yardMistStrength: { value: strength },
  };
  const bindings = new Map();

  function applyToMaterial(material) {
    if (bindings.has(material)) return;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const baseKey = previousKey.call(material);
    const compile = function(shader, renderer) {
      previous.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vYardMistPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 yardWorld = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          yardWorld = instanceMatrix * yardWorld;
        #endif
        vYardMistPosition = (modelMatrix * yardWorld).xyz;
      `);
      shader.fragmentShader = densityGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
        float yardCloud = yardMistCloud(vYardMistPosition.xz);
        float yardBank = yardMistBanks(vYardMistPosition.xz);
        float yardVeil = yardMistStrength * .22 * (.58 + .42 * yardCloud) * (.7 + .3 * yardBank);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, yardMistColor, yardVeil);
        #include <tonemapping_fragment>
      `);
    };
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = () => baseKey + '|yard-atmosphere-v1';
    material.needsUpdate = true;
    bindings.set(material, { previous, previousKey, compile });
  }

  function applyToObject(root) {
    root.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        applyToMaterial(material);
      }
    });
  }

  // The single soft veil sits below the flight plane. Opaque ship depth hides it;
  // foreground transparent effects are drawn afterwards. Empty space stays dark.
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vYardMistPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        vYardMistPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: densityGLSL + `
      void main() {
        vec2 p = vYardMistPosition.xz;
        float cloud = yardMistCloud(p);
        float banks = yardMistBanks(p);
        float edge = 1. - smoothstep(68., 88., max(abs(p.x), abs(p.y)));
        float alpha = yardMistStrength * banks * (.35 + .72 * cloud) * edge;
        gl_FragColor = vec4(yardMistColor * (.8 + cloud * .4), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const geometry = new T.PlaneGeometry(190, 190);
  const veil = new T.Mesh(geometry, material);
  veil.name = 'yard-atmospheric-veil';
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = -3.5;
  veil.renderOrder = -20;
  scene.add(veil);

  return {
    applyToMaterial,
    applyToObject,
    dispose() {
      scene.remove(veil);
      geometry.dispose();
      material.dispose();
      for (const [bound, { previous, previousKey, compile }] of bindings) {
        if (bound.onBeforeCompile !== compile) continue;
        bound.onBeforeCompile = previous;
        bound.customProgramCacheKey = previousKey;
        bound.needsUpdate = true;
      }
      bindings.clear();
      texture.dispose();
    },
  };
}
