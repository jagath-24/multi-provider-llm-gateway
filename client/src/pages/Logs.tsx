import { useState, useMemo } from "react";
import { ArrowLeft, CheckCircle2, XCircle, GitBranch, RefreshCw, Search, Terminal, TriangleAlert, X, Plus, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { RequestLog, ResponseProvider, RoutingStrategy } from "@shared/gateway";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ProviderBadge({ provider }: { provider: ResponseProvider }) {
  const map: Record<string, { label: string; cls: string }> = {
    groq:   { label: "G",  cls: "groq" },
    gemini: { label: "✦", cls: "gemini" },
    demo:   { label: "D",  cls: "demo" },
  };
  const { label, cls } = map[provider] ?? { label: provider[0].toUpperCase(), cls: "demo" };
  return (
    <span className="log-provider-badge">
      <b className={`provider-icon ${cls}`}>{label}</b>
      {provider}
    </span>
  );
}

const PROVIDERS: ResponseProvider[] = ["groq", "gemini", "demo"];
const STRATEGIES: RoutingStrategy[] = ["fallback-on-failure", "round-robin", "cheapest-first", "fastest-first"];
const MODELS: Record<ResponseProvider, string> = {
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.0-flash",
  demo: "gateway-demo",
};

// ── Add Log dialog ────────────────────────────────────────────────────────────

function AddLogDialog({ open, onOpenChange, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [provider, setProvider] = useState<ResponseProvider>("groq");
  const [model, setModel] = useState(MODELS.groq);
  const [strategy, setStrategy] = useState<RoutingStrategy>("fallback-on-failure");
  const [latencyMs, setLatencyMs] = useState(450);
  const [success, setSuccess] = useState(true);
  const [error, setError] = useState("");
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const addLog = trpc.gateway.addLog.useMutation({
    onSuccess: () => {
      toast.success("Log entry added");
      onAdded();
      onOpenChange(false);
      // reset
      setProvider("groq"); setModel(MODELS.groq); setStrategy("fallback-on-failure");
      setLatencyMs(450); setSuccess(true); setError(""); setFallbackUsed(false);
    },
    onError: e => toast.error(e.message),
  });

  function handleProviderChange(p: ResponseProvider) {
    setProvider(p);
    setModel(MODELS[p]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    addLog.mutate({
      provider,
      model: model.trim() || MODELS[provider],
      strategy,
      latencyMs: Math.max(0, latencyMs),
      success,
      error: !success && error.trim() ? error.trim() : undefined,
      fallbackUsed,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gateway-dialog add-log-dialog">
        <DialogHeader>
          <DialogTitle><Plus size={16} style={{ display: "inline", marginRight: 8 }} />Add log entry</DialogTitle>
          <DialogDescription>Manually create a request log record.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="add-log-form">
          {/* Provider + Model */}
          <div className="add-log-row">
            <label className="add-log-field">
              <span>Provider</span>
              <select
                className="period-select add-log-select"
                value={provider}
                onChange={e => handleProviderChange(e.target.value as ResponseProvider)}
              >
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="add-log-field">
              <span>Model</span>
              <input
                className="add-log-input"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="e.g. llama-3.3-70b-versatile"
              />
            </label>
          </div>

          {/* Strategy + Latency */}
          <div className="add-log-row">
            <label className="add-log-field">
              <span>Strategy</span>
              <select
                className="period-select add-log-select"
                value={strategy}
                onChange={e => setStrategy(e.target.value as RoutingStrategy)}
              >
                {STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="add-log-field">
              <span>Latency (ms)</span>
              <input
                className="add-log-input"
                type="number"
                min={0}
                max={60000}
                value={latencyMs}
                onChange={e => setLatencyMs(Number(e.target.value))}
              />
            </label>
          </div>

          {/* Status + Fallback */}
          <div className="add-log-row">
            <label className="add-log-field">
              <span>Status</span>
              <select
                className="period-select add-log-select"
                value={success ? "success" : "failure"}
                onChange={e => { setSuccess(e.target.value === "success"); if (e.target.value === "success") setError(""); }}
              >
                <option value="success">Success</option>
                <option value="failure">Failure</option>
              </select>
            </label>
            <label className="add-log-field add-log-toggle-field">
              <span>Fallback used</span>
              <button
                type="button"
                className={`toggle ${fallbackUsed ? "on" : ""}`}
                onClick={() => setFallbackUsed(v => !v)}
                aria-label="Toggle fallback used"
                role="switch"
                aria-checked={fallbackUsed}
              ><i /></button>
            </label>
          </div>

          {/* Error message — shown only for failures */}
          {!success && (
            <label className="add-log-field" style={{ marginTop: 4 }}>
              <span>Error message <span style={{ color: "#596375" }}>(optional)</span></span>
              <input
                className="add-log-input"
                value={error}
                onChange={e => setError(e.target.value)}
                placeholder="e.g. 429: quota exceeded"
              />
            </label>
          )}

          <div className="add-log-actions">
            <button type="button" className="ghost-btn" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-btn" disabled={addLog.isPending}>
              {addLog.isPending ? <><Loader2 size={14} className="spin" /> Adding…</> : <><Plus size={14} /> Add log</>}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Logs() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const snapshotQuery = trpc.gateway.snapshot.useQuery(undefined, { refetchInterval: 15000 });
  const allLogs: RequestLog[] = snapshotQuery.data?.logs ?? [];

  const [addOpen, setAddOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState<ResponseProvider | "all">("all");
  const [filterStrategy, setFilterStrategy] = useState<RoutingStrategy | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "success" | "failure">("all");

  const providers = useMemo(() => {
    const set = new Set(allLogs.map(l => l.provider));
    return ["all", ...Array.from(set)] as Array<ResponseProvider | "all">;
  }, [allLogs]);

  const strategies = useMemo(() => {
    const set = new Set(allLogs.map(l => l.strategy));
    return ["all", ...Array.from(set)] as Array<RoutingStrategy | "all">;
  }, [allLogs]);

  const filtered = useMemo(() => {
    return allLogs.filter(log => {
      if (filterProvider !== "all" && log.provider !== filterProvider) return false;
      if (filterStrategy !== "all" && log.strategy !== filterStrategy) return false;
      if (filterStatus === "success" && !log.success) return false;
      if (filterStatus === "failure" && log.success) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          log.requestId.toLowerCase().includes(q) ||
          log.provider.toLowerCase().includes(q) ||
          log.model.toLowerCase().includes(q) ||
          log.strategy.toLowerCase().includes(q) ||
          (log.error ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allLogs, filterProvider, filterStrategy, filterStatus, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const successes = filtered.filter(l => l.success).length;
    const failures = total - successes;
    const avgLatency = total ? Math.round(filtered.reduce((s, l) => s + l.latencyMs, 0) / total) : 0;
    const fallbacks = filtered.filter(l => l.fallbackUsed).length;
    return { total, successes, failures, avgLatency, fallbacks };
  }, [filtered]);

  const hasFilters = filterProvider !== "all" || filterStrategy !== "all" || filterStatus !== "all" || search !== "";

  return (
    <div className="gateway-shell">
      <AddLogDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => void utils.gateway.snapshot.invalidate()}
      />

      <main className="logs-page">
        {/* Header */}
        <div className="logs-page-header">
          <div className="logs-page-title">
            <button className="back-btn" onClick={() => setLocation("/")} aria-label="Back to dashboard">
              <ArrowLeft size={16} />
            </button>
            <Terminal size={20} />
            <div>
              <p className="eyebrow">OBSERVABILITY</p>
              <h1>Request logs</h1>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-btn" onClick={() => setAddOpen(true)} style={{ fontSize: 11, padding: "8px 13px" }}>
              <Plus size={14} /> Add log entry
            </button>
            <button className="icon-btn" onClick={() => void snapshotQuery.refetch()} aria-label="Refresh" title="Refresh">
              <RefreshCw size={16} className={snapshotQuery.isFetching ? "spin" : ""} />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="logs-stats-strip">
          <div className="logs-stat"><span>{stats.total}</span><small>Total</small></div>
          <div className="logs-stat green"><span>{stats.successes}</span><small>Success</small></div>
          <div className="logs-stat red"><span>{stats.failures}</span><small>Failed</small></div>
          <div className="logs-stat"><span>{stats.avgLatency}ms</span><small>Avg latency</small></div>
          <div className="logs-stat orange"><span>{stats.fallbacks}</span><small>Fallbacks</small></div>
        </div>

        {/* Filters */}
        <div className="logs-filters">
          <div className="logs-search-wrap">
            <Search size={13} className="logs-search-icon" />
            <input
              className="logs-search"
              placeholder="Search request ID, provider, model, error…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search logs"
            />
            {search && (
              <button className="logs-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>

          <select className="period-select" value={filterProvider} onChange={e => setFilterProvider(e.target.value as ResponseProvider | "all")} aria-label="Filter by provider">
            {providers.map(p => <option key={p} value={p}>{p === "all" ? "All providers" : p}</option>)}
          </select>

          <select className="period-select" value={filterStrategy} onChange={e => setFilterStrategy(e.target.value as RoutingStrategy | "all")} aria-label="Filter by strategy">
            {strategies.map(s => <option key={s} value={s}>{s === "all" ? "All strategies" : s}</option>)}
          </select>

          <select className="period-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as "all" | "success" | "failure")} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="success">Success only</option>
            <option value="failure">Failures only</option>
          </select>

          {hasFilters && (
            <button className="text-btn" onClick={() => { setSearch(""); setFilterProvider("all"); setFilterStrategy("all"); setFilterStatus("all"); }}>
              <X size={12} /> Clear filters
            </button>
          )}
        </div>

        {/* Loading state */}
        {snapshotQuery.isLoading && !snapshotQuery.data && (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
            <p>Loading logs…</p>
          </div>
        )}

        {/* Error state */}
        {snapshotQuery.isError && (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            <TriangleAlert size={20} style={{ color: "var(--rose)", marginBottom: 8 }} />
            <p>Failed to load logs.</p>
            <button className="outline-btn" onClick={() => void snapshotQuery.refetch()}>Retry</button>
          </div>
        )}

        {/* Table */}
        {!snapshotQuery.isLoading && !snapshotQuery.isError && (
          <>
            <div className="logs-page-table">
              <div className="log-row log-heading">
                <span>REQUEST ID</span>
                <span>PROVIDER</span>
                <span>MODEL</span>
                <span>STRATEGY</span>
                <span>LATENCY</span>
                <span>STATUS</span>
                <span>TIME</span>
              </div>

              {filtered.length === 0 && (
                <div className="logs-empty">
                  {hasFilters
                    ? "No logs match the current filters."
                    : <>No logs yet. <button className="text-btn" style={{ display: "inline-flex" }} onClick={() => setAddOpen(true)}>Add one manually</button> or send a request from the Route Playground.</>}
                </div>
              )}

              {filtered.map(log => (
                <div className="log-row log-row-full" key={`${log.requestId}-${log.createdAt}`}>
                  <span className="mono">{log.requestId}{log.isSample && <span className="sample-tag">sample</span>}</span>
                  <span><ProviderBadge provider={log.provider} /></span>
                  <span className="muted-cell mono">{log.model}</span>
                  <span className="muted-cell">{log.strategy}</span>
                  <span className="mono">{log.latencyMs}ms</span>
                  <span>
                    <span className={`log-status ${log.success ? "success" : "failure"}`}>
                      {log.success
                        ? <><CheckCircle2 size={10} /> Success</>
                        : <><XCircle size={10} /> Failed</>}
                    </span>
                    {log.fallbackUsed && <span className="fallback-tag"><GitBranch size={9} /> fallback</span>}
                  </span>
                  <span className="muted-cell">{formatDate(log.createdAt)}</span>
                </div>
              ))}
            </div>

            {/* Error details */}
            {filtered.some(l => l.error) && (
              <div className="logs-errors-section">
                <p className="panel-kicker" style={{ marginBottom: 8 }}>ERROR DETAILS</p>
                {filtered.filter(l => l.error).map(log => (
                  <div className="log-error-row" key={`err-${log.requestId}`}>
                    <span className="mono">{log.requestId}</span>
                    <span className="log-error-msg">{log.error}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="logs-page-footer">
          Showing {filtered.length} of {allLogs.length} logs · auto-refreshes every 15s
        </div>
      </main>
    </div>
  );
}
