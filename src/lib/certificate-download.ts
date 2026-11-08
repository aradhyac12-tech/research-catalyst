/** Fetches a signed PDF link and hands the file to the browser as a download. */
export async function saveCertificatePdf(url: string, certificateId: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Certificate download failed");
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl; anchor.download = `${certificateId}.pdf`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** Fetches a signed link and hands the file to the browser as a download under the given file name. */
export async function saveFileFromUrl(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Download failed");
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
