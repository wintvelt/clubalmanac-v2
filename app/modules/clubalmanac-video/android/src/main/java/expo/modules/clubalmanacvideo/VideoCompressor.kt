// WP42b A15: verkleinen met Media3 Transformer, zo ingesteld dat elk resultaat
// de mp4-controle van de backend haalt (WP37), door de instelling en niet door
// geluk:
// - beeld en geluid altijd opnieuw gecodeerd, naar H.264 en AAC: eigen
//   encoder-instellingen (bitrate) dwingen dat af, ook als het origineel al
//   H.264/AAC is (Media3 kopieert anders wat niet hoeft te veranderen);
// - HDR naar SDR met OpenGL (Media3 schakelt anders stil over naar HEVC);
// - hooguit `maxFps`: is het origineel sneller, dan elk n-de beeld (60 → 30,
//   120 → 30); anders alle beelden. Niet `createDefaultFrameDropEffect`: die
//   hield in S2 maar de helft over, ook van 10 en 30 fps;
// - langste zijde hooguit `maxSide`, nooit groter dan het origineel
//   (Presentation);
// - Media3's eigen mp4-muxer, zonder één metadata-item van het origineel
//   (geen `©xyz`, XMP of `mdta`); de draai van de opname blijft als matrix.
// Daarna kijkt Mp4Check.kt het bestand na: index vooraan, één H.264-beeld- en
// hooguit één AAC-geluidsspoor, geen metadata. Klopt iets niet, dan gaat het
// bestand niet de deur uit (de app meldt `comprimeren`, opnieuw proberen kan).
// De duur die terugkomt is die de backend meet (A19).
// Media3 draait op de main looper; het zware werk op eigen threads.

package expo.modules.clubalmanacvideo

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.InAppMp4Muxer
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import java.io.File
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

internal data class VideoTarget(val maxSide: Int, val videoBitrate: Int, val audioBitrate: Int, val maxFps: Int)

@OptIn(UnstableApi::class)
internal class VideoCompressor(
  private val context: Context,
  private val input: File,
  val output: File,
  private val probe: VideoProbe,
  private val target: VideoTarget,
  private val onProgress: (Double) -> Unit,
  private val onDone: (Result<Map<String, Any>>) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private var transformer: Transformer? = null
  private var finished = false
  private var lastProgress = -1
  private val holder = ProgressHolder()

  private val poll = object : Runnable {
    override fun run() {
      val t = transformer ?: return
      if (finished) return
      if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE && holder.progress != lastProgress) {
        lastProgress = holder.progress
        // A25: loopt zichtbaar op; 100% pas als het bestand nagekeken is.
        onProgress(minOf(holder.progress, 99) / 100.0)
      }
      main.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }

  /** Op de main thread. */
  fun start() {
    try {
      output.delete()
      val (width, height) = fit(probe.displayWidth, probe.displayHeight, target.maxSide)
      val encoders = DefaultEncoderFactory.Builder(context)
        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(target.videoBitrate).build())
        .setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(target.audioBitrate).build())
        .build()
      val t = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(encoders)
        // Geen metadata van het origineel (A15): de lijst leeg.
        .setMuxerFactory(InAppMp4Muxer.Factory { entries -> entries.clear() })
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            completed(exportResult, width, height)
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            fail(ClubalmanacVideoException("Verkleinen mislukt: ${exportException.errorCodeName}", exportException))
          }
        })
        .build()
      val videoEffects = ArrayList<Effect>()
      val every = keepEvery(probe.fps, target.maxFps)
      if (every > 1) {
        val fps = probe.fps!!.toFloat()
        videoEffects.add(FrameDropEffect.createSimpleFrameDropEffect(fps, fps / every))
      }
      videoEffects.add(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT))
      val effects = Effects(listOf(), videoEffects)
      val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input))).setEffects(effects).build()
      val composition = Composition.Builder(EditedMediaItemSequence.Builder(item).build())
        .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
        .build()
      transformer = t
      t.start(composition, output.path)
      main.postDelayed(poll, PROGRESS_INTERVAL_MS)
    } catch (e: Exception) {
      fail(ClubalmanacVideoException("Verkleinen mislukt: ${e.message}", e))
    }
  }

  /** Stoppen; geen half bestand (A23). Op de main thread. */
  fun cancel() {
    if (finished) return
    try {
      transformer?.cancel()
    } catch (_: Exception) {
    }
    fail(ClubalmanacVideoException("Gestopt"))
  }

  private fun completed(result: ExportResult, width: Int, height: Int) {
    if (finished) return
    // A15: beide sporen opnieuw gecodeerd, nooit gekopieerd.
    val video = result.videoConversionProcess
    val audio = result.audioConversionProcess
    if (video != ExportResult.CONVERSION_PROCESS_TRANSCODED ||
      (audio != ExportResult.CONVERSION_PROCESS_TRANSCODED && audio != ExportResult.CONVERSION_PROCESS_NA)
    ) {
      fail(ClubalmanacVideoException("Niet opnieuw gecodeerd (beeld $video, geluid $audio)"))
      return
    }
    main.removeCallbacks(poll)
    // Het nakijken leest het bestand: niet op de main thread.
    Thread {
      val checked = try {
        Result.success(Mp4Check.check(output))
      } catch (e: Exception) {
        Result.failure(e)
      }
      main.post {
        if (finished) return@post
        checked.fold(
          onSuccess = { info ->
            finished = true
            transformer = null
            onProgress(1.0)
            onDone(
              Result.success(
                mapOf(
                  "uri" to VideoFiles.uriOf(output),
                  "bytes" to output.length().toDouble(),
                  "durationMs" to info.durationMs.toDouble(),
                  "width" to width,
                  "height" to height,
                ),
              ),
            )
          },
          onFailure = { e -> fail(ClubalmanacVideoException("Het verkleinde filmpje klopt niet: ${e.message}", e)) },
        )
      }
    }.start()
  }

  private fun fail(e: Exception) {
    if (finished) return
    finished = true
    main.removeCallbacks(poll)
    transformer = null
    output.delete()
    onDone(Result.failure(e))
  }

  companion object {
    private const val PROGRESS_INTERVAL_MS = 250L

    /**
     * Elk hoeveelste beeld blijft, zodat er hooguit `maxFps` overblijven (met
     * 5% speling voor een filmpje dat net iets boven zijn 30 fps uitkomt).
     * Onbekend: alle.
     */
    fun keepEvery(fps: Double?, maxFps: Int): Int {
      if (fps == null || !fps.isFinite() || fps <= 0 || maxFps <= 0) return 1
      return max(1, ceil(fps / maxFps - 0.05).toInt())
    }

    /** Even maten (H.264), langste zijde hooguit `maxSide`, nooit groter dan het origineel. */
    fun fit(width: Int, height: Int, maxSide: Int): Pair<Int, Int> {
      val longest = max(width, height)
      val scale = if (longest > maxSide) maxSide.toDouble() / longest else 1.0
      fun even(v: Int) = max(2, ((v * scale) / 2).roundToInt() * 2)
      return even(width) to even(height)
    }
  }
}
