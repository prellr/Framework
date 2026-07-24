import { useState } from "react";
import { ArrowLeft, Pencil, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const CATEGORIES = ["operations", "strategy", "research", "provider", "decision", "postmortem"] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Knowledgebase: the team's durable memory. Humans browse/edit here; agents
 * read and write the same articles through the MCP tools (kb_search /
 * kb_get / kb_write) so research is never redone from scratch.
 */
export function KnowledgePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const search = trpc.kb.search.useQuery({ query: query || undefined, category: category ?? undefined });
  const categories = trpc.kb.categories.useQuery();

  if (openSlug || creating) {
    return (
      <ArticleView
        slug={creating ? null : openSlug}
        startEditing={editing || creating}
        onBack={() => {
          setOpenSlug(null);
          setEditing(false);
          setCreating(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Knowledge" subtitle="Research, operations, strategies, decisions — read before redoing work" />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search (full-text)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        {categories.data?.map((c) => (
          <button
            key={c.category}
            onClick={() => setCategory(category === c.category ? null : (c.category as Category))}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              category === c.category ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {c.category} ({c.count})
          </button>
        ))}
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New article
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {search.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No articles match.</p>
        )}
        {search.data?.map((a) => (
          <button
            key={a.slug}
            onClick={() => setOpenSlug(a.slug)}
            className="block w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.title}</span>
              <Badge variant="secondary">{a.category}</Badge>
              {a.status !== "active" && <Badge variant="warning">{a.status}</Badge>}
              {a.tags?.map((t) => (
                <span key={t} className="text-xs text-muted-foreground">
                  #{t}
                </span>
              ))}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.snippet}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {a.slug} · updated {new Date(a.updatedAt).toLocaleDateString()}
              {a.updatedBy && ` by ${a.updatedBy}`}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArticleView({
  slug,
  startEditing,
  onBack,
}: {
  slug: string | null;
  startEditing: boolean;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const article = trpc.kb.get.useQuery({ slug: slug ?? "" }, { enabled: !!slug });
  const [editing, setEditing] = useState(startEditing);

  const [form, setForm] = useState<{
    slug: string;
    title: string;
    category: Category;
    tags: string;
    body: string;
  } | null>(
    slug
      ? null
      : { slug: "", title: "", category: "research", tags: "", body: "" },
  );

  const upsert = trpc.kb.upsert.useMutation({
    onSuccess: () => {
      utils.kb.invalidate();
      onBack();
    },
  });

  const data = article.data;
  const editForm =
    form ??
    (data
      ? {
          slug: data.slug,
          title: data.title,
          category: data.category as Category,
          tags: (data.tags ?? []).join(", "),
          body: data.body,
        }
      : null);

  if (slug && !data) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  if (editing && editForm) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>{slug ? `Edit: ${editForm.title}` : "New article"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                upsert.mutate({
                  slug: editForm.slug,
                  title: editForm.title,
                  category: editForm.category,
                  tags: editForm.tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  body: editForm.body,
                });
              }}
            >
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kb-slug">Slug (kebab-case)</Label>
                  <Input
                    id="kb-slug"
                    value={editForm.slug}
                    disabled={!!slug}
                    onChange={(e) => setForm({ ...editForm, slug: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kb-title">Title</Label>
                  <Input
                    id="kb-title"
                    value={editForm.title}
                    onChange={(e) => setForm({ ...editForm, title: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kb-category">Category</Label>
                  <select
                    id="kb-category"
                    value={editForm.category}
                    onChange={(e) => setForm({ ...editForm, category: e.target.value as Category })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kb-tags">Tags (comma-separated)</Label>
                <Input
                  id="kb-tags"
                  value={editForm.tags}
                  onChange={(e) => setForm({ ...editForm, tags: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kb-body">Body (markdown)</Label>
                <textarea
                  id="kb-body"
                  value={editForm.body}
                  onChange={(e) => setForm({ ...editForm, body: e.target.value })}
                  required
                  rows={22}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm"
                />
              </div>
              <Button type="submit" disabled={upsert.isPending}>
                <Save className="mr-1 h-3.5 w-3.5" />
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
              {upsert.error && <p className="text-sm text-destructive">{upsert.error.message}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setForm(null);
            setEditing(true);
          }}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {data.title}
            <Badge variant="secondary">{data.category}</Badge>
            {data.status !== "active" && <Badge variant="warning">{data.status}</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {data.slug} · {data.revisionCount} revision{data.revisionCount === 1 ? "" : "s"} · updated{" "}
            {new Date(data.updatedAt).toLocaleString()} {data.updatedBy && `by ${data.updatedBy}`}
          </p>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{data.body}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
