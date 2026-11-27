// WP42c: originelen in delen naar R2 op Android, ook met de app dicht. De
// tegenhanger van ios/OriginalUploader.swift, met dezelfde functies en events
// naar JS (A27), zodat de runner en de wachtrij van 38b ongewijzigd werken.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42c
// (A27–A33, A35), besluiten B15, B19–B21; WP38 38b-13 tot 38b-16.
//
// - B15, A33: WorkManager, een gewone taak per deel (OriginalPartWorker.kt),
//   zonder foreground service, zonder expedited werk of UIDT, zonder melding.
//   Android start de taak zelf, ook na wegvegen, met het scherm op slot, na
//   Doze en (B19, RECEIVE_BOOT_COMPLETED) na een herstart. Op de achtergrond
//   draait er geen JS: de uploader beslist dan zelf over een mislukt deel.
// - A28: één deel tegelijk. Zo past een deel van 32 MiB ook op een verbinding
//   van ~0,5 Mbit/s binnen de tijdslimiet van Android (10 minuten per taak).
//   Is een deel klaar, dan zet de uploader het volgende klaar.
// - A28: een tijdelijke fout (geen antwoord, 5xx, 429, andere 4xx) probeert de
//   uploader zelf opnieuw, met dezelfde link en een wachttijd die oploopt,
//   hooguit PART_ATTEMPTS mislukte pogingen. Na 403, `NoSuchUpload` of de
//   laatste poging wacht het deel ("mislukt") en hoort JS het, nu of bij de
//   volgende start (`atLaunch`). Netwerk weg, of gestopt door Android (Doze,
//   quotum, tijdslimiet, een voorwaarde die niet meer klopt): geen poging;
//   WorkManager start dezelfde taak opnieuw.
// - A29: "Alleen via wifi" aan is een taak met de voorwaarde "niet betaald",
//   en in de taak zelf alleen wifi of kabel (mobiel internet dat de provider
//   onbeperkt noemt, wacht ook). De verbinding gaat over het netwerk van de
//   taak. Omzetten zet het deel dat bezig is meteen opnieuw klaar met de
//   nieuwe voorwaarde: een lopend deel over mobiel internet stopt.
// - 38b-14: elk deel één keer onderweg. Elke taak draagt een token; de afloop
//   van een taak met een token dat het deel niet meer heeft (nieuwe links,
//   omgezet, vergeten), telt niet. Bij de start legt de uploader zijn opslag
//   naast de taken van WorkManager (een deel zonder taak gaat weer in de rij,
//   een taak zonder deel stopt).
// - A32: de links staan alleen in de eigen opslag (noBackupFilesDir), niet in
//   de taken van WorkManager; geen link, sleutel of pad in het log, een event
//   of logcat. Vergeten haalt ook de taken weg.
// - 38b-17: de opslag is JSON met een versie; nieuwe velden zijn optioneel.

package expo.modules.clubalmanacvideo

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal fun nowMs(): Double = System.currentTimeMillis().toDouble()

// MARK: - opslag

internal class UploadPart(
  val partNumber: Int,
  val offset: Long,
  val size: Long,
  var url: String?,
  /** "wacht" | "bezig" | "klaar" | "mislukt" */
  var state: String,
  var sent: Long,
  var httpStatus: Int?,
  var code: String?,
  /** Mislukte pogingen met de huidige link. */
  var attempts: Int,
  var session: String?,
  var token: String?,
  /** Na een tijdelijke fout niet vóór dit moment opnieuw (A28). */
  var retryAt: Double?,
  var updatedAt: Double,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("partNumber", partNumber)
    put("offset", offset)
    put("size", size)
    put("url", url ?: JSONObject.NULL)
    put("state", state)
    put("sent", sent)
    put("httpStatus", httpStatus ?: JSONObject.NULL)
    put("code", code ?: JSONObject.NULL)
    put("attempts", attempts)
    put("session", session ?: JSONObject.NULL)
    put("token", token ?: JSONObject.NULL)
    put("retryAt", retryAt ?: JSONObject.NULL)
    put("updatedAt", updatedAt)
  }

  companion object {
    fun fromJson(o: JSONObject) = UploadPart(
      partNumber = o.getInt("partNumber"),
      offset = o.getLong("offset"),
      size = o.getLong("size"),
      url = o.optStringOrNull("url"),
      state = o.getString("state"),
      sent = o.optLong("sent", 0),
      httpStatus = if (o.has("httpStatus") && !o.isNull("httpStatus")) o.getInt("httpStatus") else null,
      code = o.optStringOrNull("code"),
      attempts = o.optInt("attempts", 0),
      session = o.optStringOrNull("session"),
      token = o.optStringOrNull("token"),
      retryAt = if (o.has("retryAt") && !o.isNull("retryAt")) o.getDouble("retryAt") else null,
      updatedAt = o.optDouble("updatedAt", 0.0),
    )
  }
}

internal class UploadJob(
  val originalId: String,
  val fileName: String,
  val totalBytes: Long,
  val partSize: Long,
  var expiresAt: Double,
  val createdAt: Double,
  /** De generatie van de links (38b, fix-cyclus 1, punt 5). */
  var generation: Long,
  /** Het event "alle delen klaar" is gestuurd voor deze ronde links. */
  var allDoneSent: Boolean,
  /** Het bewaarde bestand is weg of heeft een andere grootte. */
  var broken: Boolean,
  val parts: MutableList<UploadPart>,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("originalId", originalId)
    put("fileName", fileName)
    put("totalBytes", totalBytes)
    put("partSize", partSize)
    put("expiresAt", expiresAt)
    put("createdAt", createdAt)
    put("generation", generation)
    put("allDoneSent", allDoneSent)
    put("broken", broken)
    put("parts", JSONArray().apply { parts.forEach { put(it.toJson()) } })
  }

  companion object {
    fun fromJson(o: JSONObject): UploadJob {
      val list = o.getJSONArray("parts")
      return UploadJob(
        originalId = o.getString("originalId"),
        fileName = o.getString("fileName"),
        totalBytes = o.getLong("totalBytes"),
        partSize = o.getLong("partSize"),
        expiresAt = o.optDouble("expiresAt", 0.0),
        createdAt = o.optDouble("createdAt", 0.0),
        generation = o.optLong("generation", 0),
        allDoneSent = o.optBoolean("allDoneSent", false),
        broken = o.optBoolean("broken", false),
        parts = MutableList(list.length()) { UploadPart.fromJson(list.getJSONObject(it)) },
      )
    }
  }
}

internal class UploaderStore(var wifiOnly: Boolean = true, val jobs: MutableList<UploadJob> = mutableListOf()) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("version", CURRENT_VERSION)
    put("wifiOnly", wifiOnly)
    put("jobs", JSONArray().apply { jobs.forEach { put(it.toJson()) } })
  }

  companion object {
    const val CURRENT_VERSION = 1

    fun fromJson(text: String): UploaderStore {
      val o = JSONObject(text)
      val list = o.optJSONArray("jobs") ?: JSONArray()
      return UploaderStore(
        wifiOnly = o.optBoolean("wifiOnly", true),
        jobs = MutableList(list.length()) { UploadJob.fromJson(list.getJSONObject(it)) },
      )
    }
  }
}

private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

internal class NewPartLink(val partNumber: Int, val offset: Long, val size: Long, val url: String)

/** Wat de taak van een deel moet doen. */
internal sealed class Claim {
  /** Het deel is er niet meer, of heeft een nieuwere taak: niets doen. */
  object Stale : Claim()

  /** Nog niet: WorkManager probeert het later opnieuw (opslag niet te lezen, of mobiel internet bij "Alleen via wifi"). */
  object Later : Claim()

  class Go(val file: File, val offset: Long, val size: Long, val url: String) : Claim()
}

/** De afloop van een taak. */
internal sealed class Outcome {
  class Done(val status: Int) : Outcome()

  class Failed(val status: Int?, val code: String?, val what: String) : Outcome()

  /** Gestopt door Android of de app (geen poging). */
  class Stopped(val reason: Int) : Outcome()

  /** Het netwerk van de taak viel weg (geen poging). */
  object NetworkGone : Outcome()

  /** Het bewaarde bestand is korter dan aangemeld of weg. */
  object Broken : Outcome()
}

// MARK: - netwerk en log

/** Het netwerk zoals JS het ziet (`networkStatus`, `onNetwork`), met dezelfde regel als de taken (A29). */
internal class NetworkWatch(context: Context) {
  private val cm = context.getSystemService(ConnectivityManager::class.java)
  @Volatile private var current: Pair<String, Boolean> = read()
  @Volatile var onChange: ((String, Boolean) -> Unit)? = null

  init {
    try {
      cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = update(describe(caps))
        override fun onLost(network: Network) = update(read())
        override fun onAvailable(network: Network) = update(read())
      })
    } catch (_: Exception) {
      // Geen terugroep: dan alleen wat `status` bij elke vraag leest.
    }
  }

  private fun update(next: Pair<String, Boolean>) {
    val before = current
    current = next
    if (label(before) != label(next)) onChange?.invoke(next.first, next.second)
  }

  private fun read(): Pair<String, Boolean> =
    try {
      describe(cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) })
    } catch (_: Exception) {
      "onbekend" to false
    }

  val status: Pair<String, Boolean>
    get() = read().also { current = it }

  val label: String
    get() = label(status)

  /** Is dit netwerk goed voor "Alleen via wifi": wifi of kabel, niet betaald, geen mobiel internet (A29)? */
  fun wifiLike(network: Network?): Boolean {
    val caps = try {
      cm?.getNetworkCapabilities(network ?: cm.activeNetwork)
    } catch (_: Exception) {
      null
    } ?: return false
    if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false
    if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return false
    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return false
    return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  }

  /**
   * Is het netwerk van een taak er nog, met internet dat Android heeft
   * nagekeken? Vlak na een herstart is wifi er al voordat namen opgezocht
   * kunnen worden; een fout dan is geen poging (S3).
   */
  fun alive(network: Network?): Boolean =
    try {
      val caps = cm?.getNetworkCapabilities(network ?: cm.activeNetwork)
      caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } catch (_: Exception) {
      false
    }

  companion object {
    fun describe(caps: NetworkCapabilities?): Pair<String, Boolean> {
      if (caps == null || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "geen" to false
      val type = when {
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobiel"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "kabel"
        else -> "anders"
      }
      return type to !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    fun label(s: Pair<String, Boolean>): String = if (s.second) "${s.first}, duur" else s.first
  }
}

/** Het log van de uploader (voor het proefscherm), op schijf. Nooit een link, sleutel of pad. */
internal class OriginalLog(private val context: Context) {
  private val q = Executors.newSingleThreadExecutor { r -> Thread(r, "clubalmanac-originals-log").apply { isDaemon = true } }
  private val maxBytes = 1_000_000L
  private val file: File
    get() = File(OriginalDirs.state(context), "log.jsonl")

  fun add(text: String, net: String) {
    val line = JSONObject().apply {
      put("at", nowMs())
      put("net", net)
      put("text", text.take(300))
    }.toString() + "\n"
    q.execute {
      try {
        val f = file
        f.appendText(line, Charsets.UTF_8)
        if (f.length() > maxBytes) {
          // De oudste helft weg, vanaf een regelgrens.
          val all = f.readText(Charsets.UTF_8)
          val tail = all.takeLast((maxBytes / 2).toInt())
          val nl = tail.indexOf('\n')
          OriginalFiles.writeAtomic(f, if (nl >= 0) tail.substring(nl + 1) else "")
        }
      } catch (_: Exception) {
        // Een regel minder in het log.
      }
    }
  }

  fun read(limit: Int): List<Map<String, Any>> =
    q.submit(Callable {
      try {
        val f = file
        if (!f.exists()) return@Callable emptyList<Map<String, Any>>()
        f.readLines(Charsets.UTF_8).filter { it.isNotBlank() }.takeLast(maxOf(0, limit)).mapNotNull { text ->
          try {
            val o = JSONObject(text)
            mapOf("at" to o.getDouble("at"), "net" to o.getString("net"), "text" to o.getString("text"))
          } catch (_: Exception) {
            null
          }
        }
      } catch (_: Exception) {
        emptyList()
      }
    }).get()

  fun clear() {
    q.submit { file.delete() }.get()
  }
}

// MARK: - de uploader

internal class OriginalUploader private constructor(private val context: Context) {
  companion object {
    @Volatile private var instance: OriginalUploader? = null

    fun get(context: Context): OriginalUploader =
      instance ?: synchronized(this) { instance ?: OriginalUploader(context.applicationContext).also { instance = it } }

    /** Alle taken van de uploader. */
    const val TAG = "clubalmanac-originals"
    const val WIFI = "wifi"
    const val ANY = "alles"

    /** Mislukte pogingen met dezelfde link (38b-6, PART_ATTEMPTS in originalUpload.ts). */
    const val PART_ATTEMPTS = 5

    /** De eerste wachttijd na een tijdelijke fout; daarna steeds het dubbele (A28). */
    private const val FIRST_RETRY_MS = 60_000.0

    const val KEY_ORIGINAL = "originalId"
    const val KEY_PART = "partNumber"
    const val KEY_TOKEN = "token"

    fun fileKey(originalId: String): String = originalId.map { if (it.isLetterOrDigit() && it.code < 128) it else '_' }.joinToString("")
    fun originalTag(originalId: String) = "orig:${fileKey(originalId)}"
    fun tokenTag(token: String) = "token:$token"
    private fun workName(originalId: String, partNumber: Int) = "clubalmanac-original-${fileKey(originalId)}-$partNumber"

    /** De foutcode van R2 (`<Code>…</Code>`), zonder de rest van het antwoord. */
    fun errorCode(body: String?): String? {
      if (body == null) return null
      val m = Regex("<Code>([A-Za-z0-9._-]{1,64})</Code>").find(body) ?: return null
      return m.groupValues[1]
    }
  }

  /** Alles wat de opslag raakt, loopt over deze ene thread (zoals de queue op iOS). */
  @Volatile private var qThread: Thread? = null
  private val q = Executors.newSingleThreadExecutor { r -> Thread(r, "clubalmanac-originals").apply { isDaemon = true; qThread = this } }

  private var store = UploaderStore()
  private var loaded = false
  private var started = false
  private var startReason = ""

  val net = NetworkWatch(context)
  val log = OriginalLog(context)
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  private val storeFile: File
    get() = File(OriginalDirs.state(context), "uploader.json")

  private val workManager: WorkManager
    get() = WorkManager.getInstance(context)

  init {
    net.onChange = { type, expensive ->
      val label = NetworkWatch.label(type to expensive)
      log.add("netwerk: $label", label)
      emit?.invoke("onNetwork", mapOf("type" to type, "expensive" to expensive))
    }
  }

  /** Op `q`, en wacht op de uitkomst; een fout gaat door naar de aanroeper. */
  private fun <T> onQ(block: () -> T): T {
    if (Thread.currentThread() === qThread) return block()
    try {
      return q.submit(Callable { block() }).get()
    } catch (e: ExecutionException) {
      throw e.cause ?: e
    }
  }

  private fun note(text: String) = log.add(text, net.label)

  /** Een regel van de app (de runner) in hetzelfde log. */
  fun noteFromApp(text: String) = log.add("app: $text", net.label)

  private fun foreground(): Boolean =
    try {
      val info = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(info)
      info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } catch (_: Exception) {
      false
    }

  private fun where() = if (foreground()) "voorgrond" else "achtergrond"

  private fun save() {
    if (!loaded) return
    try {
      OriginalFiles.writeAtomic(storeFile, store.toJson().toString())
    } catch (_: Exception) {
      note("opslag van de uploader bewaren lukte niet")
    }
  }

  // MARK: start en herstel

  /** Bij het laden van de module of de start van een taak: de opslag lezen en naast WorkManager leggen. */
  fun start(reason: String) {
    q.execute { tryStart(reason) }
  }

  /** De app komt voor: kijken of er iets klaar kan (een deel dat niet bezig is). */
  fun becameActive() {
    q.execute {
      if (tryStart("app voor")) pump()
    }
  }

  private fun tryStart(reason: String): Boolean {
    if (started) return true
    if (startReason.isEmpty()) startReason = reason
    if (!load()) return false
    started = true
    note("uploader start ($startReason, ${where()})")
    reconcile()
    return true
  }

  /** `false`: een leesfout; dan blijft alles zoals het was. Onleesbaar: leeg beginnen, "Alleen via wifi" aan (38b-17). */
  private fun load(): Boolean {
    if (loaded) return true
    val f = storeFile
    if (f.exists()) {
      val text = try {
        f.readText(Charsets.UTF_8)
      } catch (_: Exception) {
        note("opslag van de uploader niet te lezen: later opnieuw")
        return false
      }
      store = try {
        UploaderStore.fromJson(text)
      } catch (_: Exception) {
        note("opslag van de uploader onleesbaar: leeg begonnen, alleen via wifi aan")
        UploaderStore()
      }
    }
    loaded = true
    return true
  }

  private fun requireStarted() {
    if (!tryStart("aanroep van de app")) throw ClubalmanacVideoException("De uploader is nog niet gestart (de opslag was nog niet te lezen)")
  }

  /** 38b-14: de opslag naast de taken van WorkManager. Alleen op `q`. */
  private fun reconcile() {
    val infos = try {
      workManager.getWorkInfosByTag(TAG).get()
    } catch (_: Exception) {
      note("taken van Android niet te lezen: delen die bezig waren, gaan opnieuw in de rij")
      emptyList()
    }
    val live = HashMap<String, java.util.UUID>()
    for (info in infos) {
      if (info.state.isFinished) continue
      val token = info.tags.firstOrNull { it.startsWith("token:") }?.removePrefix("token:") ?: continue
      live[token] = info.id
    }
    val kept = HashSet<String>()
    var restarted = 0
    for (job in store.jobs) {
      for (p in job.parts) {
        if (p.state != "bezig") continue
        val token = p.token
        if (token != null && live.containsKey(token)) {
          kept.add(token)
        } else {
          p.state = "wacht"
          p.token = null
          p.sent = 0
          restarted += 1
        }
      }
    }
    var orphans = 0
    for ((token, id) in live) {
      if (kept.contains(token)) continue
      workManager.cancelWorkById(id)
      orphans += 1
    }
    save()
    note("teruggevonden: ${kept.size} taken lopen door, $restarted delen opnieuw in de rij, $orphans losse taken gestopt")
    pump()
  }

  // MARK: vanuit JS

  /**
   * Delen met links (`aan_ios`). Nieuwe links vervangen de oude; een deel
   * zonder link staat al in R2. Een deel dat met een oude link bezig is,
   * stopt eerst.
   */
  fun send(
    originalId: String, fileName: String, generation: Long, totalBytes: Long, partSize: Long,
    expiresAt: Double, links: List<NewPartLink>,
  ) {
    if (originalId.isEmpty() || OriginalDirs.safeName(fileName) == null || totalBytes <= 0 || partSize <= 0) {
      throw ClubalmanacVideoException("Ongeldige upload")
    }
    val count = ((totalBytes + partSize - 1) / partSize).toInt()
    for (l in links) {
      val ok = l.partNumber in 1..count && l.url.startsWith("https://") &&
        l.offset == (l.partNumber - 1).toLong() * partSize && l.size == minOf(partSize, totalBytes - l.offset)
      if (!ok) throw ClubalmanacVideoException("Ongeldige upload")
    }
    onQ {
      if (!tryStart("aanroep van de app")) {
        // Geen fout naar JS (dat zou het origineel als kapot weggooien); de volgende start ziet dat de uploader niets weet.
        note("$originalId: delen niet aangenomen, de uploader is nog niet gestart")
        return@onQ
      }
      val byNumber = links.associateBy { it.partNumber }
      val now = nowMs()
      val stale = HashSet<String>()
      val existing = store.jobs.firstOrNull { it.originalId == originalId }
      if (existing != null && existing.totalBytes == totalBytes && existing.partSize == partSize && existing.fileName == fileName) {
        for (part in existing.parts) {
          if (part.state == "bezig") part.token?.let { stale.add(it) }
          val link = byNumber[part.partNumber]
          if (link != null) {
            part.url = link.url
            part.state = "wacht"
            part.attempts = 0
            part.sent = 0
            part.httpStatus = null
            part.code = null
            part.token = null
            part.retryAt = null
          } else if (part.state != "klaar") {
            part.state = "klaar"
            part.url = null
            part.sent = part.size
            part.token = null
            part.retryAt = null
          }
          part.updatedAt = now
        }
        existing.expiresAt = expiresAt
        existing.generation = generation
        existing.allDoneSent = false
        existing.broken = false
        note("$originalId: nieuwe links voor ${byNumber.size} van $count delen (generatie $generation)")
      } else {
        if (existing != null) {
          existing.parts.forEach { p -> p.token?.let { stale.add(it) } }
          store.jobs.remove(existing)
        }
        val parts = MutableList(count) { i ->
          val n = i + 1
          val offset = i.toLong() * partSize
          val size = minOf(partSize, totalBytes - offset)
          val link = byNumber[n]
          UploadPart(
            partNumber = n, offset = offset, size = size, url = link?.url,
            state = if (link == null) "klaar" else "wacht", sent = if (link == null) size else 0,
            httpStatus = null, code = null, attempts = 0, session = null, token = null, retryAt = null, updatedAt = now,
          )
        }
        store.jobs.add(
          UploadJob(
            originalId = originalId, fileName = fileName, totalBytes = totalBytes, partSize = partSize,
            expiresAt = expiresAt, createdAt = now, generation = generation, allDoneSent = false, broken = false,
            parts = parts,
          ),
        )
        note("$originalId: ${byNumber.size} van $count delen aan Android (generatie $generation)")
      }
      for (token in stale) workManager.cancelAllWorkByTag(tokenTag(token))
      save()
      pump()
    }
  }

  /** Een mislukt deel opnieuw, met dezelfde link (`ios_opnieuw`). */
  fun retryPart(originalId: String, partNumber: Int) {
    onQ {
      requireStarted()
      val job = store.jobs.firstOrNull { it.originalId == originalId } ?: return@onQ
      val part = job.parts.firstOrNull { it.partNumber == partNumber && it.state == "mislukt" } ?: return@onQ
      part.state = "wacht"
      part.retryAt = null
      part.updatedAt = nowMs()
      save()
      pump()
    }
  }

  /** Alles van dit origineel weg: taken en opslag (`ios_vergeten`). Ook de taken bij Android (A32). */
  fun forget(originalId: String) {
    onQ {
      requireStarted()
      val known = store.jobs.removeAll { it.originalId == originalId }
      workManager.cancelAllWorkByTag(originalTag(originalId))
      workManager.pruneWork()
      save()
      if (known) note("$originalId: vergeten, taken bij Android weg")
      pump()
    }
  }

  fun wifiOnly(): Boolean = onQ {
    requireStarted()
    store.wifiOnly
  }

  /** A29: omzetten geldt meteen, ook voor het deel dat bezig is (dat stopt en gaat met de nieuwe voorwaarde). */
  fun setWifiOnly(on: Boolean) {
    onQ {
      requireStarted()
      if (store.wifiOnly == on) return@onQ
      store.wifiOnly = on
      val from = if (on) ANY else WIFI
      var moved = 0
      for (job in store.jobs) {
        for (p in job.parts) {
          if (p.state != "bezig" || p.session != from) continue
          p.token?.let { workManager.cancelAllWorkByTag(tokenTag(it)) }
          p.state = "wacht"
          p.token = null
          p.sent = 0
          moved += 1
        }
      }
      save()
      note("alleen via wifi: ${if (on) "aan" else "uit"}; $moved delen opnieuw klaargezet")
      pump()
    }
  }

  /** De stand per origineel, zonder links. */
  fun jobsJSON(): String = onQ {
    requireStarted()
    val jobs = JSONArray()
    for (job in store.jobs) {
      val parts = JSONArray()
      for (p in job.parts) {
        parts.put(JSONObject().apply {
          put("partNumber", p.partNumber)
          put("state", p.state)
          put("attempts", p.attempts)
          put("size", p.size)
          put("sent", p.sent)
          put("updatedAt", p.updatedAt)
          put("status", p.httpStatus ?: JSONObject.NULL)
          put("code", p.code ?: JSONObject.NULL)
          p.session?.let { put("session", it) }
        })
      }
      jobs.put(JSONObject().apply {
        put("originalId", job.originalId)
        put("generation", job.generation)
        put("totalBytes", job.totalBytes)
        put("expiresAt", job.expiresAt)
        put("broken", job.broken)
        put("parts", parts)
      })
    }
    JSONObject().apply {
      put("wifiOnly", store.wifiOnly)
      put("jobs", jobs)
    }.toString()
  }

  // MARK: de rij

  private fun source(job: UploadJob): File? {
    val name = OriginalDirs.safeName(job.fileName) ?: return null
    return File(OriginalDirs.originals(context), name)
  }

  private fun sourceOk(job: UploadJob): Boolean {
    val f = source(job) ?: return false
    return f.isFile && f.length() == job.totalBytes
  }

  private fun emitFailed(job: UploadJob, part: UploadPart) {
    emit?.invoke(
      "onPartFailed",
      mapOf(
        "originalId" to job.originalId, "generation" to job.generation.toDouble(), "partNumber" to part.partNumber,
        "status" to part.httpStatus, "code" to part.code, "attempts" to part.attempts,
      ),
    )
  }

  private fun markBroken(job: UploadJob) {
    job.broken = true
    for (p in job.parts) {
      if (p.state != "bezig") continue
      p.token?.let { workManager.cancelAllWorkByTag(tokenTag(it)) }
      p.state = "wacht"
      p.token = null
    }
    note("${job.originalId}: het bewaarde bestand is weg of heeft een andere grootte")
    emit?.invoke("onFileBroken", mapOf("originalId" to job.originalId))
  }

  private fun retryWait(attempts: Int): Double = FIRST_RETRY_MS * (1 shl (attempts - 1).coerceIn(0, 10))

  /**
   * A28: zet het volgende deel klaar bij WorkManager, als er geen deel bezig
   * is. Eerst wat nu mag, in de volgorde van de originelen en de delen; anders
   * het deel dat het eerst weer mag, met een wachttijd. Alleen op `q`.
   */
  private fun pump() {
    if (!started) return
    if (store.jobs.any { j -> !j.broken && j.parts.any { it.state == "bezig" } }) return
    val now = nowMs()
    var changed = false
    var best: Pair<UploadJob, UploadPart>? = null
    var bestAt = Double.MAX_VALUE
    for (job in store.jobs) {
      if (job.broken) continue
      val waiting = job.parts.filter { it.state == "wacht" }
      if (waiting.isEmpty()) continue
      if (!sourceOk(job)) {
        markBroken(job)
        changed = true
        continue
      }
      for (p in waiting) {
        if (p.url == null) {
          p.state = "mislukt"
          p.attempts += 1
          p.httpStatus = null
          p.code = null
          p.updatedAt = now
          changed = true
          emitFailed(job, p)
          continue
        }
        val at = p.retryAt?.takeIf { it > now } ?: 0.0
        if (best == null || at < bestAt) {
          best = job to p
          bestAt = at
        }
      }
    }
    val pick = best
    if (pick != null) {
      val (job, part) = pick
      val token = UUID.randomUUID().toString()
      val session = if (store.wifiOnly) WIFI else ANY
      val delay = maxOf(0.0, (part.retryAt ?: 0.0) - now).toLong()
      part.state = "bezig"
      part.token = token
      part.session = session
      part.sent = 0
      part.updatedAt = now
      changed = true
      enqueue(job, part, token, delay)
      note(
        "${job.originalId} deel ${part.partNumber} aan Android (sessie $session, ${where()}" +
          (if (delay > 0) ", over ${delay / 1000} s" else "") + ")",
      )
    }
    if (changed) save()
  }

  private fun enqueue(job: UploadJob, part: UploadPart, token: String, delayMs: Long) {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(if (store.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .build()
    val input = Data.Builder()
      .putString(KEY_ORIGINAL, job.originalId)
      .putInt(KEY_PART, part.partNumber)
      .putString(KEY_TOKEN, token)
      .build()
    val request = OneTimeWorkRequest.Builder(OriginalPartWorker::class.java)
      .setConstraints(constraints)
      .setInputData(input)
      .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
      .setBackoffCriteria(BackoffPolicy.LINEAR, 60, TimeUnit.SECONDS)
      .addTag(TAG)
      .addTag(originalTag(job.originalId))
      .addTag(tokenTag(token))
      .build()
    workManager.enqueueUniqueWork(workName(job.originalId, part.partNumber), ExistingWorkPolicy.REPLACE, request)
  }

  private fun find(originalId: String, partNumber: Int, token: String): Pair<UploadJob, UploadPart>? {
    val job = store.jobs.firstOrNull { it.originalId == originalId } ?: return null
    val part = job.parts.firstOrNull { it.partNumber == partNumber && it.token == token && it.state == "bezig" } ?: return null
    return job to part
  }

  // MARK: vanuit de taak (OriginalPartWorker)

  /** De taak begint: mag dit deel nu, en waarheen? */
  fun claim(originalId: String, partNumber: Int, token: String, network: Network?, attempt: Int): Claim = onQ {
    if (!tryStart("taak van Android")) return@onQ Claim.Later
    val (job, part) = find(originalId, partNumber, token) ?: return@onQ Claim.Stale
    if (job.broken) return@onQ Claim.Stale
    if (!sourceOk(job)) {
      markBroken(job)
      save()
      pump()
      return@onQ Claim.Stale
    }
    // A29: "niet betaald" laat ook mobiel internet toe dat de provider onbeperkt noemt; dat wacht ook.
    if (part.session == WIFI && !net.wifiLike(network)) {
      note("$originalId deel $partNumber: wacht op wifi (dit netwerk telt niet als wifi)")
      return@onQ Claim.Later
    }
    val url = part.url ?: return@onQ Claim.Stale
    val file = source(job) ?: return@onQ Claim.Stale
    part.retryAt = null
    part.sent = 0
    part.updatedAt = nowMs()
    note("$originalId deel $partNumber: versturen begint (sessie ${part.session}, ${where()}, start $attempt)")
    Claim.Go(file, part.offset, part.size, url)
  }

  /** Hoeveel er van het deel verstuurd is (alleen in het geheugen, voor de stand). */
  fun progress(originalId: String, partNumber: Int, token: String, sent: Long) {
    q.execute { find(originalId, partNumber, token)?.second?.sent = sent }
  }

  /** De taak is klaar: de afloop in de opslag, en het volgende deel. */
  fun finished(originalId: String, partNumber: Int, token: String, outcome: Outcome) {
    onQ {
      val found = find(originalId, partNumber, token)
      if (found == null) {
        // Nieuwe links, omgezet of vergeten: telt niet.
        if (outcome is Outcome.Done) note("$originalId deel $partNumber: klaar, maar die taak telt niet meer")
        pump()
        return@onQ
      }
      val (job, part) = found
      val now = nowMs()
      part.updatedAt = now
      when (outcome) {
        is Outcome.Stopped -> {
          // Geen poging en geen mislukking: WorkManager start dezelfde taak opnieuw.
          part.sent = 0
          note("$originalId deel $partNumber: gestopt door Android (reden ${outcome.reason}), wacht op een nieuwe start")
        }
        is Outcome.NetworkGone -> {
          part.sent = 0
          note("$originalId deel $partNumber: netwerk weg, wacht op een nieuwe start")
        }
        is Outcome.Broken -> markBroken(job)
        is Outcome.Done -> {
          part.state = "klaar"
          part.httpStatus = outcome.status
          part.code = null
          part.sent = part.size
          part.url = null
          part.token = null
          part.retryAt = null
          val done = job.parts.count { it.state == "klaar" }
          val total = job.parts.size
          note("$originalId deel $partNumber klaar (HTTP ${outcome.status}, sessie ${part.session}, ${where()}); $done van $total")
          emit?.invoke(
            "onPartDone",
            mapOf(
              "originalId" to originalId, "generation" to job.generation.toDouble(), "partNumber" to partNumber,
              "done" to done, "total" to total,
            ),
          )
          if (done == total && !job.allDoneSent) {
            job.allDoneSent = true
            note("$originalId: alle delen klaar (generatie ${job.generation})")
            emit?.invoke("onAllPartsDone", mapOf("originalId" to originalId, "generation" to job.generation.toDouble()))
          }
        }
        is Outcome.Failed -> {
          part.httpStatus = outcome.status
          part.code = outcome.code
          part.token = null
          part.sent = 0
          part.attempts += 1
          val final = outcome.status == 403 || outcome.code == "NoSuchUpload" || part.attempts >= PART_ATTEMPTS
          if (final) {
            part.state = "mislukt"
            part.retryAt = null
          } else {
            part.state = "wacht"
            part.retryAt = now + retryWait(part.attempts)
          }
          note(
            "$originalId deel $partNumber mislukt: ${outcome.what}${outcome.code?.let { " $it" } ?: ""}, " +
              "sessie ${part.session}, poging ${part.attempts}" + (if (final) ", wacht op de app" else ", zelf opnieuw"),
          )
          if (final) emitFailed(job, part)
        }
      }
      save()
      pump()
    }
  }
}

/** Een stuk van het bewaarde bestand lezen; een kort bestand is kapot. */
internal class PartReader(file: File, offset: Long, private var left: Long) : AutoCloseable {
  class ShortFile : Exception("Het origineel is korter dan aangemeld")

  private val raf = RandomAccessFile(file, "r").also { it.seek(offset) }

  /** Leest hooguit `buffer.size` bytes; 0 aan het eind van het deel. */
  fun read(buffer: ByteArray): Int {
    if (left <= 0) return 0
    val n = raf.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
    if (n < 0) throw ShortFile()
    left -= n
    return n
  }

  override fun close() = raf.close()
}
