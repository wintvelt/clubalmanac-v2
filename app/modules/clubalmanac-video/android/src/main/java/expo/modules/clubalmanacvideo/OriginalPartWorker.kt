// WP42c: de taak van één deel van een origineel (B15, A27, A28). WorkManager
// start hem zelf, ook als de app dicht is; er draait dan alleen het proces,
// geen JS. Een gewone taak: geen foreground service, geen melding (A33).
//
// - De link, het bestand en het stuk ervan komen uit de opslag van de
//   uploader, niet uit de taak (A32): de taak kent alleen origineel, deel en
//   token.
// - PUT van precies dat stuk van het bewaarde bestand, rechtstreeks gelezen,
//   zonder deelbestand en zonder eigen headers (de link ondertekent
//   `content-length;host`). Over het netwerk dat WorkManager voor de taak
//   koos (A29).
// - Stopt Android de taak (Doze, quotum, de tijdslimiet, een voorwaarde die
//   niet meer klopt) of de app (omzetten, vergeten), dan breekt de verbinding
//   meteen af; dat is geen poging. De uploader telt alleen de tijdslimiet
//   (H1), met de reden en hoe lang het versturen liep.
// - K5: er ontsnapt geen fout uit de taak. Elke afloop gaat naar de uploader,
//   ook een onverwachte fout of een link die niet te gebruiken is (een
//   mislukte poging zonder status). Geen tekst van een fout in een log: die
//   kan de host of de link noemen; alleen de naam van de soort fout.

package expo.modules.clubalmanacvideo

import android.content.Context
import android.os.SystemClock
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class OriginalPartWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  @Volatile private var connection: HttpURLConnection? = null

  override fun doWork(): Result {
    val originalId = inputData.getString(OriginalUploader.KEY_ORIGINAL) ?: return Result.success()
    val partNumber = inputData.getInt(OriginalUploader.KEY_PART, 0)
    val token = inputData.getString(OriginalUploader.KEY_TOKEN) ?: return Result.success()
    val uploader = try {
      OriginalUploader.get(applicationContext)
    } catch (_: Throwable) {
      return Result.retry()
    }
    val claim = try {
      uploader.claim(originalId, partNumber, token, network, runAttemptCount + 1)
    } catch (_: Throwable) {
      // De opslag was niet te bereiken: later opnieuw, zonder poging.
      return Result.retry()
    }
    val go = when (claim) {
      is Claim.Stale -> return Result.success()
      is Claim.Later -> return Result.retry()
      is Claim.Go -> claim
    }
    val began = SystemClock.elapsedRealtime()
    val outcome = try {
      upload(go, uploader, originalId, partNumber, token, began)
    } catch (e: Throwable) {
      if (isStopped) Outcome.Stopped(stopReason, SystemClock.elapsedRealtime() - began)
      else Outcome.Failed(null, null, "onverwachte fout (${e.javaClass.simpleName})")
    }
    try {
      uploader.finished(originalId, partNumber, token, outcome)
    } catch (_: Throwable) {
      // De volgende start legt de opslag naast de taken (reconcile).
    }
    return if (outcome is Outcome.NetworkGone) Result.retry() else Result.success()
  }

  override fun onStopped() {
    // Meteen afbreken: een lopend deel over mobiel internet stopt binnen seconden (A29).
    try {
      connection?.disconnect()
    } catch (_: Exception) {
      // Al dicht.
    }
  }

  private fun upload(
    go: Claim.Go, uploader: OriginalUploader, originalId: String, partNumber: Int, token: String, began: Long,
  ): Outcome {
    fun stoppedOutcome(): Outcome = Outcome.Stopped(stopReason, SystemClock.elapsedRealtime() - began)
    if (isStopped) return stoppedOutcome()
    // K5: een link die niet te lezen is, is een mislukte poging zonder status.
    val url = try {
      URL(go.url)
    } catch (_: Exception) {
      return Outcome.Failed(null, null, "link niet te gebruiken")
    }
    val conn = try {
      (network?.openConnection(url) ?: url.openConnection()) as? HttpURLConnection
        ?: return Outcome.Failed(null, null, "link niet te gebruiken")
    } catch (_: IOException) {
      return if (uploader.net.alive(network)) Outcome.Failed(null, null, "geen verbinding") else Outcome.NetworkGone
    } catch (_: Exception) {
      return Outcome.Failed(null, null, "link niet te gebruiken")
    }
    connection = conn
    try {
      if (isStopped) return stoppedOutcome()
      conn.requestMethod = "PUT"
      conn.doOutput = true
      conn.useCaches = false
      conn.connectTimeout = 30_000
      conn.readTimeout = 120_000
      conn.setFixedLengthStreamingMode(go.size)
      var sent = 0L
      var lastReport = 0L
      try {
        PartReader(go.file, go.offset, go.size).use { reader ->
          conn.outputStream.use { out ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
              if (isStopped) return stoppedOutcome()
              val n = reader.read(buffer)
              if (n == 0) break
              out.write(buffer, 0, n)
              sent += n
              val now = System.currentTimeMillis()
              if (now - lastReport > 1000) {
                lastReport = now
                uploader.progress(originalId, partNumber, token, sent)
              }
            }
          }
        }
      } catch (_: PartReader.ShortFile) {
        return Outcome.Broken
      }
      if (isStopped) return stoppedOutcome()
      val status = conn.responseCode
      val body = try {
        val stream = if (status >= 400) conn.errorStream else conn.inputStream
        stream?.use { s ->
          val bytes = ByteArray(4096)
          var total = 0
          while (total < bytes.size) {
            val n = s.read(bytes, total, bytes.size - total)
            if (n < 0) break
            total += n
          }
          String(bytes, 0, total, Charsets.UTF_8)
        }
      } catch (_: IOException) {
        null
      }
      return if (status in 200..299) {
        Outcome.Done(status)
      } else {
        Outcome.Failed(status, OriginalUploader.errorCode(body), "HTTP $status")
      }
    } catch (e: IOException) {
      if (isStopped) return stoppedOutcome()
      if (!uploader.net.alive(network)) return Outcome.NetworkGone
      // Geen antwoord: een poging. Geen tekst van de fout (die kan de host noemen).
      return Outcome.Failed(null, null, "geen antwoord (${e.javaClass.simpleName})")
    } finally {
      connection = null
      try {
        conn.disconnect()
      } catch (_: Exception) {
        // Al dicht.
      }
    }
  }
}
