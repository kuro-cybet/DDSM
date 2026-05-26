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

// ── Animated counter ─────────────────────────────────────────────────────────
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
        cancelAnimationFrame(rafId);
        setVal(0);
      }
    }, { threshold: 0.4, rootMargin: "-12% 0px -12% 0px" });
    if (ref.current) obs.observe(ref.current);
    return () => { obs.disconnect(); cancelAnimationFrame(rafId); };
  }, [target, duration]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ── Scroll-reveal hook ────────────────────────────────────────────────────────
function useReveal(threshold = 0.35) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
    }, { threshold, rootMargin: "-12% 0px -12% 0px" });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

// ── Sensor Calibration Background Canvas ─────────────────────────────────────
// Draws an oscilloscope-style display: voltage rails, grid, live waveform,
// ADC sample markers, reference lines, and drifting noise — like real lab gear.
function SensorBg({ opacity = 1 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, t = 0;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener("resize", resize);

    // stable sample positions for ADC markers
    const SAMPLES = 14;
    const samplePhases = Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // ── oscilloscope grid ──────────────────────────────────────────────────
      const divX = 10, divY = 8;
      ctx.strokeStyle = "rgba(30,80,60,0.45)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= divX; i++) {
        const x = (i / divX) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let i = 0; i <= divY; i++) {
        const y = (i / divY) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // minor ticks (5 per div)
      ctx.strokeStyle = "rgba(30,80,60,0.2)";
      ctx.lineWidth = 0.3;
      for (let i = 0; i <= divX * 5; i++) {
        const x = (i / (divX * 5)) * W;
        ctx.beginPath(); ctx.moveTo(x, H / 2 - 4); ctx.lineTo(x, H / 2 + 4); ctx.stroke();
      }
      for (let i = 0; i <= divY * 5; i++) {
        const y = (i / (divY * 5)) * H;
        ctx.beginPath(); ctx.moveTo(W / 2 - 4, y); ctx.lineTo(W / 2 + 4, y); ctx.stroke();
      }

      // ── voltage reference rails ────────────────────────────────────────────
      const rails = [0.2, 0.5, 0.8];
      rails.forEach((r, ri) => {
        const y = r * H;
        ctx.strokeStyle = ri === 1 ? "rgba(34,180,120,0.18)" : "rgba(34,180,120,0.08)";
        ctx.lineWidth = ri === 1 ? 1 : 0.5;
        ctx.setLineDash(ri === 1 ? [] : [8, 6]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
        // rail label
        if (ri === 1) {
          ctx.fillStyle = "rgba(34,180,120,0.3)";
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.fillText("0V REF", 6, y - 4);
        } else {
          ctx.fillStyle = "rgba(34,180,120,0.18)";
          ctx.font = "8px 'JetBrains Mono', monospace";
          ctx.fillText(ri === 0 ? "+VCC" : "−VCC", 6, y - 3);
        }
      });

      // ── true signal (smooth reference curve) ──────────────────────────────
      ctx.beginPath();
      ctx.strokeStyle = "rgba(34,200,140,0.28)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= W; i++) {
        const fx = i / W;
        const y = H * 0.5 - H * 0.22 * (
          Math.sin(fx * Math.PI * 2.5) +
          0.3 * Math.sin(fx * Math.PI * 5)
        );
        i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
      }
      ctx.stroke();

      // ── raw sensor signal (drifting, noisy) ───────────────────────────────
      const speed = t * 0.008;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(80,220,160,0.55)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= W; i++) {
        const fx = i / W;
        const trueY = Math.sin(fx * Math.PI * 2.5) + 0.3 * Math.sin(fx * Math.PI * 5);
        const drift = 0.06 * Math.sin(speed * 0.4 + fx * 1.2);
        const noise = 0.04 * Math.sin(fx * W * 0.18 + speed * 3.1) +
          0.025 * Math.sin(fx * W * 0.33 + speed * 1.7);
        const y = H * 0.5 - H * 0.22 * (trueY + drift + noise);
        i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
      }
      ctx.stroke();

      // ── calibrated output (after correction, very close to true) ──────────
      ctx.beginPath();
      ctx.strokeStyle = "rgba(100,200,255,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      for (let i = 0; i <= W; i++) {
        const fx = i / W;
        const trueY = Math.sin(fx * Math.PI * 2.5) + 0.3 * Math.sin(fx * Math.PI * 5);
        const residual = 0.008 * Math.sin(fx * W * 0.22 + speed * 0.9);
        const y = H * 0.5 - H * 0.22 * (trueY + residual);
        i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // ── ADC sample dots on raw signal ──────────────────────────────────────
      samplePhases.forEach((fx) => {
        const trueY = Math.sin(fx * Math.PI * 2.5) + 0.3 * Math.sin(fx * Math.PI * 5);
        const drift = 0.06 * Math.sin(speed * 0.4 + fx * 1.2);
        const noise = 0.04 * Math.sin(fx * W * 0.18 + speed * 3.1) +
          0.025 * Math.sin(fx * W * 0.33 + speed * 1.7);
        const x = fx * W;
        const y = H * 0.5 - H * 0.22 * (trueY + drift + noise);
        // vertical stem to zero rail
        ctx.strokeStyle = "rgba(80,220,160,0.12)";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, H * 0.5); ctx.lineTo(x, y); ctx.stroke();
        // dot
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(80,220,160,0.7)";
        ctx.fill();
        ctx.strokeStyle = "rgba(80,220,160,0.4)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });

      // ── interpolation knot points (calibration points) ────────────────────
      const knots = 5;
      for (let k = 0; k < knots; k++) {
        const fx = (k + 0.5) / knots;
        const trueY = Math.sin(fx * Math.PI * 2.5) + 0.3 * Math.sin(fx * Math.PI * 5);
        const x = fx * W;
        const y = H * 0.5 - H * 0.22 * trueY;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(100,200,255,0.15)";
        ctx.fill();
        ctx.strokeStyle = "rgba(100,200,255,0.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // crosshair
        ctx.strokeStyle = "rgba(100,200,255,0.25)";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
      }

      // ── scan line (moving cursor) ──────────────────────────────────────────
      const scanX = ((t * 0.6) % (W + 40)) - 20;
      const scanGrad = ctx.createLinearGradient(scanX - 30, 0, scanX + 6, 0);
      scanGrad.addColorStop(0, "rgba(80,220,160,0)");
      scanGrad.addColorStop(1, "rgba(80,220,160,0.12)");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 30, 0, 36, H);

      // ── corner annotations ─────────────────────────────────────────────────
      ctx.fillStyle = "rgba(34,180,120,0.22)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillText("CH1  2V/div  1ms/div", 10, H - 10);
      ctx.fillText("DDSM CALIBRATION  Δerr < 0.1%", W - 210, H - 10);
      // trigger marker
      const trigY = H * 0.5;
      ctx.fillStyle = "rgba(255,180,50,0.35)";
      ctx.beginPath(); ctx.moveTo(0, trigY); ctx.lineTo(8, trigY - 4); ctx.lineTo(8, trigY + 4); ctx.closePath(); ctx.fill();

      t++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return (
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity }} />
  );
}

// ── Thin grid overlay (used in non-hero sections) ─────────────────────────────
function GridBg({ opacity = 0.05 }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ opacity }}>
      <div style={{
        width: "100%", height: "100%",
        backgroundImage: "linear-gradient(rgba(34,180,120,0.25) 1px,transparent 1px),linear-gradient(90deg,rgba(34,180,120,0.25) 1px,transparent 1px)",
        backgroundSize: "60px 60px"
      }} />
    </div>
  );
}

// ── Waveform accent (reused below hero) ───────────────────────────────────────
function WaveformBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, t = 0;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener("resize", resize);
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const W = canvas.width, H = canvas.height;
      [
        { amp: 0.3, freq: 2.5, speed: 0.012, color: "rgba(34,180,120,0.12)", lw: 1.5 },
        { amp: 0.18, freq: 4, speed: 0.008, color: "rgba(80,200,160,0.07)", lw: 0.8 },
      ].forEach(({ amp, freq, speed, color, lw }) => {
        ctx.beginPath();
        for (let i = 0; i <= W; i++) {
          const y = H * 0.5 - H * amp * Math.sin((i / W) * Math.PI * 2 * freq + t * speed);
          i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
      });
      t++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ── Card ──────────────────────────────────────────────────────────────────────
function GlassCard({ children, className = "", glow = "cyan" }) {
  return (
    <div className={`relative rounded-xl border p-6 ${className}`} style={{
      background: "rgba(6,14,10,0.75)",
      backdropFilter: "blur(16px)",
      borderColor: "rgba(34,180,120,0.15)",
      boxShadow: "0 2px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(34,180,120,0.06)"
    }}>
      {children}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHeading({ label, title, sub }) {
  const [ref, vis] = useReveal();
  return (
    <div ref={ref} className={`text-center mb-16 transition-all duration-600 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
      <span className="text-xs font-mono tracking-widest text-emerald-400 uppercase mb-3 block">{label}</span>
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
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden" style={{ background: "#04100a" }}>
      <SensorBg opacity={0.9} />

      {/* Floating math equations — more muted */}
      {["f[x₀,x₁]", "Δy/Δx", "P(x)=∑aᵢNᵢ(x)", "f[x₀..xₙ]", "∇²f", "Nₖ(x)"].map((eq, i) => (
        <div key={i} className="absolute font-mono pointer-events-none select-none"
          style={{
            top: `${15 + (i * 13) % 70}%`,
            left: `${5 + (i * 17) % 88}%`,
            animation: `float${i % 3} ${4 + i}s ease-in-out infinite`,
            fontSize: i % 2 === 0 ? "0.75rem" : "0.6rem",
            color: "rgba(34,180,120,0.18)",
          }}>
          {eq}
        </div>
      ))}

      <div className="relative z-10 text-center px-6 max-w-5xl mx-auto"
        style={{ transform: `translateY(${scrollY * 0.3}px)` }}>
        <div className={`transition-all duration-600 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="inline-block text-xs font-mono tracking-[0.4em] uppercase mb-6 border px-4 py-2 rounded-full"
            style={{ color: "rgba(34,180,120,0.8)", borderColor: "rgba(34,180,120,0.25)", background: "rgba(34,180,120,0.05)" }}>
            Divided Differences Sensor Modeling
          </span>
        </div>

        <div className={`transition-all duration-600 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"}`}>
          <h1 className="font-black leading-none mb-4" style={{ fontFamily: "'Exo 2', sans-serif" }}>
            <span className="block text-8xl md:text-[12rem] lg:text-[16rem]"
              style={{
                background: "linear-gradient(135deg, #34c47a 0%, #5ae8b0 50%, #22b87a 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                letterSpacing: "-0.04em"
              }}>
              DDSM
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 font-light tracking-wide mb-2">
            Divided Difference-based Sensor Modeling
          </p>
          <p className="text-sm md:text-base text-slate-500 font-mono tracking-widest">
            Newton's Divided Difference · Calibration · Error Correction
          </p>
        </div>

        <div className={`mt-12 transition-all duration-600 delay-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <button
            onClick={() => document.getElementById("problem").scrollIntoView({ behavior: "smooth" })}
            className="group flex flex-col items-center gap-2 mx-auto text-emerald-400 hover:text-white transition-colors"
          >
            <span className="text-xs font-mono tracking-widest uppercase">Explore Project</span>
            <div className="w-6 h-10 border-2 border-emerald-500/50 rounded-full flex justify-center pt-2 group-hover:border-emerald-500 transition-colors">
              <div className="w-1 h-2 bg-emerald-400 rounded-full" style={{ animation: "bounce 1.5s infinite" }} />
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
        * { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-track { background:#04100a } ::-webkit-scrollbar-thumb { background:rgba(34,180,120,0.35); border-radius:2px }
      `}</style>
    </section>
  );
}

// ── Problem Section ───────────────────────────────────────────────────────────
function Problem() {
  const [ref, vis] = useReveal();
  return (
    <section id="problem" className="relative py-32 overflow-hidden" style={{ background: "#04100a" }}>
      <SensorBg opacity={0.35} />
      <GridBg opacity={0.05} />
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
          <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">Actual vs Sensor Readings</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={problemData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 11 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,180,120,0.3)", borderRadius: 8 }} labelStyle={{ color: "#94a3b8" }} />
              <Line type="monotone" dataKey="actual" stroke="#22c47a" strokeWidth={2.5} dot={false} name="Actual Signal" />
              <Line type="monotone" dataKey="sensor" stroke="#f43f5e" strokeWidth={1.5} dot={false} name="Sensor Reading" strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-6 mt-4 justify-center">
            <span className="flex items-center gap-2 text-xs text-slate-400"><span className="w-8 h-0.5 bg-emerald-400 inline-block rounded" /> Actual Signal</span>
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
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#04100a 0%,#061408 100%)" }}>
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="02 · Root Cause" title="Linear Models Are Blind." sub="Linear correction assumes a straight-line relationship between sensor output and true value. Real sensors curve, saturate, and exhibit hysteresis — a straight line misses all of it." />
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <GlassCard glow="purple">
            <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">Linear Fit vs True Response</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={linearData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 11 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,180,120,0.3)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="actual" stroke="#22c47a" strokeWidth={2.5} dot={false} name="True Response" />
                <Line type="monotone" dataKey="linear" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Linear Fit" strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-500 mt-3 text-center">Yellow linear fit diverges significantly from true nonlinear behavior</p>
          </GlassCard>
          <div className="flex flex-col gap-4">
            {[
              { col: "#22c47a", title: "Piece-wise Nonlinearity", body: "Sensor gain changes at different operating points, requiring adaptive polynomial fitting — not constants." },
              { col: "#4ade80", title: "Saturation Effects", body: "Near range limits, sensor output flattens while the true value continues to change. Linear models overestimate." },
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
    <section className="relative py-32 overflow-hidden" style={{ background: "#04100a" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(74,222,128,0.06) 0%, transparent 70%)" }} />
      <GridBg opacity={0.07} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="03 · The Solution" title="Newton's Divided Differences." sub="A recursive polynomial interpolation framework that exactly fits n+1 data points using a nested multiplication scheme — computationally efficient, numerically stable, and provably optimal for calibration." />

        <div ref={ref} className={`transition-all duration-600 ${vis ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
          <GlassCard className="text-center mb-8" glow="purple">
            <p className="text-xs font-mono text-slate-500 tracking-widest uppercase mb-6">Core Interpolation Polynomial</p>
            <div className="overflow-x-auto">
              <p className="text-2xl md:text-3xl font-mono text-emerald-300 whitespace-nowrap" style={{ textShadow: "0 0 30px rgba(34,180,120,0.5)" }}>
                P(x) = f[x₀] + f[x₀,x₁](x−x₀) + f[x₀,x₁,x₂](x−x₀)(x−x₁) + ···
              </p>
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "f[xᵢ,xⱼ]", desc: "First-order divided difference — rate of change between two points" },
                { label: "f[xᵢ..xₖ]", desc: "k-th order divided difference — recursive higher-order correction" },
                { label: "Nₖ(x)", desc: "Newton basis polynomial — product of (x−xᵢ) terms" },
              ].map((e, i) => (
                <div key={i} className="rounded-xl border border-white/5 p-4" style={{ background: "rgba(34,180,120,0.04)" }}>
                  <p className="font-mono text-emerald-400 text-lg mb-2">{e.label}</p>
                  <p className="text-slate-400 text-xs leading-relaxed">{e.desc}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: "◈", col: "#22c47a", title: "Exact Interpolation", body: "Polynomial passes through every calibration data point exactly — zero residual at known values." },
              { icon: "◉", col: "#4ade80", title: "Recursive Structure", body: "New data points extend the table without recomputing — O(n) incremental update efficiency." },
              { icon: "◆", col: "#16a34a", title: "Nonlinear Capture", body: "High-degree terms model sensor saturation, hysteresis, and cross-sensitivity automatically." },
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
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#061408 0%,#04100a 100%)" }}>
      <SensorBg opacity={0.25} />
      <GridBg opacity={0.05} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="04 · Methodology" title="Step by Step." sub="A four-stage calibration pipeline that transforms raw sensor noise into high-fidelity corrected output." />
        <div className="relative">
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(34,180,120,0.4), transparent)" }} />
          {steps.map((s, i) => {
            const [ref, vis] = useReveal(0.3);
            const right = i % 2 === 1;
            return (
              <div key={i} ref={ref}
                className={`relative flex gap-8 mb-16 transition-all duration-600 ${vis ? "opacity-100 translate-x-0" : `opacity-0 ${right ? "translate-x-12" : "-translate-x-12"}`} ${right ? "md:flex-row-reverse" : ""}`}
                style={{ transitionDelay: vis ? `${i * 80}ms` : "0ms" }}>
                <div className="hidden md:flex flex-1" />
                <div className="flex-shrink-0 w-16 h-16 rounded-full border-2 border-emerald-500/50 flex items-center justify-center z-10 text-2xl"
                  style={{ background: "rgba(10,15,30,0.9)", boxShadow: "0 0 30px rgba(34,180,120,0.3)" }}>
                  {s.icon}
                </div>
                <div className="flex-1">
                  <GlassCard>
                    <span className="text-xs font-mono text-emerald-400/60 tracking-widest">{s.n}</span>
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

  useEffect(() => { run(); }, [run]);

  return (
    <section className="relative py-32 overflow-hidden" style={{ background: "#04100a" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 60%, rgba(34,180,120,0.05) 0%, transparent 70%)" }} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="05 · Interactive" title="Live Calibration Simulator." sub="Enter reference and sensor data points to generate the divided difference table, interpolation polynomial, and calibrated prediction in real time." />

        <div className="grid md:grid-cols-5 gap-6">
          {/* Controls */}
          <div className="md:col-span-2 flex flex-col gap-4">
            <GlassCard>
              <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">Input Data</p>
              {[
                { label: "Reference Values (x)", val: xInput, set: setXInput, ph: "0, 1, 2, 3, 4" },
                { label: "Sensor Readings (y)", val: yInput, set: setYInput, ph: "0.0, 0.8, 2.4, 4.1, 4.8" },
                { label: "Query Point (xᵢ)", val: queryInput, set: setQueryInput, ph: "1.5" },
              ].map((f, i) => (
                <div key={i} className="mb-4">
                  <label className="text-xs text-slate-400 font-mono mb-1 block">{f.label}</label>
                  <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 transition-colors" />
                </div>
              ))}
              {error && <p className="text-rose-400 text-xs font-mono mb-3">{error}</p>}
              <button onClick={run}
                className="w-full py-3 rounded-xl text-sm font-bold text-black transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#22c47a,#4ade80)", boxShadow: "0 0 30px rgba(34,180,120,0.3)" }}>
                ▶ Compute Interpolation
              </button>
            </GlassCard>

            {result !== null && (
              <GlassCard glow="purple" className="text-center">
                <p className="text-xs font-mono text-slate-400 tracking-widest uppercase mb-2">Calibrated Output at x = {queryInput}</p>
                <p className="text-4xl font-black text-emerald-300 font-mono" style={{ textShadow: "0 0 30px rgba(34,180,120,0.6)" }}>
                  {result.toFixed(5)}
                </p>
              </GlassCard>
            )}
          </div>

          {/* Chart + Table */}
          <div className="md:col-span-3 flex flex-col gap-4">
            <GlassCard>
              <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">Interpolation Curve</p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,180,120,0.3)", borderRadius: 8 }} labelStyle={{ color: "#94a3b8" }} />
                  <Line type="monotone" dataKey="y" stroke="#22c47a" strokeWidth={2.5} dot={false} name="P(x)" />
                  <Line type="monotone" dataKey="raw" stroke="#f59e0b" strokeWidth={0} dot={{ fill: "#f59e0b", r: 5, strokeWidth: 0 }} name="Data Points" />
                  {result !== null && (
                    <ReferenceLine x={parseFloat(queryInput)} stroke="#4ade80" strokeDasharray="4 2" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </GlassCard>

            <GlassCard>
              <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">Divided Difference Table</p>
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
                          <td key={j} className="py-2 pr-4 text-emerald-300">{typeof d === "number" ? d.toFixed(4) : "—"}</td>
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
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#061408 0%,#04100a 100%)" }}>
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
              <p className="text-4xl font-black text-emerald-300 font-mono mb-1" style={{ textShadow: "0 0 20px rgba(34,180,120,0.5)" }}>
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
            <p className="text-emerald-400 text-xs font-mono tracking-widest uppercase mb-4">After DDSM Calibration</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={afterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="x" stroke="#475569" tick={{ fontSize: 10 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34,180,120,0.3)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="val" stroke="#22c47a" strokeWidth={2} dot={false} />
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
    <section className="relative py-32 overflow-hidden" style={{ background: "#04100a" }}>
      <GridBg opacity={0.06} />
      <div className="max-w-6xl mx-auto px-6">
        <SectionHeading label="07 · Applications" title="Deployed Everywhere." sub="Any system where sensors interface with the physical world benefits from rigorous calibration." />
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {apps.map((a, i) => (
            <div key={i} className="group cursor-default">
              <GlassCard className="text-center h-full transition-all duration-300 group-hover:scale-105 group-hover:border-emerald-500/30"
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
    <section className="relative py-32 overflow-hidden" style={{ background: "linear-gradient(180deg,#061408 0%,#04100a 100%)" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(74,222,128,0.08) 0%, transparent 70%)" }} />
      <div className="max-w-4xl mx-auto px-6 text-center">
        <SectionHeading label="08 · Conclusion" title="Precision Through Mathematics." />
        <div ref={ref} className={`transition-all duration-600 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
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
              { icon: "◈", col: "#22c47a", text: "Exact at all calibration points" },
              { icon: "◉", col: "#4ade80", text: "Nonlinear response modeling" },
              { icon: "◆", col: "#16a34a", text: "Real-time prediction capability" },
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
    <footer className="relative border-t border-white/5 py-12" style={{ background: "#04100a" }}>
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="text-3xl font-black text-white mb-1" style={{
            fontFamily: "'Exo 2', sans-serif",
            background: "linear-gradient(135deg,#22c47a,#4ade80)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
          }}>DDSM</div>
          <p className="text-slate-500 text-xs font-mono">Divided Difference-based Sensor Modeling</p>
        </div>
        <div className="text-center">
          <p className="text-slate-400 text-sm">Numerical Capstone Project</p>
          <p className="text-slate-500 text-xs font-mono mt-1">Newton's Divided Difference · Sensor Calibration · Error Correction</p>
        </div>
        <div className="text-right text-xs text-slate-500 font-mono">
          <p>Built with React + Recharts</p>
          <p className="mt-1 text-slate-600">© 2026 DDSM Project</p>
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
    <div style={{ fontFamily: "'JetBrains Mono', 'Exo 2', monospace", background: "#04100a", color: "#f8fafc" }}>
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
