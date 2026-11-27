// WP42b: filmpjes klaarmaken op Android, vóór het uploaden naar R2. De
// tegenhanger van ios/ClubalmanacVideoModule.swift. Geen `pickerOnScreen` (de
// app kijkt op Android naar AppState).
// Spec: docs/work-packages/WP42-android.md §42b (A15–A25), §42c (A27–A38).
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
// - WP42c: het bewaarde origineel (OriginalFiles.kt) en de uploader voor
//   originelen (OriginalUploader.kt, OriginalPartWorker.kt), met dezelfde
//   functies en events als op iOS (A27). Niet de twee functies voor gate 6 van
//   iOS. `backgroundWorkBegin`/`End` doen op Android niets: de taken van
//   WorkManager lopen ook zonder de app.
// - B18: `buildNumber`, het buildnummer van de geïnstalleerde build.

package expo.modules.clubalmanacvideo

import android.content.Context
import android.os.Build
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

/** WP42c: een deel met zijn link, voor de uploader (`aan_ios`). */
class OriginalPartRecord : Record {
  @Field val partNumber: Int = 0
  @Field val offset: Double = 0.0
  @Field val size: Double = 0.0
  @Field val url: String = ""
}

/** WP42c: de delen van één origineel voor de uploader. */
class OriginalSendRecord : Record {
  @Field val originalId: String = ""
  @Field val fileName: String = ""
  /** De generatie van de links; een getal van de app, exact tot 2^53. */
  @Field val generation: Double = 0.0
  @Field val totalBytes: Double = 0.0
  @Field val partSize: Double = 0.0
  @Field val expiresAt: Double = 0.0
  @Field val parts: List<OriginalPartRecord> = emptyList()
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

    Events("onProgress", "onPartDone", "onPartFailed", "onAllPartsDone", "onFileBroken", "onNetwork")

    OnCreate {
      // G2: zonder context geen opruimen (de volgende start probeert het
      // weer); de module werkt gewoon verder.
      appContext.reactContext?.let { ctx ->
        VideoFiles.clear(ctx)
        val uploader = OriginalUploader.get(ctx)
        uploader.emit = { name, body -> sendEvent(name, body) }
        uploader.start("module geladen")
      }
    }

    OnActivityEntersForeground {
      appContext.reactContext?.let { OriginalUploader.get(it).becameActive() }
    }

    OnDestroy {
      appContext.reactContext?.let { OriginalUploader.get(it).emit = null }
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

    // B18: het buildnummer van de geïnstalleerde build (versionCode), als tekst.
    Function("buildNumber") {
      val ctx = appContext.reactContext ?: return@Function null
      try {
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        code.toString()
      } catch (_: Exception) {
        null
      }
    }

    // --- WP42c: originelen -------------------------------------------------

    AsyncFunction("keepOriginal") { uri: String ->
      OriginalFiles.keep(context, uri)
    }

    AsyncFunction("originalInfo") { fileName: String ->
      OriginalFiles.info(context, fileName)
    }

    AsyncFunction("removeOriginal") { fileName: String ->
      OriginalFiles.remove(context, fileName)
    }

    AsyncFunction("listOriginals") {
      OriginalFiles.list(context)
    }

    AsyncFunction("originalSha256") { fileName: String ->
      OriginalFiles.sha256(context, fileName)
    }

    AsyncFunction("freeBytes") {
      OriginalFiles.freeBytes(context)
    }

    // Geen deelbestanden op Android: de uploader leest elk deel uit het bewaarde bestand.
    AsyncFunction("partsBytes") {
      0.0
    }

    AsyncFunction("networkStatus") {
      val (type, expensive) = uploader().net.status
      mapOf("type" to type, "expensive" to expensive)
    }

    AsyncFunction("readState") { name: String ->
      OriginalFiles.readState(context, name)
    }

    AsyncFunction("writeState") { name: String, text: String ->
      OriginalFiles.writeState(context, name, text)
    }

    AsyncFunction("uploaderSend") { job: OriginalSendRecord ->
      uploader().send(
        originalId = job.originalId,
        fileName = job.fileName,
        generation = job.generation.toLong(),
        totalBytes = job.totalBytes.toLong(),
        partSize = job.partSize.toLong(),
        expiresAt = job.expiresAt,
        links = job.parts.map { NewPartLink(it.partNumber, it.offset.toLong(), it.size.toLong(), it.url) },
      )
    }

    AsyncFunction("uploaderRetryPart") { originalId: String, partNumber: Int ->
      uploader().retryPart(originalId, partNumber)
    }

    AsyncFunction("uploaderForget") { originalId: String ->
      uploader().forget(originalId)
    }

    AsyncFunction("uploaderJobs") {
      uploader().jobsJSON()
    }

    AsyncFunction("uploaderWifiOnly") {
      uploader().wifiOnly()
    }

    AsyncFunction("uploaderSetWifiOnly") { on: Boolean ->
      uploader().setWifiOnly(on)
    }

    AsyncFunction("uploaderNote") { text: String ->
      uploader().noteFromApp(text)
    }

    AsyncFunction("uploaderLog") { limit: Int ->
      uploader().log.read(limit)
    }

    AsyncFunction("uploaderClearLog") {
      uploader().log.clear()
    }

    // Op Android lopen de taken ook zonder de app; geen extra tijd nodig (0: geen).
    AsyncFunction("backgroundWorkBegin") {
      0
    }

    AsyncFunction("backgroundWorkEnd") { _: Int ->
    }
  }

  private fun uploader(): OriginalUploader = OriginalUploader.get(context)
}
