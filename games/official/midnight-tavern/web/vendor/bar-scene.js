/*! Midnight Tavern • Three.js r176 • see three.LICENSE.txt */
(()=>{/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */var Oc=0,fl=1,Bc=2;var pl=1,Ro=2,wn=3,Fn=0,Ot=1,pt=2,Vn=0,pi=1,fr=2,ml=3,gl=4,zc=5,$n=100,kc=101,Vc=102,Gc=103,Hc=104,Wc=200,Xc=201,qc=202,Yc=203,jr=204,eo=205,Zc=206,Jc=207,Kc=208,$c=209,Qc=210,jc=211,eh=212,th=213,nh=214,Io=0,Po=1,Lo=2,mi=3,Do=4,Uo=5,No=6,Fo=7,_l=0,ih=1,sh=2,Gn=0,rh=1,oh=2,ah=3,Oo=4,lh=5,ch=6,hh=7;var xl=300,wi=301,Ei=302,Bo=303,zo=304,pr=306,to=1e3,Kn=1001,no=1002,Gt=1003,uh=1004;var mr=1005;var hn=1006,ko=1007;var ni=1008;var pn=1009,vl=1010,yl=1011,ds=1012,Vo=1013,ii=1014,mn=1015,si=1016,Go=1017,Ho=1018,fs=1020,Ml=35902,Sl=1021,bl=1022,en=1023,ji=1026,ps=1027,Wo=1028,Xo=1029,Tl=1030,qo=1031;var Yo=1033,gr=33776,_r=33777,xr=33778,vr=33779,Zo=35840,Jo=35841,Ko=35842,$o=35843,Qo=36196,jo=37492,ea=37496,ta=37808,na=37809,ia=37810,sa=37811,ra=37812,oa=37813,aa=37814,la=37815,ca=37816,ha=37817,ua=37818,da=37819,fa=37820,pa=37821,yr=36492,ma=36494,ga=36495,wl=36283,_a=36284,xa=36285,va=36286;var Os=2300,io=2301,Qr=2302,il=2400,sl=2401,rl=2402;var dh=3200,fh=3201;var El=0,ph=1,Hn="",bt="srgb",gi="srgb-linear",Bs="linear",tt="srgb";var di=7680;var ol=519,mh=512,gh=513,_h=514,Al=515,xh=516,vh=517,yh=518,Mh=519,so=35044;var Cl="300 es",_n=2e3,zs=2001;var On=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}},Rt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],cc=1234567,Ds=Math.PI/180,es=180/Math.PI;function xn(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Rt[i&255]+Rt[i>>8&255]+Rt[i>>16&255]+Rt[i>>24&255]+"-"+Rt[e&255]+Rt[e>>8&255]+"-"+Rt[e>>16&15|64]+Rt[e>>24&255]+"-"+Rt[t&63|128]+Rt[t>>8&255]+"-"+Rt[t>>16&255]+Rt[t>>24&255]+Rt[n&255]+Rt[n>>8&255]+Rt[n>>16&255]+Rt[n>>24&255]).toLowerCase()}function We(i,e,t){return Math.max(e,Math.min(t,i))}function Rl(i,e){return(i%e+e)%e}function Pu(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function Lu(i,e,t){return i!==e?(t-i)/(e-i):0}function Us(i,e,t){return(1-t)*i+t*e}function Du(i,e,t,n){return Us(i,e,1-Math.exp(-t*n))}function Uu(i,e=1){return e-Math.abs(Rl(i,e*2)-e)}function Nu(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function Fu(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function Ou(i,e){return i+Math.floor(Math.random()*(e-i+1))}function Bu(i,e){return i+Math.random()*(e-i)}function zu(i){return i*(.5-Math.random())}function ku(i){i!==void 0&&(cc=i);let e=cc+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Vu(i){return i*Ds}function Gu(i){return i*es}function Hu(i){return(i&i-1)===0&&i!==0}function Wu(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function Xu(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function qu(i,e,t,n,s){let r=Math.cos,o=Math.sin,a=r(t/2),l=o(t/2),c=r((e+n)/2),h=o((e+n)/2),u=r((e-n)/2),d=o((e-n)/2),f=r((n-e)/2),g=o((n-e)/2);switch(s){case"XYX":i.set(a*h,l*u,l*d,a*c);break;case"YZY":i.set(l*d,a*h,l*u,a*c);break;case"ZXZ":i.set(l*u,l*d,a*h,a*c);break;case"XZX":i.set(a*h,l*g,l*f,a*c);break;case"YXY":i.set(l*f,a*h,l*g,a*c);break;case"ZYZ":i.set(l*g,l*f,a*h,a*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function cn(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function et(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}var gt={DEG2RAD:Ds,RAD2DEG:es,generateUUID:xn,clamp:We,euclideanModulo:Rl,mapLinear:Pu,inverseLerp:Lu,lerp:Us,damp:Du,pingpong:Uu,smoothstep:Nu,smootherstep:Fu,randInt:Ou,randFloat:Bu,randFloatSpread:zu,seededRandom:ku,degToRad:Vu,radToDeg:Gu,isPowerOfTwo:Hu,ceilPowerOfTwo:Wu,floorPowerOfTwo:Xu,setQuaternionFromProperEuler:qu,normalize:et,denormalize:cn},te=class i{constructor(e=0,t=0){i.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Ge=class i{constructor(e,t,n,s,r,o,a,l,c){i.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){let h=this.elements;return h[0]=e,h[1]=s,h[2]=a,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=o,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],f=n[5],g=n[8],x=s[0],m=s[3],p=s[6],T=s[1],y=s[4],_=s[7],C=s[2],E=s[5],R=s[8];return r[0]=o*x+a*T+l*C,r[3]=o*m+a*y+l*E,r[6]=o*p+a*_+l*R,r[1]=c*x+h*T+u*C,r[4]=c*m+h*y+u*E,r[7]=c*p+h*_+u*R,r[2]=d*x+f*T+g*C,r[5]=d*m+f*y+g*E,r[8]=d*p+f*_+g*R,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8];return t*o*h-t*a*c-n*r*h+n*a*l+s*r*c-s*o*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],u=h*o-a*c,d=a*l-h*r,f=c*r-o*l,g=t*u+n*d+s*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let x=1/g;return e[0]=u*x,e[1]=(s*c-h*n)*x,e[2]=(a*n-s*o)*x,e[3]=d*x,e[4]=(h*t-s*l)*x,e[5]=(s*r-a*t)*x,e[6]=f*x,e[7]=(n*l-c*t)*x,e[8]=(o*t-n*r)*x,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(La.makeScale(e,t)),this}rotate(e){return this.premultiply(La.makeRotation(-e)),this}translate(e,t){return this.premultiply(La.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},La=new Ge;function Il(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function ks(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Sh(){let i=ks("canvas");return i.style.display="block",i}var hc={};function Mr(i){i in hc||(hc[i]=!0,console.warn(i))}function bh(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Th(i){let e=i.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function wh(i){let e=i.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}var uc=new Ge().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),dc=new Ge().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Yu(){let i={enabled:!0,workingColorSpace:gi,spaces:{},convert:function(s,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===tt&&(s.r=Nn(s.r),s.g=Nn(s.g),s.b=Nn(s.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===tt&&(s.r=Qi(s.r),s.g=Qi(s.g),s.b=Qi(s.b))),s},fromWorkingColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},toWorkingColorSpace:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Hn?Bs:this.spaces[s].transfer},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,o){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[gi]:{primaries:e,whitePoint:n,transfer:Bs,toXYZ:uc,fromXYZ:dc,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:bt},outputColorSpaceConfig:{drawingBufferColorSpace:bt}},[bt]:{primaries:e,whitePoint:n,transfer:tt,toXYZ:uc,fromXYZ:dc,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:bt}}}),i}var Ze=Yu();function Nn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Qi(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var Ni,ro=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Ni===void 0&&(Ni=ks("canvas")),Ni.width=e.width,Ni.height=e.height;let s=Ni.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=Ni}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=ks("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=Nn(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Nn(t[n]/255)*255):t[n]=Nn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Zu=0,ts=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Zu++}),this.uuid=xn(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(Da(s[o].image)):r.push(Da(s[o]))}else r=Da(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function Da(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?ro.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var Ju=0,Et=class i extends On{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=Kn,s=Kn,r=hn,o=ni,a=en,l=pn,c=i.DEFAULT_ANISOTROPY,h=Hn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Ju++}),this.uuid=xn(),this.name="",this.source=new ts(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new te(0,0),this.repeat=new te(1,1),this.center=new te(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ge,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isTextureArray=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isTextureArray=e.isTextureArray,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==xl)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case to:e.x=e.x-Math.floor(e.x);break;case Kn:e.x=e.x<0?0:1;break;case no:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case to:e.y=e.y-Math.floor(e.y);break;case Kn:e.y=e.y<0?0:1;break;case no:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Et.DEFAULT_IMAGE=null;Et.DEFAULT_MAPPING=xl;Et.DEFAULT_ANISOTROPY=1;var ut=class i{constructor(e=0,t=0,n=0,s=1){i.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],f=l[5],g=l[9],x=l[2],m=l[6],p=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-x)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+x)<.1&&Math.abs(g+m)<.1&&Math.abs(c+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let y=(c+1)/2,_=(f+1)/2,C=(p+1)/2,E=(h+d)/4,R=(u+x)/4,I=(g+m)/4;return y>_&&y>C?y<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(y),s=E/n,r=R/n):_>C?_<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(_),n=E/s,r=I/s):C<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(C),n=R/r,s=I/r),this.set(n,s,r,t),this}let T=Math.sqrt((m-g)*(m-g)+(u-x)*(u-x)+(d-h)*(d-h));return Math.abs(T)<.001&&(T=1),this.x=(m-g)/T,this.y=(u-x)/T,this.z=(d-h)/T,this.w=Math.acos((c+f+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this.w=We(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this.w=We(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},oo=class extends On{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth?n.depth:1,this.scissor=new ut(0,0,e,t),this.scissorTest=!1,this.viewport=new ut(0,0,e,t);let s={width:e,height:t,depth:this.depth};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:hn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,multiview:!1},n);let r=new Et(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];let o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new ts(s)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},jt=class extends oo{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Vs=class extends Et{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Gt,this.minFilter=Gt,this.wrapR=Kn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var ao=class extends Et{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Gt,this.minFilter=Gt,this.wrapR=Kn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Bn=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],h=n[s+2],u=n[s+3],d=r[o+0],f=r[o+1],g=r[o+2],x=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u;return}if(a===1){e[t+0]=d,e[t+1]=f,e[t+2]=g,e[t+3]=x;return}if(u!==x||l!==d||c!==f||h!==g){let m=1-a,p=l*d+c*f+h*g+u*x,T=p>=0?1:-1,y=1-p*p;if(y>Number.EPSILON){let C=Math.sqrt(y),E=Math.atan2(C,p*T);m=Math.sin(m*E)/C,a=Math.sin(a*E)/C}let _=a*T;if(l=l*m+d*_,c=c*m+f*_,h=h*m+g*_,u=u*m+x*_,m===1-a){let C=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=C,c*=C,h*=C,u*=C}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,o){let a=n[s],l=n[s+1],c=n[s+2],h=n[s+3],u=r[o],d=r[o+1],f=r[o+2],g=r[o+3];return e[t]=a*g+h*u+l*f-c*d,e[t+1]=l*g+h*d+c*u-a*f,e[t+2]=c*g+h*f+a*d-l*u,e[t+3]=h*g-a*u-l*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),h=a(s/2),u=a(r/2),d=l(n/2),f=l(s/2),g=l(r/2);switch(o){case"XYZ":this._x=d*h*u+c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u-d*f*g;break;case"YXZ":this._x=d*h*u+c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u+d*f*g;break;case"ZXY":this._x=d*h*u-c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u-d*f*g;break;case"ZYX":this._x=d*h*u-c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u+d*f*g;break;case"YZX":this._x=d*h*u+c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u-d*f*g;break;case"XZY":this._x=d*h*u-c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u+d*f*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+a+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-l)*f,this._y=(r-c)*f,this._z=(o-s)*f}else if(n>a&&n>u){let f=2*Math.sqrt(1+n-a-u);this._w=(h-l)/f,this._x=.25*f,this._y=(s+o)/f,this._z=(r+c)/f}else if(a>u){let f=2*Math.sqrt(1+a-n-u);this._w=(r-c)/f,this._x=(s+o)/f,this._y=.25*f,this._z=(l+h)/f}else{let f=2*Math.sqrt(1+u-n-a);this._w=(o-s)/f,this._x=(r+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(We(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+o*a+s*c-r*l,this._y=s*h+o*l+r*a-n*c,this._z=r*h+o*c+n*l-s*a,this._w=o*h-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,s=this._y,r=this._z,o=this._w,a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;let l=1-a*a;if(l<=Number.EPSILON){let f=1-t;return this._w=f*o+t*this._w,this._x=f*n+t*this._x,this._y=f*s+t*this._y,this._z=f*r+t*this._z,this.normalize(),this}let c=Math.sqrt(l),h=Math.atan2(c,a),u=Math.sin((1-t)*h)/c,d=Math.sin(t*h)/c;return this._w=o*u+this._w*d,this._x=n*u+this._x*d,this._y=s*u+this._y*d,this._z=r*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},D=class i{constructor(e=0,t=0,n=0){i.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(fc.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(fc.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),h=2*(a*t-r*s),u=2*(r*n-o*t);return this.x=t+l*c+o*u-a*h,this.y=n+l*h+a*c-r*u,this.z=s+l*u+r*h-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=We(this.x,e.x,t.x),this.y=We(this.y,e.y,t.y),this.z=We(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=We(this.x,e,t),this.y=We(this.y,e,t),this.z=We(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(We(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Ua.copy(this).projectOnVector(e),this.sub(Ua)}reflect(e){return this.sub(Ua.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(We(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Ua=new D,fc=new Bn,vn=class{constructor(e=new D(1/0,1/0,1/0),t=new D(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(on.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(on.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=on.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,on):on.fromBufferAttribute(r,o),on.applyMatrix4(e.matrixWorld),this.expandByPoint(on);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Ar.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Ar.copy(n.boundingBox)),Ar.applyMatrix4(e.matrixWorld),this.union(Ar)}let s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,on),on.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(bs),Cr.subVectors(this.max,bs),Fi.subVectors(e.a,bs),Oi.subVectors(e.b,bs),Bi.subVectors(e.c,bs),Wn.subVectors(Oi,Fi),Xn.subVectors(Bi,Oi),li.subVectors(Fi,Bi);let t=[0,-Wn.z,Wn.y,0,-Xn.z,Xn.y,0,-li.z,li.y,Wn.z,0,-Wn.x,Xn.z,0,-Xn.x,li.z,0,-li.x,-Wn.y,Wn.x,0,-Xn.y,Xn.x,0,-li.y,li.x,0];return!Na(t,Fi,Oi,Bi,Cr)||(t=[1,0,0,0,1,0,0,0,1],!Na(t,Fi,Oi,Bi,Cr))?!1:(Rr.crossVectors(Wn,Xn),t=[Rr.x,Rr.y,Rr.z],Na(t,Fi,Oi,Bi,Cr))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,on).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(on).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Rn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Rn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Rn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Rn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Rn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Rn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Rn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Rn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Rn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}},Rn=[new D,new D,new D,new D,new D,new D,new D,new D],on=new D,Ar=new vn,Fi=new D,Oi=new D,Bi=new D,Wn=new D,Xn=new D,li=new D,bs=new D,Cr=new D,Rr=new D,ci=new D;function Na(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){ci.fromArray(i,r);let a=s.x*Math.abs(ci.x)+s.y*Math.abs(ci.y)+s.z*Math.abs(ci.z),l=e.dot(ci),c=t.dot(ci),h=n.dot(ci);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>a)return!1}return!0}var Ku=new vn,Ts=new D,Fa=new D,yn=class{constructor(e=new D,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):Ku.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ts.subVectors(e,this.center);let t=Ts.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Ts,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Fa.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ts.copy(e.center).add(Fa)),this.expandByPoint(Ts.copy(e.center).sub(Fa))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}},In=new D,Oa=new D,Ir=new D,qn=new D,Ba=new D,Pr=new D,za=new D,lo=class{constructor(e=new D,t=new D(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,In)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=In.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(In.copy(this.origin).addScaledVector(this.direction,t),In.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Oa.copy(e).add(t).multiplyScalar(.5),Ir.copy(t).sub(e).normalize(),qn.copy(this.origin).sub(Oa);let r=e.distanceTo(t)*.5,o=-this.direction.dot(Ir),a=qn.dot(this.direction),l=-qn.dot(Ir),c=qn.lengthSq(),h=Math.abs(1-o*o),u,d,f,g;if(h>0)if(u=o*l-a,d=o*a-l,g=r*h,u>=0)if(d>=-g)if(d<=g){let x=1/h;u*=x,d*=x,f=u*(u+o*d+2*a)+d*(o*u+d+2*l)+c}else d=r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*l)+c;else d=-r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*l)+c;else d<=-g?(u=Math.max(0,-(-o*r+a)),d=u>0?-r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c):d<=g?(u=0,d=Math.min(Math.max(-r,-l),r),f=d*(d+2*l)+c):(u=Math.max(0,-(o*r+a)),d=u>0?r:Math.min(Math.max(-r,-l),r),f=-u*u+d*(d+2*l)+c);else d=o>0?-r:r,u=Math.max(0,-(o*d+a)),f=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(Oa).addScaledVector(Ir,d),f}intersectSphere(e,t){In.subVectors(e.center,this.origin);let n=In.dot(this.direction),s=In.dot(In)-n*n,r=e.radius*e.radius;if(s>r)return null;let o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,s=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,s=(e.min.x-d.x)*c),h>=0?(r=(e.min.y-d.y)*h,o=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,o=(e.min.y-d.y)*h),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),u>=0?(a=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(a=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,In)!==null}intersectTriangle(e,t,n,s,r){Ba.subVectors(t,e),Pr.subVectors(n,e),za.crossVectors(Ba,Pr);let o=this.direction.dot(za),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;qn.subVectors(this.origin,e);let l=a*this.direction.dot(Pr.crossVectors(qn,Pr));if(l<0)return null;let c=a*this.direction.dot(Ba.cross(qn));if(c<0||l+c>o)return null;let h=-a*qn.dot(za);return h<0?null:this.at(h/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},st=class i{constructor(e,t,n,s,r,o,a,l,c,h,u,d,f,g,x,m){i.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,h,u,d,f,g,x,m)}set(e,t,n,s,r,o,a,l,c,h,u,d,f,g,x,m){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=o,p[9]=a,p[13]=l,p[2]=c,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=g,p[11]=x,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,s=1/zi.setFromMatrixColumn(e,0).length(),r=1/zi.setFromMatrixColumn(e,1).length(),o=1/zi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=o*h,f=o*u,g=a*h,x=a*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=f+g*c,t[5]=d-x*c,t[9]=-a*l,t[2]=x-d*c,t[6]=g+f*c,t[10]=o*l}else if(e.order==="YXZ"){let d=l*h,f=l*u,g=c*h,x=c*u;t[0]=d+x*a,t[4]=g*a-f,t[8]=o*c,t[1]=o*u,t[5]=o*h,t[9]=-a,t[2]=f*a-g,t[6]=x+d*a,t[10]=o*l}else if(e.order==="ZXY"){let d=l*h,f=l*u,g=c*h,x=c*u;t[0]=d-x*a,t[4]=-o*u,t[8]=g+f*a,t[1]=f+g*a,t[5]=o*h,t[9]=x-d*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){let d=o*h,f=o*u,g=a*h,x=a*u;t[0]=l*h,t[4]=g*c-f,t[8]=d*c+x,t[1]=l*u,t[5]=x*c+d,t[9]=f*c-g,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){let d=o*l,f=o*c,g=a*l,x=a*c;t[0]=l*h,t[4]=x-d*u,t[8]=g*u+f,t[1]=u,t[5]=o*h,t[9]=-a*h,t[2]=-c*h,t[6]=f*u+g,t[10]=d-x*u}else if(e.order==="XZY"){let d=o*l,f=o*c,g=a*l,x=a*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+x,t[5]=o*h,t[9]=f*u-g,t[2]=g*u-f,t[6]=a*h,t[10]=x*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose($u,e,Qu)}lookAt(e,t,n){let s=this.elements;return qt.subVectors(e,t),qt.lengthSq()===0&&(qt.z=1),qt.normalize(),Yn.crossVectors(n,qt),Yn.lengthSq()===0&&(Math.abs(n.z)===1?qt.x+=1e-4:qt.z+=1e-4,qt.normalize(),Yn.crossVectors(n,qt)),Yn.normalize(),Lr.crossVectors(qt,Yn),s[0]=Yn.x,s[4]=Lr.x,s[8]=qt.x,s[1]=Yn.y,s[5]=Lr.y,s[9]=qt.y,s[2]=Yn.z,s[6]=Lr.z,s[10]=qt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],f=n[13],g=n[2],x=n[6],m=n[10],p=n[14],T=n[3],y=n[7],_=n[11],C=n[15],E=s[0],R=s[4],I=s[8],S=s[12],M=s[1],L=s[5],H=s[9],z=s[13],k=s[2],G=s[6],Z=s[10],j=s[14],q=s[3],oe=s[7],me=s[11],Me=s[15];return r[0]=o*E+a*M+l*k+c*q,r[4]=o*R+a*L+l*G+c*oe,r[8]=o*I+a*H+l*Z+c*me,r[12]=o*S+a*z+l*j+c*Me,r[1]=h*E+u*M+d*k+f*q,r[5]=h*R+u*L+d*G+f*oe,r[9]=h*I+u*H+d*Z+f*me,r[13]=h*S+u*z+d*j+f*Me,r[2]=g*E+x*M+m*k+p*q,r[6]=g*R+x*L+m*G+p*oe,r[10]=g*I+x*H+m*Z+p*me,r[14]=g*S+x*z+m*j+p*Me,r[3]=T*E+y*M+_*k+C*q,r[7]=T*R+y*L+_*G+C*oe,r[11]=T*I+y*H+_*Z+C*me,r[15]=T*S+y*z+_*j+C*Me,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],f=e[14],g=e[3],x=e[7],m=e[11],p=e[15];return g*(+r*l*u-s*c*u-r*a*d+n*c*d+s*a*f-n*l*f)+x*(+t*l*f-t*c*d+r*o*d-s*o*f+s*c*h-r*l*h)+m*(+t*c*u-t*a*f-r*o*u+n*o*f+r*a*h-n*c*h)+p*(-s*a*h-t*l*u+t*a*d+s*o*u-n*o*d+n*l*h)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],f=e[11],g=e[12],x=e[13],m=e[14],p=e[15],T=u*m*c-x*d*c+x*l*f-a*m*f-u*l*p+a*d*p,y=g*d*c-h*m*c-g*l*f+o*m*f+h*l*p-o*d*p,_=h*x*c-g*u*c+g*a*f-o*x*f-h*a*p+o*u*p,C=g*u*l-h*x*l-g*a*d+o*x*d+h*a*m-o*u*m,E=t*T+n*y+s*_+r*C;if(E===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let R=1/E;return e[0]=T*R,e[1]=(x*d*r-u*m*r-x*s*f+n*m*f+u*s*p-n*d*p)*R,e[2]=(a*m*r-x*l*r+x*s*c-n*m*c-a*s*p+n*l*p)*R,e[3]=(u*l*r-a*d*r-u*s*c+n*d*c+a*s*f-n*l*f)*R,e[4]=y*R,e[5]=(h*m*r-g*d*r+g*s*f-t*m*f-h*s*p+t*d*p)*R,e[6]=(g*l*r-o*m*r-g*s*c+t*m*c+o*s*p-t*l*p)*R,e[7]=(o*d*r-h*l*r+h*s*c-t*d*c-o*s*f+t*l*f)*R,e[8]=_*R,e[9]=(g*u*r-h*x*r-g*n*f+t*x*f+h*n*p-t*u*p)*R,e[10]=(o*x*r-g*a*r+g*n*c-t*x*c-o*n*p+t*a*p)*R,e[11]=(h*a*r-o*u*r-h*n*c+t*u*c+o*n*f-t*a*f)*R,e[12]=C*R,e[13]=(h*x*s-g*u*s+g*n*d-t*x*d-h*n*m+t*u*m)*R,e[14]=(g*a*s-o*x*s-g*n*l+t*x*l+o*n*m-t*a*m)*R,e[15]=(o*u*s-h*a*s+h*n*l-t*u*l-o*n*d+t*a*d)*R,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,h=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,h*a+n,h*l-s*o,0,c*l-s*a,h*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,h=o+o,u=a+a,d=r*c,f=r*h,g=r*u,x=o*h,m=o*u,p=a*u,T=l*c,y=l*h,_=l*u,C=n.x,E=n.y,R=n.z;return s[0]=(1-(x+p))*C,s[1]=(f+_)*C,s[2]=(g-y)*C,s[3]=0,s[4]=(f-_)*E,s[5]=(1-(d+p))*E,s[6]=(m+T)*E,s[7]=0,s[8]=(g+y)*R,s[9]=(m-T)*R,s[10]=(1-(d+x))*R,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements,r=zi.set(s[0],s[1],s[2]).length(),o=zi.set(s[4],s[5],s[6]).length(),a=zi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],an.copy(this);let c=1/r,h=1/o,u=1/a;return an.elements[0]*=c,an.elements[1]*=c,an.elements[2]*=c,an.elements[4]*=h,an.elements[5]*=h,an.elements[6]*=h,an.elements[8]*=u,an.elements[9]*=u,an.elements[10]*=u,t.setFromRotationMatrix(an),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=_n){let l=this.elements,c=2*r/(t-e),h=2*r/(n-s),u=(t+e)/(t-e),d=(n+s)/(n-s),f,g;if(a===_n)f=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===zs)f=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=d,l[13]=0,l[2]=0,l[6]=0,l[10]=f,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=_n){let l=this.elements,c=1/(t-e),h=1/(n-s),u=1/(o-r),d=(t+e)*c,f=(n+s)*h,g,x;if(a===_n)g=(o+r)*u,x=-2*u;else if(a===zs)g=r*u,x=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-d,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-f,l[2]=0,l[6]=0,l[10]=x,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},zi=new D,an=new st,$u=new D(0,0,0),Qu=new D(1,1,1),Yn=new D,Lr=new D,qt=new D,pc=new st,mc=new Bn,un=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],h=s[9],u=s[2],d=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin(We(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-We(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(We(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-We(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(We(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-We(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return pc.makeRotationFromQuaternion(e),this.setFromRotationMatrix(pc,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return mc.setFromEuler(this),this.setFromQuaternion(mc,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};un.DEFAULT_ORDER="XYZ";var Gs=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},ju=0,gc=new D,ki=new Bn,Pn=new st,Dr=new D,ws=new D,ed=new D,td=new Bn,_c=new D(1,0,0),xc=new D(0,1,0),vc=new D(0,0,1),yc={type:"added"},nd={type:"removed"},Vi={type:"childadded",child:null},ka={type:"childremoved",child:null},mt=class i extends On{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:ju++}),this.uuid=xn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new D,t=new un,n=new Bn,s=new D(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new st},normalMatrix:{value:new Ge}}),this.matrix=new st,this.matrixWorld=new st,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Gs,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return ki.setFromAxisAngle(e,t),this.quaternion.multiply(ki),this}rotateOnWorldAxis(e,t){return ki.setFromAxisAngle(e,t),this.quaternion.premultiply(ki),this}rotateX(e){return this.rotateOnAxis(_c,e)}rotateY(e){return this.rotateOnAxis(xc,e)}rotateZ(e){return this.rotateOnAxis(vc,e)}translateOnAxis(e,t){return gc.copy(e).applyQuaternion(this.quaternion),this.position.add(gc.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(_c,e)}translateY(e){return this.translateOnAxis(xc,e)}translateZ(e){return this.translateOnAxis(vc,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Pn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Dr.copy(e):Dr.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),ws.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Pn.lookAt(ws,Dr,this.up):Pn.lookAt(Dr,ws,this.up),this.quaternion.setFromRotationMatrix(Pn),s&&(Pn.extractRotation(s.matrixWorld),ki.setFromRotationMatrix(Pn),this.quaternion.premultiply(ki.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(yc),Vi.child=e,this.dispatchEvent(Vi),Vi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(nd),ka.child=e,this.dispatchEvent(ka),ka.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Pn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Pn.multiply(e.parent.matrixWorld)),e.applyMatrix4(Pn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(yc),Vi.child=e,this.dispatchEvent(Vi),Vi.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ws,e,ed),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ws,td,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?{min:a.boundingBox.min.toArray(),max:a.boundingBox.max.toArray()}:void 0,boundingSphere:a.boundingSphere?{radius:a.boundingSphere.radius,center:a.boundingSphere.center.toArray()}:void 0})),s.instanceInfo=this._instanceInfo.map(a=>({...a})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere={center:this.boundingSphere.center.toArray(),radius:this.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:this.boundingBox.min.toArray(),max:this.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];r(e.shapes,u)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){let a=o(e.geometries),l=o(e.materials),c=o(e.textures),h=o(e.images),u=o(e.shapes),d=o(e.skeletons),f=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){let l=[];for(let c in a){let h=a[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};mt.DEFAULT_UP=new D(0,1,0);mt.DEFAULT_MATRIX_AUTO_UPDATE=!0;mt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var ln=new D,Ln=new D,Va=new D,Dn=new D,Gi=new D,Hi=new D,Mc=new D,Ga=new D,Ha=new D,Wa=new D,Xa=new ut,qa=new ut,Ya=new ut,Un=class i{constructor(e=new D,t=new D,n=new D){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),ln.subVectors(e,t),s.cross(ln);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){ln.subVectors(s,t),Ln.subVectors(n,t),Va.subVectors(e,t);let o=ln.dot(ln),a=ln.dot(Ln),l=ln.dot(Va),c=Ln.dot(Ln),h=Ln.dot(Va),u=o*c-a*a;if(u===0)return r.set(0,0,0),null;let d=1/u,f=(c*l-a*h)*d,g=(o*h-a*l)*d;return r.set(1-f-g,g,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,Dn)===null?!1:Dn.x>=0&&Dn.y>=0&&Dn.x+Dn.y<=1}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,Dn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,Dn.x),l.addScaledVector(o,Dn.y),l.addScaledVector(a,Dn.z),l)}static getInterpolatedAttribute(e,t,n,s,r,o){return Xa.setScalar(0),qa.setScalar(0),Ya.setScalar(0),Xa.fromBufferAttribute(e,t),qa.fromBufferAttribute(e,n),Ya.fromBufferAttribute(e,s),o.setScalar(0),o.addScaledVector(Xa,r.x),o.addScaledVector(qa,r.y),o.addScaledVector(Ya,r.z),o}static isFrontFacing(e,t,n,s){return ln.subVectors(n,t),Ln.subVectors(e,t),ln.cross(Ln).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return ln.subVectors(this.c,this.b),Ln.subVectors(this.a,this.b),ln.cross(Ln).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,o,a;Gi.subVectors(s,n),Hi.subVectors(r,n),Ga.subVectors(e,n);let l=Gi.dot(Ga),c=Hi.dot(Ga);if(l<=0&&c<=0)return t.copy(n);Ha.subVectors(e,s);let h=Gi.dot(Ha),u=Hi.dot(Ha);if(h>=0&&u<=h)return t.copy(s);let d=l*u-h*c;if(d<=0&&l>=0&&h<=0)return o=l/(l-h),t.copy(n).addScaledVector(Gi,o);Wa.subVectors(e,r);let f=Gi.dot(Wa),g=Hi.dot(Wa);if(g>=0&&f<=g)return t.copy(r);let x=f*c-l*g;if(x<=0&&c>=0&&g<=0)return a=c/(c-g),t.copy(n).addScaledVector(Hi,a);let m=h*g-f*u;if(m<=0&&u-h>=0&&f-g>=0)return Mc.subVectors(r,s),a=(u-h)/(u-h+(f-g)),t.copy(s).addScaledVector(Mc,a);let p=1/(m+x+d);return o=x*p,a=d*p,t.copy(n).addScaledVector(Gi,o).addScaledVector(Hi,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Eh={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Zn={h:0,s:0,l:0},Ur={h:0,s:0,l:0};function Za(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var Ie=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=bt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Ze.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=Ze.workingColorSpace){return this.r=e,this.g=t,this.b=n,Ze.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=Ze.workingColorSpace){if(e=Rl(e,1),t=We(t,0,1),n=We(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=Za(o,r,e+1/3),this.g=Za(o,r,e),this.b=Za(o,r,e-1/3)}return Ze.toWorkingColorSpace(this,s),this}setStyle(e,t=bt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=bt){let n=Eh[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Nn(e.r),this.g=Nn(e.g),this.b=Nn(e.b),this}copyLinearToSRGB(e){return this.r=Qi(e.r),this.g=Qi(e.g),this.b=Qi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=bt){return Ze.fromWorkingColorSpace(It.copy(this),e),Math.round(We(It.r*255,0,255))*65536+Math.round(We(It.g*255,0,255))*256+Math.round(We(It.b*255,0,255))}getHexString(e=bt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Ze.workingColorSpace){Ze.fromWorkingColorSpace(It.copy(this),t);let n=It.r,s=It.g,r=It.b,o=Math.max(n,s,r),a=Math.min(n,s,r),l,c,h=(a+o)/2;if(a===o)l=0,c=0;else{let u=o-a;switch(c=h<=.5?u/(o+a):u/(2-o-a),o){case n:l=(s-r)/u+(s<r?6:0);break;case s:l=(r-n)/u+2;break;case r:l=(n-s)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=Ze.workingColorSpace){return Ze.fromWorkingColorSpace(It.copy(this),t),e.r=It.r,e.g=It.g,e.b=It.b,e}getStyle(e=bt){Ze.fromWorkingColorSpace(It.copy(this),e);let t=It.r,n=It.g,s=It.b;return e!==bt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Zn),this.setHSL(Zn.h+e,Zn.s+t,Zn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Zn),e.getHSL(Ur);let n=Us(Zn.h,Ur.h,t),s=Us(Zn.s,Ur.s,t),r=Us(Zn.l,Ur.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},It=new Ie;Ie.NAMES=Eh;var id=0,Mn=class extends On{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:id++}),this.uuid=xn(),this.name="",this.type="Material",this.blending=pi,this.side=Fn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=jr,this.blendDst=eo,this.blendEquation=$n,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ie(0,0,0),this.blendAlpha=0,this.depthFunc=mi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=ol,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=di,this.stencilZFail=di,this.stencilZPass=di,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==pi&&(n.blending=this.blending),this.side!==Fn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==jr&&(n.blendSrc=this.blendSrc),this.blendDst!==eo&&(n.blendDst=this.blendDst),this.blendEquation!==$n&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==mi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==ol&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==di&&(n.stencilFail=this.stencilFail),this.stencilZFail!==di&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==di&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let o=[];for(let a in r){let l=r[a];delete l.metadata,o.push(l)}return o}if(t){let r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},zn=class extends Mn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ie(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new un,this.combine=_l,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var xt=new D,Nr=new te,sd=0,Ft=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:sd++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=so,this.updateRanges=[],this.gpuType=mn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Nr.fromBufferAttribute(this,t),Nr.applyMatrix3(e),this.setXY(t,Nr.x,Nr.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)xt.fromBufferAttribute(this,t),xt.applyMatrix3(e),this.setXYZ(t,xt.x,xt.y,xt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)xt.fromBufferAttribute(this,t),xt.applyMatrix4(e),this.setXYZ(t,xt.x,xt.y,xt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)xt.fromBufferAttribute(this,t),xt.applyNormalMatrix(e),this.setXYZ(t,xt.x,xt.y,xt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)xt.fromBufferAttribute(this,t),xt.transformDirection(e),this.setXYZ(t,xt.x,xt.y,xt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=cn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=et(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=cn(t,this.array)),t}setX(e,t){return this.normalized&&(t=et(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=cn(t,this.array)),t}setY(e,t){return this.normalized&&(t=et(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=cn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=et(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=cn(t,this.array)),t}setW(e,t){return this.normalized&&(t=et(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=et(t,this.array),n=et(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=et(t,this.array),n=et(n,this.array),s=et(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=et(t,this.array),n=et(n,this.array),s=et(s,this.array),r=et(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==so&&(e.usage=this.usage),e}};var Hs=class extends Ft{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var Ws=class extends Ft{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var Ve=class extends Ft{constructor(e,t,n){super(new Float32Array(e),t,n)}},rd=0,Qt=new st,Ja=new mt,Wi=new D,Yt=new vn,Es=new vn,St=new D,at=class i extends On{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:rd++}),this.uuid=xn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Il(e)?Ws:Hs)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new Ge().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Qt.makeRotationFromQuaternion(e),this.applyMatrix4(Qt),this}rotateX(e){return Qt.makeRotationX(e),this.applyMatrix4(Qt),this}rotateY(e){return Qt.makeRotationY(e),this.applyMatrix4(Qt),this}rotateZ(e){return Qt.makeRotationZ(e),this.applyMatrix4(Qt),this}translate(e,t,n){return Qt.makeTranslation(e,t,n),this.applyMatrix4(Qt),this}scale(e,t,n){return Qt.makeScale(e,t,n),this.applyMatrix4(Qt),this}lookAt(e){return Ja.lookAt(e),Ja.updateMatrix(),this.applyMatrix4(Ja.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Wi).negate(),this.translate(Wi.x,Wi.y,Wi.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let o=e[s];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new Ve(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new vn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new D(-1/0,-1/0,-1/0),new D(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];Yt.setFromBufferAttribute(r),this.morphTargetsRelative?(St.addVectors(this.boundingBox.min,Yt.min),this.boundingBox.expandByPoint(St),St.addVectors(this.boundingBox.max,Yt.max),this.boundingBox.expandByPoint(St)):(this.boundingBox.expandByPoint(Yt.min),this.boundingBox.expandByPoint(Yt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new yn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new D,1/0);return}if(e){let n=this.boundingSphere.center;if(Yt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){let a=t[r];Es.setFromBufferAttribute(a),this.morphTargetsRelative?(St.addVectors(Yt.min,Es.min),Yt.expandByPoint(St),St.addVectors(Yt.max,Es.max),Yt.expandByPoint(St)):(Yt.expandByPoint(Es.min),Yt.expandByPoint(Es.max))}Yt.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)St.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(St));if(t)for(let r=0,o=t.length;r<o;r++){let a=t[r],l=this.morphTargetsRelative;for(let c=0,h=a.count;c<h;c++)St.fromBufferAttribute(a,c),l&&(Wi.fromBufferAttribute(e,c),St.add(Wi)),s=Math.max(s,n.distanceToSquared(St))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ft(new Float32Array(4*n.count),4));let o=this.getAttribute("tangent"),a=[],l=[];for(let I=0;I<n.count;I++)a[I]=new D,l[I]=new D;let c=new D,h=new D,u=new D,d=new te,f=new te,g=new te,x=new D,m=new D;function p(I,S,M){c.fromBufferAttribute(n,I),h.fromBufferAttribute(n,S),u.fromBufferAttribute(n,M),d.fromBufferAttribute(r,I),f.fromBufferAttribute(r,S),g.fromBufferAttribute(r,M),h.sub(c),u.sub(c),f.sub(d),g.sub(d);let L=1/(f.x*g.y-g.x*f.y);isFinite(L)&&(x.copy(h).multiplyScalar(g.y).addScaledVector(u,-f.y).multiplyScalar(L),m.copy(u).multiplyScalar(f.x).addScaledVector(h,-g.x).multiplyScalar(L),a[I].add(x),a[S].add(x),a[M].add(x),l[I].add(m),l[S].add(m),l[M].add(m))}let T=this.groups;T.length===0&&(T=[{start:0,count:e.count}]);for(let I=0,S=T.length;I<S;++I){let M=T[I],L=M.start,H=M.count;for(let z=L,k=L+H;z<k;z+=3)p(e.getX(z+0),e.getX(z+1),e.getX(z+2))}let y=new D,_=new D,C=new D,E=new D;function R(I){C.fromBufferAttribute(s,I),E.copy(C);let S=a[I];y.copy(S),y.sub(C.multiplyScalar(C.dot(S))).normalize(),_.crossVectors(E,S);let L=_.dot(l[I])<0?-1:1;o.setXYZW(I,y.x,y.y,y.z,L)}for(let I=0,S=T.length;I<S;++I){let M=T[I],L=M.start,H=M.count;for(let z=L,k=L+H;z<k;z+=3)R(e.getX(z+0)),R(e.getX(z+1)),R(e.getX(z+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ft(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let s=new D,r=new D,o=new D,a=new D,l=new D,c=new D,h=new D,u=new D;if(e)for(let d=0,f=e.count;d<f;d+=3){let g=e.getX(d+0),x=e.getX(d+1),m=e.getX(d+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,x),o.fromBufferAttribute(t,m),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,x),c.fromBufferAttribute(n,m),a.add(h),l.add(h),c.add(h),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(x,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let d=0,f=t.count;d<f;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),o.fromBufferAttribute(t,d+2),h.subVectors(o,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)St.fromBufferAttribute(e,t),St.normalize(),e.setXYZ(t,St.x,St.y,St.z)}toNonIndexed(){function e(a,l){let c=a.array,h=a.itemSize,u=a.normalized,d=new c.constructor(l.length*h),f=0,g=0;for(let x=0,m=l.length;x<m;x++){a.isInterleavedBufferAttribute?f=l[x]*a.data.stride+a.offset:f=l[x]*h;for(let p=0;p<h;p++)d[g++]=c[f++]}return new Ft(d,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let a in s){let l=s[a],c=e(l,n);t.setAttribute(a,c)}let r=this.morphAttributes;for(let a in r){let l=[],c=r[a];for(let h=0,u=c.length;h<u;h++){let d=c[h],f=e(d,n);l.push(f)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){let f=c[u];h.push(f.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let c in s){let h=s[c];this.setAttribute(c,h.clone(t))}let r=e.morphAttributes;for(let c in r){let h=[],u=r[c];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let c=0,h=o.length;c<h;c++){let u=o[c];this.addGroup(u.start,u.count,u.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},Sc=new st,hi=new lo,Fr=new yn,bc=new D,Or=new D,Br=new D,zr=new D,Ka=new D,kr=new D,Tc=new D,Vr=new D,ft=class extends mt{constructor(e=new at,t=new zn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let a=this.morphTargetInfluences;if(r&&a){kr.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=a[l],u=r[l];h!==0&&(Ka.fromBufferAttribute(u,e),o?kr.addScaledVector(Ka,h):kr.addScaledVector(Ka.sub(t),h))}t.add(kr)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Fr.copy(n.boundingSphere),Fr.applyMatrix4(r),hi.copy(e.ray).recast(e.near),!(Fr.containsPoint(hi.origin)===!1&&(hi.intersectSphere(Fr,bc)===null||hi.origin.distanceToSquared(bc)>(e.far-e.near)**2))&&(Sc.copy(r).invert(),hi.copy(e.ray).applyMatrix4(Sc),!(n.boundingBox!==null&&hi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,hi)))}_computeIntersections(e,t,n){let s,r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,f=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,x=d.length;g<x;g++){let m=d[g],p=o[m.materialIndex],T=Math.max(m.start,f.start),y=Math.min(a.count,Math.min(m.start+m.count,f.start+f.count));for(let _=T,C=y;_<C;_+=3){let E=a.getX(_),R=a.getX(_+1),I=a.getX(_+2);s=Gr(this,p,e,n,c,h,u,E,R,I),s&&(s.faceIndex=Math.floor(_/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,f.start),x=Math.min(a.count,f.start+f.count);for(let m=g,p=x;m<p;m+=3){let T=a.getX(m),y=a.getX(m+1),_=a.getX(m+2);s=Gr(this,o,e,n,c,h,u,T,y,_),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,x=d.length;g<x;g++){let m=d[g],p=o[m.materialIndex],T=Math.max(m.start,f.start),y=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let _=T,C=y;_<C;_+=3){let E=_,R=_+1,I=_+2;s=Gr(this,p,e,n,c,h,u,E,R,I),s&&(s.faceIndex=Math.floor(_/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,f.start),x=Math.min(l.count,f.start+f.count);for(let m=g,p=x;m<p;m+=3){let T=m,y=m+1,_=m+2;s=Gr(this,o,e,n,c,h,u,T,y,_),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}};function od(i,e,t,n,s,r,o,a){let l;if(e.side===Ot?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===Fn,a),l===null)return null;Vr.copy(a),Vr.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(Vr);return c<t.near||c>t.far?null:{distance:c,point:Vr.clone(),object:i}}function Gr(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,Or),i.getVertexPosition(l,Br),i.getVertexPosition(c,zr);let h=od(i,e,t,n,Or,Br,zr,Tc);if(h){let u=new D;Un.getBarycoord(Tc,Or,Br,zr,u),s&&(h.uv=Un.getInterpolatedAttribute(s,a,l,c,u,new te)),r&&(h.uv1=Un.getInterpolatedAttribute(r,a,l,c,u,new te)),o&&(h.normal=Un.getInterpolatedAttribute(o,a,l,c,u,new D),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a,b:l,c,normal:new D,materialIndex:0};Un.getNormal(Or,Br,zr,d.normal),h.face=d,h.barycoord=u}return h}var Qn=class i extends at{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};let a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);let l=[],c=[],h=[],u=[],d=0,f=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new Ve(c,3)),this.setAttribute("normal",new Ve(h,3)),this.setAttribute("uv",new Ve(u,2));function g(x,m,p,T,y,_,C,E,R,I,S){let M=_/R,L=C/I,H=_/2,z=C/2,k=E/2,G=R+1,Z=I+1,j=0,q=0,oe=new D;for(let me=0;me<Z;me++){let Me=me*L-z;for(let Pe=0;Pe<G;Pe++){let He=Pe*M-H;oe[x]=He*T,oe[m]=Me*y,oe[p]=k,c.push(oe.x,oe.y,oe.z),oe[x]=0,oe[m]=0,oe[p]=E>0?1:-1,h.push(oe.x,oe.y,oe.z),u.push(Pe/R),u.push(1-me/I),j+=1}}for(let me=0;me<I;me++)for(let Me=0;Me<R;Me++){let Pe=d+Me+G*me,He=d+Me+G*(me+1),$=d+(Me+1)+G*(me+1),ae=d+(Me+1)+G*me;l.push(Pe,He,ae),l.push(He,$,ae),q+=6}a.addGroup(f,q,S),f+=q,d+=j}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function Ai(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function Dt(i){let e={};for(let t=0;t<i.length;t++){let n=Ai(i[t]);for(let s in n)e[s]=n[s]}return e}function ad(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Pl(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Ze.workingColorSpace}var Ah={clone:Ai,merge:Dt},ld=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,cd=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,vt=class extends Mn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=ld,this.fragmentShader=cd,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ai(e.uniforms),this.uniformsGroups=ad(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},Xs=class extends mt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new st,this.projectionMatrix=new st,this.projectionMatrixInverse=new st,this.coordinateSystem=_n}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},Jn=new D,wc=new te,Ec=new te,Pt=class extends Xs{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=es*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Ds*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return es*2*Math.atan(Math.tan(Ds*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Jn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Jn.x,Jn.y).multiplyScalar(-e/Jn.z),Jn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Jn.x,Jn.y).multiplyScalar(-e/Jn.z)}getViewSize(e,t){return this.getViewBounds(e,wc,Ec),t.subVectors(Ec,wc)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Ds*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}let a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Xi=-90,qi=1,co=class extends mt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new Pt(Xi,qi,e,t);s.layers=this.layers,this.add(s);let r=new Pt(Xi,qi,e,t);r.layers=this.layers,this.add(r);let o=new Pt(Xi,qi,e,t);o.layers=this.layers,this.add(o);let a=new Pt(Xi,qi,e,t);a.layers=this.layers,this.add(a);let l=new Pt(Xi,qi,e,t);l.layers=this.layers,this.add(l);let c=new Pt(Xi,qi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(let c of t)this.remove(c);if(e===_n)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===zs)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,o,a,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=x,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},qs=class extends Et{constructor(e=[],t=wi,n,s,r,o,a,l,c,h){super(e,t,n,s,r,o,a,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},ho=class extends jt{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new qs(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:hn}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new Qn(5,5,5),r=new vt({name:"CubemapFromEquirect",uniforms:Ai(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Ot,blending:Vn});r.uniforms.tEquirect.value=t;let o=new ft(s,r),a=t.minFilter;return t.minFilter===ni&&(t.minFilter=hn),new co(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}},it=class extends mt{constructor(){super(),this.isGroup=!0,this.type="Group"}},hd={type:"move"},ns=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new it,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new it,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new D,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new D),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new it,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new D,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new D),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(let x of e.hand.values()){let m=t.getJointPose(x,n),p=this._getHandJoint(c,x);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,g=.005;c.inputState.pinching&&d>f+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=f-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(hd)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new it;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}};var is=class extends mt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new un,this.environmentIntensity=1,this.environmentRotation=new un,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},uo=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=so,this.updateRanges=[],this.version=0,this.uuid=xn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let s=0,r=this.stride;s<r;s++)this.array[e+s]=t.array[n+s];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=xn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=xn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},Nt=new D,Ys=class i{constructor(e,t,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=s}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Nt.fromBufferAttribute(this,t),Nt.applyMatrix4(e),this.setXYZ(t,Nt.x,Nt.y,Nt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Nt.fromBufferAttribute(this,t),Nt.applyNormalMatrix(e),this.setXYZ(t,Nt.x,Nt.y,Nt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Nt.fromBufferAttribute(this,t),Nt.transformDirection(e),this.setXYZ(t,Nt.x,Nt.y,Nt.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=cn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=et(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=et(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=et(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=et(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=et(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=cn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=cn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=cn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=cn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=et(t,this.array),n=et(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=et(t,this.array),n=et(n,this.array),s=et(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=et(t,this.array),n=et(n,this.array),s=et(s,this.array),r=et(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this.data.array[e+3]=r,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return new Ft(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new i(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},ss=class extends Mn{constructor(e){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new Ie(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.rotation=e.rotation,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Yi,As=new D,Zi=new D,Ji=new D,Ki=new te,Cs=new te,Ch=new st,Hr=new D,Rs=new D,Wr=new D,Ac=new te,$a=new te,Cc=new te,Zs=class extends mt{constructor(e=new ss){if(super(),this.isSprite=!0,this.type="Sprite",Yi===void 0){Yi=new at;let t=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new uo(t,5);Yi.setIndex([0,1,2,0,2,3]),Yi.setAttribute("position",new Ys(n,3,0,!1)),Yi.setAttribute("uv",new Ys(n,2,3,!1))}this.geometry=Yi,this.material=e,this.center=new te(.5,.5)}raycast(e,t){e.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Zi.setFromMatrixScale(this.matrixWorld),Ch.copy(e.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(e.camera.matrixWorldInverse,this.matrixWorld),Ji.setFromMatrixPosition(this.modelViewMatrix),e.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Zi.multiplyScalar(-Ji.z);let n=this.material.rotation,s,r;n!==0&&(r=Math.cos(n),s=Math.sin(n));let o=this.center;Xr(Hr.set(-.5,-.5,0),Ji,o,Zi,s,r),Xr(Rs.set(.5,-.5,0),Ji,o,Zi,s,r),Xr(Wr.set(.5,.5,0),Ji,o,Zi,s,r),Ac.set(0,0),$a.set(1,0),Cc.set(1,1);let a=e.ray.intersectTriangle(Hr,Rs,Wr,!1,As);if(a===null&&(Xr(Rs.set(-.5,.5,0),Ji,o,Zi,s,r),$a.set(0,1),a=e.ray.intersectTriangle(Hr,Wr,Rs,!1,As),a===null))return;let l=e.ray.origin.distanceTo(As);l<e.near||l>e.far||t.push({distance:l,point:As.clone(),uv:Un.getInterpolation(As,Hr,Rs,Wr,Ac,$a,Cc,new te),face:null,object:this})}copy(e,t){return super.copy(e,t),e.center!==void 0&&this.center.copy(e.center),this.material=e.material,this}};function Xr(i,e,t,n,s,r){Ki.subVectors(i,t).addScalar(.5).multiply(n),s!==void 0?(Cs.x=r*Ki.x-s*Ki.y,Cs.y=s*Ki.x+r*Ki.y):Cs.copy(Ki),i.copy(e),i.x+=Cs.x,i.y+=Cs.y,i.applyMatrix4(Ch)}var fo=class extends Et{constructor(e=null,t=1,n=1,s,r,o,a,l,c=Gt,h=Gt,u,d){super(null,o,a,l,c,h,s,r,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Js=class extends Ft{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},$i=new st,Rc=new st,qr=[],Ic=new vn,ud=new st,Is=new ft,Ps=new yn,_i=class extends ft{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Js(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,ud)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new vn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,$i),Ic.copy(e.boundingBox).applyMatrix4($i),this.boundingBox.union(Ic)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new yn),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,$i),Ps.copy(e.boundingSphere).applyMatrix4($i),this.boundingSphere.union(Ps)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,o=e*r+1;for(let a=0;a<n.length;a++)n[a]=s[o+a]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Is.geometry=this.geometry,Is.material=this.material,Is.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Ps.copy(this.boundingSphere),Ps.applyMatrix4(n),e.ray.intersectsSphere(Ps)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,$i),Rc.multiplyMatrices(n,$i),Is.matrixWorld=Rc,Is.raycast(e,qr);for(let o=0,a=qr.length;o<a;o++){let l=qr[o];l.instanceId=r,l.object=this,t.push(l)}qr.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new Js(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new fo(new Float32Array(s*this.count),s,this.count,Wo,mn));let r=this.morphTexture.source.data.data,o=0;for(let c=0;c<n.length;c++)o+=n[c];let a=this.geometry.morphTargetsRelative?1:1-o,l=s*e;r[l]=a,r.set(n,l+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Qa=new D,dd=new D,fd=new Ge,gn=class{constructor(e=new D(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=Qa.subVectors(n,t).cross(dd.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(Qa),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||fd.getNormalMatrix(e),s=this.coplanarPoint(Qa).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},ui=new yn,Yr=new D,rs=class{constructor(e=new gn,t=new gn,n=new gn,s=new gn,r=new gn,o=new gn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=_n){let n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],h=s[5],u=s[6],d=s[7],f=s[8],g=s[9],x=s[10],m=s[11],p=s[12],T=s[13],y=s[14],_=s[15];if(n[0].setComponents(l-r,d-c,m-f,_-p).normalize(),n[1].setComponents(l+r,d+c,m+f,_+p).normalize(),n[2].setComponents(l+o,d+h,m+g,_+T).normalize(),n[3].setComponents(l-o,d-h,m-g,_-T).normalize(),n[4].setComponents(l-a,d-u,m-x,_-y).normalize(),t===_n)n[5].setComponents(l+a,d+u,m+x,_+y).normalize();else if(t===zs)n[5].setComponents(a,u,x,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ui.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),ui.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ui)}intersectsSprite(e){return ui.center.set(0,0,0),ui.radius=.7071067811865476,ui.applyMatrix4(e.matrixWorld),this.intersectsSphere(ui)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(Yr.x=s.normal.x>0?e.max.x:e.min.x,Yr.y=s.normal.y>0?e.max.y:e.min.y,Yr.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Yr)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var xi=class extends Et{constructor(e,t,n,s,r,o,a,l,c){super(e,t,n,s,r,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}},Ks=class extends Et{constructor(e,t,n=ii,s,r,o,a=Gt,l=Gt,c,h=ji){if(h!==ji&&h!==ps)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");super(null,s,r,o,a,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new ts(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}};var vi=class i extends at{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],o=[],a=[],l=[],c=new D,h=new te;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){let f=n+u/t*s;c.x=e*Math.cos(f),c.y=e*Math.sin(f),o.push(c.x,c.y,c.z),a.push(0,0,1),h.x=(o[d]/e+1)/2,h.y=(o[d+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new Ve(o,3)),this.setAttribute("normal",new Ve(a,3)),this.setAttribute("uv",new Ve(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}},Sn=class i extends at{constructor(e=1,t=1,n=1,s=32,r=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:l};let c=this;s=Math.floor(s),r=Math.floor(r);let h=[],u=[],d=[],f=[],g=0,x=[],m=n/2,p=0;T(),o===!1&&(e>0&&y(!0),t>0&&y(!1)),this.setIndex(h),this.setAttribute("position",new Ve(u,3)),this.setAttribute("normal",new Ve(d,3)),this.setAttribute("uv",new Ve(f,2));function T(){let _=new D,C=new D,E=0,R=(t-e)/n;for(let I=0;I<=r;I++){let S=[],M=I/r,L=M*(t-e)+e;for(let H=0;H<=s;H++){let z=H/s,k=z*l+a,G=Math.sin(k),Z=Math.cos(k);C.x=L*G,C.y=-M*n+m,C.z=L*Z,u.push(C.x,C.y,C.z),_.set(G,R,Z).normalize(),d.push(_.x,_.y,_.z),f.push(z,1-M),S.push(g++)}x.push(S)}for(let I=0;I<s;I++)for(let S=0;S<r;S++){let M=x[S][I],L=x[S+1][I],H=x[S+1][I+1],z=x[S][I+1];(e>0||S!==0)&&(h.push(M,L,z),E+=3),(t>0||S!==r-1)&&(h.push(L,H,z),E+=3)}c.addGroup(p,E,0),p+=E}function y(_){let C=g,E=new te,R=new D,I=0,S=_===!0?e:t,M=_===!0?1:-1;for(let H=1;H<=s;H++)u.push(0,m*M,0),d.push(0,M,0),f.push(.5,.5),g++;let L=g;for(let H=0;H<=s;H++){let k=H/s*l+a,G=Math.cos(k),Z=Math.sin(k);R.x=S*Z,R.y=m*M,R.z=S*G,u.push(R.x,R.y,R.z),d.push(0,M,0),E.x=G*.5+.5,E.y=Z*.5*M+.5,f.push(E.x,E.y),g++}for(let H=0;H<s;H++){let z=C+H,k=L+H;_===!0?h.push(k,k+1,z):h.push(k+1,k,z),I+=3}c.addGroup(p,I,_===!0?1:2),p+=I}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var $s=class i extends at{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};let r=[],o=[];a(s),c(n),h(),this.setAttribute("position",new Ve(r,3)),this.setAttribute("normal",new Ve(r.slice(),3)),this.setAttribute("uv",new Ve(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(T){let y=new D,_=new D,C=new D;for(let E=0;E<t.length;E+=3)f(t[E+0],y),f(t[E+1],_),f(t[E+2],C),l(y,_,C,T)}function l(T,y,_,C){let E=C+1,R=[];for(let I=0;I<=E;I++){R[I]=[];let S=T.clone().lerp(_,I/E),M=y.clone().lerp(_,I/E),L=E-I;for(let H=0;H<=L;H++)H===0&&I===E?R[I][H]=S:R[I][H]=S.clone().lerp(M,H/L)}for(let I=0;I<E;I++)for(let S=0;S<2*(E-I)-1;S++){let M=Math.floor(S/2);S%2===0?(d(R[I][M+1]),d(R[I+1][M]),d(R[I][M])):(d(R[I][M+1]),d(R[I+1][M+1]),d(R[I+1][M]))}}function c(T){let y=new D;for(let _=0;_<r.length;_+=3)y.x=r[_+0],y.y=r[_+1],y.z=r[_+2],y.normalize().multiplyScalar(T),r[_+0]=y.x,r[_+1]=y.y,r[_+2]=y.z}function h(){let T=new D;for(let y=0;y<r.length;y+=3){T.x=r[y+0],T.y=r[y+1],T.z=r[y+2];let _=m(T)/2/Math.PI+.5,C=p(T)/Math.PI+.5;o.push(_,1-C)}g(),u()}function u(){for(let T=0;T<o.length;T+=6){let y=o[T+0],_=o[T+2],C=o[T+4],E=Math.max(y,_,C),R=Math.min(y,_,C);E>.9&&R<.1&&(y<.2&&(o[T+0]+=1),_<.2&&(o[T+2]+=1),C<.2&&(o[T+4]+=1))}}function d(T){r.push(T.x,T.y,T.z)}function f(T,y){let _=T*3;y.x=e[_+0],y.y=e[_+1],y.z=e[_+2]}function g(){let T=new D,y=new D,_=new D,C=new D,E=new te,R=new te,I=new te;for(let S=0,M=0;S<r.length;S+=9,M+=6){T.set(r[S+0],r[S+1],r[S+2]),y.set(r[S+3],r[S+4],r[S+5]),_.set(r[S+6],r[S+7],r[S+8]),E.set(o[M+0],o[M+1]),R.set(o[M+2],o[M+3]),I.set(o[M+4],o[M+5]),C.copy(T).add(y).add(_).divideScalar(3);let L=m(C);x(E,M+0,T,L),x(R,M+2,y,L),x(I,M+4,_,L)}}function x(T,y,_,C){C<0&&T.x===1&&(o[y]=T.x-1),_.x===0&&_.z===0&&(o[y]=C/2/Math.PI+.5)}function m(T){return Math.atan2(T.z,-T.x)}function p(T){return Math.atan2(-T.y,Math.sqrt(T.x*T.x+T.z*T.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.vertices,e.indices,e.radius,e.details)}};var Zt=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,s=this.getPoint(0),r=0;t.push(0);for(let o=1;o<=e;o++)n=this.getPoint(o/e),r+=n.distanceTo(s),t.push(r),s=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),s=0,r=n.length,o;t?o=t:o=e*n[r-1];let a=0,l=r-1,c;for(;a<=l;)if(s=Math.floor(a+(l-a)/2),c=n[s]-o,c<0)a=s+1;else if(c>0)l=s-1;else{l=s;break}if(s=l,n[s]===o)return s/(r-1);let h=n[s],d=n[s+1]-h,f=(o-h)/d;return(s+f)/(r-1)}getTangent(e,t){let s=e-1e-4,r=e+1e-4;s<0&&(s=0),r>1&&(r=1);let o=this.getPoint(s),a=this.getPoint(r),l=t||(o.isVector2?new te:new D);return l.copy(a).sub(o).normalize(),l}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new D,s=[],r=[],o=[],a=new D,l=new st;for(let f=0;f<=e;f++){let g=f/e;s[f]=this.getTangentAt(g,new D)}r[0]=new D,o[0]=new D;let c=Number.MAX_VALUE,h=Math.abs(s[0].x),u=Math.abs(s[0].y),d=Math.abs(s[0].z);h<=c&&(c=h,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),a.crossVectors(s[0],n).normalize(),r[0].crossVectors(s[0],a),o[0].crossVectors(s[0],r[0]);for(let f=1;f<=e;f++){if(r[f]=r[f-1].clone(),o[f]=o[f-1].clone(),a.crossVectors(s[f-1],s[f]),a.length()>Number.EPSILON){a.normalize();let g=Math.acos(We(s[f-1].dot(s[f]),-1,1));r[f].applyMatrix4(l.makeRotationAxis(a,g))}o[f].crossVectors(s[f],r[f])}if(t===!0){let f=Math.acos(We(r[0].dot(r[e]),-1,1));f/=e,s[0].dot(a.crossVectors(r[0],r[e]))>0&&(f=-f);for(let g=1;g<=e;g++)r[g].applyMatrix4(l.makeRotationAxis(s[g],f*g)),o[g].crossVectors(s[g],r[g])}return{tangents:s,normals:r,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.6,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},os=class extends Zt{constructor(e=0,t=0,n=1,s=1,r=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=s,this.aStartAngle=r,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(e,t=new te){let n=t,s=Math.PI*2,r=this.aEndAngle-this.aStartAngle,o=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=s;for(;r>s;)r-=s;r<Number.EPSILON&&(o?r=0:r=s),this.aClockwise===!0&&!o&&(r===s?r=-s:r=r-s);let a=this.aStartAngle+e*r,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=l-this.aX,f=c-this.aY;l=d*h-f*u+this.aX,c=d*u+f*h+this.aY}return n.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},po=class extends os{constructor(e,t,n,s,r,o){super(e,t,n,n,s,r,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Ll(){let i=0,e=0,t=0,n=0;function s(r,o,a,l){i=r,e=a,t=-3*r+3*o-2*a-l,n=2*r-2*o+a+l}return{initCatmullRom:function(r,o,a,l,c){s(o,a,c*(a-r),c*(l-o))},initNonuniformCatmullRom:function(r,o,a,l,c,h,u){let d=(o-r)/c-(a-r)/(c+h)+(a-o)/h,f=(a-o)/h-(l-o)/(h+u)+(l-a)/u;d*=h,f*=h,s(o,a,d,f)},calc:function(r){let o=r*r,a=o*r;return i+e*r+t*o+n*a}}}var Zr=new D,ja=new Ll,el=new Ll,tl=new Ll,bn=class extends Zt{constructor(e=[],t=!1,n="centripetal",s=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=s}getPoint(e,t=new D){let n=t,s=this.points,r=s.length,o=(r-(this.closed?0:1))*e,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/r)+1)*r:l===0&&a===r-1&&(a=r-2,l=1);let c,h;this.closed||a>0?c=s[(a-1)%r]:(Zr.subVectors(s[0],s[1]).add(s[0]),c=Zr);let u=s[a%r],d=s[(a+1)%r];if(this.closed||a+2<r?h=s[(a+2)%r]:(Zr.subVectors(s[r-1],s[r-2]).add(s[r-1]),h=Zr),this.curveType==="centripetal"||this.curveType==="chordal"){let f=this.curveType==="chordal"?.5:.25,g=Math.pow(c.distanceToSquared(u),f),x=Math.pow(u.distanceToSquared(d),f),m=Math.pow(d.distanceToSquared(h),f);x<1e-4&&(x=1),g<1e-4&&(g=x),m<1e-4&&(m=x),ja.initNonuniformCatmullRom(c.x,u.x,d.x,h.x,g,x,m),el.initNonuniformCatmullRom(c.y,u.y,d.y,h.y,g,x,m),tl.initNonuniformCatmullRom(c.z,u.z,d.z,h.z,g,x,m)}else this.curveType==="catmullrom"&&(ja.initCatmullRom(c.x,u.x,d.x,h.x,this.tension),el.initCatmullRom(c.y,u.y,d.y,h.y,this.tension),tl.initCatmullRom(c.z,u.z,d.z,h.z,this.tension));return n.set(ja.calc(l),el.calc(l),tl.calc(l)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new D().fromArray(s))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function Pc(i,e,t,n,s){let r=(n-e)*.5,o=(s-t)*.5,a=i*i,l=i*a;return(2*t-2*n+r+o)*l+(-3*t+3*n-2*r-o)*a+r*i+t}function pd(i,e){let t=1-i;return t*t*e}function md(i,e){return 2*(1-i)*i*e}function gd(i,e){return i*i*e}function Ns(i,e,t,n){return pd(i,e)+md(i,t)+gd(i,n)}function _d(i,e){let t=1-i;return t*t*t*e}function xd(i,e){let t=1-i;return 3*t*t*i*e}function vd(i,e){return 3*(1-i)*i*i*e}function yd(i,e){return i*i*i*e}function Fs(i,e,t,n,s){return _d(i,e)+xd(i,t)+vd(i,n)+yd(i,s)}var Qs=class extends Zt{constructor(e=new te,t=new te,n=new te,s=new te){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new te){let n=t,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Fs(e,s.x,r.x,o.x,a.x),Fs(e,s.y,r.y,o.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},mo=class extends Zt{constructor(e=new D,t=new D,n=new D,s=new D){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=s}getPoint(e,t=new D){let n=t,s=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Fs(e,s.x,r.x,o.x,a.x),Fs(e,s.y,r.y,o.y,a.y),Fs(e,s.z,r.z,o.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},js=class extends Zt{constructor(e=new te,t=new te){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new te){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new te){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},as=class extends Zt{constructor(e=new D,t=new D){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new D){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new D){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},er=class extends Zt{constructor(e=new te,t=new te,n=new te){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new te){let n=t,s=this.v0,r=this.v1,o=this.v2;return n.set(Ns(e,s.x,r.x,o.x),Ns(e,s.y,r.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},yi=class extends Zt{constructor(e=new D,t=new D,n=new D){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new D){let n=t,s=this.v0,r=this.v1,o=this.v2;return n.set(Ns(e,s.x,r.x,o.x),Ns(e,s.y,r.y,o.y),Ns(e,s.z,r.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},tr=class extends Zt{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new te){let n=t,s=this.points,r=(s.length-1)*e,o=Math.floor(r),a=r-o,l=s[o===0?o:o-1],c=s[o],h=s[o>s.length-2?s.length-1:o+1],u=s[o>s.length-3?s.length-1:o+2];return n.set(Pc(a,l.x,c.x,h.x,u.x),Pc(a,l.y,c.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let s=this.points[t];e.points.push(s.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let s=e.points[t];this.points.push(new te().fromArray(s))}return this}},go=Object.freeze({__proto__:null,ArcCurve:po,CatmullRomCurve3:bn,CubicBezierCurve:Qs,CubicBezierCurve3:mo,EllipseCurve:os,LineCurve:js,LineCurve3:as,QuadraticBezierCurve:er,QuadraticBezierCurve3:yi,SplineCurve:tr}),ls=class extends Zt{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let n=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new go[n](t,e))}return this}getPoint(e,t){let n=e*this.getLength(),s=this.getCurveLengths(),r=0;for(;r<s.length;){if(s[r]>=n){let o=s[r]-n,a=this.curves[r],l=a.getLength(),c=l===0?0:1-o/l;return a.getPointAt(c,t)}r++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let n=0,s=this.curves.length;n<s;n++)t+=this.curves[n].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],n;for(let s=0,r=this.curves;s<r.length;s++){let o=r[s],a=o.isEllipseCurve?e*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?e*o.points.length:e,l=o.getPoints(a);for(let c=0;c<l.length;c++){let h=l[c];n&&n.equals(h)||(t.push(h),n=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(s.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,n=this.curves.length;t<n;t++){let s=this.curves[t];e.curves.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let s=e.curves[t];this.curves.push(new go[s.type]().fromJSON(s))}return this}},nr=class extends ls{constructor(e){super(),this.type="Path",this.currentPoint=new te,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,n=e.length;t<n;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let n=new js(this.currentPoint.clone(),new te(e,t));return this.curves.push(n),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,n,s){let r=new er(this.currentPoint.clone(),new te(e,t),new te(n,s));return this.curves.push(r),this.currentPoint.set(n,s),this}bezierCurveTo(e,t,n,s,r,o){let a=new Qs(this.currentPoint.clone(),new te(e,t),new te(n,s),new te(r,o));return this.curves.push(a),this.currentPoint.set(r,o),this}splineThru(e){let t=[this.currentPoint.clone()].concat(e),n=new tr(t);return this.curves.push(n),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,n,s,r,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+a,t+l,n,s,r,o),this}absarc(e,t,n,s,r,o){return this.absellipse(e,t,n,n,s,r,o),this}ellipse(e,t,n,s,r,o,a,l){let c=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+c,t+h,n,s,r,o,a,l),this}absellipse(e,t,n,s,r,o,a,l){let c=new os(e,t,n,s,r,o,a,l);if(this.curves.length>0){let u=c.getPoint(0);u.equals(this.currentPoint)||this.lineTo(u.x,u.y)}this.curves.push(c);let h=c.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Mi=class extends nr{constructor(e){super(e),this.uuid=xn(),this.type="Shape",this.holes=[]}getPointsHoles(e){let t=[];for(let n=0,s=this.holes.length;n<s;n++)t[n]=this.holes[n].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(s.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,n=this.holes.length;t<n;t++){let s=this.holes[t];e.holes.push(s.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let s=e.holes[t];this.holes.push(new nr().fromJSON(s))}return this}};function Md(i,e,t=2){let n=e&&e.length,s=n?e[0]*t:i.length,r=Rh(i,0,s,t,!0),o=[];if(!r||r.next===r.prev)return o;let a,l,c;if(n&&(r=Ed(i,e,r,t)),i.length>80*t){a=1/0,l=1/0;let h=-1/0,u=-1/0;for(let d=t;d<s;d+=t){let f=i[d],g=i[d+1];f<a&&(a=f),g<l&&(l=g),f>h&&(h=f),g>u&&(u=g)}c=Math.max(h-a,u-l),c=c!==0?32767/c:0}return ir(r,o,t,a,l,c,0),o}function Rh(i,e,t,n,s){let r;if(s===Od(i,e,t,n)>0)for(let o=e;o<t;o+=n)r=Lc(o/n|0,i[o],i[o+1],r);else for(let o=t-n;o>=e;o-=n)r=Lc(o/n|0,i[o],i[o+1],r);return r&&cs(r,r.next)&&(rr(r),r=r.next),r}function Si(i,e){if(!i)return i;e||(e=i);let t=i,n;do if(n=!1,!t.steiner&&(cs(t,t.next)||ht(t.prev,t,t.next)===0)){if(rr(t),t=e=t.prev,t===t.next)break;n=!0}else t=t.next;while(n||t!==e);return e}function ir(i,e,t,n,s,r,o){if(!i)return;!o&&r&&Pd(i,n,s,r);let a=i;for(;i.prev!==i.next;){let l=i.prev,c=i.next;if(r?bd(i,n,s,r):Sd(i)){e.push(l.i,i.i,c.i),rr(i),i=c.next,a=c.next;continue}if(i=c,i===a){o?o===1?(i=Td(Si(i),e),ir(i,e,t,n,s,r,2)):o===2&&wd(i,e,t,n,s,r):ir(Si(i),e,t,n,s,r,1);break}}}function Sd(i){let e=i.prev,t=i,n=i.next;if(ht(e,t,n)>=0)return!1;let s=e.x,r=t.x,o=n.x,a=e.y,l=t.y,c=n.y,h=Math.min(s,r,o),u=Math.min(a,l,c),d=Math.max(s,r,o),f=Math.max(a,l,c),g=n.next;for(;g!==e;){if(g.x>=h&&g.x<=d&&g.y>=u&&g.y<=f&&Ls(s,a,r,l,o,c,g.x,g.y)&&ht(g.prev,g,g.next)>=0)return!1;g=g.next}return!0}function bd(i,e,t,n){let s=i.prev,r=i,o=i.next;if(ht(s,r,o)>=0)return!1;let a=s.x,l=r.x,c=o.x,h=s.y,u=r.y,d=o.y,f=Math.min(a,l,c),g=Math.min(h,u,d),x=Math.max(a,l,c),m=Math.max(h,u,d),p=al(f,g,e,t,n),T=al(x,m,e,t,n),y=i.prevZ,_=i.nextZ;for(;y&&y.z>=p&&_&&_.z<=T;){if(y.x>=f&&y.x<=x&&y.y>=g&&y.y<=m&&y!==s&&y!==o&&Ls(a,h,l,u,c,d,y.x,y.y)&&ht(y.prev,y,y.next)>=0||(y=y.prevZ,_.x>=f&&_.x<=x&&_.y>=g&&_.y<=m&&_!==s&&_!==o&&Ls(a,h,l,u,c,d,_.x,_.y)&&ht(_.prev,_,_.next)>=0))return!1;_=_.nextZ}for(;y&&y.z>=p;){if(y.x>=f&&y.x<=x&&y.y>=g&&y.y<=m&&y!==s&&y!==o&&Ls(a,h,l,u,c,d,y.x,y.y)&&ht(y.prev,y,y.next)>=0)return!1;y=y.prevZ}for(;_&&_.z<=T;){if(_.x>=f&&_.x<=x&&_.y>=g&&_.y<=m&&_!==s&&_!==o&&Ls(a,h,l,u,c,d,_.x,_.y)&&ht(_.prev,_,_.next)>=0)return!1;_=_.nextZ}return!0}function Td(i,e){let t=i;do{let n=t.prev,s=t.next.next;!cs(n,s)&&Ph(n,t,t.next,s)&&sr(n,s)&&sr(s,n)&&(e.push(n.i,t.i,s.i),rr(t),rr(t.next),t=i=s),t=t.next}while(t!==i);return Si(t)}function wd(i,e,t,n,s,r){let o=i;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&Ud(o,a)){let l=Lh(o,a);o=Si(o,o.next),l=Si(l,l.next),ir(o,e,t,n,s,r,0),ir(l,e,t,n,s,r,0);return}a=a.next}o=o.next}while(o!==i)}function Ed(i,e,t,n){let s=[];for(let r=0,o=e.length;r<o;r++){let a=e[r]*n,l=r<o-1?e[r+1]*n:i.length,c=Rh(i,a,l,n,!1);c===c.next&&(c.steiner=!0),s.push(Dd(c))}s.sort(Ad);for(let r=0;r<s.length;r++)t=Cd(s[r],t);return t}function Ad(i,e){let t=i.x-e.x;if(t===0&&(t=i.y-e.y,t===0)){let n=(i.next.y-i.y)/(i.next.x-i.x),s=(e.next.y-e.y)/(e.next.x-e.x);t=n-s}return t}function Cd(i,e){let t=Rd(i,e);if(!t)return e;let n=Lh(t,i);return Si(n,n.next),Si(t,t.next)}function Rd(i,e){let t=e,n=i.x,s=i.y,r=-1/0,o;if(cs(i,t))return t;do{if(cs(i,t.next))return t.next;if(s<=t.y&&s>=t.next.y&&t.next.y!==t.y){let u=t.x+(s-t.y)*(t.next.x-t.x)/(t.next.y-t.y);if(u<=n&&u>r&&(r=u,o=t.x<t.next.x?t:t.next,u===n))return o}t=t.next}while(t!==e);if(!o)return null;let a=o,l=o.x,c=o.y,h=1/0;t=o;do{if(n>=t.x&&t.x>=l&&n!==t.x&&Ih(s<c?n:r,s,l,c,s<c?r:n,s,t.x,t.y)){let u=Math.abs(s-t.y)/(n-t.x);sr(t,i)&&(u<h||u===h&&(t.x>o.x||t.x===o.x&&Id(o,t)))&&(o=t,h=u)}t=t.next}while(t!==a);return o}function Id(i,e){return ht(i.prev,i,e.prev)<0&&ht(e.next,i,i.next)<0}function Pd(i,e,t,n){let s=i;do s.z===0&&(s.z=al(s.x,s.y,e,t,n)),s.prevZ=s.prev,s.nextZ=s.next,s=s.next;while(s!==i);s.prevZ.nextZ=null,s.prevZ=null,Ld(s)}function Ld(i){let e,t=1;do{let n=i,s;i=null;let r=null;for(e=0;n;){e++;let o=n,a=0;for(let c=0;c<t&&(a++,o=o.nextZ,!!o);c++);let l=t;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||n.z<=o.z)?(s=n,n=n.nextZ,a--):(s=o,o=o.nextZ,l--),r?r.nextZ=s:i=s,s.prevZ=r,r=s;n=o}r.nextZ=null,t*=2}while(e>1);return i}function al(i,e,t,n,s){return i=(i-t)*s|0,e=(e-n)*s|0,i=(i|i<<8)&16711935,i=(i|i<<4)&252645135,i=(i|i<<2)&858993459,i=(i|i<<1)&1431655765,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,i|e<<1}function Dd(i){let e=i,t=i;do(e.x<t.x||e.x===t.x&&e.y<t.y)&&(t=e),e=e.next;while(e!==i);return t}function Ih(i,e,t,n,s,r,o,a){return(s-o)*(e-a)>=(i-o)*(r-a)&&(i-o)*(n-a)>=(t-o)*(e-a)&&(t-o)*(r-a)>=(s-o)*(n-a)}function Ls(i,e,t,n,s,r,o,a){return!(i===o&&e===a)&&Ih(i,e,t,n,s,r,o,a)}function Ud(i,e){return i.next.i!==e.i&&i.prev.i!==e.i&&!Nd(i,e)&&(sr(i,e)&&sr(e,i)&&Fd(i,e)&&(ht(i.prev,i,e.prev)||ht(i,e.prev,e))||cs(i,e)&&ht(i.prev,i,i.next)>0&&ht(e.prev,e,e.next)>0)}function ht(i,e,t){return(e.y-i.y)*(t.x-e.x)-(e.x-i.x)*(t.y-e.y)}function cs(i,e){return i.x===e.x&&i.y===e.y}function Ph(i,e,t,n){let s=Kr(ht(i,e,t)),r=Kr(ht(i,e,n)),o=Kr(ht(t,n,i)),a=Kr(ht(t,n,e));return!!(s!==r&&o!==a||s===0&&Jr(i,t,e)||r===0&&Jr(i,n,e)||o===0&&Jr(t,i,n)||a===0&&Jr(t,e,n))}function Jr(i,e,t){return e.x<=Math.max(i.x,t.x)&&e.x>=Math.min(i.x,t.x)&&e.y<=Math.max(i.y,t.y)&&e.y>=Math.min(i.y,t.y)}function Kr(i){return i>0?1:i<0?-1:0}function Nd(i,e){let t=i;do{if(t.i!==i.i&&t.next.i!==i.i&&t.i!==e.i&&t.next.i!==e.i&&Ph(t,t.next,i,e))return!0;t=t.next}while(t!==i);return!1}function sr(i,e){return ht(i.prev,i,i.next)<0?ht(i,e,i.next)>=0&&ht(i,i.prev,e)>=0:ht(i,e,i.prev)<0||ht(i,i.next,e)<0}function Fd(i,e){let t=i,n=!1,s=(i.x+e.x)/2,r=(i.y+e.y)/2;do t.y>r!=t.next.y>r&&t.next.y!==t.y&&s<(t.next.x-t.x)*(r-t.y)/(t.next.y-t.y)+t.x&&(n=!n),t=t.next;while(t!==i);return n}function Lh(i,e){let t=ll(i.i,i.x,i.y),n=ll(e.i,e.x,e.y),s=i.next,r=e.prev;return i.next=e,e.prev=i,t.next=s,s.prev=t,n.next=t,t.prev=n,r.next=n,n.prev=r,n}function Lc(i,e,t,n){let s=ll(i,e,t);return n?(s.next=n.next,s.prev=n,n.next.prev=s,n.next=s):(s.prev=s,s.next=s),s}function rr(i){i.next.prev=i.prev,i.prev.next=i.next,i.prevZ&&(i.prevZ.nextZ=i.nextZ),i.nextZ&&(i.nextZ.prevZ=i.prevZ)}function ll(i,e,t){return{i,x:e,y:t,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function Od(i,e,t,n){let s=0;for(let r=e,o=t-n;r<t;r+=n)s+=(i[o]-i[r])*(i[r+1]+i[o+1]),o=r;return s}var cl=class{static triangulate(e,t,n=2){return Md(e,t,n)}},fi=class i{static area(e){let t=e.length,n=0;for(let s=t-1,r=0;r<t;s=r++)n+=e[s].x*e[r].y-e[r].x*e[s].y;return n*.5}static isClockWise(e){return i.area(e)<0}static triangulateShape(e,t){let n=[],s=[],r=[];Dc(e),Uc(n,e);let o=e.length;t.forEach(Dc);for(let l=0;l<t.length;l++)s.push(o),o+=t[l].length,Uc(n,t[l]);let a=cl.triangulate(n,s);for(let l=0;l<a.length;l+=3)r.push(a.slice(l,l+3));return r}};function Dc(i){let e=i.length;e>2&&i[e-1].equals(i[0])&&i.pop()}function Uc(i,e){for(let t=0;t<e.length;t++)i.push(e[t].x),i.push(e[t].y)}var hs=class i extends at{constructor(e=new Mi([new te(.5,.5),new te(-.5,.5),new te(-.5,-.5),new te(.5,-.5)]),t={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:e,options:t},e=Array.isArray(e)?e:[e];let n=this,s=[],r=[];for(let a=0,l=e.length;a<l;a++){let c=e[a];o(c)}this.setAttribute("position",new Ve(s,3)),this.setAttribute("uv",new Ve(r,2)),this.computeVertexNormals();function o(a){let l=[],c=t.curveSegments!==void 0?t.curveSegments:12,h=t.steps!==void 0?t.steps:1,u=t.depth!==void 0?t.depth:1,d=t.bevelEnabled!==void 0?t.bevelEnabled:!0,f=t.bevelThickness!==void 0?t.bevelThickness:.2,g=t.bevelSize!==void 0?t.bevelSize:f-.1,x=t.bevelOffset!==void 0?t.bevelOffset:0,m=t.bevelSegments!==void 0?t.bevelSegments:3,p=t.extrudePath,T=t.UVGenerator!==void 0?t.UVGenerator:Bd,y,_=!1,C,E,R,I;p&&(y=p.getSpacedPoints(h),_=!0,d=!1,C=p.computeFrenetFrames(h,!1),E=new D,R=new D,I=new D),d||(m=0,f=0,g=0,x=0);let S=a.extractPoints(c),M=S.shape,L=S.holes;if(!fi.isClockWise(M)){M=M.reverse();for(let A=0,ce=L.length;A<ce;A++){let ne=L[A];fi.isClockWise(ne)&&(L[A]=ne.reverse())}}function z(A){let ne=10000000000000001e-36,se=A[0];for(let B=1;B<=A.length;B++){let ie=B%A.length,K=A[ie],w=K.x-se.x,v=K.y-se.y,P=w*w+v*v,O=Math.max(Math.abs(K.x),Math.abs(K.y),Math.abs(se.x),Math.abs(se.y)),J=ne*O*O;if(P<=J){A.splice(ie,1),B--;continue}se=K}}z(M),L.forEach(z);let k=L.length,G=M;for(let A=0;A<k;A++){let ce=L[A];M=M.concat(ce)}function Z(A,ce,ne){return ce||console.error("THREE.ExtrudeGeometry: vec does not exist"),A.clone().addScaledVector(ce,ne)}let j=M.length;function q(A,ce,ne){let se,B,ie,K=A.x-ce.x,w=A.y-ce.y,v=ne.x-A.x,P=ne.y-A.y,O=K*K+w*w,J=K*P-w*v;if(Math.abs(J)>Number.EPSILON){let V=Math.sqrt(O),fe=Math.sqrt(v*v+P*P),le=ce.x-w/V,Se=ce.y+K/V,be=ne.x-P/fe,Q=ne.y+v/fe,he=((be-le)*P-(Q-Se)*v)/(K*P-w*v);se=le+K*he-A.x,B=Se+w*he-A.y;let Te=se*se+B*B;if(Te<=2)return new te(se,B);ie=Math.sqrt(Te/2)}else{let V=!1;K>Number.EPSILON?v>Number.EPSILON&&(V=!0):K<-Number.EPSILON?v<-Number.EPSILON&&(V=!0):Math.sign(w)===Math.sign(P)&&(V=!0),V?(se=-w,B=K,ie=Math.sqrt(O)):(se=K,B=w,ie=Math.sqrt(O/2))}return new te(se/ie,B/ie)}let oe=[];for(let A=0,ce=G.length,ne=ce-1,se=A+1;A<ce;A++,ne++,se++)ne===ce&&(ne=0),se===ce&&(se=0),oe[A]=q(G[A],G[ne],G[se]);let me=[],Me,Pe=oe.concat();for(let A=0,ce=k;A<ce;A++){let ne=L[A];Me=[];for(let se=0,B=ne.length,ie=B-1,K=se+1;se<B;se++,ie++,K++)ie===B&&(ie=0),K===B&&(K=0),Me[se]=q(ne[se],ne[ie],ne[K]);me.push(Me),Pe=Pe.concat(Me)}let He;if(m===0)He=fi.triangulateShape(G,L);else{let A=[],ce=[];for(let ne=0;ne<m;ne++){let se=ne/m,B=f*Math.cos(se*Math.PI/2),ie=g*Math.sin(se*Math.PI/2)+x;for(let K=0,w=G.length;K<w;K++){let v=Z(G[K],oe[K],ie);Ue(v.x,v.y,-B),se===0&&A.push(v)}for(let K=0,w=k;K<w;K++){let v=L[K];Me=me[K];let P=[];for(let O=0,J=v.length;O<J;O++){let V=Z(v[O],Me[O],ie);Ue(V.x,V.y,-B),se===0&&P.push(V)}se===0&&ce.push(P)}}He=fi.triangulateShape(A,ce)}let $=He.length,ae=g+x;for(let A=0;A<j;A++){let ce=d?Z(M[A],Pe[A],ae):M[A];_?(R.copy(C.normals[0]).multiplyScalar(ce.x),E.copy(C.binormals[0]).multiplyScalar(ce.y),I.copy(y[0]).add(R).add(E),Ue(I.x,I.y,I.z)):Ue(ce.x,ce.y,0)}for(let A=1;A<=h;A++)for(let ce=0;ce<j;ce++){let ne=d?Z(M[ce],Pe[ce],ae):M[ce];_?(R.copy(C.normals[A]).multiplyScalar(ne.x),E.copy(C.binormals[A]).multiplyScalar(ne.y),I.copy(y[A]).add(R).add(E),Ue(I.x,I.y,I.z)):Ue(ne.x,ne.y,u/h*A)}for(let A=m-1;A>=0;A--){let ce=A/m,ne=f*Math.cos(ce*Math.PI/2),se=g*Math.sin(ce*Math.PI/2)+x;for(let B=0,ie=G.length;B<ie;B++){let K=Z(G[B],oe[B],se);Ue(K.x,K.y,u+ne)}for(let B=0,ie=L.length;B<ie;B++){let K=L[B];Me=me[B];for(let w=0,v=K.length;w<v;w++){let P=Z(K[w],Me[w],se);_?Ue(P.x,P.y+y[h-1].y,y[h-1].x+ne):Ue(P.x,P.y,u+ne)}}}xe(),de();function xe(){let A=s.length/3;if(d){let ce=0,ne=j*ce;for(let se=0;se<$;se++){let B=He[se];Re(B[2]+ne,B[1]+ne,B[0]+ne)}ce=h+m*2,ne=j*ce;for(let se=0;se<$;se++){let B=He[se];Re(B[0]+ne,B[1]+ne,B[2]+ne)}}else{for(let ce=0;ce<$;ce++){let ne=He[ce];Re(ne[2],ne[1],ne[0])}for(let ce=0;ce<$;ce++){let ne=He[ce];Re(ne[0]+j*h,ne[1]+j*h,ne[2]+j*h)}}n.addGroup(A,s.length/3-A,0)}function de(){let A=s.length/3,ce=0;Ae(G,ce),ce+=G.length;for(let ne=0,se=L.length;ne<se;ne++){let B=L[ne];Ae(B,ce),ce+=B.length}n.addGroup(A,s.length/3-A,1)}function Ae(A,ce){let ne=A.length;for(;--ne>=0;){let se=ne,B=ne-1;B<0&&(B=A.length-1);for(let ie=0,K=h+m*2;ie<K;ie++){let w=j*ie,v=j*(ie+1),P=ce+se+w,O=ce+B+w,J=ce+B+v,V=ce+se+v;nt(P,O,J,V)}}}function Ue(A,ce,ne){l.push(A),l.push(ce),l.push(ne)}function Re(A,ce,ne){qe(A),qe(ce),qe(ne);let se=s.length/3,B=T.generateTopUV(n,s,se-3,se-2,se-1);Ne(B[0]),Ne(B[1]),Ne(B[2])}function nt(A,ce,ne,se){qe(A),qe(ce),qe(se),qe(ce),qe(ne),qe(se);let B=s.length/3,ie=T.generateSideWallUV(n,s,B-6,B-3,B-2,B-1);Ne(ie[0]),Ne(ie[1]),Ne(ie[3]),Ne(ie[1]),Ne(ie[2]),Ne(ie[3])}function qe(A){s.push(l[A*3+0]),s.push(l[A*3+1]),s.push(l[A*3+2])}function Ne(A){r.push(A.x),r.push(A.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes,n=this.parameters.options;return zd(t,n,e)}static fromJSON(e,t){let n=[];for(let r=0,o=e.shapes.length;r<o;r++){let a=t[e.shapes[r]];n.push(a)}let s=e.options.extrudePath;return s!==void 0&&(e.options.extrudePath=new go[s.type]().fromJSON(s)),new i(n,e.options)}},Bd={generateTopUV:function(i,e,t,n,s){let r=e[t*3],o=e[t*3+1],a=e[n*3],l=e[n*3+1],c=e[s*3],h=e[s*3+1];return[new te(r,o),new te(a,l),new te(c,h)]},generateSideWallUV:function(i,e,t,n,s,r){let o=e[t*3],a=e[t*3+1],l=e[t*3+2],c=e[n*3],h=e[n*3+1],u=e[n*3+2],d=e[s*3],f=e[s*3+1],g=e[s*3+2],x=e[r*3],m=e[r*3+1],p=e[r*3+2];return Math.abs(a-h)<Math.abs(o-c)?[new te(o,1-l),new te(c,1-u),new te(d,1-g),new te(x,1-p)]:[new te(a,1-l),new te(h,1-u),new te(f,1-g),new te(m,1-p)]}};function zd(i,e,t){if(t.shapes=[],Array.isArray(i))for(let n=0,s=i.length;n<s;n++){let r=i[n];t.shapes.push(r.uuid)}else t.shapes.push(i.uuid);return t.options=Object.assign({},e),e.extrudePath!==void 0&&(t.options.extrudePath=e.extrudePath.toJSON()),t}var or=class i extends $s{constructor(e=1,t=0){let n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}},kn=class i extends at{constructor(e=[new te(0,-.5),new te(.5,0),new te(0,.5)],t=12,n=0,s=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:e,segments:t,phiStart:n,phiLength:s},t=Math.floor(t),s=We(s,0,Math.PI*2);let r=[],o=[],a=[],l=[],c=[],h=1/t,u=new D,d=new te,f=new D,g=new D,x=new D,m=0,p=0;for(let T=0;T<=e.length-1;T++)switch(T){case 0:m=e[T+1].x-e[T].x,p=e[T+1].y-e[T].y,f.x=p*1,f.y=-m,f.z=p*0,x.copy(f),f.normalize(),l.push(f.x,f.y,f.z);break;case e.length-1:l.push(x.x,x.y,x.z);break;default:m=e[T+1].x-e[T].x,p=e[T+1].y-e[T].y,f.x=p*1,f.y=-m,f.z=p*0,g.copy(f),f.x+=x.x,f.y+=x.y,f.z+=x.z,f.normalize(),l.push(f.x,f.y,f.z),x.copy(g)}for(let T=0;T<=t;T++){let y=n+T*h*s,_=Math.sin(y),C=Math.cos(y);for(let E=0;E<=e.length-1;E++){u.x=e[E].x*_,u.y=e[E].y,u.z=e[E].x*C,o.push(u.x,u.y,u.z),d.x=T/t,d.y=E/(e.length-1),a.push(d.x,d.y);let R=l[3*E+0]*_,I=l[3*E+1],S=l[3*E+0]*C;c.push(R,I,S)}}for(let T=0;T<t;T++)for(let y=0;y<e.length-1;y++){let _=y+T*e.length,C=_,E=_+e.length,R=_+e.length+1,I=_+1;r.push(C,E,I),r.push(R,I,E)}this.setIndex(r),this.setAttribute("position",new Ve(o,3)),this.setAttribute("uv",new Ve(a,2)),this.setAttribute("normal",new Ve(c,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.points,e.segments,e.phiStart,e.phiLength)}},jn=class i extends $s{constructor(e=1,t=0){let n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],s=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,s,e,t),this.type="OctahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}},Tn=class i extends at{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,h=l+1,u=e/a,d=t/l,f=[],g=[],x=[],m=[];for(let p=0;p<h;p++){let T=p*d-o;for(let y=0;y<c;y++){let _=y*u-r;g.push(_,-T,0),x.push(0,0,1),m.push(y/a),m.push(1-p/l)}}for(let p=0;p<l;p++)for(let T=0;T<a;T++){let y=T+c*p,_=T+c*(p+1),C=T+1+c*(p+1),E=T+1+c*p;f.push(y,_,E),f.push(_,C,E)}this.setIndex(f),this.setAttribute("position",new Ve(g,3)),this.setAttribute("normal",new Ve(x,3)),this.setAttribute("uv",new Ve(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}},ar=class i extends at{constructor(e=.5,t=1,n=32,s=1,r=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:s,thetaStart:r,thetaLength:o},n=Math.max(3,n),s=Math.max(1,s);let a=[],l=[],c=[],h=[],u=e,d=(t-e)/s,f=new D,g=new te;for(let x=0;x<=s;x++){for(let m=0;m<=n;m++){let p=r+m/n*o;f.x=u*Math.cos(p),f.y=u*Math.sin(p),l.push(f.x,f.y,f.z),c.push(0,0,1),g.x=(f.x/t+1)/2,g.y=(f.y/t+1)/2,h.push(g.x,g.y)}u+=d}for(let x=0;x<s;x++){let m=x*(n+1);for(let p=0;p<n;p++){let T=p+m,y=T,_=T+n+1,C=T+n+2,E=T+1;a.push(y,_,E),a.push(_,C,E)}}this.setIndex(a),this.setAttribute("position",new Ve(l,3)),this.setAttribute("normal",new Ve(c,3)),this.setAttribute("uv",new Ve(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}};var Lt=class i extends at{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let l=Math.min(o+a,Math.PI),c=0,h=[],u=new D,d=new D,f=[],g=[],x=[],m=[];for(let p=0;p<=n;p++){let T=[],y=p/n,_=0;p===0&&o===0?_=.5/t:p===n&&l===Math.PI&&(_=-.5/t);for(let C=0;C<=t;C++){let E=C/t;u.x=-e*Math.cos(s+E*r)*Math.sin(o+y*a),u.y=e*Math.cos(o+y*a),u.z=e*Math.sin(s+E*r)*Math.sin(o+y*a),g.push(u.x,u.y,u.z),d.copy(u).normalize(),x.push(d.x,d.y,d.z),m.push(E+_,1-y),T.push(c++)}h.push(T)}for(let p=0;p<n;p++)for(let T=0;T<t;T++){let y=h[p][T+1],_=h[p][T],C=h[p+1][T],E=h[p+1][T+1];(p!==0||o>0)&&f.push(y,_,E),(p!==n-1||l<Math.PI)&&f.push(_,C,E)}this.setIndex(f),this.setAttribute("position",new Ve(g,3)),this.setAttribute("normal",new Ve(x,3)),this.setAttribute("uv",new Ve(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var bi=class i extends at{constructor(e=1,t=.4,n=12,s=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:s,arc:r},n=Math.floor(n),s=Math.floor(s);let o=[],a=[],l=[],c=[],h=new D,u=new D,d=new D;for(let f=0;f<=n;f++)for(let g=0;g<=s;g++){let x=g/s*r,m=f/n*Math.PI*2;u.x=(e+t*Math.cos(m))*Math.cos(x),u.y=(e+t*Math.cos(m))*Math.sin(x),u.z=t*Math.sin(m),a.push(u.x,u.y,u.z),h.x=e*Math.cos(x),h.y=e*Math.sin(x),d.subVectors(u,h).normalize(),l.push(d.x,d.y,d.z),c.push(g/s),c.push(f/n)}for(let f=1;f<=n;f++)for(let g=1;g<=s;g++){let x=(s+1)*f+g-1,m=(s+1)*(f-1)+g-1,p=(s+1)*(f-1)+g,T=(s+1)*f+g;o.push(x,m,T),o.push(m,p,T)}this.setIndex(o),this.setAttribute("position",new Ve(a,3)),this.setAttribute("normal",new Ve(l,3)),this.setAttribute("uv",new Ve(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}};var dn=class i extends at{constructor(e=new yi(new D(-1,-1,0),new D(-1,1,0),new D(1,1,0)),t=64,n=1,s=8,r=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:s,closed:r};let o=e.computeFrenetFrames(t,r);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new D,l=new D,c=new te,h=new D,u=[],d=[],f=[],g=[];x(),this.setIndex(g),this.setAttribute("position",new Ve(u,3)),this.setAttribute("normal",new Ve(d,3)),this.setAttribute("uv",new Ve(f,2));function x(){for(let y=0;y<t;y++)m(y);m(r===!1?t:0),T(),p()}function m(y){h=e.getPointAt(y/t,h);let _=o.normals[y],C=o.binormals[y];for(let E=0;E<=s;E++){let R=E/s*Math.PI*2,I=Math.sin(R),S=-Math.cos(R);l.x=S*_.x+I*C.x,l.y=S*_.y+I*C.y,l.z=S*_.z+I*C.z,l.normalize(),d.push(l.x,l.y,l.z),a.x=h.x+n*l.x,a.y=h.y+n*l.y,a.z=h.z+n*l.z,u.push(a.x,a.y,a.z)}}function p(){for(let y=1;y<=t;y++)for(let _=1;_<=s;_++){let C=(s+1)*(y-1)+(_-1),E=(s+1)*y+(_-1),R=(s+1)*y+_,I=(s+1)*(y-1)+_;g.push(C,E,I),g.push(E,R,I)}}function T(){for(let y=0;y<=t;y++)for(let _=0;_<=s;_++)c.x=y/t,c.y=_/s,f.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new i(new go[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};var lr=class extends Mn{constructor(e){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new Ie(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};var fn=class extends Mn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ie(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ie(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=El,this.normalScale=new te(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new un,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},At=class extends fn{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new te(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return We(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Ie(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Ie(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Ie(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}};var _o=class extends Mn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=dh,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},xo=class extends Mn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function $r(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function kd(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}var Ti=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let o;t:{i:if(!(e<s)){for(let a=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=s,s=t[++n],e<s)break e}o=t.length;break t}if(!(e>=r)){let a=t[1];e<a&&(n=2,r=a);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break e}o=n,n=0;break t}break n}for(;n<o;){let a=n+o>>>1;e<t[a]?o=a:n=a+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let o=0;o!==s;++o)t[o]=n[r+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},vo=class extends Ti{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:il,endingEnd:il}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,o=e+1,a=s[r],l=s[o];if(a===void 0)switch(this.getSettings_().endingStart){case sl:r=e,a=2*t-n;break;case rl:r=s.length-2,a=t+s[r]-s[r+1];break;default:r=e,a=n}if(l===void 0)switch(this.getSettings_().endingEnd){case sl:o=e,l=2*n-t;break;case rl:o=1,l=n+s[1]-s[0];break;default:o=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-a),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=o*h}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,g=(n-t)/(s-t),x=g*g,m=x*g,p=-d*m+2*d*x-d*g,T=(1+d)*m+(-1.5-2*d)*x+(-.5+d)*g+1,y=(-1-f)*m+(1.5+f)*x+.5*g,_=f*m-f*x;for(let C=0;C!==a;++C)r[C]=p*o[h+C]+T*o[c+C]+y*o[l+C]+_*o[u+C];return r}},yo=class extends Ti{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=e*a,c=l-a,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==a;++d)r[d]=o[c+d]*u+o[l+d]*h;return r}},Mo=class extends Ti{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},Jt=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=$r(t,this.TimeBufferType),this.values=$r(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:$r(e.times,Array),values:$r(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Mo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new yo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new vo(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Os:t=this.InterpolantFactoryMethodDiscrete;break;case io:t=this.InterpolantFactoryMethodLinear;break;case Qr:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Os;case this.InterpolantFactoryMethodLinear:return io;case this.InterpolantFactoryMethodSmooth:return Qr}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,o=s-1;for(;r!==s&&n[r]<e;)++r;for(;o!==-1&&n[o]>t;)--o;if(++o,r!==0||o!==s){r>=o&&(o=Math.max(o,1),r=o-1);let a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==r;a++){let l=n[a];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,l),e=!1;break}if(o!==null&&o>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,l,o),e=!1;break}o=l}if(s!==void 0&&kd(s))for(let a=0,l=s.length;a!==l;++a){let c=s[a];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Qr,r=e.length-1,o=1;for(let a=1;a<r;++a){let l=!1,c=e[a],h=e[a+1];if(c!==h&&(a!==1||c!==e[0]))if(s)l=!0;else{let u=a*n,d=u-n,f=u+n;for(let g=0;g!==n;++g){let x=t[u+g];if(x!==t[d+g]||x!==t[f+g]){l=!0;break}}}if(l){if(a!==o){e[o]=e[a];let u=a*n,d=o*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++o}}if(r>0){e[o]=e[r];for(let a=r*n,l=o*n,c=0;c!==n;++c)t[l+c]=t[a+c];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};Jt.prototype.ValueTypeName="";Jt.prototype.TimeBufferType=Float32Array;Jt.prototype.ValueBufferType=Float32Array;Jt.prototype.DefaultInterpolation=io;var ei=class extends Jt{constructor(e,t,n){super(e,t,n)}};ei.prototype.ValueTypeName="bool";ei.prototype.ValueBufferType=Array;ei.prototype.DefaultInterpolation=Os;ei.prototype.InterpolantFactoryMethodLinear=void 0;ei.prototype.InterpolantFactoryMethodSmooth=void 0;var So=class extends Jt{constructor(e,t,n,s){super(e,t,n,s)}};So.prototype.ValueTypeName="color";var bo=class extends Jt{constructor(e,t,n,s){super(e,t,n,s)}};bo.prototype.ValueTypeName="number";var To=class extends Ti{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(n-t)/(s-t),c=e*a;for(let h=c+a;c!==h;c+=4)Bn.slerpFlat(r,0,o,c-a,o,c,l);return r}},cr=class extends Jt{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new To(this.times,this.values,this.getValueSize(),e)}};cr.prototype.ValueTypeName="quaternion";cr.prototype.InterpolantFactoryMethodSmooth=void 0;var ti=class extends Jt{constructor(e,t,n){super(e,t,n)}};ti.prototype.ValueTypeName="string";ti.prototype.ValueBufferType=Array;ti.prototype.DefaultInterpolation=Os;ti.prototype.InterpolantFactoryMethodLinear=void 0;ti.prototype.InterpolantFactoryMethodSmooth=void 0;var wo=class extends Jt{constructor(e,t,n,s){super(e,t,n,s)}};wo.prototype.ValueTypeName="vector";var Eo=class{constructor(e,t,n){let s=this,r=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){a++,r===!1&&s.onStart!==void 0&&s.onStart(h,o,a),r=!0},this.itemEnd=function(h){o++,s.onProgress!==void 0&&s.onProgress(h,o,a),o===a&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){let f=c[u],g=c[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return g}return null}}},Dh=new Eo,Ao=class{constructor(e){this.manager=e!==void 0?e:Dh,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}};Ao.DEFAULT_MATERIAL_NAME="__DEFAULT";var hr=class extends mt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Ie(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}},ur=class extends hr{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(mt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ie(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}},nl=new st,Nc=new D,Fc=new D,hl=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new te(512,512),this.mapType=pn,this.map=null,this.mapPass=null,this.matrix=new st,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new rs,this._frameExtents=new te(1,1),this._viewportCount=1,this._viewports=[new ut(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Nc.setFromMatrixPosition(e.matrixWorld),t.position.copy(Nc),Fc.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Fc),t.updateMatrixWorld(),nl.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(nl),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(nl)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}};var dr=class extends Xs{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},ul=class extends hl{constructor(){super(new dr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},us=class extends hr{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(mt.DEFAULT_UP),this.updateMatrix(),this.target=new mt,this.shadow=new ul}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}};var Co=class extends Pt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Dl="\\[\\]\\.:\\/",Vd=new RegExp("["+Dl+"]","g"),Ul="[^"+Dl+"]",Gd="[^"+Dl.replace("\\.","")+"]",Hd=/((?:WC+[\/:])*)/.source.replace("WC",Ul),Wd=/(WCOD+)?/.source.replace("WCOD",Gd),Xd=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Ul),qd=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Ul),Yd=new RegExp("^"+Hd+Wd+Xd+qd+"$"),Zd=["material","materials","bones","map"],dl=class{constructor(e,t,n){let s=n||ot.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},ot=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Vd,"")}static parseTrackName(e){let t=Yd.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);Zd.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let o=0;o<r.length;o++){let a=r[o];if(a.name===t||a.uuid===t)return a;let l=n(a.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let o=e[s];if(o===void 0){let c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};ot.Composite=dl;ot.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};ot.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};ot.prototype.GetterByBindingType=[ot.prototype._getValue_direct,ot.prototype._getValue_array,ot.prototype._getValue_arrayElement,ot.prototype._getValue_toArray];ot.prototype.SetterByBindingTypeAndVersioning=[[ot.prototype._setValue_direct,ot.prototype._setValue_direct_setNeedsUpdate,ot.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[ot.prototype._setValue_array,ot.prototype._setValue_array_setNeedsUpdate,ot.prototype._setValue_array_setMatrixWorldNeedsUpdate],[ot.prototype._setValue_arrayElement,ot.prototype._setValue_arrayElement_setNeedsUpdate,ot.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[ot.prototype._setValue_fromArray,ot.prototype._setValue_fromArray_setNeedsUpdate,ot.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var G0=new Float32Array(1);function Nl(i,e,t,n){let s=Jd(n);switch(t){case Sl:return i*e;case Wo:return i*e/s.components*s.byteLength;case Xo:return i*e/s.components*s.byteLength;case Tl:return i*e*2/s.components*s.byteLength;case qo:return i*e*2/s.components*s.byteLength;case bl:return i*e*3/s.components*s.byteLength;case en:return i*e*4/s.components*s.byteLength;case Yo:return i*e*4/s.components*s.byteLength;case gr:case _r:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case xr:case vr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Jo:case $o:return Math.max(i,16)*Math.max(e,8)/4;case Zo:case Ko:return Math.max(i,8)*Math.max(e,8)/2;case Qo:case jo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case ea:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case ta:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case na:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case ia:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case sa:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case ra:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case oa:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case aa:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case la:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case ca:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case ha:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case ua:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case da:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case fa:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case pa:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case yr:case ma:case ga:return Math.ceil(i/4)*Math.ceil(e/4)*16;case wl:case _a:return Math.ceil(i/4)*Math.ceil(e/4)*8;case xa:case va:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Jd(i){switch(i){case pn:case vl:return{byteLength:1,components:1};case ds:case yl:case si:return{byteLength:2,components:1};case Go:case Ho:return{byteLength:2,components:4};case ii:case Vo:case mn:return{byteLength:4,components:1};case Ml:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"176"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="176");/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function iu(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function $d(i){let e=new WeakMap;function t(a,l){let c=a.array,h=a.usage,u=c.byteLength,d=i.createBuffer();i.bindBuffer(l,d),i.bufferData(l,c,h),a.onUploadCallback();let f;if(c instanceof Float32Array)f=i.FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?f=i.HALF_FLOAT:f=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=i.SHORT;else if(c instanceof Uint32Array)f=i.UNSIGNED_INT;else if(c instanceof Int32Array)f=i.INT;else if(c instanceof Int8Array)f=i.BYTE;else if(c instanceof Uint8Array)f=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:u}}function n(a,l,c){let h=l.array,u=l.updateRanges;if(i.bindBuffer(c,a),u.length===0)i.bufferSubData(c,0,h);else{u.sort((f,g)=>f.start-g.start);let d=0;for(let f=1;f<u.length;f++){let g=u[d],x=u[f];x.start<=g.start+g.count+1?g.count=Math.max(g.count,x.start+x.count-g.start):(++d,u[d]=x)}u.length=d+1;for(let f=0,g=u.length;f<g;f++){let x=u[f];i.bufferSubData(c,x.start*h.BYTES_PER_ELEMENT,h,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=e.get(a);l&&(i.deleteBuffer(l.buffer),e.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let h=e.get(a);(!h||h.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=e.get(a);if(c===void 0)e.set(a,t(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:s,remove:r,update:o}}var Qd=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,jd=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,ef=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,tf=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,nf=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,sf=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,rf=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,of=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,af=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,lf=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,cf=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,hf=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,uf=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,df=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,ff=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,pf=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,mf=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,gf=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,_f=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,xf=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,vf=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,yf=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Mf=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Sf=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,bf=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Tf=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,wf=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Ef=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Af=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Cf=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Rf="gl_FragColor = linearToOutputTexel( gl_FragColor );",If=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Pf=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Lf=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Df=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Uf=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Nf=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Ff=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Of=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Bf=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,zf=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,kf=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Vf=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Gf=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Hf=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Wf=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Xf=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,qf=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Yf=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Zf=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Jf=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Kf=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,$f=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Qf=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,jf=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,ep=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,tp=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,np=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,ip=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,sp=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,rp=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,op=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,ap=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,lp=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,cp=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,hp=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,up=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,dp=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,fp=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,pp=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,mp=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,gp=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,_p=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,xp=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,vp=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,yp=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Mp=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Sp=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,bp=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Tp=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,wp=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Ep=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Ap=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,Cp=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Rp=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Ip=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Pp=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Lp=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Dp=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Up=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Np=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Fp=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Op=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Bp=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,zp=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,kp=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Vp=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Gp=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Hp=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Wp=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Xp=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,qp=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Yp=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Zp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Jp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Kp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,$p=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,Qp=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,jp=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,em=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,tm=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,nm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,im=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,sm=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,rm=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,om=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,am=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,lm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,cm=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,hm=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,um=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,dm=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,fm=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pm=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,mm=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gm=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,_m=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,xm=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,vm=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,ym=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Mm=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Sm=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,bm=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Tm=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,wm=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Em=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Am=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Cm=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Rm=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Im=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Pm=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Xe={alphahash_fragment:Qd,alphahash_pars_fragment:jd,alphamap_fragment:ef,alphamap_pars_fragment:tf,alphatest_fragment:nf,alphatest_pars_fragment:sf,aomap_fragment:rf,aomap_pars_fragment:of,batching_pars_vertex:af,batching_vertex:lf,begin_vertex:cf,beginnormal_vertex:hf,bsdfs:uf,iridescence_fragment:df,bumpmap_pars_fragment:ff,clipping_planes_fragment:pf,clipping_planes_pars_fragment:mf,clipping_planes_pars_vertex:gf,clipping_planes_vertex:_f,color_fragment:xf,color_pars_fragment:vf,color_pars_vertex:yf,color_vertex:Mf,common:Sf,cube_uv_reflection_fragment:bf,defaultnormal_vertex:Tf,displacementmap_pars_vertex:wf,displacementmap_vertex:Ef,emissivemap_fragment:Af,emissivemap_pars_fragment:Cf,colorspace_fragment:Rf,colorspace_pars_fragment:If,envmap_fragment:Pf,envmap_common_pars_fragment:Lf,envmap_pars_fragment:Df,envmap_pars_vertex:Uf,envmap_physical_pars_fragment:Xf,envmap_vertex:Nf,fog_vertex:Ff,fog_pars_vertex:Of,fog_fragment:Bf,fog_pars_fragment:zf,gradientmap_pars_fragment:kf,lightmap_pars_fragment:Vf,lights_lambert_fragment:Gf,lights_lambert_pars_fragment:Hf,lights_pars_begin:Wf,lights_toon_fragment:qf,lights_toon_pars_fragment:Yf,lights_phong_fragment:Zf,lights_phong_pars_fragment:Jf,lights_physical_fragment:Kf,lights_physical_pars_fragment:$f,lights_fragment_begin:Qf,lights_fragment_maps:jf,lights_fragment_end:ep,logdepthbuf_fragment:tp,logdepthbuf_pars_fragment:np,logdepthbuf_pars_vertex:ip,logdepthbuf_vertex:sp,map_fragment:rp,map_pars_fragment:op,map_particle_fragment:ap,map_particle_pars_fragment:lp,metalnessmap_fragment:cp,metalnessmap_pars_fragment:hp,morphinstance_vertex:up,morphcolor_vertex:dp,morphnormal_vertex:fp,morphtarget_pars_vertex:pp,morphtarget_vertex:mp,normal_fragment_begin:gp,normal_fragment_maps:_p,normal_pars_fragment:xp,normal_pars_vertex:vp,normal_vertex:yp,normalmap_pars_fragment:Mp,clearcoat_normal_fragment_begin:Sp,clearcoat_normal_fragment_maps:bp,clearcoat_pars_fragment:Tp,iridescence_pars_fragment:wp,opaque_fragment:Ep,packing:Ap,premultiplied_alpha_fragment:Cp,project_vertex:Rp,dithering_fragment:Ip,dithering_pars_fragment:Pp,roughnessmap_fragment:Lp,roughnessmap_pars_fragment:Dp,shadowmap_pars_fragment:Up,shadowmap_pars_vertex:Np,shadowmap_vertex:Fp,shadowmask_pars_fragment:Op,skinbase_vertex:Bp,skinning_pars_vertex:zp,skinning_vertex:kp,skinnormal_vertex:Vp,specularmap_fragment:Gp,specularmap_pars_fragment:Hp,tonemapping_fragment:Wp,tonemapping_pars_fragment:Xp,transmission_fragment:qp,transmission_pars_fragment:Yp,uv_pars_fragment:Zp,uv_pars_vertex:Jp,uv_vertex:Kp,worldpos_vertex:$p,background_vert:Qp,background_frag:jp,backgroundCube_vert:em,backgroundCube_frag:tm,cube_vert:nm,cube_frag:im,depth_vert:sm,depth_frag:rm,distanceRGBA_vert:om,distanceRGBA_frag:am,equirect_vert:lm,equirect_frag:cm,linedashed_vert:hm,linedashed_frag:um,meshbasic_vert:dm,meshbasic_frag:fm,meshlambert_vert:pm,meshlambert_frag:mm,meshmatcap_vert:gm,meshmatcap_frag:_m,meshnormal_vert:xm,meshnormal_frag:vm,meshphong_vert:ym,meshphong_frag:Mm,meshphysical_vert:Sm,meshphysical_frag:bm,meshtoon_vert:Tm,meshtoon_frag:wm,points_vert:Em,points_frag:Am,shadow_vert:Cm,shadow_frag:Rm,sprite_vert:Im,sprite_frag:Pm},ge={common:{diffuse:{value:new Ie(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ge}},envmap:{envMap:{value:null},envMapRotation:{value:new Ge},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ge}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ge}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ge},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ge},normalScale:{value:new te(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ge},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ge}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ge}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ge}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ie(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ie(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0},uvTransform:{value:new Ge}},sprite:{diffuse:{value:new Ie(16777215)},opacity:{value:1},center:{value:new te(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}}},En={basic:{uniforms:Dt([ge.common,ge.specularmap,ge.envmap,ge.aomap,ge.lightmap,ge.fog]),vertexShader:Xe.meshbasic_vert,fragmentShader:Xe.meshbasic_frag},lambert:{uniforms:Dt([ge.common,ge.specularmap,ge.envmap,ge.aomap,ge.lightmap,ge.emissivemap,ge.bumpmap,ge.normalmap,ge.displacementmap,ge.fog,ge.lights,{emissive:{value:new Ie(0)}}]),vertexShader:Xe.meshlambert_vert,fragmentShader:Xe.meshlambert_frag},phong:{uniforms:Dt([ge.common,ge.specularmap,ge.envmap,ge.aomap,ge.lightmap,ge.emissivemap,ge.bumpmap,ge.normalmap,ge.displacementmap,ge.fog,ge.lights,{emissive:{value:new Ie(0)},specular:{value:new Ie(1118481)},shininess:{value:30}}]),vertexShader:Xe.meshphong_vert,fragmentShader:Xe.meshphong_frag},standard:{uniforms:Dt([ge.common,ge.envmap,ge.aomap,ge.lightmap,ge.emissivemap,ge.bumpmap,ge.normalmap,ge.displacementmap,ge.roughnessmap,ge.metalnessmap,ge.fog,ge.lights,{emissive:{value:new Ie(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Xe.meshphysical_vert,fragmentShader:Xe.meshphysical_frag},toon:{uniforms:Dt([ge.common,ge.aomap,ge.lightmap,ge.emissivemap,ge.bumpmap,ge.normalmap,ge.displacementmap,ge.gradientmap,ge.fog,ge.lights,{emissive:{value:new Ie(0)}}]),vertexShader:Xe.meshtoon_vert,fragmentShader:Xe.meshtoon_frag},matcap:{uniforms:Dt([ge.common,ge.bumpmap,ge.normalmap,ge.displacementmap,ge.fog,{matcap:{value:null}}]),vertexShader:Xe.meshmatcap_vert,fragmentShader:Xe.meshmatcap_frag},points:{uniforms:Dt([ge.points,ge.fog]),vertexShader:Xe.points_vert,fragmentShader:Xe.points_frag},dashed:{uniforms:Dt([ge.common,ge.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Xe.linedashed_vert,fragmentShader:Xe.linedashed_frag},depth:{uniforms:Dt([ge.common,ge.displacementmap]),vertexShader:Xe.depth_vert,fragmentShader:Xe.depth_frag},normal:{uniforms:Dt([ge.common,ge.bumpmap,ge.normalmap,ge.displacementmap,{opacity:{value:1}}]),vertexShader:Xe.meshnormal_vert,fragmentShader:Xe.meshnormal_frag},sprite:{uniforms:Dt([ge.sprite,ge.fog]),vertexShader:Xe.sprite_vert,fragmentShader:Xe.sprite_frag},background:{uniforms:{uvTransform:{value:new Ge},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Xe.background_vert,fragmentShader:Xe.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ge}},vertexShader:Xe.backgroundCube_vert,fragmentShader:Xe.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Xe.cube_vert,fragmentShader:Xe.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Xe.equirect_vert,fragmentShader:Xe.equirect_frag},distanceRGBA:{uniforms:Dt([ge.common,ge.displacementmap,{referencePosition:{value:new D},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Xe.distanceRGBA_vert,fragmentShader:Xe.distanceRGBA_frag},shadow:{uniforms:Dt([ge.lights,ge.fog,{color:{value:new Ie(0)},opacity:{value:1}}]),vertexShader:Xe.shadow_vert,fragmentShader:Xe.shadow_frag}};En.physical={uniforms:Dt([En.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ge},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ge},clearcoatNormalScale:{value:new te(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ge},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ge},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ge},sheen:{value:0},sheenColor:{value:new Ie(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ge},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ge},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ge},transmissionSamplerSize:{value:new te},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ge},attenuationDistance:{value:0},attenuationColor:{value:new Ie(0)},specularColor:{value:new Ie(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ge},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ge},anisotropyVector:{value:new te},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ge}}]),vertexShader:Xe.meshphysical_vert,fragmentShader:Xe.meshphysical_frag};var ya={r:0,b:0,g:0},Ci=new un,Lm=new st;function Dm(i,e,t,n,s,r,o){let a=new Ie(0),l=r===!0?0:1,c,h,u=null,d=0,f=null;function g(y){let _=y.isScene===!0?y.background:null;return _&&_.isTexture&&(_=(y.backgroundBlurriness>0?t:e).get(_)),_}function x(y){let _=!1,C=g(y);C===null?p(a,l):C&&C.isColor&&(p(C,1),_=!0);let E=i.xr.getEnvironmentBlendMode();E==="additive"?n.buffers.color.setClear(0,0,0,1,o):E==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||_)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function m(y,_){let C=g(_);C&&(C.isCubeTexture||C.mapping===pr)?(h===void 0&&(h=new ft(new Qn(1,1,1),new vt({name:"BackgroundCubeMaterial",uniforms:Ai(En.backgroundCube.uniforms),vertexShader:En.backgroundCube.vertexShader,fragmentShader:En.backgroundCube.fragmentShader,side:Ot,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(E,R,I){this.matrixWorld.copyPosition(I.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),Ci.copy(_.backgroundRotation),Ci.x*=-1,Ci.y*=-1,Ci.z*=-1,C.isCubeTexture&&C.isRenderTargetTexture===!1&&(Ci.y*=-1,Ci.z*=-1),h.material.uniforms.envMap.value=C,h.material.uniforms.flipEnvMap.value=C.isCubeTexture&&C.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=_.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=_.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(Lm.makeRotationFromEuler(Ci)),h.material.toneMapped=Ze.getTransfer(C.colorSpace)!==tt,(u!==C||d!==C.version||f!==i.toneMapping)&&(h.material.needsUpdate=!0,u=C,d=C.version,f=i.toneMapping),h.layers.enableAll(),y.unshift(h,h.geometry,h.material,0,0,null)):C&&C.isTexture&&(c===void 0&&(c=new ft(new Tn(2,2),new vt({name:"BackgroundMaterial",uniforms:Ai(En.background.uniforms),vertexShader:En.background.vertexShader,fragmentShader:En.background.fragmentShader,side:Fn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=C,c.material.uniforms.backgroundIntensity.value=_.backgroundIntensity,c.material.toneMapped=Ze.getTransfer(C.colorSpace)!==tt,C.matrixAutoUpdate===!0&&C.updateMatrix(),c.material.uniforms.uvTransform.value.copy(C.matrix),(u!==C||d!==C.version||f!==i.toneMapping)&&(c.material.needsUpdate=!0,u=C,d=C.version,f=i.toneMapping),c.layers.enableAll(),y.unshift(c,c.geometry,c.material,0,0,null))}function p(y,_){y.getRGB(ya,Pl(i)),n.buffers.color.setClear(ya.r,ya.g,ya.b,_,o)}function T(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return a},setClearColor:function(y,_=1){a.set(y),l=_,p(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(y){l=y,p(a,l)},render:x,addToRenderList:m,dispose:T}}function Um(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,o=!1;function a(M,L,H,z,k){let G=!1,Z=u(z,H,L);r!==Z&&(r=Z,c(r.object)),G=f(M,z,H,k),G&&g(M,z,H,k),k!==null&&e.update(k,i.ELEMENT_ARRAY_BUFFER),(G||o)&&(o=!1,_(M,L,H,z),k!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(k).buffer))}function l(){return i.createVertexArray()}function c(M){return i.bindVertexArray(M)}function h(M){return i.deleteVertexArray(M)}function u(M,L,H){let z=H.wireframe===!0,k=n[M.id];k===void 0&&(k={},n[M.id]=k);let G=k[L.id];G===void 0&&(G={},k[L.id]=G);let Z=G[z];return Z===void 0&&(Z=d(l()),G[z]=Z),Z}function d(M){let L=[],H=[],z=[];for(let k=0;k<t;k++)L[k]=0,H[k]=0,z[k]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:L,enabledAttributes:H,attributeDivisors:z,object:M,attributes:{},index:null}}function f(M,L,H,z){let k=r.attributes,G=L.attributes,Z=0,j=H.getAttributes();for(let q in j)if(j[q].location>=0){let me=k[q],Me=G[q];if(Me===void 0&&(q==="instanceMatrix"&&M.instanceMatrix&&(Me=M.instanceMatrix),q==="instanceColor"&&M.instanceColor&&(Me=M.instanceColor)),me===void 0||me.attribute!==Me||Me&&me.data!==Me.data)return!0;Z++}return r.attributesNum!==Z||r.index!==z}function g(M,L,H,z){let k={},G=L.attributes,Z=0,j=H.getAttributes();for(let q in j)if(j[q].location>=0){let me=G[q];me===void 0&&(q==="instanceMatrix"&&M.instanceMatrix&&(me=M.instanceMatrix),q==="instanceColor"&&M.instanceColor&&(me=M.instanceColor));let Me={};Me.attribute=me,me&&me.data&&(Me.data=me.data),k[q]=Me,Z++}r.attributes=k,r.attributesNum=Z,r.index=z}function x(){let M=r.newAttributes;for(let L=0,H=M.length;L<H;L++)M[L]=0}function m(M){p(M,0)}function p(M,L){let H=r.newAttributes,z=r.enabledAttributes,k=r.attributeDivisors;H[M]=1,z[M]===0&&(i.enableVertexAttribArray(M),z[M]=1),k[M]!==L&&(i.vertexAttribDivisor(M,L),k[M]=L)}function T(){let M=r.newAttributes,L=r.enabledAttributes;for(let H=0,z=L.length;H<z;H++)L[H]!==M[H]&&(i.disableVertexAttribArray(H),L[H]=0)}function y(M,L,H,z,k,G,Z){Z===!0?i.vertexAttribIPointer(M,L,H,k,G):i.vertexAttribPointer(M,L,H,z,k,G)}function _(M,L,H,z){x();let k=z.attributes,G=H.getAttributes(),Z=L.defaultAttributeValues;for(let j in G){let q=G[j];if(q.location>=0){let oe=k[j];if(oe===void 0&&(j==="instanceMatrix"&&M.instanceMatrix&&(oe=M.instanceMatrix),j==="instanceColor"&&M.instanceColor&&(oe=M.instanceColor)),oe!==void 0){let me=oe.normalized,Me=oe.itemSize,Pe=e.get(oe);if(Pe===void 0)continue;let He=Pe.buffer,$=Pe.type,ae=Pe.bytesPerElement,xe=$===i.INT||$===i.UNSIGNED_INT||oe.gpuType===Vo;if(oe.isInterleavedBufferAttribute){let de=oe.data,Ae=de.stride,Ue=oe.offset;if(de.isInstancedInterleavedBuffer){for(let Re=0;Re<q.locationSize;Re++)p(q.location+Re,de.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=de.meshPerAttribute*de.count)}else for(let Re=0;Re<q.locationSize;Re++)m(q.location+Re);i.bindBuffer(i.ARRAY_BUFFER,He);for(let Re=0;Re<q.locationSize;Re++)y(q.location+Re,Me/q.locationSize,$,me,Ae*ae,(Ue+Me/q.locationSize*Re)*ae,xe)}else{if(oe.isInstancedBufferAttribute){for(let de=0;de<q.locationSize;de++)p(q.location+de,oe.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=oe.meshPerAttribute*oe.count)}else for(let de=0;de<q.locationSize;de++)m(q.location+de);i.bindBuffer(i.ARRAY_BUFFER,He);for(let de=0;de<q.locationSize;de++)y(q.location+de,Me/q.locationSize,$,me,Me*ae,Me/q.locationSize*de*ae,xe)}}else if(Z!==void 0){let me=Z[j];if(me!==void 0)switch(me.length){case 2:i.vertexAttrib2fv(q.location,me);break;case 3:i.vertexAttrib3fv(q.location,me);break;case 4:i.vertexAttrib4fv(q.location,me);break;default:i.vertexAttrib1fv(q.location,me)}}}}T()}function C(){I();for(let M in n){let L=n[M];for(let H in L){let z=L[H];for(let k in z)h(z[k].object),delete z[k];delete L[H]}delete n[M]}}function E(M){if(n[M.id]===void 0)return;let L=n[M.id];for(let H in L){let z=L[H];for(let k in z)h(z[k].object),delete z[k];delete L[H]}delete n[M.id]}function R(M){for(let L in n){let H=n[L];if(H[M.id]===void 0)continue;let z=H[M.id];for(let k in z)h(z[k].object),delete z[k];delete H[M.id]}}function I(){S(),o=!0,r!==s&&(r=s,c(r.object))}function S(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:I,resetDefaultState:S,dispose:C,releaseStatesOfGeometry:E,releaseStatesOfProgram:R,initAttributes:x,enableAttribute:m,disableUnusedAttributes:T}}function Nm(i,e,t){let n;function s(c){n=c}function r(c,h){i.drawArrays(n,c,h),t.update(h,n,1)}function o(c,h,u){u!==0&&(i.drawArraysInstanced(n,c,h,u),t.update(h,n,u))}function a(c,h,u){if(u===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,u);let f=0;for(let g=0;g<u;g++)f+=h[g];t.update(f,n,1)}function l(c,h,u,d){if(u===0)return;let f=e.get("WEBGL_multi_draw");if(f===null)for(let g=0;g<c.length;g++)o(c[g],h[g],d[g]);else{f.multiDrawArraysInstancedWEBGL(n,c,0,h,0,d,0,u);let g=0;for(let x=0;x<u;x++)g+=h[x]*d[x];t.update(g,n,1)}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function Fm(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let R=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(R){return!(R!==en&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(R){let I=R===si&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(R!==pn&&n.convert(R)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==mn&&!I)}function l(R){if(R==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let u=t.logarithmicDepthBuffer===!0,d=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),T=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),y=i.getParameter(i.MAX_VARYING_VECTORS),_=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),C=g>0,E=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:u,reverseDepthBuffer:d,maxTextures:f,maxVertexTextures:g,maxTextureSize:x,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:T,maxVaryings:y,maxFragmentUniforms:_,vertexTextures:C,maxSamples:E}}function Om(i){let e=this,t=null,n=0,s=!1,r=!1,o=new gn,a=new Ge,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||s;return s=d,n=u.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let g=u.clippingPlanes,x=u.clipIntersection,m=u.clipShadows,p=i.get(u);if(!s||g===null||g.length===0||r&&!m)r?h(null):c();else{let T=r?0:n,y=T*4,_=p.clippingState||null;l.value=_,_=h(g,d,y,f);for(let C=0;C!==y;++C)_[C]=t[C];p.clippingState=_,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=T}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,g){let x=u!==null?u.length:0,m=null;if(x!==0){if(m=l.value,g!==!0||m===null){let p=f+x*4,T=d.matrixWorldInverse;a.getNormalMatrix(T),(m===null||m.length<p)&&(m=new Float32Array(p));for(let y=0,_=f;y!==x;++y,_+=4)o.copy(u[y]).applyMatrix4(T,a),o.normal.toArray(m,_),m[_+3]=o.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=x,e.numIntersection=0,m}}function Bm(i){let e=new WeakMap;function t(o,a){return a===Bo?o.mapping=wi:a===zo&&(o.mapping=Ei),o}function n(o){if(o&&o.isTexture){let a=o.mapping;if(a===Bo||a===zo)if(e.has(o)){let l=e.get(o).texture;return t(l,o.mapping)}else{let l=o.image;if(l&&l.height>0){let c=new ho(l.height);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){let a=o.target;a.removeEventListener("dispose",s);let l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}var gs=4,Uh=[.125,.215,.35,.446,.526,.582],Pi=20,Fl=new dr,Nh=new Ie,Ol=null,Bl=0,zl=0,kl=!1,Ii=(1+Math.sqrt(5))/2,ms=1/Ii,Fh=[new D(-Ii,ms,0),new D(Ii,ms,0),new D(-ms,0,Ii),new D(ms,0,Ii),new D(0,Ii,-ms),new D(0,Ii,ms),new D(-1,1,-1),new D(1,1,-1),new D(-1,1,1),new D(1,1,1)],zm=new D,xs=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100,r={}){let{size:o=256,position:a=zm}=r;Ol=this._renderer.getRenderTarget(),Bl=this._renderer.getActiveCubeFace(),zl=this._renderer.getActiveMipmapLevel(),kl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,n,s,l,a),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=zh(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Bh(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Ol,Bl,zl),this._renderer.xr.enabled=kl,e.scissorTest=!1,Ma(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===wi||e.mapping===Ei?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Ol=this._renderer.getRenderTarget(),Bl=this._renderer.getActiveCubeFace(),zl=this._renderer.getActiveMipmapLevel(),kl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:hn,minFilter:hn,generateMipmaps:!1,type:si,format:en,colorSpace:gi,depthBuffer:!1},s=Oh(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Oh(e,t,n);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=km(r)),this._blurMaterial=Vm(r,e,t)}return s}_compileMaterial(e){let t=new ft(this._lodPlanes[0],e);this._renderer.compile(t,Fl)}_sceneToCubeUV(e,t,n,s,r){let l=new Pt(90,1,t,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,f=u.toneMapping;u.getClearColor(Nh),u.toneMapping=Gn,u.autoClear=!1;let g=new zn({name:"PMREM.Background",side:Ot,depthWrite:!1,depthTest:!1}),x=new ft(new Qn,g),m=!1,p=e.background;p?p.isColor&&(g.color.copy(p),e.background=null,m=!0):(g.color.copy(Nh),m=!0);for(let T=0;T<6;T++){let y=T%3;y===0?(l.up.set(0,c[T],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+h[T],r.y,r.z)):y===1?(l.up.set(0,0,c[T]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+h[T],r.z)):(l.up.set(0,c[T],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+h[T]));let _=this._cubeSize;Ma(s,y*_,T>2?_:0,_,_),u.setRenderTarget(s),m&&u.render(x,l),u.render(e,l)}x.geometry.dispose(),x.material.dispose(),u.toneMapping=f,u.autoClear=d,e.background=p}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===wi||e.mapping===Ei;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=zh()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Bh());let r=s?this._cubemapMaterial:this._equirectMaterial,o=new ft(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;let l=this._cubeSize;Ma(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,Fl)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let s=this._lodPlanes.length;for(let r=1;r<s;r++){let o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=Fh[(s-r-1)%Fh.length];this._blur(e,r-1,r,o,a)}t.autoClear=n}_blur(e,t,n,s,r){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){let l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let h=3,u=new ft(this._lodPlanes[s],c),d=c.uniforms,f=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*Pi-1),x=r/g,m=isFinite(r)?1+Math.floor(h*x):Pi;m>Pi&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Pi}`);let p=[],T=0;for(let R=0;R<Pi;++R){let I=R/x,S=Math.exp(-I*I/2);p.push(S),R===0?T+=S:R<m&&(T+=2*S)}for(let R=0;R<p.length;R++)p[R]=p[R]/T;d.envMap.value=e.texture,d.samples.value=m,d.weights.value=p,d.latitudinal.value=o==="latitudinal",a&&(d.poleAxis.value=a);let{_lodMax:y}=this;d.dTheta.value=g,d.mipInt.value=y-n;let _=this._sizeLods[s],C=3*_*(s>y-gs?s-y+gs:0),E=4*(this._cubeSize-_);Ma(t,C,E,3*_,2*_),l.setRenderTarget(t),l.render(u,Fl)}};function km(i){let e=[],t=[],n=[],s=i,r=i-gs+1+Uh.length;for(let o=0;o<r;o++){let a=Math.pow(2,s);t.push(a);let l=1/a;o>i-gs?l=Uh[o-i+gs-1]:o===0&&(l=0),n.push(l);let c=1/(a-2),h=-c,u=1+c,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,g=6,x=3,m=2,p=1,T=new Float32Array(x*g*f),y=new Float32Array(m*g*f),_=new Float32Array(p*g*f);for(let E=0;E<f;E++){let R=E%3*2/3-1,I=E>2?0:-1,S=[R,I,0,R+2/3,I,0,R+2/3,I+1,0,R,I,0,R+2/3,I+1,0,R,I+1,0];T.set(S,x*g*E),y.set(d,m*g*E);let M=[E,E,E,E,E,E];_.set(M,p*g*E)}let C=new at;C.setAttribute("position",new Ft(T,x)),C.setAttribute("uv",new Ft(y,m)),C.setAttribute("faceIndex",new Ft(_,p)),e.push(C),s>gs&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Oh(i,e,t){let n=new jt(i,e,t);return n.texture.mapping=pr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Ma(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Vm(i,e,t){let n=new Float32Array(Pi),s=new D(0,1,0);return new vt({name:"SphericalGaussianBlur",defines:{n:Pi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:Kl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Vn,depthTest:!1,depthWrite:!1})}function Bh(){return new vt({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Kl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Vn,depthTest:!1,depthWrite:!1})}function zh(){return new vt({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Kl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Vn,depthTest:!1,depthWrite:!1})}function Kl(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Gm(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){let l=a.mapping,c=l===Bo||l===zo,h=l===wi||l===Ei;if(c||h){let u=e.get(a),d=u!==void 0?u.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==d)return t===null&&(t=new xs(i)),u=c?t.fromEquirectangular(a,u):t.fromCubemap(a,u),u.texture.pmremVersion=a.pmremVersion,e.set(a,u),u.texture;if(u!==void 0)return u.texture;{let f=a.image;return c&&f&&f.height>0||h&&f&&s(f)?(t===null&&(t=new xs(i)),u=c?t.fromEquirectangular(a):t.fromCubemap(a),u.texture.pmremVersion=a.pmremVersion,e.set(a,u),a.addEventListener("dispose",r),u.texture):null}}}return a}function s(a){let l=0,c=6;for(let h=0;h<c;h++)a[h]!==void 0&&l++;return l===c}function r(a){let l=a.target;l.removeEventListener("dispose",r);let c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Hm(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&Mr("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Wm(i,e,t,n){let s={},r=new WeakMap;function o(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let g in d.attributes)e.remove(d.attributes[g]);d.removeEventListener("dispose",o),delete s[d.id];let f=r.get(d);f&&(e.remove(f),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function a(u,d){return s[d.id]===!0||(d.addEventListener("dispose",o),s[d.id]=!0,t.memory.geometries++),d}function l(u){let d=u.attributes;for(let f in d)e.update(d[f],i.ARRAY_BUFFER)}function c(u){let d=[],f=u.index,g=u.attributes.position,x=0;if(f!==null){let T=f.array;x=f.version;for(let y=0,_=T.length;y<_;y+=3){let C=T[y+0],E=T[y+1],R=T[y+2];d.push(C,E,E,R,R,C)}}else if(g!==void 0){let T=g.array;x=g.version;for(let y=0,_=T.length/3-1;y<_;y+=3){let C=y+0,E=y+1,R=y+2;d.push(C,E,E,R,R,C)}}else return;let m=new(Il(d)?Ws:Hs)(d,1);m.version=x;let p=r.get(u);p&&e.remove(p),r.set(u,m)}function h(u){let d=r.get(u);if(d){let f=u.index;f!==null&&d.version<f.version&&c(u)}else c(u);return r.get(u)}return{get:a,update:l,getWireframeAttribute:h}}function Xm(i,e,t){let n;function s(d){n=d}let r,o;function a(d){r=d.type,o=d.bytesPerElement}function l(d,f){i.drawElements(n,f,r,d*o),t.update(f,n,1)}function c(d,f,g){g!==0&&(i.drawElementsInstanced(n,f,r,d*o,g),t.update(f,n,g))}function h(d,f,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,f,0,r,d,0,g);let m=0;for(let p=0;p<g;p++)m+=f[p];t.update(m,n,1)}function u(d,f,g,x){if(g===0)return;let m=e.get("WEBGL_multi_draw");if(m===null)for(let p=0;p<d.length;p++)c(d[p]/o,f[p],x[p]);else{m.multiDrawElementsInstancedWEBGL(n,f,0,r,d,0,x,0,g);let p=0;for(let T=0;T<g;T++)p+=f[T]*x[T];t.update(p,n,1)}}this.setMode=s,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=u}function qm(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Ym(i,e,t){let n=new WeakMap,s=new ut;function r(o,a,l){let c=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(a);if(d===void 0||d.count!==u){let S=function(){R.dispose(),n.delete(a),a.removeEventListener("dispose",S)};d!==void 0&&d.texture.dispose();let f=a.morphAttributes.position!==void 0,g=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],p=a.morphAttributes.normal||[],T=a.morphAttributes.color||[],y=0;f===!0&&(y=1),g===!0&&(y=2),x===!0&&(y=3);let _=a.attributes.position.count*y,C=1;_>e.maxTextureSize&&(C=Math.ceil(_/e.maxTextureSize),_=e.maxTextureSize);let E=new Float32Array(_*C*4*u),R=new Vs(E,_,C,u);R.type=mn,R.needsUpdate=!0;let I=y*4;for(let M=0;M<u;M++){let L=m[M],H=p[M],z=T[M],k=_*C*4*M;for(let G=0;G<L.count;G++){let Z=G*I;f===!0&&(s.fromBufferAttribute(L,G),E[k+Z+0]=s.x,E[k+Z+1]=s.y,E[k+Z+2]=s.z,E[k+Z+3]=0),g===!0&&(s.fromBufferAttribute(H,G),E[k+Z+4]=s.x,E[k+Z+5]=s.y,E[k+Z+6]=s.z,E[k+Z+7]=0),x===!0&&(s.fromBufferAttribute(z,G),E[k+Z+8]=s.x,E[k+Z+9]=s.y,E[k+Z+10]=s.z,E[k+Z+11]=z.itemSize===4?s.w:1)}}d={count:u,texture:R,size:new te(_,C)},n.set(a,d),a.addEventListener("dispose",S)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",o.morphTexture,t);else{let f=0;for(let x=0;x<c.length;x++)f+=c[x];let g=a.morphTargetsRelative?1:1-f;l.getUniforms().setValue(i,"morphTargetBaseInfluence",g),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function Zm(i,e,t,n){let s=new WeakMap;function r(l){let c=n.render.frame,h=l.geometry,u=e.get(l,h);if(s.get(u)!==c&&(e.update(u),s.set(u,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){let d=l.skeleton;s.get(d)!==c&&(d.update(),s.set(d,c))}return u}function o(){s=new WeakMap}function a(l){let c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}var su=new Et,kh=new Ks(1,1),ru=new Vs,ou=new ao,au=new qs,Vh=[],Gh=[],Hh=new Float32Array(16),Wh=new Float32Array(9),Xh=new Float32Array(4);function vs(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Vh[s];if(r===void 0&&(r=new Float32Array(s),Vh[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function yt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Mt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Ta(i,e){let t=Gh[e];t===void 0&&(t=new Int32Array(e),Gh[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Jm(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Km(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;i.uniform2fv(this.addr,e),Mt(t,e)}}function $m(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(yt(t,e))return;i.uniform3fv(this.addr,e),Mt(t,e)}}function Qm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;i.uniform4fv(this.addr,e),Mt(t,e)}}function jm(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Mt(t,e)}else{if(yt(t,n))return;Xh.set(n),i.uniformMatrix2fv(this.addr,!1,Xh),Mt(t,n)}}function eg(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Mt(t,e)}else{if(yt(t,n))return;Wh.set(n),i.uniformMatrix3fv(this.addr,!1,Wh),Mt(t,n)}}function tg(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(yt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Mt(t,e)}else{if(yt(t,n))return;Hh.set(n),i.uniformMatrix4fv(this.addr,!1,Hh),Mt(t,n)}}function ng(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function ig(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;i.uniform2iv(this.addr,e),Mt(t,e)}}function sg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(yt(t,e))return;i.uniform3iv(this.addr,e),Mt(t,e)}}function rg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;i.uniform4iv(this.addr,e),Mt(t,e)}}function og(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function ag(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(yt(t,e))return;i.uniform2uiv(this.addr,e),Mt(t,e)}}function lg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(yt(t,e))return;i.uniform3uiv(this.addr,e),Mt(t,e)}}function cg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(yt(t,e))return;i.uniform4uiv(this.addr,e),Mt(t,e)}}function hg(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(kh.compareFunction=Al,r=kh):r=su,t.setTexture2D(e||r,s)}function ug(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||ou,s)}function dg(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||au,s)}function fg(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||ru,s)}function pg(i){switch(i){case 5126:return Jm;case 35664:return Km;case 35665:return $m;case 35666:return Qm;case 35674:return jm;case 35675:return eg;case 35676:return tg;case 5124:case 35670:return ng;case 35667:case 35671:return ig;case 35668:case 35672:return sg;case 35669:case 35673:return rg;case 5125:return og;case 36294:return ag;case 36295:return lg;case 36296:return cg;case 35678:case 36198:case 36298:case 36306:case 35682:return hg;case 35679:case 36299:case 36307:return ug;case 35680:case 36300:case 36308:case 36293:return dg;case 36289:case 36303:case 36311:case 36292:return fg}}function mg(i,e){i.uniform1fv(this.addr,e)}function gg(i,e){let t=vs(e,this.size,2);i.uniform2fv(this.addr,t)}function _g(i,e){let t=vs(e,this.size,3);i.uniform3fv(this.addr,t)}function xg(i,e){let t=vs(e,this.size,4);i.uniform4fv(this.addr,t)}function vg(i,e){let t=vs(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function yg(i,e){let t=vs(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Mg(i,e){let t=vs(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Sg(i,e){i.uniform1iv(this.addr,e)}function bg(i,e){i.uniform2iv(this.addr,e)}function Tg(i,e){i.uniform3iv(this.addr,e)}function wg(i,e){i.uniform4iv(this.addr,e)}function Eg(i,e){i.uniform1uiv(this.addr,e)}function Ag(i,e){i.uniform2uiv(this.addr,e)}function Cg(i,e){i.uniform3uiv(this.addr,e)}function Rg(i,e){i.uniform4uiv(this.addr,e)}function Ig(i,e,t){let n=this.cache,s=e.length,r=Ta(t,s);yt(n,r)||(i.uniform1iv(this.addr,r),Mt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||su,r[o])}function Pg(i,e,t){let n=this.cache,s=e.length,r=Ta(t,s);yt(n,r)||(i.uniform1iv(this.addr,r),Mt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||ou,r[o])}function Lg(i,e,t){let n=this.cache,s=e.length,r=Ta(t,s);yt(n,r)||(i.uniform1iv(this.addr,r),Mt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||au,r[o])}function Dg(i,e,t){let n=this.cache,s=e.length,r=Ta(t,s);yt(n,r)||(i.uniform1iv(this.addr,r),Mt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||ru,r[o])}function Ug(i){switch(i){case 5126:return mg;case 35664:return gg;case 35665:return _g;case 35666:return xg;case 35674:return vg;case 35675:return yg;case 35676:return Mg;case 5124:case 35670:return Sg;case 35667:case 35671:return bg;case 35668:case 35672:return Tg;case 35669:case 35673:return wg;case 5125:return Eg;case 36294:return Ag;case 36295:return Cg;case 36296:return Rg;case 35678:case 36198:case 36298:case 36306:case 35682:return Ig;case 35679:case 36299:case 36307:return Pg;case 35680:case 36300:case 36308:case 36293:return Lg;case 36289:case 36303:case 36311:case 36292:return Dg}}var Gl=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=pg(t.type)}},Hl=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Ug(t.type)}},Wl=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,o=s.length;r!==o;++r){let a=s[r];a.setValue(e,t[a.id],n)}}},Vl=/(\w+)(\])?(\[|\.)?/g;function qh(i,e){i.seq.push(e),i.map[e.id]=e}function Ng(i,e,t){let n=i.name,s=n.length;for(Vl.lastIndex=0;;){let r=Vl.exec(n),o=Vl.lastIndex,a=r[1],l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){qh(t,c===void 0?new Gl(a,i,e):new Hl(a,i,e));break}else{let u=t.map[a];u===void 0&&(u=new Wl(a),qh(t,u)),t=u}}}var _s=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){let r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);Ng(r,o,this)}}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){let a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let o=e[s];o.id in t&&n.push(o)}return n}};function Yh(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var Fg=37297,Og=0;function Bg(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){let a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}var Zh=new Ge;function zg(i){Ze._getMatrix(Zh,Ze.workingColorSpace,i);let e=`mat3( ${Zh.elements.map(t=>t.toFixed(4))} )`;switch(Ze.getTransfer(i)){case Bs:return[e,"LinearTransferOETF"];case tt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function Jh(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";let r=/ERROR: 0:(\d+)/.exec(s);if(r){let o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+Bg(i.getShaderSource(e),o)}else return s}function kg(i,e){let t=zg(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function Vg(i,e){let t;switch(e){case rh:t="Linear";break;case oh:t="Reinhard";break;case ah:t="Cineon";break;case Oo:t="ACESFilmic";break;case ch:t="AgX";break;case hh:t="Neutral";break;case lh:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var Sa=new D;function Gg(){Ze.getLuminanceCoefficients(Sa);let i=Sa.x.toFixed(4),e=Sa.y.toFixed(4),t=Sa.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Hg(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Sr).join(`
`)}function Wg(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Xg(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),o=r.name,a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function Sr(i){return i!==""}function Kh(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function $h(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var qg=/^[ \t]*#include +<([\w\d./]+)>/gm;function Xl(i){return i.replace(qg,Zg)}var Yg=new Map;function Zg(i,e){let t=Xe[e];if(t===void 0){let n=Yg.get(e);if(n!==void 0)t=Xe[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Xl(t)}var Jg=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Qh(i){return i.replace(Jg,Kg)}function Kg(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function jh(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function $g(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===pl?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Ro?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===wn&&(e="SHADOWMAP_TYPE_VSM"),e}function Qg(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case wi:case Ei:e="ENVMAP_TYPE_CUBE";break;case pr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function jg(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ei:e="ENVMAP_MODE_REFRACTION";break}return e}function e0(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case _l:e="ENVMAP_BLENDING_MULTIPLY";break;case ih:e="ENVMAP_BLENDING_MIX";break;case sh:e="ENVMAP_BLENDING_ADD";break}return e}function t0(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function n0(i,e,t,n){let s=i.getContext(),r=t.defines,o=t.vertexShader,a=t.fragmentShader,l=$g(t),c=Qg(t),h=jg(t),u=e0(t),d=t0(t),f=Hg(t),g=Wg(r),x=s.createProgram(),m,p,T=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Sr).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Sr).join(`
`),p.length>0&&(p+=`
`)):(m=[jh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Sr).join(`
`),p=[jh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Gn?"#define TONE_MAPPING":"",t.toneMapping!==Gn?Xe.tonemapping_pars_fragment:"",t.toneMapping!==Gn?Vg("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Xe.colorspace_pars_fragment,kg("linearToOutputTexel",t.outputColorSpace),Gg(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Sr).join(`
`)),o=Xl(o),o=Kh(o,t),o=$h(o,t),a=Xl(a),a=Kh(a,t),a=$h(a,t),o=Qh(o),a=Qh(a),t.isRawShaderMaterial!==!0&&(T=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",t.glslVersion===Cl?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Cl?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let y=T+m+o,_=T+p+a,C=Yh(s,s.VERTEX_SHADER,y),E=Yh(s,s.FRAGMENT_SHADER,_);s.attachShader(x,C),s.attachShader(x,E),t.index0AttributeName!==void 0?s.bindAttribLocation(x,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(x,0,"position"),s.linkProgram(x);function R(L){if(i.debug.checkShaderErrors){let H=s.getProgramInfoLog(x).trim(),z=s.getShaderInfoLog(C).trim(),k=s.getShaderInfoLog(E).trim(),G=!0,Z=!0;if(s.getProgramParameter(x,s.LINK_STATUS)===!1)if(G=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,x,C,E);else{let j=Jh(s,C,"vertex"),q=Jh(s,E,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(x,s.VALIDATE_STATUS)+`

Material Name: `+L.name+`
Material Type: `+L.type+`

Program Info Log: `+H+`
`+j+`
`+q)}else H!==""?console.warn("THREE.WebGLProgram: Program Info Log:",H):(z===""||k==="")&&(Z=!1);Z&&(L.diagnostics={runnable:G,programLog:H,vertexShader:{log:z,prefix:m},fragmentShader:{log:k,prefix:p}})}s.deleteShader(C),s.deleteShader(E),I=new _s(s,x),S=Xg(s,x)}let I;this.getUniforms=function(){return I===void 0&&R(this),I};let S;this.getAttributes=function(){return S===void 0&&R(this),S};let M=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=s.getProgramParameter(x,Fg)),M},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(x),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Og++,this.cacheKey=e,this.usedTimes=1,this.program=x,this.vertexShader=C,this.fragmentShader=E,this}var i0=0,ql=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Yl(e),t.set(e,n)),n}},Yl=class{constructor(e){this.id=i0++,this.code=e,this.usedTimes=0}};function s0(i,e,t,n,s,r,o){let a=new Gs,l=new ql,c=new Set,h=[],u=s.logarithmicDepthBuffer,d=s.vertexTextures,f=s.precision,g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(S){return c.add(S),S===0?"uv":`uv${S}`}function m(S,M,L,H,z){let k=H.fog,G=z.geometry,Z=S.isMeshStandardMaterial?H.environment:null,j=(S.isMeshStandardMaterial?t:e).get(S.envMap||Z),q=j&&j.mapping===pr?j.image.height:null,oe=g[S.type];S.precision!==null&&(f=s.getMaxPrecision(S.precision),f!==S.precision&&console.warn("THREE.WebGLProgram.getParameters:",S.precision,"not supported, using",f,"instead."));let me=G.morphAttributes.position||G.morphAttributes.normal||G.morphAttributes.color,Me=me!==void 0?me.length:0,Pe=0;G.morphAttributes.position!==void 0&&(Pe=1),G.morphAttributes.normal!==void 0&&(Pe=2),G.morphAttributes.color!==void 0&&(Pe=3);let He,$,ae,xe;if(oe){let je=En[oe];He=je.vertexShader,$=je.fragmentShader}else He=S.vertexShader,$=S.fragmentShader,l.update(S),ae=l.getVertexShaderID(S),xe=l.getFragmentShaderID(S);let de=i.getRenderTarget(),Ae=i.state.buffers.depth.getReversed(),Ue=z.isInstancedMesh===!0,Re=z.isBatchedMesh===!0,nt=!!S.map,qe=!!S.matcap,Ne=!!j,A=!!S.aoMap,ce=!!S.lightMap,ne=!!S.bumpMap,se=!!S.normalMap,B=!!S.displacementMap,ie=!!S.emissiveMap,K=!!S.metalnessMap,w=!!S.roughnessMap,v=S.anisotropy>0,P=S.clearcoat>0,O=S.dispersion>0,J=S.iridescence>0,V=S.sheen>0,fe=S.transmission>0,le=v&&!!S.anisotropyMap,Se=P&&!!S.clearcoatMap,be=P&&!!S.clearcoatNormalMap,Q=P&&!!S.clearcoatRoughnessMap,he=J&&!!S.iridescenceMap,Te=J&&!!S.iridescenceThicknessMap,Ce=V&&!!S.sheenColorMap,ve=V&&!!S.sheenRoughnessMap,ze=!!S.specularMap,ke=!!S.specularColorMap,Ke=!!S.specularIntensityMap,U=fe&&!!S.transmissionMap,ue=fe&&!!S.thicknessMap,Y=!!S.gradientMap,ee=!!S.alphaMap,_e=S.alphaTest>0,pe=!!S.alphaHash,Oe=!!S.extensions,lt=Gn;S.toneMapped&&(de===null||de.isXRRenderTarget===!0)&&(lt=i.toneMapping);let Ct={shaderID:oe,shaderType:S.type,shaderName:S.name,vertexShader:He,fragmentShader:$,defines:S.defines,customVertexShaderID:ae,customFragmentShaderID:xe,isRawShaderMaterial:S.isRawShaderMaterial===!0,glslVersion:S.glslVersion,precision:f,batching:Re,batchingColor:Re&&z._colorsTexture!==null,instancing:Ue,instancingColor:Ue&&z.instanceColor!==null,instancingMorph:Ue&&z.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:de===null?i.outputColorSpace:de.isXRRenderTarget===!0?de.texture.colorSpace:gi,alphaToCoverage:!!S.alphaToCoverage,map:nt,matcap:qe,envMap:Ne,envMapMode:Ne&&j.mapping,envMapCubeUVHeight:q,aoMap:A,lightMap:ce,bumpMap:ne,normalMap:se,displacementMap:d&&B,emissiveMap:ie,normalMapObjectSpace:se&&S.normalMapType===ph,normalMapTangentSpace:se&&S.normalMapType===El,metalnessMap:K,roughnessMap:w,anisotropy:v,anisotropyMap:le,clearcoat:P,clearcoatMap:Se,clearcoatNormalMap:be,clearcoatRoughnessMap:Q,dispersion:O,iridescence:J,iridescenceMap:he,iridescenceThicknessMap:Te,sheen:V,sheenColorMap:Ce,sheenRoughnessMap:ve,specularMap:ze,specularColorMap:ke,specularIntensityMap:Ke,transmission:fe,transmissionMap:U,thicknessMap:ue,gradientMap:Y,opaque:S.transparent===!1&&S.blending===pi&&S.alphaToCoverage===!1,alphaMap:ee,alphaTest:_e,alphaHash:pe,combine:S.combine,mapUv:nt&&x(S.map.channel),aoMapUv:A&&x(S.aoMap.channel),lightMapUv:ce&&x(S.lightMap.channel),bumpMapUv:ne&&x(S.bumpMap.channel),normalMapUv:se&&x(S.normalMap.channel),displacementMapUv:B&&x(S.displacementMap.channel),emissiveMapUv:ie&&x(S.emissiveMap.channel),metalnessMapUv:K&&x(S.metalnessMap.channel),roughnessMapUv:w&&x(S.roughnessMap.channel),anisotropyMapUv:le&&x(S.anisotropyMap.channel),clearcoatMapUv:Se&&x(S.clearcoatMap.channel),clearcoatNormalMapUv:be&&x(S.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Q&&x(S.clearcoatRoughnessMap.channel),iridescenceMapUv:he&&x(S.iridescenceMap.channel),iridescenceThicknessMapUv:Te&&x(S.iridescenceThicknessMap.channel),sheenColorMapUv:Ce&&x(S.sheenColorMap.channel),sheenRoughnessMapUv:ve&&x(S.sheenRoughnessMap.channel),specularMapUv:ze&&x(S.specularMap.channel),specularColorMapUv:ke&&x(S.specularColorMap.channel),specularIntensityMapUv:Ke&&x(S.specularIntensityMap.channel),transmissionMapUv:U&&x(S.transmissionMap.channel),thicknessMapUv:ue&&x(S.thicknessMap.channel),alphaMapUv:ee&&x(S.alphaMap.channel),vertexTangents:!!G.attributes.tangent&&(se||v),vertexColors:S.vertexColors,vertexAlphas:S.vertexColors===!0&&!!G.attributes.color&&G.attributes.color.itemSize===4,pointsUvs:z.isPoints===!0&&!!G.attributes.uv&&(nt||ee),fog:!!k,useFog:S.fog===!0,fogExp2:!!k&&k.isFogExp2,flatShading:S.flatShading===!0,sizeAttenuation:S.sizeAttenuation===!0,logarithmicDepthBuffer:u,reverseDepthBuffer:Ae,skinning:z.isSkinnedMesh===!0,morphTargets:G.morphAttributes.position!==void 0,morphNormals:G.morphAttributes.normal!==void 0,morphColors:G.morphAttributes.color!==void 0,morphTargetsCount:Me,morphTextureStride:Pe,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:S.dithering,shadowMapEnabled:i.shadowMap.enabled&&L.length>0,shadowMapType:i.shadowMap.type,toneMapping:lt,decodeVideoTexture:nt&&S.map.isVideoTexture===!0&&Ze.getTransfer(S.map.colorSpace)===tt,decodeVideoTextureEmissive:ie&&S.emissiveMap.isVideoTexture===!0&&Ze.getTransfer(S.emissiveMap.colorSpace)===tt,premultipliedAlpha:S.premultipliedAlpha,doubleSided:S.side===pt,flipSided:S.side===Ot,useDepthPacking:S.depthPacking>=0,depthPacking:S.depthPacking||0,index0AttributeName:S.index0AttributeName,extensionClipCullDistance:Oe&&S.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Oe&&S.extensions.multiDraw===!0||Re)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:S.customProgramCacheKey()};return Ct.vertexUv1s=c.has(1),Ct.vertexUv2s=c.has(2),Ct.vertexUv3s=c.has(3),c.clear(),Ct}function p(S){let M=[];if(S.shaderID?M.push(S.shaderID):(M.push(S.customVertexShaderID),M.push(S.customFragmentShaderID)),S.defines!==void 0)for(let L in S.defines)M.push(L),M.push(S.defines[L]);return S.isRawShaderMaterial===!1&&(T(M,S),y(M,S),M.push(i.outputColorSpace)),M.push(S.customProgramCacheKey),M.join()}function T(S,M){S.push(M.precision),S.push(M.outputColorSpace),S.push(M.envMapMode),S.push(M.envMapCubeUVHeight),S.push(M.mapUv),S.push(M.alphaMapUv),S.push(M.lightMapUv),S.push(M.aoMapUv),S.push(M.bumpMapUv),S.push(M.normalMapUv),S.push(M.displacementMapUv),S.push(M.emissiveMapUv),S.push(M.metalnessMapUv),S.push(M.roughnessMapUv),S.push(M.anisotropyMapUv),S.push(M.clearcoatMapUv),S.push(M.clearcoatNormalMapUv),S.push(M.clearcoatRoughnessMapUv),S.push(M.iridescenceMapUv),S.push(M.iridescenceThicknessMapUv),S.push(M.sheenColorMapUv),S.push(M.sheenRoughnessMapUv),S.push(M.specularMapUv),S.push(M.specularColorMapUv),S.push(M.specularIntensityMapUv),S.push(M.transmissionMapUv),S.push(M.thicknessMapUv),S.push(M.combine),S.push(M.fogExp2),S.push(M.sizeAttenuation),S.push(M.morphTargetsCount),S.push(M.morphAttributeCount),S.push(M.numDirLights),S.push(M.numPointLights),S.push(M.numSpotLights),S.push(M.numSpotLightMaps),S.push(M.numHemiLights),S.push(M.numRectAreaLights),S.push(M.numDirLightShadows),S.push(M.numPointLightShadows),S.push(M.numSpotLightShadows),S.push(M.numSpotLightShadowsWithMaps),S.push(M.numLightProbes),S.push(M.shadowMapType),S.push(M.toneMapping),S.push(M.numClippingPlanes),S.push(M.numClipIntersection),S.push(M.depthPacking)}function y(S,M){a.disableAll(),M.supportsVertexTextures&&a.enable(0),M.instancing&&a.enable(1),M.instancingColor&&a.enable(2),M.instancingMorph&&a.enable(3),M.matcap&&a.enable(4),M.envMap&&a.enable(5),M.normalMapObjectSpace&&a.enable(6),M.normalMapTangentSpace&&a.enable(7),M.clearcoat&&a.enable(8),M.iridescence&&a.enable(9),M.alphaTest&&a.enable(10),M.vertexColors&&a.enable(11),M.vertexAlphas&&a.enable(12),M.vertexUv1s&&a.enable(13),M.vertexUv2s&&a.enable(14),M.vertexUv3s&&a.enable(15),M.vertexTangents&&a.enable(16),M.anisotropy&&a.enable(17),M.alphaHash&&a.enable(18),M.batching&&a.enable(19),M.dispersion&&a.enable(20),M.batchingColor&&a.enable(21),S.push(a.mask),a.disableAll(),M.fog&&a.enable(0),M.useFog&&a.enable(1),M.flatShading&&a.enable(2),M.logarithmicDepthBuffer&&a.enable(3),M.reverseDepthBuffer&&a.enable(4),M.skinning&&a.enable(5),M.morphTargets&&a.enable(6),M.morphNormals&&a.enable(7),M.morphColors&&a.enable(8),M.premultipliedAlpha&&a.enable(9),M.shadowMapEnabled&&a.enable(10),M.doubleSided&&a.enable(11),M.flipSided&&a.enable(12),M.useDepthPacking&&a.enable(13),M.dithering&&a.enable(14),M.transmission&&a.enable(15),M.sheen&&a.enable(16),M.opaque&&a.enable(17),M.pointsUvs&&a.enable(18),M.decodeVideoTexture&&a.enable(19),M.decodeVideoTextureEmissive&&a.enable(20),M.alphaToCoverage&&a.enable(21),S.push(a.mask)}function _(S){let M=g[S.type],L;if(M){let H=En[M];L=Ah.clone(H.uniforms)}else L=S.uniforms;return L}function C(S,M){let L;for(let H=0,z=h.length;H<z;H++){let k=h[H];if(k.cacheKey===M){L=k,++L.usedTimes;break}}return L===void 0&&(L=new n0(i,M,S,r),h.push(L)),L}function E(S){if(--S.usedTimes===0){let M=h.indexOf(S);h[M]=h[h.length-1],h.pop(),S.destroy()}}function R(S){l.remove(S)}function I(){l.dispose()}return{getParameters:m,getProgramCacheKey:p,getUniforms:_,acquireProgram:C,releaseProgram:E,releaseShaderCache:R,programs:h,dispose:I}}function r0(){let i=new WeakMap;function e(o){return i.has(o)}function t(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,l){i.get(o)[a]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function o0(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function eu(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function tu(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(u,d,f,g,x,m){let p=i[e];return p===void 0?(p={id:u.id,object:u,geometry:d,material:f,groupOrder:g,renderOrder:u.renderOrder,z:x,group:m},i[e]=p):(p.id=u.id,p.object=u,p.geometry=d,p.material=f,p.groupOrder=g,p.renderOrder=u.renderOrder,p.z=x,p.group=m),e++,p}function a(u,d,f,g,x,m){let p=o(u,d,f,g,x,m);f.transmission>0?n.push(p):f.transparent===!0?s.push(p):t.push(p)}function l(u,d,f,g,x,m){let p=o(u,d,f,g,x,m);f.transmission>0?n.unshift(p):f.transparent===!0?s.unshift(p):t.unshift(p)}function c(u,d){t.length>1&&t.sort(u||o0),n.length>1&&n.sort(d||eu),s.length>1&&s.sort(d||eu)}function h(){for(let u=e,d=i.length;u<d;u++){let f=i[u];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:h,sort:c}}function a0(){let i=new WeakMap;function e(n,s){let r=i.get(n),o;return r===void 0?(o=new tu,i.set(n,[o])):s>=r.length?(o=new tu,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function l0(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new D,color:new Ie};break;case"SpotLight":t={position:new D,direction:new D,color:new Ie,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new D,color:new Ie,distance:0,decay:0};break;case"HemisphereLight":t={direction:new D,skyColor:new Ie,groundColor:new Ie};break;case"RectAreaLight":t={color:new Ie,position:new D,halfWidth:new D,halfHeight:new D};break}return i[e.id]=t,t}}}function c0(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new te};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new te};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new te,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var h0=0;function u0(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function d0(i){let e=new l0,t=c0(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new D);let s=new D,r=new st,o=new st;function a(c){let h=0,u=0,d=0;for(let S=0;S<9;S++)n.probe[S].set(0,0,0);let f=0,g=0,x=0,m=0,p=0,T=0,y=0,_=0,C=0,E=0,R=0;c.sort(u0);for(let S=0,M=c.length;S<M;S++){let L=c[S],H=L.color,z=L.intensity,k=L.distance,G=L.shadow&&L.shadow.map?L.shadow.map.texture:null;if(L.isAmbientLight)h+=H.r*z,u+=H.g*z,d+=H.b*z;else if(L.isLightProbe){for(let Z=0;Z<9;Z++)n.probe[Z].addScaledVector(L.sh.coefficients[Z],z);R++}else if(L.isDirectionalLight){let Z=e.get(L);if(Z.color.copy(L.color).multiplyScalar(L.intensity),L.castShadow){let j=L.shadow,q=t.get(L);q.shadowIntensity=j.intensity,q.shadowBias=j.bias,q.shadowNormalBias=j.normalBias,q.shadowRadius=j.radius,q.shadowMapSize=j.mapSize,n.directionalShadow[f]=q,n.directionalShadowMap[f]=G,n.directionalShadowMatrix[f]=L.shadow.matrix,T++}n.directional[f]=Z,f++}else if(L.isSpotLight){let Z=e.get(L);Z.position.setFromMatrixPosition(L.matrixWorld),Z.color.copy(H).multiplyScalar(z),Z.distance=k,Z.coneCos=Math.cos(L.angle),Z.penumbraCos=Math.cos(L.angle*(1-L.penumbra)),Z.decay=L.decay,n.spot[x]=Z;let j=L.shadow;if(L.map&&(n.spotLightMap[C]=L.map,C++,j.updateMatrices(L),L.castShadow&&E++),n.spotLightMatrix[x]=j.matrix,L.castShadow){let q=t.get(L);q.shadowIntensity=j.intensity,q.shadowBias=j.bias,q.shadowNormalBias=j.normalBias,q.shadowRadius=j.radius,q.shadowMapSize=j.mapSize,n.spotShadow[x]=q,n.spotShadowMap[x]=G,_++}x++}else if(L.isRectAreaLight){let Z=e.get(L);Z.color.copy(H).multiplyScalar(z),Z.halfWidth.set(L.width*.5,0,0),Z.halfHeight.set(0,L.height*.5,0),n.rectArea[m]=Z,m++}else if(L.isPointLight){let Z=e.get(L);if(Z.color.copy(L.color).multiplyScalar(L.intensity),Z.distance=L.distance,Z.decay=L.decay,L.castShadow){let j=L.shadow,q=t.get(L);q.shadowIntensity=j.intensity,q.shadowBias=j.bias,q.shadowNormalBias=j.normalBias,q.shadowRadius=j.radius,q.shadowMapSize=j.mapSize,q.shadowCameraNear=j.camera.near,q.shadowCameraFar=j.camera.far,n.pointShadow[g]=q,n.pointShadowMap[g]=G,n.pointShadowMatrix[g]=L.shadow.matrix,y++}n.point[g]=Z,g++}else if(L.isHemisphereLight){let Z=e.get(L);Z.skyColor.copy(L.color).multiplyScalar(z),Z.groundColor.copy(L.groundColor).multiplyScalar(z),n.hemi[p]=Z,p++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ge.LTC_FLOAT_1,n.rectAreaLTC2=ge.LTC_FLOAT_2):(n.rectAreaLTC1=ge.LTC_HALF_1,n.rectAreaLTC2=ge.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let I=n.hash;(I.directionalLength!==f||I.pointLength!==g||I.spotLength!==x||I.rectAreaLength!==m||I.hemiLength!==p||I.numDirectionalShadows!==T||I.numPointShadows!==y||I.numSpotShadows!==_||I.numSpotMaps!==C||I.numLightProbes!==R)&&(n.directional.length=f,n.spot.length=x,n.rectArea.length=m,n.point.length=g,n.hemi.length=p,n.directionalShadow.length=T,n.directionalShadowMap.length=T,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=_,n.spotShadowMap.length=_,n.directionalShadowMatrix.length=T,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=_+C-E,n.spotLightMap.length=C,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=R,I.directionalLength=f,I.pointLength=g,I.spotLength=x,I.rectAreaLength=m,I.hemiLength=p,I.numDirectionalShadows=T,I.numPointShadows=y,I.numSpotShadows=_,I.numSpotMaps=C,I.numLightProbes=R,n.version=h0++)}function l(c,h){let u=0,d=0,f=0,g=0,x=0,m=h.matrixWorldInverse;for(let p=0,T=c.length;p<T;p++){let y=c[p];if(y.isDirectionalLight){let _=n.directional[u];_.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),_.direction.sub(s),_.direction.transformDirection(m),u++}else if(y.isSpotLight){let _=n.spot[f];_.position.setFromMatrixPosition(y.matrixWorld),_.position.applyMatrix4(m),_.direction.setFromMatrixPosition(y.matrixWorld),s.setFromMatrixPosition(y.target.matrixWorld),_.direction.sub(s),_.direction.transformDirection(m),f++}else if(y.isRectAreaLight){let _=n.rectArea[g];_.position.setFromMatrixPosition(y.matrixWorld),_.position.applyMatrix4(m),o.identity(),r.copy(y.matrixWorld),r.premultiply(m),o.extractRotation(r),_.halfWidth.set(y.width*.5,0,0),_.halfHeight.set(0,y.height*.5,0),_.halfWidth.applyMatrix4(o),_.halfHeight.applyMatrix4(o),g++}else if(y.isPointLight){let _=n.point[d];_.position.setFromMatrixPosition(y.matrixWorld),_.position.applyMatrix4(m),d++}else if(y.isHemisphereLight){let _=n.hemi[x];_.direction.setFromMatrixPosition(y.matrixWorld),_.direction.transformDirection(m),x++}}}return{setup:a,setupView:l,state:n}}function nu(i){let e=new d0(i),t=[],n=[];function s(h){c.camera=h,t.length=0,n.length=0}function r(h){t.push(h)}function o(h){n.push(h)}function a(){e.setup(t)}function l(h){e.setupView(t,h)}let c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:a,setupLightsView:l,pushLight:r,pushShadow:o}}function f0(i){let e=new WeakMap;function t(s,r=0){let o=e.get(s),a;return o===void 0?(a=new nu(i),e.set(s,[a])):r>=o.length?(a=new nu(i),o.push(a)):a=o[r],a}function n(){e=new WeakMap}return{get:t,dispose:n}}var p0=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,m0=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function g0(i,e,t){let n=new rs,s=new te,r=new te,o=new ut,a=new _o({depthPacking:fh}),l=new xo,c={},h=t.maxTextureSize,u={[Fn]:Ot,[Ot]:Fn,[pt]:pt},d=new vt({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new te},radius:{value:4}},vertexShader:p0,fragmentShader:m0}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let g=new at;g.setAttribute("position",new Ft(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let x=new ft(g,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=pl;let p=this.type;this.render=function(E,R,I){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||E.length===0)return;let S=i.getRenderTarget(),M=i.getActiveCubeFace(),L=i.getActiveMipmapLevel(),H=i.state;H.setBlending(Vn),H.buffers.color.setClear(1,1,1,1),H.buffers.depth.setTest(!0),H.setScissorTest(!1);let z=p!==wn&&this.type===wn,k=p===wn&&this.type!==wn;for(let G=0,Z=E.length;G<Z;G++){let j=E[G],q=j.shadow;if(q===void 0){console.warn("THREE.WebGLShadowMap:",j,"has no shadow.");continue}if(q.autoUpdate===!1&&q.needsUpdate===!1)continue;s.copy(q.mapSize);let oe=q.getFrameExtents();if(s.multiply(oe),r.copy(q.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/oe.x),s.x=r.x*oe.x,q.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/oe.y),s.y=r.y*oe.y,q.mapSize.y=r.y)),q.map===null||z===!0||k===!0){let Me=this.type!==wn?{minFilter:Gt,magFilter:Gt}:{};q.map!==null&&q.map.dispose(),q.map=new jt(s.x,s.y,Me),q.map.texture.name=j.name+".shadowMap",q.camera.updateProjectionMatrix()}i.setRenderTarget(q.map),i.clear();let me=q.getViewportCount();for(let Me=0;Me<me;Me++){let Pe=q.getViewport(Me);o.set(r.x*Pe.x,r.y*Pe.y,r.x*Pe.z,r.y*Pe.w),H.viewport(o),q.updateMatrices(j,Me),n=q.getFrustum(),_(R,I,q.camera,j,this.type)}q.isPointLightShadow!==!0&&this.type===wn&&T(q,I),q.needsUpdate=!1}p=this.type,m.needsUpdate=!1,i.setRenderTarget(S,M,L)};function T(E,R){let I=e.update(x);d.defines.VSM_SAMPLES!==E.blurSamples&&(d.defines.VSM_SAMPLES=E.blurSamples,f.defines.VSM_SAMPLES=E.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new jt(s.x,s.y)),d.uniforms.shadow_pass.value=E.map.texture,d.uniforms.resolution.value=E.mapSize,d.uniforms.radius.value=E.radius,i.setRenderTarget(E.mapPass),i.clear(),i.renderBufferDirect(R,null,I,d,x,null),f.uniforms.shadow_pass.value=E.mapPass.texture,f.uniforms.resolution.value=E.mapSize,f.uniforms.radius.value=E.radius,i.setRenderTarget(E.map),i.clear(),i.renderBufferDirect(R,null,I,f,x,null)}function y(E,R,I,S){let M=null,L=I.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(L!==void 0)M=L;else if(M=I.isPointLight===!0?l:a,i.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0||R.alphaToCoverage===!0){let H=M.uuid,z=R.uuid,k=c[H];k===void 0&&(k={},c[H]=k);let G=k[z];G===void 0&&(G=M.clone(),k[z]=G,R.addEventListener("dispose",C)),M=G}if(M.visible=R.visible,M.wireframe=R.wireframe,S===wn?M.side=R.shadowSide!==null?R.shadowSide:R.side:M.side=R.shadowSide!==null?R.shadowSide:u[R.side],M.alphaMap=R.alphaMap,M.alphaTest=R.alphaToCoverage===!0?.5:R.alphaTest,M.map=R.map,M.clipShadows=R.clipShadows,M.clippingPlanes=R.clippingPlanes,M.clipIntersection=R.clipIntersection,M.displacementMap=R.displacementMap,M.displacementScale=R.displacementScale,M.displacementBias=R.displacementBias,M.wireframeLinewidth=R.wireframeLinewidth,M.linewidth=R.linewidth,I.isPointLight===!0&&M.isMeshDistanceMaterial===!0){let H=i.properties.get(M);H.light=I}return M}function _(E,R,I,S,M){if(E.visible===!1)return;if(E.layers.test(R.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&M===wn)&&(!E.frustumCulled||n.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(I.matrixWorldInverse,E.matrixWorld);let z=e.update(E),k=E.material;if(Array.isArray(k)){let G=z.groups;for(let Z=0,j=G.length;Z<j;Z++){let q=G[Z],oe=k[q.materialIndex];if(oe&&oe.visible){let me=y(E,oe,S,M);E.onBeforeShadow(i,E,R,I,z,me,q),i.renderBufferDirect(I,null,z,me,E,q),E.onAfterShadow(i,E,R,I,z,me,q)}}}else if(k.visible){let G=y(E,k,S,M);E.onBeforeShadow(i,E,R,I,z,G,null),i.renderBufferDirect(I,null,z,G,E,null),E.onAfterShadow(i,E,R,I,z,G,null)}}let H=E.children;for(let z=0,k=H.length;z<k;z++)_(H[z],R,I,S,M)}function C(E){E.target.removeEventListener("dispose",C);for(let I in c){let S=c[I],M=E.target.uuid;M in S&&(S[M].dispose(),delete S[M])}}}var _0={[Io]:Po,[Lo]:No,[Do]:Fo,[mi]:Uo,[Po]:Io,[No]:Lo,[Fo]:Do,[Uo]:mi};function x0(i,e){function t(){let U=!1,ue=new ut,Y=null,ee=new ut(0,0,0,0);return{setMask:function(_e){Y!==_e&&!U&&(i.colorMask(_e,_e,_e,_e),Y=_e)},setLocked:function(_e){U=_e},setClear:function(_e,pe,Oe,lt,Ct){Ct===!0&&(_e*=lt,pe*=lt,Oe*=lt),ue.set(_e,pe,Oe,lt),ee.equals(ue)===!1&&(i.clearColor(_e,pe,Oe,lt),ee.copy(ue))},reset:function(){U=!1,Y=null,ee.set(-1,0,0,0)}}}function n(){let U=!1,ue=!1,Y=null,ee=null,_e=null;return{setReversed:function(pe){if(ue!==pe){let Oe=e.get("EXT_clip_control");pe?Oe.clipControlEXT(Oe.LOWER_LEFT_EXT,Oe.ZERO_TO_ONE_EXT):Oe.clipControlEXT(Oe.LOWER_LEFT_EXT,Oe.NEGATIVE_ONE_TO_ONE_EXT),ue=pe;let lt=_e;_e=null,this.setClear(lt)}},getReversed:function(){return ue},setTest:function(pe){pe?de(i.DEPTH_TEST):Ae(i.DEPTH_TEST)},setMask:function(pe){Y!==pe&&!U&&(i.depthMask(pe),Y=pe)},setFunc:function(pe){if(ue&&(pe=_0[pe]),ee!==pe){switch(pe){case Io:i.depthFunc(i.NEVER);break;case Po:i.depthFunc(i.ALWAYS);break;case Lo:i.depthFunc(i.LESS);break;case mi:i.depthFunc(i.LEQUAL);break;case Do:i.depthFunc(i.EQUAL);break;case Uo:i.depthFunc(i.GEQUAL);break;case No:i.depthFunc(i.GREATER);break;case Fo:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}ee=pe}},setLocked:function(pe){U=pe},setClear:function(pe){_e!==pe&&(ue&&(pe=1-pe),i.clearDepth(pe),_e=pe)},reset:function(){U=!1,Y=null,ee=null,_e=null,ue=!1}}}function s(){let U=!1,ue=null,Y=null,ee=null,_e=null,pe=null,Oe=null,lt=null,Ct=null;return{setTest:function(je){U||(je?de(i.STENCIL_TEST):Ae(i.STENCIL_TEST))},setMask:function(je){ue!==je&&!U&&(i.stencilMask(je),ue=je)},setFunc:function(je,sn,Cn){(Y!==je||ee!==sn||_e!==Cn)&&(i.stencilFunc(je,sn,Cn),Y=je,ee=sn,_e=Cn)},setOp:function(je,sn,Cn){(pe!==je||Oe!==sn||lt!==Cn)&&(i.stencilOp(je,sn,Cn),pe=je,Oe=sn,lt=Cn)},setLocked:function(je){U=je},setClear:function(je){Ct!==je&&(i.clearStencil(je),Ct=je)},reset:function(){U=!1,ue=null,Y=null,ee=null,_e=null,pe=null,Oe=null,lt=null,Ct=null}}}let r=new t,o=new n,a=new s,l=new WeakMap,c=new WeakMap,h={},u={},d=new WeakMap,f=[],g=null,x=!1,m=null,p=null,T=null,y=null,_=null,C=null,E=null,R=new Ie(0,0,0),I=0,S=!1,M=null,L=null,H=null,z=null,k=null,G=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Z=!1,j=0,q=i.getParameter(i.VERSION);q.indexOf("WebGL")!==-1?(j=parseFloat(/^WebGL (\d)/.exec(q)[1]),Z=j>=1):q.indexOf("OpenGL ES")!==-1&&(j=parseFloat(/^OpenGL ES (\d)/.exec(q)[1]),Z=j>=2);let oe=null,me={},Me=i.getParameter(i.SCISSOR_BOX),Pe=i.getParameter(i.VIEWPORT),He=new ut().fromArray(Me),$=new ut().fromArray(Pe);function ae(U,ue,Y,ee){let _e=new Uint8Array(4),pe=i.createTexture();i.bindTexture(U,pe),i.texParameteri(U,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(U,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Oe=0;Oe<Y;Oe++)U===i.TEXTURE_3D||U===i.TEXTURE_2D_ARRAY?i.texImage3D(ue,0,i.RGBA,1,1,ee,0,i.RGBA,i.UNSIGNED_BYTE,_e):i.texImage2D(ue+Oe,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,_e);return pe}let xe={};xe[i.TEXTURE_2D]=ae(i.TEXTURE_2D,i.TEXTURE_2D,1),xe[i.TEXTURE_CUBE_MAP]=ae(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),xe[i.TEXTURE_2D_ARRAY]=ae(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),xe[i.TEXTURE_3D]=ae(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),de(i.DEPTH_TEST),o.setFunc(mi),ne(!1),se(fl),de(i.CULL_FACE),A(Vn);function de(U){h[U]!==!0&&(i.enable(U),h[U]=!0)}function Ae(U){h[U]!==!1&&(i.disable(U),h[U]=!1)}function Ue(U,ue){return u[U]!==ue?(i.bindFramebuffer(U,ue),u[U]=ue,U===i.DRAW_FRAMEBUFFER&&(u[i.FRAMEBUFFER]=ue),U===i.FRAMEBUFFER&&(u[i.DRAW_FRAMEBUFFER]=ue),!0):!1}function Re(U,ue){let Y=f,ee=!1;if(U){Y=d.get(ue),Y===void 0&&(Y=[],d.set(ue,Y));let _e=U.textures;if(Y.length!==_e.length||Y[0]!==i.COLOR_ATTACHMENT0){for(let pe=0,Oe=_e.length;pe<Oe;pe++)Y[pe]=i.COLOR_ATTACHMENT0+pe;Y.length=_e.length,ee=!0}}else Y[0]!==i.BACK&&(Y[0]=i.BACK,ee=!0);ee&&i.drawBuffers(Y)}function nt(U){return g!==U?(i.useProgram(U),g=U,!0):!1}let qe={[$n]:i.FUNC_ADD,[kc]:i.FUNC_SUBTRACT,[Vc]:i.FUNC_REVERSE_SUBTRACT};qe[Gc]=i.MIN,qe[Hc]=i.MAX;let Ne={[Wc]:i.ZERO,[Xc]:i.ONE,[qc]:i.SRC_COLOR,[jr]:i.SRC_ALPHA,[Qc]:i.SRC_ALPHA_SATURATE,[Kc]:i.DST_COLOR,[Zc]:i.DST_ALPHA,[Yc]:i.ONE_MINUS_SRC_COLOR,[eo]:i.ONE_MINUS_SRC_ALPHA,[$c]:i.ONE_MINUS_DST_COLOR,[Jc]:i.ONE_MINUS_DST_ALPHA,[jc]:i.CONSTANT_COLOR,[eh]:i.ONE_MINUS_CONSTANT_COLOR,[th]:i.CONSTANT_ALPHA,[nh]:i.ONE_MINUS_CONSTANT_ALPHA};function A(U,ue,Y,ee,_e,pe,Oe,lt,Ct,je){if(U===Vn){x===!0&&(Ae(i.BLEND),x=!1);return}if(x===!1&&(de(i.BLEND),x=!0),U!==zc){if(U!==m||je!==S){if((p!==$n||_!==$n)&&(i.blendEquation(i.FUNC_ADD),p=$n,_=$n),je)switch(U){case pi:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case fr:i.blendFunc(i.ONE,i.ONE);break;case ml:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case gl:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}else switch(U){case pi:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case fr:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case ml:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case gl:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}T=null,y=null,C=null,E=null,R.set(0,0,0),I=0,m=U,S=je}return}_e=_e||ue,pe=pe||Y,Oe=Oe||ee,(ue!==p||_e!==_)&&(i.blendEquationSeparate(qe[ue],qe[_e]),p=ue,_=_e),(Y!==T||ee!==y||pe!==C||Oe!==E)&&(i.blendFuncSeparate(Ne[Y],Ne[ee],Ne[pe],Ne[Oe]),T=Y,y=ee,C=pe,E=Oe),(lt.equals(R)===!1||Ct!==I)&&(i.blendColor(lt.r,lt.g,lt.b,Ct),R.copy(lt),I=Ct),m=U,S=!1}function ce(U,ue){U.side===pt?Ae(i.CULL_FACE):de(i.CULL_FACE);let Y=U.side===Ot;ue&&(Y=!Y),ne(Y),U.blending===pi&&U.transparent===!1?A(Vn):A(U.blending,U.blendEquation,U.blendSrc,U.blendDst,U.blendEquationAlpha,U.blendSrcAlpha,U.blendDstAlpha,U.blendColor,U.blendAlpha,U.premultipliedAlpha),o.setFunc(U.depthFunc),o.setTest(U.depthTest),o.setMask(U.depthWrite),r.setMask(U.colorWrite);let ee=U.stencilWrite;a.setTest(ee),ee&&(a.setMask(U.stencilWriteMask),a.setFunc(U.stencilFunc,U.stencilRef,U.stencilFuncMask),a.setOp(U.stencilFail,U.stencilZFail,U.stencilZPass)),ie(U.polygonOffset,U.polygonOffsetFactor,U.polygonOffsetUnits),U.alphaToCoverage===!0?de(i.SAMPLE_ALPHA_TO_COVERAGE):Ae(i.SAMPLE_ALPHA_TO_COVERAGE)}function ne(U){M!==U&&(U?i.frontFace(i.CW):i.frontFace(i.CCW),M=U)}function se(U){U!==Oc?(de(i.CULL_FACE),U!==L&&(U===fl?i.cullFace(i.BACK):U===Bc?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Ae(i.CULL_FACE),L=U}function B(U){U!==H&&(Z&&i.lineWidth(U),H=U)}function ie(U,ue,Y){U?(de(i.POLYGON_OFFSET_FILL),(z!==ue||k!==Y)&&(i.polygonOffset(ue,Y),z=ue,k=Y)):Ae(i.POLYGON_OFFSET_FILL)}function K(U){U?de(i.SCISSOR_TEST):Ae(i.SCISSOR_TEST)}function w(U){U===void 0&&(U=i.TEXTURE0+G-1),oe!==U&&(i.activeTexture(U),oe=U)}function v(U,ue,Y){Y===void 0&&(oe===null?Y=i.TEXTURE0+G-1:Y=oe);let ee=me[Y];ee===void 0&&(ee={type:void 0,texture:void 0},me[Y]=ee),(ee.type!==U||ee.texture!==ue)&&(oe!==Y&&(i.activeTexture(Y),oe=Y),i.bindTexture(U,ue||xe[U]),ee.type=U,ee.texture=ue)}function P(){let U=me[oe];U!==void 0&&U.type!==void 0&&(i.bindTexture(U.type,null),U.type=void 0,U.texture=void 0)}function O(){try{i.compressedTexImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function J(){try{i.compressedTexImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function V(){try{i.texSubImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function fe(){try{i.texSubImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function le(){try{i.compressedTexSubImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Se(){try{i.compressedTexSubImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function be(){try{i.texStorage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Q(){try{i.texStorage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function he(){try{i.texImage2D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Te(){try{i.texImage3D(...arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Ce(U){He.equals(U)===!1&&(i.scissor(U.x,U.y,U.z,U.w),He.copy(U))}function ve(U){$.equals(U)===!1&&(i.viewport(U.x,U.y,U.z,U.w),$.copy(U))}function ze(U,ue){let Y=c.get(ue);Y===void 0&&(Y=new WeakMap,c.set(ue,Y));let ee=Y.get(U);ee===void 0&&(ee=i.getUniformBlockIndex(ue,U.name),Y.set(U,ee))}function ke(U,ue){let ee=c.get(ue).get(U);l.get(ue)!==ee&&(i.uniformBlockBinding(ue,ee,U.__bindingPointIndex),l.set(ue,ee))}function Ke(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),o.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),h={},oe=null,me={},u={},d=new WeakMap,f=[],g=null,x=!1,m=null,p=null,T=null,y=null,_=null,C=null,E=null,R=new Ie(0,0,0),I=0,S=!1,M=null,L=null,H=null,z=null,k=null,He.set(0,0,i.canvas.width,i.canvas.height),$.set(0,0,i.canvas.width,i.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:de,disable:Ae,bindFramebuffer:Ue,drawBuffers:Re,useProgram:nt,setBlending:A,setMaterial:ce,setFlipSided:ne,setCullFace:se,setLineWidth:B,setPolygonOffset:ie,setScissorTest:K,activeTexture:w,bindTexture:v,unbindTexture:P,compressedTexImage2D:O,compressedTexImage3D:J,texImage2D:he,texImage3D:Te,updateUBOMapping:ze,uniformBlockBinding:ke,texStorage2D:be,texStorage3D:Q,texSubImage2D:V,texSubImage3D:fe,compressedTexSubImage2D:le,compressedTexSubImage3D:Se,scissor:Ce,viewport:ve,reset:Ke}}function v0(i,e,t,n,s,r,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new te,h=new WeakMap,u,d=new WeakMap,f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(w,v){return f?new OffscreenCanvas(w,v):ks("canvas")}function x(w,v,P){let O=1,J=K(w);if((J.width>P||J.height>P)&&(O=P/Math.max(J.width,J.height)),O<1)if(typeof HTMLImageElement<"u"&&w instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&w instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&w instanceof ImageBitmap||typeof VideoFrame<"u"&&w instanceof VideoFrame){let V=Math.floor(O*J.width),fe=Math.floor(O*J.height);u===void 0&&(u=g(V,fe));let le=v?g(V,fe):u;return le.width=V,le.height=fe,le.getContext("2d").drawImage(w,0,0,V,fe),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+J.width+"x"+J.height+") to ("+V+"x"+fe+")."),le}else return"data"in w&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+J.width+"x"+J.height+")."),w;return w}function m(w){return w.generateMipmaps}function p(w){i.generateMipmap(w)}function T(w){return w.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:w.isWebGL3DRenderTarget?i.TEXTURE_3D:w.isWebGLArrayRenderTarget||w.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function y(w,v,P,O,J=!1){if(w!==null){if(i[w]!==void 0)return i[w];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+w+"'")}let V=v;if(v===i.RED&&(P===i.FLOAT&&(V=i.R32F),P===i.HALF_FLOAT&&(V=i.R16F),P===i.UNSIGNED_BYTE&&(V=i.R8)),v===i.RED_INTEGER&&(P===i.UNSIGNED_BYTE&&(V=i.R8UI),P===i.UNSIGNED_SHORT&&(V=i.R16UI),P===i.UNSIGNED_INT&&(V=i.R32UI),P===i.BYTE&&(V=i.R8I),P===i.SHORT&&(V=i.R16I),P===i.INT&&(V=i.R32I)),v===i.RG&&(P===i.FLOAT&&(V=i.RG32F),P===i.HALF_FLOAT&&(V=i.RG16F),P===i.UNSIGNED_BYTE&&(V=i.RG8)),v===i.RG_INTEGER&&(P===i.UNSIGNED_BYTE&&(V=i.RG8UI),P===i.UNSIGNED_SHORT&&(V=i.RG16UI),P===i.UNSIGNED_INT&&(V=i.RG32UI),P===i.BYTE&&(V=i.RG8I),P===i.SHORT&&(V=i.RG16I),P===i.INT&&(V=i.RG32I)),v===i.RGB_INTEGER&&(P===i.UNSIGNED_BYTE&&(V=i.RGB8UI),P===i.UNSIGNED_SHORT&&(V=i.RGB16UI),P===i.UNSIGNED_INT&&(V=i.RGB32UI),P===i.BYTE&&(V=i.RGB8I),P===i.SHORT&&(V=i.RGB16I),P===i.INT&&(V=i.RGB32I)),v===i.RGBA_INTEGER&&(P===i.UNSIGNED_BYTE&&(V=i.RGBA8UI),P===i.UNSIGNED_SHORT&&(V=i.RGBA16UI),P===i.UNSIGNED_INT&&(V=i.RGBA32UI),P===i.BYTE&&(V=i.RGBA8I),P===i.SHORT&&(V=i.RGBA16I),P===i.INT&&(V=i.RGBA32I)),v===i.RGB&&P===i.UNSIGNED_INT_5_9_9_9_REV&&(V=i.RGB9_E5),v===i.RGBA){let fe=J?Bs:Ze.getTransfer(O);P===i.FLOAT&&(V=i.RGBA32F),P===i.HALF_FLOAT&&(V=i.RGBA16F),P===i.UNSIGNED_BYTE&&(V=fe===tt?i.SRGB8_ALPHA8:i.RGBA8),P===i.UNSIGNED_SHORT_4_4_4_4&&(V=i.RGBA4),P===i.UNSIGNED_SHORT_5_5_5_1&&(V=i.RGB5_A1)}return(V===i.R16F||V===i.R32F||V===i.RG16F||V===i.RG32F||V===i.RGBA16F||V===i.RGBA32F)&&e.get("EXT_color_buffer_float"),V}function _(w,v){let P;return w?v===null||v===ii||v===fs?P=i.DEPTH24_STENCIL8:v===mn?P=i.DEPTH32F_STENCIL8:v===ds&&(P=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===ii||v===fs?P=i.DEPTH_COMPONENT24:v===mn?P=i.DEPTH_COMPONENT32F:v===ds&&(P=i.DEPTH_COMPONENT16),P}function C(w,v){return m(w)===!0||w.isFramebufferTexture&&w.minFilter!==Gt&&w.minFilter!==hn?Math.log2(Math.max(v.width,v.height))+1:w.mipmaps!==void 0&&w.mipmaps.length>0?w.mipmaps.length:w.isCompressedTexture&&Array.isArray(w.image)?v.mipmaps.length:1}function E(w){let v=w.target;v.removeEventListener("dispose",E),I(v),v.isVideoTexture&&h.delete(v)}function R(w){let v=w.target;v.removeEventListener("dispose",R),M(v)}function I(w){let v=n.get(w);if(v.__webglInit===void 0)return;let P=w.source,O=d.get(P);if(O){let J=O[v.__cacheKey];J.usedTimes--,J.usedTimes===0&&S(w),Object.keys(O).length===0&&d.delete(P)}n.remove(w)}function S(w){let v=n.get(w);i.deleteTexture(v.__webglTexture);let P=w.source,O=d.get(P);delete O[v.__cacheKey],o.memory.textures--}function M(w){let v=n.get(w);if(w.depthTexture&&(w.depthTexture.dispose(),n.remove(w.depthTexture)),w.isWebGLCubeRenderTarget)for(let O=0;O<6;O++){if(Array.isArray(v.__webglFramebuffer[O]))for(let J=0;J<v.__webglFramebuffer[O].length;J++)i.deleteFramebuffer(v.__webglFramebuffer[O][J]);else i.deleteFramebuffer(v.__webglFramebuffer[O]);v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer[O])}else{if(Array.isArray(v.__webglFramebuffer))for(let O=0;O<v.__webglFramebuffer.length;O++)i.deleteFramebuffer(v.__webglFramebuffer[O]);else i.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&i.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let O=0;O<v.__webglColorRenderbuffer.length;O++)v.__webglColorRenderbuffer[O]&&i.deleteRenderbuffer(v.__webglColorRenderbuffer[O]);v.__webglDepthRenderbuffer&&i.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let P=w.textures;for(let O=0,J=P.length;O<J;O++){let V=n.get(P[O]);V.__webglTexture&&(i.deleteTexture(V.__webglTexture),o.memory.textures--),n.remove(P[O])}n.remove(w)}let L=0;function H(){L=0}function z(){let w=L;return w>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+w+" texture units while this GPU supports only "+s.maxTextures),L+=1,w}function k(w){let v=[];return v.push(w.wrapS),v.push(w.wrapT),v.push(w.wrapR||0),v.push(w.magFilter),v.push(w.minFilter),v.push(w.anisotropy),v.push(w.internalFormat),v.push(w.format),v.push(w.type),v.push(w.generateMipmaps),v.push(w.premultiplyAlpha),v.push(w.flipY),v.push(w.unpackAlignment),v.push(w.colorSpace),v.join()}function G(w,v){let P=n.get(w);if(w.isVideoTexture&&B(w),w.isRenderTargetTexture===!1&&w.version>0&&P.__version!==w.version){let O=w.image;if(O===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(O.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{$(P,w,v);return}}t.bindTexture(i.TEXTURE_2D,P.__webglTexture,i.TEXTURE0+v)}function Z(w,v){let P=n.get(w);if(w.version>0&&P.__version!==w.version){$(P,w,v);return}t.bindTexture(i.TEXTURE_2D_ARRAY,P.__webglTexture,i.TEXTURE0+v)}function j(w,v){let P=n.get(w);if(w.version>0&&P.__version!==w.version){$(P,w,v);return}t.bindTexture(i.TEXTURE_3D,P.__webglTexture,i.TEXTURE0+v)}function q(w,v){let P=n.get(w);if(w.version>0&&P.__version!==w.version){ae(P,w,v);return}t.bindTexture(i.TEXTURE_CUBE_MAP,P.__webglTexture,i.TEXTURE0+v)}let oe={[to]:i.REPEAT,[Kn]:i.CLAMP_TO_EDGE,[no]:i.MIRRORED_REPEAT},me={[Gt]:i.NEAREST,[uh]:i.NEAREST_MIPMAP_NEAREST,[mr]:i.NEAREST_MIPMAP_LINEAR,[hn]:i.LINEAR,[ko]:i.LINEAR_MIPMAP_NEAREST,[ni]:i.LINEAR_MIPMAP_LINEAR},Me={[mh]:i.NEVER,[Mh]:i.ALWAYS,[gh]:i.LESS,[Al]:i.LEQUAL,[_h]:i.EQUAL,[yh]:i.GEQUAL,[xh]:i.GREATER,[vh]:i.NOTEQUAL};function Pe(w,v){if(v.type===mn&&e.has("OES_texture_float_linear")===!1&&(v.magFilter===hn||v.magFilter===ko||v.magFilter===mr||v.magFilter===ni||v.minFilter===hn||v.minFilter===ko||v.minFilter===mr||v.minFilter===ni)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(w,i.TEXTURE_WRAP_S,oe[v.wrapS]),i.texParameteri(w,i.TEXTURE_WRAP_T,oe[v.wrapT]),(w===i.TEXTURE_3D||w===i.TEXTURE_2D_ARRAY)&&i.texParameteri(w,i.TEXTURE_WRAP_R,oe[v.wrapR]),i.texParameteri(w,i.TEXTURE_MAG_FILTER,me[v.magFilter]),i.texParameteri(w,i.TEXTURE_MIN_FILTER,me[v.minFilter]),v.compareFunction&&(i.texParameteri(w,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(w,i.TEXTURE_COMPARE_FUNC,Me[v.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===Gt||v.minFilter!==mr&&v.minFilter!==ni||v.type===mn&&e.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||n.get(v).__currentAnisotropy){let P=e.get("EXT_texture_filter_anisotropic");i.texParameterf(w,P.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,s.getMaxAnisotropy())),n.get(v).__currentAnisotropy=v.anisotropy}}}function He(w,v){let P=!1;w.__webglInit===void 0&&(w.__webglInit=!0,v.addEventListener("dispose",E));let O=v.source,J=d.get(O);J===void 0&&(J={},d.set(O,J));let V=k(v);if(V!==w.__cacheKey){J[V]===void 0&&(J[V]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,P=!0),J[V].usedTimes++;let fe=J[w.__cacheKey];fe!==void 0&&(J[w.__cacheKey].usedTimes--,fe.usedTimes===0&&S(v)),w.__cacheKey=V,w.__webglTexture=J[V].texture}return P}function $(w,v,P){let O=i.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(O=i.TEXTURE_2D_ARRAY),v.isData3DTexture&&(O=i.TEXTURE_3D);let J=He(w,v),V=v.source;t.bindTexture(O,w.__webglTexture,i.TEXTURE0+P);let fe=n.get(V);if(V.version!==fe.__version||J===!0){t.activeTexture(i.TEXTURE0+P);let le=Ze.getPrimaries(Ze.workingColorSpace),Se=v.colorSpace===Hn?null:Ze.getPrimaries(v.colorSpace),be=v.colorSpace===Hn||le===Se?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,be);let Q=x(v.image,!1,s.maxTextureSize);Q=ie(v,Q);let he=r.convert(v.format,v.colorSpace),Te=r.convert(v.type),Ce=y(v.internalFormat,he,Te,v.colorSpace,v.isVideoTexture);Pe(O,v);let ve,ze=v.mipmaps,ke=v.isVideoTexture!==!0,Ke=fe.__version===void 0||J===!0,U=V.dataReady,ue=C(v,Q);if(v.isDepthTexture)Ce=_(v.format===ps,v.type),Ke&&(ke?t.texStorage2D(i.TEXTURE_2D,1,Ce,Q.width,Q.height):t.texImage2D(i.TEXTURE_2D,0,Ce,Q.width,Q.height,0,he,Te,null));else if(v.isDataTexture)if(ze.length>0){ke&&Ke&&t.texStorage2D(i.TEXTURE_2D,ue,Ce,ze[0].width,ze[0].height);for(let Y=0,ee=ze.length;Y<ee;Y++)ve=ze[Y],ke?U&&t.texSubImage2D(i.TEXTURE_2D,Y,0,0,ve.width,ve.height,he,Te,ve.data):t.texImage2D(i.TEXTURE_2D,Y,Ce,ve.width,ve.height,0,he,Te,ve.data);v.generateMipmaps=!1}else ke?(Ke&&t.texStorage2D(i.TEXTURE_2D,ue,Ce,Q.width,Q.height),U&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,Q.width,Q.height,he,Te,Q.data)):t.texImage2D(i.TEXTURE_2D,0,Ce,Q.width,Q.height,0,he,Te,Q.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){ke&&Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ue,Ce,ze[0].width,ze[0].height,Q.depth);for(let Y=0,ee=ze.length;Y<ee;Y++)if(ve=ze[Y],v.format!==en)if(he!==null)if(ke){if(U)if(v.layerUpdates.size>0){let _e=Nl(ve.width,ve.height,v.format,v.type);for(let pe of v.layerUpdates){let Oe=ve.data.subarray(pe*_e/ve.data.BYTES_PER_ELEMENT,(pe+1)*_e/ve.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,Y,0,0,pe,ve.width,ve.height,1,he,Oe)}v.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,Y,0,0,0,ve.width,ve.height,Q.depth,he,ve.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,Y,Ce,ve.width,ve.height,Q.depth,0,ve.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ke?U&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,Y,0,0,0,ve.width,ve.height,Q.depth,he,Te,ve.data):t.texImage3D(i.TEXTURE_2D_ARRAY,Y,Ce,ve.width,ve.height,Q.depth,0,he,Te,ve.data)}else{ke&&Ke&&t.texStorage2D(i.TEXTURE_2D,ue,Ce,ze[0].width,ze[0].height);for(let Y=0,ee=ze.length;Y<ee;Y++)ve=ze[Y],v.format!==en?he!==null?ke?U&&t.compressedTexSubImage2D(i.TEXTURE_2D,Y,0,0,ve.width,ve.height,he,ve.data):t.compressedTexImage2D(i.TEXTURE_2D,Y,Ce,ve.width,ve.height,0,ve.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ke?U&&t.texSubImage2D(i.TEXTURE_2D,Y,0,0,ve.width,ve.height,he,Te,ve.data):t.texImage2D(i.TEXTURE_2D,Y,Ce,ve.width,ve.height,0,he,Te,ve.data)}else if(v.isDataArrayTexture)if(ke){if(Ke&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ue,Ce,Q.width,Q.height,Q.depth),U)if(v.layerUpdates.size>0){let Y=Nl(Q.width,Q.height,v.format,v.type);for(let ee of v.layerUpdates){let _e=Q.data.subarray(ee*Y/Q.data.BYTES_PER_ELEMENT,(ee+1)*Y/Q.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,ee,Q.width,Q.height,1,he,Te,_e)}v.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,he,Te,Q.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,Ce,Q.width,Q.height,Q.depth,0,he,Te,Q.data);else if(v.isData3DTexture)ke?(Ke&&t.texStorage3D(i.TEXTURE_3D,ue,Ce,Q.width,Q.height,Q.depth),U&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,he,Te,Q.data)):t.texImage3D(i.TEXTURE_3D,0,Ce,Q.width,Q.height,Q.depth,0,he,Te,Q.data);else if(v.isFramebufferTexture){if(Ke)if(ke)t.texStorage2D(i.TEXTURE_2D,ue,Ce,Q.width,Q.height);else{let Y=Q.width,ee=Q.height;for(let _e=0;_e<ue;_e++)t.texImage2D(i.TEXTURE_2D,_e,Ce,Y,ee,0,he,Te,null),Y>>=1,ee>>=1}}else if(ze.length>0){if(ke&&Ke){let Y=K(ze[0]);t.texStorage2D(i.TEXTURE_2D,ue,Ce,Y.width,Y.height)}for(let Y=0,ee=ze.length;Y<ee;Y++)ve=ze[Y],ke?U&&t.texSubImage2D(i.TEXTURE_2D,Y,0,0,he,Te,ve):t.texImage2D(i.TEXTURE_2D,Y,Ce,he,Te,ve);v.generateMipmaps=!1}else if(ke){if(Ke){let Y=K(Q);t.texStorage2D(i.TEXTURE_2D,ue,Ce,Y.width,Y.height)}U&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,he,Te,Q)}else t.texImage2D(i.TEXTURE_2D,0,Ce,he,Te,Q);m(v)&&p(O),fe.__version=V.version,v.onUpdate&&v.onUpdate(v)}w.__version=v.version}function ae(w,v,P){if(v.image.length!==6)return;let O=He(w,v),J=v.source;t.bindTexture(i.TEXTURE_CUBE_MAP,w.__webglTexture,i.TEXTURE0+P);let V=n.get(J);if(J.version!==V.__version||O===!0){t.activeTexture(i.TEXTURE0+P);let fe=Ze.getPrimaries(Ze.workingColorSpace),le=v.colorSpace===Hn?null:Ze.getPrimaries(v.colorSpace),Se=v.colorSpace===Hn||fe===le?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Se);let be=v.isCompressedTexture||v.image[0].isCompressedTexture,Q=v.image[0]&&v.image[0].isDataTexture,he=[];for(let ee=0;ee<6;ee++)!be&&!Q?he[ee]=x(v.image[ee],!0,s.maxCubemapSize):he[ee]=Q?v.image[ee].image:v.image[ee],he[ee]=ie(v,he[ee]);let Te=he[0],Ce=r.convert(v.format,v.colorSpace),ve=r.convert(v.type),ze=y(v.internalFormat,Ce,ve,v.colorSpace),ke=v.isVideoTexture!==!0,Ke=V.__version===void 0||O===!0,U=J.dataReady,ue=C(v,Te);Pe(i.TEXTURE_CUBE_MAP,v);let Y;if(be){ke&&Ke&&t.texStorage2D(i.TEXTURE_CUBE_MAP,ue,ze,Te.width,Te.height);for(let ee=0;ee<6;ee++){Y=he[ee].mipmaps;for(let _e=0;_e<Y.length;_e++){let pe=Y[_e];v.format!==en?Ce!==null?ke?U&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e,0,0,pe.width,pe.height,Ce,pe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e,ze,pe.width,pe.height,0,pe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):ke?U&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e,0,0,pe.width,pe.height,Ce,ve,pe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e,ze,pe.width,pe.height,0,Ce,ve,pe.data)}}}else{if(Y=v.mipmaps,ke&&Ke){Y.length>0&&ue++;let ee=K(he[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,ue,ze,ee.width,ee.height)}for(let ee=0;ee<6;ee++)if(Q){ke?U&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,0,0,0,he[ee].width,he[ee].height,Ce,ve,he[ee].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,0,ze,he[ee].width,he[ee].height,0,Ce,ve,he[ee].data);for(let _e=0;_e<Y.length;_e++){let Oe=Y[_e].image[ee].image;ke?U&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e+1,0,0,Oe.width,Oe.height,Ce,ve,Oe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e+1,ze,Oe.width,Oe.height,0,Ce,ve,Oe.data)}}else{ke?U&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,0,0,0,Ce,ve,he[ee]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,0,ze,Ce,ve,he[ee]);for(let _e=0;_e<Y.length;_e++){let pe=Y[_e];ke?U&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e+1,0,0,Ce,ve,pe.image[ee]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,_e+1,ze,Ce,ve,pe.image[ee])}}}m(v)&&p(i.TEXTURE_CUBE_MAP),V.__version=J.version,v.onUpdate&&v.onUpdate(v)}w.__version=v.version}function xe(w,v,P,O,J,V){let fe=r.convert(P.format,P.colorSpace),le=r.convert(P.type),Se=y(P.internalFormat,fe,le,P.colorSpace),be=n.get(v),Q=n.get(P);if(Q.__renderTarget=v,!be.__hasExternalTextures){let he=Math.max(1,v.width>>V),Te=Math.max(1,v.height>>V);J===i.TEXTURE_3D||J===i.TEXTURE_2D_ARRAY?t.texImage3D(J,V,Se,he,Te,v.depth,0,fe,le,null):t.texImage2D(J,V,Se,he,Te,0,fe,le,null)}t.bindFramebuffer(i.FRAMEBUFFER,w),se(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,O,J,Q.__webglTexture,0,ne(v)):(J===i.TEXTURE_2D||J>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&J<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,O,J,Q.__webglTexture,V),t.bindFramebuffer(i.FRAMEBUFFER,null)}function de(w,v,P){if(i.bindRenderbuffer(i.RENDERBUFFER,w),v.depthBuffer){let O=v.depthTexture,J=O&&O.isDepthTexture?O.type:null,V=_(v.stencilBuffer,J),fe=v.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,le=ne(v);se(v)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,le,V,v.width,v.height):P?i.renderbufferStorageMultisample(i.RENDERBUFFER,le,V,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,V,v.width,v.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,fe,i.RENDERBUFFER,w)}else{let O=v.textures;for(let J=0;J<O.length;J++){let V=O[J],fe=r.convert(V.format,V.colorSpace),le=r.convert(V.type),Se=y(V.internalFormat,fe,le,V.colorSpace),be=ne(v);P&&se(v)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,be,Se,v.width,v.height):se(v)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,be,Se,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,Se,v.width,v.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ae(w,v){if(v&&v.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,w),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let O=n.get(v.depthTexture);O.__renderTarget=v,(!O.__webglTexture||v.depthTexture.image.width!==v.width||v.depthTexture.image.height!==v.height)&&(v.depthTexture.image.width=v.width,v.depthTexture.image.height=v.height,v.depthTexture.needsUpdate=!0),G(v.depthTexture,0);let J=O.__webglTexture,V=ne(v);if(v.depthTexture.format===ji)se(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,J,0,V):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,J,0);else if(v.depthTexture.format===ps)se(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,J,0,V):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,J,0);else throw new Error("Unknown depthTexture format")}function Ue(w){let v=n.get(w),P=w.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==w.depthTexture){let O=w.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),O){let J=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,O.removeEventListener("dispose",J)};O.addEventListener("dispose",J),v.__depthDisposeCallback=J}v.__boundDepthTexture=O}if(w.depthTexture&&!v.__autoAllocateDepthBuffer){if(P)throw new Error("target.depthTexture not supported in Cube render targets");let O=w.texture.mipmaps;O&&O.length>0?Ae(v.__webglFramebuffer[0],w):Ae(v.__webglFramebuffer,w)}else if(P){v.__webglDepthbuffer=[];for(let O=0;O<6;O++)if(t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[O]),v.__webglDepthbuffer[O]===void 0)v.__webglDepthbuffer[O]=i.createRenderbuffer(),de(v.__webglDepthbuffer[O],w,!1);else{let J=w.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,V=v.__webglDepthbuffer[O];i.bindRenderbuffer(i.RENDERBUFFER,V),i.framebufferRenderbuffer(i.FRAMEBUFFER,J,i.RENDERBUFFER,V)}}else{let O=w.texture.mipmaps;if(O&&O.length>0?t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=i.createRenderbuffer(),de(v.__webglDepthbuffer,w,!1);else{let J=w.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,V=v.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,V),i.framebufferRenderbuffer(i.FRAMEBUFFER,J,i.RENDERBUFFER,V)}}t.bindFramebuffer(i.FRAMEBUFFER,null)}function Re(w,v,P){let O=n.get(w);v!==void 0&&xe(O.__webglFramebuffer,w,w.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),P!==void 0&&Ue(w)}function nt(w){let v=w.texture,P=n.get(w),O=n.get(v);w.addEventListener("dispose",R);let J=w.textures,V=w.isWebGLCubeRenderTarget===!0,fe=J.length>1;if(fe||(O.__webglTexture===void 0&&(O.__webglTexture=i.createTexture()),O.__version=v.version,o.memory.textures++),V){P.__webglFramebuffer=[];for(let le=0;le<6;le++)if(v.mipmaps&&v.mipmaps.length>0){P.__webglFramebuffer[le]=[];for(let Se=0;Se<v.mipmaps.length;Se++)P.__webglFramebuffer[le][Se]=i.createFramebuffer()}else P.__webglFramebuffer[le]=i.createFramebuffer()}else{if(v.mipmaps&&v.mipmaps.length>0){P.__webglFramebuffer=[];for(let le=0;le<v.mipmaps.length;le++)P.__webglFramebuffer[le]=i.createFramebuffer()}else P.__webglFramebuffer=i.createFramebuffer();if(fe)for(let le=0,Se=J.length;le<Se;le++){let be=n.get(J[le]);be.__webglTexture===void 0&&(be.__webglTexture=i.createTexture(),o.memory.textures++)}if(w.samples>0&&se(w)===!1){P.__webglMultisampledFramebuffer=i.createFramebuffer(),P.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,P.__webglMultisampledFramebuffer);for(let le=0;le<J.length;le++){let Se=J[le];P.__webglColorRenderbuffer[le]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,P.__webglColorRenderbuffer[le]);let be=r.convert(Se.format,Se.colorSpace),Q=r.convert(Se.type),he=y(Se.internalFormat,be,Q,Se.colorSpace,w.isXRRenderTarget===!0),Te=ne(w);i.renderbufferStorageMultisample(i.RENDERBUFFER,Te,he,w.width,w.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+le,i.RENDERBUFFER,P.__webglColorRenderbuffer[le])}i.bindRenderbuffer(i.RENDERBUFFER,null),w.depthBuffer&&(P.__webglDepthRenderbuffer=i.createRenderbuffer(),de(P.__webglDepthRenderbuffer,w,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(V){t.bindTexture(i.TEXTURE_CUBE_MAP,O.__webglTexture),Pe(i.TEXTURE_CUBE_MAP,v);for(let le=0;le<6;le++)if(v.mipmaps&&v.mipmaps.length>0)for(let Se=0;Se<v.mipmaps.length;Se++)xe(P.__webglFramebuffer[le][Se],w,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+le,Se);else xe(P.__webglFramebuffer[le],w,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+le,0);m(v)&&p(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(fe){for(let le=0,Se=J.length;le<Se;le++){let be=J[le],Q=n.get(be);t.bindTexture(i.TEXTURE_2D,Q.__webglTexture),Pe(i.TEXTURE_2D,be),xe(P.__webglFramebuffer,w,be,i.COLOR_ATTACHMENT0+le,i.TEXTURE_2D,0),m(be)&&p(i.TEXTURE_2D)}t.unbindTexture()}else{let le=i.TEXTURE_2D;if((w.isWebGL3DRenderTarget||w.isWebGLArrayRenderTarget)&&(le=w.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(le,O.__webglTexture),Pe(le,v),v.mipmaps&&v.mipmaps.length>0)for(let Se=0;Se<v.mipmaps.length;Se++)xe(P.__webglFramebuffer[Se],w,v,i.COLOR_ATTACHMENT0,le,Se);else xe(P.__webglFramebuffer,w,v,i.COLOR_ATTACHMENT0,le,0);m(v)&&p(le),t.unbindTexture()}w.depthBuffer&&Ue(w)}function qe(w){let v=w.textures;for(let P=0,O=v.length;P<O;P++){let J=v[P];if(m(J)){let V=T(w),fe=n.get(J).__webglTexture;t.bindTexture(V,fe),p(V),t.unbindTexture()}}}let Ne=[],A=[];function ce(w){if(w.samples>0){if(se(w)===!1){let v=w.textures,P=w.width,O=w.height,J=i.COLOR_BUFFER_BIT,V=w.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,fe=n.get(w),le=v.length>1;if(le)for(let be=0;be<v.length;be++)t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,fe.__webglMultisampledFramebuffer);let Se=w.texture.mipmaps;Se&&Se.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglFramebuffer);for(let be=0;be<v.length;be++){if(w.resolveDepthBuffer&&(w.depthBuffer&&(J|=i.DEPTH_BUFFER_BIT),w.stencilBuffer&&w.resolveStencilBuffer&&(J|=i.STENCIL_BUFFER_BIT)),le){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,fe.__webglColorRenderbuffer[be]);let Q=n.get(v[be]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Q,0)}i.blitFramebuffer(0,0,P,O,0,0,P,O,J,i.NEAREST),l===!0&&(Ne.length=0,A.length=0,Ne.push(i.COLOR_ATTACHMENT0+be),w.depthBuffer&&w.resolveDepthBuffer===!1&&(Ne.push(V),A.push(V),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,A)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,Ne))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),le)for(let be=0;be<v.length;be++){t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.RENDERBUFFER,fe.__webglColorRenderbuffer[be]);let Q=n.get(v[be]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,fe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+be,i.TEXTURE_2D,Q,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,fe.__webglMultisampledFramebuffer)}else if(w.depthBuffer&&w.resolveDepthBuffer===!1&&l){let v=w.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[v])}}}function ne(w){return Math.min(s.maxSamples,w.samples)}function se(w){let v=n.get(w);return w.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function B(w){let v=o.render.frame;h.get(w)!==v&&(h.set(w,v),w.update())}function ie(w,v){let P=w.colorSpace,O=w.format,J=w.type;return w.isCompressedTexture===!0||w.isVideoTexture===!0||P!==gi&&P!==Hn&&(Ze.getTransfer(P)===tt?(O!==en||J!==pn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",P)),v}function K(w){return typeof HTMLImageElement<"u"&&w instanceof HTMLImageElement?(c.width=w.naturalWidth||w.width,c.height=w.naturalHeight||w.height):typeof VideoFrame<"u"&&w instanceof VideoFrame?(c.width=w.displayWidth,c.height=w.displayHeight):(c.width=w.width,c.height=w.height),c}this.allocateTextureUnit=z,this.resetTextureUnits=H,this.setTexture2D=G,this.setTexture2DArray=Z,this.setTexture3D=j,this.setTextureCube=q,this.rebindTextures=Re,this.setupRenderTarget=nt,this.updateRenderTargetMipmap=qe,this.updateMultisampleRenderTarget=ce,this.setupDepthRenderbuffer=Ue,this.setupFrameBufferTexture=xe,this.useMultisampledRTT=se}function y0(i,e){function t(n,s=Hn){let r,o=Ze.getTransfer(s);if(n===pn)return i.UNSIGNED_BYTE;if(n===Go)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Ho)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Ml)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===vl)return i.BYTE;if(n===yl)return i.SHORT;if(n===ds)return i.UNSIGNED_SHORT;if(n===Vo)return i.INT;if(n===ii)return i.UNSIGNED_INT;if(n===mn)return i.FLOAT;if(n===si)return i.HALF_FLOAT;if(n===Sl)return i.ALPHA;if(n===bl)return i.RGB;if(n===en)return i.RGBA;if(n===ji)return i.DEPTH_COMPONENT;if(n===ps)return i.DEPTH_STENCIL;if(n===Wo)return i.RED;if(n===Xo)return i.RED_INTEGER;if(n===Tl)return i.RG;if(n===qo)return i.RG_INTEGER;if(n===Yo)return i.RGBA_INTEGER;if(n===gr||n===_r||n===xr||n===vr)if(o===tt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===gr)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===_r)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===xr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===vr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===gr)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===_r)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===xr)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===vr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Zo||n===Jo||n===Ko||n===$o)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===Zo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Jo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Ko)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===$o)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Qo||n===jo||n===ea)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Qo||n===jo)return o===tt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ea)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===ta||n===na||n===ia||n===sa||n===ra||n===oa||n===aa||n===la||n===ca||n===ha||n===ua||n===da||n===fa||n===pa)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===ta)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===na)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===ia)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===sa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===ra)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===oa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===aa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===la)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===ca)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===ha)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===ua)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===da)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===fa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===pa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===yr||n===ma||n===ga)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===yr)return o===tt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===ma)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===ga)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===wl||n===_a||n===xa||n===va)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===yr)return r.COMPRESSED_RED_RGTC1_EXT;if(n===_a)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===xa)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===va)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===fs?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var M0=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,S0=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Zl=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){let s=new Et,r=e.properties.get(s);r.__webglTexture=t.texture,(t.depthNear!==n.depthNear||t.depthFar!==n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=s}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new vt({vertexShader:M0,fragmentShader:S0,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new ft(new Tn(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Jl=class extends On{constructor(e,t){super();let n=this,s=null,r=1,o=null,a="local-floor",l=1,c=null,h=null,u=null,d=null,f=null,g=null,x=new Zl,m=t.getContextAttributes(),p=null,T=null,y=[],_=[],C=new te,E=null,R=new Pt;R.viewport=new ut;let I=new Pt;I.viewport=new ut;let S=[R,I],M=new Co,L=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function($){let ae=y[$];return ae===void 0&&(ae=new ns,y[$]=ae),ae.getTargetRaySpace()},this.getControllerGrip=function($){let ae=y[$];return ae===void 0&&(ae=new ns,y[$]=ae),ae.getGripSpace()},this.getHand=function($){let ae=y[$];return ae===void 0&&(ae=new ns,y[$]=ae),ae.getHandSpace()};function z($){let ae=_.indexOf($.inputSource);if(ae===-1)return;let xe=y[ae];xe!==void 0&&(xe.update($.inputSource,$.frame,c||o),xe.dispatchEvent({type:$.type,data:$.inputSource}))}function k(){s.removeEventListener("select",z),s.removeEventListener("selectstart",z),s.removeEventListener("selectend",z),s.removeEventListener("squeeze",z),s.removeEventListener("squeezestart",z),s.removeEventListener("squeezeend",z),s.removeEventListener("end",k),s.removeEventListener("inputsourceschange",G);for(let $=0;$<y.length;$++){let ae=_[$];ae!==null&&(_[$]=null,y[$].disconnect(ae))}L=null,H=null,x.reset(),e.setRenderTarget(p),f=null,d=null,u=null,s=null,T=null,He.stop(),n.isPresenting=!1,e.setPixelRatio(E),e.setSize(C.width,C.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function($){r=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function($){a=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function($){c=$},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function($){if(s=$,s!==null){if(p=e.getRenderTarget(),s.addEventListener("select",z),s.addEventListener("selectstart",z),s.addEventListener("selectend",z),s.addEventListener("squeeze",z),s.addEventListener("squeezestart",z),s.addEventListener("squeezeend",z),s.addEventListener("end",k),s.addEventListener("inputsourceschange",G),m.xrCompatible!==!0&&await t.makeXRCompatible(),E=e.getPixelRatio(),e.getSize(C),typeof XRWebGLBinding<"u"&&"createProjectionLayer"in XRWebGLBinding.prototype){let xe=null,de=null,Ae=null;m.depth&&(Ae=m.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,xe=m.stencil?ps:ji,de=m.stencil?fs:ii);let Ue={colorFormat:t.RGBA8,depthFormat:Ae,scaleFactor:r};u=new XRWebGLBinding(s,t),d=u.createProjectionLayer(Ue),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),T=new jt(d.textureWidth,d.textureHeight,{format:en,type:pn,depthTexture:new Ks(d.textureWidth,d.textureHeight,de,void 0,void 0,void 0,void 0,void 0,void 0,xe),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{let xe={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,xe),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),T=new jt(f.framebufferWidth,f.framebufferHeight,{format:en,type:pn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}T.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),He.setContext(s),He.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return x.getDepthTexture()};function G($){for(let ae=0;ae<$.removed.length;ae++){let xe=$.removed[ae],de=_.indexOf(xe);de>=0&&(_[de]=null,y[de].disconnect(xe))}for(let ae=0;ae<$.added.length;ae++){let xe=$.added[ae],de=_.indexOf(xe);if(de===-1){for(let Ue=0;Ue<y.length;Ue++)if(Ue>=_.length){_.push(xe),de=Ue;break}else if(_[Ue]===null){_[Ue]=xe,de=Ue;break}if(de===-1)break}let Ae=y[de];Ae&&Ae.connect(xe)}}let Z=new D,j=new D;function q($,ae,xe){Z.setFromMatrixPosition(ae.matrixWorld),j.setFromMatrixPosition(xe.matrixWorld);let de=Z.distanceTo(j),Ae=ae.projectionMatrix.elements,Ue=xe.projectionMatrix.elements,Re=Ae[14]/(Ae[10]-1),nt=Ae[14]/(Ae[10]+1),qe=(Ae[9]+1)/Ae[5],Ne=(Ae[9]-1)/Ae[5],A=(Ae[8]-1)/Ae[0],ce=(Ue[8]+1)/Ue[0],ne=Re*A,se=Re*ce,B=de/(-A+ce),ie=B*-A;if(ae.matrixWorld.decompose($.position,$.quaternion,$.scale),$.translateX(ie),$.translateZ(B),$.matrixWorld.compose($.position,$.quaternion,$.scale),$.matrixWorldInverse.copy($.matrixWorld).invert(),Ae[10]===-1)$.projectionMatrix.copy(ae.projectionMatrix),$.projectionMatrixInverse.copy(ae.projectionMatrixInverse);else{let K=Re+B,w=nt+B,v=ne-ie,P=se+(de-ie),O=qe*nt/w*K,J=Ne*nt/w*K;$.projectionMatrix.makePerspective(v,P,O,J,K,w),$.projectionMatrixInverse.copy($.projectionMatrix).invert()}}function oe($,ae){ae===null?$.matrixWorld.copy($.matrix):$.matrixWorld.multiplyMatrices(ae.matrixWorld,$.matrix),$.matrixWorldInverse.copy($.matrixWorld).invert()}this.updateCamera=function($){if(s===null)return;let ae=$.near,xe=$.far;x.texture!==null&&(x.depthNear>0&&(ae=x.depthNear),x.depthFar>0&&(xe=x.depthFar)),M.near=I.near=R.near=ae,M.far=I.far=R.far=xe,(L!==M.near||H!==M.far)&&(s.updateRenderState({depthNear:M.near,depthFar:M.far}),L=M.near,H=M.far),R.layers.mask=$.layers.mask|2,I.layers.mask=$.layers.mask|4,M.layers.mask=R.layers.mask|I.layers.mask;let de=$.parent,Ae=M.cameras;oe(M,de);for(let Ue=0;Ue<Ae.length;Ue++)oe(Ae[Ue],de);Ae.length===2?q(M,R,I):M.projectionMatrix.copy(R.projectionMatrix),me($,M,de)};function me($,ae,xe){xe===null?$.matrix.copy(ae.matrixWorld):($.matrix.copy(xe.matrixWorld),$.matrix.invert(),$.matrix.multiply(ae.matrixWorld)),$.matrix.decompose($.position,$.quaternion,$.scale),$.updateMatrixWorld(!0),$.projectionMatrix.copy(ae.projectionMatrix),$.projectionMatrixInverse.copy(ae.projectionMatrixInverse),$.isPerspectiveCamera&&($.fov=es*2*Math.atan(1/$.projectionMatrix.elements[5]),$.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(d===null&&f===null))return l},this.setFoveation=function($){l=$,d!==null&&(d.fixedFoveation=$),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=$)},this.hasDepthSensing=function(){return x.texture!==null},this.getDepthSensingMesh=function(){return x.getMesh(M)};let Me=null;function Pe($,ae){if(h=ae.getViewerPose(c||o),g=ae,h!==null){let xe=h.views;f!==null&&(e.setRenderTargetFramebuffer(T,f.framebuffer),e.setRenderTarget(T));let de=!1;xe.length!==M.cameras.length&&(M.cameras.length=0,de=!0);for(let Re=0;Re<xe.length;Re++){let nt=xe[Re],qe=null;if(f!==null)qe=f.getViewport(nt);else{let A=u.getViewSubImage(d,nt);qe=A.viewport,Re===0&&(e.setRenderTargetTextures(T,A.colorTexture,A.depthStencilTexture),e.setRenderTarget(T))}let Ne=S[Re];Ne===void 0&&(Ne=new Pt,Ne.layers.enable(Re),Ne.viewport=new ut,S[Re]=Ne),Ne.matrix.fromArray(nt.transform.matrix),Ne.matrix.decompose(Ne.position,Ne.quaternion,Ne.scale),Ne.projectionMatrix.fromArray(nt.projectionMatrix),Ne.projectionMatrixInverse.copy(Ne.projectionMatrix).invert(),Ne.viewport.set(qe.x,qe.y,qe.width,qe.height),Re===0&&(M.matrix.copy(Ne.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),de===!0&&M.cameras.push(Ne)}let Ae=s.enabledFeatures;if(Ae&&Ae.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&u){let Re=u.getDepthInformation(xe[0]);Re&&Re.isValid&&Re.texture&&x.init(e,Re,s.renderState)}}for(let xe=0;xe<y.length;xe++){let de=_[xe],Ae=y[xe];de!==null&&Ae!==void 0&&Ae.update(de,ae,c||o)}Me&&Me($,ae),ae.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ae}),g=null}let He=new iu;He.setAnimationLoop(Pe),this.setAnimationLoop=function($){Me=$},this.dispose=function(){}}},Ri=new un,b0=new st;function T0(i,e){function t(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function n(m,p){p.color.getRGB(m.fogColor.value,Pl(i)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function s(m,p,T,y,_){p.isMeshBasicMaterial||p.isMeshLambertMaterial?r(m,p):p.isMeshToonMaterial?(r(m,p),u(m,p)):p.isMeshPhongMaterial?(r(m,p),h(m,p)):p.isMeshStandardMaterial?(r(m,p),d(m,p),p.isMeshPhysicalMaterial&&f(m,p,_)):p.isMeshMatcapMaterial?(r(m,p),g(m,p)):p.isMeshDepthMaterial?r(m,p):p.isMeshDistanceMaterial?(r(m,p),x(m,p)):p.isMeshNormalMaterial?r(m,p):p.isLineBasicMaterial?(o(m,p),p.isLineDashedMaterial&&a(m,p)):p.isPointsMaterial?l(m,p,T,y):p.isSpriteMaterial?c(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,t(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Ot&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,t(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Ot&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,t(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,t(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);let T=e.get(p),y=T.envMap,_=T.envMapRotation;y&&(m.envMap.value=y,Ri.copy(_),Ri.x*=-1,Ri.y*=-1,Ri.z*=-1,y.isCubeTexture&&y.isRenderTargetTexture===!1&&(Ri.y*=-1,Ri.z*=-1),m.envMapRotation.value.setFromMatrix4(b0.makeRotationFromEuler(Ri)),m.flipEnvMap.value=y.isCubeTexture&&y.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,m.aoMapTransform))}function o(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform))}function a(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function l(m,p,T,y){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*T,m.scale.value=y*.5,p.map&&(m.map.value=p.map,t(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function c(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function u(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function d(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,T){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Ot&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=T.texture,m.transmissionSamplerSize.value.set(T.width,T.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,p){p.matcap&&(m.matcap.value=p.matcap)}function x(m,p){let T=e.get(p).light;m.referencePosition.value.setFromMatrixPosition(T.matrixWorld),m.nearDistance.value=T.shadow.camera.near,m.farDistance.value=T.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function w0(i,e,t,n){let s={},r={},o=[],a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(T,y){let _=y.program;n.uniformBlockBinding(T,_)}function c(T,y){let _=s[T.id];_===void 0&&(g(T),_=h(T),s[T.id]=_,T.addEventListener("dispose",m));let C=y.program;n.updateUBOMapping(T,C);let E=e.render.frame;r[T.id]!==E&&(d(T),r[T.id]=E)}function h(T){let y=u();T.__bindingPointIndex=y;let _=i.createBuffer(),C=T.__size,E=T.usage;return i.bindBuffer(i.UNIFORM_BUFFER,_),i.bufferData(i.UNIFORM_BUFFER,C,E),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,y,_),_}function u(){for(let T=0;T<a;T++)if(o.indexOf(T)===-1)return o.push(T),T;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(T){let y=s[T.id],_=T.uniforms,C=T.__cache;i.bindBuffer(i.UNIFORM_BUFFER,y);for(let E=0,R=_.length;E<R;E++){let I=Array.isArray(_[E])?_[E]:[_[E]];for(let S=0,M=I.length;S<M;S++){let L=I[S];if(f(L,E,S,C)===!0){let H=L.__offset,z=Array.isArray(L.value)?L.value:[L.value],k=0;for(let G=0;G<z.length;G++){let Z=z[G],j=x(Z);typeof Z=="number"||typeof Z=="boolean"?(L.__data[0]=Z,i.bufferSubData(i.UNIFORM_BUFFER,H+k,L.__data)):Z.isMatrix3?(L.__data[0]=Z.elements[0],L.__data[1]=Z.elements[1],L.__data[2]=Z.elements[2],L.__data[3]=0,L.__data[4]=Z.elements[3],L.__data[5]=Z.elements[4],L.__data[6]=Z.elements[5],L.__data[7]=0,L.__data[8]=Z.elements[6],L.__data[9]=Z.elements[7],L.__data[10]=Z.elements[8],L.__data[11]=0):(Z.toArray(L.__data,k),k+=j.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,H,L.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(T,y,_,C){let E=T.value,R=y+"_"+_;if(C[R]===void 0)return typeof E=="number"||typeof E=="boolean"?C[R]=E:C[R]=E.clone(),!0;{let I=C[R];if(typeof E=="number"||typeof E=="boolean"){if(I!==E)return C[R]=E,!0}else if(I.equals(E)===!1)return I.copy(E),!0}return!1}function g(T){let y=T.uniforms,_=0,C=16;for(let R=0,I=y.length;R<I;R++){let S=Array.isArray(y[R])?y[R]:[y[R]];for(let M=0,L=S.length;M<L;M++){let H=S[M],z=Array.isArray(H.value)?H.value:[H.value];for(let k=0,G=z.length;k<G;k++){let Z=z[k],j=x(Z),q=_%C,oe=q%j.boundary,me=q+oe;_+=oe,me!==0&&C-me<j.storage&&(_+=C-me),H.__data=new Float32Array(j.storage/Float32Array.BYTES_PER_ELEMENT),H.__offset=_,_+=j.storage}}}let E=_%C;return E>0&&(_+=C-E),T.__size=_,T.__cache={},this}function x(T){let y={boundary:0,storage:0};return typeof T=="number"||typeof T=="boolean"?(y.boundary=4,y.storage=4):T.isVector2?(y.boundary=8,y.storage=8):T.isVector3||T.isColor?(y.boundary=16,y.storage=12):T.isVector4?(y.boundary=16,y.storage=16):T.isMatrix3?(y.boundary=48,y.storage=48):T.isMatrix4?(y.boundary=64,y.storage=64):T.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",T),y}function m(T){let y=T.target;y.removeEventListener("dispose",m);let _=o.indexOf(y.__bindingPointIndex);o.splice(_,1),i.deleteBuffer(s[y.id]),delete s[y.id],delete r[y.id]}function p(){for(let T in s)i.deleteBuffer(s[T]);o=[],s={},r={}}return{bind:l,update:c,dispose:p}}var ba=class{constructor(e={}){let{canvas:t=Sh(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reverseDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let f;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");f=n.getContextAttributes().alpha}else f=o;let g=new Uint32Array(4),x=new Int32Array(4),m=null,p=null,T=[],y=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Gn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let _=this,C=!1;this._outputColorSpace=bt;let E=0,R=0,I=null,S=-1,M=null,L=new ut,H=new ut,z=null,k=new Ie(0),G=0,Z=t.width,j=t.height,q=1,oe=null,me=null,Me=new ut(0,0,Z,j),Pe=new ut(0,0,Z,j),He=!1,$=new rs,ae=!1,xe=!1,de=new st,Ae=new st,Ue=new D,Re=new ut,nt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},qe=!1;function Ne(){return I===null?q:1}let A=n;function ce(b,N){return t.getContext(b,N)}try{let b={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"176"}`),t.addEventListener("webglcontextlost",ee,!1),t.addEventListener("webglcontextrestored",_e,!1),t.addEventListener("webglcontextcreationerror",pe,!1),A===null){let N="webgl2";if(A=ce(N,b),A===null)throw ce(N)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(b){throw console.error("THREE.WebGLRenderer: "+b.message),b}let ne,se,B,ie,K,w,v,P,O,J,V,fe,le,Se,be,Q,he,Te,Ce,ve,ze,ke,Ke,U;function ue(){ne=new Hm(A),ne.init(),ke=new y0(A,ne),se=new Fm(A,ne,e,ke),B=new x0(A,ne),se.reverseDepthBuffer&&d&&B.buffers.depth.setReversed(!0),ie=new qm(A),K=new r0,w=new v0(A,ne,B,K,se,ke,ie),v=new Bm(_),P=new Gm(_),O=new $d(A),Ke=new Um(A,O),J=new Wm(A,O,ie,Ke),V=new Zm(A,J,O,ie),Ce=new Ym(A,se,w),Q=new Om(K),fe=new s0(_,v,P,ne,se,Ke,Q),le=new T0(_,K),Se=new a0,be=new f0(ne),Te=new Dm(_,v,P,B,V,f,l),he=new g0(_,V,se),U=new w0(A,ie,se,B),ve=new Nm(A,ne,ie),ze=new Xm(A,ne,ie),ie.programs=fe.programs,_.capabilities=se,_.extensions=ne,_.properties=K,_.renderLists=Se,_.shadowMap=he,_.state=B,_.info=ie}ue();let Y=new Jl(_,A);this.xr=Y,this.getContext=function(){return A},this.getContextAttributes=function(){return A.getContextAttributes()},this.forceContextLoss=function(){let b=ne.get("WEBGL_lose_context");b&&b.loseContext()},this.forceContextRestore=function(){let b=ne.get("WEBGL_lose_context");b&&b.restoreContext()},this.getPixelRatio=function(){return q},this.setPixelRatio=function(b){b!==void 0&&(q=b,this.setSize(Z,j,!1))},this.getSize=function(b){return b.set(Z,j)},this.setSize=function(b,N,W=!0){if(Y.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}Z=b,j=N,t.width=Math.floor(b*q),t.height=Math.floor(N*q),W===!0&&(t.style.width=b+"px",t.style.height=N+"px"),this.setViewport(0,0,b,N)},this.getDrawingBufferSize=function(b){return b.set(Z*q,j*q).floor()},this.setDrawingBufferSize=function(b,N,W){Z=b,j=N,q=W,t.width=Math.floor(b*W),t.height=Math.floor(N*W),this.setViewport(0,0,b,N)},this.getCurrentViewport=function(b){return b.copy(L)},this.getViewport=function(b){return b.copy(Me)},this.setViewport=function(b,N,W,X){b.isVector4?Me.set(b.x,b.y,b.z,b.w):Me.set(b,N,W,X),B.viewport(L.copy(Me).multiplyScalar(q).round())},this.getScissor=function(b){return b.copy(Pe)},this.setScissor=function(b,N,W,X){b.isVector4?Pe.set(b.x,b.y,b.z,b.w):Pe.set(b,N,W,X),B.scissor(H.copy(Pe).multiplyScalar(q).round())},this.getScissorTest=function(){return He},this.setScissorTest=function(b){B.setScissorTest(He=b)},this.setOpaqueSort=function(b){oe=b},this.setTransparentSort=function(b){me=b},this.getClearColor=function(b){return b.copy(Te.getClearColor())},this.setClearColor=function(){Te.setClearColor(...arguments)},this.getClearAlpha=function(){return Te.getClearAlpha()},this.setClearAlpha=function(){Te.setClearAlpha(...arguments)},this.clear=function(b=!0,N=!0,W=!0){let X=0;if(b){let F=!1;if(I!==null){let re=I.texture.format;F=re===Yo||re===qo||re===Xo}if(F){let re=I.texture.type,ye=re===pn||re===ii||re===ds||re===fs||re===Go||re===Ho,we=Te.getClearColor(),Ee=Te.getClearAlpha(),Be=we.r,Fe=we.g,Le=we.b;ye?(g[0]=Be,g[1]=Fe,g[2]=Le,g[3]=Ee,A.clearBufferuiv(A.COLOR,0,g)):(x[0]=Be,x[1]=Fe,x[2]=Le,x[3]=Ee,A.clearBufferiv(A.COLOR,0,x))}else X|=A.COLOR_BUFFER_BIT}N&&(X|=A.DEPTH_BUFFER_BIT),W&&(X|=A.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),A.clear(X)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",ee,!1),t.removeEventListener("webglcontextrestored",_e,!1),t.removeEventListener("webglcontextcreationerror",pe,!1),Te.dispose(),Se.dispose(),be.dispose(),K.dispose(),v.dispose(),P.dispose(),V.dispose(),Ke.dispose(),U.dispose(),fe.dispose(),Y.dispose(),Y.removeEventListener("sessionstart",nc),Y.removeEventListener("sessionend",ic),oi.stop()};function ee(b){b.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),C=!0}function _e(){console.log("THREE.WebGLRenderer: Context Restored."),C=!1;let b=ie.autoReset,N=he.enabled,W=he.autoUpdate,X=he.needsUpdate,F=he.type;ue(),ie.autoReset=b,he.enabled=N,he.autoUpdate=W,he.needsUpdate=X,he.type=F}function pe(b){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",b.statusMessage)}function Oe(b){let N=b.target;N.removeEventListener("dispose",Oe),lt(N)}function lt(b){Ct(b),K.remove(b)}function Ct(b){let N=K.get(b).programs;N!==void 0&&(N.forEach(function(W){fe.releaseProgram(W)}),b.isShaderMaterial&&fe.releaseShaderCache(b))}this.renderBufferDirect=function(b,N,W,X,F,re){N===null&&(N=nt);let ye=F.isMesh&&F.matrixWorld.determinant()<0,we=wu(b,N,W,X,F);B.setMaterial(X,ye);let Ee=W.index,Be=1;if(X.wireframe===!0){if(Ee=J.getWireframeAttribute(W),Ee===void 0)return;Be=2}let Fe=W.drawRange,Le=W.attributes.position,Ye=Fe.start*Be,$e=(Fe.start+Fe.count)*Be;re!==null&&(Ye=Math.max(Ye,re.start*Be),$e=Math.min($e,(re.start+re.count)*Be)),Ee!==null?(Ye=Math.max(Ye,0),$e=Math.min($e,Ee.count)):Le!=null&&(Ye=Math.max(Ye,0),$e=Math.min($e,Le.count));let _t=$e-Ye;if(_t<0||_t===1/0)return;Ke.setup(F,X,we,W,Ee);let dt,Je=ve;if(Ee!==null&&(dt=O.get(Ee),Je=ze,Je.setIndex(dt)),F.isMesh)X.wireframe===!0?(B.setLineWidth(X.wireframeLinewidth*Ne()),Je.setMode(A.LINES)):Je.setMode(A.TRIANGLES);else if(F.isLine){let De=X.linewidth;De===void 0&&(De=1),B.setLineWidth(De*Ne()),F.isLineSegments?Je.setMode(A.LINES):F.isLineLoop?Je.setMode(A.LINE_LOOP):Je.setMode(A.LINE_STRIP)}else F.isPoints?Je.setMode(A.POINTS):F.isSprite&&Je.setMode(A.TRIANGLES);if(F.isBatchedMesh)if(F._multiDrawInstances!==null)Mr("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),Je.renderMultiDrawInstances(F._multiDrawStarts,F._multiDrawCounts,F._multiDrawCount,F._multiDrawInstances);else if(ne.get("WEBGL_multi_draw"))Je.renderMultiDraw(F._multiDrawStarts,F._multiDrawCounts,F._multiDrawCount);else{let De=F._multiDrawStarts,wt=F._multiDrawCounts,Qe=F._multiDrawCount,rn=Ee?O.get(Ee).bytesPerElement:1,Ui=K.get(X).currentProgram.getUniforms();for(let Xt=0;Xt<Qe;Xt++)Ui.setValue(A,"_gl_DrawID",Xt),Je.render(De[Xt]/rn,wt[Xt])}else if(F.isInstancedMesh)Je.renderInstances(Ye,_t,F.count);else if(W.isInstancedBufferGeometry){let De=W._maxInstanceCount!==void 0?W._maxInstanceCount:1/0,wt=Math.min(W.instanceCount,De);Je.renderInstances(Ye,_t,wt)}else Je.render(Ye,_t)};function je(b,N,W){b.transparent===!0&&b.side===pt&&b.forceSinglePass===!1?(b.side=Ot,b.needsUpdate=!0,Er(b,N,W),b.side=Fn,b.needsUpdate=!0,Er(b,N,W),b.side=pt):Er(b,N,W)}this.compile=function(b,N,W=null){W===null&&(W=b),p=be.get(W),p.init(N),y.push(p),W.traverseVisible(function(F){F.isLight&&F.layers.test(N.layers)&&(p.pushLight(F),F.castShadow&&p.pushShadow(F))}),b!==W&&b.traverseVisible(function(F){F.isLight&&F.layers.test(N.layers)&&(p.pushLight(F),F.castShadow&&p.pushShadow(F))}),p.setupLights();let X=new Set;return b.traverse(function(F){if(!(F.isMesh||F.isPoints||F.isLine||F.isSprite))return;let re=F.material;if(re)if(Array.isArray(re))for(let ye=0;ye<re.length;ye++){let we=re[ye];je(we,W,F),X.add(we)}else je(re,W,F),X.add(re)}),p=y.pop(),X},this.compileAsync=function(b,N,W=null){let X=this.compile(b,N,W);return new Promise(F=>{function re(){if(X.forEach(function(ye){K.get(ye).currentProgram.isReady()&&X.delete(ye)}),X.size===0){F(b);return}setTimeout(re,10)}ne.get("KHR_parallel_shader_compile")!==null?re():setTimeout(re,10)})};let sn=null;function Cn(b){sn&&sn(b)}function nc(){oi.stop()}function ic(){oi.start()}let oi=new iu;oi.setAnimationLoop(Cn),typeof self<"u"&&oi.setContext(self),this.setAnimationLoop=function(b){sn=b,Y.setAnimationLoop(b),b===null?oi.stop():oi.start()},Y.addEventListener("sessionstart",nc),Y.addEventListener("sessionend",ic),this.render=function(b,N){if(N!==void 0&&N.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(C===!0)return;if(b.matrixWorldAutoUpdate===!0&&b.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),Y.enabled===!0&&Y.isPresenting===!0&&(Y.cameraAutoUpdate===!0&&Y.updateCamera(N),N=Y.getCamera()),b.isScene===!0&&b.onBeforeRender(_,b,N,I),p=be.get(b,y.length),p.init(N),y.push(p),Ae.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),$.setFromProjectionMatrix(Ae),xe=this.localClippingEnabled,ae=Q.init(this.clippingPlanes,xe),m=Se.get(b,T.length),m.init(),T.push(m),Y.enabled===!0&&Y.isPresenting===!0){let re=_.xr.getDepthSensingMesh();re!==null&&Ia(re,N,-1/0,_.sortObjects)}Ia(b,N,0,_.sortObjects),m.finish(),_.sortObjects===!0&&m.sort(oe,me),qe=Y.enabled===!1||Y.isPresenting===!1||Y.hasDepthSensing()===!1,qe&&Te.addToRenderList(m,b),this.info.render.frame++,ae===!0&&Q.beginShadows();let W=p.state.shadowsArray;he.render(W,b,N),ae===!0&&Q.endShadows(),this.info.autoReset===!0&&this.info.reset();let X=m.opaque,F=m.transmissive;if(p.setupLights(),N.isArrayCamera){let re=N.cameras;if(F.length>0)for(let ye=0,we=re.length;ye<we;ye++){let Ee=re[ye];rc(X,F,b,Ee)}qe&&Te.render(b);for(let ye=0,we=re.length;ye<we;ye++){let Ee=re[ye];sc(m,b,Ee,Ee.viewport)}}else F.length>0&&rc(X,F,b,N),qe&&Te.render(b),sc(m,b,N);I!==null&&R===0&&(w.updateMultisampleRenderTarget(I),w.updateRenderTargetMipmap(I)),b.isScene===!0&&b.onAfterRender(_,b,N),Ke.resetDefaultState(),S=-1,M=null,y.pop(),y.length>0?(p=y[y.length-1],ae===!0&&Q.setGlobalState(_.clippingPlanes,p.state.camera)):p=null,T.pop(),T.length>0?m=T[T.length-1]:m=null};function Ia(b,N,W,X){if(b.visible===!1)return;if(b.layers.test(N.layers)){if(b.isGroup)W=b.renderOrder;else if(b.isLOD)b.autoUpdate===!0&&b.update(N);else if(b.isLight)p.pushLight(b),b.castShadow&&p.pushShadow(b);else if(b.isSprite){if(!b.frustumCulled||$.intersectsSprite(b)){X&&Re.setFromMatrixPosition(b.matrixWorld).applyMatrix4(Ae);let ye=V.update(b),we=b.material;we.visible&&m.push(b,ye,we,W,Re.z,null)}}else if((b.isMesh||b.isLine||b.isPoints)&&(!b.frustumCulled||$.intersectsObject(b))){let ye=V.update(b),we=b.material;if(X&&(b.boundingSphere!==void 0?(b.boundingSphere===null&&b.computeBoundingSphere(),Re.copy(b.boundingSphere.center)):(ye.boundingSphere===null&&ye.computeBoundingSphere(),Re.copy(ye.boundingSphere.center)),Re.applyMatrix4(b.matrixWorld).applyMatrix4(Ae)),Array.isArray(we)){let Ee=ye.groups;for(let Be=0,Fe=Ee.length;Be<Fe;Be++){let Le=Ee[Be],Ye=we[Le.materialIndex];Ye&&Ye.visible&&m.push(b,ye,Ye,W,Re.z,Le)}}else we.visible&&m.push(b,ye,we,W,Re.z,null)}}let re=b.children;for(let ye=0,we=re.length;ye<we;ye++)Ia(re[ye],N,W,X)}function sc(b,N,W,X){let F=b.opaque,re=b.transmissive,ye=b.transparent;p.setupLightsView(W),ae===!0&&Q.setGlobalState(_.clippingPlanes,W),X&&B.viewport(L.copy(X)),F.length>0&&wr(F,N,W),re.length>0&&wr(re,N,W),ye.length>0&&wr(ye,N,W),B.buffers.depth.setTest(!0),B.buffers.depth.setMask(!0),B.buffers.color.setMask(!0),B.setPolygonOffset(!1)}function rc(b,N,W,X){if((W.isScene===!0?W.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[X.id]===void 0&&(p.state.transmissionRenderTarget[X.id]=new jt(1,1,{generateMipmaps:!0,type:ne.has("EXT_color_buffer_half_float")||ne.has("EXT_color_buffer_float")?si:pn,minFilter:ni,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Ze.workingColorSpace}));let re=p.state.transmissionRenderTarget[X.id],ye=X.viewport||L;re.setSize(ye.z*_.transmissionResolutionScale,ye.w*_.transmissionResolutionScale);let we=_.getRenderTarget();_.setRenderTarget(re),_.getClearColor(k),G=_.getClearAlpha(),G<1&&_.setClearColor(16777215,.5),_.clear(),qe&&Te.render(W);let Ee=_.toneMapping;_.toneMapping=Gn;let Be=X.viewport;if(X.viewport!==void 0&&(X.viewport=void 0),p.setupLightsView(X),ae===!0&&Q.setGlobalState(_.clippingPlanes,X),wr(b,W,X),w.updateMultisampleRenderTarget(re),w.updateRenderTargetMipmap(re),ne.has("WEBGL_multisampled_render_to_texture")===!1){let Fe=!1;for(let Le=0,Ye=N.length;Le<Ye;Le++){let $e=N[Le],_t=$e.object,dt=$e.geometry,Je=$e.material,De=$e.group;if(Je.side===pt&&_t.layers.test(X.layers)){let wt=Je.side;Je.side=Ot,Je.needsUpdate=!0,oc(_t,W,X,dt,Je,De),Je.side=wt,Je.needsUpdate=!0,Fe=!0}}Fe===!0&&(w.updateMultisampleRenderTarget(re),w.updateRenderTargetMipmap(re))}_.setRenderTarget(we),_.setClearColor(k,G),Be!==void 0&&(X.viewport=Be),_.toneMapping=Ee}function wr(b,N,W){let X=N.isScene===!0?N.overrideMaterial:null;for(let F=0,re=b.length;F<re;F++){let ye=b[F],we=ye.object,Ee=ye.geometry,Be=ye.group,Fe=ye.material;Fe.allowOverride===!0&&X!==null&&(Fe=X),we.layers.test(W.layers)&&oc(we,N,W,Ee,Fe,Be)}}function oc(b,N,W,X,F,re){b.onBeforeRender(_,N,W,X,F,re),b.modelViewMatrix.multiplyMatrices(W.matrixWorldInverse,b.matrixWorld),b.normalMatrix.getNormalMatrix(b.modelViewMatrix),F.onBeforeRender(_,N,W,X,b,re),F.transparent===!0&&F.side===pt&&F.forceSinglePass===!1?(F.side=Ot,F.needsUpdate=!0,_.renderBufferDirect(W,N,X,F,b,re),F.side=Fn,F.needsUpdate=!0,_.renderBufferDirect(W,N,X,F,b,re),F.side=pt):_.renderBufferDirect(W,N,X,F,b,re),b.onAfterRender(_,N,W,X,F,re)}function Er(b,N,W){N.isScene!==!0&&(N=nt);let X=K.get(b),F=p.state.lights,re=p.state.shadowsArray,ye=F.state.version,we=fe.getParameters(b,F.state,re,N,W),Ee=fe.getProgramCacheKey(we),Be=X.programs;X.environment=b.isMeshStandardMaterial?N.environment:null,X.fog=N.fog,X.envMap=(b.isMeshStandardMaterial?P:v).get(b.envMap||X.environment),X.envMapRotation=X.environment!==null&&b.envMap===null?N.environmentRotation:b.envMapRotation,Be===void 0&&(b.addEventListener("dispose",Oe),Be=new Map,X.programs=Be);let Fe=Be.get(Ee);if(Fe!==void 0){if(X.currentProgram===Fe&&X.lightsStateVersion===ye)return lc(b,we),Fe}else we.uniforms=fe.getUniforms(b),b.onBeforeCompile(we,_),Fe=fe.acquireProgram(we,Ee),Be.set(Ee,Fe),X.uniforms=we.uniforms;let Le=X.uniforms;return(!b.isShaderMaterial&&!b.isRawShaderMaterial||b.clipping===!0)&&(Le.clippingPlanes=Q.uniform),lc(b,we),X.needsLights=Au(b),X.lightsStateVersion=ye,X.needsLights&&(Le.ambientLightColor.value=F.state.ambient,Le.lightProbe.value=F.state.probe,Le.directionalLights.value=F.state.directional,Le.directionalLightShadows.value=F.state.directionalShadow,Le.spotLights.value=F.state.spot,Le.spotLightShadows.value=F.state.spotShadow,Le.rectAreaLights.value=F.state.rectArea,Le.ltc_1.value=F.state.rectAreaLTC1,Le.ltc_2.value=F.state.rectAreaLTC2,Le.pointLights.value=F.state.point,Le.pointLightShadows.value=F.state.pointShadow,Le.hemisphereLights.value=F.state.hemi,Le.directionalShadowMap.value=F.state.directionalShadowMap,Le.directionalShadowMatrix.value=F.state.directionalShadowMatrix,Le.spotShadowMap.value=F.state.spotShadowMap,Le.spotLightMatrix.value=F.state.spotLightMatrix,Le.spotLightMap.value=F.state.spotLightMap,Le.pointShadowMap.value=F.state.pointShadowMap,Le.pointShadowMatrix.value=F.state.pointShadowMatrix),X.currentProgram=Fe,X.uniformsList=null,Fe}function ac(b){if(b.uniformsList===null){let N=b.currentProgram.getUniforms();b.uniformsList=_s.seqWithValue(N.seq,b.uniforms)}return b.uniformsList}function lc(b,N){let W=K.get(b);W.outputColorSpace=N.outputColorSpace,W.batching=N.batching,W.batchingColor=N.batchingColor,W.instancing=N.instancing,W.instancingColor=N.instancingColor,W.instancingMorph=N.instancingMorph,W.skinning=N.skinning,W.morphTargets=N.morphTargets,W.morphNormals=N.morphNormals,W.morphColors=N.morphColors,W.morphTargetsCount=N.morphTargetsCount,W.numClippingPlanes=N.numClippingPlanes,W.numIntersection=N.numClipIntersection,W.vertexAlphas=N.vertexAlphas,W.vertexTangents=N.vertexTangents,W.toneMapping=N.toneMapping}function wu(b,N,W,X,F){N.isScene!==!0&&(N=nt),w.resetTextureUnits();let re=N.fog,ye=X.isMeshStandardMaterial?N.environment:null,we=I===null?_.outputColorSpace:I.isXRRenderTarget===!0?I.texture.colorSpace:gi,Ee=(X.isMeshStandardMaterial?P:v).get(X.envMap||ye),Be=X.vertexColors===!0&&!!W.attributes.color&&W.attributes.color.itemSize===4,Fe=!!W.attributes.tangent&&(!!X.normalMap||X.anisotropy>0),Le=!!W.morphAttributes.position,Ye=!!W.morphAttributes.normal,$e=!!W.morphAttributes.color,_t=Gn;X.toneMapped&&(I===null||I.isXRRenderTarget===!0)&&(_t=_.toneMapping);let dt=W.morphAttributes.position||W.morphAttributes.normal||W.morphAttributes.color,Je=dt!==void 0?dt.length:0,De=K.get(X),wt=p.state.lights;if(ae===!0&&(xe===!0||b!==M)){let Ut=b===M&&X.id===S;Q.setState(X,b,Ut)}let Qe=!1;X.version===De.__version?(De.needsLights&&De.lightsStateVersion!==wt.state.version||De.outputColorSpace!==we||F.isBatchedMesh&&De.batching===!1||!F.isBatchedMesh&&De.batching===!0||F.isBatchedMesh&&De.batchingColor===!0&&F.colorTexture===null||F.isBatchedMesh&&De.batchingColor===!1&&F.colorTexture!==null||F.isInstancedMesh&&De.instancing===!1||!F.isInstancedMesh&&De.instancing===!0||F.isSkinnedMesh&&De.skinning===!1||!F.isSkinnedMesh&&De.skinning===!0||F.isInstancedMesh&&De.instancingColor===!0&&F.instanceColor===null||F.isInstancedMesh&&De.instancingColor===!1&&F.instanceColor!==null||F.isInstancedMesh&&De.instancingMorph===!0&&F.morphTexture===null||F.isInstancedMesh&&De.instancingMorph===!1&&F.morphTexture!==null||De.envMap!==Ee||X.fog===!0&&De.fog!==re||De.numClippingPlanes!==void 0&&(De.numClippingPlanes!==Q.numPlanes||De.numIntersection!==Q.numIntersection)||De.vertexAlphas!==Be||De.vertexTangents!==Fe||De.morphTargets!==Le||De.morphNormals!==Ye||De.morphColors!==$e||De.toneMapping!==_t||De.morphTargetsCount!==Je)&&(Qe=!0):(Qe=!0,De.__version=X.version);let rn=De.currentProgram;Qe===!0&&(rn=Er(X,N,F));let Ui=!1,Xt=!1,Ss=!1,ct=rn.getUniforms(),Kt=De.uniforms;if(B.useProgram(rn.program)&&(Ui=!0,Xt=!0,Ss=!0),X.id!==S&&(S=X.id,Xt=!0),Ui||M!==b){B.buffers.depth.getReversed()?(de.copy(b.projectionMatrix),Th(de),wh(de),ct.setValue(A,"projectionMatrix",de)):ct.setValue(A,"projectionMatrix",b.projectionMatrix),ct.setValue(A,"viewMatrix",b.matrixWorldInverse);let Vt=ct.map.cameraPosition;Vt!==void 0&&Vt.setValue(A,Ue.setFromMatrixPosition(b.matrixWorld)),se.logarithmicDepthBuffer&&ct.setValue(A,"logDepthBufFC",2/(Math.log(b.far+1)/Math.LN2)),(X.isMeshPhongMaterial||X.isMeshToonMaterial||X.isMeshLambertMaterial||X.isMeshBasicMaterial||X.isMeshStandardMaterial||X.isShaderMaterial)&&ct.setValue(A,"isOrthographic",b.isOrthographicCamera===!0),M!==b&&(M=b,Xt=!0,Ss=!0)}if(F.isSkinnedMesh){ct.setOptional(A,F,"bindMatrix"),ct.setOptional(A,F,"bindMatrixInverse");let Ut=F.skeleton;Ut&&(Ut.boneTexture===null&&Ut.computeBoneTexture(),ct.setValue(A,"boneTexture",Ut.boneTexture,w))}F.isBatchedMesh&&(ct.setOptional(A,F,"batchingTexture"),ct.setValue(A,"batchingTexture",F._matricesTexture,w),ct.setOptional(A,F,"batchingIdTexture"),ct.setValue(A,"batchingIdTexture",F._indirectTexture,w),ct.setOptional(A,F,"batchingColorTexture"),F._colorsTexture!==null&&ct.setValue(A,"batchingColorTexture",F._colorsTexture,w));let $t=W.morphAttributes;if(($t.position!==void 0||$t.normal!==void 0||$t.color!==void 0)&&Ce.update(F,W,rn),(Xt||De.receiveShadow!==F.receiveShadow)&&(De.receiveShadow=F.receiveShadow,ct.setValue(A,"receiveShadow",F.receiveShadow)),X.isMeshGouraudMaterial&&X.envMap!==null&&(Kt.envMap.value=Ee,Kt.flipEnvMap.value=Ee.isCubeTexture&&Ee.isRenderTargetTexture===!1?-1:1),X.isMeshStandardMaterial&&X.envMap===null&&N.environment!==null&&(Kt.envMapIntensity.value=N.environmentIntensity),Xt&&(ct.setValue(A,"toneMappingExposure",_.toneMappingExposure),De.needsLights&&Eu(Kt,Ss),re&&X.fog===!0&&le.refreshFogUniforms(Kt,re),le.refreshMaterialUniforms(Kt,X,q,j,p.state.transmissionRenderTarget[b.id]),_s.upload(A,ac(De),Kt,w)),X.isShaderMaterial&&X.uniformsNeedUpdate===!0&&(_s.upload(A,ac(De),Kt,w),X.uniformsNeedUpdate=!1),X.isSpriteMaterial&&ct.setValue(A,"center",F.center),ct.setValue(A,"modelViewMatrix",F.modelViewMatrix),ct.setValue(A,"normalMatrix",F.normalMatrix),ct.setValue(A,"modelMatrix",F.matrixWorld),X.isShaderMaterial||X.isRawShaderMaterial){let Ut=X.uniformsGroups;for(let Vt=0,Pa=Ut.length;Vt<Pa;Vt++){let ai=Ut[Vt];U.update(ai,rn),U.bind(ai,rn)}}return rn}function Eu(b,N){b.ambientLightColor.needsUpdate=N,b.lightProbe.needsUpdate=N,b.directionalLights.needsUpdate=N,b.directionalLightShadows.needsUpdate=N,b.pointLights.needsUpdate=N,b.pointLightShadows.needsUpdate=N,b.spotLights.needsUpdate=N,b.spotLightShadows.needsUpdate=N,b.rectAreaLights.needsUpdate=N,b.hemisphereLights.needsUpdate=N}function Au(b){return b.isMeshLambertMaterial||b.isMeshToonMaterial||b.isMeshPhongMaterial||b.isMeshStandardMaterial||b.isShadowMaterial||b.isShaderMaterial&&b.lights===!0}this.getActiveCubeFace=function(){return E},this.getActiveMipmapLevel=function(){return R},this.getRenderTarget=function(){return I},this.setRenderTargetTextures=function(b,N,W){let X=K.get(b);X.__autoAllocateDepthBuffer=b.resolveDepthBuffer===!1,X.__autoAllocateDepthBuffer===!1&&(X.__useRenderToTexture=!1),K.get(b.texture).__webglTexture=N,K.get(b.depthTexture).__webglTexture=X.__autoAllocateDepthBuffer?void 0:W,X.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(b,N){let W=K.get(b);W.__webglFramebuffer=N,W.__useDefaultFramebuffer=N===void 0};let Cu=A.createFramebuffer();this.setRenderTarget=function(b,N=0,W=0){I=b,E=N,R=W;let X=!0,F=null,re=!1,ye=!1;if(b){let Ee=K.get(b);if(Ee.__useDefaultFramebuffer!==void 0)B.bindFramebuffer(A.FRAMEBUFFER,null),X=!1;else if(Ee.__webglFramebuffer===void 0)w.setupRenderTarget(b);else if(Ee.__hasExternalTextures)w.rebindTextures(b,K.get(b.texture).__webglTexture,K.get(b.depthTexture).__webglTexture);else if(b.depthBuffer){let Le=b.depthTexture;if(Ee.__boundDepthTexture!==Le){if(Le!==null&&K.has(Le)&&(b.width!==Le.image.width||b.height!==Le.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");w.setupDepthRenderbuffer(b)}}let Be=b.texture;(Be.isData3DTexture||Be.isDataArrayTexture||Be.isCompressedArrayTexture)&&(ye=!0);let Fe=K.get(b).__webglFramebuffer;b.isWebGLCubeRenderTarget?(Array.isArray(Fe[N])?F=Fe[N][W]:F=Fe[N],re=!0):b.samples>0&&w.useMultisampledRTT(b)===!1?F=K.get(b).__webglMultisampledFramebuffer:Array.isArray(Fe)?F=Fe[W]:F=Fe,L.copy(b.viewport),H.copy(b.scissor),z=b.scissorTest}else L.copy(Me).multiplyScalar(q).floor(),H.copy(Pe).multiplyScalar(q).floor(),z=He;if(W!==0&&(F=Cu),B.bindFramebuffer(A.FRAMEBUFFER,F)&&X&&B.drawBuffers(b,F),B.viewport(L),B.scissor(H),B.setScissorTest(z),re){let Ee=K.get(b.texture);A.framebufferTexture2D(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_CUBE_MAP_POSITIVE_X+N,Ee.__webglTexture,W)}else if(ye){let Ee=K.get(b.texture),Be=N;A.framebufferTextureLayer(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0,Ee.__webglTexture,W,Be)}else if(b!==null&&W!==0){let Ee=K.get(b.texture);A.framebufferTexture2D(A.FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,Ee.__webglTexture,W)}S=-1},this.readRenderTargetPixels=function(b,N,W,X,F,re,ye){if(!(b&&b.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let we=K.get(b).__webglFramebuffer;if(b.isWebGLCubeRenderTarget&&ye!==void 0&&(we=we[ye]),we){B.bindFramebuffer(A.FRAMEBUFFER,we);try{let Ee=b.texture,Be=Ee.format,Fe=Ee.type;if(!se.textureFormatReadable(Be)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!se.textureTypeReadable(Fe)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=b.width-X&&W>=0&&W<=b.height-F&&A.readPixels(N,W,X,F,ke.convert(Be),ke.convert(Fe),re)}finally{let Ee=I!==null?K.get(I).__webglFramebuffer:null;B.bindFramebuffer(A.FRAMEBUFFER,Ee)}}},this.readRenderTargetPixelsAsync=async function(b,N,W,X,F,re,ye){if(!(b&&b.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let we=K.get(b).__webglFramebuffer;if(b.isWebGLCubeRenderTarget&&ye!==void 0&&(we=we[ye]),we)if(N>=0&&N<=b.width-X&&W>=0&&W<=b.height-F){B.bindFramebuffer(A.FRAMEBUFFER,we);let Ee=b.texture,Be=Ee.format,Fe=Ee.type;if(!se.textureFormatReadable(Be))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!se.textureTypeReadable(Fe))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Le=A.createBuffer();A.bindBuffer(A.PIXEL_PACK_BUFFER,Le),A.bufferData(A.PIXEL_PACK_BUFFER,re.byteLength,A.STREAM_READ),A.readPixels(N,W,X,F,ke.convert(Be),ke.convert(Fe),0);let Ye=I!==null?K.get(I).__webglFramebuffer:null;B.bindFramebuffer(A.FRAMEBUFFER,Ye);let $e=A.fenceSync(A.SYNC_GPU_COMMANDS_COMPLETE,0);return A.flush(),await bh(A,$e,4),A.bindBuffer(A.PIXEL_PACK_BUFFER,Le),A.getBufferSubData(A.PIXEL_PACK_BUFFER,0,re),A.deleteBuffer(Le),A.deleteSync($e),re}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(b,N=null,W=0){let X=Math.pow(2,-W),F=Math.floor(b.image.width*X),re=Math.floor(b.image.height*X),ye=N!==null?N.x:0,we=N!==null?N.y:0;w.setTexture2D(b,0),A.copyTexSubImage2D(A.TEXTURE_2D,W,0,0,ye,we,F,re),B.unbindTexture()};let Ru=A.createFramebuffer(),Iu=A.createFramebuffer();this.copyTextureToTexture=function(b,N,W=null,X=null,F=0,re=null){re===null&&(F!==0?(Mr("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),re=F,F=0):re=0);let ye,we,Ee,Be,Fe,Le,Ye,$e,_t,dt=b.isCompressedTexture?b.mipmaps[re]:b.image;if(W!==null)ye=W.max.x-W.min.x,we=W.max.y-W.min.y,Ee=W.isBox3?W.max.z-W.min.z:1,Be=W.min.x,Fe=W.min.y,Le=W.isBox3?W.min.z:0;else{let $t=Math.pow(2,-F);ye=Math.floor(dt.width*$t),we=Math.floor(dt.height*$t),b.isDataArrayTexture?Ee=dt.depth:b.isData3DTexture?Ee=Math.floor(dt.depth*$t):Ee=1,Be=0,Fe=0,Le=0}X!==null?(Ye=X.x,$e=X.y,_t=X.z):(Ye=0,$e=0,_t=0);let Je=ke.convert(N.format),De=ke.convert(N.type),wt;N.isData3DTexture?(w.setTexture3D(N,0),wt=A.TEXTURE_3D):N.isDataArrayTexture||N.isCompressedArrayTexture?(w.setTexture2DArray(N,0),wt=A.TEXTURE_2D_ARRAY):(w.setTexture2D(N,0),wt=A.TEXTURE_2D),A.pixelStorei(A.UNPACK_FLIP_Y_WEBGL,N.flipY),A.pixelStorei(A.UNPACK_PREMULTIPLY_ALPHA_WEBGL,N.premultiplyAlpha),A.pixelStorei(A.UNPACK_ALIGNMENT,N.unpackAlignment);let Qe=A.getParameter(A.UNPACK_ROW_LENGTH),rn=A.getParameter(A.UNPACK_IMAGE_HEIGHT),Ui=A.getParameter(A.UNPACK_SKIP_PIXELS),Xt=A.getParameter(A.UNPACK_SKIP_ROWS),Ss=A.getParameter(A.UNPACK_SKIP_IMAGES);A.pixelStorei(A.UNPACK_ROW_LENGTH,dt.width),A.pixelStorei(A.UNPACK_IMAGE_HEIGHT,dt.height),A.pixelStorei(A.UNPACK_SKIP_PIXELS,Be),A.pixelStorei(A.UNPACK_SKIP_ROWS,Fe),A.pixelStorei(A.UNPACK_SKIP_IMAGES,Le);let ct=b.isDataArrayTexture||b.isData3DTexture,Kt=N.isDataArrayTexture||N.isData3DTexture;if(b.isDepthTexture){let $t=K.get(b),Ut=K.get(N),Vt=K.get($t.__renderTarget),Pa=K.get(Ut.__renderTarget);B.bindFramebuffer(A.READ_FRAMEBUFFER,Vt.__webglFramebuffer),B.bindFramebuffer(A.DRAW_FRAMEBUFFER,Pa.__webglFramebuffer);for(let ai=0;ai<Ee;ai++)ct&&(A.framebufferTextureLayer(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,K.get(b).__webglTexture,F,Le+ai),A.framebufferTextureLayer(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,K.get(N).__webglTexture,re,_t+ai)),A.blitFramebuffer(Be,Fe,ye,we,Ye,$e,ye,we,A.DEPTH_BUFFER_BIT,A.NEAREST);B.bindFramebuffer(A.READ_FRAMEBUFFER,null),B.bindFramebuffer(A.DRAW_FRAMEBUFFER,null)}else if(F!==0||b.isRenderTargetTexture||K.has(b)){let $t=K.get(b),Ut=K.get(N);B.bindFramebuffer(A.READ_FRAMEBUFFER,Ru),B.bindFramebuffer(A.DRAW_FRAMEBUFFER,Iu);for(let Vt=0;Vt<Ee;Vt++)ct?A.framebufferTextureLayer(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,$t.__webglTexture,F,Le+Vt):A.framebufferTexture2D(A.READ_FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,$t.__webglTexture,F),Kt?A.framebufferTextureLayer(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,Ut.__webglTexture,re,_t+Vt):A.framebufferTexture2D(A.DRAW_FRAMEBUFFER,A.COLOR_ATTACHMENT0,A.TEXTURE_2D,Ut.__webglTexture,re),F!==0?A.blitFramebuffer(Be,Fe,ye,we,Ye,$e,ye,we,A.COLOR_BUFFER_BIT,A.NEAREST):Kt?A.copyTexSubImage3D(wt,re,Ye,$e,_t+Vt,Be,Fe,ye,we):A.copyTexSubImage2D(wt,re,Ye,$e,Be,Fe,ye,we);B.bindFramebuffer(A.READ_FRAMEBUFFER,null),B.bindFramebuffer(A.DRAW_FRAMEBUFFER,null)}else Kt?b.isDataTexture||b.isData3DTexture?A.texSubImage3D(wt,re,Ye,$e,_t,ye,we,Ee,Je,De,dt.data):N.isCompressedArrayTexture?A.compressedTexSubImage3D(wt,re,Ye,$e,_t,ye,we,Ee,Je,dt.data):A.texSubImage3D(wt,re,Ye,$e,_t,ye,we,Ee,Je,De,dt):b.isDataTexture?A.texSubImage2D(A.TEXTURE_2D,re,Ye,$e,ye,we,Je,De,dt.data):b.isCompressedTexture?A.compressedTexSubImage2D(A.TEXTURE_2D,re,Ye,$e,dt.width,dt.height,Je,dt.data):A.texSubImage2D(A.TEXTURE_2D,re,Ye,$e,ye,we,Je,De,dt);A.pixelStorei(A.UNPACK_ROW_LENGTH,Qe),A.pixelStorei(A.UNPACK_IMAGE_HEIGHT,rn),A.pixelStorei(A.UNPACK_SKIP_PIXELS,Ui),A.pixelStorei(A.UNPACK_SKIP_ROWS,Xt),A.pixelStorei(A.UNPACK_SKIP_IMAGES,Ss),re===0&&N.generateMipmaps&&A.generateMipmap(wt),B.unbindTexture()},this.copyTextureToTexture3D=function(b,N,W=null,X=null,F=0){return Mr('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(b,N,W,X,F)},this.initRenderTarget=function(b){K.get(b).__webglFramebuffer===void 0&&w.setupRenderTarget(b)},this.initTexture=function(b){b.isCubeTexture?w.setTextureCube(b,0):b.isData3DTexture?w.setTexture3D(b,0):b.isDataArrayTexture||b.isCompressedArrayTexture?w.setTexture2DArray(b,0):w.setTexture2D(b,0),B.unbindTexture()},this.resetState=function(){E=0,R=0,I=null,B.reset(),Ke.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return _n}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Ze._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ze._getUnpackColorSpace()}};var Ea=Math.PI*2,Tt=(i,e,t)=>new D(i,e,t);function Bt(i,e,t,n=0,s=0,r=0){let o=new ft(e,t);return o.position.set(n,s,r),i.add(o),o}function ys(i,e,t,n){return Bt(i,new dn(new bn(e),24,t,7,!1),n)}var rt=i=>new At({color:i,roughness:.36,clearcoat:.32,side:pt});function E0(i){let e=[[-1.16,.78],[-.61,1.05],[0,1.18],[.63,.99],[1.25,.73]],t=new At({vertexColors:!0,side:pt,roughness:.58,sheen:1,sheenColor:11576802});for(let[s,r]of e){let o=[],a=[],l=[];for(let u=0;u<=18;u++)for(let d=0;d<=20;d++){let f=u/18,g=d/10-1,x=Math.abs(g),m=.117*Math.sin(Math.PI*f*.93)**.67,p=g*m,T=f*.29*(1-.085*x*x),y=.03*Math.sin(f*Math.PI)-.074*f*f+.045*g*g*f+.009*Math.cos(g*11)*f*f;o.push(p,T,y);let _=new Ie("#f4dda9").lerp(new Ie("#636ac0"),Math.min(1,f*2.9)).lerp(new Ie("#36278a"),f*.88);if(_.multiplyScalar(1+.18*Math.cos(g*20)*f+.23*x*f),a.push(_.r,_.g,_.b),d&&u){let C=u*21+d;l.push(C-22,C-21,C,C-22,C,C-1)}}let c=new at;c.setAttribute("position",new Ve(o,3)),c.setAttribute("color",new Ve(a,3)),c.setIndex(l),c.computeVertexNormals();let h=Bt(i,c,t);h.rotation.set(-.32,s*.32,s),h.scale.setScalar(r)}Bt(i,new Lt(.034,18,12),rt(15320941),0,.018,.024).scale.set(.85,1.36,.46),ys(i,[Tt(0,-.12,0),Tt(0,-.04,0),Tt(0,.02,0)],.009,rt(4351306))}function A0(i){let e=new it;i.add(e),e.position.y=.14,e.rotation.set(-.14,.38,.1);let t=Bt(e,new Sn(.19,.19,.042,56),rt(6787892));t.rotation.x=Math.PI/2;let n=rt(15133099),s=[rt(12113749),rt(11258187)];for(let r of[-1,1]){Bt(e,new vi(.182,56),n,0,0,r*.022);for(let o=0;o<9;o++){let a=new ar(.013,.17,9,1,o*Ea/9+.021,Ea/9-.042);Bt(e,a,s[o%2],0,0,r*.023)}}}function C0(i){let e=[[0,-.104],[.068,-.095],[.106,-.052],[.119,.012],[.107,.067],[.073,.094],[.038,.09],[0,.068]],t=rt(10425654);t.roughness=.2,t.clearcoat=1,Bt(i,new kn(e.map(([n,s])=>new te(n,s)),48),t,0,.12,0),ys(i,[Tt(0,.19,0),Tt(.014,.29,0),Tt(.092,.37,-.012)],.006,rt(6705711)),ys(i,[Tt(-.15,-.04,-.04),Tt(0,.12,0),Tt(.17,.31,.04)],.007,rt(13276754))}function R0(i){let e=rt(7506761),t=rt(4428638),n=rt(10402164);ys(i,[Tt(0,-.09,0),Tt(.012,.15,0),Tt(0,.37,0)],.008,e);for(let s=0;s<6;s++){let r=new it,o=Math.floor(s/2);i.add(r),r.position.y=.11+o*.1,r.rotation.set(-.3,.22+o*.73,(s%2?1:-1)*(.98-o*.19)),r.scale.setScalar(1-o*.18);let a=[],l=[];for(let h=0;h<=16;h++){let u=h/16,d=Math.sin(Math.PI*u)**.77*(h%2?.069:.059),f=.225*u,g=.036*Math.sin(Math.PI*u);if(a.push(-d,f,g*.24,0,f,g,d,f,g*.24),h){let x=3*h;l.push(x-3,x-2,x,x,x-2,x+1,x-2,x-1,x+1,x+1,x-1,x+2)}}let c=new at;c.setAttribute("position",new Ve(a,3)),c.setIndex(l),c.computeVertexNormals(),Bt(r,c,t),ys(r,[Tt(0,0,.002),Tt(0,.11,.038),Tt(0,.213,.007)],.0026,n)}}function I0(i){let e=new Mi,t=64;for(let r=0;r<=t*2+1;r++){let o=r>t,a=(o?t*2+1-r:r)/t,l=Ea*1.65*a,c=.018+.041*a-(o?.009:0),h=Math.cos(l)*c,u=Math.sin(l)*c;r?e.lineTo(h,u):e.moveTo(h,u)}e.closePath();let n=rt(10376752);n.roughness=.88,n.clearcoat=0,Bt(i,new hs(e,{depth:.54,bevelEnabled:!1}),[rt(12748625),n],0,-.12,0).rotation.set(-1.22,-.15,.14)}function P0(i){let e=new Mi;for(let r=0;r<10;r++){let o=Math.PI/2+r*Math.PI/5,a=r%2?.092:.194,l=a*Math.cos(o),c=a*Math.sin(o);r?e.lineTo(l,c):e.moveTo(l,c)}e.closePath();let t=Bt(i,new hs(e,{depth:.031,bevelEnabled:!0,bevelThickness:.006,bevelSize:.008,bevelSegments:3}),[rt(15715931),rt(11773257)],0,.15,0);t.rotation.y=.3;let n=rt(11368770),s=new Lt(1,12,8);for(let r=0;r<3;r++){let o=Ea*r/3,a=Bt(t,s,n,.039*Math.cos(o),.039*Math.sin(o),.038);a.scale.set(.009,.019,.003),a.rotation.z=o}}var lu={lime_wheel:A0,cocktail_cherry:C0,mint_sprig:R0,cinnamon_stick:I0,starfruit:P0};function cu(i,e){if(Object.hasOwn(lu,e))return lu[e](i);if(e==="butterfly_pea"){E0(i);return}if(e==="rosemary"){let s=rt(7431761),r=[rt(5401688),rt(6915431)];for(let o=0;o<3;o++){let a=new it;i.add(a),a.position.y=o*.045,a.rotation.z=(o-1)*.34;let l=o===1?.49:.34;ys(a,[Tt(0,-.1,0),Tt(.012,l*.45,0),Tt(-.016,l,0)],.007,s);let c=new Lt(1,9,6);for(let h=0;h<28;h++){let u=h*2.399,d=h/28,f=.039*(1-.55*d),g=Bt(a,c,r[h%2],f*Math.cos(u),l*d,f*Math.sin(u));g.scale.set(.009,.063*(1-.43*d),.012),g.rotation.set(.67*Math.sin(u),0,-.67*Math.cos(u))}}return}if(e==="chili"){let s=new it;i.add(s),s.rotation.set(.47,.34,-.48),s.position.y=.054;let r=(a,l,c,h)=>{let u=Bt(s,new bi(a,l,16,64),c,0,0,h);u.scale.y=.79};r(.128,.039,rt(10429461),0),r(.118,.025,rt(15557440),.024);let o=rt(15845002);for(let a=0;a<4;a++){let l=a*1.72,c=Bt(s,new Lt(.02,12,8),o,.086*Math.cos(l),.067*Math.sin(l),.031);c.scale.set(.6,1,.4),c.rotation.z=l}return}let t=e==="gold_leaf",n=t?[new fn({color:15711568,roughness:.22,metalness:.87,side:pt})]:[rt(13070986),rt(14001327),rt(7191737),rt(15711846)];for(let s=0;s<(t?12:22);s++){let r=s*2.399,o=.035+.013*(s%8),a=Bt(i,new or(.024+.015*(s%4),0),n[s%n.length],o*Math.cos(r),.05+Math.sin(r)*o,s%4*.013);a.scale.set(t?1.3:.8,t?.78:.65,t?.075:.65),a.rotation.set(.13*s,.23*s,r)}}function hu(i,e,t,n){let s=n.baseLiquor==="liqueur_sparkling"?64:n.potions.length?38:11,r=new _i(new Lt(1,10,8),new At({color:12116168,metalness:.36,roughness:.11,clearcoat:1,transparent:!0,opacity:.68,depthWrite:!1}),s);r.frustumCulled=!1,i.add(r);let o=new mt;return(a,l,c,h)=>{for(let u=0;u<s;u++){let d=(u*.618034+a*(.14+u%6*.035))%1,f=gt.lerp(e.floor+.014,Math.max(e.floor+.015,l-.015),d),g=u%11*2.399+c*d*1.7+.032*Math.sin(a*3+u),x=t(e,f)*(.29+u%11*.173%.6);o.position.set(Math.cos(g)*x,f+(h.x*Math.cos(g)+h.y*Math.sin(g))*x*d,Math.sin(g)*x),o.scale.setScalar((.003+u%5*.0016)*Math.sin(Math.PI*d)**.45),o.updateMatrix(),r.setMatrixAt(u,o.matrix)}r.instanceMatrix.needsUpdate=!0}}function L0(){let i=[],e=[];function r(l,c,h){let u=i.length/3;for(let d=0;d<=120;d++){let f=d/120*Math.PI*2;i.push(l*Math.sin(f),c,l*Math.cos(f)),d&&h>=0&&e.push(h+d-1,h+d,u+d-1,h+d,u+d,u+d-1)}return u}let o=r(.001,0,-1);o=r(1,0,o);for(let l=1;l<=42;l++)o=r(1,l/42,o);for(let l=1;l<=30;l++)o=r(Math.max(1e-4,1-l/30),1,o);let a=new at;return a.setAttribute("position",new Ve(i,3)),a.setIndex(e),a.boundingSphere=new yn(new D(0,1,0),2),a}var uu=`
uniform float bottom, rim, level, radii[32], square, time, stir, mixed, impact;
uniform vec2 slope;
float profile(float y){
  float f=clamp((y-bottom)/(rim-bottom),0.,1.)*31.;
  int i=int(f);return mix(radii[i],radii[min(31,i+1)],fract(f));
}
`,D0=uu+`
varying vec3 localPos, worldPos; varying float cap;
void main(){
 float h=mix(bottom,level,position.y), radius=profile(h);
 vec2 axis=normalize(position.xz);
 float corner=mix(1.,pow(pow(abs(axis.x),8.)+pow(abs(axis.y),8.),-.125),square);
 vec2 p=position.xz*radius*corner;
 float r=length(position.xz);
 float wave=impact*.024*sin(length(p-vec2(-.12,.03))*36.-time*15.)*exp(-1.5*r);
 // Small travelling capillary waves move the reflected bar light across the meniscus.
 wave+=(.0042*sin(dot(p,vec2(8.,5.))-time*1.12)+.0026*cos(dot(p,vec2(-5.,10.))+time*.81))*(1.-.55*r);
 float vortex=stir*(.055*r*r-.13*exp(-8.*r*r));
 float edge=.011*pow(r,12.);
 h+=(wave+vortex+edge+dot(slope,p))*pow(position.y,4.);
 localPos=vec3(p.x,h,p.y); cap=position.y;
 vec4 w=modelMatrix*vec4(localPos,1.);worldPos=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;
}`,U0=uu+`
uniform sampler2D behind; uniform vec2 viewport; uniform bool hasIce;
uniform vec3 dyes[4]; uniform float stops[4], count;
varying vec3 localPos,worldPos; varying float cap;
void main(){
 vec3 N=normalize(cross(dFdx(worldPos),dFdy(worldPos))),V=normalize(cameraPosition-worldPos);
 if(dot(V,N)<0.)N=-N;
 float ndv=clamp(dot(N,V),.01,1.);
 vec2 uv=gl_FragCoord.xy/viewport;
 vec3 nv=mat3(viewMatrix)*N;
 float radius=max(.02,profile(localPos.y));
 float across=clamp(localPos.x/radius,-1.,1.);
 float chord=sqrt(max(.015,1.-across*across*.96));
 vec3 background;
 if(hasIce){
   // Keep both halves of a floating cube aligned at the moving waterline.
   background=texture2D(behind,uv).rgb;
 }else{
   vec2 off=nv.xy*(.007+.023*(1.-ndv))+vec2(-across*.047, .013*chord);
   off+=.0015*vec2(sin(localPos.y*27.+time*2.),cos(localPos.x*34.-time*2.))*impact;
   background=vec3(texture2D(behind,clamp(uv+off*1.05,.001,.999)).r, texture2D(behind,clamp(uv+off,.001,.999)).g,texture2D(behind,clamp(uv+off*.96,.001,.999)).b);
 }
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
   float ripples=impact*exp(-ring*2.)*pow(.5+.5*cos(38.*length(localPos.xz-vec2(-.12,.03))-time*15.),8.);
   c=mix(c,background*(.74+.19*ndv)+vec3(.22,.15,.085),.13+.30*pow(1.-ndv,2.));
   float reflectedStrip=exp(-pow((R.x+.18)*12.,2.))*smoothstep(.15,.85,R.y);
   c+=vec3(.92,.82,.64)*.26*reflectedStrip;
   c+=lamp*(.28*ripples+.17*pow(clamp(ring,0.,1.),16.));
 }
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;function du(i,e,t,n,s,r){let o=e.floor,a=e.rim-.025,l=Array.from({length:32},(p,T)=>Math.max(.018,t(e,o+(a-o)*T/31)-.025)),c=[0];for(let p=1;p<32;p++)c.push(c[p-1]+(l[p]**2+l[p-1]**2)*.5);function h(p){let T=gt.clamp(p,0,.996)*c[31],y=Math.max(1,c.findIndex(_=>_>=T));return o+(a-o)*(y-1+(T-c[y-1])/(c[y]-c[y-1]))/31}let{dyes:u}=window.TavernAppearance.cocktailLook(n),{BASE_VOLUME:d,DROP_VOLUME:f}=window.TavernAppearance,g=d+(u.length-1)*f,x={};for(let[p,T]of Object.entries({bottom:o,rim:a,radii:l,level:h(g),square:+!!e.square,time:0,impact:0,stir:0,mixed:0,slope:new te,dyes:Array.from({length:4},(y,_)=>new Ie(u[_]||u[0])),stops:Array.from({length:4},(y,_)=>(h(d+_*f)-o)/(a-o)),count:u.length,behind:s,hasIce:!1,viewport:r}))x[p]={value:T};let m=new ft(L0(),new vt({uniforms:x,vertexShader:D0,fragmentShader:U0,side:pt}));return i.add(m),{mesh:m,uniforms:x,amount:g,dose:f,height:h,setFill(p){x.level.value=h(p)},get level(){return x.level.value}}}var br=new D;function tn(i,e,t,n,s,r){let o=2*Math.PI*s/4,a=Math.max(r-2*s,0),l=Math.PI/4;br.copy(e),br[n]=0,br.normalize();let c=.5*o/(o+a),h=1-br.angleTo(i)/l;return Math.sign(br[t])===1?h*c:a/(o+a)+c+c*(1-h)}var Aa=class extends Qn{constructor(e=1,t=1,n=1,s=2,r=.1){if(s=s*2+1,r=Math.min(e/2,t/2,n/2,r),super(1,1,1,s,s,s),s===1)return;let o=this.toNonIndexed();this.index=null,this.attributes.position=o.attributes.position,this.attributes.normal=o.attributes.normal,this.attributes.uv=o.attributes.uv;let a=new D,l=new D,c=new D(e,t,n).divideScalar(2).subScalar(r),h=this.attributes.position.array,u=this.attributes.normal.array,d=this.attributes.uv.array,f=h.length/6,g=new D,x=.5/s;for(let m=0,p=0;m<h.length;m+=3,p+=2)switch(a.fromArray(h,m),l.copy(a),l.x-=Math.sign(l.x)*x,l.y-=Math.sign(l.y)*x,l.z-=Math.sign(l.z)*x,l.normalize(),h[m+0]=c.x*Math.sign(a.x)+l.x*r,h[m+1]=c.y*Math.sign(a.y)+l.y*r,h[m+2]=c.z*Math.sign(a.z)+l.z*r,u[m+0]=l.x,u[m+1]=l.y,u[m+2]=l.z,Math.floor(m/f)){case 0:g.set(1,0,0),d[p+0]=tn(g,l,"z","y",r,n),d[p+1]=1-tn(g,l,"y","z",r,t);break;case 1:g.set(-1,0,0),d[p+0]=1-tn(g,l,"z","y",r,n),d[p+1]=1-tn(g,l,"y","z",r,t);break;case 2:g.set(0,1,0),d[p+0]=1-tn(g,l,"x","z",r,e),d[p+1]=tn(g,l,"z","x",r,n);break;case 3:g.set(0,-1,0),d[p+0]=1-tn(g,l,"x","z",r,e),d[p+1]=1-tn(g,l,"z","x",r,n);break;case 4:g.set(0,0,1),d[p+0]=1-tn(g,l,"x","y",r,e),d[p+1]=1-tn(g,l,"y","x",r,t);break;case 5:g.set(0,0,-1),d[p+0]=tn(g,l,"x","y",r,e),d[p+1]=1-tn(g,l,"y","x",r,t);break}}};var ri=Math.PI*2,Ht=(i,e,t)=>new D(i,e,t);function Wt(i,e,t,n=0,s=0,r=0){let o=new ft(e,t);return o.position.set(n,s,r),i.add(o),o}function Tr(i,e,t,n){return Wt(i,new dn(new bn(e),Math.max(12,e.length*2),t,6,!1),n)}var fu=(i,e=.22)=>new fn({color:i,metalness:.89,roughness:e}),Ca=()=>fu(13079891);function Ms(i,e,t,n,s){let r=Wt(i,new bi(e,t,8,112),s,0,n);return r.rotation.x=Math.PI/2,r}function pu(i,e,t){let n=Ca(),s=(c,h,u=0)=>{let d=e.square?(Math.abs(Math.cos(c))**8+Math.abs(Math.sin(c))**8)**-.125:1,f=(t(e,h)+u)*d;return Ht(f*Math.cos(c),h,f*Math.sin(c))},r=(c,h,u)=>Tr(i,Array.from({length:97},(d,f)=>s(f*ri/96,c,.002)),h,u);if(r(e.rim-.035,.004,n),r(e.rim-.057,.0025,n),e.stem){Ms(i,.392,.008,.066,n),Ms(i,.31,.004,.082,n);for(let h of[.16,e.stem*.58,e.stem-.085])Ms(i,.052,.012,h,n);let c=Wt(i,new jn(.105),new At({color:1668206,metalness:.32,roughness:.1,clearcoat:1}),0,e.stem*.57);c.scale.y=1.55}if(e.square){r(.103,.003,n);let c=(h,u)=>s(Math.PI*.5+h,.68+u,.0035);for(let h of[1,.79]){let u=[[0,.084],[.072,0],[0,-.084],[-.072,0],[0,.084]].map(([f,g])=>c(f*h,g*h)),d=new ls;for(let f=1;f<u.length;f++)d.add(new as(u[f-1],u[f]));Wt(i,new dn(d,32,.0029,6,!1),n)}return}let o=fu(9798505,.21),a=24,l=e.rim-e.floor;for(let c=0;c<a;c++){let h=ri*c/a,u=e.floor+l*.27,d=Array.from({length:13},(f,g)=>{let x=g/12;return s(h+(x-.5)*ri/a,e.floor+.015+(u-e.floor)*Math.sin(x*Math.PI),.003)});Tr(i,d,.0026,o)}}function mu(i){let e=new it;i.add(e);let t=document.createElement("canvas");t.width=t.height=1024;let n=t.getContext("2d");n.translate(512,512);let s=n.createRadialGradient(-120,-160,22,0,0,500);s.addColorStop(0,"#325953"),s.addColorStop(.73,"#183d3b"),s.addColorStop(1,"#102626"),n.fillStyle=s,n.fillRect(-512,-512,1024,1024),n.strokeStyle="#ba975e";function r(l,c){n.lineWidth=c,n.beginPath(),n.arc(0,0,l,0,ri),n.stroke()}for(let l of[485,475,440,426,350,113,99])r(l,l===475?4:1.6);for(let l=0;l<64;l++)n.save(),n.rotate(ri*l/64),n.beginPath(),n.moveTo(0,455),n.lineTo(0,l%4?465:473),n.stroke(),n.restore();for(let l=0;l<16;l++)n.save(),n.rotate(ri*l/16),n.beginPath(),n.moveTo(0,354),n.bezierCurveTo(9,387,19,394,0,422),n.bezierCurveTo(-19,394,-9,387,0,354),n.stroke(),n.restore();for(let l=0;l<8;l++)n.save(),n.rotate(ri*l/8),n.beginPath(),n.moveTo(0,310),n.lineTo(24,86),n.lineTo(0,128),n.lineTo(-24,86),n.closePath(),n.stroke(),n.restore();let o=new xi(t);o.colorSpace=bt,o.anisotropy=4,Wt(e,new Sn(.946,.925,.03,128),Ca(),0,.018);let a=Wt(e,new vi(.928,128),new At({map:o,roughness:.34,metalness:.19,clearcoat:.6}),0,.036);return a.rotation.x=-Math.PI/2,a.receiveShadow=!0,Ms(e,.936,.007,.035,Ca()),o}function gu(i,e,t,n){let s=new it;i.add(s);let r=n==="whiskey_rum"&&!t,o=n==="liqueur_sparkling"||t,a=o?[[.035,-1.29],[.19,-1.27],[.31,-1.16],[.38,-.96],[.38,-.79],[.32,-.64],[.16,-.48],[.09,-.37],[.08,-.1],[.102,-.07],[.102,0],[.077,0]]:[[.02,-1.42],[.25,-1.42],[.3,-1.37],[.315,-1.27],[.315,-.58],[.3,-.52],[.16,-.41],[.101,-.32],[.1,-.1],[.129,-.08],[.129,0],[.095,0]],l=C=>new kn(C.map(([E,R])=>new te(E,R)),r?12:96),c=new At({color:new Ie(16775401).lerp(e,.12),roughness:.048,metalness:0,transmission:.985,thickness:.095,clearcoat:1,ior:1.5,side:pt});Wt(s,l([...a,[a.at(-1)[0],-.1]]),c);let h=a[0][1],u=C=>{for(let E=1;E<a.length;E++)if(a[E][1]>=C){let[R,I]=a[E-1],[S,M]=a[E];return gt.lerp(R,S,(C-I)/Math.max(1e-4,M-I))}return a.at(-1)[0]},d=Array.from({length:48},(C,E)=>Math.max(.01,u(h+(0-h)*E/47)-.016)),f={dye:{value:e},heights:{value:d},bottom:{value:h},up:{value:Ht(0,1,0)},level:{value:-.75}},g=new vt({uniforms:f,vertexShader:`varying vec3 pos,eye;void main(){pos=position;eye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform vec3 up,dye;uniform float level,bottom,heights[48];varying vec3 pos,eye;
    void main(){vec3 ray=normalize(pos-eye),p=pos;float dist=dot(p,up)-level;
    bool top=dist>0.;if(top){float dy=dot(ray,up);if(dy>=-.0001)discard;p-=ray*dist/dy;}
    if(p.y<bottom||p.y>0.)discard;float i=clamp((p.y-bottom)/(-bottom)*47.,0.,46.999);
    float r=mix(heights[int(i)],heights[int(i)+1],fract(i));if(top&&length(p.xz)>r)discard;
    float edge=clamp(length(p.xz)/max(.02,r),0.,1.);
    vec3 c=mix(dye*.25,dye*.82+vec3(.13,.07,.025),top?.75:pow(abs(p.x)/max(.02,r),2.));
    if(top)c+=vec3(1.,.71,.32)*(.12+.27*pow(edge,12.));gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`}),x=a.map(([C,E])=>[Math.max(.006,C-.017),E+.003]);Wt(s,l(x),g);let m=[];for(let C=0;C<24;C++){let E=h+(C+.5)/24*-h,R=u(E),I=Math.ceil(R*R*140);for(let S=0;S<I;S++){let M=S*2.399+C;m.push([R*Math.sqrt((S+.5)/I)*Math.cos(M),E])}}s.userData.adjustFill=C=>{let E=f.up.value.set(Math.sin(s.rotation.z),Math.cos(s.rotation.z),0),R=m.map(([I,S])=>I*E.x+S*E.y).sort((I,S)=>I-S);f.level.value=R[Math.floor((.6-.19*C)*(R.length-1))]};let p=Ca();Ms(s,o?.096:.117,.013,-.083,p),Ms(s,o?.09:.11,.009,-.13,p);let T=o?.383:.317;for(let C=0;C<14;C++){let E=C*ri/14,R=Array.from({length:16},(I,S)=>{let M=S/15,L=E+.17*M,H=o?.19+.19*Math.sin(Math.PI*M):T*.96;return Ht(H*Math.cos(L),-1.26+M*(o?.68:.65),H*Math.sin(L))});Tr(s,R,.004,p)}let y=Wt(s,new Sn(.105,.105,.018,32),p,0,-.87,T);return y.rotation.x=Math.PI/2,y.scale.z=1.25,Wt(s,new jn(.062,1),new At({color:e,metalness:.28,roughness:.08,clearcoat:1}),0,-.87,T+.015).scale.set(.82,1.2,.35),t&&s.scale.setScalar(.64),s}function Ql(i,e,t){let s=new Lt(1,12,8),r=new At({color:14805210,roughness:.06,metalness:.12,clearcoat:1,transparent:!0,opacity:.32,depthWrite:!1}),o=new _i(s,r,55),a=new mt;for(let l=0;l<55;l++){let c=l*2.399+.24*Math.sin(l*1.7),h=.15+.74*(l*.75488%1),u=e.floor+(e.rim-e.floor)*h,d=e.square?(Math.abs(Math.cos(c))**8+Math.abs(Math.sin(c))**8)**-.125:1,f=(t(e,u)+.001)*d,g=.003+.009*(l*.473%1)**2;a.position.set(f*Math.cos(c),u,f*Math.sin(c)),a.lookAt(0,u,0),a.scale.set(g,g*(1.13+1.1*(l*.321%1)),g*.59),a.updateMatrix(),o.setMatrixAt(l,a.matrix)}i.add(o)}function _u(i,e,t){let n=new it;i.add(n);let s=[.285,.315,.26,.28,.25][e],r=new Aa(s,s*.91,s*1.06,6,s*.15),o=r.attributes.position,a=new D;for(let y=0;y<o.count;y++){a.fromBufferAttribute(o,y);let _=1+.025*Math.sin(a.x*29+e)*Math.cos(a.z*24-a.y*19);o.setXYZ(y,a.x*_+.032*a.y,a.y*_,a.z*_)}let l=new At({color:0,roughness:.04,ior:1.31,transparent:!0,depthWrite:!1});l.onBeforeCompile=y=>{let _=`varying vec3 icePoint, iceNormal, iceIncident; varying mat3 iceToView;
`;y.uniforms.iceSize={value:s},y.vertexShader=_+`uniform float iceSize;
`+y.vertexShader.replace("#include <begin_vertex>",`
      #include <begin_vertex>
      icePoint = position / iceSize;
      iceNormal = normal;
      iceIncident = position - (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      iceToView = mat3(modelViewMatrix);`),y.fragmentShader=_+`
      // A cool mullioned window, opposite the amber bar lamps. Project both
      // reflection rays onto the same pane in world space as the cube rotates.
      vec3 windowLight(vec3 direction) {
        vec3 axis = normalize(vec3(-0.55, 0.72, 0.54));
        vec3 right = normalize(cross(vec3(0., 1., 0.), axis));
        vec3 up = cross(axis, right);
        float facing = dot(direction, axis);
        vec2 uv = vec2(dot(direction, right), dot(direction, up)) / max(facing, 0.001);
        vec2 border = vec2(0.78, 0.60) - abs(uv);
        float pane = smoothstep(-0.035, 0.035, min(border.x, border.y)) * step(0.0, facing);
        float frame = smoothstep(0.010, 0.036, abs(uv.x + 0.20))
                    * smoothstep(0.012, 0.033, abs(uv.y - 0.16));
        float sky = smoothstep(-0.5, 1.0, direction.y);
        return vec3(0.14, 0.27, 0.40) * sky
             + vec3(1.40, 2.30, 3.15) * pane * frame * (0.76 + 0.20 * clamp(uv.y, -1.0, 1.0));
      }
      // Intersect the far box face and round its normal across the melted bevel.
      vec3 nextFacet(inout vec3 point, vec3 ray) {
        vec3 halfSize = vec3(0.5, 0.455, 0.53);
        vec3 wall = mix(-halfSize, halfSize, step(vec3(0.0), ray));
        vec3 dist = abs(wall - point) / max(abs(ray), vec3(0.0001));
        point += ray * min(dist.x, min(dist.y, dist.z));
        return normalize(sign(point) * max(abs(point) - (halfSize - 0.15), vec3(0.0)) + 0.05 * point);
      }
`+y.fragmentShader.replace("#include <opaque_fragment>",`
      vec3 V = normalize(vViewPosition);
      // The slight bow in a hand-cut face sweeps reflected light across its width.
      vec3 N = normalize(iceNormal + 0.22 * icePoint);
      vec3 face = normalize(iceToView * N);
      float nv = clamp(dot(face, V), 0.0, 1.0);
      float frontWeight = 0.055 + 0.84 * pow(1.0 - nv, 4.0);

      // Trace to the opposite bevel inside the cube. At a grazing internal
      // angle it mirrors the room; looking through a face still reveals the drink.
      vec3 ray = refract(normalize(iceIncident), N, 1.0 / 1.31);
      vec3 hit = icePoint;
      vec3 rear = nextFacet(hit, ray);
      float internal = 1.0 - smoothstep(0.61, 0.69, abs(dot(ray, rear)));
      float rearWeight = mix(0.065, 0.62, internal) * (1.0 - frontWeight);
      vec3 frontRay = inverseTransformDirection(reflect(-V, face), viewMatrix);
      vec3 bounce = reflect(ray, rear);
      vec3 reflectedRay = inverseTransformDirection(normalize(iceToView * bounce), viewMatrix);
      vec3 reflection = (getIBLRadiance(V, face, 0.035) + windowLight(frontRay)) * frontWeight;
      reflection += windowLight(reflectedRay) * rearWeight;
      #ifdef ENVMAP_TYPE_CUBE_UV
        reflection += textureCubeUV(envMap, envMapRotation * reflectedRay, 0.055).rgb * rearWeight;
        // A second facet can catch a strip light even when the first faces the dark bar.
        vec3 next = nextFacet(hit, bounce);
        vec3 secondRay = inverseTransformDirection(normalize(iceToView * reflect(bounce, next)), viewMatrix);
        float secondWeight = (0.12 + 0.42 * internal) * (1.0 - frontWeight);
        reflection += (textureCubeUV(envMap, envMapRotation * secondRay, 0.065).rgb + windowLight(secondRay)) * secondWeight;
      #endif
      // Alpha attenuates the background once. The HDR lamp reflection contributes
      // its full radiance even on a nearly transparent face.
      diffuseColor.a = clamp(0.018 + frontWeight + rearWeight, 0.0, 1.0);
      outgoingLight = (reflection + reflectedLight.directSpecular) / diffuseColor.a;
      #include <opaque_fragment>`)};let c=Wt(n,r,l),h=Wt(n,r,new vt({uniforms:{image:{value:t}},vertexShader:`varying vec4 clip;
      void main(){ clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = clip; }`,fragmentShader:`uniform sampler2D image; varying vec4 clip;
      void main(){
        gl_FragColor = vec4(texture2D(image, clip.xy / clip.w * 0.5 + 0.5).rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}));h.visible=!1;let u=new zn({color:14152698,transparent:!0,opacity:.2,depthWrite:!1}),d=new it;c.add(d),d.rotation.set(.25,e*1.73,.3-e*.18);let f=[Ht(-.085,-.073,.022),Ht(-.033,-.024,.015),Ht(.006,.005,.009),Ht(.034,.046,.003),Ht(.074,.084,-.015)];Tr(d,f,.0018,u);let g=[];for(let y=1;y<f.length;y++){let _=f[y],C=Ht(_.x+.035,_.y-.017,_.z+.016);g.push(...f[y-1].toArray(),..._.toArray(),...C.toArray()),Tr(d,[_,C,Ht(C.x+.015,C.y+.006,C.z)],.0011,u)}let x=new at;x.setAttribute("position",new Ve(g,3)),x.computeVertexNormals(),Wt(d,x,new fn({color:10928584,metalness:.78,roughness:.12,transparent:!0,opacity:.25,side:pt,depthWrite:!1}));let m=new At({color:15202559,roughness:.24,metalness:.25,transparent:!0,opacity:.67,depthWrite:!1}),p=new Lt(1,10,8);for(let y=0;y<5;y++){let _=y/4,C=y*2.399+e,E=.0025+.0045*(y*7%11)/10;Wt(c,p,m,-.042+.035*Math.cos(C)+.045*_,(_-.5)*s*.65,.035*Math.sin(C)).scale.set(E,E*(1.3+_),E)}n.rotation.set(.37*e,.46+e,.32*e),r.computeBoundingSphere();let T=r.boundingSphere;return{node:n,crystal:c,resolved:h,size:s,hull:T.radius+T.center.length(),bound:0,r:0,velocity:Ht(0,0,0),spin:Ht(0,0,0),previous:Ht(0,0,0),waiting:0,entered:!1,wet:!1,still:0,restLevel:NaN}}function $l(i,e){let t=1/0;for(let n of i.walls){let s=Math.max(n.low,e-i.bound),r=Math.min(n.high,e+i.bound);if(s>r)continue;let o=gt.clamp(e-i.bound*n.normalY,s,r),a=Math.sqrt(Math.max(0,i.bound*i.bound-(o-e)**2));t=Math.min(t,n.radius+n.slope*(o-n.low)-a)}return t-.004}function xu(i,e,t,n){let s=e.floor+(e.rim-e.floor)*.58,r=Math.min(1,(n(e,s)-.045)/.6);if(i.node.scale.setScalar(r),i.bound=i.hull*r,i.r=i.size*.54*r,i.walls=t.slice(1).map(([o,a],l)=>{let[c,h]=t[l],u=(o-c)/(a-h);return{low:h,high:a,radius:c,slope:u,normalY:u/Math.hypot(1,u)}}),i.walls.push({low:e.rim,high:1/0,radius:t.at(-1)[0],slope:0,normalY:0}),i.ceiling=e.rim-i.bound-.004,i.bottom=e.floor+i.bound+.004,$l(i,i.bottom)<0){let o=i.bottom,a=i.ceiling;for(let l=0;l<16;l++){let c=(o+a)/2;$l(i,c)<0?o=c:a=c}i.bottom=a}}function N0(i,e){let t=i.node.position,n=i.velocity;t.y<i.bottom&&(t.y=i.bottom,n.y=Math.max(0,n.y)),(t.y<=i.ceiling||i.wet)&&(i.entered=!0),i.entered&&t.y>i.ceiling&&(t.y=i.ceiling,n.y=Math.min(0,n.y));let s=Math.max(0,$l(i,t.y)),r=e.square?(Math.abs(t.x)**8+Math.abs(t.z)**8)**.125:Math.hypot(t.x,t.z);if(r<=s)return;let o=e.square?(t.x/r)**7:t.x/r,a=e.square?(t.z/r)**7:t.z/r;t.x*=s/r,t.z*=s/r;let l=o*o+a*a;if(l>1e-12){let c=Math.max(0,n.x*o+n.z*a)/l;n.x-=c*o,n.z-=c*a}}var An=Ht(0,0,0);function vu(i,e){for(let t=0;t<4;t++){for(let n=0;n<i.length;n++)for(let s=n+1;s<i.length;s++){let r=i[n],o=i[s];if(r.waiting>0||o.waiting>0)continue;An.subVectors(o.node.position,r.node.position);let a=An.length(),l=r.bound+o.bound-a;if(l<=0)continue;a>1e-8?An.multiplyScalar(1/a):An.set(1,0,0),r.node.position.addScaledVector(An,-l*.5),o.node.position.addScaledVector(An,l*.5);let c=o.velocity.dot(An)-r.velocity.dot(An);c<0&&(r.velocity.addScaledVector(An,.5*c),o.velocity.addScaledVector(An,-.5*c))}for(let n of i)N0(n,e)}}function jl(i,e,t){for(let n of i)n.node.position.y=e-.39*n.r,n.entered=!0,n.wet=!0,n.waiting=0,n.velocity.set(0,0,0),n.spin.set(0,0,0),n.restLevel=e,n.still=0;vu(i,t)}function yu(i,e,t,n,s,r,o){if(!e||!i.length)return;let a=s<.003&&r.lengthSq()<16e-6;if(!(a&&i.every(l=>Math.abs(l.restLevel-t)<.002))){for(let l of i){let c=l.node.position,h=l.velocity;if(l.restLevel=NaN,l.previous.copy(c),l.waiting>0){l.waiting-=e;continue}let u=gt.clamp((t+c.x*r.x+c.z*r.y-c.y+l.r)/(2*l.r),0,1);!l.wet&&u>.05&&(l.wet=!0,o(Math.min(1,Math.abs(h.y)*.28))),h.y+=(15.5*u-10.8)*e,h.multiplyScalar(Math.exp(-e*(.16+6.7*u))),h.x+=(-s*c.z*25+r.x*2.6)*u*e,h.z+=(s*c.x*25+r.y*2.6)*u*e,c.addScaledVector(h,e),l.spin.multiplyScalar(Math.exp(-e*(l.entered?6.8:.8))),l.spin.lengthSq()<.025**2&&l.spin.set(0,0,0),l.node.rotation.x+=e*l.spin.x,l.node.rotation.y+=e*(l.spin.y+s*2),l.node.rotation.z+=e*l.spin.z}vu(i,n);for(let l of i){let c=a&&l.entered&&l.spin.lengthSq()===0&&l.node.position.distanceToSquared(l.previous)<(.012*e)**2;l.still=c?l.still+e:0}if(i.every(l=>l.still>=.18))for(let l of i)l.restLevel=t,l.velocity.set(0,0,0)}}var Mu="data:image/webp;base64,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";var Ra={gin_vodka:{stem:.96,wall:[[.025,.96],[.24,1.08],[.81,1.65],[.84,1.69]],floor:1.02,rim:1.69},whiskey_rum:{square:!0,wall:[[.55,.03],[.59,.09],[.65,1.15],[.65,1.2]],floor:.17,rim:1.2},liqueur_sparkling:{stem:.65,wall:[[.05,.65],[.29,.72],[.47,.91],[.54,1.13],[.51,1.36],[.4,1.62],[.39,1.78]],floor:.74,rim:1.78},coffee_tea:{wall:[[.43,.026],[.475,.068],[.49,.2],[.51,1.42],[.515,1.55]],floor:.17,rim:1.55}},Li=(i,e,t)=>new D(i,e,t),Di=i=>i*i*(3-2*i);function kt(i,e){let t=i.wall;for(let n=1;n<t.length;n++){let[s,r]=t[n-1],[o,a]=t[n];if(e<=a)return gt.lerp(s,o,gt.clamp((e-r)/(a-r),0,1))}return t.at(-1)[0]}function ec(i,e=!1,t=!1){let n=new kn(i.map(([s,r])=>new te(s,r)),t?192:96);if(e){let s=n.attributes.position;for(let r=0;r<s.count;r++){let o=s.getX(r),a=s.getZ(r),l=Math.hypot(o,a);if(!l)continue;let c=1/(Math.abs(o/l)**8+Math.abs(a/l)**8)**.125,h=s.getY(r),u=Math.atan2(o,a),d=t&&l>kt(Ra.whiskey_rum,h)-.006?.042*Math.max(0,1-Math.abs(h-.22)/.24)*(.5+.5*Math.cos(24*u))**2:0;s.setXYZ(r,o*(1-d/l)*c,h,a*(1-d/l)*c)}n.computeVertexNormals()}return n}function zt(i,e,t,n=0,s=0,r=0){let o=new ft(e,t);return o.position.set(n,s,r),i.add(o),o}function Su(i,e,t=28){return new dn(new bn(i),t,e,8,!1)}function nn(i){let e=new Set,t=new Set;i.traverse(n=>{n.isInstancedMesh&&n.dispose(),n.geometry&&e.add(n.geometry),Array.isArray(n.material)?n.material.forEach(s=>t.add(s)):n.material&&t.add(n.material)});for(let n of e)n.dispose();for(let n of t)n.dispose();i.clear()}var bu=(i,e={})=>new fn({color:i,...e}),O0=i=>new At(i),B0=()=>O0({color:16776439,roughness:.036,metalness:0,transmission:.99,ior:1.48,thickness:.075,clearcoat:1,envMapIntensity:.92,side:pt});function Tu(i){return[[Math.max(.015,kt(i,i.floor)-.045),i.floor],...i.wall.filter(([,e])=>e>i.floor).map(([e,t])=>[e-.035,t])]}function z0(i,e){let t=B0(),n=Tu(e).reverse(),s=[[0,e.wall[0][1]],...e.square?[...e.wall.slice(0,2),...Array.from({length:14},(o,a)=>{let l=.105+a*.027;return[kt(e,l),l]}),...e.wall.slice(2)]:e.wall,...n,[0,e.floor]];zt(i,ec(s,e.square,!!e.square),t),e.stem&&zt(i,ec([[0,.02],[.4,.02],[.43,.045],[.4,.065],[.13,.1],[.043,.17],[.034,e.stem],[.06,e.stem+.03]]),t);let r=ec([[kt(e,e.rim)-.026,e.rim-.004],[kt(e,e.rim),e.rim-.006],[kt(e,e.rim),e.rim+.007],[kt(e,e.rim)-.026,e.rim+.009]],e.square);zt(i,r,t),pu(i,e,kt)}var tc;function k0(){return tc||(tc=(async()=>{let i=new Image;return i.src=Mu,await i.decode(),i})().catch(()=>null)),tc}function V0(i,e,t,n,s){let r=!0,o=matchMedia("(prefers-reduced-motion: reduce)").matches,a=document.createElement("canvas"),l=a.getContext("webgl2",{antialias:!0,alpha:!0,powerPreference:"high-performance"});if(!l)return null;let c=new ba({canvas:a,context:l,antialias:!0,alpha:!0}),h=!1,u=0,d=null,f,g,x,m,p=null,T=new te(1,1),y=new te,_=new jt(1,1,{type:si,samples:0}),C=new is,E=new Pt(34,1,.1,60),R=new it,I=new it,S=new it,M=new it,L=new it,H=new it,z=new it;C.add(R,z),R.add(I,S,M,L,H);let k=Ra.gin_vodka,G=null,Z=null,j=[],q=0,oe=0,me=0,Me=0,Pe=0,He=0,$=0,ae=0,xe=null,de,Ae,Ue=new us(16763528,1.95),Re=B=>{B.preventDefault(),nt(),e?.()};function nt(){h||(h=!0,cancelAnimationFrame(u),f?.disconnect(),c.domElement.removeEventListener("webglcontextlost",Re),d?.finish(),d=null,nn(C),Ae?.dispose(),x?.dispose(),m?.dispose(),_.dispose(),g?.dispose(),Ue.shadow.map?.dispose(),c.dispose(),c.forceContextLoss(),c.domElement.remove())}function qe(B,ie){return h?Promise.resolve():(d&&(d.tick(1),d.finish(),d=null),o?(ie(1),Promise.resolve()):new Promise(K=>{d={start:performance.now(),ms:B,tick:ie,finish:K}}))}function Ne(B){nn(H),Ae?.dispose(),Ae=null,de=null;let ie=kt(k,k.rim),K=k.rim,w=new it;if(H.add(w),w.position.set(-ie*.75,K-.07,ie*.5),w.rotation.z=.36,B.garnish&&cu(w,B.garnish),B.customIngredient){let v=document.createElement("canvas");v.width=512,v.height=108;let P=v.getContext("2d"),O=494;P.beginPath(),P.moveTo(6,53),P.lineTo(54,9),P.lineTo(O,9),P.quadraticCurveTo(507,9,507,22),P.lineTo(507,87),P.quadraticCurveTo(507,100,O,100),P.lineTo(54,100),P.closePath(),P.fillStyle="#243e38",P.fill(),P.strokeStyle="#e3bb73",P.lineWidth=4,P.stroke(),P.beginPath(),P.arc(46,54,9,0,Math.PI*2),P.stroke(),P.textAlign="center",P.textBaseline="middle",P.fillStyle="#ffe9bd",P.font='500 48px "Microsoft YaHei",serif',P.fillText(B.customIngredient,275,56,405),Ae=new xi(v),Ae.colorSpace=bt,de=new Zs(new ss({map:Ae,depthTest:!1,toneMapped:!1})),de.scale.set(.7,.15,1),de.material.rotation=-.12,de.position.set(ie+.28,K-.1,.27),H.add(de),zt(H,Su([Li(ie*.91,K,.14),Li(ie+.06,K+.07,.19),Li(ie+.1,K-.04,.25)],.012),bu(13013843))}}function A(B){nn(S),G=null,Z=null;let ie=Ra[B.baseLiquor]||Ra.gin_vodka,K=k!==ie;(K||!I.children.length)&&(nn(I),nn(L),k=ie,z0(I,k),j.length&&Ql(L,k,kt)),$=0,q=0,oe=0,B.baseLiquor?(G=du(S,k,kt,B,_.texture,T),Z=hu(S,k,kt,B),Pe=G.amount):Pe=0,K&&j.length&&ce(j.length,!0),Ne(B)}function ce(B,ie=!1){for(;j.length>B;){let{node:P}=j.pop();M.remove(P),nn(P)}if(!B){nn(L);return}L.children.length||Ql(L,k,kt);let K=j.length,w=Tu(k);o&&!ie&&B>K&&s?.("ice");let v=G?.level??k.floor;for(let P=ie?0:K;P<B;P++){let O=j[P]??_u(M,P,_.texture);j[P]||j.push(O),xu(O,k,w,kt);let J=ie||o,V=P*Math.PI*2/5+P%2*.08;O.waiting=J?0:(P-K)*.115,O.entered=J,O.wet=J,O.restLevel=NaN,O.still=0;let fe=J?v:k.rim+.68+(P-K)*.09,le=Math.max(0,kt(k,Math.min(fe,k.rim))-.05-O.bound)*.78;O.node.position.set(le*Math.cos(V),fe,le*Math.sin(V)),O.velocity.set(0,0,0),O.spin.set(.54*Math.cos(V),.36*Math.sin(V),.62*Math.sin(V+.5))}(ie||o)&&jl(j,v,k)}function ne(B,ie){A(B),nn(z);let K=ie==="potion",w=K?G.amount-G.dose:0;Pe=w,G.setFill(Pe);let v=new Ie((K?window.TavernMix.dose(B.potions.at(-1)):window.TavernMix.base(B)).color),P=gu(z,v,K,B.baseLiquor);xe=new it,z.add(xe);let O=new vt({uniforms:{plate:{value:_.texture},tint:{value:v},glow:{value:K?.17:.02}},vertexShader:`varying vec3 n,w;varying vec4 screen;void main(){vec4 p=modelMatrix*vec4(position,1.);
        n=normalize(mat3(modelMatrix)*normal);w=p.xyz;screen=projectionMatrix*viewMatrix*p;gl_Position=screen;}`,fragmentShader:`uniform sampler2D plate;uniform vec3 tint;uniform float glow;varying vec3 n,w;varying vec4 screen;
        void main(){vec3 N=normalize(n),V=normalize(cameraPosition-w);float f=pow(1.-abs(dot(N,V)),2.);
        vec2 uv=screen.xy/screen.w*.5+.5;vec2 bend=(mat3(viewMatrix)*N).xy*.035;
        vec3 sceneLight=texture2D(plate,clamp(uv+bend,.001,.999)).rgb;
        float glint=pow(max(dot(N,normalize(V+vec3(-.68,.7,.45))),0.),46.);
        vec3 c=sceneLight*(.61+.36*tint)+tint*(glow+.09)+vec3(1.,.84,.62)*(glint*2.+f*.42);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`}),J=Li(-.39,k.rim+.48,.04),V=Li(-.105,.01,.035),fe=new yi(J.clone(),J.clone(),V.clone()),le=zt(xe,new dn(fe,36,.034,9,!1),O),Se=le.geometry.attributes.position;le.frustumCulled=!1;let be=zt(xe,new Lt(.048,20,16),O),Q=Array.from({length:9},(Te,Ce)=>zt(xe,new Lt(.013+Ce%3*.005,10,8),O)),he=!1;return qe(K?1250:1550,Te=>{let Ce=Di(Math.min(Te/.23,1)),ve=Di(gt.clamp((Te-.78)/.22,0,1));P.rotation.z=-.32-Ce*1.88+ve*1.48,P.position.copy(J),P.position.x-=(1-Ce+ve)*1.65,P.position.y+=(1-Ce)*.28+ve*.56,P.visible=Te<1;let ze=gt.clamp((Te-.24)/.48,0,1);!he&&ze>0&&(he=!0,s?.(K?"drop":"pour")),Pe=gt.lerp(w,G.amount,Di(ze)),G.setFill(Pe+He);let ke=Math.sin(Math.PI*ze)**.44;if(oe=Math.max(oe,ke*.85),le.visible=ze>0&&ze<1,le.visible){fe.v0.copy(P.position),fe.v1.set(-.12,P.position.y-.028,.04),fe.v2.set(V.x,G.level+.041,V.z);for(let U=0;U<=36;U++){let ue=U/36,Y=fe.getPoint(ue),ee=fe.getTangent(ue),_e=(K?.026:.049)*ke*(1-.36*ue)*(1+.075*Math.sin(36*ue-21*ze));for(let pe=0;pe<=9;pe++){let Oe=pe*Math.PI*2/9,lt=U*10+pe;Se.setXYZ(lt,Y.x-ee.y*Math.cos(Oe)*_e,Y.y+ee.x*Math.cos(Oe)*_e,Y.z+Math.sin(Oe)*_e)}}Se.needsUpdate=!0,le.geometry.computeVertexNormals()}let Ke=gt.clamp((Te-.72)/.13,0,1);be.visible=Ke>0&&Ke<1,be.position.copy(J).lerp(Li(-.1,G.level,.035),Ke*Ke),be.scale.set(.65,1.3,.65);for(let U=0;U<Q.length;U++){let ue=(ze*2.4+U*.31)%1,Y=U*2.4;Q[U].visible=le.visible,Q[U].position.set(-.105+Math.cos(Y)*ue*.18,G.level+.02+Math.sin(ue*Math.PI)*(.06+U*.009),.035+Math.sin(Y)*ue*.18),Q[U].scale.setScalar(ke*(1-ue*.7))}P.userData.adjustFill(ze)}).finally(()=>{h||(Pe=G.amount,xe=null,nn(z))})}function se(){nn(z);let B=new it;z.add(B);let ie=bu(14732717,{metalness:.98,roughness:.14});zt(B,new Sn(.013,.015,1.3,16),ie,0,.65);let K=Array.from({length:100},(O,J)=>{let V=J/99;return Li(.015*Math.cos(V*68),.37+V*.87,.015*Math.sin(V*68))});zt(B,Su(K,.006,120),ie),zt(B,new jn(.044),ie,0,1.33),zt(B,new Lt(.11,32,16),ie).scale.set(.64,1.28,.22);let w=$,v=G?.level||k.rim*.6,P=!1;return qe(1850,O=>{let J=Di(Math.min(O/.19,1))*Di(Math.min((1-O)/.24,1)),V=O*Math.PI*7.6,fe=Math.min(.24,(k.rim-v)*.45+.11);B.position.set(Math.cos(V)*fe,k.rim+.48-J*(k.rim-v+.72),Math.sin(V)*fe),B.rotation.set(Math.sin(V)*.16,-V,.26-Math.cos(V)*.15),q=J,!P&&O>=.14&&(P=!0,s?.("stir")),oe=Math.max(oe,.42*J),$=gt.lerp(w,1,Di(gt.clamp((O-.17)/.72,0,1)))}).finally(()=>{h||(q=0,nn(z))})}try{let V=function(){let{width:Se,height:be}=i.getBoundingClientRect();if(!Se||!be)return;c.setSize(Se,be,!1),c.getDrawingBufferSize(T),_.setSize(T.x,T.y),E.aspect=Se/be;let Q=Math.max(1,.83/E.aspect);if(E.position.set(.23,2.46*Q,5.32*Q),E.lookAt(0,1.04,0),E.fov=34,E.updateProjectionMatrix(),x?.image){let he=x.image.width/x.image.height;x.repeat.set(Math.min(1,E.aspect/he),Math.min(1,he/E.aspect)),x.offset.set((1-x.repeat.x)/2,(1-x.repeat.y)/2)}},fe=function(Se){try{le(Se)}catch{nt(),e?.()}},le=function(Se){if(h)return;let be=Math.min(.08,Math.max(0,(Se-(p??Se))/1e3));if(p=Se,ae+=be,d){let Q=d,he=Math.min(1,(Se-Q.start)/Q.ms);Q.tick(he),he===1&&(d=null,Q.finish())}if(oe*=Math.exp(-be*3.2),G){let Q=j.reduce((Te,Ce)=>Te+gt.clamp((G.level-Ce.node.position.y+Ce.r)/(2*Ce.r),0,1)*.012,0);He=gt.damp(He,Q,10,be),G.setFill(Pe+He),o&&j.some(Te=>Math.abs(Te.restLevel-G.level)>1e-4)&&jl(j,G.level,k);let he=Math.max(1,Math.ceil(be*120));for(let Te=0;Te<he;Te++){Me+=(-95*me-5*Me)*be/he,me+=Me*be/he;let Ce=G.uniforms.slope.value.set(-.92*me,.39*me).rotateAround(y,R.rotation.y);o||yu(j,be/he,G.level,k,q,Ce,ve=>{s?.("ice"),oe=Math.max(ve,oe),Me+=ve*1.45})}O.uniforms.tone.value.copy(G.uniforms.dyes.value[0]).lerp(G.uniforms.dyes.value[G.uniforms.count.value-1],.48),O.uniforms.strength.value=.36*Pe,O.uniforms.level.value=G.level+me+q,J.position.z=R.position.z-.2,Z?.(o?0:ae,G.level,q,G.uniforms.slope.value),G.uniforms.time.value=o?0:ae,G.uniforms.impact.value=o?0:oe,G.uniforms.stir.value=q,G.uniforms.mixed.value=$}if(J.position.x=R.position.x+.33,v.position.x=R.position.x,v.position.z=R.position.z,v.scale.setScalar(k.stem?.42:.63),J.visible=!!G,G){G.uniforms.hasIce.value=j.length>0;for(let Q of j)Q.crystal.visible=!0,Q.resolved.visible=!1;I.visible=!1,G.mesh.visible=!1,xe&&(xe.visible=!1),c.setRenderTarget(_),c.render(C,E);for(let Q of j)Q.crystal.visible=!1,Q.resolved.visible=!0;I.visible=!0,G.mesh.visible=!0,xe&&(xe.visible=!0),c.setRenderTarget(null)}c.render(C,E),r&&(r=!1,n?.()),u=requestAnimationFrame(fe)};c.setPixelRatio(Math.min(devicePixelRatio||1,2.25)),c.shadowMap.enabled=!0,c.shadowMap.type=Ro,c.toneMapping=Oo,c.toneMappingExposure=1.03,c.domElement.setAttribute("aria-hidden","true"),i.append(c.domElement),c.domElement.addEventListener("webglcontextlost",Re);let B=new xs(c),ie=new is;ie.background=new Ie(4801344);try{for(let[Se,be,Q,he,Te,Ce,ve]of[[-3,2,1,.42,5,12903919,5],[3,2,-1,.32,4,16765844,7],[0,4,-2,2,.35,16772822,4],[-2,1,-3,2.1,2.6,15110212,1.2],[1,1,3,1.3,2.8,7642268,.85],[.5,-1,2,4,3,9660998,.53]])zt(ie,new Tn(he,Te),new zn({color:new Ie(Ce).multiplyScalar(ve),side:pt}),Se,be,Q).lookAt(0,1,0);g=B.fromScene(ie,.016),C.environment=g.texture}finally{nn(ie),B.dispose()}C.environmentIntensity=.78,C.background=new Ie(3877670),t&&(x=new Et(t),x.needsUpdate=!0,x.colorSpace=bt,C.background=x);let K=zt(C,new Tn(40,40),new lr({opacity:.32}),0,-.003);K.rotation.x=-Math.PI/2,K.receiveShadow=!0;let w=zt(C,new Tn(2.5,2.5),new vt({transparent:!0,depthWrite:!1,vertexShader:"varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",fragmentShader:"varying vec2 v;void main(){float r=length(v-.5)*2.;gl_FragColor=vec4(.04,.018,.012,.55*(1.-smoothstep(.65,.98,r)));}"}),0,.001);w.rotation.x=-Math.PI/2;let v=w.clone();C.add(v),v.position.y=.039,C.add(new ur(16769738,3688771,.9)),Ue.position.set(-3,6,3),Ue.castShadow=!0,Ue.shadow.mapSize.set(2048,2048),Ue.shadow.normalBias=.012,Object.assign(Ue.shadow.camera,{left:-3,right:3,top:3,bottom:-3}),Ue.shadow.camera.updateProjectionMatrix(),C.add(Ue);let P=new us(16767651,2.4);P.position.set(3,2,-4),C.add(P);let O=new vt({transparent:!0,depthWrite:!1,blending:fr,uniforms:{tone:{value:new Ie("#d39953")},strength:{value:0},level:{value:0}},vertexShader:"varying vec2 q;void main(){q=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",fragmentShader:`varying vec2 q;uniform vec3 tone;uniform float strength,level;
        void main(){float a=atan(q.y,q.x),r=length(q);float arc=exp(-abs(r-.58-.075*sin(5.*a+level))*(24.+sin(a)*5.));
        float filaments=pow(.5+.5*cos(a*19.+sin(a*6.+level)),4.);
        float light=(arc*(.3+.7*filaments)+.12*exp(-r*r*5.))*(1.-smoothstep(.79,1.,r));
        gl_FragColor=vec4(tone,strength*light);}`}),J=zt(C,new Tn(2.05,1.38),O,.33,.038,-.2);J.rotation.x=-Math.PI/2,m=mu(C),R.position.y=.041,R.rotation.y=-.25,f=new ResizeObserver(V),f.observe(i),V(),u=requestAnimationFrame(fe)}catch(B){throw nt(),B}return{restore(B){R.position.y=.041,R.position.x=0,R.position.z=0,R.rotation.y=-.2,me=0,Me=0,He=0,A(B),ce(B.iceCount||0,!0)},pour:ne,setIce:ce,stir:se,setGarnish:Ne,serve(){let B=0;return qe(1150,ie=>{let w=2.3529411764705883,v=(1-ie)/(1-.25),P=ie<.25?w*ie*ie/(2*.25):1-(1-.25)*w/2.5*v**2.5,O=ie<.25?w*ie/.25:w*v**1.5;Me+=(O-B)*.82,B=O,R.position.x=3.3*P,R.position.y=.041*(1-Di(gt.clamp((P-.13)/.18,0,1))),R.position.z=-1.7*P,R.rotation.y=-.2+P*.48})},dispose:nt}}window.TavernBar3D={create:V0,prepare:k0};})();
