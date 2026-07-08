import { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

/**
 * Example CRUD page. Delete alongside the notes router and schema once your
 * project has real pages — it exists to demonstrate the tRPC query/mutation
 * + invalidation pattern.
 */
export function NotesPage() {
  const utils = trpc.useUtils();
  const notes = trpc.notes.list.useQuery();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const create = trpc.notes.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setBody("");
      utils.notes.list.invalidate();
    },
  });
  const remove = trpc.notes.remove.useMutation({
    onSuccess: () => utils.notes.list.invalidate(),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Notes" subtitle="Example module — schema → router → page" />

      <Card>
        <CardHeader>
          <CardTitle>New note</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 md:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate({ title: title.trim(), body: body.trim() || undefined });
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              required
            />
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Body (optional)"
            />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </form>
          {create.error && (
            <p className="mt-2 text-sm text-destructive">{create.error.message}</p>
          )}
        </CardContent>
      </Card>

      {notes.data && notes.data.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No notes yet"
          description="Create one above. Operator role or higher is required to write."
        />
      ) : (
        <div className="grid gap-3">
          {notes.data?.map((note) => (
            <Card key={note.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-6">
                <div>
                  <p className="font-medium">{note.title}</p>
                  {note.body && <p className="text-sm text-muted-foreground">{note.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove.mutate({ id: note.id })}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
