import { useState, useCallback, useRef } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { toast } from "sonner";
import {
  Search, Film, Tv, Youtube, Image, Save, X,
  Loader2, ChevronDown, ChevronUp, Edit3,
  ExternalLink, RefreshCw, Trash2, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger
} from "@/components/ui/tabs";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string;
  type: "movie" | "series";
  title: string;
  year: number | null;
  poster: string | null;
  imdb_id: string | null;
  language: string | null;
  overview: string | null;
}

interface Override {
  trailerYtId?: string;
  poster?: string;
  background?: string;
  logo?: string;
  thumbnail?: string;
  name?: string;
  overview?: string;
  year?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ytIdFromInput(raw: string): string | null {
  if (!raw) return null;
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── ImagePreview ─────────────────────────────────────────────────────────────
function ImagePreview({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className={`flex items-center justify-center bg-muted/30 rounded border border-dashed text-xs text-muted-foreground ${className}`}>
        No image
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={`object-cover rounded border ${className}`}
      onError={() => setErr(true)}
    />
  );
}

// ─── SearchResultCard ─────────────────────────────────────────────────────────
function SearchResultCard({
  result,
  selected,
  onSelect,
}: {
  result: SearchResult;
  selected: boolean;
  onSelect: (r: SearchResult) => void;
}) {
  return (
    <div
      onClick={() => onSelect(result)}
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-150
        ${selected
          ? "border-blue-500 bg-blue-500/10"
          : "border-border bg-card hover:bg-accent/40 hover:border-border/80"
        }`}
    >
      <ImagePreview
        url={result.poster || ""}
        alt={result.title}
        className="w-12 h-16 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {result.type === "movie" ? (
            <Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <Tv className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium text-sm truncate">{result.title}</span>
          {result.year && (
            <span className="text-xs text-muted-foreground shrink-0">({result.year})</span>
          )}
        </div>
        {result.imdb_id && (
          <p className="text-xs text-muted-foreground mt-0.5">{result.imdb_id}</p>
        )}
        {result.overview && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{result.overview}</p>
        )}
      </div>
      {selected && <Check className="h-4 w-4 text-blue-500 shrink-0" />}
    </div>
  );
}

// ─── ArtField ─────────────────────────────────────────────────────────────────
function ArtField({
  label,
  field,
  value,
  onChange,
  previewClass,
}: {
  label: string;
  field: string;
  value: string;
  onChange: (field: string, val: string) => void;
  previewClass?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder="https://..."
          className="text-xs font-mono"
        />
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9"
            onClick={() => window.open(value, "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {value && (
        <ImagePreview
          url={value}
          alt={label}
          className={previewClass || "w-full h-28"}
        />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function MediaManager() {
  const { adminKey } = useAdmin();

  // Search state
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"movie" | "series">("movie");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);

  // Override state
  const [override, setOverride] = useState<Override>({});
  const [trailerInput, setTrailerInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [existing, setExisting] = useState<Override | null>(null);
  const [loadingOverride, setLoadingOverride] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── API helpers ─────────────────────────────────────────────────────────
  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminKey) h["x-admin-key"] = adminKey;
    return h;
  }, [adminKey]);

  // ── Search TMDB ─────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string, t: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/media-manager/search?q=${encodeURIComponent(q)}&type=${t}`,
        { headers: headers() }
      );
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      toast.error("Search failed");
    } finally {
      setSearching(false);
    }
  }, [headers]);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v, type), 400);
  };

  const handleTypeChange = (t: string) => {
    const newType = t as "movie" | "series";
    setType(newType);
    if (query) doSearch(query, newType);
  };

  // ── Select a result ─────────────────────────────────────────────────────
  const handleSelect = async (r: SearchResult) => {
    setSelected(r);
    setOverride({});
    setTrailerInput("");
    setExisting(null);
    setLoadingOverride(true);
    try {
      const res = await fetch(
        `/api/media-manager/override/${r.id}`,
        { headers: headers() }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.override) {
          setExisting(data.override);
          setOverride(data.override);
          if (data.override.trailerYtId) {
            setTrailerInput(
              `https://www.youtube.com/watch?v=${data.override.trailerYtId}`
            );
          }
        }
      }
    } catch {
      // No existing override — that's fine
    } finally {
      setLoadingOverride(false);
    }
  };

  // ── Field change ────────────────────────────────────────────────────────
  const handleField = (field: string, val: string) => {
    setOverride((prev) => ({ ...prev, [field]: val }));
  };

  // ── Save override ───────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    const payload: Override = { ...override };

    // Parse trailer input
    if (trailerInput) {
      const ytId = ytIdFromInput(trailerInput.trim());
      if (!ytId) {
        toast.error("Invalid YouTube URL or video ID");
        setSaving(false);
        return;
      }
      payload.trailerYtId = ytId;
    } else {
      delete payload.trailerYtId;
    }

    try {
      const res = await fetch(`/api/media-manager/override/${selected.id}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ override: payload, type: selected.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setExisting(payload);
      toast.success("Override saved! Changes apply on next movie open.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Clear override ──────────────────────────────────────────────────────
  const handleClear = async () => {
    if (!selected) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/media-manager/override/${selected.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) throw new Error("Clear failed");
      setExisting(null);
      setOverride({});
      setTrailerInput("");
      toast.success("Override cleared — TMDB data will be used.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setClearing(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Media Manager</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Override trailer links and artwork for any movie or series.
          Changes apply instantly on next open — all other metadata from TMDB stays intact.
        </p>
      </div>

      {/* Search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-500" />
            Search
          </CardTitle>
          <CardDescription>Find a movie or series to override</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search title..."
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
              />
            </div>
            <Tabs value={type} onValueChange={handleTypeChange}>
              <TabsList className="h-10">
                <TabsTrigger value="movie" className="px-4">
                  <Film className="h-3.5 w-3.5 mr-1.5" /> Movie
                </TabsTrigger>
                <TabsTrigger value="series" className="px-4">
                  <Tv className="h-3.5 w-3.5 mr-1.5" /> Series
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {searching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching TMDB...
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {results.map((r) => (
                <SearchResultCard
                  key={r.id}
                  result={r}
                  selected={selected?.id === r.id}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {!searching && query && results.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No results found.</p>
          )}
        </CardContent>
      </Card>

      {/* Override panel */}
      {selected && (
        <Card className="border-blue-500/30">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <ImagePreview
                  url={selected.poster || ""}
                  alt={selected.title}
                  className="w-14 h-20 shrink-0"
                />
                <div>
                  <CardTitle className="text-base">{selected.title}</CardTitle>
                  <CardDescription>
                    {selected.year} · {selected.type} · {selected.imdb_id || selected.id}
                  </CardDescription>
                  {existing && (
                    <Badge variant="secondary" className="mt-1 text-xs bg-blue-500/15 text-blue-400 border-blue-500/30">
                      Has overrides
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {existing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={clearing}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                    Clear
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {loadingOverride ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading existing overrides...
              </div>
            ) : (
              <Tabs defaultValue="trailer">
                <TabsList className="mb-4">
                  <TabsTrigger value="trailer">
                    <Youtube className="h-3.5 w-3.5 mr-1.5" /> Trailer
                  </TabsTrigger>
                  <TabsTrigger value="artwork">
                    <Image className="h-3.5 w-3.5 mr-1.5" /> Artwork
                  </TabsTrigger>
                  <TabsTrigger value="metadata">
                    <Edit3 className="h-3.5 w-3.5 mr-1.5" /> Metadata
                  </TabsTrigger>
                </TabsList>

                {/* Trailer Tab */}
                <TabsContent value="trailer" className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      YouTube Trailer URL or Video ID
                    </Label>
                    <Input
                      value={trailerInput}
                      onChange={(e) => setTrailerInput(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=... or 11-char ID"
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Accepts full YouTube URLs, short links (youtu.be), or plain 11-character video IDs.
                    </p>
                  </div>

                  {trailerInput && ytIdFromInput(trailerInput) && (
                    <div className="rounded-lg overflow-hidden border aspect-video w-full max-w-md">
                      <iframe
                        src={`https://www.youtube.com/embed/${ytIdFromInput(trailerInput)}`}
                        className="w-full h-full"
                        allowFullScreen
                        title="Trailer Preview"
                      />
                    </div>
                  )}

                  {existing?.trailerYtId && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded p-2">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      Current saved trailer:
                      <a
                        href={`https://www.youtube.com/watch?v=${existing.trailerYtId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline font-mono"
                      >
                        {existing.trailerYtId}
                      </a>
                    </div>
                  )}
                </TabsContent>

                {/* Artwork Tab */}
                <TabsContent value="artwork" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <ArtField
                    label="Poster"
                    field="poster"
                    value={override.poster || ""}
                    onChange={handleField}
                    previewClass="w-full h-52 object-cover"
                  />
                  <ArtField
                    label="Background / Fanart"
                    field="background"
                    value={override.background || ""}
                    onChange={handleField}
                    previewClass="w-full h-52 object-cover"
                  />
                  <ArtField
                    label="Logo"
                    field="logo"
                    value={override.logo || ""}
                    onChange={handleField}
                    previewClass="w-full h-20 object-contain bg-black/30"
                  />
                  <ArtField
                    label="Thumbnail"
                    field="thumbnail"
                    value={override.thumbnail || ""}
                    onChange={handleField}
                    previewClass="w-full h-28"
                  />
                </TabsContent>

                {/* Metadata Tab */}
                <TabsContent value="metadata" className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    These fields override TMDB metadata for this title only. Leave blank to use TMDB value.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</Label>
                      <Input
                        value={override.name || ""}
                        onChange={(e) => handleField("name", e.target.value)}
                        placeholder={selected.title}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Year</Label>
                      <Input
                        type="number"
                        value={override.year ?? ""}
                        onChange={(e) => handleField("year", e.target.value)}
                        placeholder={String(selected.year || "")}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Overview / Description</Label>
                    <textarea
                      value={override.overview || ""}
                      onChange={(e) => handleField("overview", e.target.value)}
                      placeholder={selected.overview || "Enter description..."}
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
