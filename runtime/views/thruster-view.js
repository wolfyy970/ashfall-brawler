import * as T from 'three';
export function enginePlume(){
const mat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,uniforms:{time:{value:0},power:{value:1}},vertexShader:'varying vec2 vUv;uniform float time;void main(){vUv=uv;vec3 p=position;p.x+=sin((1.-uv.y)*2.3)*.025*sin(time*.7);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',fragmentShader:'varying vec2 vUv;uniform float time;uniform float power;void main(){float t=clamp(1.-vUv.y,0.,1.);float x=vUv.x-.5;float width=.072+.038*sin(t*3.14159);float cq=x/(width*.28);float jq=x/width;float hq=x/(width*2.4);float core=exp(-cq*cq)*exp(-t*8.);float jet=exp(-jq*jq)*exp(-t*3.6)*pow(max(0.,1.-t),.6);float haze=exp(-hq*hq)*exp(-t*4.2)*pow(max(0.,1.-t),.7);float cells=1.+.045*sin(t*62.-time*17.);vec3 col=vec3(.028,.24,.95)*jet*cells+vec3(.025,.12,.28)*haze+vec3(1.4,2.6,4.2)*core;float edge=smoothstep(0.,.009,t)*(1.-smoothstep(.91,1.,t));gl_FragColor=vec4(col,edge*power*.86);}'});
const g=new T.Group();
const horizontal=new T.Mesh(new T.PlaneGeometry(1,1),mat);horizontal.rotation.x=-Math.PI/2;horizontal.position.z=2.8;horizontal.scale.set(2.15,5.6,1);g.add(horizontal);
const vertical=new T.Mesh(new T.PlaneGeometry(1,1),mat);vertical.rotation.set(0,Math.PI/2,-Math.PI/2);vertical.position.z=2.8;vertical.scale.set(1.5,5.6,1);g.add(vertical);
g.userData.mat=mat;return g;
}
