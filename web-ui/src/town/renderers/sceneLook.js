import * as T from 'three'
import { withTownOcclusionFade } from './interactionOcclusion.js'
import { authoredSpriteColorShader } from './authoredSpriteColor.js'

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t) }
const wrapHour = hour => Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12
const mix = (a, b, t) => a + (b - a) * t
const mixColor = (a, b, t) => new T.Color(a).lerp(new T.Color(b), t)

// Advance the town's zoned wall clock between snapshots, using the caller's
// server-adjusted UTC time. Do not replace it with the browser's time zone.
export function daylightHour(weather, now = Date.now()) {
  if (Number.isFinite(weather?.minuteOfDay) && Number.isFinite(weather?.sampledAt)) {
    const subMinute = ((weather.sampledAt % 60000) + 60000) % 60000
    return wrapHour(weather.minuteOfDay / 60 + (subMinute + now - weather.sampledAt) / 3600000)
  }
  // Explicit hours remain deterministic for older snapshots and render previews.
  if (Number.isFinite(weather?.hour)) return wrapHour(weather.hour)
  const date = new Date(now)
  return wrapHour(date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3600000)
}

// Lamp/window glow factor: 0 in daylight, ramps through dusk (17-20) and dawn
// (5-8), full at night. Gloomy overcast keeps a faint daytime glow.
export function nightGlowFactor(hour = 12, rainy = false) {
  hour = wrapHour(hour)
  const night = hour >= 20 || hour < 5 ? 1
    : hour >= 17 ? smooth((hour - 17) / 3)
    : hour < 8 ? 1 - smooth((hour - 5) / 3) : 0
  return Math.max(night, rainy ? .3 : 0)
}

// Shared look: directional daylight is much stronger than the cool ambient fill.
// Night leans on a punchier blue moon against a much darker fill — the old flat
// ambient washed the streets out, so shadows now go deep while moon-facing
// facades stay readable.
export function daylightLook(hour = 12, rainy = false) {
  hour = wrapHour(hour)
  const night = hour >= 20 || hour < 5
  const moon = nightGlowFactor(hour), daylight = 1 - moon
  const angle = (hour - 12) / 24 * Math.PI * 2
  const sin = Math.sin(angle), cos = Math.cos(angle)
  return {
    night, glow: nightGlowFactor(hour, rainy),
    // Overcast may light lamps during the day, but must not dim painted cards.
    daylight,
    sun: mix(rainy ? 2.0 : 3.8, 1.55, moon),
    ambient: mix(rainy ? 1.05 : .9, .22, moon),
    color: mixColor('#9db9f0', '#ffba73', smooth(daylight * 2))
      .lerp(new T.Color('#fff5df'), smooth((daylight - .5) * 2)),
    sky: mixColor(rainy ? '#b0c5ca' : '#c9e4ed', '#41566e', moon),
    fillGround: mixColor('#9a967b', '#3d4350', moon),
    fog: mixColor(rainy ? '#b5c9c6' : '#c5ddd2', '#1d2f3b', moon),
    shadowOpacity: mix(rainy ? .30 : .52, .25, moon),
    // One stylized sun/moon orbit, continuous even at midnight and handoff.
    // Low dawn/dusk elevation lengthens shadows; the positive floor prevents
    // infinite projections. Noon retains the existing diagonal light bearing.
    offset: new T.Vector3(-24 * cos - 12 * sin, 12 + 26 * cos * cos, 12 * cos - 24 * sin),
  }
}

export function townMaterial(kind, options = {}) {
  const material = new T.MeshLambertMaterial(options)
  const paintedCard = ['agent', 'building', 'prop', 'lamp'].includes(kind)
  if (paintedCard) {
    material.userData.townDaylight = { value: 1 }
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
      // Retain the existing night shading. All painted cards share the authored
      // daylight color below; their source artwork already contains its shading.
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
        shader.uniforms.townExposure = material.userData.townExposure
        shader.uniforms.townSpriteWhite = material.userData.townSpriteWhite
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${authoredSpriteColorShader}`)
          .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 townAuthoredColor = diffuseColor.rgb;')
          .replace('#include <opaque_fragment>', `
            outgoingLight = mix(outgoingLight, townSpriteRadiance(townAuthoredColor)${kind === 'lamp' ? ' + townLampEmission' : ''}, townDaylight);
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
            // Keep the lamp's actual emission, including faint overcast glow.
            vec3 townLampEmission = vec3(2.6,1.18,.32) * glass * townGlow;
            totalEmissiveRadiance += townLampEmission;`)
      }
    }
  }
  material.customProgramCacheKey = () => `town-cinematic-v9-${kind}`
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
