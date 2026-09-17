import { auth } from "@/lib/auth";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { visibleProjectById } from "@/lib/route-resolve";
import { legacyProjectRedirect } from "@/lib/card-url";

// Old GUID project URLs (/projects/<id>) redirect permanently to the clean
// /KEY board (KANBAN-44). A project the viewer can't see, or an id that isn't a
// project, is a plain 404, exactly like an unknown key.
export default async function LegacyProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const { id } = await params;
  const to = legacyProjectRedirect(await visibleProjectById(id, session.user.email));
  if (!to) notFound();
  permanentRedirect(to);
}
