import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Film,
  Tv,
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Youtube,
  Image,
  Link,
  CheckCircle,
  AlertCircle,
  X,
  ExternalLink,
  Clapperboard,
} from "lucide-react";
import { toast } from "sonner";
import {
  useOverrides,
  useSaveOverride,
  useDeleteOverride,
  useTmdbSearch,
  type ManualOverride,
  type TmdbSearchResult,
} from "@/hooks/useDashboardQueries";

// ─── helpers ────────────────────────────────────────────────────────────────

function ytThumb(urlOrId: string) {
  const m = urlOrId.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const id = m ? m[1] : urlOrId.length === 11 ? urlOrId : null;
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function ytEmbedId(urlOrId: string) {
  const m = urlOrId.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : urlOrId.length === 11 ? urlOrId : null;
}

const EMPTY_OVERRIDE: ManualOverride = {
  stremio_id: "",
  content_type: "movie",
  title: "",
  year: undefined,
  trailer_url: "",
  poster_url: "",
  background_url: "",
  logo_url: "",
  thumbnail_url: "",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function ArtPreview({ url, label }: { url: string; label: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className="flex items-center justify-center w-full h-20 rounded-md border border-dashed border-white/10 bg-white/[0.02] text-muted-foreground/40 text-xs">
        {label}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={label}
      onError={() => setErr(true)}
      className="w-full h-20 object-cover rounded-md border border-white/10"
    />
  );
}

interface OverrideRowProps {
  override: ManualOverride;
  onEdit: (o: ManualOverride) => void;
  onDelete: (id: string) => void;
}

function OverrideRow({ override, onEdit, onDelete }: OverrideRowProps) {
  const thumb = override.trailer_url ? ytThumb(override.trailer_url) : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors group">
      {/* poster */}
      {override.poster_url ? (
        <img
          src={override.poster_url}
          alt={override.title || override.stremio_id}
          className="w-10 h-14 object-cover rounded shrink-0 border border-white/10"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      ) : (
        <div className="w-10 h-14 rounded shrink-0 border border-white/10 bg-white/[0.04] flex items-center justify-center">
          {override.content_type === "series" ? (
            <Tv className="w-4 h-4 text-muted-foreground/40" />
          ) : (
            <Film className="w-4 h-4 text-muted-foreground/40" />
          )}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">
            {override.title || override.stremio_id}
          </span>
          {override.year && (
            <span className="text-xs text-muted-foreground">{override.year}</span>
          )}
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
          >
            {override.content_type === "series" ? "Series" : "Movie"}
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground/60 mt-0.5 font-mono truncate">
          {override.stremio_id}
        </div>
        {/* badges for what's overridden */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {override.trailer_url && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0 rounded-full">
              <Youtube className="w-2.5 h-2.5" /> Trailer
            </span>
          )}
          {override.poster_url && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0 rounded-full">
              <Image className="w-2.5 h-2.5" /> Poster
            </span>
          )}
          {override.background_url && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0 rounded-full">
              <Image className="w-2.5 h-2.5" /> Background
            </span>
          )}
          {override.logo_url && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0 rounded-full">
              <Image className="w-2.5 h-2.5" /> Logo
            </span>
          )}
          {override.thumbnail_url && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0 rounded-full">
              <Image className="w-2.5 h-2.5" /> Thumbnail
            </span>
          )}
        </div>
      </div>

      {/* trailer thumb */}
      {thumb && (
        <img
          src={thumb}
          alt="trailer"
          className="hidden sm:block w-16 h-10 object-cover rounded border border-white/10 shrink-0 mt-1"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      )}

      {/* actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onEdit(override)}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onDelete(override.stremio_id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── TMDB Search Step ────────────────────────────────────────────────────────

interface TmdbSearchStepProps {
  onSelect: (result: TmdbSearchResult, type: "movie" | "series") => void;
  onManual: () => void;
}

function TmdbSearchStep({ onSelect, onManual }: TmdbSearchStepProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"movie" | "series">("movie");
  const tmdbSearch = useTmdbSearch();

  const doSearch = useCallback(() => {
    if (!query.trim()) return;
    tmdbSearch.mutate({ query: query.trim(), type });
  }, [query, type, tmdbSearch]);

  const results: TmdbSearchResult[] = (tmdbSearch.data as any)?.results ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v) => setType(v as "movie" | "series")}>
          <SelectTrigger className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="movie">Movie</SelectItem>
            <SelectItem value="series">Series</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search TMDB…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <Button onClick={doSearch} disabled={tmdbSearch.isPending || !query.trim()}>
          {tmdbSearch.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </div>

      {tmdbSearch.isError && (
        <p className="text-sm text-destructive flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />
          {(tmdbSearch.error as Error).message}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {results.map((r) => (
            <button
              key={r.tmdb_id}
              onClick={() => onSelect(r, type)}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left"
            >
              {r.poster ? (
                <img
                  src={r.poster}
                  alt={r.title}
                  className="w-8 h-11 object-cover rounded border border-white/10 shrink-0"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              ) : (
                <div className="w-8 h-11 rounded border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0">
                  <Film className="w-3.5 h-3.5 text-muted-foreground/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{r.title}</div>
                {r.year && (
                  <div className="text-xs text-muted-foreground">{r.year}</div>
                )}
                {r.overview && (
                  <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                    {r.overview}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {tmdbSearch.isSuccess && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No results found.
        </p>
      )}

      <div className="pt-2 border-t border-white/[0.06]">
        <button
          onClick={onManual}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Skip search — enter stremio ID manually
        </button>
      </div>
    </div>
  );
}

// ─── Override Edit Form ───────────────────────────────────────────────────────

interface OverrideFormProps {
  value: ManualOverride;
  onChange: (v: ManualOverride) => void;
  onSave: () => void;
  saving: boolean;
  isNew: boolean;
}

function OverrideForm({ value, onChange, onSave, saving, isNew }: OverrideFormProps) {
  const set = (key: keyof ManualOverride, val: string | number | null) =>
    onChange({ ...value, [key]: val || null });

  const trailerThumb = value.trailer_url ? ytThumb(value.trailer_url) : null;
  const trailerEmbedId = value.trailer_url ? ytEmbedId(value.trailer_url) : null;

  return (
    <div className="space-y-5">
      {/* Identity (read-only after TMDB pick, or manual entry for new) */}
      {isNew && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Stremio ID *</Label>
            <Input
              placeholder="e.g. tt1375666 or tmdb:603"
              value={value.stremio_id}
              onChange={(e) => onChange({ ...value, stremio_id: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground/60">
              Use the IMDB ID (tt…) shown in Stremio, or tmdb:ID / kitsu:ID etc.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title (optional)</Label>
            <Input
              placeholder="Movie / series title"
              value={value.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Year (optional)</Label>
            <Input
              type="number"
              placeholder="2024"
              value={value.year ?? ""}
              onChange={(e) =>
                onChange({ ...value, year: e.target.value ? parseInt(e.target.value) : undefined })
              }
            />
          </div>
        </div>
      )}

      {!isNew && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          {value.poster_url ? (
            <img
              src={value.poster_url}
              alt={value.title ?? ""}
              className="w-9 h-12 object-cover rounded border border-white/10"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
          ) : (
            <Film className="w-5 h-5 text-muted-foreground/40" />
          )}
          <div>
            <div className="font-medium text-sm">{value.title || value.stremio_id}</div>
            {value.year && <div className="text-xs text-muted-foreground">{value.year}</div>}
            <div className="text-[11px] font-mono text-muted-foreground/50">{value.stremio_id}</div>
          </div>
        </div>
      )}

      {/* Trailer */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Youtube className="w-4 h-4 text-red-400" />
          <Label className="text-sm font-medium">Trailer Override</Label>
        </div>
        <Input
          placeholder="YouTube URL or video ID (e.g. dQw4w9WgXcQ)"
          value={value.trailer_url ?? ""}
          onChange={(e) => set("trailer_url", e.target.value)}
        />
        {trailerThumb && (
          <div className="flex items-start gap-3 mt-2">
            <img
              src={trailerThumb}
              alt="trailer preview"
              className="w-32 h-18 object-cover rounded border border-white/10"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
            {trailerEmbedId && (
              <a
                href={`https://www.youtube.com/watch?v=${trailerEmbedId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                Preview on YouTube
              </a>
            )}
          </div>
        )}
      </div>

      {/* Art URLs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-blue-400" />
          <Label className="text-sm font-medium">Metadata Art Overrides</Label>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* Poster */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Poster Art URL</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://image.tmdb.org/…"
                value={value.poster_url ?? ""}
                onChange={(e) => set("poster_url", e.target.value)}
                className="flex-1"
              />
            </div>
            <ArtPreview url={value.poster_url ?? ""} label="Poster preview" />
          </div>

          {/* Background / Banner */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Background / Banner Art URL</Label>
            <Input
              placeholder="https://image.tmdb.org/…"
              value={value.background_url ?? ""}
              onChange={(e) => set("background_url", e.target.value)}
            />
            <ArtPreview url={value.background_url ?? ""} label="Background preview" />
          </div>

          {/* Logo */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Logo Art URL</Label>
            <Input
              placeholder="https://fanart.tv/…"
              value={value.logo_url ?? ""}
              onChange={(e) => set("logo_url", e.target.value)}
            />
            {value.logo_url && (
              <div className="flex items-center justify-center w-full h-16 rounded-md border border-dashed border-white/10 bg-white/[0.02] p-2">
                <img
                  src={value.logo_url}
                  alt="logo"
                  className="max-h-12 max-w-full object-contain"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              </div>
            )}
          </div>

          {/* Thumbnail */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Thumbnail URL</Label>
            <Input
              placeholder="https://…"
              value={value.thumbnail_url ?? ""}
              onChange={(e) => set("thumbnail_url", e.target.value)}
            />
            <ArtPreview url={value.thumbnail_url ?? ""} label="Thumbnail preview" />
          </div>
        </div>
      </div>

      <Button onClick={onSave} disabled={saving || !value.stremio_id} className="w-full">
        {saving ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
        ) : (
          <><CheckCircle className="w-4 h-4 mr-2" />Save Override</>
        )}
      </Button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DashboardOverridesManager() {
  const overridesQuery = useOverrides();
  const saveOverride = useSaveOverride();
  const deleteOverride = useDeleteOverride();

  const overrides: ManualOverride[] = (overridesQuery.data as any)?.overrides ?? [];

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<"search" | "form">("search");
  const [formValue, setFormValue] = useState<ManualOverride>(EMPTY_OVERRIDE);
  const [isEdit, setIsEdit] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Search / filter
  const [filterText, setFilterText] = useState("");
  const filtered = overrides.filter((o) => {
    const q = filterText.toLowerCase();
    return (
      !q ||
      (o.title || "").toLowerCase().includes(q) ||
      o.stremio_id.toLowerCase().includes(q)
    );
  });

  const openNew = () => {
    setFormValue(EMPTY_OVERRIDE);
    setIsEdit(false);
    setDialogStep("search");
    setDialogOpen(true);
  };

  const openEdit = (o: ManualOverride) => {
    setFormValue({ ...o });
    setIsEdit(true);
    setDialogStep("form");
    setDialogOpen(true);
  };

  const handleTmdbSelect = (result: TmdbSearchResult, type: "movie" | "series") => {
    // Build stremio_id: prefer imdb_id if available, else tmdb:ID
    const stremioId = `tmdb:${result.tmdb_id}`;
    setFormValue({
      stremio_id: stremioId,
      content_type: type,
      title: result.title,
      year: result.year ?? undefined,
      trailer_url: "",
      poster_url: result.poster ?? "",
      background_url: "",
      logo_url: "",
      thumbnail_url: "",
    });
    setDialogStep("form");
  };

  const handleSave = () => {
    saveOverride.mutate(formValue, {
      onSuccess: () => {
        toast.success(`Override saved for "${formValue.title || formValue.stremio_id}"`);
        setDialogOpen(false);
      },
      onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
    });
  };

  const handleDelete = (stremioId: string) => {
    deleteOverride.mutate(stremioId, {
      onSuccess: () => toast.success("Override deleted"),
      onError: (e) => toast.error(`Delete failed: ${(e as Error).message}`),
    });
    setDeleteTarget(null);
  };

  return (
    <>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Header card */}
        <Card className="border-white/[0.06] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clapperboard className="w-4 h-4 text-primary" />
                  Manual Overrides
                </CardTitle>
                <CardDescription className="mt-1">
                  Fix incorrect AI trailer picks or missing TMDB metadata. Overrides are
                  applied immediately and survive cache clears.
                </CardDescription>
              </div>
              <Button onClick={openNew} size="sm" className="shrink-0">
                <Plus className="w-4 h-4 mr-1.5" />
                New Override
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Overrides", value: overrides.length, color: "text-foreground" },
                {
                  label: "Trailer Overrides",
                  value: overrides.filter((o) => o.trailer_url).length,
                  color: "text-red-400",
                },
                {
                  label: "Art Overrides",
                  value: overrides.filter(
                    (o) => o.poster_url || o.background_url || o.logo_url || o.thumbnail_url
                  ).length,
                  color: "text-blue-400",
                },
                {
                  label: "Movies / Series",
                  value: `${overrides.filter((o) => o.content_type !== "series").length} / ${overrides.filter((o) => o.content_type === "series").length}`,
                  color: "text-muted-foreground",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex flex-col gap-0.5 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]"
                >
                  <span className={`text-lg font-bold tabular-nums ${stat.color}`}>
                    {overridesQuery.isLoading ? "…" : stat.value}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">{stat.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* List card */}
        <Card className="border-white/[0.06] bg-white/[0.02]">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Filter by title or ID…"
                  className="pl-8 h-8 text-sm"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
              </div>
              {filterText && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setFilterText("")}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {overridesQuery.isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading overrides…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Clapperboard className="w-8 h-8 opacity-30" />
                <p className="text-sm">
                  {filterText ? "No overrides match your filter." : "No overrides yet."}
                </p>
                {!filterText && (
                  <Button variant="outline" size="sm" onClick={openNew}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Add first override
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((o) => (
                  <OverrideRow
                    key={o.stremio_id}
                    override={o}
                    onEdit={openEdit}
                    onDelete={(id) => setDeleteTarget(id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help card */}
        <Card className="border-white/[0.06] bg-white/[0.02]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link className="w-3.5 h-3.5 text-muted-foreground" />
              Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground/70 space-y-1.5">
            <p>
              <strong className="text-muted-foreground">Trailer:</strong> Paste a full YouTube
              URL (<code>https://youtube.com/watch?v=…</code>) or just the 11-character video
              ID. The AI trailer is replaced immediately.
            </p>
            <p>
              <strong className="text-muted-foreground">Art URLs:</strong> Any publicly
              accessible image URL works. TMDB, Fanart.tv, or your own CDN. Changes apply on
              next metadata fetch (cache is busted automatically).
            </p>
            <p>
              <strong className="text-muted-foreground">Stremio ID:</strong> Use the IMDB ID
              (e.g. <code>tt1375666</code>) or the prefixed form Stremio uses (
              <code>tmdb:603</code>, <code>kitsu:1</code>).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Add/Edit Dialog ─── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clapperboard className="w-4 h-4" />
              {isEdit ? "Edit Override" : "New Override"}
            </DialogTitle>
            <DialogDescription>
              {dialogStep === "search" && !isEdit
                ? "Search TMDB to find the content, then set trailer & art overrides."
                : "Set the override values. Leave a field blank to keep the original."}
            </DialogDescription>
          </DialogHeader>

          {dialogStep === "search" && !isEdit ? (
            <TmdbSearchStep
              onSelect={handleTmdbSelect}
              onManual={() => {
                setFormValue(EMPTY_OVERRIDE);
                setDialogStep("form");
              }}
            />
          ) : (
            <OverrideForm
              value={formValue}
              onChange={setFormValue}
              onSave={handleSave}
              saving={saveOverride.isPending}
              isNew={!isEdit}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm ─── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Override?</AlertDialogTitle>
            <AlertDialogDescription>
              The original AI-fetched trailer and metadata will be used again for{" "}
              <strong>{deleteTarget}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
