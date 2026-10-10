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
