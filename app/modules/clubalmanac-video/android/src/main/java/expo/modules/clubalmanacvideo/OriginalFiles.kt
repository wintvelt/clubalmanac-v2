// WP42c: het bewaarde origineel en de mappen van de uploader op Android, de
// tegenhanger van ios/OriginalFiles.swift.
// Spec: docs/work-packages/WP42-android.md §Spec-criticus aanvullingen 42c
// (A31, A32, A38); WP38 38b-2 en 38b-10.
//
// - `keep`: de kopie van de kiezer (in `cache/ImagePicker`) wordt verplaatst,
//   niet gekopieerd, naar een eigen map in `noBackupFilesDir`: niet de cache
//   (die mag Android wissen), niet in een back-up. Hernoemen op dezelfde
//   schijf: direct, zonder extra ruimte. Het bestand zelf blijft precies zoals
//   de kiezer het gaf (A38).
// - JS kent alleen de bestandsnaam (een UUID), nooit een pad in een log.
// - De opruimregels van WP39 (`remove`, `cache/ImagePicker`) raken deze
//   mappen niet: ze liggen buiten de cache.
// - `readState`/`writeState`: kleine bestanden van de wachtrij in JS (de
//   wachtrij en "Alleen via wifi"), atomair geschreven.
// - Geen deelbestanden: de uploader leest elk deel rechtstreeks uit het
//   bewaarde bestand (OriginalPartWorker.kt).

package expo.modules.clubalmanacvideo

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.os.storage.StorageManager
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

internal object OriginalDirs {
  private const val ORIGINALS = "clubalmanac-originals"
  private const val STATE = "clubalmanac-original-state"
  private val SAFE = Regex("^[A-Za-z0-9._-]+$")

  private fun ensure(context: Context, name: String): File {
    val dir = File(context.noBackupFilesDir, name)
    if (!dir.isDirectory) dir.mkdirs()
    return dir
  }

  /** De bewaarde originelen (A31): buiten de cache die WP39 opruimt. */
  fun originals(context: Context): File = ensure(context, ORIGINALS)

  /** De opslag van de uploader, de wachtrij van JS en het log. */
  fun state(context: Context): File = ensure(context, STATE)

  /** Alleen een gewone naam, geen pad. */
  fun safeName(name: String): String? =
    if (name.isNotEmpty() && name.length < 200 && SAFE.matches(name) && !name.startsWith(".")) name else null

  /** Ligt dit bestand in een van de mappen van de originelen? */
  fun isProtected(context: Context, file: File): Boolean {
    val path = file.canonicalPath
    return listOf(originals(context), state(context)).any { dir ->
      val base = dir.canonicalPath
      path == base || path.startsWith(base + File.separator)
    }
  }
}

internal object OriginalFiles {
  /** 38b-2, A31: verplaatsen, niet kopiëren. Lukt verplaatsen niet, dan gaat het origineel niet mee. */
  fun keep(context: Context, uri: String): Map<String, Any> {
    val src = VideoFiles.input(uri)
    if (!src.isFile || OriginalDirs.isProtected(context, src)) {
      throw ClubalmanacVideoException("Het origineel kon niet bewaard worden")
    }
    val ext = src.extension.lowercase(Locale.ROOT).ifEmpty { "mp4" }
    val safeExt = OriginalDirs.safeName(ext) ?: "mp4"
    val name = "${UUID.randomUUID()}.$safeExt"
    val dest = File(OriginalDirs.originals(context), name)
    if (!src.renameTo(dest)) throw ClubalmanacVideoException("Het origineel kon niet bewaard worden")
    return mapOf("fileName" to name, "uri" to Uri.fromFile(dest).toString(), "bytes" to dest.length().toDouble())
  }

  fun file(context: Context, fileName: String): File {
    val name = OriginalDirs.safeName(fileName) ?: throw ClubalmanacVideoException("Ongeldige bestandsnaam")
    return File(OriginalDirs.originals(context), name)
  }

  fun info(context: Context, fileName: String): Map<String, Any> {
    val f = file(context, fileName)
    val exists = f.isFile
    return mapOf("uri" to Uri.fromFile(f).toString(), "exists" to exists, "bytes" to (if (exists) f.length() else 0L).toDouble())
  }

  fun remove(context: Context, fileName: String) {
    val f = file(context, fileName)
    if (f.exists() && !f.delete()) throw ClubalmanacVideoException("Het origineel kon niet weg")
  }

  fun list(context: Context): List<String> =
    (OriginalDirs.originals(context).list() ?: emptyArray()).filter { OriginalDirs.safeName(it) != null }.sorted()

  /** Streamend, 4 MiB per keer: niet het hele bestand in het geheugen. */
  fun sha256(context: Context, fileName: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file(context, fileName)).use { input ->
      val buffer = ByteArray(4 shl 20)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /** Vrije ruimte, met wat Android uit caches kan vrijmaken; `null` als Android het niet zegt. */
  fun freeBytes(context: Context): Double? {
    val dir = context.noBackupFilesDir
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val storage = context.getSystemService(StorageManager::class.java)
        if (storage != null) return storage.getAllocatableBytes(storage.getUuidForPath(dir)).toDouble()
      } catch (_: Exception) {
        // Dan StatFs.
      }
    }
    return try {
      StatFs(dir.path).availableBytes.toDouble()
    } catch (_: Exception) {
      null
    }
  }

  private fun stateFile(context: Context, name: String): File {
    val safe = OriginalDirs.safeName(name) ?: throw ClubalmanacVideoException("Ongeldige bestandsnaam")
    return File(OriginalDirs.state(context), safe)
  }

  /** `null` als het bestand er niet is; een andere fout gaat naar JS. */
  fun readState(context: Context, name: String): String? {
    val f = stateFile(context, name)
    if (!f.exists()) return null
    return f.readText(Charsets.UTF_8)
  }

  fun writeState(context: Context, name: String, text: String) {
    writeAtomic(stateFile(context, name), text)
  }

  /** Eerst naast het bestand, dan in één keer erover. */
  fun writeAtomic(target: File, text: String) {
    val tmp = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
    try {
      tmp.writeText(text, Charsets.UTF_8)
      if (!tmp.renameTo(target)) throw ClubalmanacVideoException("Bewaren lukte niet")
    } finally {
      if (tmp.exists()) tmp.delete()
    }
  }
}
