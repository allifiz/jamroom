"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Plus,
  Trash2,
  Search,
  ListMusic,
  Disc3,
} from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/supabase";
import { youtubeId, type Track } from "@/lib/domain";
import { Button } from "./ui/button";
function Row({
  track,
  active,
  manage,
  control,
  onRemove,
  onPlay,
}: {
  track: Track;
  active: boolean;
  manage: boolean;
  control: boolean;
  onRemove: () => void;
  onPlay: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: track.id, disabled: !manage });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`track ${active ? "active" : ""}`}
    >
      <button
        className="icon-plain"
        disabled={!manage}
        aria-label={`Reorder ${track.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      <div className="track-thumb">
        <Disc3 size={22} />
        <img
          src={track.thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
      <button className="track-copy" disabled={!control} onClick={onPlay}>
        <strong>{track.title}</strong>
        <small>
          {active ? "♫ NOW PLAYING" : (track.channel_name ?? "YouTube")}
        </small>
      </button>
      {manage && (
        <button
          className="icon-plain"
          aria-label={`Remove ${track.title}`}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
export function Queue({
  roomId,
  tracks,
  currentId,
  add,
  manage,
  control,
  notify,
  command,
}: {
  roomId: string;
  tracks: Track[];
  currentId: string | null;
  add: boolean;
  manage: boolean;
  control: boolean;
  notify: () => Promise<void>;
  command: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const [filter, setFilter] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const duplicateDialog = useRef<HTMLDialogElement>(null);
  const duplicateTitle = useId();
  useEffect(() => {
    const dialog = duplicateDialog.current;
    if (duplicate && dialog && !dialog.open) dialog.showModal();
    else if (!duplicate && dialog?.open) dialog.close();
  }, [duplicate]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const visible = tracks.filter((t) =>
    t.title.toLowerCase().includes(filter.toLowerCase()),
  );
  async function mutate(args: Record<string, unknown>) {
    try {
      const { error } = await db().rpc("playlist_mutation", {
        p_room: roomId,
        ...args,
      });
      if (error) throw error;
      await notify();
    } catch (e) {
      toast.error(
        (e as Error).message.includes("duplicate")
          ? "That song is already in the queue."
          : (e as Error).message,
      );
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = youtubeId(url);
    if (!id) {
      toast.error(
        "Paste a YouTube video URL. Playlist imports are not supported.",
      );
      return;
    }
    if (tracks.some((t) => t.youtube_video_id === id)) {
      setDuplicate(true);
      return;
    }
    setBusy(true);
    try {
      const { data } = await db().auth.getSession();
      const r = await fetch("/api/youtube?url=" + encodeURIComponent(url), {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const meta = await r.json();
      if (!r.ok) throw new Error(meta.error);
      const { error } = await db().rpc("playlist_mutation", {
        p_room: roomId,
        p_action: "add",
        p_video: meta.youtube_video_id,
        p_title: meta.title,
        p_thumbnail: meta.thumbnail,
        p_channel: meta.channel_name,
        p_duration: meta.duration_seconds,
      });
      if (
        error?.code === "23505" &&
        error.message.includes("youtube_video_id")
      ) {
        setDuplicate(true);
        return;
      }
      if (error) throw error;
      setUrl("");
      await notify();
      toast.success("Added to your permanent queue.");
      if (meta.warning) toast.info(meta.warning);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reorder(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id || filter) return;
    const from = tracks.findIndex((t) => t.id === e.active.id);
    const to = tracks.findIndex((t) => t.id === e.over?.id);
    await mutate({
      p_action: "reorder",
      p_order: arrayMove(tracks, from, to).map((t) => t.id),
    });
  }
  return (
    <section className="panel">
      <dialog
        ref={duplicateDialog}
        aria-labelledby={duplicateTitle}
        className="panel bg-paper m-auto w-[calc(100%-2rem)] max-w-md backdrop:bg-black/50"
        onClose={() => setDuplicate(false)}
      >
        <h2 id={duplicateTitle} className="text-xl">
          Lagu sudah ada di antrean
        </h2>
        <p className="muted my-4">Pilih lagu lain untuk ditambahkan.</p>
        <Button type="button" onClick={() => setDuplicate(false)}>
          Oke
        </Button>
      </dialog>
      <div className="queue-heading">
        <h2 className="text-xl flex items-center gap-2">
          <ListMusic size={20} />
          The queue
        </h2>
        <span className="pill bg-yellow">{tracks.length} tracks</span>
      </div>
      <form className="queue-add" onSubmit={submit}>
        <input
          aria-label="YouTube URL"
          placeholder={
            add ? "Paste a YouTube link…" : "Adding songs is owner-only"
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={!add}
          required
        />
        <Button size="icon" aria-label="Add song" disabled={busy || !add}>
          <Plus size={20} />
        </Button>
      </form>
      {busy && (
        <p className="small mt-3" role="status">
          Finding your track…
        </p>
      )}
      <label className="relative mt-4">
        <Search size={15} className="absolute left-3 top-3.5" />
        <input
          className="queue-search text-xs"
          aria-label="Search queue"
          placeholder="Find something in the queue"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorder}
      >
        <SortableContext
          items={visible.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="queue-list">
            {visible.map((t) => (
              <Row
                key={t.id}
                track={t}
                active={t.id === currentId}
                manage={manage && !filter}
                control={control}
                onRemove={() =>
                  void mutate({ p_action: "remove", p_item: t.id })
                }
                onPlay={() => void command("select", { p_track: t.id })}
              />
            ))}
            {!visible.length && (
              <div className="empty px-2 py-8">
                <span className="text-4xl">♫</span>
                <h3>
                  {tracks.length
                    ? "No matching tracks."
                    : "Your first track starts the party."}
                </h3>
                <p className="muted small">
                  {tracks.length
                    ? "Try another search."
                    : "Paste a YouTube video link above."}
                </p>
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>
      <p className="small muted mt-3">
        Saved to your room, not your browser.{" "}
        {manage ? "Drag the handles to reorder." : ""}
      </p>
    </section>
  );
}
