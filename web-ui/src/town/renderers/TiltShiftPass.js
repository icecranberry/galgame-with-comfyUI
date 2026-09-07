import { ShaderMaterial, Vector2, WebGLRenderTarget } from 'three'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'

// Two half-resolution blur buffers, composited over the untouched full-resolution world.
// No depth override: alpha-cut cards have already been resolved by the world render.
export class TiltShiftPass extends Pass {
  constructor() {
    super()
    this.defocus = true
    this.horizontal = new WebGLRenderTarget(1, 1, { depthBuffer: false })
    this.vertical = this.horizontal.clone()
    this.blur = new ShaderMaterial({
      uniforms: { image: { value: null }, stepSize: { value: new Vector2() } }, vertexShader,
      fragmentShader: `uniform sampler2D image;uniform vec2 stepSize;varying vec2 vUv;
        void main(){gl_FragColor=texture2D(image,vUv)*0.227027;
        gl_FragColor+=(texture2D(image,vUv+stepSize)+texture2D(image,vUv-stepSize))*0.1945946;
        gl_FragColor+=(texture2D(image,vUv+2.*stepSize)+texture2D(image,vUv-2.*stepSize))*0.1216216;
        gl_FragColor+=(texture2D(image,vUv+3.*stepSize)+texture2D(image,vUv-3.*stepSize))*0.054054;
        gl_FragColor+=(texture2D(image,vUv+4.*stepSize)+texture2D(image,vUv-4.*stepSize))*0.016216;}`,
      depthTest: false, depthWrite: false,
    })
    this.composite = new ShaderMaterial({
      uniforms: { sharp: { value: null }, blurred: { value: this.vertical.texture }, sceneDepth: { value: null }, focusRange: { value: new Vector2(155, 155) }, clipping: { value: new Vector2(.1, 1000) }, defocus: { value: 1 } }, vertexShader,
      fragmentShader: `uniform sampler2D sharp;uniform sampler2D blurred;uniform sampler2D sceneDepth;
        uniform vec2 focusRange;uniform vec2 clipping;uniform float defocus;varying vec2 vUv;
        void main(){
          float depth=mix(clipping.x,clipping.y,texture2D(sceneDepth,vUv).x);
          float farBlur=smoothstep(3.,12.,depth-focusRange.y);
          float nearBlur=smoothstep(2.5,10.,focusRange.x-depth);
          float amount=max(farBlur,nearBlur)*.94*defocus;
          vec3 crisp=texture2D(sharp,vUv).rgb, soft=texture2D(blurred,vUv).rgb;
          vec3 color=mix(crisp,soft,amount);
          // Restrained highlight bloom in linear HDR, before the one output transform.
          color+=max(soft-vec3(1.05),vec3(0.))*0.16*defocus;
          float luma=dot(color,vec3(.2126,.7152,.0722));
          color=mix(vec3(luma),color,1.0);
          color*=mix(vec3(.98,1.01,1.035),vec3(1.025,1.015,.99),smoothstep(.06,.8,luma));
          vec2 edge=(vUv-.5)*vec2(1.15,1.);
          color*=1.-.12*smoothstep(.18,.72,length(edge));
          gl_FragColor=vec4(color,1.);
        }`,
      depthTest: false, depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.blur)
  }
  setFocus(near, far, cameraNear, cameraFar) {
    this.composite.uniforms.focusRange.value.set(near, far)
    this.composite.uniforms.clipping.value.set(cameraNear, cameraFar)
  }
  setSize(width, height) {
    this.width = Math.max(1, Math.ceil(width / 2)); this.height = Math.max(1, Math.ceil(height / 2))
    this.horizontal.setSize(this.width, this.height); this.vertical.setSize(this.width, this.height)
  }
  render(renderer, writeBuffer, readBuffer) {
    if (this.defocus) {
    this.quad.material = this.blur
    this.blur.uniforms.image.value = readBuffer.texture
    this.blur.uniforms.stepSize.value.set(1.3 / this.width, 0)
    renderer.setRenderTarget(this.horizontal); this.quad.render(renderer)
    this.blur.uniforms.image.value = this.horizontal.texture
    this.blur.uniforms.stepSize.value.set(0, 1.3 / this.height)
    renderer.setRenderTarget(this.vertical); this.quad.render(renderer)
    }
    this.quad.material = this.composite
    this.composite.uniforms.sharp.value = readBuffer.texture
    this.composite.uniforms.sceneDepth.value = readBuffer.depthTexture
    this.composite.uniforms.defocus.value = this.defocus ? 1 : 0
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer)
  }
  dispose() {
    this.horizontal.dispose(); this.vertical.dispose(); this.blur.dispose(); this.composite.dispose(); this.quad.dispose()
  }
}
