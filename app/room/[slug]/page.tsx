import { RoomClient } from "@/components/room-client";
export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <RoomClient slug={slug} />;
}
