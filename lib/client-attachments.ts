import type { Item } from "@/lib/types";

/**
 * Uploads a file as an item attachment in three steps:
 *   1. ask our API for a signed upload URL (server-side, service role)
 *   2. PUT the bytes straight to Supabase Storage — this skips the ~4.5 MB
 *      serverless request-body limit entirely
 *   3. confirm with our API, which records the metadata on the item
 * Returns the updated item (with the new attachment).
 */
export async function uploadAttachment(itemId: string, file: File): Promise<Item> {
  const contentType = file.type || "application/octet-stream";

  const signRes = await fetch(`/api/items/${itemId}/attachments/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, content_type: contentType }),
  });
  if (!signRes.ok) throw new Error(await errMsg(signRes, "Could not start upload"));
  const { path, uploadUrl } = (await signRes.json()) as {
    path: string;
    uploadUrl: string;
  };

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  const confirmRes = await fetch(`/api/items/${itemId}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      name: file.name,
      content_type: contentType,
      size: file.size,
    }),
  });
  if (!confirmRes.ok) throw new Error(await errMsg(confirmRes, "Could not save attachment"));
  return (await confirmRes.json()) as Item;
}

async function errMsg(res: Response, fallback: string): Promise<string> {
  return res
    .json()
    .then((d: { error?: string }) => d.error ?? fallback)
    .catch(() => fallback);
}
