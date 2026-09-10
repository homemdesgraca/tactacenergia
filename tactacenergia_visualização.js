"use strict";

/* =====================================================================
   1) LEITURAS DOS SENSORES
   ===================================================================== */
var MIN = -20, MAX = 50;
var valorAlvo  = -5;
var valorSuave = -5;
var distanciaAlvo = 0;
var distanciaRecebida = false;
var tampaAlvo = 0;

function definirValor(v){
  var n = Number(v);
  if (!isFinite(n)) return valorAlvo;
  valorAlvo = Math.max(MIN, Math.min(MAX, n));
  return valorAlvo;
}
window.definirValor = definirValor;

function definirDistancia(v){
  var n = Number(v);
  if (!isFinite(n) || n < 0) return distanciaAlvo;
  distanciaAlvo = n;
  distanciaRecebida = true;
  tampaAlvo = n === 0 || n > 20 ? 1 : 0;
  return distanciaAlvo;
}
window.definirDistancia = definirDistancia;

/* =====================================================================
   2) LEITURA VIA WEB SERIAL
   ---------------------------------------------------------------------
   O firmware envia uma linha JSON, por exemplo:
   {"temperatureC":23.4,"distanceCm":21.0}
   ===================================================================== */
var serialPort = null;
var serialReader = null;
var serialBuffer = '';
var sensorEstadoEl = document.getElementById('estadoSensor');
var estadoCaixaEl = document.getElementById('estadoCaixa');
var conectarSensorEl = document.getElementById('conectarSensor');

function atualizarEstadoSensor(texto){
  if (sensorEstadoEl) sensorEstadoEl.textContent = texto;
}
var estadoCaixaAtual = null;
function atualizarEstadoCaixa(){
  if (!estadoCaixaEl) return;
  var texto;
  if (!distanciaRecebida) texto = 'Caixa: sem leitura';
  else if (cab.tampa >= 0.95) texto = 'Caixa aberta · '+distanciaAlvo.toFixed(1)+' cm';
  else if (cab.tampa <= 0.05) texto = 'Caixa fechada · '+distanciaAlvo.toFixed(1)+' cm';
  else texto = tampaAlvo ? 'Caixa: a abrir' : 'Caixa: a fechar';
  if (texto !== estadoCaixaAtual) {
    estadoCaixaAtual = texto;
    estadoCaixaEl.textContent = texto;
  }
}

function extrairTemperatura(linha){
  var texto = String(linha || '').trim();
  if (!texto) return null;

  try {
    var objeto = JSON.parse(texto);
    var valorJSON = objeto.temperatureC;
    if (valorJSON === undefined) valorJSON = objeto.temperature;
    if (valorJSON === undefined) valorJSON = objeto.temp;
    if (valorJSON !== undefined && isFinite(Number(valorJSON))) return Number(valorJSON);
  } catch (ignore) {}

  var correspondencia = texto.match(/(?:temperature|temperatura|temp|celsius|ds18b20)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i);
  if (correspondencia) return Number(correspondencia[1].replace(',', '.'));
  if (/^-?\d+(?:[.,]\d+)?(?:\s*°?\s*[cf])?$/i.test(texto))
    return Number(texto.replace(',', '.').replace(/[°cf]/ig, '').trim());
  return null;
}

function extrairDistancia(linha){
  var texto = String(linha || '').trim();
  if (!texto) return null;
  try {
    var objeto = JSON.parse(texto);
    var valorJSON = objeto.distanceCm;
    if (valorJSON === undefined) valorJSON = objeto.distance;
    if (valorJSON === undefined) valorJSON = objeto.distancia;
    if (valorJSON !== undefined && isFinite(Number(valorJSON))) return Number(valorJSON);
  } catch (ignore) {}
  var correspondencia = texto.match(/(?:distance|distancia|dist)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  return correspondencia ? Number(correspondencia[1].replace(',', '.')) : null;
}

function receberLeitura(linha){
  var temperatura = extrairTemperatura(linha);
  var distancia = extrairDistancia(linha);
  var recebeu = false;

  if (temperatura !== null && isFinite(temperatura) && temperatura !== -127) {
    definirValor(temperatura);
    recebeu = true;
  }
  if (distancia !== null && isFinite(distancia) && distancia >= 0) {
    definirDistancia(distancia);
    recebeu = true;
  }
  if (recebeu) atualizarEstadoSensor('Ligado');
  return recebeu;
}

async function lerPortaSerial(porta){
  var decoder = new TextDecoder();
  var leitor = porta.readable.getReader();
  serialReader = leitor;
  try {
    while (serialPort === porta) {
      var resultado = await leitor.read();
      if (resultado.done) {
        if (serialBuffer.trim()) receberLeitura(serialBuffer);
        serialBuffer = '';
        break;
      }
      if (resultado.value) {
        serialBuffer += decoder.decode(resultado.value, {stream:true});
        var linhas = serialBuffer.split(/\r?\n/);
        serialBuffer = linhas.pop();
        for (var i=0;i<linhas.length;i++) receberLeitura(linhas[i]);
      }
    }
  } catch (erro) {
    if (serialPort === porta) atualizarEstadoSensor('Ligacao interrompida');
  } finally {
    leitor.releaseLock();
    if (serialReader === leitor) serialReader = null;
    if (serialPort === porta) {
      serialPort = null;
      if (conectarSensorEl) conectarSensorEl.textContent = 'Conectar';
      atualizarEstadoSensor('Desconectado');
    }
  }
}

async function desconectarSensor(){
  var porta = serialPort;
  serialPort = null;
  serialBuffer = '';
  if (serialReader) {
    try { await serialReader.cancel(); } catch (ignore) {}
  }
  if (porta) {
    try { await porta.close(); } catch (ignore) {}
  }
  if (conectarSensorEl) conectarSensorEl.textContent = 'Conectar';
  atualizarEstadoSensor('Desconectado');
}

async function conectarSensor(){
  if (serialPort) {
    await desconectarSensor();
    return;
  }
  if (!('serial' in navigator)) {
    atualizarEstadoSensor('Ligacao indisponivel');
    return;
  }
  try {
    var porta = await navigator.serial.requestPort();
    await porta.open({baudRate:115200});
    serialPort = porta;
    serialBuffer = '';
    conectarSensorEl.textContent = 'Desligar';
    atualizarEstadoSensor('A aguardar leitura');
    lerPortaSerial(porta);
  } catch (erro) {
    if (erro.name !== 'NotFoundError') atualizarEstadoSensor('Nao foi possivel ligar');
  }
}

if (conectarSensorEl) conectarSensorEl.addEventListener('click', conectarSensor);
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', function(evento){
    if (evento.port === serialPort) desconectarSensor();
  });
}

/* =====================================================================
   3) UTILITARIOS
   ===================================================================== */
var TAU = Math.PI*2;
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
function suave(a,b,x){ var t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
function rng(s){ s=s|0; return function(){ s=s+0x6D2B79F5|0; var t=Math.imul(s^s>>>15,1|s);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function mixC(a,b,t){ return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]; }
function css(c,a){ return 'rgba('+clamp(c[0]|0,0,255)+','+clamp(c[1]|0,0,255)+','+clamp(c[2]|0,0,255)+','+(a===undefined?1:a)+')'; }
function rampa(x,ps){
  if(x<=ps[0][0]) return ps[0][1].slice();
  for(var i=0;i<ps.length-1;i++){ if(x<=ps[i+1][0]) return mixC(ps[i][1],ps[i+1][1],(x-ps[i][0])/(ps[i+1][0]-ps[i][0])); }
  return ps[ps.length-1][1].slice();
}
function numRampa(x,ps){
  if(x<=ps[0][0]) return ps[0][1];
  for(var i=0;i<ps.length-1;i++){ if(x<=ps[i+1][0]) return lerp(ps[i][1],ps[i+1][1],(x-ps[i][0])/(ps[i+1][0]-ps[i][0])); }
  return ps[ps.length-1][1];
}


/* luz ambiente: toda a materia passa por aqui, por isso as cores
   dos predios, arvores, cabine, pessoas e carros transitam em conjunto */
var LUZ=[1,1,1];
function tinta(c){ return [c[0]*LUZ[0], c[1]*LUZ[1], c[2]*LUZ[2]]; }
function tc(c,a){ return css(tinta(c),a); }
function linha(x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
function circ(x,y,r){ if(!(r>0)) return; ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fill(); }
function elipse(x,y,rx,ry,rot){ if(!(rx>0)||!(ry>0)) return; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,rot||0,0,TAU); ctx.fill(); }
function retArred(x,y,w,h,r){
  r=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

/* =====================================================================
   3) CENA
   ===================================================================== */
var cv  = document.getElementById('cena');
var ctx = cv.getContext('2d');
var W=0,H=0,DPR=1,S=1;
var L = {};
var predios=[], estrelas=[], arvores=[], pessoas=[], carros=[], nuvens=[];
var neve=[], particulas=[];
var FLOCOS_NEVE = 240;
var cab = {};
var P   = {};
var tempo=0, relogioCarro=0, relogioPessoas=0, relogioFila=0, giroVent=0;

function gerarRamos(r){
  var ramos=[], pontas=[];
  function ramo(x,y,ang,comp,esp,prof){
    var x2=x+Math.cos(ang)*comp, y2=y+Math.sin(ang)*comp;
    ramos.push({x1:x,y1:y,x2:x2,y2:y2,esp:esp,prof:prof});
    if(prof>=4 || comp<0.035){ pontas.push({x:x2,y:y2,ang:ang}); return; }
    var n = prof<1 ? 3 : (r()<0.32?3:2);
    for(var i=0;i<n;i++){
      var a = ang + (i-(n-1)/2)*(0.46+r()*0.30) + (r()-0.5)*0.22;
      ramo(x2,y2,a,comp*(0.70+r()*0.12),esp*0.66,prof+1);
    }
  }
  ramo(0,0,-Math.PI/2,0.34,0.075,0);
  return {ramos:ramos, pontas:pontas};
}
function gerarCopa(r,pontas){
  var f=[];
  for(var i=0;i<pontas.length;i++){
    var p=pontas[i], n=3+((r()*3)|0);
    for(var j=0;j<n;j++){
      var d=r()*0.055, a=r()*TAU;
      f.push({ x:p.x+Math.cos(a)*d, y:p.y+Math.sin(a)*d*0.85,
               r:0.020+r()*0.020, ang:r()*TAU, ordem:r(), tom:r(), osc:r()*TAU });
    }
  }
  f.sort(function(a,b){ return a.ordem-b.ordem; });
  return f;
}
function novaArvore(x,base,alt,seed){
  var r=rng(seed), g=gerarRamos(r), copa=gerarCopa(r,g.pontas);
  var macas=[], usados={};
  for(var i=0;i<8;i++){
    var k=(r()*g.pontas.length)|0; if(usados[k]) continue; usados[k]=1;
    var p=g.pontas[k];
    macas.push({ bx:p.x+(r()-0.5)*0.03, by:p.y+0.014, r:0.025+r()*0.008,
                 caindo:false, ox:0, oy:0, vx:0, vy:0, rot:0, vrot:0, pousada:0, vida:1 });
  }
  var chao=[];
  for(var c=0;c<28;c++) chao.push({ dx:(r()-0.5)*0.68, dy:(r()-0.5)*0.030, ang:r()*TAU,
                                    tom:r(), ordem:r(), r:0.015+r()*0.013 });
  chao.sort(function(a,b){ return a.ordem-b.ordem; });
  return { x:x, base:base, alt:alt, ramos:g.ramos, pontas:g.pontas, copa:copa, macas:macas,
           chao:chao, fogo:0, carvao:0, tremor:0, seed:seed, extraChao:0 };
}

function construirCena(){
  var r = rng(77003);

  L.horizonte  = H*0.535;
  L.baseCidade = H*0.596;
  L.relva      = H*0.636;
  L.calcadaA   = H*0.674;
  L.ruaTopo    = H*0.697;
  L.ruaBase    = H*0.806;
  L.calcadaB   = H*0.820;
  L.piso       = H*0.856;

  /* --- cidade --- */
  predios=[];
  for(var camada=0; camada<2; camada++){
    var x=-60, esc = camada===0?0.74:1.0;
    while(x<W+80){
      var w=(48+r()*92)*clamp(S,0.75,1.4)*esc;
      var h=(0.10+r()*0.30)*H*esc;
      var cols=Math.max(2,Math.floor(w/(22*S))), rows=Math.max(3,Math.floor(h/(30*S)));
      var jan=[];
      for(var a=0;a<cols;a++) for(var b=0;b<rows;b++)
        jan.push({ c:a, l:b, acesa:r()<(camada===0?0.40:0.55), pisca:r()*100 });
      predios.push({ x:x, w:w, h:h, camada:camada, cols:cols, rows:rows, jan:jan,
                     antena:r()<0.30, tom:0.62+r()*0.42 });
      x += w*(0.86+r()*0.26);
    }
  }
  predios.sort(function(a,b){ return a.camada-b.camada; });

  /* --- estrelas / nuvens --- */
  estrelas=[];
  for(var e=0;e<180;e++) estrelas.push({ x:r()*W, y:r()*L.horizonte*0.92, r:r()*1.5+0.35, f:r()*TAU });
  nuvens=[];
  for(var n=0;n<7;n++) nuvens.push({ x:r()*W, y:H*(0.09+r()*0.26), w:(120+r()*230)*S, h:(18+r()*26)*S, v:(4+r()*11) });

  /* --- cabine de refrigeracao (ponto de onibus) --- */
  cab.h = clamp(H*0.315, 190, 430);
  cab.w = clamp(cab.h*0.86, 140, W*0.30);
  cab.prof = cab.w*0.44;          /* profundidade do cubo */
  cab.dx   = cab.prof*0.84;       /* fuga horizontal      */
  cab.dy   = cab.prof*0.40;       /* fuga vertical        */
  cab.baseY = L.piso;
  cab.x = Math.min(W*0.685, W - cab.w*0.5 - cab.dx - 26*S);
  cab.portaW = cab.w*0.32;
  cab.portaH = cab.h*0.56;
  cab.portaX = cab.x + cab.w*0.16;
  cab.tampa = 0;

  /* --- arvores --- */
  arvores=[];
  var pos=[0.062,0.200,0.352,0.498,0.912];
  for(var i=0;i<pos.length;i++){
    var alt = H*0.230*(0.86+((i*37)%5)/11);
    arvores.push(novaArvore(W*pos[i], L.calcadaA, alt, 1300+i*911));
  }

  /* --- pessoas --- */
  pessoas=[];
  var casacos=[[214,72,72],[62,104,190],[228,168,60],[92,176,128],[188,96,180],[238,238,242],
               [110,120,140],[236,124,62],[64,190,196],[160,84,52]];
  for(var p=0;p<10;p++){
    pessoas.push({
      x: r()*W, base: L.piso + (r()-0.5)*12*S, dir: r()<0.5?-1:1,
      vel: 42+r()*32, esc: 0.92+r()*0.26, passo: r()*TAU,
      casaco: casacos[p], calca: [38+r()*42, 42+r()*36, 56+r()*42],
      pele: [232*(0.72+r()*0.32), 196*(0.72+r()*0.32), 164*(0.72+r()*0.32)],
      gorro: r()<0.55, alvo:'fora', visivel:false, alpha:0, dentro:false, bob:r()*TAU,
      slotFila:0, entrouFila:0
    });
  }

  /* --- neve --- */
  neve=[];
  for(var s=0;s<FLOCOS_NEVE;s++) neve.push({ x:r()*W, y:r()*H, r:(0.9+r()*2.6)*S, v:(28+r()*72)*S, f:r()*TAU, osc:8+r()*28 });

  carros=[]; particulas=[];
}

function redim(){
  DPR = Math.min(window.devicePixelRatio||1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR);
  cv.style.width = W+'px'; cv.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  S = clamp(Math.min(H/900, W/1400), 0.46, 1.5);
  construirCena();
}

/* =====================================================================
   4) PARAMETROS CONTINUOS  (tudo derivado de valorSuave)
      Os 4 estados nunca comutam: sobrepoem-se por pesos suaves.
   ===================================================================== */
function parametros(t){
  var e1 = 1-suave(8,13,t);
  var e2 = suave(8,13,t)*(1-suave(18,23,t));
  var e3 = suave(18,23,t)*(1-suave(28,33,t));
  var e4 = suave(28,33,t);
  return {
    t:t, e1:e1, e2:e2, e3:e3, e4:e4,
    noite:        1-suave(0,13,t),
    neve:         1-suave(6,12,t),
    neveChao:     1-suave(5,14,t),
    neveCopa:     1-suave(3,12,t),
    aurora:       1-suave(2,12,t),
    estrelas:     1-suave(1,11,t),
    sol:          suave(8,15,t),
    solAlt:       suave(11,41,t),
    solForca:     suave(15,44,t),
    ventoGelado:  suave(8,13,t)*(1-suave(19,25,t)),
    macas:        suave(10,14,t)*(1-suave(19,23,t)),
    folhas:       1-suave(21,33,t),
    verdura:      1-suave(16,28,t),
    quedaFolhas:  suave(19,24,t)*(1-suave(31,35,t)),
    folhasChao:   suave(19,25,t)*(1-0.78*suave(30,39,t)),
    galhoSeco:    suave(26,37,t),
    flocoGigante: 1-suave(6,10,t),          /* so ate aos 10 graus */
    derretido:    suave(2,10,t),            /* derretem enquanto desaparecem */
    frioCabine:   suave(19,33,t),
    calor:        suave(29,42,t),
    fila:         suave(45,50,t),           /* bicha a porta da cabine, so no extremo */
    fogoOK:       suave(28,32,t)
  };
}

/* =====================================================================
   5) CEU / LUZ
   ===================================================================== */
var CEU_TOPO = [[-20,[6,10,32]],[4,[16,28,62]],[11,[46,96,168]],[16,[62,138,212]],[25,[52,132,208]],[38,[84,148,214]],[50,[126,156,204]]];
var CEU_MEIO = [[-20,[12,24,58]],[4,[40,60,100]],[11,[210,150,128]],[16,[164,200,234]],[25,[126,186,228]],[38,[172,198,226]],[50,[228,180,140]]];
var CEU_BASE = [[-20,[26,46,88]],[4,[70,90,130]],[11,[252,186,124]],[16,[240,224,214]],[25,[204,230,246]],[38,[244,216,180]],[50,[255,198,126]]];
var LUZ_R = [[-20,[0.60,0.70,1.02]],[4,[0.82,0.88,1.05]],[11,[1.00,0.95,0.92]],[16,[1.08,1.04,1.00]],[25,[1.08,1.05,1.00]],[38,[1.10,1.00,0.90]],[50,[1.18,0.95,0.78]]];

function desenharCeu(t){
  var g = ctx.createLinearGradient(0,0,0,L.horizonte*1.08);
  g.addColorStop(0, css(rampa(t,CEU_TOPO)));
  g.addColorStop(0.55, css(rampa(t,CEU_MEIO)));
  g.addColorStop(1, css(rampa(t,CEU_BASE)));
  /* pinta ate a relva: o degrade prolonga a ultima cor e nao deixa
     nenhuma faixa de tela por pintar por tras dos predios */
  ctx.fillStyle=g; ctx.fillRect(0,0,W,L.relva+4);
}

function desenharEstrelas(a){
  if(a<=0.01) return;
  ctx.fillStyle='#ffffff';
  for(var i=0;i<estrelas.length;i++){
    var s=estrelas[i], b=0.35+0.65*Math.abs(Math.sin(tempo*0.9+s.f));
    ctx.globalAlpha = a*b*0.95;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha=1;
}

function desenharAurora(a){
  if(a<=0.01) return;
  ctx.save();
  ctx.globalCompositeOperation='lighter';

  /* brilho de fundo: da corpo ao ceu antes das faixas */
  var gh = ctx.createLinearGradient(0, 0, 0, L.horizonte*0.86);
  gh.addColorStop(0,    css([40,120,150], 0));
  gh.addColorStop(0.38, css([56,190,170], 0.16*a));
  gh.addColorStop(0.72, css([80,150,230], 0.10*a));
  gh.addColorStop(1,    css([60,120,200], 0));
  ctx.fillStyle=gh; ctx.fillRect(0,0,W,L.horizonte*0.86);

  var cores=[[70,240,170],[110,220,255],[170,120,255],[90,255,210],[130,255,190]];
  for(var f=0;f<4;f++){
    var base = L.horizonte*(0.18+f*0.078);
    var amp  = L.horizonte*(0.088+f*0.024);
    var c    = cores[f];
    var g = ctx.createLinearGradient(0,base-amp*2.4,0,base+amp*3.6);
    g.addColorStop(0,   css(c,0));
    g.addColorStop(0.30,css(c,0.34*a));
    g.addColorStop(0.44,css(c,0.58*a));      /* nucleo mais aceso */
    g.addColorStop(0.62,css(c,0.30*a));
    g.addColorStop(1,   css(c,0));
    ctx.fillStyle=g;
    ctx.beginPath();
    var passo = Math.max(14, W/90);
    ctx.moveTo(-40, base+amp*3.4);
    for(var x=-40;x<=W+40;x+=passo){
      var y = base
        + Math.sin(x*0.0042 + tempo*0.30 + f*1.7)*amp
        + Math.sin(x*0.0121 - tempo*0.46 + f*2.9)*amp*0.45
        + Math.sin(x*0.0025 + tempo*0.13)*amp*0.7;
      ctx.lineTo(x,y);
    }
    for(var x2=W+40;x2>=-40;x2-=passo){
      var y2 = base + amp*2.9
        + Math.sin(x2*0.0042 + tempo*0.30 + f*1.7)*amp*0.5
        + Math.sin(x2*0.0091 + tempo*0.21)*amp*0.4;
      ctx.lineTo(x2,y2);
    }
    ctx.closePath(); ctx.fill();
    /* cortinas verticais - cada raio esbate-se na ponta para nao
       parecer chuva */
    ctx.globalAlpha = 0.34*a;
    ctx.lineWidth = 2.2;
    for(var k=0;k<12;k++){
      var xx = ((k*97.3 + f*41 + tempo*6) % (W+120)) - 60;
      var yy = base + Math.sin(xx*0.0042 + tempo*0.30 + f*1.7)*amp;
      var x3 = xx + Math.sin(k+tempo*0.2)*10;
      var y3 = yy + amp*(2.0+Math.sin(k*3.1)*0.7);
      var gc = ctx.createLinearGradient(xx,yy,x3,y3);
      gc.addColorStop(0,   css(c,0));
      gc.addColorStop(0.28,css(c,1));
      gc.addColorStop(1,   css(c,0));
      ctx.strokeStyle = gc;
      linha(xx, yy, x3, y3);
    }
    ctx.globalAlpha=1;
  }
  ctx.restore();
}

function posSol(){
  var x = lerp(W*0.90, W*0.50, P.solAlt);
  var y = lerp(L.horizonte*0.62, H*0.075, P.solAlt);
  return {x:x, y:y};
}

function desenharSol(){
  if(P.sol<=0.01) return;
  var s = posSol();
  var raio = lerp(46, 34, P.solAlt)*S*1.5;
  var cor  = rampa(P.t, [[10,[255,150,90]],[16,[255,190,110]],[26,[255,238,190]],[38,[255,222,140]],[50,[255,178,86]]]);
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  /* halo */
  var g = ctx.createRadialGradient(s.x,s.y,raio*0.2,s.x,s.y,raio*(5+P.solForca*4));
  g.addColorStop(0, css(cor,0.80*P.sol));
  g.addColorStop(0.28, css(cor,0.22*P.sol));
  g.addColorStop(1, css(cor,0));
  ctx.fillStyle=g; circ(s.x,s.y,raio*(5+P.solForca*4));
  /* raios */
  if(P.solForca>0.02){
    ctx.strokeStyle = css(cor, 0.13*P.solForca);
    ctx.lineCap='round';
    for(var i=0;i<20;i++){
      var a = i*(TAU/20) + tempo*0.06;
      var len = raio*(2.6+3.4*P.solForca)*(0.7+0.3*Math.sin(tempo*1.4+i));
      ctx.lineWidth = (2+7*P.solForca)*S;
      linha(s.x+Math.cos(a)*raio*1.05, s.y+Math.sin(a)*raio*1.05,
            s.x+Math.cos(a)*(raio+len), s.y+Math.sin(a)*(raio+len));
    }
  }
  ctx.globalAlpha=P.sol; ctx.fillStyle=css(mixC(cor,[255,255,240],0.5)); circ(s.x,s.y,raio);
  ctx.globalAlpha=1;
  ctx.restore();
}

function desenharNuvens(){
  var a = 0.10 + 0.34*suave(8,26,P.t) - 0.18*suave(38,50,P.t);
  if(a<=0.02) return;
  var cor = rampa(P.t,[[8,[150,170,200]],[16,[255,214,190]],[26,[255,255,255]],[50,[255,226,196]]]);
  for(var i=0;i<nuvens.length;i++){
    var n=nuvens[i];
    n.x += n.v*0.016*(0.4+P.ventoGelado*2.4);
    if(n.x-n.w>W) n.x=-n.w;
    ctx.fillStyle = css(cor, a*0.55);
    for(var k=0;k<5;k++){
      var px = n.x + (k-2)*n.w*0.20;
      var py = n.y + Math.sin(k*1.7+i)*n.h*0.30;
      elipse(px,py,n.w*(0.30-Math.abs(k-2)*0.05),n.h*(1-Math.abs(k-2)*0.16),0);
    }
  }
}

/* =====================================================================
   6) CIDADE
   ===================================================================== */
function desenharCidade(){
  var base = L.baseCidade;
  for(var i=0;i<predios.length;i++){
    var b=predios[i];
    var longe = b.camada===0;
    var corBase = rampa(P.t,[[-20,[22,32,60]],[5,[44,54,80]],[12,[112,106,120]],[17,[142,142,152]],[25,[152,152,162]],[38,[158,148,142]],[50,[168,142,126]]]);
    var c = tinta([corBase[0]*b.tom, corBase[1]*b.tom, corBase[2]*b.tom]);
    if(longe) c = mixC(c, rampa(P.t,CEU_BASE), 0.42);
    var by = base - (longe? H*0.012 : 0);
    var topo = by - b.h;
    ctx.fillStyle = css(c);
    ctx.fillRect(b.x, topo, b.w, by-topo+2);
    /* faces laterais para dar volume */
    ctx.fillStyle = css(mixC(c,[0,0,0],0.22));
    ctx.fillRect(b.x+b.w-b.w*0.10, topo, b.w*0.10, by-topo+2);
    /* janelas */
    var acesa = clamp(P.noite*1.15, 0, 1);
    var corAcesa = mixC([255,214,130],[190,230,255],0.25*(1-P.noite));
    var corApag  = mixC(c,[10,14,26],0.42);
    var mw = b.w/b.cols, mh = b.h/b.rows;
    var jw = mw*0.46, jh = mh*0.40;
    ctx.beginPath();
    for(var j=0;j<b.jan.length;j++){
      var w2=b.jan[j];
      if(w2.acesa) continue;
      ctx.rect(b.x+w2.c*mw+mw*0.27, topo+w2.l*mh+mh*0.30, jw, jh);
    }
    ctx.fillStyle=css(corApag, 0.7); ctx.fill();
    ctx.beginPath();
    for(var j2=0;j2<b.jan.length;j2++){
      var w3=b.jan[j2];
      if(!w3.acesa) continue;
      if(Math.sin(tempo*0.6+w3.pisca)<-0.93) continue;
      ctx.rect(b.x+w3.c*mw+mw*0.27, topo+w3.l*mh+mh*0.30, jw, jh);
    }
    ctx.fillStyle = css(corAcesa, 0.20+0.78*acesa); ctx.fill();
    /* antena com luz */
    if(b.antena && !longe){
      ctx.strokeStyle=css(mixC(c,[0,0,0],0.5)); ctx.lineWidth=2*S;
      linha(b.x+b.w*0.5, topo, b.x+b.w*0.5, topo-b.h*0.16);
      var pulso = 0.4+0.6*Math.abs(Math.sin(tempo*2.2+b.x));
      ctx.fillStyle='rgba(255,70,70,'+(0.35+0.65*pulso*Math.max(0.35,P.noite))+')';
      circ(b.x+b.w*0.5, topo-b.h*0.16, 2.6*S);
    }
    /* neve nos telhados */
    if(P.neveChao>0.02){
      ctx.fillStyle = tc([246,250,255], P.neveChao*0.92);
      ctx.fillRect(b.x, topo-2.5*S, b.w, 3.5*S);
    }
  }
}

/* =====================================================================
   7) CHAO / RUA
   ===================================================================== */
function desenharChao(){
  var relva   = rampa(P.t,[[-20,[70,86,84]],[8,[76,104,72]],[16,[92,142,72]],[26,[126,146,72]],[38,[152,134,78]],[50,[164,132,80]]]);
  var betao   = rampa(P.t,[[-20,[92,100,118]],[10,[132,136,144]],[26,[168,168,168]],[50,[186,176,162]]]);
  var asfalto = rampa(P.t,[[-20,[46,50,62]],[10,[58,60,68]],[26,[70,70,74]],[50,[84,78,74]]]);

  /* faixa de relva atras */
  ctx.fillStyle = tc(relva); ctx.fillRect(0, L.relva, W, L.calcadaA-L.relva+2);
  /* calcada de tras */
  ctx.fillStyle = tc(betao); ctx.fillRect(0, L.calcadaA-2, W, L.ruaTopo-L.calcadaA+3);
  ctx.fillStyle = tc(mixC(betao,[0,0,0],0.22), 0.6);
  for(var x=0;x<W;x+=42*S) ctx.fillRect(x, L.calcadaA, 1.4, L.ruaTopo-L.calcadaA);
  /* meio-fio */
  ctx.fillStyle = tc(mixC(betao,[255,255,255],0.25)); ctx.fillRect(0, L.ruaTopo-4*S, W, 4*S);

  /* rua */
  var ga = ctx.createLinearGradient(0,L.ruaTopo,0,L.ruaBase);
  ga.addColorStop(0, tc(mixC(asfalto,[0,0,0],0.14)));
  ga.addColorStop(1, tc(asfalto));
  ctx.fillStyle=ga; ctx.fillRect(0,L.ruaTopo,W,L.ruaBase-L.ruaTopo+2);
  /* linha central tracejada */
  ctx.strokeStyle = tc([236,222,140], 0.55*(1-P.neveChao*0.9));
  ctx.lineWidth = 3.4*S; ctx.setLineDash([26*S,22*S]);
  linha(0,(L.ruaTopo+L.ruaBase)/2, W,(L.ruaTopo+L.ruaBase)/2);
  ctx.setLineDash([]);

  /* calcada da frente */
  ctx.fillStyle = tc(mixC(betao,[255,255,255],0.20)); ctx.fillRect(0, L.ruaBase-4*S, W, 5*S);
  var gb = ctx.createLinearGradient(0,L.calcadaB,0,H);
  gb.addColorStop(0, tc(betao));
  gb.addColorStop(1, tc(mixC(betao,[0,0,0],0.30)));
  ctx.fillStyle=gb; ctx.fillRect(0,L.calcadaB-2,W,H-L.calcadaB+4);
  ctx.fillStyle = tc(mixC(betao,[0,0,0],0.26), 0.55);
  for(var x2=0;x2<W;x2+=66*S) ctx.fillRect(x2, L.calcadaB, 1.8, H-L.calcadaB);
  ctx.fillRect(0, L.piso+22*S, W, 1.8);

  /* neve acumulada */
  if(P.neveChao>0.01){
    var branco = tinta([244,249,255]);
    ctx.fillStyle = css(branco, P.neveChao*0.97);
    ctx.fillRect(0, L.relva-2*S, W, L.ruaTopo-L.relva+4*S);
    ctx.globalAlpha = P.neveChao*0.92;
    ctx.fillStyle = css(branco);
    ctx.beginPath(); ctx.moveTo(0,L.calcadaB+6*S);
    for(var x3=0;x3<=W;x3+=30){
      ctx.lineTo(x3, L.calcadaB+6*S + Math.sin(x3*0.02)*4*S + Math.sin(x3*0.061)*2.5*S);
    }
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill();
    /* rua com neve pisada */
    ctx.globalAlpha = P.neveChao*0.55;
    ctx.fillRect(0, L.ruaTopo, W, L.ruaBase-L.ruaTopo);
    ctx.globalAlpha = 1;
    /* brilhos */
    ctx.fillStyle = css([255,255,255], P.neveChao*0.8);
    for(var b2=0;b2<40;b2++){
      var bx=(b2*137.1)%W, by=L.calcadaB+((b2*61.7)%(H-L.calcadaB));
      if(Math.sin(tempo*3+b2)>0.86) ctx.fillRect(bx,by,2.2*S,2.2*S);
    }
  }

  /* solo seco / rachado no calor */
  if(P.calor>0.05){
    ctx.strokeStyle = tc([120,92,60], 0.22*P.calor);
    ctx.lineWidth=1.4*S;
    for(var c2=0;c2<18;c2++){
      var cx=(c2*191.3)%W, cy=L.relva+((c2*37.7)%(L.calcadaA-L.relva));
      linha(cx,cy,cx+16*S*Math.sin(c2),cy+5*S*Math.cos(c2*2.1));
    }
  }
}

/* sombra elipse no chao */
function sombra(x,y,r,forca){
  ctx.fillStyle='rgba(10,14,26,'+(0.30*Math.max(0,forca))+')';
  elipse(x,y,r,r*0.22,0);
}

/* =====================================================================
   8) ARVORES
   ===================================================================== */
function corFolha(tom){
  var verde = mixC([58,132,54],[104,168,62], tom);
  var seca  = mixC([176,112,40],[206,158,58], tom);
  var castanha = mixC([132,76,34],[158,104,44], tom);
  var c = mixC(seca, verde, P.verdura);
  c = mixC(c, castanha, clamp((1-P.verdura)*0.55,0,0.55));
  return c;
}

function desenharArvore(a){
  var A = a.alt, px=a.x, py=a.base;
  var balanco = Math.sin(tempo*1.1 + a.seed)*0.012*(0.4+P.ventoGelado*2.0+P.calor*0.5) + a.tremor*Math.sin(tempo*38)*0.02;
  a.tremor *= 0.90;

  sombra(px, py+3*S, A*0.30, 1-P.neveChao*0.6);

  /* folhas caidas no chao */
  var qtdChao = Math.floor(a.chao.length * clamp(P.folhasChao + a.extraChao,0,1));
  for(var i=0;i<qtdChao;i++){
    var f=a.chao[i];
    var cc = corFolha(f.tom);
    ctx.save();
    ctx.translate(px+f.dx*A, py+8*S+f.dy*A);
    ctx.rotate(f.ang);
    ctx.fillStyle = tc(mixC(cc,[150,104,42],0.45), 0.9);
    elipse(0,0,f.r*A,f.r*A*0.46,0);
    ctx.restore();
  }
  a.extraChao *= 0.9995;

  /* ramos */
  var corTronco = mixC(rampa(P.t,[[-20,[64,50,44]],[16,[86,64,48]],[50,[112,88,62]]]), [46,38,34], P.galhoSeco*0.5);
  corTronco = mixC(corTronco, [34,28,26], a.carvao*0.85);
  ctx.strokeStyle = tc(corTronco);
  ctx.lineCap='round';
  for(var r2=0;r2<a.ramos.length;r2++){
    var b=a.ramos[r2];
    var sw = balanco*(b.prof+1)*0.55;
    ctx.lineWidth = Math.max(1, b.esp*A*(1-P.galhoSeco*0.18));
    linha(px+b.x1*A + b.y1*A*sw*0.3, py+b.y1*A,
          px+b.x2*A + b.y2*A*sw*0.5, py+b.y2*A);
  }
  /* neve pousada nos ramos */
  if(P.neveCopa>0.02){
    ctx.strokeStyle = tc([248,252,255], P.neveCopa*0.85);
    for(var r3=0;r3<a.ramos.length;r3++){
      var b3=a.ramos[r3];
      if(b3.prof>2) continue;
      ctx.lineWidth = Math.max(1, b3.esp*A*0.55);
      linha(px+b3.x1*A, py+b3.y1*A-b3.esp*A*0.45,
            px+b3.x2*A, py+b3.y2*A-b3.esp*A*0.45);
    }
  }

  /* copa */
  var quantas = Math.floor(a.copa.length * clamp(P.folhas,0,1));
  if(P.neveCopa>0.75){
    ctx.fillStyle = tc([252,254,255], P.neveCopa*0.78);
    for(var c=0;c<quantas;c+=2){
      var f2=a.copa[c];
      var osc = Math.sin(tempo*1.6 + f2.osc)*0.006*(1+P.ventoGelado*2);
      elipse(px+f2.x*A+(f2.y*A)*balanco+osc*A, py+f2.y*A-f2.r*A*0.18, f2.r*A*1.20, f2.r*A*0.48, 0);
    }
  } else {
    for(var c2=0;c2<quantas;c2++){
      var f3=a.copa[c2];
      var alpha = clamp((P.folhas - f3.ordem)*10, 0, 1);
      if(alpha<=0.01) continue;
      var osc2 = Math.sin(tempo*1.6 + f3.osc)*0.006*(1+P.ventoGelado*2);
      var cf = corFolha(f3.tom);
      cf = mixC(cf, [250,253,255], P.neveCopa*0.55);
      ctx.save();
      ctx.translate(px + f3.x*A + (f3.y*A)*balanco + osc2*A, py + f3.y*A);
      ctx.rotate(f3.ang + balanco*2);
      ctx.fillStyle = tc(cf, alpha*0.92);
      elipse(0,0,f3.r*A,f3.r*A*0.66,0);
      ctx.restore();
    }
    if(P.neveCopa>0.03 && P.folhas>0.2){
      ctx.fillStyle = tc([252,254,255], P.neveCopa*0.55);
      for(var c3=0;c3<quantas;c3+=3){
        var f4=a.copa[c3];
        elipse(px+f4.x*A+(f4.y*A)*balanco, py+f4.y*A-f4.r*A*0.42, f4.r*A*0.9, f4.r*A*0.36, 0);
      }
    }
  }

  /* macas */
  if(P.macas>0.02){
    for(var m=0;m<a.macas.length;m++){
      var mm=a.macas[m];
      if(mm.vida<=0) continue;
      var mx = px + (mm.bx*A) + (mm.by*A)*balanco + mm.ox;
      var my = py + mm.by*A + mm.oy;
      var al = P.macas * mm.vida;
      if(mm.pousada>0) al *= clamp(mm.vida,0,1);
      ctx.save(); ctx.translate(mx,my); ctx.rotate(mm.rot);
      var cm = mixC([206,38,42],[236,92,52], (mm.bx+1)%1);
      ctx.fillStyle = tc(cm, al);
      circ(0,0,mm.r*A);
      ctx.fillStyle = tc([255,190,170], al*0.55);
      circ(-mm.r*A*0.30,-mm.r*A*0.30, mm.r*A*0.28);
      ctx.strokeStyle = tc([88,62,36], al); ctx.lineWidth=1.6*S;
      linha(0,-mm.r*A*0.9, mm.r*A*0.22, -mm.r*A*1.5);
      ctx.restore();
    }
  }

  /* fogo */
  if(a.fogo>0.01) desenharFogo(a);
}

function desenharFogo(a){
  var A=a.alt, px=a.x, py=a.base;
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  var n = a.pontas.length;
  /* linguas de chama nas pontas dos ramos */
  for(var i=0;i<n;i++){
    var p=a.pontas[i];
    var fx = px+p.x*A, fy = py+p.y*A;
    var fase = tempo*6.5 + i*1.93;
    var alt  = A*0.135*a.fogo*(0.50+0.50*Math.sin(fase));
    if(alt<=0.5) continue;
    var lar  = alt*0.32;
    var desv = Math.sin(fase*0.8)*lar*0.55;
    ctx.fillStyle='rgba(255,132,34,'+(0.26*a.fogo)+')';
    ctx.beginPath();
    ctx.moveTo(fx-lar, fy+alt*0.10);
    ctx.quadraticCurveTo(fx-lar*1.05, fy-alt*0.52, fx+desv, fy-alt);
    ctx.quadraticCurveTo(fx+lar*1.05, fy-alt*0.52, fx+lar, fy+alt*0.10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,238,168,'+(0.28*a.fogo)+')';
    ctx.beginPath();
    ctx.moveTo(fx-lar*0.40, fy+alt*0.06);
    ctx.quadraticCurveTo(fx-lar*0.42, fy-alt*0.34, fx+desv*0.5, fy-alt*0.60);
    ctx.quadraticCurveTo(fx+lar*0.42, fy-alt*0.34, fx+lar*0.40, fy+alt*0.06);
    ctx.closePath(); ctx.fill();
  }
  /* clarao contido junto a copa */
  var gg = ctx.createRadialGradient(px, py-A*0.62, 0, px, py-A*0.62, A*0.62);
  gg.addColorStop(0,'rgba(255,150,50,'+(0.16*a.fogo)+')');
  gg.addColorStop(1,'rgba(255,80,0,0)');
  ctx.fillStyle=gg; circ(px, py-A*0.62, A*0.62);
  ctx.restore();
}

/* =====================================================================
   9) CABINE DE REFRIGERACAO  "TAC TAC ENERGIA"
   ===================================================================== */
function ventoinha(cx,cy,r,ang,vel){
  /* carcaca */
  ctx.fillStyle = tc([26,26,30]);
  circ(cx,cy,r*1.16);
  ctx.fillStyle = tc([60,62,70]);
  circ(cx,cy,r*1.02);
  var g=ctx.createRadialGradient(cx-r*0.3,cy-r*0.3,r*0.1,cx,cy,r);
  g.addColorStop(0, tc([120,126,136],1));
  g.addColorStop(1, tc([44,46,54],1));
  ctx.fillStyle=g; circ(cx,cy,r*0.94);
  /* pas */
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(ang);
  ctx.fillStyle = tc([196,206,220], 0.92);
  for(var i=0;i<5;i++){
    ctx.save(); ctx.rotate(i*TAU/5);
    elipse(0,-r*0.48, r*0.20, r*0.44, 0.35);
    ctx.restore();
  }
  ctx.fillStyle = tc([30,32,38]); circ(0,0,r*0.20);
  ctx.restore();
  /* grelha */
  ctx.strokeStyle = 'rgba(12,14,18,0.55)'; ctx.lineWidth = Math.max(1,r*0.055);
  for(var k=1;k<=3;k++){ ctx.beginPath(); ctx.arc(cx,cy,r*0.30*k,0,TAU); ctx.stroke(); }
  for(var k2=0;k2<4;k2++){
    var aa=k2*Math.PI/4;
    linha(cx-Math.cos(aa)*r*0.95, cy-Math.sin(aa)*r*0.95, cx+Math.cos(aa)*r*0.95, cy+Math.sin(aa)*r*0.95);
  }
  /* halo frio */
  if(P.frioCabine>0.05){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    var gh=ctx.createRadialGradient(cx,cy,r*0.2,cx,cy,r*2.6);
    gh.addColorStop(0,'rgba(150,225,255,'+(0.17*P.frioCabine)+')');
    gh.addColorStop(1,'rgba(150,225,255,0)');
    ctx.fillStyle=gh; circ(cx,cy,r*2.6);
    ctx.restore();
  }
}

function tabuas(x,y,w,h,corA,corB,vert,n){
  for(var i=0;i<n;i++){
    var t=i/n;
    var c = mixC(corA,corB, (i%2)*0.35 + Math.abs(Math.sin(i*2.3))*0.4);
    ctx.fillStyle = tc(c);
    if(vert) ctx.fillRect(x+w*t, y, w/n+0.6, h);
    else     ctx.fillRect(x, y+h*t, w, h/n+0.6);
    ctx.strokeStyle = tc(mixC(corA,[40,26,14],0.55), 0.42); ctx.lineWidth=1;
    if(vert) linha(x+w*t, y, x+w*t, y+h);
    else     linha(x, y+h*t, x+w, y+h*t);
  }
  /* veios */
  ctx.strokeStyle = tc(mixC(corA,[70,44,22],0.5), 0.18); ctx.lineWidth=1;
  for(var v=0;v<n*2;v++){
    var vx = x + ((v*53.7)%w), vy = y + ((v*97.1)%h);
    ctx.beginPath();
    if(vert) ctx.ellipse(vx, vy, w/n*0.28, h*0.10, 0, 0, TAU);
    else     ctx.ellipse(vx, vy, w*0.06, h/n*0.30, 0, 0, TAU);
    ctx.stroke();
  }
}

/* --- poligonos --- */
function poli(p){
  ctx.beginPath(); ctx.moveTo(p[0][0],p[0][1]);
  for(var i=1;i<p.length;i++) ctx.lineTo(p[i][0],p[i][1]);
  ctx.closePath();
}
function poliCor(p,cor){ poli(p); ctx.fillStyle=cor; ctx.fill(); }

/* uma figura vista atraves do vidro */
function figuraInterior(x,y,esc,p,k){
  var hh = 74*S*esc;
  var casaco = mixC(tinta(p.casaco),[150,205,235],0.32);
  var calca  = mixC(tinta(p.calca), [120,165,205],0.32);
  var bob = Math.sin(tempo*1.5+k*1.3)*1.6*S;
  ctx.save(); ctx.translate(x,y+bob);
  ctx.fillStyle='rgba(8,12,20,0.22)'; elipse(0,2*S,hh*0.17,hh*0.045,0);
  ctx.lineCap='round';
  ctx.strokeStyle=css(calca); ctx.lineWidth=hh*0.085;
  linha(-hh*0.055,-hh*0.40,-hh*0.055,-hh*0.01);
  linha( hh*0.055,-hh*0.40, hh*0.055,-hh*0.01);
  ctx.fillStyle=css(casaco);
  retArred(-hh*0.125,-hh*0.80,hh*0.25,hh*0.42,hh*0.06); ctx.fill();
  ctx.strokeStyle=css(mixC(casaco,[0,0,0],0.15)); ctx.lineWidth=hh*0.060;
  linha(-hh*0.10,-hh*0.73,-hh*0.13,-hh*0.45);
  linha( hh*0.10,-hh*0.73, hh*0.13,-hh*0.45);
  ctx.fillStyle=css(mixC(tinta(p.pele),[165,205,235],0.28));
  circ(0,-hh*0.90,hh*0.088);
  ctx.fillStyle=css(mixC(casaco,[255,255,255],0.28));
  ctx.beginPath(); ctx.arc(0,-hh*0.918,hh*0.096,Math.PI,0); ctx.fill();
  ctx.restore();
}

function desenharGenteDentro(xL,xR,base,dx,dy){
  var lista=[];
  for(var i=0;i<pessoas.length;i++) if(pessoas[i].dentro) lista.push(pessoas[i]);
  var n=Math.min(lista.length,5);
  for(var k=0;k<n;k++){
    var f = n===1 ? 0.5 : k/(n-1);
    var prof = 0.34 + 0.46*(((k*7)%5)/4);      /* 0 = junto ao vidro, 1 = ao fundo */
    var px = lerp(xL+cab.w*0.14, xR-cab.w*0.12, f) + dx*prof;
    var py = base - dy*prof;
    figuraInterior(px, py, 1-0.20*prof, lista[k], k);
  }
}

/* =====================================================================
   CABINE DE REFRIGERACAO "TAC TAC ENERGIA"
   Volume em cubo (frente + lateral direita + tampo), fechada a vidro
   para se ver o interior, com estrutura em compensado e arestas pretas.
   Ventoinhas nos cantos superiores esquerdo e direito.
   ===================================================================== */
function desenharCabine(){
  var w=cab.w, h=cab.h, base=cab.baseY, topo=base-h;
  var xL=cab.x-w/2, xR=cab.x+w/2, dx=cab.dx, dy=cab.dy;

  var F1=[xL,topo],       F2=[xR,topo],       F3=[xR,base],       F4=[xL,base];
  var B1=[xL+dx,topo-dy], B2=[xR+dx,topo-dy], B3=[xR+dx,base-dy], B4=[xL+dx,base-dy];

  var madeira=[198,154,94], madeira2=[160,118,64], preto=[20,20,24];
  var frio = P.frioCabine;
  var corVidro = mixC([142,188,212],[190,230,248], frio);
  var faixaH = h*0.235;                       /* faixa superior de estrutura */

  /* ---------------- sombra do volume ---------------- */
  ctx.fillStyle='rgba(10,14,26,0.30)';
  poli([[xL-9*S,base+5*S],[xR+9*S,base+5*S],[xR+dx+9*S,base-dy+5*S],[xL+dx-9*S,base-dy+5*S]]);
  ctx.fill();

  /* ---------------- INTERIOR (visto atraves do vidro) ---------------- */
  ctx.save();
  poli([F1,B1,B2,B3,F3,F4]); ctx.clip();

  poliCor([B1,B2,B3,B4], tc(mixC(madeira,[54,58,70],0.62)));            /* fundo   */
  poliCor([F1,B1,B4,F4], tc(mixC(madeira,[38,42,54],0.52)));            /* esquerda*/
  var gch=ctx.createLinearGradient(0,base-dy,0,base);
  gch.addColorStop(0, tc([98,102,112])); gch.addColorStop(1, tc([62,64,72]));
  poli([F4,F3,B3,B4]); ctx.fillStyle=gch; ctx.fill();                   /* chao    */

  /* banco corrido ao fundo */
  var bh=h*0.055, by=base-dy+h*0.26;
  poliCor([[xL+dx*0.18,by],[xR+dx*0.90,by-dy*0.60],[xR+dx*0.90,by-dy*0.60+bh],[xL+dx*0.18,by+bh]],
          tc([158,116,68]));
  poliCor([[xL+dx*0.18,by],[xR+dx*0.90,by-dy*0.60],[xR+dx*0.90,by-dy*0.60-bh*0.30],[xL+dx*0.18,by-bh*0.30]],
          tc([190,146,90]));

  /* grelhas de refrigeracao na parede do fundo */
  ctx.strokeStyle = css(mixC(tinta([120,150,170]),[200,240,255],frio), 0.45);
  ctx.lineWidth = Math.max(1,2*S);
  for(var gg=0;gg<5;gg++){
    var gy = topo-dy + h*(0.42+gg*0.055);
    linha(xL+dx*0.24, gy, xL+dx*0.24+w*0.30, gy);
  }

  /* ---------------- MOBILIARIO INTERIOR ----------------
     Sofa vermelho e maquina de vendas. Vao ligeiramente desfocados,
     como convem a coisas vistas atraves do vidro, e servem sobretudo
     para a cabine nao parecer vazia. */
  ctx.save();
  if(typeof ctx.filter === 'string') ctx.filter = 'blur('+(1.8*S).toFixed(2)+'px)';
  /* ponto no chao: fx = x medido na face frontal, p = profundidade 0..1 */
  function ptCh(fx,p){ return [fx + dx*p, base - dy*p]; }
  function sobe(P0,dh){ return [P0[0], P0[1]-dh]; }

  /* --- maquina de vendas, encostada ao fundo do lado direito --- */
  var mx0=xR-w*0.34, mx1=xR-w*0.06, mp=0.70, mh=h*0.36, mlado=0.16;
  var M0=ptCh(mx0,mp), M1=ptCh(mx1,mp), M1b=ptCh(mx1,mp+mlado), M0b=ptCh(mx0,mp+mlado);
  poliCor([M0b,M1b,sobe(M1b,mh),sobe(M0b,mh)], tc([30,40,58]));          /* tras   */
  poliCor([M1,M1b,sobe(M1b,mh),sobe(M1,mh)],   tc([26,34,50]));          /* lateral*/
  poliCor([M0,M1,sobe(M1,mh),sobe(M0,mh)],     tc([44,60,86]));          /* frente */
  /* montra iluminada */
  var vx0=lerp(M0[0],M1[0],0.10), vx1=lerp(M0[0],M1[0],0.72);
  var vy0=lerp(M0[1],M1[1],0.10), vy1=lerp(M0[1],M1[1],0.72);
  var V0=[vx0,vy0-mh*0.86], V1=[vx1,vy1-mh*0.86], V2=[vx1,vy1-mh*0.22], V3=[vx0,vy0-mh*0.22];
  poliCor([V0,V1,V2,V3], tc([150,196,214],0.9));
  ctx.strokeStyle=tc([22,30,44],0.7); ctx.lineWidth=Math.max(1,1.4*S);
  for(var pr=1;pr<=3;pr++){
    var fr=pr/4;
    linha(lerp(V0[0],V3[0],fr), lerp(V0[1],V3[1],fr), lerp(V1[0],V2[0],fr), lerp(V1[1],V2[1],fr));
  }
  /* produtos nas prateleiras */
  var corProd=[[214,72,68],[240,186,52],[70,150,220],[92,182,110]];
  for(var pl=0;pl<3;pl++){
    for(var pc=0;pc<4;pc++){
      var fu=(pc+0.5)/4, fv=(pl+0.62)/4;
      var ex1=lerp(lerp(V0[0],V1[0],fu), lerp(V3[0],V2[0],fu), fv);
      var ey1=lerp(lerp(V0[1],V1[1],fu), lerp(V3[1],V2[1],fu), fv);
      ctx.fillStyle=tc(corProd[(pl*4+pc)%4],0.92);
      ctx.fillRect(ex1-mh*0.035, ey1-mh*0.055, mh*0.07, mh*0.10);
    }
  }
  /* painel do topo com o letreiro aceso */
  poliCor([sobe(M0,mh),sobe(M1,mh),sobe(M1,mh*0.90),sobe(M0,mh*0.90)], tc([214,72,68],0.85));

  /* --- sofa vermelho, do lado esquerdo --- */
  var sx0=xL+w*0.05, sx1=xL+w*0.55, sf=0.44, sb=0.80;
  var hAs=h*0.075, hEn=h*0.135;                 /* altura do assento / do encosto */
  var A0=ptCh(sx0,sf), A1=ptCh(sx1,sf), A2=ptCh(sx1,sb), A3=ptCh(sx0,sb);
  /* encosto (fica atras, por isso vai primeiro) */
  poliCor([A3,A2,sobe(A2,hAs+hEn),sobe(A3,hAs+hEn)], tc([146,32,34]));
  poliCor([sobe(A3,hAs+hEn),sobe(A2,hAs+hEn),sobe(A2,hAs+hEn-hEn*0.22),sobe(A3,hAs+hEn-hEn*0.22)],
          tc([196,58,54]));
  /* assento */
  poliCor([sobe(A0,hAs),sobe(A1,hAs),sobe(A2,hAs),sobe(A3,hAs)], tc([206,62,58]));
  /* frente do assento */
  poliCor([A0,A1,sobe(A1,hAs),sobe(A0,hAs)], tc([164,40,40]));
  /* risco entre as duas almofadas */
  var mA=ptCh(lerp(sx0,sx1,0.5),sf), mB=ptCh(lerp(sx0,sx1,0.5),sb);
  ctx.strokeStyle=tc([132,28,30],0.8); ctx.lineWidth=Math.max(1,1.6*S);
  linha(mA[0],mA[1]-hAs, mB[0],mB[1]-hAs);
  /* bracos */
  for(var br=0;br<2;br++){
    var bxx=br? sx1 : sx0, lar=(br?-1:1)*w*0.055;
    var Q0=ptCh(bxx,sf), Q1=ptCh(bxx+lar,sf), Q2=ptCh(bxx+lar,sb), Q3=ptCh(bxx,sb);
    var hb2=hAs+hEn*0.52;
    poliCor([sobe(Q0,hb2),sobe(Q1,hb2),sobe(Q2,hb2),sobe(Q3,hb2)], tc([220,76,68]));
    poliCor([Q0,Q1,sobe(Q1,hb2),sobe(Q0,hb2)], tc([178,46,42]));
  }
  ctx.restore();

  /* atmosfera fria interior */
  var gfr=ctx.createLinearGradient(0,topo-dy,0,base);
  gfr.addColorStop(0,'rgba(158,222,255,'+(0.05+0.20*frio)+')');
  gfr.addColorStop(1,'rgba(112,190,240,'+(0.02+0.26*frio)+')');
  ctx.fillStyle=gfr; ctx.fillRect(xL-6,topo-dy-6,w+dx+12,h+dy+12);

  desenharGenteDentro(xL,xR,base,dx,dy);

  /* luz do tecto */
  ctx.save(); ctx.globalCompositeOperation='lighter';
  var corLuz = mixC([255,226,170],[180,234,255], frio);
  var gl2=ctx.createRadialGradient(cab.x+dx*0.45, topo-dy*0.25, 0, cab.x+dx*0.45, topo-dy*0.25, w*0.95);
  gl2.addColorStop(0, css(corLuz, 0.26+0.20*P.noite));
  gl2.addColorStop(1, css(corLuz, 0));
  ctx.fillStyle=gl2; circ(cab.x+dx*0.45, topo-dy*0.25, w*0.95);
  ctx.restore();
  ctx.restore();

  /* ---------------- VIDROS ---------------- */
  poliCor([F2,B2,B3,F3], css(tinta(corVidro), 0.24));        /* lateral direita */
  poliCor([F1,F2,F3,F4], css(tinta(corVidro), 0.19));        /* frente          */

  /* reflexos diagonais */
  ctx.save();
  poli([F1,F2,F3,F4]); ctx.clip();
  ctx.fillStyle='rgba(255,255,255,0.10)';
  poli([[xL+w*0.06,base],[xL+w*0.34,base],[xL+w*0.66,topo],[xL+w*0.38,topo]]); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.06)';
  poli([[xL+w*0.42,base],[xL+w*0.52,base],[xL+w*0.84,topo],[xL+w*0.74,topo]]); ctx.fill();
  ctx.restore();
  ctx.save();
  poli([F2,B2,B3,F3]); ctx.clip();
  ctx.fillStyle='rgba(255,255,255,0.09)';
  poli([[xR+dx*0.05,base],[xR+dx*0.35,base-dy*0.35],[xR+dx*0.55,topo],[xR+dx*0.25,topo]]); ctx.fill();
  ctx.restore();

  /* gelo no vidro quando a refrigeracao aperta */
  if(frio>0.05){
    ctx.save();
    poli([F1,B1,B2,B3,F3,F4]); ctx.clip();
    ctx.strokeStyle='rgba(238,251,255,'+(0.34*frio)+')'; ctx.lineWidth=1.3*S;
    for(var g2=0;g2<40;g2++){
      var ox=xL+((g2*97.3)%(w+dx)), oy=topo-dy+((g2*61.7)%(h+dy));
      for(var b4=0;b4<3;b4++){
        var aa=b4*TAU/3+g2*0.7;
        linha(ox,oy, ox+Math.cos(aa)*10*S, oy+Math.sin(aa)*10*S);
      }
    }
    ctx.fillStyle='rgba(226,246,255,'+(0.10*frio)+')';
    poli([F1,B1,B2,B3,F3,F4]); ctx.fill();
    ctx.restore();
  }

  /* ---------------- PORTA DE MADEIRA (na frente) ---------------- */
  var pw=cab.portaW, ph=cab.portaH, pxx=cab.portaX-pw/2, pyy=base-ph;
  ctx.fillStyle=tc(preto); ctx.fillRect(pxx-4*S,pyy-4*S,pw+8*S,ph+8*S);
  tabuas(pxx,pyy,pw,ph,[168,114,60],[138,88,44],true,4);
  ctx.strokeStyle=tc([72,46,24],0.85); ctx.lineWidth=2.4*S;
  ctx.strokeRect(pxx+pw*0.10,pyy+ph*0.06,pw*0.80,ph*0.36);
  ctx.strokeRect(pxx+pw*0.10,pyy+ph*0.52,pw*0.80,ph*0.38);
  ctx.fillStyle=tc([40,40,46]);
  ctx.fillRect(pxx+2*S,pyy+ph*0.13,pw*0.12,ph*0.05);
  ctx.fillRect(pxx+2*S,pyy+ph*0.80,pw*0.12,ph*0.05);
  ctx.fillStyle=tc([216,198,142]);
  retArred(pxx+pw*0.79,pyy+ph*0.46,pw*0.13,ph*0.05,3); ctx.fill();
  circ(pxx+pw*0.855,pyy+ph*0.49,pw*0.045);
  /* pequena janela redonda na porta */
  ctx.fillStyle=css(tinta(corVidro),0.55);
  circ(pxx+pw*0.50,pyy+ph*0.22,pw*0.16);
  ctx.strokeStyle=tc([70,46,24]); ctx.lineWidth=2.6*S;
  ctx.beginPath(); ctx.arc(pxx+pw*0.50,pyy+ph*0.22,pw*0.16,0,TAU); ctx.stroke();

  /* ---------------- CAIXILHOS ---------------- */
  ctx.strokeStyle=tc(madeira2); ctx.lineWidth=Math.max(3,w*0.022);
  linha(xL+w*0.34, topo+faixaH, xL+w*0.34, base);                 /* montante frontal */
  linha(xL, topo+h*0.62, xR, topo+h*0.62);                        /* travessa frontal */
  linha(xR+dx*0.48, topo+faixaH-dy*0.48, xR+dx*0.48, base-dy*0.48);
  linha(xR, topo+h*0.62, xR+dx, topo+h*0.62-dy);

  /* ---------------- ESTRUTURA EM COMPENSADO ---------------- */
  var esp = Math.max(7, w*0.062);
  ctx.lineJoin='miter';
  ctx.strokeStyle=tc(madeira); ctx.lineWidth=esp;
  poli([F2,B2,B3,F3]); ctx.stroke();
  poli([F1,F2,F3,F4]); ctx.stroke();
  /* veio da madeira nos montantes */
  ctx.strokeStyle=tc(mixC(madeira,[92,60,30],0.45),0.30); ctx.lineWidth=1.2*S;
  for(var v=0;v<10;v++){
    var vy=topo+h*(0.06+v*0.095);
    linha(xL-esp*0.35,vy,xL+esp*0.35,vy+3*S);
    linha(xR-esp*0.35,vy,xR+esp*0.35,vy-3*S);
  }
  /* rodape: uma barra na frente e outra na face lateral */
  ctx.fillStyle=tc(preto);
  ctx.fillRect(xL-esp*0.5, base-esp*0.9, w+esp, esp*0.9);
  poliCor([[xR,base-esp*0.9],[xR+dx,base-dy-esp*0.9],[xR+dx,base-dy],[xR,base]], tc(preto));

  /* ---------------- FAIXA SUPERIOR DE ESTRUTURA ---------------- */
  poliCor([F1,F2,[xR,topo+faixaH],[xL,topo+faixaH]], tc(madeira));
  tabuas(xL,topo,w,faixaH,madeira,madeira2,true,6);
  poliCor([F2,B2,[xR+dx,topo-dy+faixaH],[xR,topo+faixaH]], tc(mixC(madeira,[0,0,0],0.26)));
  /* sombreado da faixa */
  var gfx=ctx.createLinearGradient(xL,0,xR,0);
  gfx.addColorStop(0,'rgba(0,0,0,0.26)'); gfx.addColorStop(0.4,'rgba(0,0,0,0)');
  gfx.addColorStop(1,'rgba(0,0,0,0.22)');
  ctx.fillStyle=gfx; ctx.fillRect(xL,topo,w,faixaH);

  /* ---------------- ARESTAS PRETAS ---------------- */
  ctx.strokeStyle=tc(preto); ctx.lineWidth=Math.max(2.5,esp*0.34);
  poli([F1,B1,B2,B3,F3,F4]); ctx.stroke();
  poli([F1,F2,F3,F4]); ctx.stroke();
  poli([F2,B2,B3,F3]); ctx.stroke();
  linha(xL,topo+faixaH,xR,topo+faixaH);
  linha(xR,topo+faixaH,xR+dx,topo+faixaH-dy);
  /* cantoneiras */
  ctx.fillStyle=tc([12,12,15]);
  var cw=esp*1.5;
  ctx.fillRect(xL-esp*0.5,topo-esp*0.2,cw,cw);
  ctx.fillRect(xR-cw+esp*0.5,topo-esp*0.2,cw,cw);
  ctx.fillRect(xL-esp*0.5,base-cw,cw,cw);
  ctx.fillRect(xR-cw+esp*0.5,base-cw,cw,cw);
  /* parafusos */
  ctx.fillStyle=tc([156,158,164],0.85);
  for(var s=0;s<7;s++){
    circ(xL, topo+h*(0.09+s*0.135), 1.9*S);
    circ(xR, topo+h*(0.09+s*0.135), 1.9*S);
  }

  /* ---------------- TAMPO / TELHADO ---------------- */
  var telha=h*0.070, beiral=w*0.075;
  var subidaTampa = cab.tampa*h*0.52;
  var R1=[xL-beiral,topo-telha-subidaTampa], R2=[xR+beiral,topo-telha-subidaTampa];
  var R3=[xR+beiral+dx,topo-telha-dy], R4=[xL-beiral+dx,topo-telha-dy];
  var F1t=[xL-beiral,topo-subidaTampa], F2t=[xR+beiral,topo-subidaTampa];
  poliCor([R1,R2,R3,R4], tc([52,52,60]));
  poliCor([R1,R2,F2t,F1t], tc(preto));
  poliCor([R2,R3,[xR+beiral+dx,topo-dy],F2t], tc([30,30,36]));
  ctx.strokeStyle=tc([88,90,98],0.6); ctx.lineWidth=1.4*S;
  for(var tl=1;tl<4;tl++){
    var f2=tl/4;
    linha(lerp(R1[0],R2[0],f2), R1[1], lerp(R4[0],R3[0],f2), R4[1]);
  }
  if(P.neveChao>0.02){
    poliCor([[R1[0],R1[1]-4*S],[R2[0],R2[1]-4*S],[R3[0],R3[1]-4*S],[R4[0],R4[1]-4*S]],
            tc([246,251,255],P.neveChao*0.95));
  }
  if(cab.tampa>0.02){
    ctx.strokeStyle=tc([30,30,36], cab.tampa);
    ctx.lineWidth=Math.max(2*S,3);
    linha(xL-beiral,topo, F1t[0],F1t[1]);
    linha(xR+beiral,topo, F2t[0],F2t[1]);
  }

  /* ---------------- VENTOINHAS NA PAREDE LATERAL VISIVEL ----------------
     As duas unidades ficam do mesmo lado - a face lateral direita, a
     que se ve - montadas lado a lado ao longo da fuga: uma junto a
     aresta frontal, outra mais atras. Sao desenhadas no plano dessa
     face, por isso aparecem encurtadas e inclinadas com a fuga do
     volume - nao na fachada. */
  var prof = Math.hypot(dx,dy) || 1;
  var ex = dx/prof, ey = -dy/prof;         /* direccao da profundidade */
  var rv = Math.min(prof*0.30, faixaH*0.40);
  var tA = 0.26, tB = 0.74;                /* posicao ao longo da fuga */
  cab.ventEsq = [xR + dx*tA, topo - dy*tA + faixaH*0.55];
  cab.ventDir = [xR + dx*tB, topo - dy*tB + faixaH*0.55];

  function unidadeLateral(cx,cy,sentido){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.transform(ex*0.74, ey*0.74, 0, 1, 0, 0);   /* plano da parede lateral */
    /* caixa da unidade */
    ctx.fillStyle=tc(preto);
    retArred(-rv*1.34,-rv*1.34, rv*2.68, rv*2.68, rv*0.28); ctx.fill();
    ctx.fillStyle=tc([58,60,68]);
    retArred(-rv*1.18,-rv*1.18, rv*2.36, rv*2.36, rv*0.22); ctx.fill();
    ventoinha(0,0, rv, giroVent*sentido, 1);
    ctx.fillStyle=tc([152,154,160],0.8);
    circ(-rv*1.16,-rv*1.16,1.8*S); circ(rv*1.16,-rv*1.16,1.8*S);
    circ(-rv*1.16, rv*1.16,1.8*S); circ(rv*1.16, rv*1.16,1.8*S);
    ctx.restore();
  }
  /* ambas assentes na face lateral visivel */
  unidadeLateral(cab.ventEsq[0], cab.ventEsq[1], -1);
  unidadeLateral(cab.ventDir[0], cab.ventDir[1],  1);

  /* grelha de extraccao mais abaixo, na face lateral visivel */
  var gx = xR + dx*0.50, gy3 = topo - dy*0.50 + h*0.50;
  ctx.save(); ctx.translate(gx,gy3); ctx.transform(ex*0.74, ey*0.74, 0, 1, 0, 0);
  ctx.fillStyle=tc([18,18,22]);
  retArred(-rv*0.92,-rv*0.62, rv*1.84, rv*1.24, rv*0.14); ctx.fill();
  ctx.strokeStyle=tc([122,126,136],0.75); ctx.lineWidth=Math.max(1,1.6*S);
  for(var gr=0;gr<4;gr++){
    var yy2 = -rv*0.40 + gr*rv*0.30;
    linha(-rv*0.76, yy2, rv*0.76, yy2);
  }
  ctx.restore();

  /* ---------------- PLACA DO LOGO ---------------- */
  var lw=w*0.76, lh=faixaH*0.72, lx=cab.x-lw/2, ly=topo+faixaH*0.14;
  ctx.fillStyle=tc(preto);
  retArred(lx-3*S,ly-3*S,lw+6*S,lh+6*S,lh*0.18); ctx.fill();
  var gl=ctx.createLinearGradient(lx,ly,lx,ly+lh);
  gl.addColorStop(0,tc([252,248,240])); gl.addColorStop(1,tc([224,216,200]));
  ctx.fillStyle=gl; retArred(lx,ly,lw,lh,lh*0.15); ctx.fill();
  /* arvore (simbolo da marca, no lugar do antigo raio) */
  var bs=lh*0.28, bx=lx+lw*0.095, by2=ly+lh*0.42;
  ctx.lineWidth=1.1*S;
  /* tronco - desenhado primeiro para a copa o tapar em cima */
  ctx.fillStyle=tc([132,92,50]);
  ctx.beginPath();
  ctx.moveTo(bx-bs*0.13, by2+bs*0.20);
  ctx.lineTo(bx-bs*0.19, by2+bs*0.98);
  ctx.lineTo(bx+bs*0.19, by2+bs*0.98);
  ctx.lineTo(bx+bs*0.13, by2+bs*0.20);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle=tc([84,56,26],0.85); ctx.stroke();
  /* copa */
  ctx.fillStyle=tc([64,158,84]);
  ctx.beginPath();
  ctx.moveTo(bx, by2-bs*1.02);
  ctx.quadraticCurveTo(bx+bs*0.62, by2-bs*0.92, bx+bs*0.66, by2-bs*0.34);
  ctx.quadraticCurveTo(bx+bs*0.98, by2-bs*0.10, bx+bs*0.54, by2+bs*0.20);
  ctx.quadraticCurveTo(bx+bs*0.22, by2+bs*0.34, bx,          by2+bs*0.30);
  ctx.quadraticCurveTo(bx-bs*0.22, by2+bs*0.34, bx-bs*0.54, by2+bs*0.20);
  ctx.quadraticCurveTo(bx-bs*0.98, by2-bs*0.10, bx-bs*0.66, by2-bs*0.34);
  ctx.quadraticCurveTo(bx-bs*0.62, by2-bs*0.92, bx,          by2-bs*1.02);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle=tc([28,92,44],0.8); ctx.stroke();
  /* brilho na copa */
  ctx.fillStyle=tc([132,206,128],0.55);
  elipse(bx-bs*0.22, by2-bs*0.50, bs*0.28, bs*0.19, -0.5);
  /* texto */
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle=tc([26,104,52]);
  ctx.font='700 '+(lh*0.40)+'px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  ctx.fillText('TAC TAC', lx+lw*0.58, ly+lh*0.40);
  ctx.fillStyle=tc([76,150,86]);
  ctx.font='600 '+(lh*0.22)+'px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  ctx.fillText('E N E R G I A', lx+lw*0.58, ly+lh*0.78);

  /* ---------------- FRESTA DE FRIO POR BAIXO DA PORTA ---------------- */
  if(frio>0.03){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    var gfp=ctx.createLinearGradient(0,base-esp,0,base+18*S);
    gfp.addColorStop(0,'rgba(172,236,255,'+(0.32*frio)+')');
    gfp.addColorStop(1,'rgba(172,236,255,0)');
    ctx.fillStyle=gfp; ctx.fillRect(pxx-8*S,base-esp,pw+16*S,22*S);
    ctx.restore();
  }

  /* ---------------- PLACA DE PARAGEM ---------------- */
  var pox = xL - w*0.30;
  ctx.strokeStyle=tc([72,76,86]); ctx.lineWidth=4*S;
  linha(pox,base,pox,base-h*0.62);
  ctx.fillStyle=tc([28,74,144]);
  retArred(pox-16*S, base-h*0.62-24*S, 32*S, 27*S, 5*S); ctx.fill();
  ctx.strokeStyle=tc([240,240,240],0.9); ctx.lineWidth=2*S;
  retArred(pox-16*S, base-h*0.62-24*S, 32*S, 27*S, 5*S); ctx.stroke();
  ctx.fillStyle=tc([245,245,248]);
  ctx.fillRect(pox-10*S, base-h*0.62-17*S, 20*S, 9*S);
  ctx.fillStyle=tc([28,74,144]);
  ctx.fillRect(pox-8*S, base-h*0.62-15*S, 4*S, 5*S);
  ctx.fillRect(pox-1*S, base-h*0.62-15*S, 4*S, 5*S);
  ctx.fillRect(pox+6*S, base-h*0.62-15*S, 3*S, 5*S);
  ctx.fillStyle=tc([40,42,48]);
  circ(pox-8*S, base-h*0.62-6*S, 2.2*S); circ(pox+8*S, base-h*0.62-6*S, 2.2*S);

  /* ---------------- HALO DA LUZ INTERIOR ---------------- */
  ctx.save(); ctx.globalCompositeOperation='lighter';
  var ci=mixC([255,214,140],[152,222,255],frio);
  var gi=ctx.createRadialGradient(cab.x+dx*0.4, topo+h*0.55, 0, cab.x+dx*0.4, topo+h*0.55, w*1.25);
  gi.addColorStop(0, css(ci, 0.14*(0.35+P.noite*0.95)));
  gi.addColorStop(1, css(ci, 0));
  ctx.fillStyle=gi; circ(cab.x+dx*0.4, topo+h*0.55, w*1.25);
  ctx.restore();
}

/* =====================================================================
   10) PESSOAS
   ===================================================================== */
function desenharPessoa(p){
  if(!p.visivel || p.alpha<=0.01) return;
  var h = 76*S*p.esc, y=p.base, x=p.x;
  var and = Math.sin(p.passo)*0.55;
  var lev = Math.abs(Math.sin(p.passo))*h*0.02;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  sombra(x, y+2*S, h*0.20, 0.9-P.neveChao*0.4);
  ctx.translate(x, y-lev);

  var agasalho = clamp(1-suave(6,20,P.t),0,1);
  var casaco = tinta(p.casaco);
  var calca  = tinta(p.calca);

  /* pernas */
  ctx.strokeStyle = css(calca); ctx.lineWidth = h*0.085; ctx.lineCap='round';
  linha(0,-h*0.42, and*h*0.16, 0);
  linha(0,-h*0.42, -and*h*0.16, 0);
  /* sapatos */
  ctx.strokeStyle = css(mixC(calca,[0,0,0],0.5)); ctx.lineWidth=h*0.07;
  linha(and*h*0.16,-h*0.01, and*h*0.16+p.dir*h*0.07,-h*0.01);
  linha(-and*h*0.16,-h*0.01, -and*h*0.16+p.dir*h*0.07,-h*0.01);
  /* tronco / casaco */
  ctx.fillStyle = css(casaco);
  retArred(-h*0.115, -h*0.80, h*0.23, h*0.42, h*0.06); ctx.fill();
  if(agasalho>0.3){
    ctx.fillStyle = css(mixC(casaco,[255,255,255],0.22), agasalho);
    ctx.fillRect(-h*0.115,-h*0.50,h*0.23,h*0.055);
  }
  /* bracos */
  ctx.strokeStyle = css(mixC(casaco,[0,0,0],0.12)); ctx.lineWidth=h*0.065;
  linha(-h*0.09,-h*0.72, -h*0.09-and*h*0.12, -h*0.46);
  linha( h*0.09,-h*0.72,  h*0.09+and*h*0.12, -h*0.46);
  /* cachecol */
  if(agasalho>0.25){
    ctx.fillStyle = css(mixC([220,70,70], casaco, 0.25), agasalho);
    ctx.fillRect(-h*0.10,-h*0.84,h*0.20,h*0.055);
    ctx.fillRect(h*0.03,-h*0.84, h*0.05, h*0.16*agasalho);
  }
  /* cabeca */
  ctx.fillStyle = css(tinta(p.pele));
  circ(0,-h*0.90, h*0.088);
  /* gorro ou cabelo */
  if(p.gorro && agasalho>0.25){
    ctx.fillStyle = css(mixC(casaco,[255,255,255],0.30), 1);
    ctx.beginPath(); ctx.arc(0,-h*0.915,h*0.098,Math.PI,0); ctx.fill();
    ctx.fillRect(-h*0.098,-h*0.925,h*0.196,h*0.035);
    ctx.fillStyle = css(mixC(casaco,[255,255,255],0.55));
    circ(0,-h*1.015,h*0.030);
  } else {
    ctx.fillStyle = css([46,36,32].map(function(v,i){ return v*LUZ[i]; }));
    ctx.beginPath(); ctx.arc(0,-h*0.905,h*0.092,Math.PI*1.05,Math.PI*1.95); ctx.fill();
  }
  /* baforada de frio */
  if(P.t<8 && Math.sin(p.passo*0.5)>0.7){
    ctx.fillStyle='rgba(230,245,255,0.30)';
    circ(p.dir*h*0.13,-h*0.88, h*0.05);
  }
  ctx.restore();
  ctx.globalAlpha=1;
}

/* =====================================================================
   11) CARROS
   ===================================================================== */
function novoCarro(jaNaRua){
  var r=Math.random();
  var faixa = r<0.5?0:1;
  var dir = faixa===0?1:-1;
  var y = faixa===0 ? L.ruaTopo + (L.ruaBase-L.ruaTopo)*0.36
                    : L.ruaTopo + (L.ruaBase-L.ruaTopo)*0.80;
  var esc = faixa===0?0.86:1.06;
  var cores=[[206,58,54],[42,92,178],[236,236,240],[36,38,44],[228,166,44],[64,150,120],[150,152,158]];
  carros.push({
    x: jaNaRua ? W*(0.1+Math.random()*0.8) : (dir>0? -240*S : W+240*S), y:y, dir:dir, esc:esc,
    v: (110+Math.random()*90)*(0.6+0.6*esc),
    cor: cores[(Math.random()*cores.length)|0],
    tipo: Math.random()<0.25?1:0
  });
}
function desenharCarro(c){
  var w = 150*S*c.esc, h = 46*S*c.esc;
  var x=c.x, y=c.y;
  ctx.save(); ctx.translate(x,y); ctx.scale(c.dir,1);
  sombra(0, h*0.52, w*0.46, 0.95);
  var cor = tinta(c.cor);
  /* corpo */
  var g=ctx.createLinearGradient(0,-h*0.6,0,h*0.5);
  g.addColorStop(0, css(mixC(cor,[255,255,255],0.28)));
  g.addColorStop(0.55, css(cor));
  g.addColorStop(1, css(mixC(cor,[0,0,0],0.35)));
  ctx.fillStyle=g;
  retArred(-w/2,-h*0.36,w,h*0.80,h*0.26); ctx.fill();
  /* tejadilho */
  ctx.fillStyle = css(mixC(cor,[255,255,255],0.10));
  ctx.beginPath();
  ctx.moveTo(-w*0.28, -h*0.34);
  ctx.lineTo(-w*0.16, -h*(c.tipo?0.95:0.78));
  ctx.lineTo( w*0.14, -h*(c.tipo?0.95:0.78));
  ctx.lineTo( w*0.30, -h*0.34);
  ctx.closePath(); ctx.fill();
  /* vidros */
  ctx.fillStyle = css(mixC([140,190,215],[30,44,60], 1-clamp(P.noite,0,1)*0.2), 0.88);
  ctx.beginPath();
  ctx.moveTo(-w*0.24,-h*0.38);
  ctx.lineTo(-w*0.145,-h*(c.tipo?0.88:0.72));
  ctx.lineTo( w*0.12,-h*(c.tipo?0.88:0.72));
  ctx.lineTo( w*0.26,-h*0.38);
  ctx.closePath(); ctx.fill();
  /* rodas */
  ctx.fillStyle='rgba(16,16,20,0.95)';
  circ(-w*0.28, h*0.40, h*0.30); circ(w*0.28, h*0.40, h*0.30);
  ctx.fillStyle = css(tinta([170,174,182]));
  circ(-w*0.28, h*0.40, h*0.13); circ(w*0.28, h*0.40, h*0.13);
  /* luzes */
  var noiteL = clamp(P.noite*1.4,0.12,1);
  ctx.save(); ctx.globalCompositeOperation='lighter';
  var gf=ctx.createRadialGradient(w*0.47,h*0.02,0,w*0.47,h*0.02,w*0.55);
  gf.addColorStop(0,'rgba(255,242,190,'+(0.75*noiteL)+')');
  gf.addColorStop(1,'rgba(255,242,190,0)');
  ctx.fillStyle=gf; circ(w*0.47,h*0.02,w*0.55);
  ctx.restore();
  ctx.fillStyle='rgba(255,246,200,'+(0.5+0.5*noiteL)+')';
  retArred(w*0.42,-h*0.10,w*0.06,h*0.16,2); ctx.fill();
  ctx.fillStyle='rgba(255,70,60,'+(0.45+0.55*noiteL)+')';
  retArred(-w*0.48,-h*0.10,w*0.05,h*0.16,2); ctx.fill();
  ctx.restore();
}

/* =====================================================================
   12) PARTICULAS
   ===================================================================== */
function novaParticula(o){ if(particulas.length<900) particulas.push(o); }

function soltarFolhas(a, qtd, ambiente){
  var A=a.alt;
  var disponiveis = Math.floor(a.copa.length*clamp(P.folhas,0,1));
  for(var i=0;i<qtd;i++){
    var f = a.copa[(Math.random()*Math.max(1,disponiveis))|0];
    if(!f) continue;
    novaParticula({ tipo:'folha', x:a.x+f.x*A, y:a.base+f.y*A,
      vx:(Math.random()-0.5)*40, vy:10+Math.random()*30,
      ang:Math.random()*TAU, vang:(Math.random()-0.5)*4,
      r:f.r*A, tom:f.tom, vida:1, dur:3.4+Math.random()*2.4, alvoY:a.base+6*S });
  }
  if(ambiente) return;
  a.extraChao = clamp(a.extraChao+0.30,0,1);
  a.tremor = 1;
}


function atualizarParticulas(dt){
  for(var i=particulas.length-1;i>=0;i--){
    var p=particulas[i];
    p.vida -= dt/p.dur;
    if(p.vida<=0){ particulas.splice(i,1); continue; }

    if(p.tipo==='folha'){
      p.vy += 28*dt;
      p.vy = Math.min(p.vy, 70);
      p.vx += Math.sin(tempo*2.4+p.ang)*36*dt;
      p.x += (p.vx + P.ventoGelado*40)*dt; p.y += p.vy*dt;
      p.ang += p.vang*dt;
      if(p.y>p.alvoY){ p.y=p.alvoY; p.vy*=-0.18; p.vx*=0.6; p.vang*=0.4; }
    } else if(p.tipo==='gota'){
      p.vy += 480*dt; p.y += p.vy*dt;
    } else if(p.tipo==='faisca'){
      p.vy -= 130*dt; p.vx += (Math.random()-0.5)*70*dt;
      p.x += p.vx*dt; p.y += p.vy*dt;
    } else if(p.tipo==='fumo'){
      p.vy -= 26*dt; p.x += (p.vx + 16)*dt; p.y += p.vy*dt; p.r += 22*dt*S;
    } else if(p.tipo==='vapor'){
      p.vy += 34*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.r += 20*dt*S;
    } else if(p.tipo==='vento'){
      p.x += p.vx*dt; p.y += p.vy*dt;
      if(p.x>W+120||p.x<-120){ particulas.splice(i,1); continue; }
    }
  }
}

function desenharParticulas(){
  for(var i=0;i<particulas.length;i++){
    var p=particulas[i], a=clamp(p.vida,0,1);
    if(p.tipo==='folha'){
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.ang);
      ctx.fillStyle = tc(corFolha(p.tom), a*0.95);
      elipse(0,0,p.r,p.r*0.46,0);
      ctx.restore();
    } else if(p.tipo==='gota'){
      ctx.fillStyle='rgba(190,232,255,'+(a*0.85)+')';
      elipse(p.x,p.y,p.r*0.6,p.r*1.5,0);
    } else if(p.tipo==='faisca'){
      ctx.save(); ctx.globalCompositeOperation='lighter';
      ctx.fillStyle='rgba(255,'+(140+90*a|0)+',60,'+(a*0.9)+')';
      circ(p.x,p.y,p.r*a); ctx.restore();
    } else if(p.tipo==='fumo'){
      ctx.fillStyle='rgba(60,56,58,'+(a*0.16)+')';
      circ(p.x,p.y,p.r);
    } else if(p.tipo==='vapor'){
      ctx.fillStyle='rgba(206,240,255,'+(a*0.26*clamp(P.frioCabine,0,1))+')';
      circ(p.x,p.y,p.r);
    } else if(p.tipo==='vento'){
      ctx.strokeStyle='rgba(216,244,255,'+(a*p.op)+')';
      ctx.lineWidth=p.r; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(p.x,p.y);
      ctx.quadraticCurveTo(p.x-p.comp*0.5, p.y-6*S, p.x-p.comp, p.y+3*S);
      ctx.stroke();
    }
  }
}

/* neve de fundo */
function atualizarNeve(dt){
  if(P.neve<=0.005) return;
  for(var i=0;i<neve.length;i++){
    var s=neve[i];
    s.y += s.v*dt;
    s.x += Math.sin(tempo*0.8 + s.f)*s.osc*dt + 14*dt;
    if(s.y>H+6){ s.y=-8; s.x=Math.random()*W; }
    if(s.x>W+8) s.x=-8; else if(s.x<-8) s.x=W+8;
  }
}
function desenharNeve(){
  if(P.neve<=0.005) return;
  ctx.fillStyle='#ffffff';
  var lim = Math.floor(neve.length*P.neve);
  for(var i=0;i<lim;i++){
    var s=neve[i];
    ctx.globalAlpha = P.neve*(0.42+0.55*(s.r/(3.6*S)));
    if(s.r<1.8*S) ctx.fillRect(s.x-s.r,s.y-s.r,s.r*2,s.r*2);
    else circ(s.x,s.y,s.r);
  }
  ctx.globalAlpha=1;
}

/* =====================================================================
   13) VENTO GELADO / CALOR
   ===================================================================== */
function ventoGelado(dt){
  if(P.ventoGelado<0.05) return;
  if(Math.random() < P.ventoGelado*dt*26){
    novaParticula({ tipo:'vento', x:-100, y:H*(0.20+Math.random()*0.68),
      vx:(320+Math.random()*420), vy:(Math.random()-0.5)*24,
      r:(1+Math.random()*2.2)*S, comp:(70+Math.random()*160)*S,
      op:0.30*P.ventoGelado, vida:1, dur:2.6 });
  }
}
function ondasCalor(){
  if(P.calor<0.05) return;
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  for(var i=0;i<7;i++){
    var y = L.relva + (H-L.relva)*(i/7) + Math.sin(tempo*1.4+i)*4*S;
    var g = ctx.createLinearGradient(0,y-10*S,0,y+10*S);
    g.addColorStop(0,'rgba(255,150,60,0)');
    g.addColorStop(0.5,'rgba(255,158,70,'+(0.045*P.calor)+')');
    g.addColorStop(1,'rgba(255,150,60,0)');
    ctx.fillStyle=g; ctx.fillRect(0,y-10*S,W,20*S);
  }
  ctx.restore();
  /* velatura quente global */
  ctx.fillStyle='rgba(255,146,44,'+(0.09*P.calor)+')';
  ctx.fillRect(0,0,W,H);
}
function veuFrio(){
  var f = clamp(1-suave(-2,14,P.t),0,1);
  if(f<=0.02) return;
  ctx.fillStyle='rgba(96,150,220,'+(0.16*f)+')';
  ctx.fillRect(0,0,W,H);
}

/* =====================================================================
   14) DOIS FLOCOS DE NEVE GIGANTES (canto inf. esq. + sup. dir.)
   ===================================================================== */
function flocoGigante(cx,cy,R,rot,alpha,derret){
  if(alpha<=0.01) return;
  ctx.save();
  ctx.translate(cx,cy); ctx.rotate(rot);
  var Rr = R*(1-0.30*derret);
  var cor = mixC([232,248,255],[150,206,240], derret*0.6);

  /* brilho */
  ctx.save(); ctx.globalCompositeOperation='lighter';
  var g=ctx.createRadialGradient(0,0,0,0,0,Rr*1.5);
  g.addColorStop(0,'rgba(190,235,255,'+(0.20*alpha*(1-derret*0.6))+')');
  g.addColorStop(1,'rgba(190,235,255,0)');
  ctx.fillStyle=g; circ(0,0,Rr*1.5);
  ctx.restore();

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = css(cor, 0.92);
  ctx.lineCap='round'; ctx.lineJoin='round';
  for(var i=0;i<6;i++){
    ctx.save(); ctx.rotate(i*Math.PI/3);
    ctx.lineWidth = R*0.050*(1-derret*0.35);
    linha(0,0,0,-Rr);
    var bracos=[0.34,0.55,0.76];
    for(var b=0;b<3;b++){
      var f=bracos[b];
      var comp = Rr*0.30*(1-f*0.45)*(1-derret*0.55);
      ctx.lineWidth = R*0.034*(1-derret*0.4);
      linha(0,-Rr*f,  comp*0.86, -Rr*f-comp*0.72);
      linha(0,-Rr*f, -comp*0.86, -Rr*f-comp*0.72);
      ctx.lineWidth = R*0.020*(1-derret*0.4);
      linha(comp*0.86,-Rr*f-comp*0.72, comp*1.10,-Rr*f-comp*1.16);
      linha(-comp*0.86,-Rr*f-comp*0.72,-comp*1.10,-Rr*f-comp*1.16);
    }
    ctx.lineWidth = R*0.030*(1-derret*0.4);
    linha(0,-Rr, Rr*0.14,-Rr*0.84);
    linha(0,-Rr,-Rr*0.14,-Rr*0.84);
    ctx.restore();
  }
  /* nucleo hexagonal */
  ctx.beginPath();
  for(var k=0;k<6;k++){
    var a=k*Math.PI/3-Math.PI/2, rr=Rr*0.15;
    if(k===0) ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr); else ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);
  }
  ctx.closePath();
  ctx.fillStyle = css(cor, 0.35); ctx.fill();
  ctx.lineWidth=R*0.030; ctx.stroke();

  /* poça / derretimento */
  if(derret>0.05){
    ctx.fillStyle='rgba(150,205,240,'+(0.20*alpha*derret)+')';
    elipse(0, Rr*0.95, Rr*(0.5+0.6*derret), Rr*0.10*derret, 0);
  }
  ctx.restore();
  ctx.globalAlpha=1;

  /* gotas a pingar */
  if(derret>0.10 && alpha>0.15 && Math.random()<0.30){
    var ang=Math.random()*TAU, d=Rr*(0.3+Math.random()*0.7);
    novaParticula({ tipo:'gota', x:cx+Math.cos(ang)*d, y:cy+Math.abs(Math.sin(ang))*d*0.6,
      vy:20, r:(2+Math.random()*2.4)*S, vida:1, dur:1.4+Math.random() });
  }
}

function desenharFlocosGigantes(){
  var a = P.flocoGigante;
  if(a<=0.01) return;
  var R = Math.min(W,H)*0.21;
  flocoGigante(W*0.145, H*0.775, R, tempo*0.06, a*0.92, P.derretido);
  flocoGigante(W*0.855, H*0.215, R*0.92, -tempo*0.05+0.6, a*0.92, P.derretido);
}

/* =====================================================================
   15) VAPOR FRIO DA CABINE
   ===================================================================== */
function vaporCabine(dt){
  if(P.frioCabine<0.05) return;
  var w=cab.w, h=cab.h, x=cab.x, y=cab.baseY, topo=y-h;
  var taxa = P.frioCabine*P.frioCabine*dt*72;
  /* quantos emitir neste frame - parte inteira + resto por sorteio,
     para o caudal poder passar de uma particula por frame */
  function quantas(q){ return Math.floor(q) + (Math.random() < (q%1) ? 1 : 0); }

  /* sopro que sai de cada ventoinha - ambas na face lateral visivel,
     por isso o ar sai sempre para o mesmo lado */
  if(cab.ventEsq){
    var nv = quantas(taxa);
    for(var e=0;e<nv;e++){
      var v = Math.random()<0.5 ? cab.ventEsq : cab.ventDir;
      novaParticula({ tipo:'vapor',
        x:v[0]+(Math.random()-0.5)*10*S, y:v[1]+h*0.05+(Math.random()-0.5)*14*S,
        vx:66+Math.random()*130, vy:30+Math.random()*74,
        r:(5+Math.random()*9)*S, vida:1, dur:1.7+Math.random()*1.3 });
    }
  }
  /* rajada que escapa pela porta e escorre para a calcada */
  var np = quantas(taxa*0.9);
  for(var e2=0;e2<np;e2++){
    novaParticula({ tipo:'vapor', x:cab.portaX+(Math.random()-0.5)*cab.portaW, y:y-6*S,
      vx:(Math.random()-0.35)*88, vy:6+Math.random()*30,
      r:(8+Math.random()*13)*S, vida:1, dur:2.0+Math.random()*1.4 });
  }
  /* fuga pelas frinchas do tejadilho */
  var nt = quantas(taxa*0.35);
  for(var e3=0;e3<nt;e3++){
    novaParticula({ tipo:'vapor', x:x+(Math.random()-0.5)*w*0.9, y:topo+h*0.04,
      vx:(Math.random()-0.3)*50, vy:26+Math.random()*40,
      r:(4+Math.random()*7)*S, vida:1, dur:1.5+Math.random()*1.0 });
  }

  ctx.save(); ctx.globalCompositeOperation='lighter';
  /* poca de ar frio que se acumula a volta da base */
  var gb=ctx.createRadialGradient(x, y, w*0.10, x, y, w*1.35);
  gb.addColorStop(0,'rgba(160,228,255,'+(0.12*P.frioCabine)+')');
  gb.addColorStop(0.55,'rgba(150,222,255,'+(0.05*P.frioCabine)+')');
  gb.addColorStop(1,'rgba(150,222,255,0)');
  ctx.fillStyle=gb;
  ctx.fillRect(x-w*1.4, y-h*0.30, w*2.8, h*0.42);

  /* cortinas de ar frio junto ao chao */
  for(var i=0;i<7;i++){
    var yy = y - 8*S + i*5*S;
    var g=ctx.createLinearGradient(x-w*1.2,0,x+w*1.2,0);
    g.addColorStop(0,'rgba(150,225,255,0)');
    g.addColorStop(0.5,'rgba(150,225,255,'+(0.11*P.frioCabine)+')');
    g.addColorStop(1,'rgba(150,225,255,0)');
    ctx.fillStyle=g;
    ctx.fillRect(x-w*1.2, yy+Math.sin(tempo*2+i)*2.5*S, w*2.4, 4*S);
  }
  ctx.restore();
}

/* =====================================================================
   16) LOGICA: PESSOAS, CARROS, ARVORES
   ===================================================================== */
function gerirPessoas(dt){
  relogioPessoas -= dt;
  var t = valorSuave;
  var alvoDentro = Math.round(5*suave(21,37,t));
  var alvoFila   = Math.round(4*P.fila);          /* bicha so no calor extremo */
  var alvoRua    = Math.round((1 + 5*suave(1,14,t)) * (1 - 0.80*suave(26,40,t)));
  alvoRua = clamp(alvoRua, 0, pessoas.length-alvoDentro-alvoFila);

  if(relogioPessoas<=0){
    relogioPessoas = 0.28;
    var nDentro=0, nRua=0, nFila=0, i, p;
    for(i=0;i<pessoas.length;i++){
      if(pessoas[i].alvo==='dentro') nDentro++;
      else if(pessoas[i].alvo==='rua') nRua++;
      else if(pessoas[i].alvo==='fila') nFila++;
    }
    if(nDentro<alvoDentro){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo!=='dentro'){ pessoas[i].alvo='dentro'; break; } }
    } else if(nDentro>alvoDentro){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo==='dentro'){ pessoas[i].alvo = (nFila<alvoFila?'fila':(nRua<alvoRua?'rua':'fora')); pessoas[i].entrouFila=tempo; break; } }
    } else if(nFila<alvoFila){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo==='fora'||pessoas[i].alvo==='rua'){ pessoas[i].alvo='fila'; pessoas[i].entrouFila=tempo; break; } }
    } else if(nFila>alvoFila){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo==='fila'){ pessoas[i].alvo=(nRua<alvoRua?'rua':'fora'); break; } }
    } else if(nRua<alvoRua){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo==='fora'){ pessoas[i].alvo='rua'; break; } }
    } else if(nRua>alvoRua){
      for(i=0;i<pessoas.length;i++){ if(pessoas[i].alvo==='rua'){ pessoas[i].alvo='fora'; break; } }
    }
  }

  /* ---- ordem da bicha: quem espera ha mais tempo fica a frente ---- */
  var naFila=[];
  for(var q=0;q<pessoas.length;q++) if(pessoas[q].alvo==='fila') naFila.push(pessoas[q]);
  naFila.sort(function(A,B){ return A.entrouFila-B.entrouFila; });
  for(var q2=0;q2<naFila.length;q2++) naFila[q2].slotFila=q2;

  /* ---- a bicha anda: o da frente entra, alguem sai e vai para o fim ---- */
  relogioFila -= dt;
  if(alvoFila>0 && relogioFila<=0 && naFila.length){
    relogioFila = 4.2;
    var saiu=null;
    for(var s2=0;s2<pessoas.length;s2++){ if(pessoas[s2].alvo==='dentro'&&pessoas[s2].dentro){ saiu=pessoas[s2]; break; } }
    if(saiu){
      naFila[0].alvo='dentro';
      saiu.alvo='fila'; saiu.entrouFila=tempo; saiu.dentro=false;
      saiu.visivel=true; saiu.x=cab.portaX; saiu.alpha=0; saiu.slotFila=naFila.length-1;
    }
  }

  for(var k=0;k<pessoas.length;k++){
    var pe=pessoas[k];
    var vel = pe.vel*(1 + P.calor*0.25 + (1-suave(0,12,t))*0.15);

    if(pe.alvo==='dentro'){
      if(!pe.dentro){
        if(!pe.visivel){ pe.visivel=true; pe.x = cab.portaX + (Math.random()<0.5?-1:1)*W*0.22; pe.alpha=0; }
        pe.alpha = Math.min(1, pe.alpha + dt*2.2);
        var d = cab.portaX - pe.x;
        pe.dir = d>0?1:-1;
        pe.x += pe.dir*vel*dt;
        pe.passo += dt*8;
        if(Math.abs(d) < 8*S){ pe.dentro=true; }
        if(Math.abs(d) < 60*S){ pe.alpha = clamp(Math.abs(d)/(60*S),0,1); }
      } else { pe.alpha=0; pe.visivel=false; }
    } else if(pe.alvo==='fila'){
      /* bicha a porta da cabine: caminha ate ao seu lugar e espera,
         virado para a porta, com um pequeno balancear de quem aguarda */
      pe.dentro=false;
      if(!pe.visivel){
        pe.visivel=true; pe.alpha=0;
        pe.x = cab.portaX - W*(0.28+Math.random()*0.14);
      }
      pe.alpha = Math.min(1, pe.alpha + dt*1.8);
      var alvoX = cab.portaX - (40 + pe.slotFila*44)*S;
      var df = alvoX - pe.x;
      if(Math.abs(df) > 3*S){
        pe.dir = df>0?1:-1;
        pe.x += pe.dir*Math.min(vel*dt, Math.abs(df));
        pe.passo += dt*8;
      } else {
        pe.x = alvoX;
        pe.dir = 1;                      /* de frente para a porta */
        pe.passo += dt*0.9;
      }
    } else if(pe.alvo==='rua'){
      pe.dentro=false;
      if(!pe.visivel){
        pe.visivel=true; pe.alpha=0;
        /* entra pela berma ou ja esta na rua: aparece com fade para a cena
           encher depressa quando o sensor sobe */
        if(Math.random()<0.4){ pe.x = Math.random()<0.5? -40 : W+40; pe.dir = pe.x<0?1:-1; }
        else { pe.x = W*(0.05+Math.random()*0.90); pe.dir = Math.random()<0.5?-1:1; }
      }
      pe.alpha = Math.min(1, pe.alpha + dt*1.8);
      pe.x += pe.dir*vel*dt;
      pe.passo += dt*(6+vel*0.05);
      if(pe.x> W+60){ pe.dir=-1; } else if(pe.x< -60){ pe.dir=1; }
    } else { /* fora */
      pe.dentro=false;
      if(pe.visivel){
        var saida = pe.x < W/2 ? -70 : W+70;
        pe.dir = saida<pe.x?-1:1;
        pe.x += pe.dir*vel*dt;
        pe.passo += dt*8;
        if(pe.x<-60||pe.x>W+60){ pe.visivel=false; pe.alpha=0; }
      }
    }
  }
}

function gerirCarros(dt){
  var maxC = Math.round(numRampa(valorSuave, [[-20,1],[8,2],[15,5],[26,4],[38,2],[50,1]]));
  relogioCarro -= dt;
  if(relogioCarro<=0 && carros.length<maxC){
    /* o primeiro de cada estado aparece ja a circular, para a rua nao ficar vazia */
    novoCarro(carros.length===0);
    relogioCarro = 0.7+Math.random()*1.8;
  }
  for(var i=carros.length-1;i>=0;i--){
    var c=carros[i];
    c.x += c.dir*c.v*dt*(1-P.neveChao*0.35);
    if(c.dir>0 && c.x>W+260*S) carros.splice(i,1);
    else if(c.dir<0 && c.x<-260*S) carros.splice(i,1);
    else if(carros.length>maxC+1 && (c.x<-200||c.x>W+200)) carros.splice(i,1);
  }
}

function gerirArvores(dt){
  for(var i=0;i<arvores.length;i++){
    var a=arvores[i];

    /* estado 3: folhagem a cair sozinha, sem ser preciso tocar */
    if(P.quedaFolhas>0.05 && P.folhas>0.02 && Math.random() < P.quedaFolhas*dt*3.2) soltarFolhas(a,1,true);
    /* o fogo so existe no estado 4; abaixo disso apaga-se */
    if(a.fogo>0){
      var lim = P.fogoOK;
      a.fogo += (lim - a.fogo)*dt*0.8;
      if(lim<0.05) a.fogo *= 0.94;
      if(a.fogo<0.02) a.fogo=0;
      a.carvao = Math.min(1, a.carvao + dt*0.10*a.fogo);
      /* faiscas e fumo */
      var A=a.alt;
      for(var k=0;k<2;k++){
        if(Math.random()<a.fogo*0.9){
          var pt=a.pontas[(Math.random()*a.pontas.length)|0];
          novaParticula({ tipo:'faisca', x:a.x+pt.x*A+(Math.random()-0.5)*10, y:a.base+pt.y*A,
            vx:(Math.random()-0.5)*60, vy:-40-Math.random()*80, r:(1.2+Math.random()*2.4)*S,
            vida:1, dur:0.8+Math.random()*0.9 });
        }
      }
      if(Math.random()<a.fogo*0.7){
        novaParticula({ tipo:'fumo', x:a.x+(Math.random()-0.5)*A*0.4, y:a.base-A*0.75,
          vx:(Math.random()-0.5)*20, vy:-30, r:(10+Math.random()*16)*S, vida:1, dur:2.6+Math.random()*1.6 });
      }
    } else {
      a.carvao *= (1 - dt*0.25);
      if(a.carvao<0.01) a.carvao=0;
    }
    /* maçãs a cair */
    for(var m=0;m<a.macas.length;m++){
      var mm=a.macas[m];
      if(!mm.caindo) continue;
      if(mm.pousada){
        mm.vida -= dt*0.16;
        if(mm.vida<=0){ mm.caindo=false; mm.pousada=0; mm.vida=1; mm.ox=0; mm.oy=0; mm.rot=0; }
        continue;
      }
      mm.vy += 900*dt; mm.oy += mm.vy*dt; mm.ox += mm.vx*dt; mm.rot += mm.vrot*dt;
      var chaoY = (a.base+6*S) - (a.base + mm.by*a.alt);
      if(mm.oy >= chaoY){
        mm.oy = chaoY;
        if(Math.abs(mm.vy)>90){ mm.vy *= -0.34; mm.vx *= 0.6; mm.vrot *= 0.5; }
        else { mm.vy=0; mm.vx=0; mm.vrot=0; mm.pousada=1; }
      }
    }
    /* fora do estado 2 as macas repoem-se em silencio */
    if(P.macas<0.02){
      for(var m2=0;m2<a.macas.length;m2++){
        var q=a.macas[m2];
        q.caindo=false; q.pousada=0; q.vida=1; q.ox=0; q.oy=0; q.vy=0; q.vx=0; q.rot=0;
      }
    }
  }
}


/* =====================================================================
   18) HUD
   ===================================================================== */
var elContador = document.getElementById('contador');
var hudAlvo=null;
function atualizarHUD(){
  var a1 = valorAlvo.toFixed(1);
  if(a1!==hudAlvo){ hudAlvo=a1;
    elContador.innerHTML = a1+'<span class="text-2xl md:text-3xl align-top">&deg;C</span>'; }
}

/* =====================================================================
   19) CICLO
   ===================================================================== */
var ultimo = 0;
function quadro(ts){
  requestAnimationFrame(quadro);
  /* dt sempre positivo e limitado: protege os temporizadores de saltos
     do relogio (separador em segundo plano, timestamps nao monotonos) */
  var dt = ultimo? clamp((ts-ultimo)/1000, 0, 0.05) : 0.016;
  ultimo = ts; tempo += dt;

  /* --- suavizacao obrigatoria --- */
  valorSuave += (valorAlvo - valorSuave) * 0.07;
  cab.tampa += (tampaAlvo - cab.tampa) * Math.min(1, dt*6);
  atualizarEstadoCaixa();

  P = parametros(valorSuave);
  LUZ = rampa(valorSuave, LUZ_R);
  giroVent += dt*(2.0 + 9.0*P.frioCabine + 1.5*P.calor);

  /* logica */
  gerirPessoas(dt);
  gerirCarros(dt);
  gerirArvores(dt);
  atualizarNeve(dt);
  ventoGelado(dt);
  atualizarParticulas(dt);

  /* desenho */
  ctx.clearRect(0,0,W,H);
  desenharCeu(valorSuave);
  desenharEstrelas(P.estrelas);
  desenharAurora(P.aurora);
  desenharSol();
  desenharNuvens();
  desenharCidade();
  desenharChao();

  for(var i=0;i<arvores.length;i++) desenharArvore(arvores[i]);
  for(var c=0;c<carros.length;c++) desenharCarro(carros[c]);

  desenharCabine();
  vaporCabine(dt);

  for(var p=0;p<pessoas.length;p++) desenharPessoa(pessoas[p]);

  desenharParticulas();
  desenharNeve();
  veuFrio();
  ondasCalor();
  desenharFlocosGigantes();

  /* vinheta */
  var gv = ctx.createRadialGradient(W*0.5,H*0.48,Math.min(W,H)*0.30, W*0.5,H*0.50,Math.max(W,H)*0.78);
  gv.addColorStop(0,'rgba(0,0,0,0)');
  gv.addColorStop(1,'rgba(0,0,0,'+(0.30+0.22*P.noite)+')');
  ctx.fillStyle=gv; ctx.fillRect(0,0,W,H);

  atualizarHUD();
}

/* =====================================================================
   20) LIGACOES
   ===================================================================== */
window.addEventListener('resize', redim);


redim();
definirValor(-5);
valorSuave = -5;
requestAnimationFrame(quadro);

/* A temperatura chega pelo botao "Conectar sensor" acima. */
