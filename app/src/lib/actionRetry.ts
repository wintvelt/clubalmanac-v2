import { ConvexError } from "convex/values";

// WP37 A-invariant 37 (gate op de iPhone): een action die wegvalt, krijgt één
// nieuwe poging. Na de kiezer herverbindt de WebSocket; een action die op dat
// moment al verstuurd was, faalt in de Convex-client met "Connection lost
// while action was in flight" (een gewone Error). Convex herhaalt een action
// niet zelf (een mutation wel). Een ConvexError is een weigering van de
// backend: die gaat meteen door. De nieuwe poging gaat meteen; de client
// verstuurt hem pas na het herverbinden.
// Alleen voor actions die veilig twee keer kunnen: `videos.startUpload`
// (dezelfde upload-id geeft dezelfde reservering) en `videos.playUrl`.

export async function withOneRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    return await call();
  }
}
