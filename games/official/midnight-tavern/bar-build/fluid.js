import * as T from 'three';

// A closed radial mesh includes a tessellated top: the meniscus, local ripples and
// stir depression displace actual vertices. The side samples the same height at the rim.
function volumeMesh() {
  const vertices = [],
    indices = [],
    segments = 120,
    rows = 42,
    rings = 30;
  function ring(r, h, previous) {
    const start = vertices.length / 3;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      vertices.push(r * Math.sin(a), h, r * Math.cos(a));
      if (j && previous >= 0)
        indices.push(previous + j - 1, previous + j, start + j - 1, previous + j, start + j, start + j - 1);
    }
    return start;
  }
  let last = ring(0.001, 0, -1);
  last = ring(1, 0, last);
  for (let i = 1; i <= rows; i++) last = ring(1, i / rows, last);
  for (let i = 1; i <= rings; i++) last = ring(Math.max(0.0001, 1 - i / rings), 1, last);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.boundingSphere = new T.Sphere(new T.Vector3(0, 1, 0), 2);
  return g;
}
const shared = `
uniform float bottom, rim, level, radii[32], square, time, stir, mixed, impact;
uniform vec2 slope;
float profile(float y){
  float f=clamp((y-bottom)/(rim-bottom),0.,1.)*31.;
  int i=int(f);return mix(radii[i],radii[min(31,i+1)],fract(f));
}
`;
const vertex =
  shared +
  `
varying vec3 localPos, worldPos, surfaceNormal; varying float cap;
float surfaceOffset(vec2 p, float radius){
 vec2 u=abs(p)/radius;
 float r=mix(length(u),pow(pow(u.x,8.)+pow(u.y,8.),.125),square);
 float d=length(p-vec2(-.105,.035));
 float wave=impact*.017*sin(32.*d-time*12.)*exp(-1.6*d);
 wave+=(.0042*sin(dot(p,vec2(8.,5.))-time*1.12)+.0026*cos(dot(p,vec2(-5.,10.))+time*.81))*(1.-.55*r);
 // A pair of shallow spiral crests travels around the spoon's depression.
 float spiral=.012*smoothstep(.025,.22,r)*sin(13.*length(p)-2.*atan(p.y,p.x+.00001)+time*5.);
 float vortex=stir*(.045*r*r-.09*exp(-8.*r*r)+spiral);
 return (.011*pow(r,12.)+wave+vortex+dot(slope,p))*smoothstep(.002,.12,level-bottom);
}
void main(){
 float h=mix(bottom,level,position.y), radius=profile(h);
 vec2 axis=normalize(position.xz);
 float corner=mix(1.,pow(pow(abs(axis.x),8.)+pow(abs(axis.y),8.),-.125),square);
 vec2 p=position.xz*radius*corner;
 float offset=surfaceOffset(p,radius);
 h+=offset*pow(position.y,4.);
 surfaceNormal=vec3(0.,1.,0.);
 if(position.y==1.){
   // Interpolate smooth normals from the same height field that moves the mesh.
   const float e=.002;
   float dx=surfaceOffset(p+vec2(e,0.),radius)-surfaceOffset(p-vec2(e,0.),radius);
   float dz=surfaceOffset(p+vec2(0.,e),radius)-surfaceOffset(p-vec2(0.,e),radius);
   surfaceNormal=mat3(modelMatrix)*normalize(vec3(-dx,2.*e,-dz));
 }
 localPos=vec3(p.x,h,p.y); cap=position.y;
 vec4 w=modelMatrix*vec4(localPos,1.);worldPos=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;
}`;
const fragment =
  shared +
  `
uniform sampler2D behind; uniform vec2 viewport;
uniform vec3 dyes[4]; uniform float stops[4], count;
varying vec3 localPos,worldPos,surfaceNormal; varying float cap;
void main(){
 vec3 N=normalize(cross(dFdx(worldPos),dFdy(worldPos))),V=normalize(cameraPosition-worldPos);
 if(cap>.999) N=normalize(surfaceNormal);
 if(dot(V,N)<0.)N=-N;
 float ndv=clamp(dot(N,V),.01,1.);
 vec2 uv=gl_FragCoord.xy/viewport;
 float radius=max(.02,profile(localPos.y));
 float across=clamp(localPos.x/radius,-1.,1.);
 float chord=sqrt(max(.015,1.-across*across*.96));
 vec3 background=texture2D(behind,uv).rgb;
 float y=(localPos.y-bottom)/(rim-bottom), angle=atan(localPos.z,localPos.x);
 float fold=sin(angle*2.+y*12.-time*2.)*.028+sin(angle*3.-y*18.+time)*.014;
 float tendril=sin(angle*4.+24.*y+2.5*sin(6.*y-time*2.))*sin(12.*y+angle-time*2.);
 float dyeY=y+fold*(.45+stir*2.8)+tendril*(.007+.046*stir)+.010*sin(angle*3.+time*1.4)*impact;
 vec3 dye=dyes[0], mean=dyes[0]*.46; float weight=.46;
 for(int i=1;i<4;i++)if(float(i)<count){
   dye=mix(dye,dyes[i],smoothstep(stops[i-1]-.031-.037*stir,stops[i-1]+.024+.034*stir,dyeY));
   mean+=dyes[i]*.142;weight+=.142;
 }
 dye=mix(dye,mean/weight,mixed);
 float depth=radius*2.*chord*(.42+.56*ndv);
 // Optical density follows path length. Bright, thin edges show the backbar and ice.
 vec3 transmittance=exp(-(.16+1.85*(1.-sqrt(max(dye,vec3(.001)))))*depth);
 vec3 lamp=vec3(1.,.67,.30);
 float vertical=clamp((localPos.y-bottom)/max(.012,level-bottom),0.,1.);
 float caustic=pow(.5+.5*cos(13.*angle+vertical*8.+sin(4.*angle)*2.),12.)*exp(-vertical*4.);
 float edge=pow(1.-chord,2.);
 vec3 c=background*transmittance*(1.07+.36*edge)+dye*(.032+.155*pow(1.-ndv,2.)+.13*vertical*vertical);
 c+=lamp*(dye+.07)*(.085*chord+.36*caustic+.18*edge);
 vec3 R=reflect(-V,N),L=normalize(vec3(-.65,1.,-.25));
 float strip=exp(-pow((R.x+.65)*13.,2.))*smoothstep(-.4,.55,R.y);
 float gleam=pow(max(dot(normalize(L+V),N),0.),85.);
 c+=vec3(1.,.83,.55)*(gleam*1.8+strip*(.04+.42*pow(1.-ndv,3.)));
 if(cap>.999){
   float ring=length(localPos.xz)/radius;
   c=mix(c,background*(.74+.19*ndv)+vec3(.22,.15,.085),.13+.30*pow(1.-ndv,2.));
   // Reflected bar lights lie behind the counter. A crest sweeps the ray
   // across the lamps while the transmitted drink stays at its original UV.
   vec2 lightPos=worldPos.xy+R.xy*(worldPos.z+2.2)/max(.15,-R.z);
   vec2 key=(lightPos-vec2(-.58,1.72))/vec2(.14,.63);
   vec2 fill=(lightPos-vec2(.48,1.86))/vec2(.075,.49);
   vec3 reflected=vec3(2.2,1.58,.86)*exp(-dot(key,key))+
                  vec3(.85,1.05,1.2)*exp(-dot(fill,fill));
   c+=reflected*(.085+.62*pow(1.-ndv,3.))*smoothstep(.02,.16,level-bottom);
   c+=lamp*.17*pow(clamp(ring,0.,1.),16.);
 }
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
export function createFluid(parent, shape, radius, recipe, background, viewport) {
  const bottom = shape.floor,
    rim = shape.rim - 0.025;
  const radii = Array.from({ length: 32 }, (_, i) =>
    Math.max(0.018, radius(shape, bottom + ((rim - bottom) * i) / 31) - 0.025),
  );
  // Integrate actual bowl area; equal doses raise a flute more than a martini rim.
  const volume = [0];
  for (let i = 1; i < 32; i++) volume.push(volume[i - 1] + (radii[i] ** 2 + radii[i - 1] ** 2) * 0.5);
  function height(amount) {
    const target = T.MathUtils.clamp(amount, 0, 0.996) * volume[31];
    const i = Math.max(
      1,
      volume.findIndex((v) => v >= target),
    );
    return bottom + ((rim - bottom) * (i - 1 + (target - volume[i - 1]) / (volume[i] - volume[i - 1]))) / 31;
  }
  const { dyes } = window.TavernAppearance.cocktailLook(recipe);
  const { BASE_VOLUME: base, DROP_VOLUME: dose } = window.TavernAppearance;
  const amount = base + (dyes.length - 1) * dose,
    uniforms = {};
  for (const [key, value] of Object.entries({
    bottom,
    rim,
    radii,
    level: height(amount),
    square: +!!shape.square,
    time: 0,
    impact: 0,
    stir: 0,
    mixed: 0,
    slope: new T.Vector2(),
    dyes: Array.from({ length: 4 }, (_, i) => new T.Color(dyes[i] || dyes[0])),
    stops: Array.from({ length: 4 }, (_, i) => (height(base + i * dose) - bottom) / (rim - bottom)),
    count: dyes.length,
    behind: background,
    viewport,
  }))
    uniforms[key] = { value };
  const mesh = new T.Mesh(
    volumeMesh(),
    new T.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment, side: T.DoubleSide }),
  );
  parent.add(mesh);
  return {
    mesh,
    uniforms,
    amount,
    dose,
    height,
    setFill(value) {
      uniforms.level.value = height(value);
    },
    get level() {
      return uniforms.level.value;
    },
  };
}
