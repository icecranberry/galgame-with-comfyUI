import * as T from 'three'
import { withTownOcclusionFade } from './interactionOcclusion.js'

// Shared look: directional daylight is much stronger than the cool ambient fill.
export function daylightLook(hour = 12, rainy = false) {
  const night = hour >= 20 || hour < 5
  const dusk = !night && (hour >= 17 || hour < 8)
  return {
    night, sun: night ? 1.05 : rainy ? 2.0 : 3.8,
    ambient: night ? 0.35 : rainy ? 1.05 : 0.9,
    color: night ? '#b2cafa' : dusk ? '#ffba73' : '#fff5df',
    sky: night ? '#51687e' : rainy ? '#b0c5ca' : '#c9e4ed',
    fog: night ? '#263c48' : rainy ? '#b5c9c6' : '#c5ddd2',
    // Side/back light throws readable diagonal shadows across the street.
    offset: new T.Vector3(-24 + Math.sin(hour / 24 * Math.PI * 2) * 5, dusk ? 15 : night ? 24 : 26, 12),
  }
}

export function townMaterial(kind, options = {}) {
  const material = new T.MeshLambertMaterial(options)
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
      // Authored legacy cards already contain painted shading. Preserve that detail
      // under backlight, with a modest roof lift and darker wall roots.
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * ${kind === 'building' ? '(.22 + .07*smoothstep(.52,.86,vTownUv.y))' : '.30'};
        diffuseColor.rgb *= mix(.76,1.,smoothstep(0.,.28,vTownUv.y));`)
      if (kind === 'building') {
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
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float glass = smoothstep(.08,.32,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))) * smoothstep(.65,.85,vTownUv.y);
          totalEmissiveRadiance += vec3(2.3,1.05,.28) * glass;`)
      }
    }
  }
  material.customProgramCacheKey = () => `town-cinematic-v4-${kind}`
  return withTownOcclusionFade(material)
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
