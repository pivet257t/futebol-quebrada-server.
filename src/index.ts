<!DOCTYPE html>  <html lang="pt-BR">  
<head>  
<meta charset="UTF-8">  
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">  
<title>Futebol de Quebrada v27</title>  
<style>  
*{box-sizing:border-box}  
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#91c8e9;color:white;font-family:Arial;touch-action:none;user-select:none}  
#game{position:fixed;inset:0}  
canvas{display:block;touch-action:none}  
#hud{position:fixed;top:8px;left:0;width:100%;text-align:center;pointer-events:none;text-shadow:0 2px 5px #000}  
#title{font-size:13px;color:#b8ffb8;font-weight:bold}  
#score{font-size:28px;font-weight:bold;margin-top:3px}  
#status{font-size:13px;background:#000b;padding:6px 12px;border-radius:20px;display:inline-block;margin-top:4px}  
#hint{position:fixed;top:104px;width:100%;text-align:center;font-size:11px;pointer-events:none;text-shadow:0 1px 4px #000}  
#stickArea{position:fixed;left:16px;bottom:24px;width:128px;height:128px;border-radius:50%;background:#ffffff24;border:2px solid #ffffff77;touch-action:none}  
#stick{position:absolute;left:37px;top:37px;width:50px;height:50px;border-radius:50%;background:#d9ffe8cc;border:2px solid white}  
.btn{position:fixed;border:2px solid #ffffffaa;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#111d;color:white;font-size:29px;touch-action:none;box-shadow:0 3px 12px #0008}  
#kick{right:17px;bottom:35px;width:80px;height:80px;background:#b12c2cdd}  
#kickbar{position:fixed;right:21px;bottom:121px;width:73px;height:9px;background:#000b;border-radius:8px;overflow:hidden}  
#power{height:100%;width:0;background:#ffe05b}  
#reset{position:fixed;right:9px;top:8px;font-size:12px;padding:8px 11px;background:#000b;border:1px solid #ffffff66;border-radius:12px;color:white}  
#message{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);font-size:27px;font-weight:bold;text-align:center;text-shadow:0 3px 8px black;pointer-events:none;display:none;width:90%}  
#help{position:fixed;left:50%;bottom:7px;transform:translateX(-50%);font-size:10px;color:#ffffffd0;white-space:nowrap;pointer-events:none}  
</style>  
</head>  
<body>  
<div id="game"></div>  
<div id="hud">  
<div id="title"> FUTEBOL DE QUEBRADA � v27</div>  
<div id="score">0 GOLS</div>  
<div id="status">Pegue a bola e fa�a o gol!</div>  
</div>  
<div id="hint">Goleiro que avan�a � Campo marcado � C�mera com colis�o</div>  
<div id="stickArea"><div id="stick"></div></div>  
<div id="kickbar"><div id="power"></div></div>  
<div class="btn" id="kick"></div>  
<button id="reset"> Reiniciar</button>  
<div id="message"></div>  
<div id="help">Anal�gico: mover �  segure para carregar e solte perto da bola � Arraste a tela: c�mera</div>  <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>  <div id="onlinePanel" style="position:fixed;z-index:50;left:50%;top:50%;transform:translate(-50%,-50%);width:min(350px,92vw);padding:18px;background:#101b2bf5;border:1px solid #ffffff66;border-radius:16px;box-shadow:0 8px 32px #0009;text-align:center;font-family:Arial">  
 <div style="font-weight:bold;font-size:22px;margin-bottom:8px">⚽ X1 ONLINE</div>  
 <div id="onlineInfo" style="font-size:13px;line-height:1.4;margin-bottom:12px">Crie uma sala para jogar com um amigo. É necessário estar conectado à internet.</div>  
 <button id="createRoom" style="padding:11px 14px;border:0;border-radius:10px;background:#1c9c58;color:white;font-weight:bold;margin:4px">Criar sala</button>  
 <div style="display:flex;gap:6px;margin-top:8px">  
  <input id="roomCode" placeholder="Código da sala" autocapitalize="characters" style="min-width:0;flex:1;padding:11px;border-radius:8px;border:1px solid #aaa;text-transform:uppercase">  
  <button id="joinRoom" style="padding:10px;border:0;border-radius:8px;background:#2474d8;color:white;font-weight:bold">Entrar</button>  
 </div>  
 <button id="closeOnline" style="margin-top:12px;padding:8px 12px;border:1px solid #ffffff66;border-radius:8px;background:#333;color:white">Treino offline</button>  
</div>  <script type="module">  
try { const mod = await import("https://esm.sh/colyseus.js@0.16.0"); window.__ColyseusClient = mod.Client; window.dispatchEvent(new Event("colyseus-ready")); } catch(e) { window.__ColyseusLoadError = e; window.dispatchEvent(new Event("colyseus-ready")); }  
</script>  <script>  
(()=>{  
const $=id=>document.getElementById(id),game=$('game');  
if(!window.THREE){  
 $('status').textContent='Conecte-se � internet para carregar o 3D.';  
 return;  
}  
  
const scene=new THREE.Scene();  
scene.background=new THREE.Color(0x91c8e9);  
scene.fog=new THREE.Fog(0x91c8e9,75,240);  
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.1,2500);  
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});  
renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));  
renderer.setSize(innerWidth,innerHeight);  
renderer.outputColorSpace=THREE.SRGBColorSpace;  
game.appendChild(renderer.domElement);  
  
scene.add(new THREE.HemisphereLight(0xdcefff,0x4b3829,2));  
const sun=new THREE.DirectionalLight(0xffffff,1.8);  
sun.position.set(-8,18,8);  
scene.add(sun);  
  
const mat=(c,r=.8,m=0)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});  
const white=mat(0xffffff),black=mat(0x151515);  
const grass=mat(0x43863b),darkGrass=mat(0x397831),wood=mat(0x79502f);  
  
function mesh(p,g,m,x=0,y=0,z=0){  
 const o=new THREE.Mesh(g,m);  
 o.position.set(x,y,z);  
 p.add(o);  
 return o;  
}  
function group(p,x=0,y=0,z=0){  
 const g=new THREE.Group();  
 g.position.set(x,y,z);  
 p.add(g);  
 return g;  
}  
function ballShape(p,r,m,x=0,y=0,z=0,sx=1,sy=1,sz=1){  
 const o=mesh(p,new THREE.SphereGeometry(r,12,8),m,x,y,z);  
 o.scale.set(sx,sy,sz);  
 return o;  
}  
function limbBetween(p,a,b,r1,r2,m){  
 const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b);  
 const d=B.clone().sub(A);  
 const o=mesh(p,new THREE.CylinderGeometry(r2,r1,d.length(),8));  
 o.position.copy(A).add(B).multiplyScalar(.5);  
 o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());  
 return o;  
}  
  
const FIELD_W=36,FIELD_L=60;  
const HALF_W=FIELD_W/2,HALF_L=FIELD_L/2;  
const GOAL_Z=-HALF_L;  
const START_Z=HALF_L-8;  
  
mesh(scene,new THREE.BoxGeometry(2000,.2,2000),grass,0,-.22,0);  
mesh(scene,new THREE.BoxGeometry(FIELD_W,.1,FIELD_L),darkGrass,0,-.13,0);  
  
/* GRAMADO EM FAIXAS */  
for(let z=-HALF_L;z<HALF_L;z+=3){  
 const stripe=Math.floor((z+HALF_L)/3)%2===0?grass:darkGrass;  
 mesh(scene,new THREE.BoxGeometry(FIELD_W-.15,.012,3),stripe,0,-.075,z+1.5);  
}  
  
function line(w,d,x,z){  
 mesh(scene,new THREE.BoxGeometry(w,.025,d),white,x,-.055,z);  
}  
  
/* LINHAS LATERAIS, FUNDO E MEIO */  
line(FIELD_W,.12,0,-HALF_L);  
line(FIELD_W,.12,0,HALF_L);  
line(.12,FIELD_L,-HALF_W,0);  
line(.12,FIELD_L,HALF_W,0);  
line(FIELD_W,.12,0,0);  
  
/* C�RCULO CENTRAL E MARCA DO MEIO */  
const ring=mesh(scene,new THREE.RingGeometry(4.8,4.95,48),white,0,-.045,0);  
ring.rotation.x=-Math.PI/2;  
mesh(scene,new THREE.CircleGeometry(.13,16),white,0,-.043,0);  
  
/* RET�NGULOS DAS �REAS */  
function fieldRect(w,d,x,z){  
 line(w,.12,x,z-d/2);  
 line(w,.12,x,z+d/2);  
 mesh(scene,new THREE.BoxGeometry(.12,.025,d),white,x-w/2,-.052,z);  
 mesh(scene,new THREE.BoxGeometry(.12,.025,d),white,x+w/2,-.052,z);  
}  
  
/* �rea grande e pequena do gol */  
fieldRect(20,16,0,GOAL_Z+8);  
fieldRect(9,5,0,GOAL_Z+2.5);  
  
/* Marca do p�nalti */  
mesh(scene,new THREE.CircleGeometry(.13,16),white,0,-.04,GOAL_Z+11);  
  
/* Arco da �rea */  
const penaltyArc=mesh(  
 scene,  
 new THREE.RingGeometry(3.8,3.92,48,1,0,Math.PI),  
 white,0,-.045,GOAL_Z+16  
);  
penaltyArc.rotation.x=-Math.PI/2;  
  
/* ARCOS DOS ESCANTEIOS */  
function cornerArc(x,z,rotation){  
 const arc=mesh(  
  scene,  
  new THREE.RingGeometry(.65,.78,24,1,0,Math.PI/2),  
  white,x,-.043,z  
 );  
 arc.rotation.x=-Math.PI/2;  
 arc.rotation.z=rotation;  
}  
cornerArc(-HALF_W,-HALF_L,0);  
cornerArc(HALF_W,-HALF_L,Math.PI/2);  
cornerArc(-HALF_W,HALF_L,-Math.PI/2);  
cornerArc(HALF_W,HALF_L,Math.PI);  
  
/* GOL COM TRAVES E REDE */  
function goal(z,dir){  
 const width=8.5,height=3.2,depth=2.2;  
 mesh(scene,new THREE.BoxGeometry(.18,height,.18),white,-width/2,height/2,z);  
 mesh(scene,new THREE.BoxGeometry(.18,height,.18),white,width/2,height/2,z);  
 mesh(scene,new THREE.BoxGeometry(width+.18,.18,.18),white,0,height,z);  
 for(let x=-width/2;x<=width/2;x+=.5){  
  mesh(scene,new THREE.BoxGeometry(.018,height-.2,.018),white,x,(height-.2)/2,z+dir*depth);  
 }  
 for(let y=.25;y<height;y+=.4){  
  mesh(scene,new THREE.BoxGeometry(width,.018,.018),white,0,y,z+dir*depth);  
 }  
 mesh(scene,new THREE.BoxGeometry(width,.035,5),white,0,.015,z+dir*2.5);  
}  
goal(GOAL_Z,-1);  
  
/* CERCAS NAS LATERAIS */  
for(let side of [-1,1]){  
 for(let z=-HALF_L;z<=HALF_L;z+=5){  
  mesh(scene,new THREE.BoxGeometry(.18,1.5,.18),wood,side*(HALF_W+1),.75,z);  
 }  
}  
  
/* CASAS AO REDOR DO CAMPO */  
for(let i=0;i<32;i++){  
 const s=i%2===0?-1:1;  
 const z=-HALF_L-5+Math.floor(i/2)*4;  
 const x=s*(HALF_W+5+Math.random()*5);  
 const w=2+Math.random()*2,h=2+Math.random()*2,d=2+Math.random()*2;  
 const wall=mat([0x927b64,0x756c60,0x9a8b76,0x6e7773][i%4]);  
 mesh(scene,new THREE.BoxGeometry(w,h,d),wall,x,h/2,z);  
 mesh(scene,new THREE.BoxGeometry(w*.5,.7,.05),black,x,h*.35,z-s*(d/2+.03));  
 mesh(scene,new THREE.BoxGeometry(w+.2,.15,d+.2),wood,x,h+.05,z);  
}  
  
function capsule(p,r,l,m,x=0,y=0,z=0){  
 const g=group(p,x,y,z);  
 mesh(g,new THREE.CylinderGeometry(r,r,l,8),m);  
 ballShape(g,r,m,0,l/2,0);  
 ballShape(g,r,m,0,-l/2,0);  
 return g;  
}  
  
function makePlayer(top,bottom,accentColor,hairColor,skinColor,number){  
 const root=group(scene);  
 const shirt=mat(top),shorts=mat(bottom),accent=mat(accentColor);  
 const hair=mat(hairColor),skin=mat(skinColor);  
 const rig={root,legs:[],arms:[],spine:[]};  
  
 rig.pelvis=group(root,0,1,0);  
 ballShape(rig.pelvis,.31,shorts);  
 mesh(rig.pelvis,new THREE.BoxGeometry(.48,.2,.34),shorts,0,-.12,0);  
  
 const spine1=group(rig.pelvis,0,.27,0);  
 rig.spine.push(spine1);  
 ballShape(spine1,.22,shirt,0,.08,0);  
  
 const spine2=group(spine1,0,.18,0);  
 rig.spine.push(spine2);  
 mesh(spine2,new THREE.CapsuleGeometry(.25,.38,3,8),shirt,0,.25,0);  
  
 const chest=group(spine2,0,.47,0);  
 rig.chest=chest;  
 ballShape(chest,.3,shirt,0,.03,0);  
 mesh(chest,new THREE.BoxGeometry(.48,.32,.34),shirt,0,-.03,0);  
 mesh(chest,new THREE.BoxGeometry(.075,.55,.018),accent,-.13,.02,.304);  
 mesh(chest,new THREE.BoxGeometry(.075,.55,.018),accent,.13,.02,.304);  
  
 const nc=document.createElement('canvas');  
 nc.width=128;nc.height=128;  
 const ctx=nc.getContext('2d');  
 ctx.fillStyle='#fff';ctx.font='bold 78px Arial';  
 ctx.textAlign='center';ctx.textBaseline='middle';  
 ctx.fillText(String(number),64,65);  
 mesh(chest,new THREE.PlaneGeometry(.2,.22),  
 new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(nc),transparent:true,side:THREE.DoubleSide}),0,.05,.326);  
  
 rig.neck=group(chest,0,.32,0);  
 capsule(rig.neck,.105,.19,skin,0,.04,0);  
 rig.head=group(rig.neck,0,.22,0);  
 const h=rig.head;  
  
 ballShape(h,.32,skin,0,.12,0,1,.99,.9);  
 ballShape(h,.245,skin,0,-.075,.035,1,.78,.86);  
 ballShape(h,.325,hair,0,.29,-.025,1.02,.58,.94);  
  
 for(const s of [-1,1]){  
  ballShape(h,.085,skin,s*.305,.075,0,.8,1,.55);  
  mesh(h,new THREE.BoxGeometry(.145,.035,.045),hair,s*.12,.17,.273);  
  ballShape(h,.092,white,s*.12,.09,.276,1,.9,.45);  
  ballShape(h,.047,mat(0x59351f),s*.12,.09,.305,1,1,.5);  
  ballShape(h,.023,black,s*.12,.09,.325);  
 }  
 ballShape(h,.17,hair,0,.36,.17,1.35,.4,.9);  
 for(let i=0;i<5;i++)ballShape(h,.07,hair,-.22+i*.11,.38,.12,.8,.7,.8);  
 ballShape(h,.055,skin,0,.045,.315,.8,1.2,1);  
 ballShape(h,.067,skin,0,.015,.35,1,.7,.9);  
 ballShape(h,.105,mat(0x4c1717),0,-.095,.263,1,.32,.45);  
 mesh(h,new THREE.BoxGeometry(.12,.025,.025),mat(0xfff4d7),0,-.078,.29);  
  
 for(const s of [-1,1]){  
  const shoulder=group(chest,s*.34,.17,0);  
  ballShape(shoulder,.13,shirt);  
  const upper=group(shoulder,0,-.12,0);  
  limbBetween(upper,[0,0,0],[s*.025,-.34,.015],.105,.085,shirt);  
  const elbow=group(upper,s*.025,-.34,.015);  
  ballShape(elbow,.083,skin);  
  const fore=group(elbow,0,-.07,0);  
  limbBetween(fore,[0,0,0],[s*.015,-.31,.025],.075,.06,shirt);  
  const wrist=group(fore,s*.015,-.31,.025);  
  ballShape(wrist,.052,skin);  
  const hand=group(wrist,0,-.055,.015);  
  ballShape(hand,.085,skin,0,-.015,.02,1,.7,.6);  
  rig.arms.push({shoulder,elbow,fore,wrist,hand,side:s});  
 }  
  
 for(const s of [-1,1]){  
  const hip=group(rig.pelvis,s*.17,-.12,0);  
  ballShape(hip,.12,shorts);  
  const thigh=group(hip,0,-.1,0);  
  limbBetween(thigh,[0,0,0],[0,-.34,0],.115,.085,shorts);  
  const knee=group(thigh,0,-.34,0);  
  ballShape(knee,.09,skin);  
  ballShape(knee,.093,shorts,0,-.015,0);  
  const shin=group(knee,0,-.06,0);  
  limbBetween(shin,[0,0,0],[0,-.34,.015],.075,.055,skin);  
  mesh(shin,new THREE.CylinderGeometry(.066,.057,.21,8),white,0,-.19,.004);  
  mesh(shin,new THREE.CylinderGeometry(.068,.059,.035,8),mat(0xd52d2d),0,-.12,.004);  
  const ankle=group(shin,0,-.35,.005);  
  ballShape(ankle,.055,skin);  
  const foot=group(ankle,0,-.045,.075);  
  mesh(foot,new THREE.BoxGeometry(.15,.09,.27),mat(0x16191d,.45),0,-.005,.045);  
  mesh(foot,new THREE.BoxGeometry(.155,.025,.28),mat(0xd9d9d9),0,-.052,.045);  
  rig.legs.push({hip,thigh,knee,shin,ankle,foot,side:s});  
 }  
  
 mesh(root,new THREE.CircleGeometry(.42,16),new THREE.MeshBasicMaterial({color:0x111111,transparent:true,opacity:.18}),0,.015,0).rotation.x=-Math.PI/2;  
 return rig;  
}  
  
function convertRigToPointCloud(rig){  
 const groups=[];  
 rig.root.traverse(o=>{if(o.isGroup)groups.push(o)});  
 for(const g of groups){  
  const meshes=g.children.filter(o=>o.isMesh&&o.geometry&&!(o.material&&o.material.map)&&!(o.material&&o.material.type==='MeshBasicMaterial'));  
  if(!meshes.length)continue;  
  const positions=[],colors=[];  
  for(const m of meshes){  
   m.updateMatrix();  
   const geo=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();  
   const pos=geo.getAttribute('position');  
   if(!pos){geo.dispose();continue}  
   const materialUsed=Array.isArray(m.material)?m.material[0]:m.material;  
   const color=new THREE.Color(materialUsed.color||0xffffff);  
   const tris=[];let total=0;  
   for(let i=0;i+2<pos.count;i+=3){  
    const a=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(m.matrix);  
    const b=new THREE.Vector3().fromBufferAttribute(pos,i+1).applyMatrix4(m.matrix);  
    const c=new THREE.Vector3().fromBufferAttribute(pos,i+2).applyMatrix4(m.matrix);  
    const area=b.clone().sub(a).cross(c.clone().sub(a)).length()*.5;  
    if(area>1e-8){tris.push({a,b,c,area});total+=area}  
   }  
   if(!total){geo.dispose();continue}  
   const n=Math.min(950,Math.max(35,Math.ceil(total*1500)));  
   const weighted=[];let acc=0;  
   for(const t of tris){acc+=t.area;weighted.push(acc)}  
   for(let j=0;j<n;j++){  
    const r=Math.random()*total;let lo=0,hi=weighted.length-1;  
    while(lo<hi){const mid=(lo+hi)>>1;if(weighted[mid]<r)lo=mid+1;else hi=mid}  
    const t=tris[lo];let u=Math.random(),v=Math.random();  
    if(u+v>1){u=1-u;v=1-v}  
    const p=t.a.clone().addScaledVector(t.b.clone().sub(t.a),u).addScaledVector(t.c.clone().sub(t.a),v);  
    positions.push(p.x,p.y,p.z);  
    const k=.78+Math.random()*.42;  
    colors.push(Math.min(1,color.r*k),Math.min(1,color.g*k),Math.min(1,color.b*k));  
   }  
   geo.dispose();  
  }  
  if(!positions.length)continue;  
  const geo=new THREE.BufferGeometry();  
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));  
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));  
  const cloud=new THREE.Points(geo,new THREE.PointsMaterial({size:.065,vertexColors:true,sizeAttenuation:true,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));  
  cloud.frustumCulled=false;g.add(cloud);  
  for(const m of meshes){g.remove(m);m.geometry.dispose()}  
 }  
 const aura=new THREE.Mesh(new THREE.CapsuleGeometry(.36,.9,3,6),new THREE.MeshBasicMaterial({color:0x58dfff,transparent:true,opacity:.045,wireframe:true,depthWrite:false}));  
 aura.position.y=1.8;rig.root.add(aura);  
}  
  
const playerRig=makePlayer(0x1767d2,0x102d62,0xffffff,0x21140d,0xc8875d,10);  
const npcRig=makePlayer(0xe8e8e8,0x242a32,0xd52d2d,0x39291c,0x9b603e,1);  
convertRigToPointCloud(playerRig);  
convertRigToPointCloud(npcRig);  
  
const player=playerRig.root,npc=npcRig.root;  
  
// X1 ONLINE: jogador remoto visualizado no mesmo campo  
const remoteRig=makePlayer(0xe33b35,0x711b1b,0xffffff,0x21140d,0xc8875d,2);  
convertRigToPointCloud(remoteRig);  
const remotePlayer=remoteRig.root;  
remotePlayer.scale.setScalar(.50);  
remotePlayer.visible=false;  
let onlineRoom=null, remoteSessionId=null, lastNetSend=0, lastBallSend=0;  
let onlineHost=false, remoteTarget={x:0,z:0,rotation:0}, remoteBallTarget=null;  
const onlineInfo=document.getElementById('onlineInfo');  
const onlinePanel=document.getElementById('onlinePanel');  
function onlineMessage(t){onlineInfo.textContent=t;}  
function syncRemotePlayers(players){  
 if(!onlineRoom || !players) return;  
 const ids=Object.keys(players);  
 remoteSessionId=ids.find(id=>id!==onlineRoom.sessionId)||null;  
 if(!remoteSessionId){remotePlayer.visible=false;onlineMessage('Sala criada! Envie o código ao seu amigo e espere ele entrar.');return;}  
 const p=players[remoteSessionId];  
 if(p){  
  remotePlayer.visible=true;  
  remoteTarget.x=Number(p.x)||0;  
  remoteTarget.z=Number(p.y)||0;  
  remoteTarget.rotation=Number(p.rotation)||0;  
  onlineMessage('Os dois jogadores estão conectados!');  
 }  
}  
async function getColyseusClient(){  
 if(window.__ColyseusClient) return window.__ColyseusClient;  
 await new Promise(resolve=>window.addEventListener('colyseus-ready',resolve,{once:true}));  
 if(window.__ColyseusClient) return window.__ColyseusClient;  
 throw new Error('Não carregou a biblioteca online. Confira a internet e abra o HTML no Chrome.');  
}  
async function connectToRoom(roomId){  
 const ClientClass=await getColyseusClient();  
 const client=new ClientClass('wss://futebol-quebrada-server.onrender.com');  
 onlineMessage('Conectando à sala '+roomId+'…');  
 onlineRoom=await client.joinById(roomId);  
 onlineRoom.onMessage('players',players=>{syncRemotePlayers(players); const ids=Object.keys(players||{}); onlineHost=ids[0]===onlineRoom.sessionId;});  
 onlineRoom.onMessage('kick',data=>{if(!data||!onlineHost)return;const dx=Number(data.dx)||0,dy=Number(data.dy)||0,dz=Number(data.dz)||-1;const power=THREE.MathUtils.clamp(Number(data.power)||.5,.22,1);const dir=new THREE.Vector3(dx,dy,dz).normalize();const speed=11+power*19;ballVelocity.set(dir.x*speed,Math.max(1,dir.y*speed+2),dir.z*speed);ballSpin=power*22;shot={from:'online',life:0};});  
 onlineRoom.onMessage('ball-state',data=>{if(onlineHost||!data)return;remoteBallTarget={x:Number(data.x)||0,y:Number(data.y)||.25,z:Number(data.z)||0,vx:Number(data.vx)||0,vy:Number(data.vy)||0,vz:Number(data.vz)||0,rx:Number(data.rx)||0,rz:Number(data.rz)||0};});  
 onlineRoom.onLeave(()=>{remotePlayer.visible=false;onlineRoom=null;onlineMessage('A conexão com a sala foi encerrada.');onlinePanel.style.display='block';});  
 onlinePanel.style.display='none';  
 $('status').textContent='X1 online conectado';  
}  
$('createRoom').addEventListener('click',async()=>{  
 const b=$('createRoom');b.disabled=true;  
 try{  
  onlineMessage('Acordando o servidor e criando sala… pode levar até 50 segundos.');  
  const response=await fetch('https://futebol-quebrada-server.onrender.com/api/rooms/create',{method:'POST'});  
  let data={};try{data=await response.json();}catch{}  
  if(!response.ok)throw new Error(data.message||('Servidor respondeu HTTP '+response.status));  
  if(!data.roomId)throw new Error(data.message||'O servidor não devolveu o código da sala.');  
  $('roomCode').value=data.code||data.roomId;  
  await connectToRoom(data.roomId);  
  say('CÓDIGO: '+(data.code||data.roomId),4000);  
 }catch(e){onlineMessage('Não criou a sala: '+(e&&e.message?e.message:String(e)));}  
 finally{b.disabled=false;}  
});  
$('joinRoom').addEventListener('click',async()=>{  
 const b=$('joinRoom');b.disabled=true;  
 try{  
  const code=$('roomCode').value.trim();  
  if(!code)throw new Error('Digite o código que seu amigo enviou.');  
  const response=await fetch('https://futebol-quebrada-server.onrender.  
  
  
