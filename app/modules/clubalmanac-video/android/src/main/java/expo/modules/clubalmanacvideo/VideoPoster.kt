// WP42b A16, A24: de poster (tegel in de keuze en in het album) als JPEG
// zonder EXIF, dus zonder plaats; rechtop, ook bij een staand filmpje met een
// draai-matrix (zo schrijft Media3 een staand filmpje). Het beeld na ~1 s
// (korter: het eerste), zoals op iOS: het eerste beeld is vaak zwart.

package expo.modules.clubalmanacvideo

import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.os.Build
import java.io.File
import java.io.FileOutputStream

internal object VideoPoster {
  private const val MAX_SIDE = 1920
  private const val QUALITY = 85

  fun make(input: File, out: File): Map<String, Any> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(input.path)
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val timeUs = if (durationMs > 1000) 1_000_000L else 0L
      val option = MediaMetadataRetriever.OPTION_CLOSEST
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      // Hooguit MAX_SIDE, nooit groter dan het filmpje (getScaledFrameAtTime vergroot ook).
      val frame = (
        if (Build.VERSION.SDK_INT >= 27 && maxOf(width, height) > MAX_SIDE) {
          retriever.getScaledFrameAtTime(timeUs, option, MAX_SIDE, MAX_SIDE)
        } else {
          retriever.getFrameAtTime(timeUs, option)
        }
        ) ?: retriever.getFrameAtTime(0) ?: throw ClubalmanacVideoException("Poster maken mislukt")
      val upright = upright(frame, retriever)
      try {
        FileOutputStream(out).use { stream ->
          // Bitmap.compress schrijft geen EXIF.
          if (!upright.compress(Bitmap.CompressFormat.JPEG, QUALITY, stream)) {
            throw ClubalmanacVideoException("Poster maken mislukt")
          }
        }
      } catch (e: Exception) {
        out.delete()
        throw e
      }
      val result = mapOf<String, Any>("uri" to VideoFiles.uriOf(out), "width" to upright.width, "height" to upright.height)
      if (upright !== frame) upright.recycle()
      frame.recycle()
      return result
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }
  }

  /**
   * Android draait het beeld meestal zelf volgens de draai van het filmpje.
   * Gebeurt dat niet (het beeld staat nog in de stand van de codering), dan
   * hier. Alleen 90 en 270 zijn zo te herkennen.
   */
  private fun upright(frame: Bitmap, retriever: MediaMetadataRetriever): Bitmap {
    val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    if (rotation % 180 == 0 || width == height || frame.width == frame.height) return frame
    val codedLandscape = width > height
    val frameLandscape = frame.width > frame.height
    if (codedLandscape != frameLandscape) return frame
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    return Bitmap.createBitmap(frame, 0, 0, frame.width, frame.height, matrix, true)
  }
}
