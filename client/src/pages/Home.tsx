import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Activity, ArrowDownRight, ArrowUpRight, Check, ChevronDown, ChevronUp, CircleHelp, Clock3, DollarSign, Gauge, GitBranch, KeyRound, Layers3, Loader2, LogOut, MessageSquare, RefreshCw, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Terminal, TriangleAlert, User, Zap } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ProviderId, ProviderHealth, RoutingStrategy } from "@shared/gateway";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const strategyOptions: Array<{ value: RoutingStrategy; label: string; hint: string }> = [
  { value: "fallback-on-failure", label: "Fallback on failure", hint: "Prefer weighted primary, recover automatically" },
  { value: "round-robin", label: "Round robin", hint: "Distribute requests evenly" },
  { value: "cheapest-first", label: "Cheapest first", hint: "Optimize token economics" },
  { value: "fastest-first", label: "Fastest first", hint: "Use observed latency" },
];

function formatDate(value?: string) {
  if (!value) return "No traffic yet";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusTone(status: string) {
  if (status === "healthy") return "text-emerald-300 bg-emerald-400/10 border-emerald-400/20";
  if (status === "degraded") return "text-amber-300 bg-amber-400/10 border-amber-400/20";
  if (status === "open") return "text-rose-300 bg-rose-400/10 border-rose-400/20";
  return "text-slate-400 bg-slate-400/10 border-slate-400/20";
}

function AppMark() {
  return <div className="brand-mark"><span /><span /><span /></div>;
}

export default function Home() {
  const [, setLocation] = useLocation();
  const snapshotQuery = trpc.gateway.snapshot.useQuery(undefined, { refetchInterval: 10000 });
  const utils = trpc.useUtils();
  const updateConfig = trpc.gateway.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Routing policy saved");
      void utils.gateway.snapshot.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const chat = trpc.gateway.chat.useMutation({
    onSuccess: response => {
      setDemoResponse(response.message.content);
      toast.success(`${response.provider} responded in ${response.latencyMs}ms`);
      void utils.gateway.snapshot.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const snapshot = snapshotQuery.data;
  const [strategy, setStrategy] = useState<RoutingStrategy>("fallback-on-failure");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [failureThreshold, setFailureThreshold] = useState(3);
  const [recoverySeconds, setRecoverySeconds] = useState(30);
  const [prompt, setPrompt] = useState("Summarize how adaptive routing protects an LLM gateway.");
  const [activeProvider, setActiveProvider] = useState<ProviderId>("groq");
  const [demoResponse, setDemoResponse] = useState("");

  // New state for previously-broken controls
  const [activeSection, setActiveSection] = useState("overview");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adaptersOpen, setAdaptersOpen] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<"24h" | "7d">("24h");

  // Scroll-spy: update active nav item based on scroll position
  const sectionIds = ["overview", "providers", "routing", "logs"];
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY + 120;
      for (const id of [...sectionIds].reverse()) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= scrollY) {
          setActiveSection(id);
          return;
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Chart data: 24h uses hourly bars, 7d uses daily bars
  // Values are raw counts; we normalise to % of the max before rendering
  const chartData24h = [44, 58, 47, 72, 63, 86, 78, 91, 68, 82, 76, 96];
  const chartData7d = [310, 428, 395, 512, 467, 580, 543];
  const chartRaw = chartPeriod === "24h" ? chartData24h : chartData7d;
  const chartMax = Math.max(...chartRaw);
  const chartBars = chartRaw.map(v => Math.round((v / chartMax) * 96)); // scale to max 96%
  const chartTotal = chartPeriod === "24h" ? "2,847" : "3,235";
  const chartLabel = (index: number) =>
    chartPeriod === "24h"
      ? index % 3 === 0 ? `${index + 1}:00` : ""
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "";

  useEffect(() => {
    if (!snapshot?.config) return;
    setStrategy(snapshot.config.strategy);
    setFallbackEnabled(snapshot.config.fallbackEnabled);
    setFailureThreshold(snapshot.config.failureThreshold);
    setRecoverySeconds(snapshot.config.recoverySeconds);
  }, [snapshot?.config]);

  const metrics = useMemo(() => {
    const providers = snapshot?.providers ?? [];
    const requests = providers.reduce((sum, provider) => sum + provider.requests, 0);
    const failures = providers.reduce((sum, provider) => sum + provider.failures, 0);
    const avgLatency = providers.length ? Math.round(providers.reduce((sum, provider) => sum + provider.avgLatencyMs, 0) / providers.length) : 0;
    const successRate = requests ? Math.round(((requests - failures) / requests) * 100) : 100;
    return { requests, failures, avgLatency, successRate };
  }, [snapshot?.providers]);

  const saveConfig = () => updateConfig.mutate({ strategy, fallbackEnabled, failureThreshold, recoverySeconds, weights: snapshot?.config.weights ?? { groq: 60, gemini: 40 } });
  const sendChat = (simulateFailureProvider?: ProviderId) => chat.mutate({ messages: [{ role: "user", content: prompt }], strategy, simulateFailureProvider });

  const allLogs = snapshot?.logs ?? [];
  const visibleLogs = showAllLogs ? allLogs : allLogs.slice(0, 5);

  return (
    <div className="gateway-shell">
      {/* ── Settings Dialog ───────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="gateway-dialog">
          <DialogHeader>
            <DialogTitle><Settings2 size={18} style={{ display: "inline", marginRight: 8 }} />Gateway settings</DialogTitle>
            <DialogDescription>Configure provider API keys and runtime options as server-side environment variables.</DialogDescription>
          </DialogHeader>
          <div className="settings-section">
            <h4><KeyRound size={15} /> Provider API keys</h4>
            <p>Keys are never sent to the browser. Set them as environment variables on the server:</p>
            <div className="env-block">
              <div className="env-row"><code>GROQ_API_KEY</code><span>gsk_…</span></div>
              <div className="env-row"><code>GEMINI_API_KEY</code><span>AIza…</span></div>
            </div>
            <p className="settings-hint">When a key is absent the gateway uses its built-in demo adapter — the dashboard, routing controls, and fallback simulation all remain functional.</p>
          </div>
          <div className="settings-section">
            <h4><ShieldCheck size={15} /> Auth &amp; session</h4>
            <div className="env-block">
              <div className="env-row"><code>JWT_SECRET</code><span>random 256-bit string</span></div>
              <div className="env-row"><code>OAUTH_SERVER_URL</code><span>https://…</span></div>
            </div>
          </div>
          <div className="settings-section">
            <h4><Activity size={15} /> Database</h4>
            <div className="env-block">
              <div className="env-row"><code>DATABASE_URL</code><span>mysql://user:pass@host/db</span></div>
            </div>
            <p className="settings-hint">Run <code>pnpm db:push</code> after setting the URL to apply the schema.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Manage Adapters Dialog ────────────────────────────────── */}
      <Dialog open={adaptersOpen} onOpenChange={setAdaptersOpen}>
        <DialogContent className="gateway-dialog">
          <DialogHeader>
            <DialogTitle><Layers3 size={18} style={{ display: "inline", marginRight: 8 }} />Provider adapters</DialogTitle>
            <DialogDescription>Each adapter is an isolated server-side module. Provider keys are injected at startup and never exposed to the client.</DialogDescription>
          </DialogHeader>
          {(snapshot?.providers ?? []).map(p => (
            <div key={p.id} className="adapter-card">
              <div className={`provider-brand ${p.id}`} style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>{p.id === "groq" ? "G" : "✦"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>{p.name}</strong>
                  <span className={`status-pill ${statusTone(p.status)}`}><i /> {p.status}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{p.model} · {p.configured ? "API key configured" : "No API key — demo adapter active"}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-muted)" }}>
                <div>{p.requests} req</div>
                <div>{p.successRate}% ok</div>
              </div>
            </div>
          ))}
          <p className="settings-hint" style={{ marginTop: 8 }}>To connect a live provider, add its key as a server environment variable and restart. See <strong>Settings</strong> for the variable names.</p>
        </DialogContent>
      </Dialog>

      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand"><AppMark /><div><p className="brand-title">relay<span>ops</span></p><p className="brand-subtitle">LLM gateway console</p></div></div>
          <nav className="nav-list">
            <a className={`nav-item ${activeSection === "overview" ? "active" : ""}`} href="#overview" onClick={() => setActiveSection("overview")}><Gauge size={17} /> Overview {activeSection === "overview" && <span className="nav-pip" />}</a>
            <a className={`nav-item ${activeSection === "providers" ? "active" : ""}`} href="#providers" onClick={() => setActiveSection("providers")}><Layers3 size={17} /> Providers</a>
            <a className={`nav-item ${activeSection === "routing" ? "active" : ""}`} href="#routing" onClick={() => setActiveSection("routing")}><GitBranch size={17} /> Routing rules</a>
            <a className={`nav-item ${activeSection === "logs" ? "active" : ""}`} href="#logs" onClick={e => { e.preventDefault(); setLocation("/logs"); }}><Terminal size={17} /> Request logs <ArrowUpRight size={12} style={{ marginLeft: "auto", opacity: 0.5 }} /></a>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="side-note"><CircleHelp size={16} /><div><strong>Gateway v2</strong><span>Portfolio build · 0.8.4</span></div></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="user-chip" style={{ cursor: "pointer" }} role="button" aria-label="Account menu">
                <div className="avatar">AR</div>
                <div><strong>Alex Rivera</strong><span>Owner / admin</span></div>
                <ChevronDown size={15} />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" style={{ minWidth: 180 }}>
              <DropdownMenuItem onClick={() => toast.info("Profile management coming soon.")}>
                <User size={14} style={{ marginRight: 8 }} /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSettingsOpen(true); }}>
                <Settings2 size={14} style={{ marginRight: 8 }} /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toast.info("No active session — running in demo mode.")}>
                <LogOut size={14} style={{ marginRight: 8 }} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div><p className="eyebrow">CONTROL PLANE / LIVE</p><h1>Gateway overview</h1></div>
          <div className="top-actions">
            <span className="live-status"><i /> All systems nominal</span>
            <button className="icon-btn" onClick={() => void snapshotQuery.refetch()} aria-label="Refresh"><RefreshCw size={17} className={snapshotQuery.isFetching ? "spin" : ""} /></button>
            <button className="outline-btn" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Settings</button>
          </div>
        </header>

        {/* ── Loading state ──────────────────────────────────────── */}
        {snapshotQuery.isLoading && !snapshotQuery.data && (
          <div className="loading-state" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem", color: "var(--text-muted)" }}>
            <Loader2 size={24} className="spin" style={{ marginRight: 12 }} /> Loading gateway data…
          </div>
        )}

        {/* ── Error state ────────────────────────────────────────── */}
        {snapshotQuery.isError && (
          <div className="error-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem", gap: 16, color: "var(--text-muted)" }}>
            <TriangleAlert size={24} style={{ color: "var(--rose)" }} />
            <p>Failed to load gateway data.</p>
            <button className="outline-btn" onClick={() => void snapshotQuery.refetch()}>Retry</button>
          </div>
        )}

        {/* ── Main content (shown once data is available) ─────────── */}
        {!snapshotQuery.isLoading && !snapshotQuery.isError && (
          <>
            <section className="hero-banner"><div><div className="hero-kicker"><Sparkles size={15} /> ROUTING INTELLIGENCE</div><h2>One gateway.<br /><em>Every model.</em></h2><p>Direct traffic to the right provider, keep latency predictable, and fail gracefully when the edge gets noisy.</p></div><div className="hero-visual"><div className="orb orb-one" /><div className="orb orb-two" /><div className="route-line route-a" /><div className="route-line route-b" /><div className="route-line route-c" /><div className="hero-node"><Zap size={21} /><span>ROUTE</span></div><div className="provider-dot dot-groq">G</div><div className="provider-dot dot-gemini">✦</div></div></section>

            <section className="metric-grid">
              <MetricCard label="Requests today" value={metrics.requests.toLocaleString()} icon={<Activity size={16} />} accent="blue" />
              <MetricCard label="Success rate" value={`${metrics.successRate}%`} icon={<ShieldCheck size={16} />} accent="green" />
              <MetricCard label="Avg. latency" value={`${metrics.avgLatency || 642}ms`} icon={<Clock3 size={16} />} accent="violet" />
              <MetricCard label="Fallback events" value={metrics.failures.toString()} icon={<GitBranch size={16} />} accent="orange" />
            </section>

            <section className="content-grid">
              <div className="panel providers-panel" id="providers"><div className="panel-header"><div><p className="panel-kicker">PROVIDER HEALTH</p><h3>Adapter status</h3></div><span className="tiny-label"><i /> AUTO-REFRESH 10S</span></div><div className="provider-list">{(snapshot?.providers ?? []).map(provider => <ProviderRow key={provider.id} provider={provider} active={activeProvider === provider.id} onClick={() => setActiveProvider(provider.id)} />)}</div><div className="provider-footer"><span><span className="legend-dot healthy" /> Healthy <span className="legend-dot warning" /> Degraded <span className="legend-dot off" /> Unconfigured</span><button className="text-btn" onClick={() => setAdaptersOpen(true)}>Manage adapters <ArrowUpRight size={14} /></button></div></div>
              <div className="panel chart-panel"><div className="panel-header"><div><p className="panel-kicker">TRAFFIC MIX</p><h3>Requests by provider</h3></div><select className="period-select" value={chartPeriod} onChange={e => setChartPeriod(e.target.value as "24h" | "7d")}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></select></div><div className="chart-wrap"><div className="chart-y"><span>1.2k</span><span>800</span><span>400</span><span>0</span></div><div className="chart"><div className="chart-grid"><i /><i /><i /><i /></div><div className="bars">{chartBars.map((height, index) => <div className="bar-group" key={index}><div className="bar bar-blue" style={{ height: `${height}%` }} /><div className="bar bar-purple" style={{ height: `${Math.max(18, height - 22)}%` }} /><span>{chartLabel(index)}</span></div>)}</div></div></div><div className="chart-legend"><span><i className="legend-line blue" /> Groq <strong>64%</strong></span><span><i className="legend-line purple" /> Gemini <strong>36%</strong></span><span className="chart-total">{chartTotal} total</span></div></div>
            </section>

            <section className="content-grid lower-grid">
              <div className="panel routing-panel" id="routing"><div className="panel-header"><div><p className="panel-kicker">ROUTING POLICY</p><h3>How traffic moves</h3></div><span className="config-dot">● Draft synced</span></div><div className="field-label">Primary strategy</div><div className="strategy-grid">{strategyOptions.map(option => <button key={option.value} className={`strategy-card ${strategy === option.value ? "selected" : ""}`} onClick={() => setStrategy(option.value)}><span className="radio-dot">{strategy === option.value && <i />}</span><span><strong>{option.label}</strong><small>{option.hint}</small></span></button>)}</div><div className="routing-controls"><label><span>Failure threshold</span><input type="number" min="1" max="20" value={failureThreshold} onChange={event => setFailureThreshold(Number(event.target.value))} /></label><label><span>Recovery cooldown</span><div className="input-with-suffix"><input type="number" min="5" max="3600" value={recoverySeconds} onChange={event => setRecoverySeconds(Number(event.target.value))} /><em>sec</em></div></label><label className="toggle-row"><span><strong>Auto fallback</strong><small>Retry the next healthy provider</small></span><button className={`toggle ${fallbackEnabled ? "on" : ""}`} onClick={() => setFallbackEnabled(value => !value)} aria-label="Toggle auto fallback" role="switch" aria-checked={fallbackEnabled}><i /></button></label></div><button className="save-btn" onClick={saveConfig} disabled={updateConfig.isPending}>{updateConfig.isPending ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Save routing policy</button></div>
              <div className="panel playground-panel"><div className="panel-header"><div><p className="panel-kicker">ROUTE PLAYGROUND</p><h3>Test the gateway</h3></div><span className="tiny-label">UNIFIED API</span></div><p className="playground-copy">Send a prompt through the active policy. Use the failure simulator to verify fallback behavior without spending provider quota.</p><textarea className="prompt-box" value={prompt} onChange={event => setPrompt(event.target.value)} /><div className="playground-actions"><button className="primary-btn" onClick={() => sendChat()} disabled={chat.isPending}><Send size={15} /> {chat.isPending ? "Routing..." : "Send request"}</button><button className="ghost-btn" onClick={() => sendChat(activeProvider)} disabled={chat.isPending}><TriangleAlert size={15} /> Simulate {activeProvider} failure</button></div>{demoResponse && <div className="response-box"><div className="response-head"><span><MessageSquare size={14} /> Latest response</span><span className="response-chip">{chat.data?.provider ?? "demo"} · {chat.data?.latencyMs ?? "—"}ms</span></div><p>{demoResponse}</p></div>}</div>
            </section>

            <section className="panel logs-panel" id="logs">
              <div className="panel-header">
                <div><p className="panel-kicker">OBSERVABILITY</p><h3>Recent request logs</h3></div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="text-btn" onClick={() => setShowAllLogs(v => !v)}>
                    {showAllLogs ? <><ChevronUp size={14} /> Show less</> : <><ChevronDown size={14} /> Show all ({allLogs.length})</>}
                  </button>
                  <button className="text-btn" onClick={() => setLocation("/logs")}>
                    <ArrowUpRight size={14} /> Full log view
                  </button>
                </div>
              </div>
              <div className="logs-table">
                <div className="log-row log-heading"><span>REQUEST</span><span>PROVIDER</span><span>STRATEGY</span><span>LATENCY</span><span>STATUS</span><span>TIME</span></div>
                {visibleLogs.map(log => <div className="log-row" key={`${log.requestId}-${log.createdAt}`}><span className="mono">{log.requestId}</span><span><b className={`provider-icon ${log.provider}`}>{log.provider === "groq" ? "G" : log.provider === "gemini" ? "✦" : "D"}</b>{log.provider}</span><span className="muted-cell">{log.strategy}</span><span className="mono">{log.latencyMs}ms</span><span><span className={`log-status ${log.success ? "success" : "failure"}`}>{log.success ? "Success" : "Failed"}</span>{log.fallbackUsed && <span className="fallback-tag">fallback</span>}</span><span className="muted-cell">{formatDate(log.createdAt)}</span></div>)}
                {!snapshotQuery.isLoading && allLogs.length === 0 && (
                  <div className="log-row" style={{ justifyContent: "center", color: "var(--text-muted)", padding: "1.5rem 0" }}>No requests yet — send one from the Route Playground above.</div>
                )}
              </div>
            </section>
          </>
        )}

        <footer className="page-footer"><span>relayops gateway · v2.0.0</span><span><i /> Service operational · Updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></footer>
      </main>
    </div>
  );
}

function MetricCard({ label, value, delta, up, icon, accent }: { label: string; value: string; delta?: string; up?: boolean; icon: React.ReactNode; accent: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${accent}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {delta && (
        <div className={`metric-delta ${up ? "up" : "down"}`}>
          {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {delta}<span>vs. yesterday</span>
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider, active, onClick }: { provider: ProviderHealth; active: boolean; onClick: () => void }) {
  const isGroq = provider.id === "groq";
  return <button className={`provider-row ${active ? "active" : ""}`} onClick={onClick}><div className={`provider-brand ${isGroq ? "groq" : "gemini"}`}>{isGroq ? "G" : "✦"}</div><div className="provider-main"><div className="provider-name"><strong>{provider.name}</strong><span className={`status-pill ${statusTone(provider.status)}`}><i /> {provider.status}</span></div><span className="provider-model">{provider.model} <span>·</span> {provider.configured ? "API connected" : "demo fallback active"}</span></div><div className="provider-stats"><span><strong>{provider.avgLatencyMs}ms</strong><small>latency</small></span><span><strong>{provider.successRate}%</strong><small>success</small></span></div><ChevronDown size={16} className={`row-chevron ${active ? "rotated" : ""}`} /></button>;
}
