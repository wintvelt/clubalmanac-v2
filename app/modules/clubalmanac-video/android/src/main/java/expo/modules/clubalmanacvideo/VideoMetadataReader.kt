// WP42b A17, A18: datum, plaats en duur uit het origineel, zoals Android ze
// geeft. De app maakt er de headers van (src/lib/videos.ts): de datum is UTC
// ("20261126T174453.000Z") en wordt daar omgerekend naar de kloktijd van de
// telefoon; de plaats is `©xyz` als ISO 6709 ("+52.3676+004.9041/").

package expo.modules.clubalmanacvideo

import android.media.MediaMetadataRetriever
import java.io.File

internal object VideoMetadataReader {
  fun read(file: File): Map<String, Any?> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      return mapOf(
        "creationDate" to null,
        "utcDate" to retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE),
        "location" to retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION),
        "durationMs" to retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull(),
      )
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }
  }
}

/**
 * Wat het verkleinen van het origineel moet weten: de maat zoals het getoond
 * wordt. De beelden per seconde zijn niet nodig: het effect dat beelden
 * weglaat, kijkt naar de tijdstempels (VideoCompressor.kt).
 */
internal data class VideoProbe(val width: Int, val height: Int, val rotation: Int) {
  /** Breedte en hoogte na de draai van de opname. */
  val displayWidth get() = if (rotation % 180 == 0) width else height
  val displayHeight get() = if (rotation % 180 == 0) height else width

  companion object {
    fun read(file: File): VideoProbe {
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(file.path)
        if (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) != "yes") {
          throw ClubalmanacVideoException("Geen beeld in dit filmpje")
        }
        val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        if (width <= 0 || height <= 0) throw ClubalmanacVideoException("Geen maat in dit filmpje")
        return VideoProbe(width, height, ((rotation % 360) + 360) % 360)
      } finally {
        try {
          retriever.release()
        } catch (_: Exception) {
        }
      }
    }
  }
}
