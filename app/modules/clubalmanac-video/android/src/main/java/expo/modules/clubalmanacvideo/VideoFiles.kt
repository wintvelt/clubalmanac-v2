// WP42b: de bestanden van de module (A23). Verkleinde filmpjes en posters in
// een eigen map in de cache; `remove` wist alleen in de cache van de app.

package expo.modules.clubalmanacvideo

import android.content.Context
import android.net.Uri
import java.io.File
import java.util.UUID

internal object VideoFiles {
  private const val DIR = "ClubalmanacVideo"

  private fun dir(context: Context): File = File(context.cacheDir, DIR)

  /** Een gekozen of eigen bestand uit een `file://`-uri of een pad. */
  fun input(uri: String): File {
    val path = when {
      uri.startsWith("file://") -> Uri.parse(uri).path
      uri.startsWith("/") -> uri
      else -> null
    } ?: throw ClubalmanacVideoException("Geen bestand")
    return File(path)
  }

  fun newFile(context: Context, ext: String): File {
    val d = dir(context)
    d.mkdirs()
    return File(d, "clubalmanac-${UUID.randomUUID()}.$ext")
  }

  fun uriOf(file: File): String = Uri.fromFile(file).toString()

  /** Een tijdelijk bestand weg; alleen in de cache van de app, nooit een fout. */
  fun remove(context: Context, uri: String) {
    try {
      val file = input(uri).canonicalFile
      val cache = context.cacheDir.canonicalFile
      if (file.path.startsWith(cache.path + File.separator) && file.isFile) file.delete()
    } catch (_: Exception) {
      // Al weg, of geen bestand van de app.
    }
  }

  /** Wat een gestopte app achterliet: bij het laden van de module. */
  fun clear(context: Context) {
    try {
      dir(context).deleteRecursively()
    } catch (_: Exception) {
      // De volgende start opnieuw.
    }
  }
}
