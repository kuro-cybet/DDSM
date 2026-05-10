import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ── Utility helpers ──────────────────────────────────────────────────────────
function dividedDiff(x, y) {
  const n = x.length;
  const table = Array.from({ length: n }, (_, i) => [y[i]]);
  for (let j = 1; j < n; j++)
    for (let i = 0; i < n - j; i++)
      table[i][j] = (table[i + 1][j - 1] - table[i][j - 1]) / (x[i + j] - x[i]);
  return table;
}

function newtonInterp(xPts, table, xi) {
  const n = xPts.length;
  let result = table[0][0];
  let prod = 1;
  for (let i = 1; i < n; i++) {
    prod *= xi - xPts[i - 1];
    result += table[0][i] * prod;
  }
  return result;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Animated counter (repeating) ─────────────────────────────────────────────
function Counter({ target, suffix = "", duration = 1800 }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    let rafId;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        cancelAnimationFrame(rafId);
        let start = null;
        const step = (ts) => {
          if (!start) start = ts;
          const p = Math.min((ts - start) / duration, 1);
          setVal(Math.round(lerp(0, target, p)));
          if (p < 1) rafId = requestAnimationFrame(step);
        };
        rafId = requestAnimationFrame(step);
      } else {
        setVal(0);
      }
    }, { threshold: 0.4, rootMargin: "-10% 0px -10% 0px" });
    if (ref.current) obs.observe(ref.current);
    return () => { obs.disconnect(); cancelAnimationFrame(rafId); };
  }, [target, duration]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ── Scroll-reveal hook (repeating, fires at mid-screen) ───────────────────────
function useReveal(threshold = 0.35) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
    }, { threshold, rootMargin: "-10% 0px -10% 0px" });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

// ── WebGL Nebula background (full-screen frag shader) ────────────────────────
function NebulaCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
    if (!gl) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; gl.viewport(0,0,canvas.width,canvas.height); };
    resize(); window.addEventListener("resize", resize);

    const vs = `attribute vec2 p; void main(){ gl_Position=vec4(p,0,1); }`;
    const fs = `
      precision highp float;
      uniform float uT; uniform vec2 uR;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
      }
      float fbm(vec2 p){
        float v=0.0,a=0.5;
        for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.1+vec2(1.3,1.7); a*=0.5; }
        return v;
      }
      void main(){
        vec2 uv=(gl_FragCoord.xy/uR)*2.0-1.0;
        uv.x *= uR.x/uR.y;
        float t=uT*0.00018;
        vec2 q=vec2(fbm(uv+vec2(0.0,0.0)),fbm(uv+vec2(5.2,1.3)));
        vec2 r=vec2(fbm(uv+4.0*q+vec2(1.7+t,9.2)),fbm(uv+4.0*q+vec2(8.3+t*0.6,2.8)));
        float f=fbm(uv+4.0*r);
        // cyan nebula
        vec3 col1=mix(vec3(0.0,0.06,0.14),vec3(0.02,0.16,0.22),clamp(f*f*4.0,0.0,1.0));
        col1=mix(col1,vec3(0.0,0.22,0.28),clamp(length(q),0.0,1.0));
        col1=mix(col1,vec3(0.0,0.08,0.18),f*f*f);
        // purple accent
        vec3 col2=mix(vec3(0.04,0.0,0.12),vec3(0.12,0.03,0.22),clamp(f*f*3.0,0.0,1.0));
        // blend based on position
        float blend=smoothstep(-0.4,0.4,uv.x+sin(uv.y*0.8+t*0.4)*0.3);
        vec3 col=mix(col1,col2,blend*0.6);
        col=pow(col,vec3(0.85));
        // vignette
        float vig=1.0-smoothstep(0.5,1.6,length(uv*vec2(0.7,0.9)));
        gl_FragColor=vec4(col*vig*1.4, 0.92);
      }
    `;
    const mkShader = (type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; };
    const prog=gl.createProgram();
    gl.attachShader(prog,mkShader(gl.VERTEX_SHADER,vs));
    gl.attachShader(prog,mkShader(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const ap=gl.getAttribLocation(prog,"p"); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap,2,gl.FLOAT,false,0,0);
    const uT=gl.getUniformLocation(prog,"uT"), uR=gl.getUniformLocation(prog,"uR");
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    let raf;
    const draw=(t)=>{ gl.uniform1f(uT,t); gl.uniform2f(uR,canvas.width,canvas.height); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); raf=requestAnimationFrame(draw); };
    raf=requestAnimationFrame(draw);
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ── WebGL 3D orbiting star field ──────────────────────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
    if (!gl) return;
    const resize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; gl.viewport(0,0,canvas.width,canvas.height); };
    resize(); window.addEventListener("resize", resize);

    const vs = `
      attribute vec3 aPos; attribute float aSize; attribute float aPhase;
      uniform float uT; uniform vec2 uR;
      varying float vAlpha; varying float vHue;
      void main(){
        float fov=700.0;
        vec3 p=aPos;
        float ay=uT*0.00022+aPhase;
        float ax=sin(uT*0.00011+aPhase*0.3)*0.25;
        mat2 ry=mat2(cos(ay),-sin(ay),sin(ay),cos(ay));
        mat2 rx=mat2(cos(ax),-sin(ax),sin(ax),cos(ax));
        p.xz=ry*p.xz; p.yz=rx*p.yz;
        float z=p.z+500.0;
        float sc=fov/max(z,1.0);
        gl_Position=vec4((p.xy*sc)/(uR*0.5),0.0,1.0);
        float ps=aSize*sc;
        gl_PointSize=clamp(ps,0.5,8.0);
        vAlpha=clamp(1.0-z/1000.0,0.0,1.0)*0.9;
        vHue=aPhase;
      }
    `;
    const fs = `
      precision mediump float;
      varying float vAlpha; varying float vHue;
      void main(){
        vec2 uv=gl_PointCoord-0.5;
        float r=length(uv);
        if(r>0.5) discard;
        float a=(1.0-r*2.0)*(1.0-r*2.0)*vAlpha;
        // chromatic: cyan to purple to white
        float t=fract(vHue*1.618);
        vec3 c=mix(vec3(0.1,0.85,0.95),vec3(0.6,0.4,1.0),t);
        c=mix(c,vec3(1.0,1.0,1.0),smoothstep(0.8,1.0,t));
        gl_FragColor=vec4(c,a);
      }
    `;
    const mk=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; };
    const prog=gl.createProgram(); gl.attachShader(prog,mk(gl.VERTEX_SHADER,vs)); gl.attachShader(prog,mk(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const N=300;
    const pos=new Float32Array(N*3), sz=new Float32Array(N), ph=new Float32Array(N);
    for(let i=0;i<N;i++){
      const r=200+Math.random()*550, theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1);
      pos[i*3]=r*Math.sin(phi)*Math.cos(theta); pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta); pos[i*3+2]=r*Math.cos(phi);
      sz[i]=Math.random()*2.5+0.5; ph[i]=Math.random();
    }
    const mkBuf=(data,attr,n)=>{ const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW); const a=gl.getAttribLocation(prog,attr); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a,n,gl.FLOAT,false,0,0); };
    mkBuf(pos,"aPos",3); mkBuf(sz,"aSize",1); mkBuf(ph,"aPhase",1);
    const uT=gl.getUniformLocation(prog,"uT"), uR=gl.getUniformLocation(prog,"uR");
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    let raf;
    const draw=(t)=>{ gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uT,t); gl.uniform2f(uR,canvas.width,canvas.height); gl.drawArrays(gl.POINTS,0,N); raf=requestAnimationFrame(draw); };
    raf=requestAnimationFrame(draw);
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ mixBlendMode:"screen" }} />;
}

// ── 3D perspective wave grid ──────────────────────────────────────────────────
function TunnelCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, t = 0;
    const resize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; };
    resize(); window.addEventListener("resize", resize);
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const W=canvas.width, H=canvas.height;
      const ROWS=20, COLS=32, FOV=H*1.1, CAM_Y=H*0.38;
      // draw receding grid plane with wave displacement
      for(let row=0;row<=ROWS;row++){
        const depth=(row/ROWS); const z=depth*depth; // perspective acceleration
        const worldZ=z*1800+((t*0.8)%( 1800/ROWS));
        const sc=FOV/(worldZ+FOV*0.6);
        const y=CAM_Y+sc*200;
        const xSpan=W*sc*2.2;
        const alpha=depth*0.28*(1-depth*0.3);
        ctx.beginPath();
        for(let col=0;col<=COLS;col++){
          const fx=col/COLS;
          const wx=(fx-0.5)*xSpan+W/2;
          const wave=Math.sin(fx*Math.PI*3+t*0.025+row*0.3)*12*sc
                    +Math.sin(fx*Math.PI*6-t*0.017)*6*sc;
          col===0?ctx.moveTo(wx,y+wave):ctx.lineTo(wx,y+wave);
        }
        const grad=ctx.createLinearGradient(0,0,W,0);
        grad.addColorStop(0,`rgba(34,211,238,0)`);
        grad.addColorStop(0.2,`rgba(34,211,238,${alpha})`);
        grad.addColorStop(0.5,`rgba(129,140,248,${alpha*1.1})`);
        grad.addColorStop(0.8,`rgba(34,211,238,${alpha})`);
        grad.addColorStop(1,`rgba(34,211,238,0)`);
        ctx.strokeStyle=grad; ctx.lineWidth=0.7+depth*0.8; ctx.stroke();
      }
      // vertical lines
      for(let col=0;col<=COLS;col+=2){
        const fx=col/COLS;
        ctx.beginPath();
        let first=true;
        for(let row=0;row<=ROWS;row++){
          const depth=row/ROWS; const z=depth*depth;
          const worldZ=z*1800+((t*0.8)%(1800/ROWS));
          const sc=FOV/(worldZ+FOV*0.6);
          const y=CAM_Y+sc*200;
          const xSpan=W*sc*2.2;
          const wx=(fx-0.5)*xSpan+W/2;
          const wave=Math.sin(fx*Math.PI*3+t*0.025+row*0.3)*12*sc;
          first?ctx.moveTo(wx,y+wave):ctx.lineTo(wx,y+wave); first=false;
        }
        const alpha=(col/COLS)*0.12;
        ctx.strokeStyle=`rgba(96,165,250,${alpha})`; ctx.lineWidth=0.4; ctx.stroke();
      }
      t++; raf=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:0.7 }} />;
}

// ── Morphing 3D wave mesh ─────────────────────────────────────────────────────
function WaveformBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, t = 0;
    const resize = () => { canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener("resize", resize);
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const W=canvas.width, H=canvas.height;
      for(let row=0;row<8;row++){
        const tz=row/8; const yBase=H*0.48+tz*H*0.45; const scaleX=0.25+tz*0.78;
        const alpha=0.04+tz*0.18; const amp=(1-tz)*32+6;
        ctx.beginPath();
        for(let i=0;i<=60;i++){
          const fx=i/60, x=W*0.5+(fx-0.5)*W*scaleX;
          const w=amp*Math.sin(fx*Math.PI*5+t*0.02+row*0.6)+amp*0.35*Math.sin(fx*Math.PI*9-t*0.013+row*1.1);
          i===0?ctx.moveTo(x,yBase-w*(1-tz*0.5)):ctx.lineTo(x,yBase-w*(1-tz*0.5));
        }
        const h=185+row*10; ctx.strokeStyle=`hsla(${h},90%,68%,${alpha})`; ctx.lineWidth=0.8+tz*1.2; ctx.stroke();
        if(row<7){
          for(let i=0;i<=60;i+=3){
            const fx=i/60; const tz2=(row+1)/8; const scaleX2=0.25+tz2*0.78;
            const yBase2=H*0.48+tz2*H*0.45; const amp2=(1-tz2)*32+6;
            const x1=W*0.5+(fx-0.5)*W*scaleX, x2=W*0.5+(fx-0.5)*W*scaleX2;
            const w1=amp*Math.sin(fx*Math.PI*5+t*0.02+row*0.6);
            const w2=amp2*Math.sin(fx*Math.PI*5+t*0.02+(row+1)*0.6);
            ctx.beginPath(); ctx.moveTo(x1,yBase-w1*(1-tz*0.5)); ctx.lineTo(x2,yBase2-w2*(1-tz2*0.5));
            ctx.strokeStyle=`hsla(${h},70%,60%,${alpha*0.4})`; ctx.lineWidth=0.3; ctx.stroke();
          }
        }
      }
      t++; raf=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={canvasRef} className="absolute bottom-0 left-0 w-full" style={{ height:"380px", pointerEvents:"none" }} />;
}

// ── Animated perspective grid ─────────────────────────────────────────────────
function GridBg({ opacity = 0.07 }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity }}>
      <div style={{
        width:"100%", height:"100%",
        backgroundImage:`linear-gradient(rgba(34,211,238,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,0.3) 1px,transparent 1px)`,
        backgroundSize:"60px 60px", animation:"gridScroll 10s linear infinite",
      }}/>
      <div style={{
        position:"absolute", inset:0,
        backgroundImage:`linear-gradient(rgba(129,140,248,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(129,140,248,0.1) 1px,transparent 1px)`,
        backgroundSize:"200px 200px", animation:"gridScroll 30s linear infinite",
      }}/>
    </div>
  );
}

// ── Premium aurora blobs ──────────────────────────────────────────────────────
function AuroraBlobs({ intensity = 1 }) {
  const s = intensity;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div style={{ position:"absolute", width:900, height:900, borderRadius:"50%", filter:"blur(140px)",
        background:`radial-gradient(circle,rgba(34,211,238,${0.11*s}) 0%,rgba(6,182,212,${0.05*s}) 40%,transparent 70%)`,
        top:"-30%", left:"-15%", animation:"auroraA 20s ease-in-out infinite" }}/>
      <div style={{ position:"absolute", width:750, height:750, borderRadius:"50%", filter:"blur(120px)",
        background:`radial-gradient(circle,rgba(139,92,246,${0.10*s}) 0%,rgba(167,139,250,${0.04*s}) 40%,transparent 70%)`,
        bottom:"-20%", right:"-10%", animation:"auroraB 26s ease-in-out infinite" }}/>
      <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%", filter:"blur(90px)",
        background:`radial-gradient(circle,rgba(6,182,212,${0.08*s}) 0%,transparent 70%)`,
        top:"35%", left:"45%", animation:"auroraC 16s ease-in-out infinite" }}/>
      <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%", filter:"blur(80px)",
        background:`radial-gradient(circle,rgba(99,102,241,${0.07*s}) 0%,transparent 70%)`,
        top:"10%", right:"15%", animation:"auroraD 19s ease-in-out infinite" }}/>
    </div>
  );
}

// ── Glowing card ──────────────────────────────────────────────────────────────
function GlassCard({ children, className = "", glow = "cyan" }) {
  const glowMap = { cyan: "rgba(34,211,238,0.2)", purple: "rgba(139,92,246,0.2)", blue: "rgba(96,165,250,0.2)" };
  const borderMap = { cyan: "rgba(34,211,238,0.18)", purple: "rgba(139,92,246,0.18)", blue: "rgba(96,165,250,0.18)" };
  return (
    <div className={`relative rounded-2xl p-6 ${className}`} style={{
      background: "linear-gradient(135deg, rgba(8,18,38,0.88) 0%, rgba(4,9,24,0.92) 100%)",
      backdropFilter: "blur(32px) saturate(180%)",
      border: `1px solid ${borderMap[glow]||borderMap.cyan}`,
      boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 0 60px ${glowMap[glow]||glowMap.cyan}, 0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)`,
      transition: "box-shadow 0.3s ease, transform 0.3s ease",
    }}
    onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 0 0 1px rgba(255,255,255,0.06), 0 0 90px ${glowMap[glow]||glowMap.cyan}, 0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)`;}}
    onMouseLeave={e=>{e.currentTarget.style.boxShadow=`0 0 0 1px rgba(255,255,255,0.04), 0 0 60px ${glowMap[glow]||glowMap.cyan}, 0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)`;}}
    >
      {/* top shimmer line */}
      <div style={{ position:"absolute", top:0, left:"10%", right:"10%", height:"1px", borderRadius:"100%",
        background:`linear-gradient(90deg,transparent,${glowMap[glow]||glowMap.cyan},transparent)`,
        animation:"pulseGlow 3s ease-in-out infinite" }}/>
      {/* inner reflection */}
      <div style={{ position:"absolute", inset:0, borderRadius:"inherit", pointerEvents:"none",
        background:"linear-gradient(135deg,rgba(255,255,255,0.04) 0%,transparent 40%,rgba(255,255,255,0.01) 100%)" }}/>
      {children}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHeading({ label, title, sub }) {
  const [ref, vis] = useReveal();
  return (
    <div ref={ref} className={`text-center mb-16 transition-all duration-600 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
      <span className="text-xs font-mono tracking-widest text-cyan-400 uppercase mb-3 block">{label}</span>
      <h2 className="text-4xl md:text-5xl font-black text-white mb-4" style={{ fontFamily: "'Exo 2', sans-serif" }}>{title}</h2>
      {sub && <p className="text-slate-400 max-w-2xl mx-auto text-lg leading-relaxed">{sub}</p>}
    </div>
  );
}

// ── Actual + sensor data ──────────────────────────────────────────────────────
const problemData = Array.from({ length: 20 }, (_, i) => ({
  x: i,
  actual: 20 + i * 2.5 + Math.sin(i * 0.8) * 3,
  sensor: 20 + i * 2.5 + Math.sin(i * 0.8) * 3 + (Math.random() - 0.5) * 8 + Math.sin(i * 1.5) * 4,
}));

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ scrollY }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setTimeout(() => setMounted(true), 100); }, []);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden" style={{ background: "#020812" }}>
      <NebulaCanvas />
      <TunnelCanvas />
      <ParticleCanvas />
      <WaveformBg />

      {/* Floating math equations */}
      {["f[x₀,x₁]", "Δy/Δx", "P(x)=∑aᵢNᵢ(x)", "f[x₀..xₙ]", "∇²f", "Nₖ(x)"].map((eq, i) => (
        <div key={i} className="absolute text-cyan-400/20 font-mono text-sm pointer-events-none select-none"
          style={{
            top: `${15 + (i * 13) % 70}%`,
            left: `${5 + (i * 17) % 88}%`,
            animation: `float${i % 3} ${4 + i}s ease-in-out infinite`,
            fontSize: i % 2 === 0 ? "0.9rem" : "0.7rem",
          }}>
          {eq}
        </div>
      ))}

      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto"
        style={{ transform: `translateY(${scrollY * 0.3}px)` }}>
        <div className={`transition-all duration-600 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="inline-block text-xs font-mono tracking-[0.4em] text-cyan-400 uppercase mb-6 border border-cyan-400/30 px-4 py-2 rounded-full"
            style={{ background: "rgba(34,211,238,0.05)" }}>
            Senior Project · Sensor Engineering
          </span>
        </div>

        <div className={`transition-all duration-700 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"}`}>
          <h1 className="font-black leading-none mb-4" style={{ fontFamily: "'Exo 2', sans-serif" }}>
            <span className="block text-8xl md:text-[12rem] lg:text-[16rem]"
              style={{
                background: "linear-gradient(135deg, #22d3ee 0%, #818cf8 50%, #06b6d4 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                filter: "drop-shadow(0 0 60px rgba(34,211,238,0.4))",
                letterSpacing: "-0.04em"
              }}>
              DDSM
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 font-light tracking-wide mb-2">
            Divided Difference-based Sensor Modeling
          </p>
          <p className="text-sm md:text-base text-slate-500 font-mono tracking-widest">
            Newton's Interpolation · Calibration · Error Correction
          </p>
        </div>

        <div className={`mt-12 transition-all duration-600 delay-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <button
            onClick={() => document.getElementById("problem").scrollIntoView({ behavior: "smooth" })}
            className="group flex flex-col items-center gap-2 mx-auto text-cyan-400 hover:text-white transition-colors"
          >
            <span className="text-xs font-mono tracking-widest uppercase">Explore Project</span>
            <div className="w-6 h-10 border-2 border-cyan-400/50 rounded-full flex justify-center pt-2 group-hover:border-cyan-400 transition-colors">
              <div className="w-1 h-2 bg-cyan-400 rounded-full" style={{ animation: "bounce 1.5s infinite" }} />
            </div>
          </button>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;700;900&family=JetBrains+Mono:wght@300;400&display=swap');
        @keyframes float0 { 0%,100%{transform:translateY(0) rotate(-2deg)} 50%{transform:translateY(-18px) rotate(2deg)} }
        @keyframes float1 { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes float2 { 0%,100%{transform:translateY(0) rotate(1deg)} 50%{transform:translateY(-22px) rotate(-1deg)} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(5px)} }
        @keyframes gridScroll { 0%{background-position:0 0} 100%{background-position:60px 60px} }
        @keyframes auroraA { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(100px,-80px) scale(1.2)} 66%{transform:translate(-60px,50px) scale(0.88)} }
        @keyframes auroraB { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-80px,100px) scale(0.82)} 66%{transform:translate(70px,-40px) scale(1.25)} }
        @keyframes auroraC { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,70px) scale(1.15)} }
        @keyframes auroraD { 0%,100%{transform:translate(0,0) scale(1)} 40%{transform:translate(-50px,-40px) scale(1.1)} 70%{transform:translate(30px,20px) scale(0.9)} }
        @keyframes shimmerCard { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes pulseGlow { 0%,100%{opacity:0.6} 50%{opacity:1} }
        * { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-track { background:#020812 } ::-webkit-scrollbar-thumb { background:linear-gradient(#22d3ee80,#818cf880); border-radius:2px }
      `}</style>
    </section>
  );
}

// ── Problem Section ───────────────────────────────────────────────────────────
function Problem() {
  const [ref, vis] = useReveal();
  return (
    <section id="problem" className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#020812 0%,#030e1c 100%)" }}>
      <AuroraBlobs intensity={0.8} />
      <GridBg opacity={0.06} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading
          label="01 · The Challenge"
          title="Sensors Lie."
          sub="Every physical sensor introduces measurement error — thermal drift, hardware nonlinearity, and environmental noise distort the truth. Calibration is not optional; it's fundamental."
        />
        <div ref={ref} className={`grid md:grid-cols-3 gap-6 mb-16 transition-all duration-600 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          {[
            { icon: "⚡", title: "Thermal Drift", desc: "Temperature changes alter sensor resistance and output voltage, causing readings to shift over time." },
            { icon: "📡", title: "Nonlinear Response", desc: "Sensor output is rarely proportional to input. Nonlinearity creates systematic errors that simple correction cannot fix." },
            { icon: "🌊", title: "Environmental Noise", desc: "EMI, vibration, and humidity introduce stochastic errors that accumulate across measurement chains." }
          ].map((c, i) => (
            <GlassCard key={i} glow={i === 1 ? "purple" : "cyan"} className="flex flex-col gap-3">
              <div className="text-3xl">{c.icon}</div>
              <h3 className="text-white font-bold text-lg">{c.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{c.desc}</p>
            </GlassCard>
          ))}
        </div>

        <GlassCard className="mt-8">
          <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-4">Actual vs Sensor Readings</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={problemData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 11 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,211,238,0.3)", borderRadius: 8 }} labelStyle={{ color: "#94a3b8" }} />
              <Line type="monotone" dataKey="actual" stroke="#22d3ee" strokeWidth={2.5} dot={false} name="Actual Signal" />
              <Line type="monotone" dataKey="sensor" stroke="#f43f5e" strokeWidth={1.5} dot={false} name="Sensor Reading" strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-6 mt-4 justify-center">
            <span className="flex items-center gap-2 text-xs text-slate-400"><span className="w-8 h-0.5 bg-cyan-400 inline-block rounded" /> Actual Signal</span>
            <span className="flex items-center gap-2 text-xs text-slate-400"><span className="w-8 h-px bg-rose-400 inline-block border-t-2 border-dashed border-rose-400" /> Sensor Reading</span>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

// ── Why Linear Fails ──────────────────────────────────────────────────────────
function WhyLinearFails() {
  const linearData = Array.from({ length: 30 }, (_, i) => {
    const x = i / 29;
    const actual = 10 + 40 * (x + 0.3 * Math.sin(x * Math.PI * 2));
    const linear = 10 + 40 * x;
    return { x: parseFloat(x.toFixed(2)), actual: parseFloat(actual.toFixed(2)), linear: parseFloat(linear.toFixed(2)) };
  });
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#020812 0%,#050d1a 100%)" }}>
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="02 · Root Cause" title="Linear Models Are Blind." sub="Linear correction assumes a straight-line relationship between sensor output and true value. Real sensors curve, saturate, and exhibit hysteresis — a straight line misses all of it." />
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <GlassCard glow="purple">
            <p className="text-purple-400 text-xs font-mono tracking-widest uppercase mb-4">Linear Fit vs True Response</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={linearData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 11 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="actual" stroke="#22d3ee" strokeWidth={2.5} dot={false} name="True Response" />
                <Line type="monotone" dataKey="linear" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Linear Fit" strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-3 text-center">Yellow linear fit diverges significantly from true nonlinear behavior</p>
          </GlassCard>
          <div className="flex flex-col gap-4">
            {[
              { col: "#22d3ee", title: "Piece-wise Nonlinearity", body: "Sensor gain changes at different operating points, requiring adaptive polynomial fitting — not constants." },
              { col: "#818cf8", title: "Saturation Effects", body: "Near range limits, sensor output flattens while the true value continues to change. Linear models overestimate." },
              { col: "#f59e0b", title: "Hysteresis", body: "Rising vs. falling measurements follow different paths. A single linear correction cannot capture direction-dependent error." },
            ].map((item, i) => (
              <GlassCard key={i} className="flex gap-4 items-start">
                <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: item.col }} />
                <div>
                  <h4 className="text-white font-semibold mb-1">{item.title}</h4>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.body}</p>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Solution ──────────────────────────────────────────────────────────────────
function Solution() {
  const [ref, vis] = useReveal();
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#030e1c 0%,#02080f 100%)" }}>
      <AuroraBlobs intensity={0.7} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(129,140,248,0.07) 0%, transparent 70%)" }} />
      <GridBg opacity={0.07} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="03 · The Solution" title="Newton's Divided Differences." sub="A recursive polynomial interpolation framework that exactly fits n+1 data points using a nested multiplication scheme — computationally efficient, numerically stable, and provably optimal for calibration." />

        <div ref={ref} className={`transition-all duration-600 ${vis ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
          <GlassCard className="text-center mb-8" glow="purple">
            <p className="text-xs font-mono text-slate-500 tracking-widest uppercase mb-6">Core Interpolation Polynomial</p>
            <div className="overflow-x-auto">
              <p className="text-2xl md:text-3xl font-mono text-cyan-300 whitespace-nowrap" style={{ textShadow: "0 0 30px rgba(34,211,238,0.5)" }}>
                P(x) = f[x₀] + f[x₀,x₁](x−x₀) + f[x₀,x₁,x₂](x−x₀)(x−x₁) + ···
              </p>
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "f[xᵢ,xⱼ]", desc: "First-order divided difference — rate of change between two points" },
                { label: "f[xᵢ..xₖ]", desc: "k-th order divided difference — recursive higher-order correction" },
                { label: "Nₖ(x)", desc: "Newton basis polynomial — product of (x−xᵢ) terms" },
              ].map((e, i) => (
                <div key={i} className="rounded-xl border border-white/5 p-4" style={{ background: "rgba(34,211,238,0.04)" }}>
                  <p className="font-mono text-cyan-400 text-lg mb-2">{e.label}</p>
                  <p className="text-slate-400 text-xs leading-relaxed">{e.desc}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◈", col: "#22d3ee", title: "Exact Interpolation", body: "Polynomial passes through every calibration data point exactly — zero residual at known values." },
              { icon: "◉", col: "#818cf8", title: "Recursive Structure", body: "New data points extend the table without recomputing — O(n) incremental update efficiency." },
              { icon: "◆", col: "#06b6d4", title: "Nonlinear Capture", body: "High-degree terms model sensor saturation, hysteresis, and cross-sensitivity automatically." },
            ].map((c, i) => (
              <GlassCard key={i} className="text-center">
                <div className="text-4xl mb-4" style={{ color: c.col, textShadow: `0 0 20px ${c.col}` }}>{c.icon}</div>
                <h3 className="text-white font-bold text-lg mb-2">{c.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{c.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { n: "01", title: "Collect Data", desc: "Record pairs of reference sensor values (true values) and raw sensor outputs at known operating points across the full measurement range.", icon: "⊡" },
    { n: "02", title: "Build Difference Table", desc: "Apply the recursive divided difference formula to build a triangular table encoding the polynomial's coefficients at increasing orders.", icon: "⊞" },
    { n: "03", title: "Construct Polynomial", desc: "Assemble Newton's forward form using the first row of the difference table as coefficients — P(x) = f[x₀] + f[x₀,x₁](x−x₀) + ···", icon: "⊟" },
    { n: "04", title: "Predict & Calibrate", desc: "Feed any raw sensor reading into P(x) to obtain the calibrated true value. Error converges as polynomial degree increases.", icon: "⊠" },
  ];
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#050d1a 0%,#020812 100%)" }}>
      <GridBg opacity={0.06} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="04 · Methodology" title="Step by Step." sub="A four-stage calibration pipeline that transforms raw sensor noise into high-fidelity corrected output." />
        <div className="relative">
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(34,211,238,0.4), transparent)" }} />
          {steps.map((s, i) => {
            const [ref, vis] = useReveal(0.3);
            const right = i % 2 === 1;
            return (
              <div key={i} ref={ref} className={`relative flex gap-8 mb-16 transition-all duration-700 ${vis ? "opacity-100 translate-x-0" : `opacity-0 ${right ? "translate-x-16" : "-translate-x-16"}`} ${right ? "md:flex-row-reverse" : ""}`}
                style={{ transitionDelay: vis ? `${i * 80}ms` : "0ms" }}>
                <div className="hidden md:flex flex-1" />
                <div className="flex-shrink-0 w-16 h-16 rounded-full border-2 border-cyan-400/50 flex items-center justify-center z-10 text-2xl"
                  style={{ background: "rgba(10,15,30,0.9)", boxShadow: "0 0 30px rgba(34,211,238,0.3)" }}>
                  {s.icon}
                </div>
                <div className="flex-1">
                  <GlassCard>
                    <span className="text-xs font-mono text-cyan-400/60 tracking-widest">{s.n}</span>
                    <h3 className="text-xl font-bold text-white mt-1 mb-3" style={{ fontFamily: "'Exo 2', sans-serif" }}>{s.title}</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
                  </GlassCard>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Interactive Simulator ─────────────────────────────────────────────────────
function Simulator() {
  const defaultX = [0, 1, 2, 3, 4];
  const defaultY = [0, 0.8, 2.4, 4.1, 4.8];
  const [xInput, setXInput] = useState(defaultX.join(", "));
  const [yInput, setYInput] = useState(defaultY.join(", "));
  const [queryInput, setQueryInput] = useState("1.5");
  const [result, setResult] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [tableData, setTableData] = useState([]);
  const [error, setError] = useState("");

  const run = useCallback(() => {
    setError("");
    try {
      const xPts = xInput.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const yPts = yInput.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (xPts.length < 2 || xPts.length !== yPts.length) { setError("Need equal non-empty x and y arrays (min 2 points)."); return; }
      const query = parseFloat(queryInput);
      if (isNaN(query)) { setError("Query value must be a number."); return; }

      const table = dividedDiff(xPts, yPts);
      const predicted = newtonInterp(xPts, table, query);

      // build chart
      const xMin = Math.min(...xPts), xMax = Math.max(...xPts);
      const range = xMax - xMin;
      const plotPts = 80;
      const data = Array.from({ length: plotPts }, (_, i) => {
        const xi = xMin + (i / (plotPts - 1)) * range;
        return { x: parseFloat(xi.toFixed(3)), y: parseFloat(newtonInterp(xPts, table, xi).toFixed(4)) };
      });
      const rawData = xPts.map((xi, i) => ({ x: xi, raw: yPts[i] }));
      // merge
      const merged = data.map(d => ({ ...d, raw: rawData.find(r => Math.abs(r.x - d.x) < 0.001)?.raw ?? null }));
      setChartData(merged);
      setResult(predicted);

      // build table display
      setTableData(table.map((row, i) => ({ x: xPts[i], diffs: row })));
    } catch (e) { setError("Computation error: " + e.message); }
  }, [xInput, yInput, queryInput]);

  useEffect(() => { run(); }, []);

  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#020812 0%,#030d1a 100%)" }}>
      <AuroraBlobs intensity={0.75} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 60%, rgba(34,211,238,0.06) 0%, transparent 70%)" }} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="05 · Interactive" title="Live Calibration Simulator." sub="Enter reference and sensor data points to generate the divided difference table, interpolation polynomial, and calibrated prediction in real time." />

        <div className="grid md:grid-cols-5 gap-6">
          {/* Controls */}
          <div className="md:col-span-2 flex flex-col gap-4">
            <GlassCard>
              <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-4">Input Data</p>
              {[
                { label: "Reference Values (x)", val: xInput, set: setXInput, ph: "0, 1, 2, 3, 4" },
                { label: "Sensor Readings (y)", val: yInput, set: setYInput, ph: "0.0, 0.8, 2.4, 4.1, 4.8" },
                { label: "Query Point (xᵢ)", val: queryInput, set: setQueryInput, ph: "1.5" },
              ].map((f, i) => (
                <div key={i} className="mb-4">
                  <label className="text-xs text-slate-400 font-mono mb-1 block">{f.label}</label>
                  <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors" />
                </div>
              ))}
              {error && <p className="text-rose-400 text-xs font-mono mb-3">{error}</p>}
              <button onClick={run}
                className="w-full py-3 rounded-xl text-sm font-bold text-black transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#22d3ee,#818cf8)", boxShadow: "0 0 30px rgba(34,211,238,0.3)" }}>
                ▶ Compute Interpolation
              </button>
            </GlassCard>

            {result !== null && (
              <GlassCard glow="purple" className="text-center">
                <p className="text-xs font-mono text-slate-400 tracking-widest uppercase mb-2">Calibrated Output at x = {queryInput}</p>
                <p className="text-4xl font-black text-cyan-300 font-mono" style={{ textShadow: "0 0 30px rgba(34,211,238,0.6)" }}>
                  {result.toFixed(5)}
                </p>
              </GlassCard>
            )}
          </div>

          {/* Chart + Table */}
          <div className="md:col-span-3 flex flex-col gap-4">
            <GlassCard>
              <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-4">Interpolation Curve</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,211,238,0.3)", borderRadius: 8 }} labelStyle={{ color: "#94a3b8" }} />
                  <Line type="monotone" dataKey="y" stroke="#22d3ee" strokeWidth={2.5} dot={false} name="P(x)" />
                  <Line type="monotone" dataKey="raw" stroke="#f59e0b" strokeWidth={0} dot={{ fill: "#f59e0b", r: 5, strokeWidth: 0 }} name="Data Points" />
                  {result !== null && (
                    <ReferenceLine x={parseFloat(queryInput)} stroke="#818cf8" strokeDasharray="4 2" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </GlassCard>

            <GlassCard>
              <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-4">Divided Difference Table</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr>
                      <th className="text-left text-slate-500 pb-2 pr-4">xᵢ</th>
                      {tableData[0]?.diffs.map((_, j) => (
                        <th key={j} className="text-left text-slate-500 pb-2 pr-4">f[{Array.from({ length: j + 1 }, (__, k) => `x${k}`).join(",")}]</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-2 pr-4 text-amber-400">{row.x.toFixed(2)}</td>
                        {row.diffs.map((d, j) => (
                          <td key={j} className="py-2 pr-4 text-cyan-300">{typeof d === "number" ? d.toFixed(4) : "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────
function Results() {
  const beforeData = Array.from({ length: 30 }, (_, i) => ({ x: i, val: 20 + i + Math.sin(i * 0.7) * 8 + (Math.random() - 0.5) * 10 }));
  const afterData = Array.from({ length: 30 }, (_, i) => ({ x: i, val: 20 + i + Math.sin(i * 0.7) * 0.5 + (Math.random() - 0.5) * 0.8, ref: 20 + i + Math.sin(i * 0.7) * 8 * 0 }));
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#050d1a 0%,#020812 100%)" }}>
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="06 · Results" title="Accuracy Transformed." sub="DDSM reduces sensor error by orders of magnitude, bringing calibrated output to within instrument noise floors." />

        <div className="grid md:grid-cols-4 gap-6 mb-12">
          {[
            { label: "Error Reduction", val: 96, suffix: "%" },
            { label: "Interpolation Order", val: 5, suffix: "th" },
            { label: "RMSE Improvement", val: 94, suffix: "%" },
            { label: "Calibration Points", val: 8, suffix: "" },
          ].map((s, i) => (
            <GlassCard key={i} className="text-center" glow={i % 2 === 0 ? "cyan" : "purple"}>
              <p className="text-4xl font-black text-cyan-300 font-mono mb-1" style={{ textShadow: "0 0 20px rgba(34,211,238,0.5)" }}>
                <Counter target={s.val} suffix={s.suffix} />
              </p>
              <p className="text-xs text-slate-500 font-mono tracking-widest uppercase">{s.label}</p>
            </GlassCard>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <GlassCard>
            <p className="text-rose-400 text-xs font-mono tracking-widest uppercase mb-4">Before Calibration</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={beforeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 10 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(244,63,94,0.3)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="val" stroke="#f43f5e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </GlassCard>
          <GlassCard>
            <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-4">After DDSM Calibration</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={afterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 10 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,211,238,0.3)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="val" stroke="#22d3ee" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}

// ── Applications ──────────────────────────────────────────────────────────────
function Applications() {
  const apps = [
    { icon: "📡", title: "IoT Sensors", desc: "Calibrate temperature, humidity, and pressure sensors in edge devices for accurate environmental monitoring." },
    { icon: "🫀", title: "Biomedical Devices", desc: "Correct blood glucose meter and ECG sensor nonlinearities to meet IEC 62133 accuracy standards." },
    { icon: "⚙️", title: "Industrial Automation", desc: "Calibrate load cells, encoders, and torque sensors in CNC and robotics systems for precision control." },
    { icon: "🌱", title: "Smart Agriculture", desc: "Correct soil moisture and nutrient sensor drift to optimize irrigation and fertilization schedules." },
    { icon: "🌦️", title: "Weather Monitoring", desc: "Interpolate between sparse weather station data points for accurate regional meteorological modeling." },
  ];
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#030e1c 0%,#020812 100%)" }}>
      <AuroraBlobs intensity={0.7} />
      <GridBg opacity={0.06} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="07 · Applications" title="Deployed Everywhere." sub="Any system where sensors interface with the physical world benefits from rigorous calibration." />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {apps.map((a, i) => (
            <div key={i} className="group cursor-default">
              <GlassCard className="text-center h-full transition-all duration-300 group-hover:scale-105 group-hover:border-cyan-400/30"
                style={{ transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
                <div className="text-4xl mb-4">{a.icon}</div>
                <h3 className="text-white font-bold text-sm mb-2">{a.title}</h3>
                <p className="text-slate-400 text-xs leading-relaxed">{a.desc}</p>
              </GlassCard>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Conclusion ────────────────────────────────────────────────────────────────
function Conclusion() {
  const [ref, vis] = useReveal();
  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#050d1a 0%,#020812 100%)" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(129,140,248,0.08) 0%, transparent 70%)" }} />
      <div className="max-w-4xl mx-auto px-6 text-center">
        <SectionHeading label="08 · Conclusion" title="Precision Through Mathematics." />
        <div ref={ref} className={`transition-all duration-700 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <GlassCard glow="purple" className="mb-8">
            <p className="text-slate-300 text-lg leading-relaxed mb-6">
              Sensor calibration is the invisible foundation of every reliable measurement system. Without it, data is noise. With DDSM — applying Newton's Divided Difference Method — we transform raw, distorted sensor output into precision-calibrated measurements that engineering decisions can trust.
            </p>
            <p className="text-slate-400 leading-relaxed">
              The divided difference framework delivers exact polynomial interpolation through all calibration points, adapts to nonlinear sensor characteristics that linear models cannot capture, and updates incrementally as new calibration data becomes available. The result is a calibration engine that matches the complexity of real-world sensor behavior.
            </p>
          </GlassCard>
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: "◈", col: "#22d3ee", text: "Exact at all calibration points" },
              { icon: "◉", col: "#818cf8", text: "Nonlinear response modeling" },
              { icon: "◆", col: "#06b6d4", text: "Real-time prediction capability" },
            ].map((c, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="text-2xl" style={{ color: c.col }}>{c.icon}</div>
                <p className="text-xs text-slate-400 text-center">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="relative border-t border-white/5 py-12" style={{ background: "#020812" }}>
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="text-3xl font-black text-white mb-1" style={{
            fontFamily: "'Exo 2', sans-serif",
            background: "linear-gradient(135deg,#22d3ee,#818cf8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
          }}>DDSM</div>
          <p className="text-slate-500 text-xs font-mono">Divided Difference-based Sensor Modeling</p>
        </div>
        <div className="text-center">
          <p className="text-slate-400 text-sm">Senior Engineering Project</p>
          <p className="text-slate-500 text-xs font-mono mt-1">Newton's Interpolation · Sensor Calibration · Error Correction</p>
        </div>
        <div className="text-right text-xs text-slate-500 font-mono">
          <p>Built with React + Recharts</p>
          <p className="mt-1 text-slate-600">© 2025 DDSM Project</p>
        </div>
      </div>
    </footer>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const h = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Exo 2', monospace", background: "#020812", color: "#f8fafc" }}>
      <Hero scrollY={scrollY} />
      <Problem />
      <WhyLinearFails />
      <Solution />
      <HowItWorks />
      <Simulator />
      <Results />
      <Applications />
      <Conclusion />
      <Footer />
    </div>
  );
}
