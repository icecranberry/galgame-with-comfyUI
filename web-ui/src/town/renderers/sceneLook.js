import * as T from 'three'
import { withTownOcclusionFade } from './interactionOcclusion.js'
import { authoredSpriteColorShader } from './authoredSpriteColor.js'

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t) }

// Lamp/window glow factor: 0 in daylight, ramps through dusk (17-20) and dawn
// (5-8), full at night. Gloomy overcast keeps a faint daytime glow.
export function nightGlowFactor(hour = 12, rainy = false) {
  if (hour >= 20 || hour < 5) return 1
  if (hour >= 17) return smooth((hour - 17) / 3)
  if (hour < 8) return 1 - smooth((hour - 5) / 3)
  return rainy ? .3 : 0
}

// Shared look: directional daylight is much stronger than the cool ambient fill.
// Night leans on a punchier blue moon against a much darker fill — the old flat
// ambient washed the streets out, so shadows now go deep while moon-facing
// facades stay readable.
export function daylightLook(hour = 12, rainy = false) {
  const night = hour >= 20 || hour < 5
  const dusk = !night && (hour >= 17 || hour < 8)
  return {
    night, glow: nightGlowFactor(hour, rainy),
    // Overcast may light lamps during the day, but must not dim painted cards.
    daylight: 1 - nightGlowFactor(hour),
    sun: night ? 1.55 : rainy ? 2.0 : 3.8,
    ambient: night ? .22 : rainy ? 1.05 : .9,
    color: night ? '#9db9f0' : dusk ? '#ffba73' : '#fff5df',
    sky: night ? '#41566e' : rainy ? '#b0c5ca' : '#c9e4ed',
    fillGround: night ? '#3d4350' : '#9a967b',
    fog: night ? '#1d2f3b' : rainy ? '#b5c9c6' : '#c5ddd2',
    // Side/back light throws readable diagonal shadows across the street.
    offset: new T.Vector3(-24 + Math.sin(hour / 24 * Math.PI * 2) * 5, dusk ? 15 : night ? 24 : 26, 12),
  }
}

export function townMaterial(kind, options = {}) {
  const material = new T.MeshLambertMaterial(options)
  const paintedCard = kind === 'agent' || kind === 'building'
  if (paintedCard) material.userData.townDaylight = { value: 1 }
  if (kind === 'agent') {
    material.userData.townExposure = { value: 1.25 }
    material.userData.townSpriteWhite = { value: .95 }
  }
  if (kind === 'lamp') material.userData.townGlow = { value: 0 }
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTownWorld; varying vec2 vTownUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 townPosition = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        townPosition = instanceMatrix * townPosition;
        #endif
        vTownWorld = (modelMatrix * townPosition).xyz; vTownUv = uv;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTownWorld; varying vec2 vTownUv;')
    if (kind === 'ground') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float townLuma = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
        float variation = .98 + .04*sin(vTownWorld.x*.63+sin(vTownWorld.z*.49)) + .025*sin(vTownWorld.z*1.8+vTownWorld.x*.31);
        diffuseColor.rgb = mix(vec3(townLuma), diffuseColor.rgb, .94) * variation;`)
    } else {
      // Preserve the existing night shading. Buildings receive a neutral daylight
      // fill; character daylight is calibrated to the authored display color below.
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * ${kind === 'building'
          ? 'mix(.22 + .07*smoothstep(.52,.86,vTownUv.y), .65, townDaylight)'
          : '.30'};
        diffuseColor.rgb *= ${kind === 'building'
          ? 'mix(mix(.76,1.,smoothstep(0.,.28,vTownUv.y)), mix(.96,1.,smoothstep(0.,.28,vTownUv.y)), townDaylight)'
          : 'mix(.76,1.,smoothstep(0.,.28,vTownUv.y))'};`)
      if (paintedCard) {
        shader.uniforms.townDaylight = material.userData.townDaylight
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float townDaylight;')
      }
      if (kind === 'agent') {
        shader.uniforms.townExposure = material.userData.townExposure
        shader.uniforms.townSpriteWhite = material.userData.townSpriteWhite
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${authoredSpriteColorShader}`)
          .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 townAuthoredColor = diffuseColor.rgb;')
          .replace('#include <opaque_fragment>', `
            outgoingLight = mix(outgoingLight, townSpriteRadiance(townAuthoredColor), townDaylight);
            #include <opaque_fragment>`)
      }
      if (kind === 'building') {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          reflectedLight.directDiffuse *= mix(1., .55, townDaylight);`)
        // Fixed-view relief normals approximate the two facades and roof of legacy
        // isometric artwork; the actual shadow caster remains the footprint prism.
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          // Legacy artwork has no authored normal map: a hard UV split cuts
          // arbitrary roofs in half. Blend only the lighting normal, not pixels.
          float facadeBlend = smoothstep(.35,.71,vTownUv.x);
          vec3 facade = normalize(mix(vec3(0.,0.,1.),vec3(1.,0.,0.),facadeBlend));
          vec3 roof = normalize(vec3(.25,.92,.30));
          vec3 reliefNormal = normalize(mix(facade,roof,smoothstep(.45,.82,vTownUv.y)));
          normal = normalize((viewMatrix * vec4(reliefNormal,0.)).xyz);`)
      }
      if (kind === 'lamp') {
        shader.uniforms.townGlow = material.userData.townGlow
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float townGlow;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float glass = smoothstep(.08,.32,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))) * smoothstep(.65,.85,vTownUv.y);
            totalEmissiveRadiance += vec3(2.6,1.18,.32) * glass * townGlow;`)
      }
    }
  }
  material.customProgramCacheKey = () => `town-cinematic-v8-${kind}`
  return withTownOcclusionFade(material)
}

// Shared soft radial falloff for fake light spill and halos (additive quads).
let glowTexture = null
export function townGlowTexture() {
  if (!glowTexture) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,.85)')
    g.addColorStop(.3, 'rgba(255,255,255,.4)')
    g.addColorStop(.65, 'rgba(255,255,255,.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    glowTexture = new T.CanvasTexture(canvas)
    glowTexture.colorSpace = T.SRGBColorSpace
  }
  return glowTexture
}

const glowMaterial = (color, depthTest) => new T.MeshBasicMaterial({
  map: townGlowTexture(), color, transparent: true, opacity: 0,
  blending: T.AdditiveBlending, depthWrite: false, depthTest, fog: false,
})

// Warm light spill on the ground under a lit source (lamps, building doorways).
export function makeLightPool(size, color = '#ffb45e') {
  const mesh = new T.Mesh(new T.PlaneGeometry(size, size), glowMaterial(color, true))
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 90 // above the world volumes, below the 100+ painter cards
  return mesh
}

// Glow billboard at the light source itself. The iso camera is fixed, so the
// same π/4 card facing the sprites use faces it exactly.
export function makeLightHalo(size, color = '#ffd9a0') {
  const mesh = new T.Mesh(new T.PlaneGeometry(size, size), glowMaterial(color, true))
  mesh.rotation.y = Math.PI / 4
  mesh.renderOrder = 90
  return mesh
}

// Occlusion under an existing object, on the ground only. It does not block walking.
export function makeContactShadow(width, depth, strength = 0.42) {
  const mesh = new T.Mesh(new T.PlaneGeometry(width, depth), new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { strength: { value: strength } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv; uniform float strength;
      void main(){vec2 d=abs(vUv-.5)*2.;float a=1.-smoothstep(.35,1.,pow(pow(d.x,4.)+pow(d.y,4.),.25));gl_FragColor=vec4(.035,.047,.035,a*strength);}`,
  }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

export function buildingShadowGeometry(width, depth, height) {
  // A gabled prism (walls + roof) gives one coherent architectural shadow.
  const w = width / 2, d = depth / 2, eave = height * .68
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute([
    -w,0,-d, w,0,-d, w,eave,-d, 0,height,-d, -w,eave,-d,
    -w,0,d, w,0,d, w,eave,d, 0,height,d, -w,eave,d,
  ], 3))
  geometry.setIndex([0,2,1,0,4,2,4,3,2, 5,6,7,5,7,9,9,7,8,
    0,1,6,0,6,5, 1,2,7,1,7,6, 2,3,8,2,8,7, 3,4,9,3,9,8, 4,0,5,4,5,9])
  geometry.computeVertexNormals()
  return geometry
}
