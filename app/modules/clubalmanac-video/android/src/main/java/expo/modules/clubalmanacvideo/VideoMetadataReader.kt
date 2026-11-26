// WP42b A17, A18: datum, plaats en duur uit het origineel, zoals Android ze
// geeft. De app maakt er de headers van (src/lib/videos.ts): de datum is UTC
// ("20261126T174453.000Z") en wordt daar omgerekend naar de kloktijd van de
// telefoon; de plaats is `©xyz` als ISO 6709 ("+52.3676+004.9041/").

package expo.modules.clubalmanacvideo

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.os.Build
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
 * wordt, en de beelden per seconde (`null`: onbekend).
 */
internal data class VideoProbe(val width: Int, val height: Int, val rotation: Int, val fps: Double?) {
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
        val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        val frames = if (Build.VERSION.SDK_INT >= 28) {
          retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toLongOrNull()
        } else {
          null
        }
        val fps = if (frames != null && frames > 0 && durationMs > 0) frames * 1000.0 / durationMs else extractorFps(file)
        return VideoProbe(width, height, ((rotation % 360) + 360) % 360, fps)
      } finally {
        try {
          retriever.release()
        } catch (_: Exception) {
        }
      }
    }

    /** De beelden per seconde die de mp4-lezer van Android noemt (vóór API 28). */
    private fun extractorFps(file: File): Double? {
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(file.path)
        for (i in 0 until extractor.trackCount) {
          val format = extractor.getTrackFormat(i)
          if (format.getString(MediaFormat.KEY_MIME)?.startsWith("video/") != true) continue
          if (!format.containsKey(MediaFormat.KEY_FRAME_RATE)) return null
          return try {
            format.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble()
          } catch (_: ClassCastException) {
            format.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble()
          }
        }
        return null
      } catch (_: Exception) {
        return null
      } finally {
        extractor.release()
      }
    }
  }
}
