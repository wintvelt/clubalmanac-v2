// WP42b: filmpjes klaarmaken op Android, vóór het uploaden naar R2. De
// tegenhanger van ios/ClubalmanacVideoModule.swift, met alleen de vijf functies
// van filmpjes (WP37). Geen uploader voor originelen (invariant 7, A21: dat is
// 42c), dus `originalUploaderAvailable` blijft false in de app; geen
// `pickerOnScreen` (de app kijkt op Android naar AppState).
// Spec: docs/work-packages/WP42-android.md §42b (A15–A25).
//
// - `readMetadata`: de datum zoals Android hem geeft (UTC, `utcDate`; de app
//   rekent om naar de kloktijd van de telefoon, A17) en de plaats (`©xyz` als
//   ISO 6709, A18), uit het origineel, vóór het verkleinen.
// - `compress`: Media3 Transformer met de instellingen van A15
//   (VideoCompressor.kt); het resultaat gaat pas terug als Mp4Check.kt het
//   goedkeurt. Alleen met de app open (B12).
// - `makePoster`: een JPEG zonder EXIF (A16), rechtop.
// - `remove`: alleen bestanden in de cache van de app.
// - Bij het laden van de module gaat weg wat een gestopte app aan verkleinde
//   filmpjes en posters achterliet (A23).

package expo.modules.clubalmanacvideo

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CompressOptions : Record {
  @Field val id: String = ""
  @Field val maxSide: Int = 1920
  @Field val videoBitrate: Int = 3_600_000
  @Field val audioBitrate: Int = 128_000
  @Field val maxFps: Int = 30
}

class ClubalmanacVideoException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ClubalmanacVideoModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())

  /** De lopende compressies, om te kunnen stoppen. Alleen op de main thread. */
  private val jobs = HashMap<String, VideoCompressor>()

  override fun definition() = ModuleDefinition {
    Name("ClubalmanacVideo")

    Events("onProgress")

    OnCreate {
      VideoFiles.clear(context)
    }

    OnDestroy {
      main.post {
        for (job in jobs.values.toList()) job.cancel()
        jobs.clear()
      }
    }

    AsyncFunction("readMetadata") { uri: String ->
      VideoMetadataReader.read(VideoFiles.input(uri))
    }

    AsyncFunction("compress") { uri: String, options: CompressOptions, promise: Promise ->
      val input = VideoFiles.input(uri)
      val probe = try {
        VideoProbe.read(input)
      } catch (e: Exception) {
        promise.reject(ClubalmanacVideoException("Lezen mislukt: ${e.message}", e))
        return@AsyncFunction
      }
      val output = VideoFiles.newFile(context, "mp4")
      val id = options.id
      main.post {
        val compressor = VideoCompressor(
          context = context,
          input = input,
          output = output,
          probe = probe,
          target = VideoTarget(options.maxSide, options.videoBitrate, options.audioBitrate, options.maxFps),
          onProgress = { progress -> sendEvent("onProgress", mapOf("id" to id, "progress" to progress)) },
          onDone = { result ->
            if (jobs[id]?.output == output) jobs.remove(id)
            result.fold(
              onSuccess = { promise.resolve(it) },
              onFailure = { e ->
                promise.reject(e as? CodedException ?: ClubalmanacVideoException(e.message ?: "Verkleinen mislukt", e))
              },
            )
          },
        )
        jobs[id]?.cancel()
        jobs[id] = compressor
        compressor.start()
      }
    }

    AsyncFunction("cancel") { id: String ->
      jobs.remove(id)?.cancel()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("makePoster") { uri: String ->
      VideoPoster.make(VideoFiles.input(uri), VideoFiles.newFile(context, "jpg"))
    }

    AsyncFunction("remove") { uri: String ->
      VideoFiles.remove(context, uri)
    }
  }
}
