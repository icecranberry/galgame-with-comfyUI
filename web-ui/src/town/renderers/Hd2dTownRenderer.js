import * as T from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { TiltShiftPass } from './TiltShiftPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { PIXELS_PER_UNIT, isoToGround, inMap } from './projection.js'
import { adaptObject, assetUrl, groundUvs, renderMeta } from './TownSceneAdapter.js'
import { sortCards, cardOccludesAgent } from './cardLayers.js'
import { imageFootV } from './imageAlpha.js'
import { roadEdges } from './terrainEdges.js'
import { daylightLook, townMaterial, makeContactShadow, buildingShadowGeometry } from './sceneLook.js'
import { deriveGroundImage, GROUND_DERIVATIVE_VERSION } from './groundTexture.js'

export function configureCamera(camera, state, width, height) {
  const target = isoToGround(state.x, state.y)
  const scale = PIXELS_PER_UNIT * state.zoom
  camera.left = -width / (2 * scale); camera.right = width / (2 * scale)
  camera.top = height / (2 * scale); camera.bottom = -height / (2 * scale)
  // Fixed 30-degree elevation and 45-degree yaw: legacy 2:1 projection.
  camera.position.set(target.x + 100, Math.sqrt(2 / 3) * 100, target.z + 100)
  camera.lookAt(target.x, 0, target.z)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld()
}

function freeMesh(mesh) {
  if (mesh.userData.projectedShadow) freeMesh(mesh.userData.projectedShadow)
  if (mesh.userData.contact) freeMesh(mesh.userData.contact)
  if (mesh.userData.shadowProxy) freeMesh(mesh.userData.shadowProxy)
  mesh.userData.placeholder?.texture.dispose()
  mesh.geometry?.dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const material of materials) material?.dispose()
  mesh.customDepthMaterial?.dispose()
  mesh.removeFromParent()
}

export class Hd2dTownRenderer {
  constructor({ onFailure } = {}) {
    this.onFailure = onFailure
    this.renderer = new T.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' })
    this.renderer.setClearColor('#a6b8ab')
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = T.PCFSoftShadowMap
    this.scene = new T.Scene()
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
    this.fill = new T.HemisphereLight('#a0b8bb', '#9a967b', 0.62)
    this.scene.fog = new T.Fog('#a6b8ab', 175, 220)
    this.sun = new T.DirectionalLight('#fff0d0', 1.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0002
    this.sun.shadow.normalBias = 0.035
    this.scene.add(this.fill, this.sun, this.sun.target)
    this.chunks = new Map(); this.objects = new Map(); this.agents = new Map(); this.textures = new Map()
    this.ray = new T.Raycaster(); this.groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0)
    this.width = 1; this.height = 1; this.quality = 'balanced'; this.tilt = true
    const target = new T.WebGLRenderTarget(1, 1, { type: this.renderer.extensions.has('EXT_color_buffer_float') ? T.HalfFloatType : T.UnsignedByteType })
    target.samples = Math.min(4, this.renderer.capabilities.maxSamples)
    target.depthTexture = new T.DepthTexture(1, 1)
    this.composer = new EffectComposer(this.renderer, target)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.tiltPass = new TiltShiftPass()
    this.composer.addPass(this.tiltPass)
    this.composer.addPass(new OutputPass())
    this.contextLost = event => { event.preventDefault(); this.onFailure?.('显卡连接中断，已切换为兼容画面') }
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost)
  }
  mount(container) {
    const canvas = this.renderer.domElement
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    container.prepend(canvas)
  }
  setScene(scene) { this.map = scene; this.sceneDirty = true }
  setCamera(state) { this.cameraState = { ...state }; configureCamera(this.camera, state, this.width, this.height) }
  setQuality(preset, tilt = true) {
    this.quality = preset === 'low' ? 'low' : 'balanced'; this.tilt = tilt
    this.renderer.shadowMap.enabled = true
    const shadowSize = this.quality === 'low' ? 1024 : 2048
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize)
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null
    }
    this.resize(this.width, this.height, this.dpr || 1)
  }
  resize(width, height, dpr) {
    this.width = width; this.height = height; this.dpr = dpr
    this.renderer.setPixelRatio(Math.min(dpr, this.quality === 'low' ? 1 : 1.5))
    this.renderer.setSize(width, height, false)
    // The composite stays full-resolution; TiltShiftPass owns the half-size blur buffers.
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(width, height)
    if (this.cameraState) this.setCamera(this.cameraState)
  }
  texture(url, filter = 'nearest', groundAsset = null) {
    if (!url) return null
    const key = `${filter}:${url}:${groundAsset ? JSON.stringify([GROUND_DERIVATIVE_VERSION, groundAsset.kind, groundAsset.meta]) : 'card'}`
    let entry = this.textures.get(key)
    if (!entry) {
      entry = { ready: false, texture: null, alpha: null }
      this.textures.set(key, entry)
      entry.texture = new T.TextureLoader().load(url, () => {
        if (this.disposed) { entry.texture.dispose(); return }
        if (groundAsset) {
          entry.texture.image = deriveGroundImage(entry.texture.image, groundAsset)
          entry.texture.needsUpdate = true
        }
        entry.ready = true; this.sceneDirty = true
      }, undefined, () => { entry.failed = true })
      entry.texture.colorSpace = T.SRGBColorSpace
      entry.texture.magFilter = filter === 'linear' ? T.LinearFilter : T.NearestFilter
      entry.texture.minFilter = filter === 'linear' ? T.LinearMipmapLinearFilter : T.NearestFilter
      entry.texture.generateMipmaps = filter === 'linear'
    }
    entry.used = this.frame || 0
    return entry
  }
  groundGeometry(asset, texture) {
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.Float32BufferAttribute([0,0,0, 1,0,0, 1,0,1, 0,0,1], 3))
    geo.setAttribute('uv', new T.Float32BufferAttribute(groundUvs(asset, texture?.image?.width, texture?.image?.height).flat(), 2))
    geo.setIndex([0,2,1,0,3,2]); geo.computeVertexNormals()
    return geo
  }
  syncScene() {
    const m = this.map
    const assets = new Map((m?.assets || []).map(a => [a.id, a]))
    const live = new Set()
    // One instanced draw per asset/layer/16x16 chunk; edit only rebuilds changed chunks.
    for (const [layerIndex, layer] of ['ground', 'road'].entries()) {
      for (let y0 = 0; y0 < (m?.rows || 0); y0 += 16) for (let x0 = 0; x0 < m.cols; x0 += 16) {
        const groups = new Map()
        for (let y = y0; y < Math.min(y0 + 16, m.rows); y++) for (let x = x0; x < Math.min(x0 + 16, m.cols); x++) {
          const id = m.layers?.[layer]?.[y]?.[x]
          if (!id && layerIndex) continue
          if (!groups.has(id)) groups.set(id, [])
          groups.get(id).push([x, y])
        }
        for (const [id, cells] of groups) {
          const asset = assets.get(id), meta = renderMeta(asset)
          const entry = this.texture(assetUrl(asset), meta.textureFilter, asset)
          const texture = entry?.ready ? entry.texture : null
          const key = `${layer}:${x0}:${y0}:${id}`; live.add(key)
          const signature = JSON.stringify([cells, asset?.meta, assetUrl(asset), !!texture])
          if (this.chunks.get(key)?.userData.signature === signature) continue
          if (this.chunks.has(key)) freeMesh(this.chunks.get(key))
          const material = townMaterial('ground', { map: texture, color: texture ? asset?.kind === 'ground' ? '#e1edc6' : '#f2e8d5' : '#8a9465', alphaTest: 0.08, polygonOffset: !!layerIndex, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
          const mesh = new T.InstancedMesh(this.groundGeometry(asset, texture), material, cells.length)
          const matrix = new T.Matrix4()
          cells.forEach(([x,y], i) => mesh.setMatrixAt(i, matrix.makeTranslation(x, layerIndex * 0.008, y)))
          mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true
          mesh.userData.signature = signature; this.chunks.set(key, mesh); this.scene.add(mesh)
        }
      }
    }
    for (const [key, mesh] of this.chunks) if (!live.has(key)) { freeMesh(mesh); this.chunks.delete(key) }
    const objectKeys = new Set()
    for (const [index, obj] of (m?.layers?.objects || []).entries()) {
      const key = obj.id ?? index; objectKeys.add(key)
      const dto = adaptObject(obj, assets.get(obj.assetId))
      this.updateCard(this.objects, key, dto, false)
    }
    for (const [key, mesh] of this.objects) if (!objectKeys.has(key)) { freeMesh(mesh); this.objects.delete(key) }
    const edges = roadEdges(m)
    const edgeSignature = JSON.stringify(edges)
    if (this.curbs?.userData.signature !== edgeSignature) {
      if (this.curbs) freeMesh(this.curbs)
      const curb = new T.InstancedMesh(new T.BoxGeometry(.965, .10, .07), new T.MeshLambertMaterial({ color: '#8c8164' }), edges.length)
      const matrix = new T.Matrix4(), turn = new T.Quaternion(), pos = new T.Vector3(), scale = new T.Vector3(1,1,1)
      edges.forEach((edge,i) => { turn.setFromAxisAngle(new T.Vector3(0,1,0), edge.turn ? Math.PI/2 : 0); pos.set(edge.x,.02,edge.z); curb.setMatrixAt(i,matrix.compose(pos,turn,scale)) })
      curb.instanceMatrix.needsUpdate = true; curb.castShadow = true; curb.receiveShadow = true
      curb.userData.signature = edgeSignature; this.scene.add(curb); this.curbs = curb
    }
    this.syncSurroundings(assets)
    this.sceneDirty = false
  }
  syncSurroundings(assets) {
    if (!this.map) { if (this.surroundings) freeMesh(this.surroundings); this.surroundings = null; return }
    const counts = new Map()
    for (const row of this.map.layers?.ground || []) for (const id of row || []) if (id) counts.set(id, (counts.get(id) || 0) + 1)
    const id = [...counts].sort((a,b) => b[1]-a[1])[0]?.[0], asset = assets.get(id)
    const entry = this.texture(assetUrl(asset), 'nearest', asset)
    const texture = entry?.ready ? entry.texture : null
    const signature = JSON.stringify([this.map.cols, this.map.rows, assetUrl(asset), !!texture])
    if (this.surroundings?.userData.signature === signature) return
    if (this.surroundings) freeMesh(this.surroundings)
    const margin = 20, cells = []
    for (let y = -margin; y < this.map.rows + margin; y++) for (let x = -margin; x < this.map.cols + margin; x++) {
      if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) cells.push([x,y])
    }
    const mesh = new T.InstancedMesh(this.groundGeometry(asset, texture), townMaterial('ground', { map: texture, color: '#e1edc6' }), cells.length)
    const matrix = new T.Matrix4()
    cells.forEach(([x,y], i) => mesh.setMatrixAt(i, matrix.makeTranslation(x, 0, y)))
    mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true
    mesh.userData.signature = signature; this.scene.add(mesh); this.surroundings = mesh
  }
  updateCard(collection, key, dto, isAgent) {
    const meta = isAgent ? { alphaCutoff: 0.3, textureFilter: 'linear', anchor: { u: 0.5, v: 1 } } : dto.render
    const materialKind = isAgent ? 'agent' : dto.asset?.kind === 'building' ? 'building' : /lamp|灯/.test(`${dto.asset?.key || ''} ${dto.asset?.name || ''}`) ? 'lamp' : 'prop'
    const candidates = (isAgent ? dto.urls || [dto.url] : [dto.url]).map(url => this.texture(url, meta.textureFilter)).filter(Boolean)
    let entry = candidates.find(e => e.ready) || candidates[0]
    let map = entry?.ready ? entry.texture : null
    let mesh = collection.get(key)
    if (mesh && mesh.userData.materialKind !== materialKind) { freeMesh(mesh); collection.delete(key); mesh = null }
    if (!mesh) {
      mesh = new T.Mesh(new T.PlaneGeometry(1, 1), townMaterial(materialKind, { side: T.DoubleSide, alphaTest: meta.alphaCutoff, transparent: true, depthTest: false, depthWrite: true }))
      mesh.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, side: T.DoubleSide, alphaTest: meta.alphaCutoff })
      mesh.rotation.y = Math.PI / 4
      mesh.castShadow = true; mesh.receiveShadow = true
      this.scene.add(mesh); collection.set(key, mesh)
      if (isAgent) {
        const contact = new T.Mesh(new T.PlaneGeometry(0.65, 0.45), new T.ShaderMaterial({
          transparent: true, depthWrite: false,
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
          fragmentShader: 'varying vec2 vUv;void main(){float a=(1.-smoothstep(0.15,0.5,length(vUv-0.5)))*0.24;gl_FragColor=vec4(0.16,0.12,0.09,a);}',
        }))
        contact.rotation.x = -Math.PI / 2; this.scene.add(contact)
        mesh.userData.contact = contact
      }
    }
    if (!map && isAgent) {
      const name = dto.agent.displayName || '我'
      if (mesh.userData.placeholder?.name !== name) {
        mesh.userData.placeholder?.texture.dispose()
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#e07b6c'; ctx.beginPath(); ctx.arc(32,32,30,0,Math.PI*2); ctx.fill()
        ctx.strokeStyle = '#fffaf2'; ctx.lineWidth = 3; ctx.stroke()
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name.charAt(0),32,33)
        const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace
        mesh.userData.placeholder = { name, texture, ready: true }
      }
      entry = mesh.userData.placeholder; map = entry.texture
    }
    if (mesh.material.map !== map) {
      mesh.material.map = map; mesh.material.needsUpdate = true
      mesh.customDepthMaterial.map = map; mesh.customDepthMaterial.needsUpdate = true
    }
    mesh.material.alphaToCoverage = isAgent
    mesh.material.alphaTest = mesh.customDepthMaterial.alphaTest = meta.alphaCutoff
    mesh.material.color.set(map ? '#ffffff' : isAgent ? '#e07b6c' : '#b4a08c')
    const ratio = map ? map.image.width / map.image.height : (isAgent ? 0.65 : 1)
    const projectedHeight = isAgent ? (entry === mesh.userData.placeholder ? 48 : 72) : dto.width / ratio
    const h = meta.worldHeight || projectedHeight / (PIXELS_PER_UNIT * Math.cos(Math.PI / 6))
    const w = isAgent ? projectedHeight * ratio / PIXELS_PER_UNIT : dto.width / PIXELS_PER_UNIT
    // Legacy props have transparent padding below their painted base. Place that
    // visible foot on the ground, compensating along the view axis so the artwork
    // stays at the same screen position. Authored anchors and buildings are retained.
    const footV = !isAgent && materialKind !== 'building' && meta.autoFoot && map
      ? imageFootV(map.image, meta.alphaCutoff) : meta.anchor.v
    const padding = h * (meta.anchor.v - footV)
    const groundShift = padding * Math.cos(Math.PI / 6) * Math.SQRT2
    mesh.scale.set(dto.flip ? -w : w, h, 1)
    mesh.position.set(dto.ground.x - groundShift, 0, dto.ground.z - groundShift)
    // Instance anchor uses image coordinates (v=1 is the image bottom).
    mesh.position.x += (0.5 - meta.anchor.u) * w / Math.SQRT2
    mesh.position.z -= (0.5 - meta.anchor.u) * w / Math.SQRT2
    mesh.position.y = h * (footV - 0.5) + (isAgent ? (dto.bob || 0) / (PIXELS_PER_UNIT * Math.cos(Math.PI / 6)) : 0)
    mesh.castShadow = meta.shadowMode !== 'none'
    let contact = mesh.userData.contact, shadowProxy = mesh.userData.shadowProxy
    let projectedShadow = mesh.userData.projectedShadow
    const fp = dto.asset?.meta?.footprint
    if (!isAgent && materialKind !== 'building' && meta.shadowMode !== 'volume') {
      if (!projectedShadow) {
        projectedShadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: '#26352b', transparent: true, opacity: .52, depthWrite: false, side: T.DoubleSide, alphaTest: .05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
        // Sample only source alpha: painted greens/flowers must not tint the shadow.
        projectedShadow.material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = vec3(.028,.045,.033);')
        }
        projectedShadow.material.customProgramCacheKey = () => 'town-prop-shadow-alpha'
        projectedShadow.frustumCulled = false
        this.scene.add(projectedShadow)
      }
      if (projectedShadow.material.map !== map) { projectedShadow.material.map = map; projectedShadow.material.needsUpdate = true }
      projectedShadow.visible = meta.shadowMode !== 'none' && !!map
      mesh.castShadow = false
      const width = Math.min(w * .72, (fp?.w || 1) * 1.15)
      const signature = `prop:${width}`
      if (contact?.userData.signature !== signature) {
        if (contact) freeMesh(contact)
        contact = makeContactShadow(width, width * .6, .32)
        contact.userData.signature = signature; this.scene.add(contact)
      }
      contact.position.set(dto.ground.x - groundShift, .021, dto.ground.z - groundShift)
      if (shadowProxy) { freeMesh(shadowProxy); shadowProxy = null }
    } else if (!isAgent && fp?.w > 0 && fp?.h > 0) {
      const contactSignature = `${fp.w}:${fp.h}`
      if (contact?.userData.signature !== contactSignature) {
        if (contact) freeMesh(contact)
        contact = makeContactShadow(fp.w * 1.35, fp.h * 1.5, .58)
        contact.userData.signature = contactSignature; this.scene.add(contact)
      }
      contact.position.set(dto.grid.x + fp.w / 2, .021, dto.grid.y - fp.h / 2 + 1)
      const useProxy = meta.shadowMode === 'volume'
      const signature = `${fp.w}:${fp.h}:${h}`
      if (useProxy && shadowProxy?.userData.signature !== signature) {
        if (shadowProxy) freeMesh(shadowProxy)
        shadowProxy = new T.Mesh(buildingShadowGeometry(fp.w * .9, fp.h * .92, Math.max(1, h * .8)), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: T.DoubleSide }))
        shadowProxy.castShadow = true; shadowProxy.userData.signature = signature
        this.scene.add(shadowProxy)
      } else if (!useProxy && shadowProxy) { freeMesh(shadowProxy); shadowProxy = null }
      if (shadowProxy) {
        shadowProxy.position.set(dto.grid.x + fp.w / 2, 0, dto.grid.y - fp.h / 2 + 1)
        mesh.castShadow = false
      }
    } else if (isAgent && contact) contact.position.set(dto.ground.x, .025, dto.ground.z)
    else {
      if (contact) { freeMesh(contact); contact = null }
      if (shadowProxy) { freeMesh(shadowProxy); shadowProxy = null }
    }
    if ((isAgent || materialKind === 'building' || meta.shadowMode === 'volume') && projectedShadow) { freeMesh(projectedShadow); projectedShadow = null }
    mesh.userData = { projectedShadow, dto, entry, isAgent, contact, shadowProxy, materialKind, placeholder: mesh.userData.placeholder, footV }
    return mesh
  }
  updateAgents(frames) {
    const live = new Set()
    for (const dto of frames) { live.add(dto.agent.agentKey); this.updateCard(this.agents, dto.agent.agentKey, dto, true) }
    for (const [key, mesh] of this.agents) if (!live.has(key)) { freeMesh(mesh); this.agents.delete(key) }
  }
  project(point) {
    const v = new T.Vector3(point.x, point.y || 0, point.z).project(this.camera)
    return { x: (v.x + 1) * this.width / 2, y: (1 - v.y) * this.height / 2 }
  }
  pick(point, { groundOnly = false, agentsOnly = false } = {}) {
    this.scene.updateMatrixWorld(true)
    this.ray.setFromCamera(new T.Vector2(point.x / this.width * 2 - 1, 1 - point.y / this.height * 2), this.camera)
    if (!groundOnly) {
      const hits = this.ray.intersectObjects([...this.agents.values(), ...(agentsOnly ? [] : this.objects.values())], false)
      hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance)
      for (const hit of hits) {
        if (!this.alphaHit(hit)) continue
        return hit.object.userData.isAgent ? { kind: 'agent', agent: hit.object.userData.dto.agent } : { kind: 'object', object: hit.object.userData.dto }
      }
    }
    const p = this.ray.ray.intersectPlane(this.groundPlane, new T.Vector3())
    const cell = p && { x: Math.floor(p.x), y: Math.floor(p.z) }
    return inMap(cell, this.map) ? { kind: 'ground', cell } : null
  }
  alphaHit(hit) {
    const entry = hit.object.userData.entry
    if (!entry?.ready || !hit.uv) return true
    if (!entry.alpha) {
      const img = entry.texture.image, canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
        entry.alpha = ctx.getImageData(0, 0, img.width, img.height)
      } catch { return false }
    }
    const { width, height, data } = entry.alpha
    const x = Math.max(0, Math.min(width - 1, Math.floor(hit.uv.x * width)))
    const y = Math.max(0, Math.min(height - 1, Math.floor((1 - hit.uv.y) * height)))
    return data[(y * width + x) * 4 + 3] / 255 >= hit.object.material.alphaTest
  }
  render(weather, focusPoints = []) {
    if (this.disposed) return
    this.frame = (this.frame || 0) + 1
    if (this.sceneDirty) this.syncScene()
    // Painter order follows ground anchors, never head height or walking bob.
    const cards = sortCards([...this.objects.values(), ...this.agents.values()])
    cards.forEach((mesh, index) => { mesh.renderOrder = 100 + index })
    for (const building of this.objects.values()) {
      const hidden = building.userData.materialKind === 'building' && [...this.agents.values()].some(agent => cardOccludesAgent(building, agent, this.camera))
      building.material.userData.townFade.value = hidden ? .32 : 1
      building.userData.occluding = hidden
    }
    const hour = weather?.hour ?? new Date().getHours()
    const rain = /雨|阴|雪/.test(weather?.text || '')
    const look = daylightLook(hour, rain)
    const target = this.cameraState ? isoToGround(this.cameraState.x, this.cameraState.y) : { x: 8, z: 8 }
    // Shadow texels follow the visible streets instead of spreading over the entire map.
    const tx = Math.round(target.x * 4) / 4, tz = Math.round(target.z * 4) / 4
    this.sun.position.copy(look.offset).add(new T.Vector3(tx, 0, tz))
    this.sun.target.position.set(tx, 0, tz)
    this.sun.intensity = look.sun; this.sun.color.set(look.color)
    this.fill.intensity = look.ambient; this.fill.color.set(look.sky)
    // Project each prop's alpha silhouette directly onto the receiving ground.
    // This avoids shadow-map depth bias opening a gap at a small object's foot.
    for (const mesh of this.objects.values()) {
      const shadow = mesh.userData.projectedShadow
      if (!shadow?.visible) continue
      mesh.updateMatrixWorld(true)
      const source = mesh.geometry.attributes.position, target = shadow.geometry.attributes.position
      const point = new T.Vector3()
      for (let i = 0; i < source.count; i++) {
        point.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld)
        const height = point.y
        target.setXYZ(i, point.x - height * look.offset.x / look.offset.y, .014, point.z - height * look.offset.z / look.offset.y)
      }
      target.needsUpdate = true
      shadow.material.opacity = look.night ? .25 : rain ? .30 : .52
    }
    const extent = Math.max(16, Math.min(64, this.width / (PIXELS_PER_UNIT * (this.cameraState?.zoom || 1)) * .7 + 8))
    Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: 180 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.scene.fog.color.set(look.fog); this.renderer.setClearColor(look.fog)
    const focal = this.camera.position.distanceTo(new T.Vector3(target.x,0,target.z))
    this.scene.fog.near = focal + 5; this.scene.fog.far = focal + 45
    this.camera.updateMatrixWorld()
    const depths = focusPoints.map(p => -new T.Vector3(p.x, p.y || 0, p.z).applyMatrix4(this.camera.matrixWorldInverse).z)
    this.tiltPass.setFocus(Math.min(focal, ...depths), Math.max(focal, ...depths), this.camera.near, this.camera.far)
    this.tiltPass.defocus = this.tilt && this.quality !== 'low'
    // Color grade and HDR output remain active even with depth of field disabled.
    this.composer.render()
    // Evict textures no longer referenced by any mesh (including regenerated URLs).
    if (this.frame % 120 === 0) {
      const used = new Set([...(this.surroundings ? [this.surroundings] : []), ...this.chunks.values(), ...this.objects.values(), ...this.agents.values()].map(m => m.material.map))
      for (const [key, entry] of this.textures) if ((entry.ready || entry.failed) && !used.has(entry.texture) && this.frame - entry.used > 120) {
        entry.texture.dispose(); this.textures.delete(key)
      }
    }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost)
    for (const collection of [this.chunks, this.objects, this.agents]) { for (const mesh of collection.values()) freeMesh(mesh); collection.clear() }
    for (const entry of this.textures.values()) entry.texture.dispose()
    if (this.surroundings) freeMesh(this.surroundings)
    if (this.curbs) freeMesh(this.curbs)
    this.textures.clear(); this.sun.shadow.dispose()
    for (const pass of this.composer.passes) pass.dispose?.()
    this.composer.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
