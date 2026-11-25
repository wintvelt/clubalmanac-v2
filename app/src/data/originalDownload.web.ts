// WP38c (38c-17): een origineel downloaden met een gewone link, geen fetch. De
// browser haalt het bestand zelf op en bewaart het onder de naam uit de link
// (`response-content-disposition: attachment`, 38a). Zo gaat een bestand van
// gigabytes nooit door het geheugen van de pagina. De link is vers (1 uur) en
// staat nergens anders.
export function startDownload(url: string): boolean {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}
